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

export type Kind = 'reimbursement' | 'advance' | 'settlement';
export const KIND_LABEL: Record<Kind, string> = { reimbursement: 'Reimbursement', advance: 'Advance', settlement: 'Advance settlement' };
export const PAY_MODES = ['Bank transfer', 'UPI', 'Cash', 'Cheque'];
export type EntryType = 'claim_approved' | 'claim_paid' | 'advance_paid' | 'settlement_approved' | 'advance_returned' | 'excess_paid';
export const ENTRY_LABEL: Record<EntryType, string> = { claim_approved: 'Expense approved', claim_paid: 'Reimbursement paid', advance_paid: 'Advance given', settlement_approved: 'Bills accepted against advance', advance_returned: 'Unspent advance returned', excess_paid: 'Spent above advance, paid' };

export interface Claim {
  id: string; employee_id: string; employee_name: string; team: string; department_id: string; kind: Kind; category: string; amount: number; description: string;
  status: string; task_id: string | null; created_at: string; expense_date: string | null; advance_id: string | null;
  paid_at: string | null; paid_by: string | null; paid_by_name: string | null; pay_mode: string; pay_ref: string; settled_at: string | null; docs: number; bills: number; approver_name: string | null; decided_at: string | null;
}
export interface Doc { id: number; expense_id: string; kind: string; file_name: string; size: number; uploaded_by: string | null; uploaded_by_name: string | null; uploaded_at: string }
export interface Entry { id: number; employee_id: string; employee_name: string; team: string; expense_id: string | null; entry_date: string; type: EntryType; debit: number; credit: number; mode: string; ref: string; note: string; category: string | null; created_by_name: string | null; balance?: number }

const SELECT = `SELECT x.*, e.full_name AS employee_name, d.name AS team, e.department_id, pb.full_name AS paid_by_name, ap.full_name AS approver_name, t.decided_at,
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
  if (scopeFor(app.db, viewer).people.has(c.employee_id)) return true;
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
function post(app: App, actor: Employee | null, c: { id: string; employee_id: string }, type: EntryType, amount: number, o: { date?: string; mode?: string; ref?: string; note?: string } = {}): void {
  const debit = type === 'claim_paid' || type === 'advance_paid' || type === 'excess_paid' ? round2(amount) : 0; const credit = debit ? 0 : round2(amount);
  app.db.run('INSERT INTO expense_ledger (employee_id, expense_id, entry_date, type, debit, credit, mode, ref, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [c.employee_id, c.id, o.date || localDateString(new Date()), type, debit, credit, o.mode || '', o.ref || '', o.note || '', actor?.id || null, new Date().toISOString()]);
}
/** Ledger lines, oldest first, each with the person's running balance. Positive: the person holds company money. Negative: the company owes the person. */
export function ledger(app: App, f: { employeeId?: string; people?: Set<string> | null; from?: string; to?: string } = {}): Entry[] {
  const where: string[] = []; const p: Params = [];
  if (f.employeeId) { where.push('l.employee_id = ?'); p.push(f.employeeId); }
  const rows = app.db.all<Entry>(`SELECT l.id, l.employee_id, e.full_name AS employee_name, d.name AS team, l.expense_id, l.entry_date, l.type, l.debit, l.credit, l.mode, l.ref, l.note, x.category, cb.full_name AS created_by_name
    FROM expense_ledger l JOIN employees e ON e.id = l.employee_id JOIN departments d ON d.id = e.department_id LEFT JOIN expenses x ON x.id = l.expense_id LEFT JOIN employees cb ON cb.id = l.created_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY l.entry_date, l.id`, p).filter((r) => !f.people || f.people.has(r.employee_id));
  const bal = new Map<string, number>();
  for (const r of rows) { const b = round2((bal.get(r.employee_id) || 0) + r.debit - r.credit); bal.set(r.employee_id, b); r.balance = b; }
  return rows.filter((r) => (!f.from || r.entry_date >= f.from) && (!f.to || r.entry_date <= f.to));
}
export function balanceOf(app: App, employeeId: string): number { return round2(app.db.get<{ b: number }>('SELECT COALESCE(SUM(debit - credit), 0) AS b FROM expense_ledger WHERE employee_id = ?', [employeeId])!.b); }
export function balances(app: App): { id: string; name: string; team: string; balance: number }[] {
  return app.db.all<{ id: string; name: string; team: string; balance: number }>(`SELECT e.id, e.full_name AS name, d.name AS team, ROUND(SUM(l.debit - l.credit), 2) AS balance FROM expense_ledger l JOIN employees e ON e.id = l.employee_id JOIN departments d ON d.id = e.department_id GROUP BY e.id HAVING ABS(SUM(l.debit - l.credit)) >= 1 ORDER BY balance DESC`);
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
export interface NewClaim { kind?: string; category?: string; amount?: number | null; description?: string; expenseDate?: string; advanceId?: string; dealId?: string; km?: number | null; doc?: string; docName?: string }
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
  const id = app.db.nextId('E');
  const title = `${kind === 'advance' ? 'Advance' : kind === 'settlement' ? 'Advance settlement' : 'Expense'}: ${inr(amount)} ${category} for ${requester.full_name}`;
  app.db.transaction(() => {
    app.db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, advance_id, deal_id, km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, requester.id, category, round2(amount), description, 'pending', new Date().toISOString(), kind, date, advanceId, input.dealId || null, input.km ?? null]);
    const task = requestApproval(app, requester, 'expense', amount, title, description, { expenseId: id }, `/money/${id}`);
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
  if (c.kind === 'settlement' && c.advance_id) { post(app, actor, { id: c.advance_id, employee_id: c.employee_id }, 'settlement_approved', c.amount, { note: `${c.category} · ${c.id}` }); closeIfSettled(app, c.advance_id); }
  const name = app.db.get<{ n: string }>('SELECT full_name AS n FROM employees WHERE id = ?', [c.employee_id])?.n || '';
  const st = c.kind === 'settlement' && c.advance_id ? advanceState(app, c.advance_id) : null;
  const what = c.kind === 'advance' ? `Advance to give: ${inr(c.amount)} to ${name}` : c.kind === 'reimbursement' ? `To pay: ${inr(c.amount)} to ${name}` : st && st.balance < -0.99 ? `To pay: ${inr(-st.balance)} to ${name} (spent above advance)` : st && st.balance > 0.99 ? `To collect: ${inr(st.balance)} from ${name} (unspent advance)` : `Advance settled by bills: ${name}`;
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
  if (c.kind === 'settlement') throw new HttpError(400, 'A settlement is closed from its advance.');
  if (c.status !== 'approved') throw new HttpError(400, c.status === 'paid' || c.status === 'settled' ? 'This has already been paid.' : 'This has not been approved yet.');
  if (c.kind === 'reimbursement' && !c.bills && !input.doc) throw new HttpError(400, 'There is no bill attached. Attach the bill before paying.');
  const d = payDetails(input);
  app.db.transaction(() => {
    // A claim approved before the ledger existed gets its "owed" line now, so the two sides balance.
    if (c.kind === 'reimbursement' && !app.db.get("SELECT 1 AS x FROM expense_ledger WHERE expense_id = ? AND type = 'claim_approved'", [id])) post(app, null, c, 'claim_approved', c.amount, { date: (c.decided_at || c.created_at).slice(0, 10), note: c.category });
    post(app, actor, c, c.kind === 'advance' ? 'advance_paid' : 'claim_paid', c.amount, d);
    app.db.run("UPDATE expenses SET status = 'paid', paid_at = ?, paid_by = ?, pay_mode = ?, pay_ref = ? WHERE id = ?", [`${d.date}T06:30:00.000Z`, actor.id, d.mode, d.ref, id]);
    audit(app.db, { entity: 'expense', entityId: id, action: 'paid', actorId: actor.id, after: { amount: c.amount, mode: d.mode, ref: d.ref, date: d.date } });
  });
  if (input.doc) addDoc(app, actor, id, 'payment', input.doc, input.docName || 'payment.jpg');
  if (c.employee_id !== actor.id) app.notify.send({ employeeId: c.employee_id, title: c.kind === 'advance' ? `Advance given: ${inr(c.amount)}` : `Paid: ${inr(c.amount)} for ${c.category}`, body: `${d.mode}${d.ref ? ` · ${d.ref}` : ''}${c.kind === 'advance' ? '. Submit the bills against it when the work is done.' : ''}`, link: `/money/${id}`, kind: 'success' });
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
export function myClaims(app: App, employeeId: string): Claim[] { return app.db.all<Claim>(`${SELECT} WHERE x.employee_id = ? ORDER BY x.created_at DESC LIMIT 200`, [employeeId]); }
export function settlementsOf(app: App, advanceId: string): Claim[] { return app.db.all<Claim>(`${SELECT} WHERE x.kind = 'settlement' AND x.advance_id = ? ORDER BY x.created_at`, [advanceId]); }
export function entriesOf(app: App, expenseId: string): Entry[] { return ledger(app).filter((e) => e.expense_id === expenseId); }
export interface AccountsDesk { toPay: Claim[]; advances: (Claim & { state: AdvanceState; days: number })[]; waiting: Claim[]; paid: Claim[]; totals: { toPay: number; advancesOut: number; toCollect: number; paidThisMonth: number; noBill: number } }
export function accountsDesk(app: App, now = new Date()): AccountsDesk {
  const toPay = app.db.all<Claim>(`${SELECT} WHERE x.status = 'approved' AND x.kind IN ('reimbursement', 'advance') ORDER BY t.decided_at, x.created_at`);
  const advances = openAdvances(app);
  const waiting = app.db.all<Claim>(`${SELECT} WHERE x.status = 'pending' ORDER BY x.created_at LIMIT 100`);
  const paid = app.db.all<Claim>(`${SELECT} WHERE x.status IN ('paid', 'settled') AND x.paid_at IS NOT NULL ORDER BY x.paid_at DESC LIMIT 10`);
  const month = localDateString(now).slice(0, 7);
  const paidThisMonth = app.db.get<{ v: number }>("SELECT COALESCE(SUM(debit), 0) AS v FROM expense_ledger WHERE debit > 0 AND substr(entry_date, 1, 7) = ?", [month])!.v;
  return { toPay, advances, waiting, paid, totals: { toPay: toPay.reduce((n, c) => n + c.amount, 0) + advances.filter((a) => a.state.balance < -0.99 && !a.state.pendingBills).reduce((n, a) => n - a.state.balance, 0),
    advancesOut: advances.reduce((n, a) => n + Math.max(0, a.state.balance), 0), toCollect: advances.filter((a) => a.state.billed > 0 && a.state.balance > 0.99 && !a.state.pendingBills).reduce((n, a) => n + a.state.balance, 0), paidThisMonth, noBill: toPay.filter((c) => c.kind === 'reimbursement' && !c.bills).length } };
}

/** What a claim's status means in words, for the person reading it. */
export function statusText(c: { kind: Kind; status: string }): { text: string; tone: 'ink' | 'accent' | 'good' | 'warn' | 'crit' } {
  if (c.status === 'pending') return { text: 'Waiting for approval', tone: 'warn' };
  if (c.status === 'declined') return { text: 'Declined', tone: 'crit' };
  if (c.kind === 'settlement') return { text: 'Accepted against the advance', tone: 'good' };
  if (c.status === 'approved') return { text: c.kind === 'advance' ? 'Approved, Accounts to give' : 'Approved, Accounts to pay', tone: 'accent' };
  if (c.status === 'settled') return { text: 'Settled', tone: 'good' };
  if (c.status === 'paid') return c.kind === 'advance' ? { text: 'Given, bills to come', tone: 'accent' } : { text: 'Paid', tone: 'good' };
  return { text: c.status, tone: 'ink' };
}
