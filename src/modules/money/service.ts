// Expenses, advances and their ledger.
// A person claims a reimbursement, asks for an advance, or settles an advance with bills. After approval the item goes
// to Accounts, who pay it and record how. Every rupee that moves is one line in the ledger, with documents attached.
// Nothing here touches payroll.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from '../../app.ts';
import type { Params } from '../../db/index.ts';
import type { Employee } from '../people/model.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { scopeFor } from '../../lib/scope.ts';
import { localDateString } from '../../lib/time.ts';
import { requestApproval } from '../tasks/service.ts';

export type Kind = 'reimbursement' | 'advance' | 'settlement' | 'vendor' | 'petty';
export const KIND_LABEL: Record<Kind, string> = { reimbursement: 'Reimbursement', advance: 'Advance', settlement: 'Advance settlement', vendor: 'Vendor bill', petty: 'Petty cash' };
export const PAY_MODES = ['Bank transfer', 'UPI', 'Cash', 'Cheque'];
export type EntryType = 'claim_approved' | 'claim_paid' | 'advance_paid' | 'settlement_approved' | 'advance_returned' | 'excess_paid' | 'vendor_bill' | 'vendor_paid' | 'petty_topup' | 'petty_spend';
export type Party = 'employee' | 'vendor' | 'petty';
export const ENTRY_LABEL: Record<EntryType, string> = { claim_approved: 'Expense approved', claim_paid: 'Reimbursement paid', advance_paid: 'Advance given', settlement_approved: 'Bills accepted against advance', advance_returned: 'Unspent advance returned', excess_paid: 'Spent above advance, paid', vendor_bill: 'Vendor bill approved', vendor_paid: 'Vendor paid', petty_topup: 'Cash added to petty cash', petty_spend: 'Paid from petty cash' };

export interface Claim {
  id: string; employee_id: string; employee_name: string; team: string; department_id: string; kind: Kind; category: string; amount: number; description: string;
  status: string; task_id: string | null; created_at: string; expense_date: string | null; advance_id: string | null;
  paid_at: string | null; paid_by: string | null; paid_by_name: string | null; pay_mode: string; pay_ref: string; settled_at: string | null; vendor_name: string; vendor_gstin: string; bill_no: string; gst_amount: number | null; over_limit: number | null; cost_team: string | null; docs: number; bills: number; approver_name: string | null; decided_at: string | null;
}
export interface Doc { id: number; expense_id: string; kind: string; file_name: string; size: number; uploaded_by: string | null; uploaded_by_name: string | null; uploaded_at: string }
export interface Entry { id: number; party: Party; employee_id: string; employee_name: string; team: string; expense_id: string | null; entry_date: string; type: EntryType; debit: number; credit: number; mode: string; ref: string; note: string; category: string | null; created_by_name: string | null; balance?: number }

const SELECT = `SELECT x.*, e.full_name AS employee_name, d.name AS team, e.department_id, (SELECT name FROM departments WHERE id = x.department_id) AS cost_team, pb.full_name AS paid_by_name, ap.full_name AS approver_name, t.decided_at,
  (SELECT COUNT(*) FROM expense_docs dd WHERE dd.expense_id = x.id) AS docs, (SELECT COUNT(*) FROM expense_docs dd WHERE dd.expense_id = x.id AND dd.kind = 'bill') AS bills
  FROM expenses x JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id LEFT JOIN employees pb ON pb.id = x.paid_by LEFT JOIN tasks t ON t.id = x.task_id LEFT JOIN employees ap ON ap.id = COALESCE(t.decided_by, t.assignee_id)`;
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Accounts pays and keeps the ledger; executives and administrators can do the same. */
export function isAccounts(app: App, u: Employee): boolean {
  return !!u.is_admin || u.functional_role === 'executive' || !!app.db.get("SELECT 1 AS x FROM departments WHERE id = ? AND code = 'ACC'", [u.department_id]);
}
export function accountsPeople(app: App): string[] { return app.db.all<{ id: string }>("SELECT e.id FROM employees e JOIN departments d ON d.id = e.department_id WHERE d.code = 'ACC' AND e.status = 'active'").map((r) => r.id); }
export function getClaim(app: App, id: string): Claim | undefined { return app.db.get<Claim>(`${SELECT} WHERE x.id = ?`, [id]); }
/** Your own, your team's, the ones you approve, and everything for Accounts. */
export function canSee(app: App, viewer: Employee, c: Claim): boolean {
  if (c.employee_id === viewer.id || isAccounts(app, viewer)) return true;
  if (c.kind !== 'vendor' && c.kind !== 'petty' && scopeFor(app.db, viewer).people.has(c.employee_id)) return true;
  return !!c.task_id && !!app.db.get('SELECT 1 AS x FROM tasks WHERE id = ? AND (assignee_id = ? OR decided_by = ?)', [c.task_id, viewer.id, viewer.id]);
}
export function requireClaim(app: App, viewer: Employee, id: string): Claim {
  const c = getClaim(app, id); if (!c) throw new HttpError(404, 'That claim does not exist.');
  if (!canSee(app, viewer, c)) throw new HttpError(403, 'This claim belongs to someone outside your team.');
  return c;
}

// ---------- documents ----------
const MIME: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const vault = (app: App): string => join(app.cfg.dataDir, 'vault', 'money');
export function listDocs(app: App, expenseId: string): Doc[] { return app.db.all<Doc>('SELECT d.id, d.expense_id, d.kind, d.file_name, d.size, d.uploaded_by, e.full_name AS uploaded_by_name, d.uploaded_at FROM expense_docs d LEFT JOIN employees e ON e.id = d.uploaded_by WHERE d.expense_id = ? ORDER BY d.id', [expenseId]); }
/** Bills, receipts and payment proofs are kept outside the public uploads folder and are served only to people who may see the claim. */
export function addDoc(app: App, actor: Employee, expenseId: string, kind: string, base64: string, name: string): Doc {
  const c = requireClaim(app, actor, expenseId);
  if (c.employee_id !== actor.id && !isAccounts(app, actor)) throw new HttpError(403, 'Only the person who claimed, or Accounts, can attach a document.');
  const ext = (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!MIME[ext]) throw new HttpError(400, 'Attach a PDF or a photo (JPG, PNG or WebP).');
  const buf = Buffer.from(base64 || '', 'base64'); if (!buf.length) throw new HttpError(400, 'The file is empty.');
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'The file is larger than 5 MB. Take a smaller photo or compress the PDF.');
  const k = kind === 'payment' || kind === 'other' ? kind : 'bill';
  if (k === 'payment' && !isAccounts(app, actor)) throw new HttpError(403, 'Payment proof is attached by Accounts.');
  mkdirSync(vault(app), { recursive: true });
  const file = `${expenseId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`; writeFileSync(join(vault(app), file), buf);
  const clean = name.replace(/[^\w.\- ]+/g, '_').slice(-80) || `document.${ext}`;
  app.db.run('INSERT INTO expense_docs (expense_id, kind, file_path, file_name, size, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [expenseId, k, file, clean, buf.length, actor.id, new Date().toISOString()]);
  audit(app.db, { entity: 'expense', entityId: expenseId, action: 'attach', actorId: actor.id, after: { kind: k, name: clean } });
  return listDocs(app, expenseId).slice(-1)[0];
}
export function readDoc(app: App, viewer: Employee, docId: number): { body: Buffer; name: string; mime: string } {
  const d = app.db.get<{ expense_id: string; file_path: string; file_name: string }>('SELECT expense_id, file_path, file_name FROM expense_docs WHERE id = ?', [docId]);
  if (!d) throw new HttpError(404, 'That document does not exist.');
  requireClaim(app, viewer, d.expense_id);
  const path = join(vault(app), d.file_path); if (!existsSync(path)) throw new HttpError(404, 'The file is missing from the server.');
  return { body: readFileSync(path), name: d.file_name, mime: MIME[(d.file_path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream' };
}

// ---------- ledger ----------
const DEBITS: EntryType[] = ['claim_paid', 'advance_paid', 'excess_paid', 'vendor_paid', 'petty_topup'];
const PARTY_OF = (t: EntryType): Party => (t === 'vendor_bill' || t === 'vendor_paid' ? 'vendor' : t === 'petty_topup' || t === 'petty_spend' ? 'petty' : 'employee');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export function isClosed(app: App, date: string): boolean { return !!app.db.get('SELECT 1 AS x FROM ledger_months WHERE month = ? AND closed_at IS NOT NULL', [date.slice(0, 7)]); }
function post(app: App, actor: Employee | null, c: { id: string | null; employee_id: string }, type: EntryType, amount: number, o: { date?: string; mode?: string; ref?: string; note?: string } = {}): void {
  const date = o.date || localDateString(new Date());
  // A closed month takes no more lines. System lines (an approval landing in a closed month) go on today's date instead.
  if (isClosed(app, date)) throw new HttpError(400, `The books for ${monthName(date.slice(0, 7))} are closed. Use a date in an open month, or ask an executive to reopen it.`);
  const debit = DEBITS.includes(type) ? round2(amount) : 0; const credit = debit ? 0 : round2(amount);
  app.db.run('INSERT INTO expense_ledger (employee_id, expense_id, entry_date, type, debit, credit, mode, ref, note, created_by, created_at, party) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [c.employee_id, c.id, date, type, debit, credit, o.mode || '', o.ref || '', o.note || '', actor?.id || null, new Date().toISOString(), PARTY_OF(type)]);
}
/** Ledger lines, oldest first, each with the person's running balance. Positive: the person holds company money. Negative: the company owes the person. */
export function ledger(app: App, f: { employeeId?: string; people?: Set<string> | null; from?: string; to?: string; party?: Party | 'all' } = {}): Entry[] {
  const where: string[] = []; const p: Params = [];
  if ((f.party || 'employee') !== 'all') { where.push('l.party = ?'); p.push(f.party || 'employee'); }
  if (f.employeeId) { where.push('l.employee_id = ?'); p.push(f.employeeId); }
  const rows = app.db.all<Entry>(`SELECT l.id, l.party, l.employee_id, CASE l.party WHEN 'vendor' THEN COALESCE(NULLIF(x.vendor_name, ''), 'Vendor') WHEN 'petty' THEN 'Petty cash' ELSE e.full_name END AS employee_name, CASE l.party WHEN 'employee' THEN d.name ELSE COALESCE((SELECT name FROM departments WHERE id = x.department_id), d.name) END AS team, l.expense_id, l.entry_date, l.type, l.debit, l.credit, l.mode, l.ref, l.note, x.category, cb.full_name AS created_by_name
    FROM expense_ledger l JOIN employees e ON e.id = l.employee_id JOIN departments d ON d.id = e.department_id LEFT JOIN expenses x ON x.id = l.expense_id LEFT JOIN employees cb ON cb.id = l.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.entry_date, l.id`, p).filter((r) => !f.people || r.party !== 'employee' || f.people.has(r.employee_id));
  const bal = new Map<string, number>();
  for (const r of rows) { const k = r.party === 'employee' ? r.employee_id : r.party === 'petty' ? 'petty' : `v:${r.employee_name}`; const b = round2((bal.get(k) || 0) + r.debit - r.credit); bal.set(k, b); r.balance = b; }
  return rows.filter((r) => (!f.from || r.entry_date >= f.from) && (!f.to || r.entry_date <= f.to));
}
export function balanceOf(app: App, employeeId: string): number { return round2(app.db.get<{ b: number }>("SELECT COALESCE(SUM(debit - credit), 0) AS b FROM expense_ledger WHERE employee_id = ? AND party = 'employee'", [employeeId])!.b); }
export function balances(app: App): { id: string; name: string; team: string; balance: number }[] {
  return app.db.all<{ id: string; name: string; team: string; balance: number }>(`SELECT e.id, e.full_name AS name, d.name AS team, ROUND(SUM(l.debit - l.credit), 2) AS balance FROM expense_ledger l JOIN employees e ON e.id = l.employee_id JOIN departments d ON d.id = e.department_id WHERE l.party = 'employee' GROUP BY e.id HAVING ABS(SUM(l.debit - l.credit)) >= 1 ORDER BY balance DESC`);
}

// ---------- advances ----------
export interface AdvanceState { given: number; billed: number; returned: number; excessPaid: number; balance: number; pendingBills: number }
/** Where an advance stands. balance > 0: the person still holds that much. balance < 0: they spent more than the advance and are owed the difference. */
export function advanceState(app: App, advanceId: string): AdvanceState {
  const a = app.db.get<{ amount: number; status: string }>("SELECT amount, status FROM expenses WHERE id = ? AND kind = 'advance'", [advanceId]); if (!a) throw new HttpError(404, 'That advance does not exist.');
  const given = ['paid', 'settled'].includes(a.status) ? a.amount : 0;
  const s = (sql: string): number => app.db.get<{ v: number }>(sql, [advanceId])!.v;
  const billed = s("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE kind = 'settlement' AND advance_id = ? AND status = 'approved'");
  const pendingBills = s("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE kind = 'settlement' AND advance_id = ? AND status = 'pending'");
  const returned = s("SELECT COALESCE(SUM(credit), 0) AS v FROM expense_ledger WHERE expense_id = ? AND type = 'advance_returned'");
  const excessPaid = s("SELECT COALESCE(SUM(debit), 0) AS v FROM expense_ledger WHERE expense_id = ? AND type = 'excess_paid'");
  return { given, billed, returned, excessPaid, pendingBills, balance: round2(given - billed - returned + excessPaid) };
}
function closeIfSettled(app: App, advanceId: string): void {
  const a = app.db.get<{ status: string }>('SELECT status FROM expenses WHERE id = ?', [advanceId]); if (!a || a.status !== 'paid') return;
  const st = advanceState(app, advanceId);
  if (Math.abs(st.balance) < 1 && st.billed + st.returned > 0 && !st.pendingBills) app.db.run("UPDATE expenses SET status = 'settled', settled_at = ? WHERE id = ?", [new Date().toISOString(), advanceId]);
}
/** Advances a person has been given and has not yet fully accounted for. */
export function openAdvances(app: App, employeeId?: string): (Claim & { state: AdvanceState; days: number })[] {
  const rows = app.db.all<Claim>(`${SELECT} WHERE x.kind = 'advance' AND x.status = 'paid'${employeeId ? ' AND x.employee_id = ?' : ''} ORDER BY x.paid_at`, employeeId ? [employeeId] : []);
  return rows.map((c) => ({ ...c, state: advanceState(app, c.id), days: c.paid_at ? Math.max(0, Math.floor((Date.now() - new Date(c.paid_at).getTime()) / 86_400_000)) : 0 }));
}

// ---------- claiming ----------
export interface NewClaim { kind?: string; category?: string; amount?: number | null; description?: string; expenseDate?: string; advanceId?: string; dealId?: string; km?: number | null; doc?: string; docName?: string; vendorName?: string; vendorGstin?: string; billNo?: string; gstAmount?: number | null; departmentId?: string }
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
/** The supplier and tax on a bill, checked. GST can be claimed back only when the supplier's GSTIN is on record. */
function billDetails(input: NewClaim, amount: number): { vendor: string; gstin: string; billNo: string; gst: number | null } {
  const vendor = String(input.vendorName || '').trim().slice(0, 120); const gstin = String(input.vendorGstin || '').trim().toUpperCase().replace(/\s+/g, ''); const billNo = String(input.billNo || '').trim().slice(0, 40);
  if (gstin && !GSTIN.test(gstin)) throw new HttpError(400, 'That GSTIN does not look right. It has 15 characters, for example 27AAECL0344H1ZQ.');
  const gst = input.gstAmount == null || String(input.gstAmount) === '' ? null : Number(input.gstAmount);
  if (gst != null && (!(gst >= 0) || gst >= amount)) throw new HttpError(400, 'The GST amount must be less than the bill amount.');
  if (gst && !gstin) throw new HttpError(400, "Enter the supplier's GSTIN to record GST on the bill.");
  return { vendor, gstin, billNo, gst: gst ? round2(gst) : null };
}
export function submitClaim(app: App, requester: Employee, input: NewClaim): Claim {
  const kind: Kind = input.kind === 'advance' || input.kind === 'settlement' ? input.kind : 'reimbursement';
  const amount = Number(input.amount); if (!(amount > 0)) throw new HttpError(400, 'Enter an amount.');
  const description = String(input.description || '').trim().slice(0, 1000);
  if (description.length < 3) throw new HttpError(400, kind === 'advance' ? 'Say what the advance is for.' : 'Say what the money was spent on.');
  const today = localDateString(new Date()); const date = isDate(input.expenseDate) && input.expenseDate <= today ? input.expenseDate : today;
  let advanceId: string | null = null; let category = String(input.category || '').trim() || 'Other';
  if (kind === 'settlement') {
    const adv = app.db.get<{ id: string; employee_id: string; status: string; category: string }>("SELECT id, employee_id, status, category FROM expenses WHERE id = ? AND kind = 'advance'", [input.advanceId || '']);
    if (!adv || adv.employee_id !== requester.id) throw new HttpError(400, 'Choose the advance these bills are for.');
    if (adv.status !== 'paid') throw new HttpError(400, adv.status === 'settled' ? 'That advance is already settled.' : 'That advance has not been given to you yet.');
    advanceId = adv.id; if (!input.category) category = adv.category;
  }
  if (kind === 'advance' && openAdvances(app, requester.id).length >= 3) throw new HttpError(400, 'You have three advances not yet settled. Settle one before asking for another.');
  const bill = kind === 'advance' ? { vendor: '', gstin: '', billNo: '', gst: null } : billDetails(input, amount);
  const limit = kind === 'advance' ? null : limitFor(app, category); const over = limit != null && amount > limit ? limit : null;
  const id = app.db.nextId('E');
  const title = `${kind === 'advance' ? 'Advance' : kind === 'settlement' ? 'Advance settlement' : 'Expense'}: ${inr(amount)} ${category} for ${requester.full_name}`;
  app.db.transaction(() => {
    app.db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, advance_id, deal_id, km, vendor_name, vendor_gstin, bill_no, gst_amount, over_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, requester.id, category, round2(amount), description, 'pending', new Date().toISOString(), kind, date, advanceId, input.dealId || null, input.km ?? null, bill.vendor, bill.gstin, bill.billNo, bill.gst, over]);
    const task = requestApproval(app, requester, 'expense', amount, over != null ? `${title} (above the ${inr(over)} limit for ${category})` : title, description, { expenseId: id }, `/money/${id}`);
    app.db.run('UPDATE expenses SET task_id = ? WHERE id = ?', [task.id, id]);
  });
  if (input.doc) addDoc(app, requester, id, 'bill', input.doc, input.docName || 'bill.jpg');
  return getClaim(app, id)!;
}

/** Called when the approver decides. Approval is what creates the debt in the ledger and sends the item to Accounts. */
export function expenseDecided(app: App, actor: Employee, expenseId: string, decision: 'approved' | 'declined'): void {
  const c = app.db.get<{ id: string; employee_id: string; kind: Kind; amount: number; advance_id: string | null; category: string }>('SELECT id, employee_id, kind, amount, advance_id, category FROM expenses WHERE id = ?', [expenseId]); if (!c) return;
  if (decision !== 'approved') { if (c.kind === 'settlement' && c.advance_id) closeIfSettled(app, c.advance_id); return; }
  if (app.db.get("SELECT 1 AS x FROM expense_ledger WHERE expense_id = ? AND type IN ('claim_approved', 'settlement_approved')", [c.id])) return;
  if (c.kind === 'reimbursement') post(app, actor, c, 'claim_approved', c.amount, { note: c.category });
  if (c.kind === 'vendor') post(app, actor, c, 'vendor_bill', c.amount, { note: c.category });
  if (c.kind === 'settlement' && c.advance_id) { post(app, actor, { id: c.advance_id, employee_id: c.employee_id }, 'settlement_approved', c.amount, { note: `${c.category} · ${c.id}` }); closeIfSettled(app, c.advance_id); }
  const name = app.db.get<{ n: string }>('SELECT full_name AS n FROM employees WHERE id = ?', [c.employee_id])?.n || '';
  const st = c.kind === 'settlement' && c.advance_id ? advanceState(app, c.advance_id) : null;
  const vendor = c.kind === 'vendor' ? app.db.get<{ v: string }>('SELECT vendor_name AS v FROM expenses WHERE id = ?', [c.id])?.v || 'the vendor' : '';
  const what = c.kind === 'vendor' ? `To pay: ${inr(c.amount)} to ${vendor}` : c.kind === 'advance' ? `Advance to give: ${inr(c.amount)} to ${name}` : c.kind === 'reimbursement' ? `To pay: ${inr(c.amount)} to ${name}` : st && st.balance < -0.99 ? `To pay: ${inr(-st.balance)} to ${name} (spent above advance)` : st && st.balance > 0.99 ? `To collect: ${inr(st.balance)} from ${name} (unspent advance)` : `Advance settled by bills: ${name}`;
  for (const id of accountsPeople(app)) if (id !== actor.id) app.notify.send({ employeeId: id, title: what, body: `${c.category} · approved by ${actor.full_name}`, link: '/money/accounts', kind: 'info' });
}

// ---------- paying ----------
export interface PayInput { date?: string; mode?: string; ref?: string; note?: string; amount?: number | null; doc?: string; docName?: string }
function payDetails(input: PayInput): { date: string; mode: string; ref: string; note: string } {
  const today = localDateString(new Date()); const date = isDate(input.date) ? input.date : today;
  if (date > today) throw new HttpError(400, 'The payment date cannot be in the future.');
  const mode = PAY_MODES.includes(String(input.mode)) ? String(input.mode) : ''; if (!mode) throw new HttpError(400, 'Choose how it was paid.');
  const ref = String(input.ref || '').trim().slice(0, 80);
  if (mode !== 'Cash' && ref.length < 3) throw new HttpError(400, 'Enter the transaction or cheque number.');
  return { date, mode, ref, note: String(input.note || '').trim().slice(0, 300) };
}
/** Accounts pays an approved reimbursement, or hands over an approved advance. */
export function markPaid(app: App, actor: Employee, id: string, input: PayInput): Claim {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Payments are recorded by Accounts.');
  const c = getClaim(app, id); if (!c) throw new HttpError(404, 'That claim does not exist.');
  if (c.kind === 'settlement' || c.kind === 'petty') throw new HttpError(400, c.kind === 'petty' ? 'Petty cash is paid when it is entered.' : 'A settlement is closed from its advance.');
  if (c.status !== 'approved') throw new HttpError(400, c.status === 'paid' || c.status === 'settled' ? 'This has already been paid.' : 'This has not been approved yet.');
  if (c.kind !== 'advance' && !c.bills && !input.doc) throw new HttpError(400, 'There is no bill attached. Attach the bill before paying.');
  const d = payDetails(input);
  app.db.transaction(() => {
    // A claim approved before the ledger existed gets its "owed" line now, so the two sides balance.
    if (c.kind === 'reimbursement' && !app.db.get("SELECT 1 AS x FROM expense_ledger WHERE expense_id = ? AND type = 'claim_approved'", [id])) post(app, null, c, 'claim_approved', c.amount, { date: d.date, note: c.category });
    if (c.kind === 'vendor' && !app.db.get("SELECT 1 AS x FROM expense_ledger WHERE expense_id = ? AND type = 'vendor_bill'", [id])) post(app, null, c, 'vendor_bill', c.amount, { date: d.date, note: c.category });
    post(app, actor, c, c.kind === 'advance' ? 'advance_paid' : c.kind === 'vendor' ? 'vendor_paid' : 'claim_paid', c.amount, d);
    app.db.run("UPDATE expenses SET status = 'paid', paid_at = ?, paid_by = ?, pay_mode = ?, pay_ref = ? WHERE id = ?", [`${d.date}T06:30:00.000Z`, actor.id, d.mode, d.ref, id]);
    audit(app.db, { entity: 'expense', entityId: id, action: 'paid', actorId: actor.id, after: { amount: c.amount, mode: d.mode, ref: d.ref, date: d.date } });
  });
  if (input.doc) addDoc(app, actor, id, 'payment', input.doc, input.docName || 'payment.jpg');
  if (c.employee_id !== actor.id && c.kind !== 'vendor') app.notify.send({ employeeId: c.employee_id, title: c.kind === 'advance' ? `Advance given: ${inr(c.amount)}` : `Paid: ${inr(c.amount)} for ${c.category}`, body: `${d.mode}${d.ref ? ` · ${d.ref}` : ''}${c.kind === 'advance' ? '. Submit the bills against it when the work is done.' : ''}`, link: `/money/${id}`, kind: 'success' });
  return getClaim(app, id)!;
}
/** Closing an advance: the person hands back what was not spent, or is paid what they spent above it. */
export function settleAdvance(app: App, actor: Employee, advanceId: string, input: PayInput): Claim {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Payments are recorded by Accounts.');
  const c = getClaim(app, advanceId); if (!c || c.kind !== 'advance') throw new HttpError(404, 'That advance does not exist.');
  if (c.status !== 'paid') throw new HttpError(400, c.status === 'settled' ? 'This advance is already settled.' : 'This advance has not been given yet.');
  const st = advanceState(app, advanceId);
  if (st.pendingBills) throw new HttpError(400, 'Bills against this advance are still waiting for approval.');
  if (Math.abs(st.balance) < 1) { closeIfSettled(app, advanceId); return getClaim(app, advanceId)!; }
  const d = payDetails(input); const owed = st.balance > 0;
  const amount = owed && input.amount ? Number(input.amount) : Math.abs(st.balance);
  if (!(amount > 0) || amount > Math.abs(st.balance) + 0.5) throw new HttpError(400, `The amount cannot be more than ${inr(Math.abs(st.balance))}.`);
  app.db.transaction(() => {
    post(app, actor, c, owed ? 'advance_returned' : 'excess_paid', amount, d);
    audit(app.db, { entity: 'expense', entityId: advanceId, action: owed ? 'advance_returned' : 'excess_paid', actorId: actor.id, after: { amount, mode: d.mode, ref: d.ref } });
    closeIfSettled(app, advanceId);
  });
  if (input.doc) addDoc(app, actor, advanceId, 'payment', input.doc, input.docName || 'payment.jpg');
  if (c.employee_id !== actor.id) app.notify.send({ employeeId: c.employee_id, title: owed ? `Received back: ${inr(amount)} of your advance` : `Paid: ${inr(amount)} spent above your advance`, body: `${d.mode}${d.ref ? ` · ${d.ref}` : ''}`, link: `/money/${advanceId}`, kind: 'success' });
  return getClaim(app, advanceId)!;
}

// ---------- lists ----------
export function myClaims(app: App, employeeId: string): Claim[] { return app.db.all<Claim>(`${SELECT} WHERE x.employee_id = ? AND x.kind IN ('reimbursement', 'advance', 'settlement') ORDER BY x.created_at DESC LIMIT 200`, [employeeId]); }
export function settlementsOf(app: App, advanceId: string): Claim[] { return app.db.all<Claim>(`${SELECT} WHERE x.kind = 'settlement' AND x.advance_id = ? ORDER BY x.created_at`, [advanceId]); }
export function entriesOf(app: App, expenseId: string): Entry[] { return ledger(app, { party: 'all' }).filter((e) => e.expense_id === expenseId); }
export interface AccountsDesk { toPay: Claim[]; advances: (Claim & { state: AdvanceState; days: number })[]; waiting: Claim[]; paid: Claim[]; totals: { toPay: number; advancesOut: number; toCollect: number; paidThisMonth: number; noBill: number } }
export function accountsDesk(app: App, now = new Date()): AccountsDesk {
  const toPay = app.db.all<Claim>(`${SELECT} WHERE x.status = 'approved' AND x.kind IN ('reimbursement', 'advance', 'vendor') ORDER BY t.decided_at, x.created_at`);
  const advances = openAdvances(app);
  const waiting = app.db.all<Claim>(`${SELECT} WHERE x.status = 'pending' ORDER BY x.created_at LIMIT 100`);
  const paid = app.db.all<Claim>(`${SELECT} WHERE x.status IN ('paid', 'settled') AND x.paid_at IS NOT NULL ORDER BY x.paid_at DESC LIMIT 10`);
  const month = localDateString(now).slice(0, 7);
  const paidThisMonth = app.db.get<{ v: number }>("SELECT COALESCE(SUM(debit), 0) AS v FROM expense_ledger WHERE debit > 0 AND substr(entry_date, 1, 7) = ?", [month])!.v;
  return { toPay, advances, waiting, paid, totals: { toPay: toPay.reduce((n, c) => n + c.amount, 0) + advances.filter((a) => a.state.balance < -0.99 && !a.state.pendingBills).reduce((n, a) => n - a.state.balance, 0),
    advancesOut: advances.reduce((n, a) => n + Math.max(0, a.state.balance), 0), toCollect: advances.filter((a) => a.state.billed > 0 && a.state.balance > 0.99 && !a.state.pendingBills).reduce((n, a) => n + a.state.balance, 0), paidThisMonth, noBill: toPay.filter((c) => c.kind !== 'advance' && !c.bills).length } };
}

/** What a claim's status means in words, for the person reading it. */
export function statusText(c: { kind: Kind; status: string }): { text: string; tone: 'ink' | 'accent' | 'good' | 'warn' | 'crit' } {
  if (c.status === 'pending') return { text: 'Waiting for approval', tone: 'warn' };
  if (c.status === 'declined') return { text: 'Declined', tone: 'crit' };
  if (c.kind === 'settlement') return { text: 'Accepted against the advance', tone: 'good' };
  if (c.kind === 'petty') return { text: 'Paid from petty cash', tone: 'good' };
  if (c.status === 'approved') return { text: c.kind === 'advance' ? 'Approved, Accounts to give' : 'Approved, Accounts to pay', tone: 'accent' };
  if (c.status === 'settled') return { text: 'Settled', tone: 'good' };
  if (c.status === 'paid') return c.kind === 'advance' ? { text: 'Given, bills to come', tone: 'accent' } : { text: 'Paid', tone: 'good' };
  return { text: c.status, tone: 'ink' };
}


// ---------- spending limits (optional: nothing is flagged until a limit is set) ----------
export function limits(app: App): Map<string, number> { return new Map(app.db.all<{ category: string; per_claim: number }>('SELECT category, per_claim FROM expense_limits').map((r) => [r.category, r.per_claim])); }
export function limitFor(app: App, category: string): number | null { return app.db.get<{ v: number }>('SELECT per_claim AS v FROM expense_limits WHERE category = ?', [category])?.v ?? null; }
/** One limit per category for a single claim. A claim above it still goes for approval, but the approver is told. Blank removes the limit. */
export function saveLimits(app: App, actor: Employee, values: Record<string, unknown>): number {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Limits are set by Accounts or an executive.');
  let n = 0; const now = new Date().toISOString();
  app.db.transaction(() => { for (const [cat, raw] of Object.entries(values)) {
    const category = cat.trim().slice(0, 60); if (!category) continue;
    if (raw === '' || raw == null) { n += Number(app.db.run('DELETE FROM expense_limits WHERE category = ?', [category]).changes || 0); continue; }
    const v = Number(raw); if (!(v > 0)) throw new HttpError(400, `The limit for ${category} must be an amount above zero, or blank for no limit.`);
    if (limitFor(app, category) === v) continue;
    app.db.run('INSERT INTO expense_limits (category, per_claim, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET per_claim = excluded.per_claim, updated_by = excluded.updated_by, updated_at = excluded.updated_at', [category, round2(v), actor.id, now]); n++;
  } });
  if (n) audit(app.db, { entity: 'expense_limits', entityId: 'all', action: 'update', actorId: actor.id, after: values as Record<string, unknown> });
  return n;
}

// ---------- settings ----------
const setting = (app: App, key: string, fallback: number): number => { const v = Number(app.db.get<{ value: string }>('SELECT value FROM money_settings WHERE key = ?', [key])?.value); return Number.isFinite(v) && v > 0 ? v : fallback; };
export function moneySettings(app: App): { advanceDays: number; pettyCap: number } { return { advanceDays: setting(app, 'advance_days', 15), pettyCap: setting(app, 'petty_cap', 2000) }; }
export function saveMoneySettings(app: App, actor: Employee, input: { advanceDays?: unknown; pettyCap?: unknown }): void {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'These are set by Accounts or an executive.');
  const put = (key: string, raw: unknown, min: number, max: number, label: string): void => { if (raw === undefined || raw === '' || raw === null) return; const v = Math.round(Number(raw)); if (!(v >= min && v <= max)) throw new HttpError(400, `${label} must be between ${min} and ${max}.`); app.db.run('INSERT INTO money_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, String(v)]); };
  put('advance_days', input.advanceDays, 3, 120, 'Days before an advance reminder'); put('petty_cap', input.pettyCap, 100, 100000, 'The most for one petty-cash payment');
  audit(app.db, { entity: 'money_settings', entityId: 'all', action: 'update', actorId: actor.id, after: input as Record<string, unknown> });
}

// ---------- reminders for advances left open ----------
/** Once an advance has been open for the set number of days, the person and their manager are reminded, and again every seven days. */
export function advanceReminders(app: App, now = new Date()): number {
  const { advanceDays } = moneySettings(app); let n = 0;
  for (const a of openAdvances(app)) {
    const row = app.db.get<{ reminded_at: string | null }>('SELECT reminded_at FROM expenses WHERE id = ?', [a.id])!;
    if (a.days < advanceDays || a.state.pendingBills || Math.abs(a.state.balance) < 1) continue;
    if (row.reminded_at && now.getTime() - new Date(row.reminded_at).getTime() < 7 * 86_400_000) continue;
    const owes = a.state.balance > 0; const text = owes ? `${inr(a.state.balance)} of the ${inr(a.amount)} advance (${a.category}) given ${a.days} days ago is not yet accounted for.` : `${inr(-a.state.balance)} spent above the advance is waiting with Accounts.`;
    if (owes) app.notify.send({ employeeId: a.employee_id, title: `Settle your advance ${a.id}`, body: `${text} Submit the bills, or return what was not spent.`, link: `/money/${a.id}`, kind: 'warn' });
    const mgr = app.db.get<{ m: string | null }>('SELECT reporting_manager_id AS m FROM employees WHERE id = ?', [a.employee_id])?.m;
    if (owes && mgr && mgr !== a.employee_id) app.notify.send({ employeeId: mgr, title: `Advance not settled: ${a.employee_name}`, body: text, link: `/money/${a.id}`, kind: 'warn' });
    if (!owes) for (const id of accountsPeople(app)) app.notify.send({ employeeId: id, title: `Pay the difference on advance ${a.id}`, body: `${a.employee_name}: ${text}`, link: '/money/accounts', kind: 'warn' });
    app.db.run('UPDATE expenses SET reminded_at = ? WHERE id = ?', [now.toISOString(), a.id]); n++;
  }
  return n;
}

// ---------- vendor bills ----------
export interface VendorBill extends NewClaim { billDate?: string }
/** A supplier's bill entered by Accounts. It is approved by amount like any expense, then paid and recorded here. */
export function addVendorBill(app: App, actor: Employee, input: VendorBill): Claim {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Vendor bills are entered by Accounts.');
  const amount = Number(input.amount); if (!(amount > 0)) throw new HttpError(400, 'Enter the bill amount.');
  const b = billDetails(input, amount); if (b.vendor.length < 2) throw new HttpError(400, 'Enter the vendor\'s name.');
  const description = String(input.description || '').trim().slice(0, 1000); if (description.length < 3) throw new HttpError(400, 'Say what the bill is for.');
  const today = localDateString(new Date()); const date = isDate(input.billDate) && input.billDate <= today ? input.billDate : today;
  const category = String(input.category || '').trim() || 'Other';
  const dept = input.departmentId && app.db.get('SELECT 1 AS x FROM departments WHERE id = ?', [input.departmentId]) ? input.departmentId : actor.department_id;
  const id = app.db.nextId('E');
  app.db.transaction(() => {
    app.db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, department_id, vendor_name, vendor_gstin, bill_no, gst_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, actor.id, category, round2(amount), description, 'pending', new Date().toISOString(), 'vendor', date, dept, b.vendor, b.gstin, b.billNo, b.gst]);
    const task = requestApproval(app, actor, 'expense', amount, `Vendor bill: ${inr(amount)} ${b.vendor} · ${category}`, description, { expenseId: id }, `/money/${id}`);
    app.db.run('UPDATE expenses SET task_id = ? WHERE id = ?', [task.id, id]);
  });
  if (input.doc) addDoc(app, actor, id, 'bill', input.doc, input.docName || 'bill.jpg');
  return getClaim(app, id)!;
}

// ---------- petty cash ----------
export function pettyBalance(app: App): number { return round2(app.db.get<{ b: number }>("SELECT COALESCE(SUM(debit - credit), 0) AS b FROM expense_ledger WHERE party = 'petty'")!.b); }
/** Cash put into the petty-cash box. */
export function pettyTopUp(app: App, actor: Employee, input: PayInput): number {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Petty cash is kept by Accounts.');
  const amount = Number(input.amount); if (!(amount > 0)) throw new HttpError(400, 'Enter the amount added.');
  const today = localDateString(new Date()); const date = isDate(input.date) ? input.date : today; if (date > today) throw new HttpError(400, 'The date cannot be in the future.');
  const mode = ['Cash withdrawn from bank', 'Cheque', 'Bank transfer'].includes(String(input.mode)) ? String(input.mode) : 'Cash withdrawn from bank';
  post(app, actor, { id: null, employee_id: actor.id }, 'petty_topup', amount, { date, mode, ref: String(input.ref || '').trim().slice(0, 80), note: String(input.note || '').trim().slice(0, 300) });
  audit(app.db, { entity: 'petty_cash', entityId: date, action: 'topup', actorId: actor.id, after: { amount } });
  return pettyBalance(app);
}
/** A small payment made from the box. It is paid as it is entered, so there is no approval step; the cap keeps it small. */
export function pettySpend(app: App, actor: Employee, input: VendorBill): Claim {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'Petty cash is kept by Accounts.');
  const amount = Number(input.amount); if (!(amount > 0)) throw new HttpError(400, 'Enter the amount paid.');
  const { pettyCap } = moneySettings(app); if (amount > pettyCap) throw new HttpError(400, `One petty-cash payment can be at most ${inr(pettyCap)}. Enter anything larger as a vendor bill or a claim.`);
  const bal = pettyBalance(app); if (amount > bal + 0.5) throw new HttpError(400, `There is only ${inr(bal)} in petty cash. Add cash first.`);
  const description = String(input.description || '').trim().slice(0, 1000); if (description.length < 3) throw new HttpError(400, 'Say what it was paid for.');
  const b = billDetails(input, amount); const today = localDateString(new Date()); const date = isDate(input.billDate) && input.billDate <= today ? input.billDate : today;
  const category = String(input.category || '').trim() || 'Other';
  const dept = input.departmentId && app.db.get('SELECT 1 AS x FROM departments WHERE id = ?', [input.departmentId]) ? input.departmentId : actor.department_id;
  const id = app.db.nextId('E');
  app.db.transaction(() => {
    app.db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, department_id, vendor_name, vendor_gstin, bill_no, gst_amount, paid_at, paid_by, pay_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, actor.id, category, round2(amount), description, 'paid', new Date().toISOString(), 'petty', date, dept, b.vendor, b.gstin, b.billNo, b.gst, `${date}T06:30:00.000Z`, actor.id, 'Petty cash']);
    post(app, actor, { id, employee_id: actor.id }, 'petty_spend', amount, { date, mode: 'Petty cash', note: category });
    audit(app.db, { entity: 'expense', entityId: id, action: 'petty', actorId: actor.id, after: { amount, category } });
  });
  if (input.doc) addDoc(app, actor, id, 'bill', input.doc, input.docName || 'bill.jpg');
  return getClaim(app, id)!;
}
export function pettyRecent(app: App): Entry[] { return ledger(app, { party: 'petty' }).reverse().slice(0, 12); }

// ---------- closing a month ----------
export interface MonthRow { month: string; lines: number; cashOut: number; booked: number; closed_at: string | null; closed_by_name: string | null; posted_at: string | null; canClose: boolean; unpaid: number }
/** The last six months with what moved in each, and whether Accounts has closed it. */
export function months(app: App, now = new Date()): MonthRow[] {
  const cur = localDateString(now).slice(0, 7); const out: MonthRow[] = []; let y = Number(cur.slice(0, 4)), m = Number(cur.slice(5, 7));
  for (let i = 0; i < 6; i++) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    const t = app.db.get<{ n: number; d: number; b: number }>("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN type IN ('claim_paid', 'advance_paid', 'excess_paid', 'vendor_paid', 'petty_spend') THEN debit + CASE WHEN type = 'petty_spend' THEN credit ELSE 0 END ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN type = 'advance_returned' THEN credit ELSE 0 END), 0) AS d, COALESCE(SUM(CASE WHEN type IN ('claim_approved', 'settlement_approved', 'vendor_bill', 'petty_spend') THEN credit ELSE 0 END), 0) AS b FROM expense_ledger WHERE substr(entry_date, 1, 7) = ?", [month])!;
    const row = app.db.get<{ closed_at: string | null; posted_at: string | null; n: string | null }>('SELECT lm.closed_at, lm.posted_at, e.full_name AS n FROM ledger_months lm LEFT JOIN employees e ON e.id = lm.closed_by WHERE lm.month = ?', [month]);
    const unpaid = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expenses x LEFT JOIN tasks t ON t.id = x.task_id WHERE x.status = 'approved' AND x.kind IN ('reimbursement', 'vendor') AND substr(date(COALESCE(t.decided_at, x.created_at), '+330 minutes'), 1, 7) = ?", [month])!.n;
    out.push({ month, lines: t.n, cashOut: round2(t.d), booked: round2(t.b), closed_at: row?.closed_at || null, closed_by_name: row?.n || null, posted_at: row?.posted_at || null, canClose: month < cur && !row?.closed_at, unpaid });
    m--; if (m < 1) { m = 12; y--; }
  }
  return out;
}
/** After this, no line can be dated in that month. Only an executive or administrator can reopen it. */
export function closeMonth(app: App, actor: Employee, month: string): void {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'A month is closed by Accounts.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Choose a month.');
  if (month >= localDateString(new Date()).slice(0, 7)) throw new HttpError(400, 'A month can be closed only after it has ended.');
  if (isClosed(app, `${month}-01`)) return;
  app.db.run('INSERT INTO ledger_months (month, closed_at, closed_by) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET closed_at = excluded.closed_at, closed_by = excluded.closed_by', [month, new Date().toISOString(), actor.id]);
  audit(app.db, { entity: 'ledger_month', entityId: month, action: 'close', actorId: actor.id });
}
export function reopenMonth(app: App, actor: Employee, month: string): void {
  if (!actor.is_admin && actor.functional_role !== 'executive') throw new HttpError(403, 'Only an executive or an administrator can reopen a closed month.');
  app.db.run('UPDATE ledger_months SET closed_at = NULL, closed_by = NULL WHERE month = ?', [month]);
  audit(app.db, { entity: 'ledger_month', entityId: month, action: 'reopen', actorId: actor.id });
}
export function markPosted(app: App, actor: Employee, month: string, on: boolean): void {
  if (!isAccounts(app, actor)) throw new HttpError(403, 'This is recorded by Accounts.');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Choose a month.');
  app.db.run('INSERT INTO ledger_months (month, posted_at, posted_by) VALUES (?, ?, ?) ON CONFLICT(month) DO UPDATE SET posted_at = excluded.posted_at, posted_by = excluded.posted_by', [month, on ? new Date().toISOString() : null, on ? actor.id : null]);
  audit(app.db, { entity: 'ledger_month', entityId: month, action: on ? 'posted_to_books' : 'unposted', actorId: actor.id });
}

// ---------- a month's expenses as a file for Zoho Books ----------
/** One row per expense booked in the month, in the columns Zoho Books' expense import asks for. Advances are not expenses and are left out. */
export function booksExport(app: App, month: string): { columns: string[]; rows: (string | number)[][] } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Choose a month.');
  const rows = app.db.all<{ entry_date: string; type: string; credit: number; id: string; kind: string; category: string; description: string; vendor_name: string; vendor_gstin: string; bill_no: string; gst_amount: number | null; pay_mode: string; pay_ref: string; amount: number; who: string; team: string }>(`SELECT l.entry_date, l.type, l.credit, COALESCE(s.id, x.id) AS id, COALESCE(s.kind, x.kind) AS kind, COALESCE(s.category, x.category) AS category, COALESCE(s.description, x.description) AS description,
      COALESCE(s.vendor_name, x.vendor_name) AS vendor_name, COALESCE(s.vendor_gstin, x.vendor_gstin) AS vendor_gstin, COALESCE(s.bill_no, x.bill_no) AS bill_no, COALESCE(s.gst_amount, x.gst_amount) AS gst_amount, x.pay_mode, x.pay_ref, COALESCE(s.amount, x.amount) AS amount, e.full_name AS who, COALESCE((SELECT name FROM departments WHERE id = x.department_id), d.name) AS team
    FROM expense_ledger l JOIN expenses x ON x.id = l.expense_id JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id
      LEFT JOIN expenses s ON l.type = 'settlement_approved' AND s.kind = 'settlement' AND s.advance_id = x.id AND l.note LIKE '%' || s.id
    WHERE l.type IN ('claim_approved', 'settlement_approved', 'vendor_bill', 'petty_spend') AND substr(l.entry_date, 1, 7) = ? ORDER BY l.entry_date, l.id`, [month]);
  const paidThrough = (r: { kind: string; pay_mode: string }): string => (r.kind === 'petty' ? 'Petty Cash' : r.kind === 'settlement' ? 'Employee Advance' : r.pay_mode || 'Employee Reimbursements');
  return { columns: ['Expense Date', 'Expense Account', 'Expense Amount', 'Tax Amount', 'Paid Through', 'Vendor', 'GST Identification Number (GSTIN)', 'Invoice Number', 'Reference#', 'Expense Description', 'Employee', 'Department', 'Currency Code'],
    rows: rows.map((r) => [r.entry_date, r.category, round2(r.credit), r.gst_amount ?? '', paidThrough(r), r.vendor_name, r.vendor_gstin, r.bill_no, r.id, r.description, r.kind === 'vendor' || r.kind === 'petty' ? '' : r.who, r.team, 'INR']) };
}
