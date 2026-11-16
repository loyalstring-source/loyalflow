// Daily review (DSR). Each team has one sheet a day: the lead plans it in the morning, people update their own
// lines through the day, and the lead confirms and closes it in the evening. Unfinished lines move to the next working day.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { holidaySet } from '../../lib/settings.ts';
import { localDateString, parseLocalDate, addDays, toLocal } from '../../lib/time.ts';
import type { Employee } from '../people/model.ts';

export type DsrStyle = 'tasks' | 'collections' | 'support' | 'off';
export const STYLES: { value: DsrStyle; label: string; help: string }[] = [
  { value: 'tasks', label: 'Tasks for the day', help: 'The lead gives each person tasks in the morning; in the evening each is marked done, partly done, not done or blocked.' },
  { value: 'collections', label: 'Collections expected today', help: 'Each person lists the customers they expect payment from and the amount; in the evening the amount received is filled in.' },
  { value: 'support', label: 'Tickets and follow-ups', help: "Shows yesterday's new tickets, everything pending and implementations in progress, with follow-up tasks for each person." },
  { value: 'off', label: 'No daily review', help: 'This team does not hold one.' }
];
const DEFAULT_STYLE: Record<string, DsrStyle> = { SAL: 'collections', SUP: 'support' };
export type ItemStatus = 'planned' | 'done' | 'partial' | 'not_done' | 'blocked';
export const STATUS_LABEL: Record<ItemStatus, string> = { planned: 'Not reviewed', done: 'Done', partial: 'Partly done', not_done: 'Not done', blocked: 'Blocked' };
const REVIEWED: ItemStatus[] = ['done', 'partial', 'not_done', 'blocked'];
const UNFINISHED: ItemStatus[] = ['partial', 'not_done', 'blocked'];

export interface DsrDay { id: string; department_id: string; day: string; status: 'open' | 'closed'; notes: string; closed_at: string | null; closed_by: string | null; closed_by_name: string | null }
export interface DsrItem {
  id: string; department_id: string; day: string; employee_id: string; employee_name: string; kind: 'task' | 'collection'; title: string; customer: string; ref: string;
  planned_hours: number | null; amount_expected: number | null; self_status: string; self_pct: number | null; self_amount: number | null; self_note: string; self_at: string | null;
  status: ItemStatus; pct: number | null; amount_actual: number | null; remark: string; reviewed_by: string | null; reviewed_at: string | null;
  carry: '' | 'carry' | 'drop'; carried_from: string | null; carried_to: string | null; carry_count: number; created_by: string | null; created_at: string;
}
export interface Team { id: string; name: string; code: string; style: DsrStyle; lead: boolean; hodId: string | null }
interface Dept { id: string; name: string; code: string; hod_id: string | null }

const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseLocalDate(s).getTime());
const clean = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
function amount(v: unknown, what: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1e10) throw new HttpError(400, `${what} must be a number of zero or more.`);
  return Math.round(n * 100) / 100;
}
function percent(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, 'Percentage must be between 0 and 100.');
  return n;
}

// ---------- which teams, which style ----------
export function dsrStyles(app: App): Record<string, DsrStyle> {
  const saved: Record<string, DsrStyle> = {};
  const row = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'dsr'");
  if (row) { try { Object.assign(saved, (JSON.parse(row.value) as { styles?: Record<string, DsrStyle> }).styles || {}); } catch { /* keep defaults */ } }
  const out: Record<string, DsrStyle> = {};
  for (const d of app.db.all<Dept>('SELECT id, name, code, hod_id FROM departments')) out[d.id] = STYLES.some((s) => s.value === saved[d.id]) ? saved[d.id] : DEFAULT_STYLE[d.code] || 'tasks';
  return out;
}
export const styleOf = (app: App, deptId: string): DsrStyle => dsrStyles(app)[deptId] || 'off';
export const canConfigure = (u: Employee): boolean => !!u.is_admin || u.functional_role === 'executive';
export function saveStyles(app: App, actor: Employee, input: Record<string, unknown>): Record<string, DsrStyle> {
  if (!canConfigure(actor)) throw new HttpError(403, 'Only an administrator or an executive sets how each team runs its daily review.');
  const before = dsrStyles(app); const next = { ...before };
  for (const id of Object.keys(before)) { const v = String(input[id] ?? ''); if (STYLES.some((s) => s.value === v)) next[id] = v as DsrStyle; }
  app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', ['dsr', JSON.stringify({ styles: next }), new Date().toISOString(), actor.id]);
  audit(app.db, { entity: 'settings', entityId: 'dsr', action: 'update', before, after: next, actorId: actor.id });
  return next;
}
function dept(app: App, id: string): Dept { const d = app.db.get<Dept>('SELECT id, name, code, hod_id FROM departments WHERE id = ?', [id]); if (!d) throw new HttpError(404, 'Team not found'); return d; }
/** The person who runs this team's review: its head, a lead inside it, an executive or an administrator. */
export function canLead(app: App, u: Employee, deptId: string): boolean {
  if (u.is_admin || u.functional_role === 'executive') return true;
  const d = app.db.get<Dept>('SELECT id, name, code, hod_id FROM departments WHERE id = ?', [deptId]); if (!d) return false;
  return d.hod_id === u.id || (u.department_id === deptId && (u.functional_role === 'hod' || u.functional_role === 'team_lead'));
}
/** Teams this person can open: their own, any they lead, and every team for executives. */
export function teamsFor(app: App, u: Employee): Team[] {
  const styles = dsrStyles(app); const all = u.is_admin || u.functional_role === 'executive';
  return app.db.all<Dept>('SELECT id, name, code, hod_id FROM departments ORDER BY name').filter((d) => styles[d.id] !== 'off' && (all || d.id === u.department_id || d.hod_id === u.id))
    .map((d) => ({ id: d.id, name: d.name, code: d.code, style: styles[d.id], lead: canLead(app, u, d.id), hodId: d.hod_id }))
    .sort((a, b) => Number(b.id === u.department_id) - Number(a.id === u.department_id));
}
export function teamMembers(app: App, deptId: string): { id: string; full_name: string; designation: string }[] {
  return app.db.all<{ id: string; full_name: string; designation: string }>("SELECT id, full_name, designation FROM employees WHERE department_id = ? AND status = 'active' ORDER BY full_name", [deptId]);
}

// ---------- days ----------
export function today(now = new Date()): string { return localDateString(now); }
export function nextWorkingDay(app: App, day: string): string {
  const off = holidaySet(app.db); let d = parseLocalDate(day);
  for (let i = 0; i < 14; i++) { d = addDays(d, 1); const s = localDateString(d); if (toLocal(d).dow !== 7 && !off.has(s)) return s; }
  return localDateString(addDays(parseLocalDate(day), 1));
}
export function prevWorkingDay(app: App, day: string): string {
  const off = holidaySet(app.db); let d = parseLocalDate(day);
  for (let i = 0; i < 14; i++) { d = addDays(d, -1); const s = localDateString(d); if (toLocal(d).dow !== 7 && !off.has(s)) return s; }
  return localDateString(addDays(parseLocalDate(day), -1));
}
const DAY_SELECT = 'SELECT d.*, e.full_name AS closed_by_name FROM dsr_days d LEFT JOIN employees e ON e.id = d.closed_by';
export function getDay(app: App, deptId: string, day: string): DsrDay | undefined { return app.db.get<DsrDay>(`${DAY_SELECT} WHERE d.department_id = ? AND d.day = ?`, [deptId, day]); }
const isClosed = (app: App, deptId: string, day: string): boolean => getDay(app, deptId, day)?.status === 'closed';
function ensureDay(app: App, deptId: string, day: string): void {
  if (!getDay(app, deptId, day)) app.db.run("INSERT INTO dsr_days (id, department_id, day, status, created_at) VALUES (?, ?, ?, 'open', ?)", [app.db.nextId('DSR'), deptId, day, new Date().toISOString()]);
}

// ---------- lines ----------
const ITEM_SELECT = 'SELECT i.*, e.full_name AS employee_name FROM dsr_items i JOIN employees e ON e.id = i.employee_id';
export function listItems(app: App, deptId: string, day: string): DsrItem[] { return app.db.all<DsrItem>(`${ITEM_SELECT} WHERE i.department_id = ? AND i.day = ? ORDER BY e.full_name, i.created_at, i.id`, [deptId, day]); }
export function getItem(app: App, id: string): DsrItem | undefined { return app.db.get<DsrItem>(`${ITEM_SELECT} WHERE i.id = ?`, [id]); }
function requireOpenItem(app: App, id: string): DsrItem {
  const it = getItem(app, id); if (!it) throw new HttpError(404, 'That line is no longer there.');
  if (isClosed(app, it.department_id, it.day)) throw new HttpError(409, 'This day is closed. The team lead can reopen it.');
  return it;
}
/** My lines for a day, across teams (for the home page). */
export function myItems(app: App, employeeId: string, day: string): DsrItem[] { return app.db.all<DsrItem>(`${ITEM_SELECT} WHERE i.employee_id = ? AND i.day = ? ORDER BY i.created_at, i.id`, [employeeId, day]); }

/** Where a reference such as a board item, ticket or deal number leads. */
export function refTarget(app: App, ref: string): { href: string; title: string } | null {
  if (!ref) return null;
  const issue = app.db.get<{ title: string }>('SELECT title FROM dev_issues WHERE id = ?', [ref]); if (issue) return { href: `/dev/${ref}`, title: issue.title };
  const ticket = app.db.get<{ subject: string }>('SELECT subject FROM tickets WHERE id = ?', [ref]); if (ticket) return { href: `/tickets/${ref}`, title: ticket.subject };
  const deal = app.db.get<{ title: string }>('SELECT title FROM deals WHERE id = ?', [ref]); if (deal) return { href: `/deals/${ref}`, title: deal.title };
  return null;
}

export interface NewItem { deptId: string; day: string; employeeId: string; title?: unknown; customer?: unknown; ref?: unknown; plannedHours?: unknown; amountExpected?: unknown }
export function addItem(app: App, actor: Employee, input: NewItem): DsrItem {
  const d = dept(app, input.deptId); const style = styleOf(app, d.id);
  if (style === 'off') throw new HttpError(400, `${d.name} does not hold a daily review.`);
  if (!isDay(input.day)) throw new HttpError(400, 'Choose a valid day.');
  const lead = canLead(app, actor, d.id);
  if (!lead && input.employeeId !== actor.id) throw new HttpError(403, 'You can add lines to your own day. The team lead adds them for others.');
  const member = app.db.get<{ id: string; department_id: string; status: string }>('SELECT id, department_id, status FROM employees WHERE id = ?', [input.employeeId]);
  if (!member || member.department_id !== d.id || member.status !== 'active') throw new HttpError(400, `That person is not in ${d.name}.`);
  if (isClosed(app, d.id, input.day)) throw new HttpError(409, 'This day is closed. The team lead can reopen it.');
  if (!lead && input.day < today()) throw new HttpError(400, 'Only the team lead adds lines to a past day.');
  if (input.day > localDateString(addDays(new Date(), 31))) throw new HttpError(400, 'Plan at most a month ahead.');
  const kind = style === 'collections' ? 'collection' : 'task';
  const ref = clean(input.ref, 40); const target = refTarget(app, ref);
  if (ref && !target) throw new HttpError(400, `There is no board item, ticket or deal numbered ${ref}.`);
  let title = clean(input.title, 300); const customer = clean(input.customer, 160);
  const hours = amount(input.plannedHours, 'Planned hours'); const expected = amount(input.amountExpected, 'Expected amount');
  if (hours != null && hours > 24) throw new HttpError(400, 'Planned hours cannot be more than 24.');
  if (kind === 'collection') {
    if (!customer) throw new HttpError(400, 'Enter the customer the payment is expected from.');
    if (!expected) throw new HttpError(400, 'Enter the amount expected.');
  } else { if (!title && target) title = target.title; if (!title) throw new HttpError(400, 'Describe the task.'); }
  ensureDay(app, d.id, input.day);
  const id = app.db.nextId('DS'); const now = new Date().toISOString();
  app.db.run('INSERT INTO dsr_items (id, department_id, day, employee_id, kind, title, customer, ref, planned_hours, amount_expected, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, d.id, input.day, input.employeeId, kind, title, customer, ref, kind === 'task' ? hours : null, kind === 'collection' ? expected : null, actor.id, now, now]);
  audit(app.db, { entity: 'dsr_item', entityId: id, action: 'create', after: { day: input.day, employeeId: input.employeeId, title, customer, expected }, actorId: actor.id });
  if (input.employeeId !== actor.id && input.day >= today()) app.notify.send({ employeeId: input.employeeId, title: kind === 'collection' ? `Collection added to your day by ${actor.full_name}` : `New task for ${input.day === today() ? 'today' : input.day} from ${actor.full_name}`, body: kind === 'collection' ? `${customer}: ₹${Math.round(expected || 0).toLocaleString('en-IN')}` : title, link: `/dsr?team=${d.id}&day=${input.day}`, kind: 'info' });
  return getItem(app, id)!;
}

export function deleteItem(app: App, actor: Employee, id: string): void {
  const it = requireOpenItem(app, id);
  const own = it.created_by === actor.id && it.employee_id === actor.id && it.status === 'planned';
  if (!canLead(app, actor, it.department_id) && !own) throw new HttpError(403, 'Only the team lead removes a line someone else added or reviewed.');
  app.db.run('DELETE FROM dsr_items WHERE id = ?', [id]);
  if (it.carried_from) app.db.run('UPDATE dsr_items SET carried_to = NULL WHERE id = ?', [it.carried_from]);
  audit(app.db, { entity: 'dsr_item', entityId: id, action: 'delete', before: { day: it.day, employeeId: it.employee_id, title: it.title, customer: it.customer }, actorId: actor.id });
}

function collectionStatus(expected: number | null, got: number | null): ItemStatus { if (got == null) return 'planned'; if (got <= 0) return 'not_done'; return got >= (expected || 0) ? 'done' : 'partial'; }

/** A person reports on their own line. */
export function selfUpdate(app: App, actor: Employee, id: string, input: { status?: unknown; pct?: unknown; amount?: unknown; note?: unknown }): DsrItem {
  const it = requireOpenItem(app, id);
  if (it.employee_id !== actor.id) throw new HttpError(403, 'You can update your own lines. The team lead reviews the rest.');
  const note = clean(input.note, 500); let status = ''; let pct: number | null = null; let got: number | null = null;
  if (it.kind === 'collection') { got = amount(input.amount, 'Amount received'); const s = collectionStatus(it.amount_expected, got); status = s === 'planned' ? '' : s; }
  else {
    status = String(input.status ?? ''); if (status && !REVIEWED.includes(status as ItemStatus)) throw new HttpError(400, 'Choose done, partly done, not done or blocked.');
    pct = status === 'partial' ? percent(input.pct) : status === 'done' ? 100 : null;
    if (status === 'blocked' && !note) throw new HttpError(400, 'Say what is blocking this.');
  }
  app.db.run('UPDATE dsr_items SET self_status = ?, self_pct = ?, self_amount = ?, self_note = ?, self_at = ?, updated_at = ? WHERE id = ?', [status, pct, got, note, new Date().toISOString(), new Date().toISOString(), id]);
  return getItem(app, id)!;
}

/** The lead confirms a line. */
export function reviewItem(app: App, actor: Employee, id: string, input: { status?: unknown; pct?: unknown; amount?: unknown; remark?: unknown; carry?: unknown; title?: unknown; plannedHours?: unknown; amountExpected?: unknown }): DsrItem {
  const it = requireOpenItem(app, id);
  if (!canLead(app, actor, it.department_id)) throw new HttpError(403, 'Only the team lead reviews the day.');
  const remark = input.remark === undefined ? it.remark : clean(input.remark, 500);
  let status: ItemStatus = it.status; let pct = it.pct; let got = it.amount_actual;
  const expected = input.amountExpected === undefined ? it.amount_expected : amount(input.amountExpected, 'Expected amount');
  if (it.kind === 'collection') { if (input.amount !== undefined) got = amount(input.amount, 'Amount received'); status = collectionStatus(expected, got); pct = null; }
  else if (input.status !== undefined) {
    const s = String(input.status || 'planned'); if (s !== 'planned' && !REVIEWED.includes(s as ItemStatus)) throw new HttpError(400, 'Choose done, partly done, not done or blocked.');
    status = s as ItemStatus; pct = status === 'partial' ? percent(input.pct) : status === 'done' ? 100 : null;
  }
  let carry = it.carry; if (input.carry !== undefined) { const c = String(input.carry); if (!['', 'carry', 'drop'].includes(c)) throw new HttpError(400, 'Choose carry or drop.'); carry = c as DsrItem['carry']; }
  if (status === 'done' || status === 'planned') carry = '';
  const title = input.title === undefined ? it.title : clean(input.title, 300) || it.title;
  const hours = input.plannedHours === undefined ? it.planned_hours : amount(input.plannedHours, 'Planned hours');
  const now = new Date().toISOString();
  app.db.run('UPDATE dsr_items SET status = ?, pct = ?, amount_actual = ?, remark = ?, carry = ?, title = ?, planned_hours = ?, amount_expected = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
    [status, pct, got, remark, carry, title, hours, expected, status === 'planned' ? null : actor.id, status === 'planned' ? null : now, now, id]);
  return getItem(app, id)!;
}

/** Take each person's own update as the review for every line not yet reviewed. */
export function acceptSelfUpdates(app: App, actor: Employee, deptId: string, day: string): number {
  if (!canLead(app, actor, deptId)) throw new HttpError(403, 'Only the team lead reviews the day.');
  if (isClosed(app, deptId, day)) throw new HttpError(409, 'This day is closed.');
  let n = 0;
  for (const it of listItems(app, deptId, day)) {
    if (it.status !== 'planned') continue;
    if (it.kind === 'collection') { if (it.self_amount == null) continue; reviewItem(app, actor, it.id, { amount: it.self_amount }); n++; }
    else if (it.self_status) { reviewItem(app, actor, it.id, { status: it.self_status, pct: it.self_pct ?? '' }); n++; }
  }
  return n;
}

export interface CloseResult { carried: number; to: string; counts: Record<ItemStatus, number> }
/** Close the day: settle every line, and move what is unfinished to the next working day. */
export function closeDay(app: App, actor: Employee, deptId: string, day: string, notes = ''): CloseResult {
  const d = dept(app, deptId);
  if (!canLead(app, actor, deptId)) throw new HttpError(403, 'Only the team lead closes the day.');
  if (!isDay(day)) throw new HttpError(400, 'Choose a valid day.');
  if (day > today()) throw new HttpError(400, 'A day cannot be closed before it arrives.');
  if (isClosed(app, deptId, day)) throw new HttpError(409, 'This day is already closed.');
  const items = listItems(app, deptId, day); if (!items.length) throw new HttpError(400, 'There is nothing planned for this day to close.');
  ensureDay(app, deptId, day);
  let to = nextWorkingDay(app, day); for (let i = 0; i < 10 && isClosed(app, deptId, to); i++) to = nextWorkingDay(app, to);
  const now = new Date().toISOString(); let carried = 0;
  const counts: Record<ItemStatus, number> = { planned: 0, done: 0, partial: 0, not_done: 0, blocked: 0 };
  for (const it of items) {
    // A line nobody reviewed takes the person's own update; with no update at all it counts as not done.
    let status = it.status; let got = it.amount_actual; let pct = it.pct;
    if (status === 'planned') {
      if (it.kind === 'collection') { got = it.self_amount ?? 0; status = collectionStatus(it.amount_expected, got); }
      else { status = (REVIEWED.includes(it.self_status as ItemStatus) ? it.self_status : 'not_done') as ItemStatus; pct = status === 'partial' ? it.self_pct : status === 'done' ? 100 : null; }
    }
    const carry = UNFINISHED.includes(status) ? (it.carry === 'drop' ? 'drop' : 'carry') : '';
    let carriedTo = it.carried_to;
    if (carry === 'carry' && !carriedTo) {
      const still = app.db.get<{ status: string }>('SELECT status FROM employees WHERE id = ?', [it.employee_id])?.status === 'active';
      const left = it.kind === 'collection' ? Math.max(0, Math.round(((it.amount_expected || 0) - (got || 0)) * 100) / 100) : null;
      if (still && (it.kind !== 'collection' || left! > 0)) {
        ensureDay(app, deptId, to); carriedTo = app.db.nextId('DS');
        app.db.run('INSERT INTO dsr_items (id, department_id, day, employee_id, kind, title, customer, ref, planned_hours, amount_expected, carried_from, carry_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [carriedTo, deptId, to, it.employee_id, it.kind, it.title, it.customer, it.ref, it.planned_hours, left, it.id, it.carry_count + 1, actor.id, now, now]);
        carried++;
      }
    }
    app.db.run('UPDATE dsr_items SET status = ?, pct = ?, amount_actual = ?, carry = ?, carried_to = ?, reviewed_by = COALESCE(reviewed_by, ?), reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE id = ?', [status, pct, got, carry, carriedTo, actor.id, now, now, it.id]);
    counts[status]++;
  }
  app.db.run("UPDATE dsr_days SET status = 'closed', notes = ?, closed_at = ?, closed_by = ? WHERE department_id = ? AND day = ?", [clean(notes, 1000), now, actor.id, deptId, day]);
  audit(app.db, { entity: 'dsr_day', entityId: `${deptId}:${day}`, action: 'close', after: { counts, carried, to }, actorId: actor.id });
  const byPerson = new Map<string, { done: number; all: number; carried: number }>();
  for (const it of listItems(app, deptId, day)) { const p = byPerson.get(it.employee_id) || { done: 0, all: 0, carried: 0 }; p.all++; if (it.status === 'done') p.done++; if (it.carried_to) p.carried++; byPerson.set(it.employee_id, p); }
  for (const [id, p] of byPerson) if (id !== actor.id) app.notify.send({ employeeId: id, title: `${d.name} daily review closed`, body: `${p.done} of ${p.all} done${p.carried ? `, ${p.carried} moved to ${to}` : ''}.`, link: `/dsr?team=${deptId}&day=${day}`, kind: 'info' });
  return { carried, to, counts };
}

/** Reopen a closed day. Lines already moved forward stay where they are unless nobody has touched them. */
export function reopenDay(app: App, actor: Employee, deptId: string, day: string): number {
  if (!canLead(app, actor, deptId)) throw new HttpError(403, 'Only the team lead reopens a day.');
  if (!isClosed(app, deptId, day)) throw new HttpError(409, 'This day is not closed.');
  let removed = 0;
  for (const it of listItems(app, deptId, day)) {
    if (!it.carried_to) continue;
    const next = getItem(app, it.carried_to);
    if (next && next.status === 'planned' && !next.self_at && !isClosed(app, next.department_id, next.day)) { app.db.run('DELETE FROM dsr_items WHERE id = ?', [next.id]); app.db.run('UPDATE dsr_items SET carried_to = NULL WHERE id = ?', [it.id]); removed++; }
  }
  app.db.run("UPDATE dsr_days SET status = 'open', closed_at = NULL, closed_by = NULL WHERE department_id = ? AND day = ?", [deptId, day]);
  audit(app.db, { entity: 'dsr_day', entityId: `${deptId}:${day}`, action: 'reopen', after: { removedCarried: removed }, actorId: actor.id });
  return removed;
}

// ---------- figures ----------
export interface Summary { lines: number; done: number; partial: number; notDone: number; blocked: number; waiting: number; updated: number; hours: number; expected: number; collected: number; carriedIn: number }
/** What a line stands at right now: the review if there is one, otherwise the person's own update. */
export function standing(it: DsrItem): { status: ItemStatus; got: number | null; confirmed: boolean } {
  if (it.status !== 'planned') return { status: it.status, got: it.amount_actual, confirmed: true };
  if (it.kind === 'collection') return { status: collectionStatus(it.amount_expected, it.self_amount), got: it.self_amount, confirmed: false };
  return { status: (it.self_status || 'planned') as ItemStatus, got: null, confirmed: false };
}
export function summarise(items: DsrItem[]): Summary {
  const s: Summary = { lines: items.length, done: 0, partial: 0, notDone: 0, blocked: 0, waiting: 0, updated: 0, hours: 0, expected: 0, collected: 0, carriedIn: 0 };
  for (const it of items) {
    const st = standing(it);
    if (st.status === 'done') s.done++; else if (st.status === 'partial') s.partial++; else if (st.status === 'not_done') s.notDone++; else if (st.status === 'blocked') s.blocked++; else s.waiting++;
    if (it.self_at) s.updated++; if (it.carried_from) s.carriedIn++;
    s.hours += it.planned_hours || 0; s.expected += it.amount_expected || 0; s.collected += st.got || 0;
  }
  return s;
}

// ---------- what the pick-lists offer ----------
export function refOptions(app: App, team: Team): Map<string, { value: string; label: string }[]> {
  const out = new Map<string, { value: string; label: string }[]>();
  const push = (emp: string, value: string, label: string): void => { out.set(emp, [...(out.get(emp) || []), { value, label }]); };
  if (team.style === 'tasks') for (const r of app.db.all<{ id: string; title: string; assignee_id: string }>("SELECT d.id, d.title, d.assignee_id FROM dev_issues d JOIN employees e ON e.id = d.assignee_id WHERE e.department_id = ? AND d.status <> 'released' ORDER BY d.updated_at DESC LIMIT 400", [team.id])) push(r.assignee_id, r.id, r.title);
  if (team.style === 'support') for (const r of app.db.all<{ id: string; subject: string; assignee_id: string }>("SELECT t.id, t.subject, t.assignee_id FROM tickets t JOIN employees e ON e.id = t.assignee_id WHERE e.department_id = ? AND t.status NOT IN ('resolved', 'closed') ORDER BY t.created_at LIMIT 400", [team.id])) push(r.assignee_id, r.id, r.subject);
  return out;
}
export function customerNames(app: App): string[] { return app.db.all<{ name: string }>('SELECT name FROM customers ORDER BY name LIMIT 2000').map((r) => r.name); }

export interface SupportPanels {
  yesterday: string;
  fresh: { id: string; subject: string; customer: string | null; priority: string; status: string; assignee: string | null }[];
  pending: { id: string; subject: string; customer: string | null; priority: string; status: string; assignee: string | null; days: number }[]; pendingTotal: number;
  impl: { id: string; subject: string; customer: string | null; stage: string | null; assignee: string | null; days: number; plan: number | null }[];
}
/** What a support team talks through: yesterday's new tickets, everything still open, implementations under way. */
export function supportPanels(app: App, day: string): SupportPanels {
  const y = prevWorkingDay(app, day); const TZ = "'+330 minutes'";
  const base = 'FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN employees e ON e.id = t.assignee_id';
  const fresh = app.db.all<SupportPanels['fresh'][number]>(`SELECT t.id, t.subject, c.name AS customer, t.priority, t.status, e.full_name AS assignee ${base} WHERE date(t.created_at, ${TZ}) >= ? AND date(t.created_at, ${TZ}) < ? AND t.type <> 'implementation' ORDER BY t.priority, t.created_at LIMIT 40`, [y, day]);
  const open = "t.status NOT IN ('resolved', 'closed')";
  const pending = app.db.all<SupportPanels['pending'][number]>(`SELECT t.id, t.subject, c.name AS customer, t.priority, t.status, e.full_name AS assignee, CAST(julianday(?) - julianday(date(t.created_at, ${TZ})) AS INTEGER) AS days ${base} WHERE ${open} AND t.type <> 'implementation' AND date(t.created_at, ${TZ}) <= ? ORDER BY t.created_at LIMIT 40`, [day, day]);
  const pendingTotal = app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tickets t WHERE ${open} AND t.type <> 'implementation' AND date(t.created_at, ${TZ}) <= ?`, [day])!.n;
  const impl = app.db.all<SupportPanels['impl'][number]>(`SELECT t.id, t.subject, c.name AS customer, t.impl_stage AS stage, e.full_name AS assignee, CAST(julianday(?) - julianday(date(t.created_at, ${TZ})) AS INTEGER) AS days, t.impl_plan_days AS plan ${base} WHERE ${open} AND t.type = 'implementation' ORDER BY t.created_at LIMIT 40`, [day]);
  return { yesterday: y, fresh, pending, pendingTotal, impl };
}
