// Company overview ("morning brief") for the people who run the company, and the monthly targets behind it.
// One measure is one line on the overview. Each has a monthly target that the team's manager sets.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { holidaySet } from '../../lib/settings.ts';
import { localDateString, parseLocalDate, addDays, toLocal, weekStart } from '../../lib/time.ts';
import type { Employee } from '../people/model.ts';
import { canLead, dsrStyles } from '../dsr/service.ts';

const TZ = "'+330 minutes'";
const ld = (col: string): string => `date(${col}, ${TZ})`;
export type Unit = 'inr' | 'count' | 'pct';
export interface Measure {
  key: string; deptId: string; name: string; unit: Unit;
  /** 'sum' adds up over the month (money, counts); 'rate' is a percentage that does not add up. */
  kind: 'sum' | 'rate'; direction: 'up' | 'down'; defaultTarget: number; help: string; report: string;
  actual(app: App, from: string, to: string): number | null;
}
interface Dept { id: string; name: string; code: string; hod_id: string | null; head: string | null }
const one = (app: App, sql: string, p: unknown[]): Record<string, number | null> => app.db.get<Record<string, number | null>>(sql, p) || {};
const rate = (num: number | null | undefined, den: number | null | undefined): number | null => (den ? Math.round(((num || 0) / den) * 1000) / 10 : null);

export function departments(app: App): Dept[] { return app.db.all<Dept>('SELECT d.id, d.name, d.code, d.hod_id, e.full_name AS head FROM departments d LEFT JOIN employees e ON e.id = d.hod_id ORDER BY d.name'); }

/** Every line the overview can show. Teams without a measure of their own are measured by their daily review. */
export function measures(app: App): Measure[] {
  const depts = departments(app); const byCode = new Map(depts.map((d) => [d.code, d])); const out: Measure[] = [];
  const add = (code: string, m: Omit<Measure, 'deptId'>): void => { const d = byCode.get(code); if (d) out.push({ ...m, deptId: d.id }); };
  add('SAL', { key: 'sales_won', name: 'Sales won', unit: 'inr', kind: 'sum', direction: 'up', defaultTarget: 6_000_000, report: '/reports/sales-won-lost', help: 'Value of deals won in the month, after discount.',
    actual: (a, f, t) => one(a, `SELECT COALESCE(SUM(d.value * (1 - COALESCE(d.discount_pct, 0) / 100.0)), 0) AS v FROM deals d WHERE d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ? AND ?`, [f, t]).v });
  add('SAL', { key: 'collections', name: 'Collections', unit: 'inr', kind: 'sum', direction: 'up', defaultTarget: 4_000_000, report: '/reports/dsr-by-day', help: 'Money received, as entered in the Sales daily review.',
    actual: (a, f, t) => one(a, "SELECT COALESCE(SUM(COALESCE(amount_actual, self_amount, 0)), 0) AS v FROM dsr_items WHERE kind = 'collection' AND day BETWEEN ? AND ?", [f, t]).v });
  add('SUP', { key: 'tickets_in_time', name: 'Tickets closed in promised time', unit: 'pct', kind: 'rate', direction: 'up', defaultTarget: 90, report: '/reports/support-by-type', help: 'Of the tickets resolved in the month, the share resolved within the promised time.',
    actual: (a, f, t) => { const r = one(a, `SELECT SUM(CASE WHEN within_sla = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN within_sla IS NOT NULL THEN 1 ELSE 0 END) AS n FROM tickets WHERE resolved_at IS NOT NULL AND ${ld('resolved_at')} BETWEEN ? AND ?`, [f, t]); return rate(r.ok, r.n); } });
  add('PRD', { key: 'on_time_dispatch', name: 'Orders dispatched on time', unit: 'pct', kind: 'rate', direction: 'up', defaultTarget: 90, report: '/reports/prod-on-time', help: 'Of the orders dispatched in the month, the share that left on or before the promised date.',
    actual: (a, f, t) => { const r = one(a, `SELECT SUM(CASE WHEN ${ld('dispatched_at')} <= promised_date THEN 1 ELSE 0 END) AS ok, COUNT(*) AS n FROM work_orders WHERE kind = 'order' AND dispatched_at IS NOT NULL AND promised_date IS NOT NULL AND ${ld('dispatched_at')} BETWEEN ? AND ?`, [f, t]); return rate(r.ok, r.n); } });
  add('HR', { key: 'roles_filled', name: 'Roles filled', unit: 'count', kind: 'sum', direction: 'up', defaultTarget: 2, report: '/reports/hire-time', help: 'Offers accepted in the month.',
    actual: (a, f, t) => one(a, `SELECT COUNT(*) AS v FROM offers WHERE status = 'accepted' AND ${ld('responded_at')} BETWEEN ? AND ?`, [f, t]).v });
  add('HR', { key: 'attendance', name: 'Attendance', unit: 'pct', kind: 'rate', direction: 'up', defaultTarget: 95, report: '/reports/att-summary', help: 'Days people were at work, out of the working days so far for everyone active.',
    actual: (a, f, t) => {
      const end = t < today() ? t : today(); if (end < f) return null;
      const present = one(a, "SELECT COALESCE(SUM(x.day_value), 0) AS v FROM attendance x JOIN employees e ON e.id = x.employee_id WHERE e.status = 'active' AND x.check_in IS NOT NULL AND x.date BETWEEN ? AND ?", [f, end]).v || 0;
      const heads = one(a, "SELECT COUNT(*) AS v FROM employees WHERE status = 'active'", []).v || 0;
      return rate(present, heads * workingDays(a, f, end));
    } });
  add('ACC', { key: 'spend', name: 'Spend against budget', unit: 'inr', kind: 'sum', direction: 'down', defaultTarget: 1_200_000, report: '/reports/fin-expenses-category', help: 'Approved expense claims plus the estimated cost of purchases raised in the month. The target is the most you want to spend.',
    actual: (a, f, t) => (one(a, `SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE status = 'approved' AND ${ld('created_at')} BETWEEN ? AND ?`, [f, t]).v || 0) + (one(a, `SELECT COALESCE(SUM(est_cost), 0) AS v FROM procurement_items WHERE ${ld('created_at')} BETWEEN ? AND ?`, [f, t]).v || 0) });
  // Any other team that holds a daily review is measured by how much of its plan it finishes.
  const styles = dsrStyles(app); const has = new Set(out.map((m) => m.deptId));
  for (const d of depts) {
    if (has.has(d.id) || d.code === 'LEAD' || styles[d.id] === 'off' || styles[d.id] === 'collections') continue;
    out.push({ key: `tasks_done:${d.id}`, deptId: d.id, name: 'Daily tasks done as planned', unit: 'pct', kind: 'rate', direction: 'up', defaultTarget: 85, report: '/reports/dsr-by-person', help: `Of the lines on ${d.name}'s daily review in the month, the share marked done.`,
      actual: (a, f, t) => { const r = one(a, "SELECT COUNT(*) AS n, SUM(CASE WHEN (CASE WHEN status <> 'planned' THEN status ELSE self_status END) = 'done' THEN 1 ELSE 0 END) AS ok FROM dsr_items WHERE department_id = ? AND kind = 'task' AND day BETWEEN ? AND ?", [d.id, f, t]); return rate(r.ok, r.n); } });
  }
  const order = ['SAL', 'SUP', 'DEV', 'QA', 'PRD', 'PRE', 'DM', 'HR', 'ACC']; const code = new Map(depts.map((d) => [d.id, d.code]));
  const rank = (m: Measure): number => { const i = order.indexOf(code.get(m.deptId) || ''); return i < 0 ? 99 : i; };
  return out.sort((x, y) => rank(x) - rank(y));
}

// ---------- dates ----------
export function today(now = new Date()): string { return localDateString(now); }
export function workingDays(app: App, from: string, to: string): number {
  if (to < from) return 0; const off = holidaySet(app.db); let n = 0;
  for (let d = parseLocalDate(from); localDateString(d) <= to; d = addDays(d, 1)) if (toLocal(d).dow !== 7 && !off.has(localDateString(d))) n++;
  return n;
}
const monthOf = (day: string): string => day.slice(0, 7);
const monthFirst = (month: string): string => `${month}-01`;
function monthLast(month: string): string { const [y, m] = month.split('-').map(Number); return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; }
export function addMonths(month: string, n: number): string { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }
const isMonth = (s: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (month: string, long = false): string => { const [y, m] = month.split('-').map(Number); return long ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}` : MONTHS[m - 1]; };
export const dayLabel = (day: string): string => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

// ---------- who may do what ----------
/** The people who run the company: executives and administrators. They see every team and manage access. */
export const isCompanyLevel = (u: Employee): boolean => !!u.is_admin || u.functional_role === 'executive';
export function canSetTargets(app: App, u: Employee, deptId: string): boolean {
  if (isCompanyLevel(u) || canLead(app, u, deptId)) return true;
  return !!app.db.get("SELECT 1 AS x FROM target_setters WHERE employee_id = ? AND department_id IN (?, '*')", [u.id, deptId]);
}
export function teamsUserSets(app: App, u: Employee): Dept[] { const ids = new Set(measures(app).map((m) => m.deptId)); return departments(app).filter((d) => ids.has(d.id) && canSetTargets(app, u, d.id)); }
/** Teams whose overview this person may open: every team for company level, otherwise the teams they lead. */
export function teamsUserSees(app: App, u: Employee): Dept[] { const ids = new Set(measures(app).map((m) => m.deptId)); return departments(app).filter((d) => ids.has(d.id) && (isCompanyLevel(u) || canLead(app, u, d.id))); }

export interface Setter { employee_id: string; full_name: string; designation: string; department_id: string; team: string; granted_by_name: string | null; granted_at: string }
export function listSetters(app: App): Setter[] {
  return app.db.all<Setter>("SELECT s.employee_id, e.full_name, e.designation, s.department_id, COALESCE(d.name, 'All teams') AS team, g.full_name AS granted_by_name, s.granted_at FROM target_setters s JOIN employees e ON e.id = s.employee_id LEFT JOIN departments d ON d.id = s.department_id LEFT JOIN employees g ON g.id = s.granted_by ORDER BY e.full_name, team");
}
export function grantSetter(app: App, actor: Employee, employeeId: string, deptId: string): void {
  if (!isCompanyLevel(actor)) throw new HttpError(403, 'Only an administrator or an executive decides who may set targets.');
  const e = app.db.get<{ status: string }>('SELECT status FROM employees WHERE id = ?', [employeeId]); if (!e || e.status !== 'active') throw new HttpError(400, 'Choose an active person.');
  if (deptId !== '*' && !app.db.get('SELECT id FROM departments WHERE id = ?', [deptId])) throw new HttpError(400, 'Choose a team.');
  app.db.run('INSERT OR IGNORE INTO target_setters (employee_id, department_id, granted_by, granted_at) VALUES (?, ?, ?, ?)', [employeeId, deptId, actor.id, new Date().toISOString()]);
  audit(app.db, { entity: 'target_setter', entityId: `${employeeId}:${deptId}`, action: 'grant', actorId: actor.id });
  if (employeeId !== actor.id) app.notify.send({ employeeId, title: 'You can now set monthly targets', body: deptId === '*' ? 'For every team.' : `For ${app.db.get<{ name: string }>('SELECT name FROM departments WHERE id = ?', [deptId])!.name}.`, link: '/targets', kind: 'info' });
}
export function revokeSetter(app: App, actor: Employee, employeeId: string, deptId: string): void {
  if (!isCompanyLevel(actor)) throw new HttpError(403, 'Only an administrator or an executive decides who may set targets.');
  app.db.run('DELETE FROM target_setters WHERE employee_id = ? AND department_id = ?', [employeeId, deptId]);
  audit(app.db, { entity: 'target_setter', entityId: `${employeeId}:${deptId}`, action: 'revoke', actorId: actor.id });
}

// ---------- administrators ----------
export interface AdminRow { id: string; full_name: string; designation: string; department: string; is_admin: number; functional_role: string }
export function listAdmins(app: App): AdminRow[] { return app.db.all<AdminRow>("SELECT e.id, e.full_name, e.designation, d.name AS department, e.is_admin, e.functional_role FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active' AND (e.is_admin = 1 OR e.functional_role = 'executive') ORDER BY e.is_admin DESC, e.full_name"); }
export function setAdmin(app: App, actor: Employee, employeeId: string, on: boolean): void {
  if (!isCompanyLevel(actor)) throw new HttpError(403, 'Only an administrator or an executive names administrators.');
  const e = app.db.get<{ id: string; full_name: string; status: string; is_admin: number }>('SELECT id, full_name, status, is_admin FROM employees WHERE id = ?', [employeeId]);
  if (!e || e.status !== 'active') throw new HttpError(400, 'Choose an active person.');
  if (!on && !app.db.get("SELECT 1 AS x FROM employees WHERE status = 'active' AND id <> ? AND (is_admin = 1 OR functional_role = 'executive')", [employeeId])) throw new HttpError(400, 'Someone must be able to manage LoyalFlow. Name another administrator first.');
  if (!!e.is_admin === on) return;
  app.db.run('UPDATE employees SET is_admin = ?, updated_at = ? WHERE id = ?', [on ? 1 : 0, new Date().toISOString(), employeeId]);
  audit(app.db, { entity: 'employee', entityId: employeeId, action: on ? 'made_administrator' : 'removed_administrator', actorId: actor.id });
  if (on && employeeId !== actor.id) app.notify.send({ employeeId, title: 'You are now a LoyalFlow administrator', body: `${actor.full_name} gave you full access to manage LoyalFlow: settings, roles, targets and every team.`, link: '/settings', kind: 'info' });
}

// ---------- targets ----------
export interface TargetInfo { value: number; source: 'set' | 'carried' | 'default'; from: string | null; setBy: string | null }
export function targetFor(app: App, m: Measure, month: string): TargetInfo {
  const row = app.db.get<{ value: number; month: string; by: string | null }>('SELECT t.value, t.month, e.full_name AS by FROM team_targets t LEFT JOIN employees e ON e.id = t.set_by WHERE t.measure = ? AND t.month <= ? ORDER BY t.month DESC LIMIT 1', [m.key, month]);
  if (!row) return { value: m.defaultTarget, source: 'default', from: null, setBy: null };
  return { value: row.value, source: row.month === month ? 'set' : 'carried', from: row.month, setBy: row.by };
}
export function saveTargets(app: App, actor: Employee, month: string, values: Record<string, unknown>): number {
  if (!isMonth(month)) throw new HttpError(400, 'Choose a month.');
  const cur = monthOf(today());
  if (month < cur && !isCompanyLevel(actor)) throw new HttpError(403, 'Targets for a past month can be changed only by an administrator or an executive.');
  if (month > addMonths(cur, 12)) throw new HttpError(400, 'Set targets at most a year ahead.');
  let n = 0; const now = new Date().toISOString();
  for (const m of measures(app)) {
    const raw = values[m.key]; if (raw === undefined || raw === null || raw === '') continue;
    const v = Number(raw);
    if (!Number.isFinite(v) || v <= 0) throw new HttpError(400, `${m.name}: the target must be a number above zero.`);
    if (m.unit === 'pct' && v > 100) throw new HttpError(400, `${m.name}: a percentage target cannot be more than 100.`);
    if (v > 1e11) throw new HttpError(400, `${m.name}: that target is too large.`);
    const before = targetFor(app, m, month); if (before.source === 'set' && before.value === v) continue;
    if (!canSetTargets(app, actor, m.deptId)) throw new HttpError(403, `You cannot set the target for ${m.name}.`);
    app.db.run('INSERT INTO team_targets (measure, month, value, set_by, set_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(measure, month) DO UPDATE SET value = excluded.value, set_by = excluded.set_by, set_at = excluded.set_at', [m.key, month, v, actor.id, now]);
    audit(app.db, { entity: 'team_target', entityId: `${m.key}:${month}`, action: 'set', before: { value: before.value, source: before.source }, after: { value: v }, actorId: actor.id });
    n++;
  }
  return n;
}

// ---------- display ----------
export interface BriefSettings { seconds: number; rotate: boolean }
export function briefSettings(app: App): BriefSettings {
  const row = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'brief'"); let s: Partial<BriefSettings> = {};
  if (row) { try { s = JSON.parse(row.value) as Partial<BriefSettings>; } catch { /* defaults */ } }
  return { seconds: Number.isFinite(s.seconds) ? Math.min(600, Math.max(15, Math.round(s.seconds!))) : 60, rotate: s.rotate !== false };
}
export function saveBriefSettings(app: App, actor: Employee, input: { seconds?: unknown; rotate?: unknown }): BriefSettings {
  if (!isCompanyLevel(actor)) throw new HttpError(403, 'Only an administrator or an executive changes how the overview is shown.');
  const sec = Math.round(Number(input.seconds)); if (!Number.isFinite(sec) || sec < 15 || sec > 600) throw new HttpError(400, 'Each view stays between 15 seconds and 10 minutes.');
  const next: BriefSettings = { seconds: sec, rotate: input.rotate === true || input.rotate === 'on' || input.rotate === '1' || input.rotate === 'true' };
  app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', ['brief', JSON.stringify(next), new Date().toISOString(), actor.id]);
  audit(app.db, { entity: 'settings', entityId: 'brief', action: 'update', after: next, actorId: actor.id });
  return next;
}

// ---------- the overview ----------
export type Tone = 'good' | 'warn' | 'crit' | 'ink';
export const fmt = (unit: Unit, v: number | null | undefined): string => {
  if (v == null) return '—';
  if (unit === 'pct') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'count') return Math.round(v).toLocaleString('en-IN');
  const a = Math.abs(v); const f = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));
  return '₹' + (a >= 1e7 ? f(v / 1e7) + ' Cr' : a >= 1e5 ? f(v / 1e5) + ' L' : Math.round(v).toLocaleString('en-IN'));
};
const gap = (unit: Unit, v: number): string => (unit === 'pct' ? `${Math.round(Math.abs(v) * 10) / 10} point${Math.abs(v) === 1 ? '' : 's'}` : fmt(unit, Math.abs(v)));
export interface Row {
  m: Measure; team: string; teamId: string; teamCode: string; head: string | null;
  target: TargetInfo; mtd: number | null; pctOfTarget: number | null; projected: number | null; projectedPct: number | null;
  tone: Tone; status: string; outlook: string;
  weeks: (number | null)[]; week: number | null; lastWeek: number | null; days: (number | null)[];
  dsrToday: { done: number; total: number; text: string } | null; dsrWeek: { done: number; total: number } | null;
}
/** One graph card at the top of the overview. */
export interface ChartCard {
  teamCode: string; team: string; title: string; big: string; sub: string; subTone: 'up' | 'dn' | 'muted'; report: string;
  type: 'cols' | 'lines' | 'hbars'; labels: string[]; series: number[][]; names: string[]; money?: boolean; top?: number; unit?: string; note?: string;
}
export interface Attention { tone: 'crit' | 'warn'; tag: string; title: string; sub: string; team: string; href: string }
export interface Brief {
  day: string; month: string; elapsed: number; workdays: number; left: number; weekFrom: string; weekTo: string; lastFrom: string; lastTo: string; weekDays: string[];
  rows: Row[]; attention: Attention[]; quiet: number; charts: ChartCard[]; noCharts: string[];
  money: { months: string[]; won: number[]; collected: number[] } | null;
  people: { heads: number; atWork: number; onLeave: number; late: number; notIn: number } | null;
  week: { won: [number, number]; collected: [number, number]; expected: number; closed: [number, number]; dispatched: [number, number]; onTime: number; dsr: [number | null, number | null]; collByDay: number[]; expByDay: number[]; carried: { title: string; sub: string; team: string; count: number; href: string }[] };
  monthView: { onCourse: number; cum: { day: number; value: number }[]; collTarget: number | null; collProjected: number | null; daysInMonth: number; met: { month: string; n: number; of: number }[] };
}
function judge(m: Measure, target: number, mtd: number | null, projected: number | null): { tone: Tone; status: string; outlook: string } {
  if (projected == null || mtd == null) return { tone: 'ink', status: 'No data yet', outlook: 'No data yet' };
  if (m.direction === 'down') {
    if (projected <= target) return { tone: 'good', status: 'On track', outlook: 'Within budget' };
    return { tone: projected <= target * 1.1 ? 'warn' : 'crit', status: projected <= target * 1.1 ? 'Watch' : 'Behind', outlook: `Over by ${gap(m.unit, projected - target)}` };
  }
  if (projected >= target) return { tone: 'good', status: 'On track', outlook: 'Will meet' };
  const near = m.kind === 'rate' ? projected >= target * 0.95 : projected >= target * 0.9;
  return { tone: near ? 'warn' : 'crit', status: near ? 'Watch' : 'Behind', outlook: `Short by ${gap(m.unit, target - projected)}` };
}
const count = (app: App, sql: string, p: unknown[] = []): number => app.db.get<{ n: number }>(sql, p)?.n || 0;

export function buildBrief(app: App, viewer: Employee, now = new Date()): Brief {
  const day = today(now); const month = monthOf(day); const mFrom = monthFirst(month); const mTo = monthLast(month);
  const elapsed = workingDays(app, mFrom, day); const workdays = workingDays(app, mFrom, mTo);
  const ws = weekStart(now); const weekFrom = localDateString(ws); const weekTo = localDateString(addDays(ws, 5));
  const lastFrom = localDateString(addDays(ws, -7)); const lastTo = localDateString(addDays(ws, -2));
  const weekDays = [0, 1, 2, 3, 4, 5].map((i) => localDateString(addDays(ws, i)));
  const sees = teamsUserSees(app, viewer); const seeIds = new Set(sees.map((d) => d.id)); const all = isCompanyLevel(viewer);
  const deptById = new Map(departments(app).map((d) => [d.id, d]));
  const styles = dsrStyles(app);

  const rows: Row[] = measures(app).filter((m) => seeIds.has(m.deptId)).map((m) => {
    const d = deptById.get(m.deptId)!; const target = targetFor(app, m, month); const mtd = m.actual(app, mFrom, day);
    const projected = mtd == null ? null : m.kind === 'sum' ? (elapsed ? (mtd / elapsed) * workdays : mtd) : mtd;
    const j = judge(m, target.value, mtd, projected);
    const weeks = [7, 6, 5, 4, 3, 2, 1, 0].map((k) => m.actual(app, localDateString(addDays(ws, -7 * k)), localDateString(addDays(ws, -7 * k + 6))));
    const days = weekDays.map((x) => (x > day ? null : m.actual(app, x, x)));
    let dsrToday: Row['dsrToday'] = null; let dsrWeek: Row['dsrWeek'] = null;
    if (styles[d.id] && styles[d.id] !== 'off') {
      const st = "(CASE WHEN status <> 'planned' THEN status ELSE self_status END)";
      const t = one(app, `SELECT COUNT(*) AS n, SUM(CASE WHEN ${st} = 'done' THEN 1 ELSE 0 END) AS ok, COALESCE(SUM(amount_expected), 0) AS exp, COALESCE(SUM(COALESCE(amount_actual, self_amount, 0)), 0) AS got FROM dsr_items WHERE department_id = ? AND day = ?`, [d.id, day]);
      const w = one(app, `SELECT COUNT(*) AS n, SUM(CASE WHEN ${st} = 'done' THEN 1 ELSE 0 END) AS ok FROM dsr_items WHERE department_id = ? AND day BETWEEN ? AND ?`, [d.id, weekFrom, weekTo]);
      const money = styles[d.id] === 'collections';
      dsrToday = !t.n ? { done: 0, total: 0, text: 'Nothing planned today' } : money ? { done: t.got || 0, total: t.exp || 0, text: `${fmt('inr', t.got)} of ${fmt('inr', t.exp)} in` } : { done: t.ok || 0, total: t.n, text: `${t.ok || 0} of ${t.n} done` };
      dsrWeek = { done: w.ok || 0, total: w.n || 0 };
    }
    return { m, team: d.name, teamId: d.id, teamCode: d.code, head: d.head, target, mtd, pctOfTarget: mtd == null || !target.value ? null : Math.round((mtd / target.value) * 100), projected, projectedPct: projected == null || !target.value ? null : Math.round((projected / target.value) * 100),
      ...j, weeks, week: m.actual(app, weekFrom, weekTo < day ? weekTo : day), lastWeek: m.actual(app, lastFrom, lastTo), days, dsrToday, dsrWeek };
  });

  // What needs attention: targets that will be missed, then things that are late right now.
  const attention: Attention[] = [];
  for (const r of rows) if (r.tone === 'crit' || r.tone === 'warn') attention.push({ tone: r.tone, tag: r.status, title: `${r.m.name}: ${r.outlook.charAt(0).toLowerCase()}${r.outlook.slice(1)}`, sub: `${fmt(r.m.unit, r.mtd)} so far against a target of ${fmt(r.m.unit, r.target.value)}${r.m.kind === 'sum' ? ` · ${workdays - elapsed} working day${workdays - elapsed === 1 ? '' : 's'} left` : ''}`, team: r.team, href: r.m.report });
  const code = (c: string): boolean => [...seeIds].some((id) => deptById.get(id)?.code === c);
  if (code('SUP')) {
    const n = count(app, "SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('resolved', 'closed') AND resolve_due_at IS NOT NULL AND resolve_due_at < ?", [now.toISOString()]);
    if (n) { const o = app.db.get<{ subject: string; name: string | null; d: number }>("SELECT t.subject, c.name, CAST(julianday(?) - julianday(t.resolve_due_at) AS INTEGER) AS d FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.status NOT IN ('resolved', 'closed') AND t.resolve_due_at < ? ORDER BY t.resolve_due_at LIMIT 1", [now.toISOString(), now.toISOString()])!;
      attention.push({ tone: 'crit', tag: 'Past time', title: `${n} ticket${n === 1 ? ' is' : 's are'} past the promised time`, sub: `Oldest: ${o.subject}${o.name ? `, ${o.name}` : ''}, ${o.d} day${o.d === 1 ? '' : 's'} over`, team: deptById.get([...seeIds].find((id) => deptById.get(id)?.code === 'SUP')!)!.name, href: '/desk' }); }
  }
  if (code('PRD')) {
    const late = app.db.all<{ id: string }>("SELECT id FROM work_orders WHERE kind = 'order' AND dispatched_at IS NULL AND stage NOT IN ('cancelled', 'delivered', 'dispatched') AND promised_date IS NOT NULL AND promised_date < ? ORDER BY promised_date LIMIT 50", [day]);
    if (late.length) attention.push({ tone: late.length > 2 ? 'crit' : 'warn', tag: 'Late', title: `${late.length} order${late.length === 1 ? ' is' : 's are'} past the promised dispatch date`, sub: late.slice(0, 4).map((x) => x.id).join(', ') + (late.length > 4 ? ' and more' : ''), team: 'Production', href: '/reports/prod-late' });
  }
  if (code('HR')) {
    const n = count(app, "SELECT COUNT(*) AS n FROM offers WHERE status = 'issued' AND issued_at < ?", [addDays(now, -3).toISOString()]);
    if (n) attention.push({ tone: 'warn', tag: 'Waiting', title: `${n} offer${n === 1 ? ' has' : 's have'} had no answer for more than 3 days`, sub: 'Open Hiring to follow up', team: 'Hiring', href: '/reports/hire-offers' });
  }
  if (all) {
    const n = count(app, "SELECT COUNT(*) AS n FROM tasks WHERE kind = 'approval' AND status = 'open' AND created_at < ?", [addDays(now, -2).toISOString()]);
    if (n) attention.push({ tone: 'warn', tag: 'Waiting', title: `${n} approval${n === 1 ? ' has' : 's have'} waited more than 2 days`, sub: 'Across the company', team: 'Approvals', href: '/reports/approvals-waiting' });
  }
  const stuck = app.db.all<{ department_id: string; n: number }>('SELECT department_id, COUNT(*) AS n FROM dsr_items WHERE day = ? AND carry_count >= 3 GROUP BY department_id', [day]).filter((x) => seeIds.has(x.department_id));
  for (const x of stuck) attention.push({ tone: 'warn', tag: 'Carried', title: `${x.n} line${x.n === 1 ? '' : 's'} on today's daily review ${x.n === 1 ? 'has' : 'have'} been brought forward 3 times or more`, sub: 'Open the daily review to see which', team: deptById.get(x.department_id)!.name, href: `/dsr?team=${x.department_id}` });
  attention.sort((a, b) => Number(b.tone === 'crit') - Number(a.tone === 'crit'));
  const flagged = new Set(attention.map((a) => a.team)); const quiet = sees.filter((d) => !flagged.has(d.name)).length;

  // Side cards, for the company as a whole.
  const won = rows.find((r) => r.m.key === 'sales_won'); const coll = rows.find((r) => r.m.key === 'collections');
  let money: Brief['money'] = null;
  if (won && coll) { const ms = [5, 4, 3, 2, 1, 0].map((k) => addMonths(month, -k)); money = { months: ms, won: ms.map((x) => won.m.actual(app, monthFirst(x), monthLast(x)) || 0), collected: ms.map((x) => coll.m.actual(app, monthFirst(x), monthLast(x)) || 0) }; }
  let people: Brief['people'] = null;
  if (all) {
    const heads = count(app, "SELECT COUNT(*) AS n FROM employees WHERE status = 'active'"); const atWork = count(app, "SELECT COUNT(*) AS n FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE e.status = 'active' AND a.date = ? AND a.check_in IS NOT NULL", [day]);
    const onLeave = count(app, "SELECT COUNT(DISTINCT l.employee_id) AS n FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE e.status = 'active' AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date", [day]);
    const late = count(app, 'SELECT COUNT(*) AS n FROM attendance WHERE date = ? AND minutes_late > 15', [day]);
    people = { heads, atWork, onLeave, late, notIn: Math.max(0, heads - atWork - onLeave) };
  }

  // This week against last week.
  const upTo = weekTo < day ? weekTo : day; const TW = [weekFrom, upTo]; const LW = [lastFrom, lastTo];
  const v = (sql: string, p: unknown[]): number => (app.db.get<{ v: number | null }>(sql, p)?.v || 0);
  const wonSql = `SELECT COALESCE(SUM(d.value * (1 - COALESCE(d.discount_pct, 0) / 100.0)), 0) AS v FROM deals d WHERE d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ? AND ?`;
  const collSql = "SELECT COALESCE(SUM(COALESCE(amount_actual, self_amount, 0)), 0) AS v FROM dsr_items WHERE kind = 'collection' AND day BETWEEN ? AND ?";
  const closedSql = `SELECT COUNT(*) AS v FROM tickets WHERE resolved_at IS NOT NULL AND ${ld('resolved_at')} BETWEEN ? AND ?`;
  const dispSql = `SELECT COUNT(*) AS v FROM work_orders WHERE kind = 'order' AND dispatched_at IS NOT NULL AND ${ld('dispatched_at')} BETWEEN ? AND ?`;
  const dsrRate = (f: string, t: string): number | null => { const r = one(app, "SELECT COUNT(*) AS n, SUM(CASE WHEN (CASE WHEN status <> 'planned' THEN status ELSE self_status END) = 'done' THEN 1 ELSE 0 END) AS ok FROM dsr_items WHERE kind = 'task' AND day BETWEEN ? AND ?", [f, t]); return rate(r.ok, r.n); };
  const carried = app.db.all<{ title: string; customer: string; kind: string; amount_expected: number | null; carry_count: number; department_id: string; name: string; status: string; self_status: string }>('SELECT i.title, i.customer, i.kind, i.amount_expected, i.carry_count, i.department_id, e.full_name AS name, i.status, i.self_status FROM dsr_items i JOIN employees e ON e.id = i.employee_id WHERE i.day BETWEEN ? AND ? AND i.carry_count >= 3 AND i.carried_to IS NULL ORDER BY i.carry_count DESC, i.day DESC LIMIT 30', [weekFrom, weekTo])
    .filter((x) => seeIds.has(x.department_id)).slice(0, 6).map((x) => ({ title: x.kind === 'collection' ? `${x.customer}, ${fmt('inr', x.amount_expected)}` : x.title, sub: x.name, team: deptById.get(x.department_id)!.name, count: x.carry_count, href: `/dsr?team=${x.department_id}` }));
  const week: Brief['week'] = { won: [v(wonSql, TW), v(wonSql, LW)], collected: [v(collSql, TW), v(collSql, LW)], expected: v("SELECT COALESCE(SUM(amount_expected), 0) AS v FROM dsr_items WHERE kind = 'collection' AND carried_from IS NULL AND day BETWEEN ? AND ?", TW),
    closed: [v(closedSql, TW), v(closedSql, LW)], dispatched: [v(dispSql, TW), v(dispSql, LW)], onTime: v(`SELECT COUNT(*) AS v FROM work_orders WHERE kind = 'order' AND dispatched_at IS NOT NULL AND promised_date IS NOT NULL AND ${ld('dispatched_at')} <= promised_date AND ${ld('dispatched_at')} BETWEEN ? AND ?`, TW),
    dsr: [dsrRate(weekFrom, upTo), dsrRate(lastFrom, lastTo)], collByDay: weekDays.map((x) => v(collSql, [x, x])), expByDay: weekDays.map((x) => v("SELECT COALESCE(SUM(amount_expected), 0) AS v FROM dsr_items WHERE kind = 'collection' AND day = ?", [x])), carried };

  // This month: are we on course?
  const cum: { day: number; value: number }[] = [];
  if (coll) { let run = 0; const byDay = new Map(app.db.all<{ day: string; v: number }>("SELECT day, COALESCE(SUM(COALESCE(amount_actual, self_amount, 0)), 0) AS v FROM dsr_items WHERE kind = 'collection' AND day BETWEEN ? AND ? GROUP BY day", [mFrom, day]).map((x) => [x.day, x.v])); for (let d = 1; d <= Number(day.slice(8)); d++) { run += byDay.get(`${month}-${String(d).padStart(2, '0')}`) || 0; cum.push({ day: d, value: run }); } }
  const met = [5, 4, 3, 2, 1, 0].map((k) => { const mo = addMonths(month, -k); let n = 0; let of = 0;
    for (const r of rows) { const tv = targetFor(app, r.m, mo).value; const a = k === 0 ? r.projected : r.m.actual(app, monthFirst(mo), monthLast(mo)); if (a == null) continue; of++; if (r.m.direction === 'down' ? a <= tv : a >= tv) n++; }
    return { month: mo, n, of }; });
  // Graphs: one card per team, drawn from the same figures as the lines below.
  const charts: ChartCard[] = []; const noCharts: string[] = [];
  const six = [5, 4, 3, 2, 1, 0].map((k) => addMonths(month, -k)); const sixLabels = six.map((x) => monthName(x));
  const tone = (r: Row | undefined): ChartCard['subTone'] => (!r || r.tone === 'ink' ? 'muted' : r.tone === 'good' ? 'up' : 'dn');
  const ymOf = (col: string): string => `strftime('%Y-%m', ${col}, ${TZ})`;
  const byMonth = (sql: string, p: unknown[] = []): number[] => { const m = new Map(app.db.all<{ m: string; n: number }>(sql, [...p, monthFirst(six[0]), mTo]).map((x) => [x.m, x.n])); return six.map((x) => m.get(x) || 0); };
  const cardOrder = ['SAL', 'SUP', 'DEV', 'QA', 'PRD', 'PRE', 'DM', 'HR', 'ACC']; const rk = (c: string): number => (cardOrder.indexOf(c) < 0 ? 99 : cardOrder.indexOf(c));
  for (const d of [...sees].sort((x, y) => rk(x.code) - rk(y.code))) {
    const mine = rows.filter((r) => r.teamId === d.id); const first = mine[0];
    if (d.code === 'SAL' && money) {
      charts.push({ teamCode: d.code, team: d.name, title: 'Won and collected by month', big: fmt('inr', won!.mtd), sub: `${won!.outlook} · target ${fmt('inr', won!.target.value)}`, subTone: tone(won), report: '/reports/sales-won-lost', type: 'cols', labels: sixLabels, series: [money.won, money.collected], names: ['Won', 'Collected'], money: true, unit: '₹' });
    } else if (d.code === 'SUP') {
      const opened = byMonth(`SELECT ${ymOf('created_at')} AS m, COUNT(*) AS n FROM tickets WHERE ${ld('created_at')} BETWEEN ? AND ? GROUP BY 1`); const closed = byMonth(`SELECT ${ymOf('resolved_at')} AS m, COUNT(*) AS n FROM tickets WHERE resolved_at IS NOT NULL AND ${ld('resolved_at')} BETWEEN ? AND ? GROUP BY 1`);
      const open = count(app, "SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('resolved', 'closed')"); const past = count(app, "SELECT COUNT(*) AS n FROM tickets WHERE status NOT IN ('resolved', 'closed') AND resolve_due_at IS NOT NULL AND resolve_due_at < ?", [now.toISOString()]);
      charts.push({ teamCode: d.code, team: d.name, title: 'Tickets opened and closed', big: `${open} open`, sub: past ? `${past} past time` : 'None past time', subTone: past ? 'dn' : 'up', report: '/reports/support-by-type', type: 'lines', labels: sixLabels, series: [closed, opened], names: ['Closed', 'Opened (dashed)'] });
    } else if (d.code === 'PRD') {
      const sent = byMonth(`SELECT ${ymOf('dispatched_at')} AS m, COUNT(*) AS n FROM work_orders WHERE kind = 'order' AND dispatched_at IS NOT NULL AND ${ld('dispatched_at')} BETWEEN ? AND ? GROUP BY 1`); const ok = byMonth(`SELECT ${ymOf('dispatched_at')} AS m, COUNT(*) AS n FROM work_orders WHERE kind = 'order' AND dispatched_at IS NOT NULL AND promised_date IS NOT NULL AND ${ld('dispatched_at')} <= promised_date AND ${ld('dispatched_at')} BETWEEN ? AND ? GROUP BY 1`);
      const late = count(app, "SELECT COUNT(*) AS n FROM work_orders WHERE kind = 'order' AND dispatched_at IS NULL AND stage NOT IN ('delivered', 'dispatched') AND promised_date IS NOT NULL AND promised_date < ?", [day]);
      charts.push({ teamCode: d.code, team: d.name, title: 'Orders dispatched, and how many on time', big: first?.mtd == null ? `${sent[5]} dispatched` : `${fmt('pct', first.mtd)} on time`, sub: late ? `${late} order${late === 1 ? '' : 's'} late now` : 'No order is late now', subTone: late ? 'dn' : 'up', report: '/reports/prod-on-time', type: 'cols', labels: sixLabels, series: [sent, ok], names: ['Dispatched', 'On time'] });
    } else if (d.code === 'HR') {
      if (people) {
        const days = weekDays.filter((x) => x <= day); const at = days.map((x) => count(app, "SELECT COUNT(*) AS n FROM attendance a JOIN employees e ON e.id = a.employee_id WHERE e.status = 'active' AND a.date = ? AND a.check_in IS NOT NULL", [x]));
        charts.push({ teamCode: d.code, team: 'People', title: 'At work each day this week', big: `${people.atWork} of ${people.heads}`, sub: 'at work today', subTone: 'muted', report: '/reports/att-summary', type: 'cols', labels: days.map((x, i) => (x === day ? 'Today' : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i])), series: [at], names: ['At work'], top: Math.max(1, people.heads), note: `${people.onLeave} on leave · ${people.late} late · ${people.notIn} not in` });
      }
      const stages = app.db.all<{ stage: string; n: number }>("SELECT a.stage, COUNT(*) AS n FROM applications a WHERE a.status = 'active' GROUP BY a.stage ORDER BY n DESC LIMIT 7"); const roles = count(app, "SELECT COUNT(*) AS n FROM requisitions WHERE status = 'open'");
      if (stages.length) charts.push({ teamCode: 'HIRE', team: 'Hiring', title: 'Candidates at each step', big: `${roles} open role${roles === 1 ? '' : 's'}`, sub: `${stages.reduce((a, x) => a + x.n, 0)} candidates in progress`, subTone: 'muted', report: '/reports/hire-funnel', type: 'hbars', labels: stages.map((x) => x.stage.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())), series: [stages.map((x) => x.n)], names: ['Candidates'] });
    } else if (d.code === 'ACC' && first) {
      const spend = six.map((x) => first.m.actual(app, monthFirst(x), monthLast(x)) || 0);
      charts.push({ teamCode: d.code, team: d.name, title: 'Spend by month', big: fmt('inr', first.mtd), sub: `${first.outlook} · budget ${fmt('inr', first.target.value)}`, subTone: tone(first), report: first.m.report, type: 'cols', labels: sixLabels, series: [spend], names: ['Spent'], money: true, unit: '₹' });
    } else if (first && first.m.key.startsWith('tasks_done:')) {
      // The last seven working days of the team's daily review: planned against done.
      const days: string[] = []; for (let x = parseLocalDate(day); days.length < 7; x = addDays(x, -1)) { if (workingDays(app, localDateString(x), localDateString(x))) days.unshift(localDateString(x)); if (days.length === 0 && localDateString(x) < addMonths(month, -2)) break; }
      const got = new Map(app.db.all<{ day: string; n: number; ok: number }>("SELECT day, COUNT(*) AS n, SUM(CASE WHEN (CASE WHEN status <> 'planned' THEN status ELSE self_status END) = 'done' THEN 1 ELSE 0 END) AS ok FROM dsr_items WHERE department_id = ? AND kind = 'task' AND day BETWEEN ? AND ? GROUP BY day", [d.id, days[0], day]).map((x) => [x.day, x]));
      if (!got.size) { noCharts.push(d.name); continue; }
      charts.push({ teamCode: d.code, team: d.name, title: 'Daily review: tasks done as planned', big: fmt('pct', first.mtd), sub: `${first.outlook} · target ${fmt('pct', first.target.value)}`, subTone: tone(first), report: first.m.report, type: 'cols', labels: days.map((x) => (x === day ? 'Today' : dayLabel(x))), series: [days.map((x) => got.get(x)?.ok || 0), days.map((x) => got.get(x)?.n || 0)], names: ['Done', 'Planned'] });
    } else noCharts.push(d.name);
  }
  return { day, month, elapsed, workdays, left: workdays - elapsed, charts, noCharts, weekFrom, weekTo, lastFrom, lastTo, weekDays, rows, attention, quiet, money, people, week,
    monthView: { onCourse: rows.filter((r) => r.tone === 'good').length, cum, collTarget: coll ? coll.target.value : null, collProjected: coll ? coll.projected : null, daysInMonth: Number(mTo.slice(8)), met } };
}
