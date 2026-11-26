// Reports for every module. Each report is a definition: who may run it, which filters it takes, and a function
// that turns a date range into columns, rows, an optional totals row and an optional chart.
// One screen (/reports) and one Excel export serve them all.
import type { Params } from '../../db/index.ts';
import type { App } from '../../app.ts';
import type { Employee } from '../people/model.ts';
import { can, scopeFor } from '../../lib/scope.ts';
import { atLeast } from '../../lib/roles.ts';
import { rules as attendanceRules } from '../hr/attendance-rules.ts';
import { monthSheet } from '../hr/attendance.ts';
import { budgets } from '../ops/service.ts';
import { STAGES as DEAL_STAGES, STAGE_LABEL as DEAL_LABEL } from '../sales/service.ts';
import { STAGES as HIRE_STAGES, STAGE_LABEL as HIRE_LABEL } from '../hr/recruiting.ts';
import { RATINGS } from '../hr/appraisal.ts';
import * as lists from '../../lib/lists.ts';
import { localDateString, addDays, fiscalYear } from '../../lib/time.ts';

export type Fmt = 'text' | 'int' | 'money' | 'pct' | 'num' | 'date' | 'link';
export interface Column { header: string; fmt?: Fmt; width?: number }
export type Cell = string | number | null | { text: string; href: string };
export interface Chart { title: string; unit?: string; labels: string[]; values: number[] }
export interface ReportResult { columns: Column[]; rows: Cell[][]; totals?: Cell[]; chart?: Chart; note?: string }
export interface RunCtx { from: string; to: string; departmentId: string; personId: string; /** People whose records the viewer may see; null means everyone. */ people: Set<string> | null; viewer: Employee }
export type ModuleId = 'sales' | 'support' | 'dev' | 'production' | 'finance' | 'attendance' | 'hiring' | 'appraisals' | 'sops' | 'approvals' | 'dsr' | 'admin';
export interface ReportDef {
  key: string; module: ModuleId; title: string; about: string;
  /** Which filters mean something for this report. The date range always applies unless `noRange`. */
  filters: ('department' | 'person')[]; noRange?: boolean;
  allowed: (app: App, user: Employee) => boolean;
  run: (app: App, c: RunCtx) => ReportResult;
}
export const MODULE_NAME: Record<ModuleId, string> = { sales: 'Sales', support: 'Support', dev: 'Development', production: 'Production', finance: 'Finance', attendance: 'Attendance and leave', hiring: 'Hiring', appraisals: 'Appraisals', sops: 'SOPs', approvals: 'Approvals', dsr: 'Daily review', admin: 'Administration' };
/** Which menu module each group of reports sits under. */
export const MENU_OF: Record<ModuleId, string> = { sales: 'sales', support: 'support', dev: 'dev', production: 'production', finance: 'company', attendance: 'people', hiring: 'people', appraisals: 'people', sops: 'company', approvals: 'company', dsr: 'company', admin: 'admin' };

import { ledger, advanceState, isAccounts, ENTRY_LABEL } from '../money/service.ts';
// ---------- helpers ----------
const TZ = "'+330 minutes'";
const ld = (col: string): string => `date(${col}, ${TZ})`;          // a stored UTC time as a local date
const ym = (col: string): string => `strftime('%Y-%m', ${col}, ${TZ})`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string): string => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const pct = (a: number, b: number): number | null => (b ? Math.round((a / b) * 1000) / 10 : null);
const r1 = (n: number | null | undefined): number | null => (n == null ? null : Math.round(n * 10) / 10);
const sum = (rows: Cell[][], i: number): number => rows.reduce((n, r) => n + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0);
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []; let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while ((y < ey || (y === ey && m <= em)) && out.length < 36) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
/** Adds "column IN (…)" for the people the viewer may see, the department and the person filter. `col` is an employee id column. */
function who(c: RunCtx, col: string, params: Params, opts: { deptVia?: string } = {}): string {
  const parts: string[] = [];
  if (c.people) { if (!c.people.size) return ' AND 1 = 0'; parts.push(`${col} IN (${[...c.people].map(() => '?').join(',')})`); params.push(...c.people); }
  if (c.personId) { parts.push(`${col} = ?`); params.push(c.personId); }
  if (c.departmentId) { parts.push(`${opts.deptVia || `(SELECT department_id FROM employees WHERE id = ${col})`} = ?`); params.push(c.departmentId); }
  return parts.length ? ' AND ' + parts.join(' AND ') : '';
}
const between = (col: string, c: RunCtx, params: Params): string => { params.push(c.from, c.to); return `${col} BETWEEN ? AND ?`; };
const link = (text: string | null | undefined, href: string): Cell => (text ? { text, href } : null);
const sales = (app: App, u: Employee): boolean => atLeast(app.db, u, 'sales', 'view');
const desk = (app: App, u: Employee): boolean => atLeast(app.db, u, 'desk', 'view');
const dev = (app: App, u: Employee): boolean => atLeast(app.db, u, 'dev', 'view');
const prod = (app: App, u: Employee): boolean => atLeast(app.db, u, 'production', 'view');
const managerOrAbove = (app: App, u: Employee): boolean => can(app.db, u, 'reports.company');
const attendanceAllowed = (app: App, u: Employee): boolean => can(app.db, u, 'attendance.manage') || scopeFor(app.db, u).level !== 'self';
const netValue = 'd.value * (1 - COALESCE(d.discount_pct, 0) / 100.0)';

// ---------- the reports ----------
export const REPORTS: ReportDef[] = [
  // ===== Sales =====
  { key: 'sales-won-lost', module: 'sales', title: 'Won and lost by month', about: 'Deals closed each month, their value after discount, and the win rate.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = []; const w = who(c, 'd.owner_id', p);
      const rows = monthsBetween(c.from, c.to).map((m): Cell[] => {
        const won = app.db.get<{ n: number; v: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(${netValue}), 0) AS v FROM deals d WHERE d.stage = 'won' AND ${ym('d.won_at')} = ? AND ${ld('d.won_at')} BETWEEN ? AND ?${w}`, [m, c.from, c.to, ...p])!;
        const lost = app.db.get<{ n: number; v: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(${netValue}), 0) AS v FROM deals d WHERE d.stage = 'lost' AND ${ym('d.lost_at')} = ? AND ${ld('d.lost_at')} BETWEEN ? AND ?${w}`, [m, c.from, c.to, ...p])!;
        return [monthLabel(m), won.n, Math.round(won.v), lost.n, Math.round(lost.v), pct(won.n, won.n + lost.n)];
      });
      const tw = sum(rows, 1), tl = sum(rows, 3);
      return { columns: [{ header: 'Month' }, { header: 'Won', fmt: 'int' }, { header: 'Won value', fmt: 'money' }, { header: 'Lost', fmt: 'int' }, { header: 'Lost value', fmt: 'money' }, { header: 'Win rate', fmt: 'pct' }], rows,
        totals: ['Total', tw, sum(rows, 2), tl, sum(rows, 4), pct(tw, tw + tl)], chart: { title: 'Won value by month', unit: '₹', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[2]) || 0) } };
    } },
  { key: 'sales-by-person', module: 'sales', title: 'Sales by person', about: 'For each sales person: open deals now, what they won and lost in the period, and how active they were.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = []; const w = who(c, 'e.id', p, { deptVia: 'e.department_id' });
      const rows = app.db.all<{ id: string; name: string; open_n: number; open_v: number; won_n: number; won_v: number; lost_n: number; acts: number }>(`SELECT e.id, e.full_name AS name,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = e.id AND d.stage NOT IN ('won','lost')) AS open_n,
        (SELECT COALESCE(SUM(${netValue}), 0) FROM deals d WHERE d.owner_id = e.id AND d.stage NOT IN ('won','lost')) AS open_v,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = e.id AND d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ?1 AND ?2) AS won_n,
        (SELECT COALESCE(SUM(${netValue}), 0) FROM deals d WHERE d.owner_id = e.id AND d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ?1 AND ?2) AS won_v,
        (SELECT COUNT(*) FROM deals d WHERE d.owner_id = e.id AND d.stage = 'lost' AND ${ld('d.lost_at')} BETWEEN ?1 AND ?2) AS lost_n,
        (SELECT COUNT(*) FROM activities a WHERE a.actor_id = e.id AND a.kind IN ('call','visit','demo','email') AND ${ld('a.at')} BETWEEN ?1 AND ?2) AS acts
        FROM employees e WHERE e.id IN (SELECT owner_id FROM deals)${w} ORDER BY won_v DESC, open_v DESC`, [c.from, c.to, ...p])
        .map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.open_n, Math.round(r.open_v), r.won_n, Math.round(r.won_v), r.lost_n, pct(r.won_n, r.won_n + r.lost_n), r.acts]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Open deals', fmt: 'int' }, { header: 'Open value', fmt: 'money' }, { header: 'Won', fmt: 'int' }, { header: 'Won value', fmt: 'money' }, { header: 'Lost', fmt: 'int' }, { header: 'Win rate', fmt: 'pct' }, { header: 'Calls, visits, demos', fmt: 'int' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), pct(sum(rows, 3), sum(rows, 3) + sum(rows, 5)), sum(rows, 7)],
        chart: { title: 'Won value by person', unit: '₹', labels: rows.map((r) => (r[0] as { text: string }).text), values: rows.map((r) => Number(r[4]) || 0) } };
    } },
  { key: 'sales-lost-reasons', module: 'sales', title: 'Why deals were lost', about: 'Lost deals in the period, grouped by the reason given.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'd.owner_id', p);
      const rows = app.db.all<{ r: string; n: number; v: number }>(`SELECT COALESCE(NULLIF(d.lost_reason, ''), 'No reason given') AS r, COUNT(*) AS n, COALESCE(SUM(d.value), 0) AS v FROM deals d WHERE d.stage = 'lost' AND ${ld('d.lost_at')} BETWEEN ? AND ?${w} GROUP BY 1 ORDER BY n DESC`, p).map((r): Cell[] => [r.r, r.n, Math.round(r.v)]);
      const t = sum(rows, 1);
      return { columns: [{ header: 'Reason' }, { header: 'Deals', fmt: 'int' }, { header: 'List value', fmt: 'money' }, { header: 'Share', fmt: 'pct' }], rows: rows.map((r) => [...r, pct(Number(r[1]), t)]), totals: ['Total', t, sum(rows, 2), t ? 100 : null],
        chart: { title: 'Lost deals by reason', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'sales-funnel', module: 'sales', title: 'Stage by stage', about: 'Of the deals created in the period, how many got at least as far as each stage. For a lost deal the stage it reached is worked out from what it had (need recorded, estimate, purchase order), so read this as a guide.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'd.owner_id', p);
      const deals = app.db.all<{ stage: string; quote_attached: number; qualified_need: string | null; po_received: number }>(`SELECT d.stage, d.quote_attached, d.qualified_need, d.po_received FROM deals d WHERE ${ld('d.created_at')} BETWEEN ? AND ?${w}`, p);
      const reached = (d: { stage: string; quote_attached: number; qualified_need: string | null; po_received: number }): number => {
        if (d.stage !== 'lost') return DEAL_STAGES.indexOf(d.stage as typeof DEAL_STAGES[number]);
        return d.po_received ? DEAL_STAGES.indexOf('negotiation') : d.quote_attached ? DEAL_STAGES.indexOf('proposal') : d.qualified_need ? DEAL_STAGES.indexOf('qualified') : 0;
      };
      let prev = deals.length;
      const rows = DEAL_STAGES.map((s, i): Cell[] => { const n = deals.filter((d) => reached(d) >= i).length; const row: Cell[] = [DEAL_LABEL[s], n, pct(n, deals.length), i === 0 ? null : pct(n, prev)]; prev = n; return row; });
      return { columns: [{ header: 'Stage' }, { header: 'Deals that got here', fmt: 'int' }, { header: 'Of all created', fmt: 'pct' }, { header: 'Of the stage before', fmt: 'pct' }], rows, note: `${deals.length} deals were created in the period.`,
        chart: { title: 'Deals reaching each stage', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'sales-estimates', module: 'sales', title: 'Estimates sent and accepted', about: 'Estimates finalised in the period for each person: how many were sent, accepted, declined or ran out of time.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = [localDateString(new Date()), c.from, c.to]; const w = who(c, 'd.owner_id', p);
      const rows = app.db.all<{ id: string; name: string; n: number; sent: number; acc: number; dec: number; exp: number; v: number }>(`SELECT o.id, o.full_name AS name, COUNT(*) AS n,
        SUM(CASE WHEN e.status IN ('sent','accepted','declined') THEN 1 ELSE 0 END) AS sent, SUM(CASE WHEN e.status = 'accepted' THEN 1 ELSE 0 END) AS acc, SUM(CASE WHEN e.status = 'declined' THEN 1 ELSE 0 END) AS dec,
        SUM(CASE WHEN e.status = 'sent' AND e.valid_until < ? THEN 1 ELSE 0 END) AS exp, COALESCE(SUM(CASE WHEN e.status = 'accepted' THEN e.taxable ELSE 0 END), 0) AS v
        FROM estimates e JOIN deals d ON d.id = e.deal_id JOIN employees o ON o.id = d.owner_id WHERE e.status NOT IN ('draft','superseded') AND e.estimate_date BETWEEN ? AND ?${w} GROUP BY o.id ORDER BY v DESC, n DESC`, p)
        .map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.n, r.sent, r.acc, r.dec, r.exp, pct(r.acc, r.acc + r.dec), Math.round(r.v)]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Finalised', fmt: 'int' }, { header: 'Sent', fmt: 'int' }, { header: 'Accepted', fmt: 'int' }, { header: 'Declined', fmt: 'int' }, { header: 'Expired', fmt: 'int' }, { header: 'Accepted of answered', fmt: 'pct' }, { header: 'Accepted value before GST', fmt: 'money' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), pct(sum(rows, 3), sum(rows, 3) + sum(rows, 4)), sum(rows, 7)] };
    } },
  { key: 'sales-products', module: 'sales', title: 'Sales by product', about: 'What was quoted and what customers accepted, product by product, on estimates dated in the period.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'd.owner_id', p);
      const rows = app.db.all<{ name: string; unit: string; q: number; qv: number; a: number; av: number }>(`SELECT i.name, i.unit, SUM(i.qty) AS q, SUM(i.taxable) AS qv, SUM(CASE WHEN e.status = 'accepted' THEN i.qty ELSE 0 END) AS a, SUM(CASE WHEN e.status = 'accepted' THEN i.taxable ELSE 0 END) AS av
        FROM estimate_items i JOIN estimates e ON e.id = i.estimate_id JOIN deals d ON d.id = e.deal_id WHERE e.status IN ('final','sent','accepted','declined') AND e.estimate_date BETWEEN ? AND ?${w} GROUP BY i.name, i.unit ORDER BY av DESC, qv DESC`, p)
        .map((r): Cell[] => [r.name, r.unit, r1(r.q), Math.round(r.qv), r1(r.a), Math.round(r.av)]);
      return { columns: [{ header: 'Product' }, { header: 'Unit' }, { header: 'Quantity quoted', fmt: 'num' }, { header: 'Quoted value', fmt: 'money' }, { header: 'Quantity accepted', fmt: 'num' }, { header: 'Accepted value', fmt: 'money' }], rows, totals: ['Total', null, null, sum(rows, 3), null, sum(rows, 5)],
        chart: { title: 'Accepted value by product', unit: '₹', labels: rows.slice(0, 12).map((r) => String(r[0])), values: rows.slice(0, 12).map((r) => Number(r[5])) } };
    } },
  { key: 'sales-sources', module: 'sales', title: 'Where deals come from', about: 'Deals created in the period by source, and how many of them were won.', filters: ['department', 'person'], allowed: sales,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'd.owner_id', p);
      const rows = app.db.all<{ s: string; n: number; won: number; lost: number; v: number }>(`SELECT COALESCE(NULLIF(d.source, ''), 'Not recorded') AS s, COUNT(*) AS n, SUM(CASE WHEN d.stage = 'won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN d.stage = 'lost' THEN 1 ELSE 0 END) AS lost, COALESCE(SUM(CASE WHEN d.stage = 'won' THEN ${netValue} ELSE 0 END), 0) AS v FROM deals d WHERE ${ld('d.created_at')} BETWEEN ? AND ?${w} GROUP BY 1 ORDER BY n DESC`, p)
        .map((r): Cell[] => [r.s, r.n, r.won, r.lost, r.n - r.won - r.lost, pct(r.won, r.won + r.lost), Math.round(r.v)]);
      return { columns: [{ header: 'Source' }, { header: 'Deals', fmt: 'int' }, { header: 'Won', fmt: 'int' }, { header: 'Lost', fmt: 'int' }, { header: 'Still open', fmt: 'int' }, { header: 'Win rate', fmt: 'pct' }, { header: 'Won value', fmt: 'money' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), pct(sum(rows, 2), sum(rows, 2) + sum(rows, 3)), sum(rows, 6)],
        chart: { title: 'Deals by source', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },

  // ===== Support =====
  { key: 'support-by-customer', module: 'support', title: 'Tickets by customer', about: 'Tickets raised in the period for each customer, how many are still open, and how they were handled.', filters: [], allowed: desk,
    run(app, c) {
      const rows = app.db.all<{ id: string; name: string; n: number; open: number; late: number; h: number | null; rating: number | null }>(`SELECT c.id, c.name, COUNT(*) AS n, SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN t.within_sla = 0 THEN 1 ELSE 0 END) AS late,
        AVG(CASE WHEN t.resolved_at IS NOT NULL THEN (julianday(t.resolved_at) - julianday(t.created_at)) * 24 END) AS h, AVG(t.rating) AS rating FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE ${ld('t.created_at')} BETWEEN ? AND ? GROUP BY c.id ORDER BY n DESC`, [c.from, c.to])
        .map((r): Cell[] => [link(r.name, `/customers/${r.id}`), r.n, r.open, r.late, r1(r.h), r1(r.rating)]);
      return { columns: [{ header: 'Customer', fmt: 'link' }, { header: 'Tickets', fmt: 'int' }, { header: 'Open now', fmt: 'int' }, { header: 'Past resolution time', fmt: 'int' }, { header: 'Average hours to resolve', fmt: 'num' }, { header: 'Average rating (of 5)', fmt: 'num' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), null, null],
        chart: { title: 'Tickets by customer', labels: rows.slice(0, 12).map((r) => (r[0] as { text: string }).text), values: rows.slice(0, 12).map((r) => Number(r[1])) } };
    } },
  { key: 'support-by-type', module: 'support', title: 'Tickets by type and priority', about: 'Tickets raised in the period, by type and priority, with how many were resolved in time.', filters: [], allowed: desk,
    run(app, c) {
      const rows = app.db.all<{ type: string; priority: string; n: number; res: number; ok: number; late: number }>(`SELECT t.type, t.priority, COUNT(*) AS n, SUM(CASE WHEN t.resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS res, SUM(CASE WHEN t.within_sla = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN t.within_sla = 0 THEN 1 ELSE 0 END) AS late FROM tickets t WHERE ${ld('t.created_at')} BETWEEN ? AND ? GROUP BY t.type, t.priority ORDER BY t.type, t.priority`, [c.from, c.to])
        .map((r): Cell[] => [lists.label('desk.types', r.type), lists.label('desk.priorities', r.priority), r.n, r.res, r.ok, r.late, pct(r.ok, r.ok + r.late)]);
      return { columns: [{ header: 'Type' }, { header: 'Priority' }, { header: 'Raised', fmt: 'int' }, { header: 'Resolved', fmt: 'int' }, { header: 'In time', fmt: 'int' }, { header: 'Late', fmt: 'int' }, { header: 'In time', fmt: 'pct' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), pct(sum(rows, 4), sum(rows, 4) + sum(rows, 5))] };
    } },
  { key: 'support-by-person', module: 'support', title: 'Tickets by person', about: 'For each person who owns tickets: what they resolved in the period, how fast, and what customers said.', filters: ['department', 'person'], allowed: desk,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 't.assignee_id', p);
      const rows = app.db.all<{ id: string; name: string; res: number; ok: number; late: number; fr: number | null; h: number | null; rating: number | null; reo: number }>(`SELECT e.id, e.full_name AS name, COUNT(*) AS res, SUM(CASE WHEN t.within_sla = 1 THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN t.within_sla = 0 THEN 1 ELSE 0 END) AS late,
        AVG(CASE WHEN t.first_response_at IS NOT NULL THEN (julianday(t.first_response_at) - julianday(t.created_at)) * 1440 END) AS fr, AVG((julianday(t.resolved_at) - julianday(t.created_at)) * 24) AS h, AVG(t.rating) AS rating, SUM(t.reopen_count) AS reo
        FROM tickets t JOIN employees e ON e.id = t.assignee_id WHERE t.resolved_at IS NOT NULL AND ${ld('t.resolved_at')} BETWEEN ? AND ?${w} GROUP BY e.id ORDER BY res DESC`, p)
        .map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.res, pct(r.ok, r.ok + r.late), r.fr == null ? null : Math.round(r.fr), r1(r.h), r1(r.rating), r.reo]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Resolved', fmt: 'int' }, { header: 'In time', fmt: 'pct' }, { header: 'Average minutes to first reply', fmt: 'int' }, { header: 'Average hours to resolve', fmt: 'num' }, { header: 'Average rating (of 5)', fmt: 'num' }, { header: 'Reopened', fmt: 'int' }], rows, totals: ['Total', sum(rows, 1), null, null, null, null, sum(rows, 6)],
        chart: { title: 'Tickets resolved by person', labels: rows.map((r) => (r[0] as { text: string }).text), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'support-repeat', module: 'support', title: 'Repeat problems', about: 'Customers who raised three or more tickets in the period, and tickets that were reopened. These are the places to look for a root cause.', filters: [], allowed: desk,
    run(app, c) {
      const rows = app.db.all<{ id: string; name: string; n: number; reo: number; last: string; subjects: string }>(`SELECT c.id, c.name, COUNT(*) AS n, SUM(t.reopen_count) AS reo, MAX(${ld('t.created_at')}) AS last, GROUP_CONCAT(t.subject, ' | ') AS subjects FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.type = 'support' AND ${ld('t.created_at')} BETWEEN ? AND ? GROUP BY c.id HAVING COUNT(*) >= 3 OR SUM(t.reopen_count) > 0 ORDER BY n DESC`, [c.from, c.to])
        .map((r): Cell[] => [link(r.name, `/customers/${r.id}`), r.n, r.reo, r.last, r.subjects.length > 160 ? r.subjects.slice(0, 157) + '…' : r.subjects]);
      return { columns: [{ header: 'Customer', fmt: 'link' }, { header: 'Tickets', fmt: 'int' }, { header: 'Times reopened', fmt: 'int' }, { header: 'Last raised', fmt: 'date' }, { header: 'What they were about', width: 60 }], rows };
    } },
  { key: 'support-ratings', module: 'support', title: 'Customer ratings', about: 'Ratings customers gave after a ticket was resolved in the period, lowest first.', filters: ['department', 'person'], allowed: desk,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 't.assignee_id', p);
      const all = app.db.all<{ id: string; subject: string; customer: string; name: string | null; rating: number; d: string }>(`SELECT t.id, t.subject, c.name AS customer, e.full_name AS name, t.rating, ${ld('t.resolved_at')} AS d FROM tickets t JOIN customers c ON c.id = t.customer_id LEFT JOIN employees e ON e.id = t.assignee_id WHERE t.rating IS NOT NULL AND ${ld('t.resolved_at')} BETWEEN ? AND ?${w} ORDER BY t.rating, t.resolved_at DESC LIMIT 500`, p);
      const avg = all.length ? Math.round(all.reduce((n, r) => n + r.rating, 0) / all.length * 10) / 10 : null;
      return { columns: [{ header: 'Ticket', fmt: 'link' }, { header: 'Subject', width: 44 }, { header: 'Customer' }, { header: 'Handled by' }, { header: 'Rating (of 5)', fmt: 'int' }, { header: 'Resolved', fmt: 'date' }], rows: all.map((r): Cell[] => [link(r.id, `/tickets/${r.id}`), r.subject, r.customer, r.name, r.rating, r.d]),
        note: all.length ? `${all.length} ratings, average ${avg} of 5.` : undefined, chart: { title: 'Ratings given', labels: ['1', '2', '3', '4', '5'], values: [1, 2, 3, 4, 5].map((n) => all.filter((r) => r.rating === n).length) } };
    } },
  { key: 'support-implementations', module: 'support', title: 'Implementation timelines', about: 'Implementation tickets raised in the period: days planned against days taken.', filters: [], allowed: desk,
    run(app, c) {
      const rows = app.db.all<{ id: string; subject: string; customer: string; d: string; plan: number | null; days: number; status: string; stage: string | null }>(`SELECT t.id, t.subject, c.name AS customer, ${ld('t.created_at')} AS d, t.impl_plan_days AS plan, CAST(julianday(COALESCE(t.resolved_at, 'now')) - julianday(t.created_at) AS INTEGER) AS days, t.status, t.impl_stage AS stage FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.type = 'implementation' AND ${ld('t.created_at')} BETWEEN ? AND ? ORDER BY t.created_at DESC`, [c.from, c.to])
        .map((r): Cell[] => [link(r.id, `/tickets/${r.id}`), r.customer, r.subject, r.d, r.plan, r.days, r.plan == null ? null : r.days - r.plan, ['resolved', 'closed'].includes(r.status) ? 'Finished' : r.stage ? `Open · ${r.stage}` : 'Open']);
      return { columns: [{ header: 'Ticket', fmt: 'link' }, { header: 'Customer' }, { header: 'Subject', width: 40 }, { header: 'Started', fmt: 'date' }, { header: 'Days planned', fmt: 'int' }, { header: 'Days so far', fmt: 'int' }, { header: 'Days over plan', fmt: 'int' }, { header: 'Status' }], rows };
    } },

  // ===== Development =====
  { key: 'dev-releases', module: 'dev', title: 'Release history', about: 'Releases planned or shipped in the period, with how late they were and how much went into each.', filters: [], allowed: dev,
    run(app, c) {
      const rows = app.db.all<{ id: string; version: string; name: string; project: string | null; planned: string | null; rel: string | null; n: number; bugs: number; status: string }>(`SELECT r.id, r.version, r.name, p.name AS project, r.planned_date AS planned, ${ld('r.released_at')} AS rel, (SELECT COUNT(*) FROM dev_issues i WHERE i.release_id = r.id) AS n, (SELECT COUNT(*) FROM dev_issues i WHERE i.release_id = r.id AND i.type = 'bug') AS bugs, r.status
        FROM releases r LEFT JOIN projects p ON p.id = r.project_id WHERE COALESCE(${ld('r.released_at')}, r.planned_date, ${ld('r.created_at')}) BETWEEN ? AND ? ORDER BY COALESCE(r.released_at, r.planned_date) DESC`, [c.from, c.to])
        .map((r): Cell[] => [link(r.version, `/dev/releases/${r.id}`), r.name, r.project, r.planned, r.rel, r.planned && r.rel ? Math.round((Date.parse(r.rel) - Date.parse(r.planned)) / 86400000) : null, r.n, r.bugs, r.status === 'released' ? 'Released' : 'Planned']);
      return { columns: [{ header: 'Version', fmt: 'link' }, { header: 'Name' }, { header: 'Project' }, { header: 'Planned', fmt: 'date' }, { header: 'Released', fmt: 'date' }, { header: 'Days late', fmt: 'int' }, { header: 'Issues', fmt: 'int' }, { header: 'Of which bugs', fmt: 'int' }, { header: 'Status' }], rows };
    } },
  { key: 'dev-projects', module: 'dev', title: 'Work by project', about: 'For each project: what is open now, what was released in the period, and the hours logged.', filters: [], allowed: dev,
    run(app, c) {
      const rows = app.db.all<{ id: string | null; name: string; open: number; bugs: number; done: number; pts: number; mins: number }>(`SELECT p.id, COALESCE(p.name, 'No project') AS name, SUM(CASE WHEN i.status != 'released' THEN 1 ELSE 0 END) AS open, SUM(CASE WHEN i.status != 'released' AND i.type = 'bug' THEN 1 ELSE 0 END) AS bugs,
        SUM(CASE WHEN i.status = 'released' AND ${ld('i.released_at')} BETWEEN ?1 AND ?2 THEN 1 ELSE 0 END) AS done, COALESCE(SUM(CASE WHEN i.status = 'released' AND ${ld('i.released_at')} BETWEEN ?1 AND ?2 THEN i.points ELSE 0 END), 0) AS pts,
        COALESCE((SELECT SUM(l.minutes) FROM time_logs l JOIN dev_issues x ON x.id = l.entity_id WHERE l.entity_type = 'issue' AND COALESCE(x.project_id, '') = COALESCE(p.id, '') AND ${ld('l.started_at')} BETWEEN ?1 AND ?2), 0) AS mins
        FROM dev_issues i LEFT JOIN projects p ON p.id = i.project_id GROUP BY p.id ORDER BY open DESC`, [c.from, c.to])
        .map((r): Cell[] => [r.id ? link(r.name, `/dev/projects/${r.id}`) : r.name, r.open, r.bugs, r.done, r.pts, r1(r.mins / 60)]);
      return { columns: [{ header: 'Project', fmt: 'link' }, { header: 'Open issues', fmt: 'int' }, { header: 'Open bugs', fmt: 'int' }, { header: 'Released in period', fmt: 'int' }, { header: 'Points released', fmt: 'int' }, { header: 'Hours logged', fmt: 'num' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), r1(sum(rows, 5))],
        chart: { title: 'Hours logged by project', unit: 'h', labels: rows.map((r) => (typeof r[0] === 'object' && r[0] ? r[0].text : String(r[0]))), values: rows.map((r) => Number(r[5]) || 0) } };
    } },
  { key: 'dev-bugs', module: 'dev', title: 'Bugs', about: 'Bugs raised in the period by project and part of the product, with how many are still open and how many came back.', filters: [], allowed: dev,
    run(app, c) {
      const rows = app.db.all<{ project: string; comp: string; n: number; open: number; reo: number; fromCust: number }>(`SELECT COALESCE(p.name, 'No project') AS project, COALESCE(NULLIF(i.component, ''), 'Not set') AS comp, COUNT(*) AS n, SUM(CASE WHEN i.status != 'released' THEN 1 ELSE 0 END) AS open, SUM(i.reopen_count) AS reo, SUM(CASE WHEN i.customer_id IS NOT NULL THEN 1 ELSE 0 END) AS fromCust
        FROM dev_issues i LEFT JOIN projects p ON p.id = i.project_id WHERE i.type = 'bug' AND ${ld('i.created_at')} BETWEEN ? AND ? GROUP BY 1, 2 ORDER BY n DESC`, [c.from, c.to]).map((r): Cell[] => [r.project, r.comp, r.n, r.open, r.reo, r.fromCust]);
      return { columns: [{ header: 'Project' }, { header: 'Part of the product' }, { header: 'Bugs raised', fmt: 'int' }, { header: 'Still open', fmt: 'int' }, { header: 'Times reopened', fmt: 'int' }, { header: 'From a customer', fmt: 'int' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] };
    } },

  // ===== Production =====
  { key: 'prod-on-time', module: 'production', title: 'On-time dispatch by month', about: 'Orders dispatched each month and how many left on or before the promised date.', filters: [], allowed: prod,
    run(app, c) {
      const rows = monthsBetween(c.from, c.to).map((m): Cell[] => {
        const r = app.db.get<{ n: number; ok: number; noDate: number; late: number | null }>(`SELECT COUNT(*) AS n, SUM(CASE WHEN w.promised_date IS NOT NULL AND ${ld('w.dispatched_at')} <= w.promised_date THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN w.promised_date IS NULL THEN 1 ELSE 0 END) AS noDate,
          AVG(CASE WHEN w.promised_date IS NOT NULL AND ${ld('w.dispatched_at')} > w.promised_date THEN julianday(${ld('w.dispatched_at')}) - julianday(w.promised_date) END) AS late FROM work_orders w WHERE w.kind = 'order' AND w.dispatched_at IS NOT NULL AND ${ym('w.dispatched_at')} = ? AND ${ld('w.dispatched_at')} BETWEEN ? AND ?`, [m, c.from, c.to])!;
        const dated = r.n - (r.noDate || 0);
        return [monthLabel(m), r.n, r.ok || 0, dated - (r.ok || 0), pct(r.ok || 0, dated), r1(r.late)];
      });
      return { columns: [{ header: 'Month' }, { header: 'Dispatched', fmt: 'int' }, { header: 'On time', fmt: 'int' }, { header: 'Late', fmt: 'int' }, { header: 'On time', fmt: 'pct' }, { header: 'Average days late', fmt: 'num' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), pct(sum(rows, 2), sum(rows, 2) + sum(rows, 3)), null],
        chart: { title: 'Orders dispatched by month', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'prod-stage-time', module: 'production', title: 'Time in each stage', about: 'For orders dispatched in the period: days waiting to start, days in production and packing, and days from packing to dispatch.', filters: [], allowed: prod,
    run(app, c) {
      const d = (a: string, b: string): string => `julianday(${b}) - julianday(${a})`;
      const rows = app.db.all<{ id: string; customer: string | null; product: string; qty: number; q: number | null; mk: number | null; ds: number | null; dl: number | null; tot: number }>(`SELECT w.id, c.name AS customer, w.product, w.qty, ${d('w.created_at', 'w.started_at')} AS q, ${d('w.started_at', 'w.packed_at')} AS mk, ${d('w.packed_at', 'w.dispatched_at')} AS ds, ${d('w.dispatched_at', 'w.delivered_at')} AS dl, ${d('w.created_at', 'w.dispatched_at')} AS tot
        FROM work_orders w LEFT JOIN customers c ON c.id = w.customer_id WHERE w.kind = 'order' AND w.dispatched_at IS NOT NULL AND ${ld('w.dispatched_at')} BETWEEN ? AND ? ORDER BY w.dispatched_at DESC LIMIT 500`, [c.from, c.to]);
      const avg = (k: 'q' | 'mk' | 'ds' | 'dl' | 'tot'): number | null => { const v = rows.map((r) => r[k]).filter((x): x is number => x != null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
      return { columns: [{ header: 'Order', fmt: 'link' }, { header: 'Customer' }, { header: 'Product' }, { header: 'Qty', fmt: 'int' }, { header: 'Days in queue', fmt: 'num' }, { header: 'Days making and packing', fmt: 'num' }, { header: 'Days packed to dispatch', fmt: 'num' }, { header: 'Days in transit', fmt: 'num' }, { header: 'Days order to dispatch', fmt: 'num' }],
        rows: rows.map((r): Cell[] => [link(r.id, `/work-orders/${r.id}`), r.customer, r.product, r.qty, r1(r.q), r1(r.mk), r1(r.ds), r1(r.dl), r1(r.tot)]), totals: ['Average', null, null, null, avg('q'), avg('mk'), avg('ds'), avg('dl'), avg('tot')],
        chart: { title: 'Average days in each stage', unit: 'days', labels: ['In queue', 'Making and packing', 'Packed to dispatch', 'In transit'], values: [avg('q') || 0, avg('mk') || 0, avg('ds') || 0, avg('dl') || 0] } };
    } },
  { key: 'prod-late', module: 'production', title: 'Late orders', about: 'Orders promised in the period that are past their date and not yet dispatched, or that left late.', filters: [], allowed: prod,
    run(app, c) {
      const today = localDateString(new Date());
      const rows = app.db.all<{ id: string; customer: string | null; product: string; promised: string; stage: string; disp: string | null; mat: string | null; note: string | null; who: string | null }>(`SELECT w.id, c.name AS customer, w.product, w.promised_date AS promised, w.stage, ${ld('w.dispatched_at')} AS disp, w.materials_status AS mat, w.materials_note AS note, e.full_name AS who FROM work_orders w LEFT JOIN customers c ON c.id = w.customer_id LEFT JOIN employees e ON e.id = w.assignee_id
        WHERE w.kind = 'order' AND w.promised_date BETWEEN ? AND ? AND ((w.dispatched_at IS NULL AND w.promised_date < ?) OR (w.dispatched_at IS NOT NULL AND ${ld('w.dispatched_at')} > w.promised_date)) ORDER BY w.promised_date`, [c.from, c.to, today])
        .map((r): Cell[] => [link(r.id, `/work-orders/${r.id}`), r.customer, r.product, r.promised, r.disp, Math.round((Date.parse(r.disp || today) - Date.parse(r.promised)) / 86400000), r.disp ? 'Left late' : `Not dispatched · ${lists.label('production.stages', r.stage)}`, r.mat === 'short' || r.mat === 'waiting' ? `Materials ${r.mat}${r.note ? ': ' + r.note : ''}` : r.note, r.who]);
      return { columns: [{ header: 'Order', fmt: 'link' }, { header: 'Customer' }, { header: 'Product' }, { header: 'Promised', fmt: 'date' }, { header: 'Dispatched', fmt: 'date' }, { header: 'Days late', fmt: 'int' }, { header: 'Status' }, { header: 'Reason noted', width: 40 }, { header: 'With' }], rows };
    } },

  // ===== Finance =====
  { key: 'fin-expenses-category', module: 'finance', title: 'Expenses by category', about: 'Expense claims raised in the period, by category.', filters: ['department', 'person'], allowed: managerOrAbove,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'x.employee_id', p);
      const rows = app.db.all<{ cat: string; n: number; ok: number; pend: number; dec: number }>(`SELECT x.category AS cat, COUNT(*) AS n, COALESCE(SUM(CASE WHEN x.status IN ('approved', 'paid') THEN x.amount ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN x.status = 'pending' THEN x.amount ELSE 0 END), 0) AS pend, COALESCE(SUM(CASE WHEN x.status = 'declined' THEN x.amount ELSE 0 END), 0) AS dec FROM expenses x WHERE x.kind <> 'advance' AND ${ld('x.created_at')} BETWEEN ? AND ?${w} GROUP BY 1 ORDER BY ok DESC`, p).map((r): Cell[] => [r.cat, r.n, Math.round(r.ok), Math.round(r.pend), Math.round(r.dec)]);
      return { columns: [{ header: 'Category' }, { header: 'Claims', fmt: 'int' }, { header: 'Approved', fmt: 'money' }, { header: 'Waiting', fmt: 'money' }, { header: 'Declined', fmt: 'money' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4)],
        chart: { title: 'Approved expenses by category', unit: '₹', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[2])) } };
    } },
  { key: 'fin-expenses-person', module: 'finance', title: 'Expenses by person', about: 'Expense claims raised in the period, person by person, with kilometres claimed.', filters: ['department', 'person'], allowed: managerOrAbove,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'x.employee_id', p);
      const rows = app.db.all<{ id: string; name: string; dept: string; n: number; ok: number; pend: number; km: number }>(`SELECT e.id, e.full_name AS name, d.name AS dept, COUNT(*) AS n, COALESCE(SUM(CASE WHEN x.status IN ('approved', 'paid') THEN x.amount ELSE 0 END), 0) AS ok, COALESCE(SUM(CASE WHEN x.status = 'pending' THEN x.amount ELSE 0 END), 0) AS pend, COALESCE(SUM(x.km), 0) AS km FROM expenses x JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id WHERE x.kind IN ('reimbursement', 'settlement') AND ${ld('x.created_at')} BETWEEN ? AND ?${w} GROUP BY e.id ORDER BY ok DESC`, p)
        .map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.dept, r.n, Math.round(r.ok), Math.round(r.pend), Math.round(r.km)]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Claims', fmt: 'int' }, { header: 'Approved', fmt: 'money' }, { header: 'Waiting', fmt: 'money' }, { header: 'Kilometres', fmt: 'int' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] };
    } },
  { key: 'fin-ledger', module: 'finance', title: 'Expense and advance ledger', about: 'Every line in the ledger for the period: expenses approved, reimbursements paid, advances given, bills accepted against an advance, unspent advance returned, vendor bills and petty cash. Each line shows how it was paid, the reference, and the person\'s balance after it.', filters: ['department', 'person'], allowed: (app, u) => managerOrAbove(app, u) || isAccounts(app, u),
    run(app, c) {
      const TYPE: Record<string, string> = ENTRY_LABEL; const depts = c.departmentId ? new Set(app.db.all<{ id: string }>('SELECT id FROM employees WHERE department_id = ?', [c.departmentId]).map((r) => r.id)) : null;
      const docs = new Map(app.db.all<{ id: string; n: number }>('SELECT expense_id AS id, COUNT(*) AS n FROM expense_docs GROUP BY expense_id').map((r) => [r.id, r.n]));
      const PARTY: Record<string, string> = { employee: 'Employee', vendor: 'Vendor', petty: 'Petty cash' };
      const rows = ledger(app, { employeeId: c.personId || undefined, people: isAccounts(app, c.viewer) ? null : c.people, from: c.from, to: c.to, party: isAccounts(app, c.viewer) && !c.personId ? 'all' : 'employee' }).filter((e) => !depts || depts.has(e.employee_id))
        .map((e): Cell[] => [e.entry_date, PARTY[e.party], e.party === 'employee' ? { text: e.employee_name, href: `/money/ledger?person=${e.employee_id}` } : e.employee_name, e.team, TYPE[e.type] || e.type, e.expense_id ? { text: e.expense_id, href: `/money/${e.expense_id}` } : null, e.category, e.debit || null, e.credit || null, e.mode || null, e.ref || null, e.expense_id ? docs.get(e.expense_id) || 0 : 0, e.balance ?? null]);
      return { columns: [{ header: 'Date', fmt: 'date' }, { header: 'Account' }, { header: 'Person or vendor' }, { header: 'Team' }, { header: 'Entry' }, { header: 'Claim' }, { header: 'Category' }, { header: 'Paid out', fmt: 'money' }, { header: 'Owed or accounted', fmt: 'money' }, { header: 'How paid' }, { header: 'Reference' }, { header: 'Documents', fmt: 'int' }, { header: 'Balance after', fmt: 'money' }], rows,
        totals: ['Total', null, null, null, null, null, null, sum(rows, 7), sum(rows, 8), null, null, null, null],
        note: 'Balance after, for an employee: above zero they hold company money (an advance not yet accounted for); below zero the company owes them. For a vendor: below zero is what is owed to the vendor. For petty cash: the cash in the box.' };
    } },
  { key: 'fin-payables', module: 'finance', title: 'Approved and waiting to be paid', about: 'Reimbursements, advances and vendor bills that are approved but not yet paid by Accounts, oldest first, with days waiting and whether a bill is attached. Not limited by the dates above.', filters: ['department', 'person'], noRange: true, allowed: (app, u) => managerOrAbove(app, u) || isAccounts(app, u),
    run(app, c) {
      const p: Params = []; const w = who({ ...c, people: isAccounts(app, c.viewer) ? null : c.people }, 'x.employee_id', p);
      const rows = app.db.all<{ id: string; emp: string; name: string; team: string; kind: string; category: string; amount: number; at: string; bills: number }>(`SELECT x.id, e.id AS emp, CASE WHEN x.kind = 'vendor' THEN x.vendor_name ELSE e.full_name END AS name, COALESCE((SELECT name FROM departments WHERE id = x.department_id), d.name) AS team, x.kind, x.category, x.amount, COALESCE(t.decided_at, x.created_at) AS at, (SELECT COUNT(*) FROM expense_docs dd WHERE dd.expense_id = x.id AND dd.kind = 'bill') AS bills
        FROM expenses x JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id LEFT JOIN tasks t ON t.id = x.task_id WHERE x.status = 'approved' AND x.kind IN ('reimbursement', 'advance', 'vendor')${w} ORDER BY at`, p)
        .map((r): Cell[] => [{ text: r.id, href: `/money/${r.id}` }, r.name, r.team, r.kind === 'advance' ? 'Advance' : r.kind === 'vendor' ? 'Vendor bill' : 'Reimbursement', r.category, Math.round(r.amount), r.at.slice(0, 10), Math.max(0, Math.floor((Date.now() - new Date(r.at).getTime()) / 86_400_000)), r.kind === 'advance' ? 'Not needed' : r.bills ? 'Yes' : 'No bill']);
      const by = new Map<string, number>(); for (const r of rows) by.set(String(r[2]), (by.get(String(r[2])) || 0) + Number(r[5]));
      return { columns: [{ header: 'Claim' }, { header: 'Person or vendor' }, { header: 'Team' }, { header: 'Kind' }, { header: 'Category' }, { header: 'Amount', fmt: 'money' }, { header: 'Approved on', fmt: 'date' }, { header: 'Days waiting', fmt: 'int' }, { header: 'Bill attached' }], rows,
        totals: ['Total', null, null, null, null, sum(rows, 5), null, null, null], chart: by.size ? { title: 'Waiting to be paid, by team', unit: '₹', labels: [...by.keys()], values: [...by.values()] } : undefined };
    } },
  { key: 'fin-advances', module: 'finance', title: 'Advances: given, accounted for and outstanding', about: 'Every advance given in the period: the amount, bills accepted against it, money returned, what is still with the person, and how many days it has been open.', filters: ['department', 'person'], allowed: (app, u) => managerOrAbove(app, u) || isAccounts(app, u),
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who({ ...c, people: isAccounts(app, c.viewer) ? null : c.people }, 'x.employee_id', p);
      const rows = app.db.all<{ id: string; name: string; team: string; category: string; amount: number; status: string; paid_at: string; settled_at: string | null }>(`SELECT x.id, e.full_name AS name, d.name AS team, x.category, x.amount, x.status, x.paid_at, x.settled_at FROM expenses x JOIN employees e ON e.id = x.employee_id JOIN departments d ON d.id = e.department_id
        WHERE x.kind = 'advance' AND x.status IN ('paid', 'settled') AND date(x.paid_at, ${TZ}) BETWEEN ? AND ?${w} ORDER BY x.paid_at`, p)
        .map((r): Cell[] => { const st = advanceState(app, r.id); const end = r.settled_at ? new Date(r.settled_at).getTime() : Date.now();
          return [{ text: r.id, href: `/money/${r.id}` }, r.name, r.team, r.category, r.paid_at.slice(0, 10), Math.round(r.amount), Math.round(st.billed), Math.round(st.returned), Math.round(st.excessPaid), Math.round(st.balance), Math.max(0, Math.floor((end - new Date(r.paid_at).getTime()) / 86_400_000)), r.status === 'settled' ? 'Settled' : st.pendingBills ? 'Bills waiting for approval' : st.billed ? 'Partly accounted' : 'No bills yet']; });
      const out = new Map<string, number>(); for (const r of rows) if (Number(r[9]) > 0) out.set(String(r[1]), (out.get(String(r[1])) || 0) + Number(r[9]));
      const top = [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      return { columns: [{ header: 'Advance' }, { header: 'Person' }, { header: 'Team' }, { header: 'For' }, { header: 'Given on', fmt: 'date' }, { header: 'Given', fmt: 'money' }, { header: 'Bills accepted', fmt: 'money' }, { header: 'Returned', fmt: 'money' }, { header: 'Paid above advance', fmt: 'money' }, { header: 'Still with person', fmt: 'money' }, { header: 'Days open', fmt: 'int' }, { header: 'Status' }], rows,
        totals: ['Total', null, null, null, null, sum(rows, 5), sum(rows, 6), sum(rows, 7), sum(rows, 8), sum(rows, 9), null, null], chart: top.length ? { title: 'Advance money still with each person', unit: '₹', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) } : undefined };
    } },
  { key: 'fin-cash-out', module: 'finance', title: 'Money paid out, month by month', about: 'For planning budgets: each month\'s reimbursements paid, advances given, unspent advance money returned, vendors paid and petty cash spent, the net cash that left, and the expense actually booked.', filters: ['department'], allowed: (app, u) => managerOrAbove(app, u) || isAccounts(app, u),
    run(app, c) {
      const p: Params = [c.from, c.to]; const dept = c.departmentId ? ' AND e.department_id = ?' : ''; if (c.departmentId) p.push(c.departmentId);
      const dept2 = dept.replace('e.department_id', 'COALESCE(x.department_id, e.department_id)');
      const got = new Map(app.db.all<{ m: string; type: string; d: number; cr: number }>(`SELECT substr(l.entry_date, 1, 7) AS m, l.type, SUM(l.debit) AS d, SUM(l.credit) AS cr FROM expense_ledger l JOIN employees e ON e.id = l.employee_id LEFT JOIN expenses x ON x.id = l.expense_id WHERE l.entry_date BETWEEN ? AND ?${dept2} GROUP BY 1, 2`, p).map((r) => [`${r.m}|${r.type}`, r]));
      const v = (m: string, t: string, side: 'd' | 'cr'): number => Math.round(got.get(`${m}|${t}`)?.[side] || 0);
      const rows = monthsBetween(c.from, c.to).map((m): Cell[] => { const paid = v(m, 'claim_paid', 'd') + v(m, 'excess_paid', 'd'); const adv = v(m, 'advance_paid', 'd'); const back = v(m, 'advance_returned', 'cr');
        const ven = v(m, 'vendor_paid', 'd'); const petty = v(m, 'petty_spend', 'cr');
        return [monthLabel(m), paid, adv, back, ven, petty, paid + adv - back + ven + petty, v(m, 'claim_approved', 'cr') + v(m, 'settlement_approved', 'cr') + v(m, 'vendor_bill', 'cr') + petty]; });
      return { columns: [{ header: 'Month' }, { header: 'Reimbursements paid', fmt: 'money' }, { header: 'Advances given', fmt: 'money' }, { header: 'Advance money returned', fmt: 'money' }, { header: 'Vendors paid', fmt: 'money' }, { header: 'Petty cash spent', fmt: 'money' }, { header: 'Net cash out', fmt: 'money' }, { header: 'Expense booked', fmt: 'money' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7)], chart: { title: 'Net cash out by month', unit: '₹', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Math.max(0, Number(r[6]))) },
        note: 'Net cash out is what left the bank or cash box. Expense booked is what was actually spent on the business; the two differ while advances are outstanding.' };
    } },
  { key: 'fin-gst-input', module: 'finance', title: 'GST on bills (input credit)', about: 'Bills in the period that carry a supplier GSTIN: supplier, GSTIN, bill number and date, value before tax, GST and total. For the accountant to claim input credit; only approved or paid bills are listed.', filters: ['department'], allowed: (app, u) => managerOrAbove(app, u) || isAccounts(app, u),
    run(app, c) {
      const p: Params = [c.from, c.to]; if (c.departmentId) p.push(c.departmentId);
      const KIND: Record<string, string> = { reimbursement: 'Reimbursement', settlement: 'Advance settlement', vendor: 'Vendor bill', petty: 'Petty cash' };
      const rows = app.db.all<{ id: string; kind: string; vendor: string; gstin: string; bill_no: string; day: string; amount: number; gst: number | null; category: string; who: string; docs: number }>(`SELECT x.id, x.kind, x.vendor_name AS vendor, x.vendor_gstin AS gstin, x.bill_no, COALESCE(x.expense_date, date(x.created_at, ${TZ})) AS day, x.amount, x.gst_amount AS gst, x.category, e.full_name AS who, (SELECT COUNT(*) FROM expense_docs dd WHERE dd.expense_id = x.id AND dd.kind = 'bill') AS docs
        FROM expenses x JOIN employees e ON e.id = x.employee_id WHERE x.vendor_gstin <> '' AND x.kind <> 'advance' AND x.status IN ('approved', 'paid') AND COALESCE(x.expense_date, date(x.created_at, ${TZ})) BETWEEN ? AND ?${c.departmentId ? ' AND COALESCE(x.department_id, e.department_id) = ?' : ''} ORDER BY day, x.id`, p)
        .map((r): Cell[] => [r.vendor || null, r.gstin, r.bill_no || null, r.day, Math.round((r.amount - (r.gst || 0)) * 100) / 100, r.gst || 0, r.amount, KIND[r.kind] || r.kind, isAccounts(app, c.viewer) ? { text: r.id, href: `/money/${r.id}` } : r.id, r.category, r.kind === 'vendor' || r.kind === 'petty' ? null : r.who, r.docs ? 'Yes' : 'No bill']);
      const by = new Map<string, number>(); for (const r of rows) by.set(String(r[0] || r[1]), (by.get(String(r[0] || r[1])) || 0) + Number(r[5]));
      const top = [...by.entries()].filter((t) => t[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 15);
      return { columns: [{ header: 'Supplier' }, { header: 'GSTIN' }, { header: 'Bill number' }, { header: 'Bill date', fmt: 'date' }, { header: 'Value before tax', fmt: 'money' }, { header: 'GST', fmt: 'money' }, { header: 'Total', fmt: 'money' }, { header: 'Kind' }, { header: 'Claim' }, { header: 'Category' }, { header: 'Claimed by' }, { header: 'Bill attached' }], rows,
        totals: ['Total', null, null, null, sum(rows, 4), sum(rows, 5), sum(rows, 6), null, null, null, null, null], chart: top.length ? { title: 'GST by supplier', unit: '₹', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) } : undefined,
        note: 'The split between CGST, SGST and IGST is not recorded here; it is on the bill, which is attached to each claim. Check each bill before claiming credit.' };
    } },
  { key: 'fin-purchases', module: 'finance', title: 'Purchases by supplier', about: 'Materials planned, ordered and received in the period, supplier by supplier.', filters: [], allowed: (app, u) => atLeast(app.db, u, 'procurement', 'view'),
    run(app, c) {
      const today = localDateString(new Date());
      const rows = app.db.all<{ s: string; n: number; cost: number; rec: number; pend: number; late: number }>(`SELECT COALESCE(NULLIF(i.supplier, ''), 'Supplier not set') AS s, COUNT(*) AS n, COALESCE(SUM(i.est_cost), 0) AS cost, SUM(CASE WHEN i.status = 'received' THEN 1 ELSE 0 END) AS rec, SUM(CASE WHEN i.status != 'received' THEN 1 ELSE 0 END) AS pend,
        SUM(CASE WHEN (i.status = 'received' AND i.expected_at IS NOT NULL AND date(i.received_at) > date(i.expected_at)) OR (i.status != 'received' AND COALESCE(i.expected_at, i.needed_by) < ?) THEN 1 ELSE 0 END) AS late FROM procurement_items i WHERE ${ld('i.created_at')} BETWEEN ? AND ? GROUP BY 1 ORDER BY cost DESC`, [today, c.from, c.to]).map((r): Cell[] => [r.s, r.n, Math.round(r.cost), r.rec, r.pend, r.late]);
      return { columns: [{ header: 'Supplier' }, { header: 'Items', fmt: 'int' }, { header: 'Estimated cost', fmt: 'money' }, { header: 'Received', fmt: 'int' }, { header: 'Not yet received', fmt: 'int' }, { header: 'Late', fmt: 'int' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] };
    } },
  { key: 'fin-budget', module: 'finance', title: 'Budget against spend', about: 'This financial year, department by department: the budget, what has been spent, and what is waiting for approval.', filters: [], noRange: true, allowed: (app, u) => atLeast(app.db, u, 'budgets', 'view') && managerOrAbove(app, u),
    run(app) {
      const fy = fiscalYear(new Date()); const rows = budgets(app, fy).map((b): Cell[] => [b.department, Math.round(b.amount), Math.round(b.spent), Math.round(b.committed), Math.round(b.remaining), b.pct]);
      return { columns: [{ header: 'Department' }, { header: 'Budget', fmt: 'money' }, { header: 'Spent', fmt: 'money' }, { header: 'Waiting for approval', fmt: 'money' }, { header: 'Left', fmt: 'money' }, { header: 'Used', fmt: 'pct' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), pct(sum(rows, 2), sum(rows, 1))], note: `Financial year ${fy}.`,
        chart: { title: 'Spent by department', unit: '₹', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[2])) } };
    } },

  // ===== Attendance and leave =====
  { key: 'att-summary', module: 'attendance', title: 'Attendance summary', about: 'For each person in the months covered: days present, on leave, absent without leave, and late. Uses whole months.', filters: ['department', 'person'], allowed: attendanceAllowed,
    run(app, c) {
      const months = monthsBetween(c.from, c.to).slice(-6); const p: Params = []; const w = who(c, 'e.id', p, { deptVia: 'e.department_id' });
      const emps = app.db.all<Employee & { dept: string }>(`SELECT e.*, d.name AS dept FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active'${w} ORDER BY e.full_name LIMIT 1500`, p);
      const rows = emps.map((e): Cell[] => { let present = 0, leave = 0, absent = 0, late = 0, working = 0; for (const m of months) { const s = monthSheet(app, e, m); present += s.present; leave += s.leave; absent += s.absent; late += s.late; working += s.workingDays; } return [link(e.full_name, `/attendance?employee=${e.id}&month=${months[months.length - 1]}`), e.dept, working, r1(present), r1(leave), absent, late, pct(present + leave, working)]; });
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Working days', fmt: 'int' }, { header: 'Present', fmt: 'num' }, { header: 'On leave', fmt: 'num' }, { header: 'Absent without leave', fmt: 'int' }, { header: 'Late arrivals', fmt: 'int' }, { header: 'Attendance', fmt: 'pct' }], rows: rows.sort((a, b) => Number(b[5]) - Number(a[5])),
        totals: ['Total', null, sum(rows, 2), r1(sum(rows, 3)), r1(sum(rows, 4)), sum(rows, 5), sum(rows, 6), pct(sum(rows, 3) + sum(rows, 4), sum(rows, 2))], note: `Months covered: ${months.map(monthLabel).join(', ')}. Working days still to come in the current month count as not yet present.` };
    } },
  { key: 'att-late', module: 'attendance', title: 'Late arrivals', about: 'People who arrived late in the period, how often, by how much, and how many of those days were cut to a half day.', filters: ['department', 'person'], allowed: attendanceAllowed,
    run(app, c) {
      const grace = attendanceRules(app).lateGraceMinutes; const p: Params = [grace, c.from, c.to]; const w = who(c, 'a.employee_id', p);
      const rows = app.db.all<{ id: string; name: string; dept: string; n: number; avg: number; mx: number; half: number }>(`SELECT e.id, e.full_name AS name, d.name AS dept, COUNT(*) AS n, AVG(a.minutes_late) AS avg, MAX(a.minutes_late) AS mx, SUM(CASE WHEN a.penalty = 'late_over_allowance' THEN 1 ELSE 0 END) AS half FROM attendance a JOIN employees e ON e.id = a.employee_id JOIN departments d ON d.id = e.department_id WHERE a.minutes_late > ? AND a.date BETWEEN ? AND ?${w} GROUP BY e.id ORDER BY n DESC`, p)
        .map((r): Cell[] => [link(r.name, `/attendance?employee=${r.id}`), r.dept, r.n, Math.round(r.avg), r.mx, r.half]);
      const by = new Map<string, number>(); for (const r of rows) by.set(String(r[1]), (by.get(String(r[1])) || 0) + Number(r[2]));
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Late arrivals', fmt: 'int' }, { header: 'Average minutes late', fmt: 'int' }, { header: 'Most minutes late', fmt: 'int' }, { header: 'Cut to a half day', fmt: 'int' }], rows, totals: ['Total', null, sum(rows, 2), null, null, sum(rows, 5)], note: `Late means more than ${grace} minutes after the shift starts.`,
        chart: { title: 'Late arrivals by department', labels: [...by.keys()], values: [...by.values()] } };
    } },
  { key: 'att-leave', module: 'attendance', title: 'Leave taken and balance', about: 'Approved leave that starts in the period, by type, with what each person has left this financial year.', filters: ['department', 'person'], allowed: attendanceAllowed,
    run(app, c) {
      const types = lists.allItems('hr.leaveTypes'); const fyStart = `${new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1}-04-01`;
      const p: Params = []; const w = who(c, 'e.id', p, { deptVia: 'e.department_id' });
      const emps = app.db.all<{ id: string; name: string; dept: string }>(`SELECT e.id, e.full_name AS name, d.name AS dept FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active'${w} ORDER BY e.full_name LIMIT 1500`, p);
      const taken = app.db.all<{ employee_id: string; type: string; days: number }>("SELECT employee_id, type, SUM(days) AS days FROM leave_requests WHERE status = 'approved' AND from_date BETWEEN ? AND ? GROUP BY employee_id, type", [c.from, c.to]);
      const year = app.db.all<{ employee_id: string; type: string; days: number }>("SELECT employee_id, type, SUM(days) AS days FROM leave_requests WHERE status = 'approved' AND from_date >= ? GROUP BY employee_id, type", [fyStart]);
      const get = (rows: { employee_id: string; type: string; days: number }[], id: string, t: string): number => rows.find((r) => r.employee_id === id && r.type === t)?.days || 0;
      const rows = emps.map((e): Cell[] => { const t = types.map((x) => get(taken, e.id, x.value)); const left = types.filter((x) => x.active).reduce((n, x) => n + Math.max(0, (x.n ?? 0) - get(year, e.id, x.value)), 0); return [link(e.name, `/people/${e.id}`), e.dept, ...t, t.reduce((a, b) => a + b, 0), left]; }).filter((r) => c.personId || c.departmentId || Number(r[2 + types.length]) > 0 || emps.length <= 60);
      const tot = 2 + types.length;
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, ...types.map((t): Column => ({ header: `${t.label} taken`, fmt: 'num' })), { header: 'Total taken', fmt: 'num' }, { header: 'Days left this year', fmt: 'num' }], rows: rows.sort((a, b) => Number(b[tot]) - Number(a[tot])), totals: ['Total', null, ...types.map((_, i) => sum(rows, 2 + i)), sum(rows, tot), null] };
    } },
  { key: 'att-miss-punch', module: 'attendance', title: 'Miss-punch requests', about: 'Correction requests raised in the period, person by person. The full history with reasons is under Attendance → Miss-punch report.', filters: ['department', 'person'], allowed: attendanceAllowed,
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'r.employee_id', p);
      const rows = app.db.all<{ id: string; name: string; dept: string; n: number; ok: number; dec: number; wait: number }>(`SELECT e.id, e.full_name AS name, d.name AS dept, COUNT(*) AS n, SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN r.status = 'declined' THEN 1 ELSE 0 END) AS dec, SUM(CASE WHEN r.status IN ('pending','validated') THEN 1 ELSE 0 END) AS wait FROM attendance_regularisations r JOIN employees e ON e.id = r.employee_id JOIN departments d ON d.id = e.department_id WHERE r.date BETWEEN ? AND ?${w} GROUP BY e.id ORDER BY n DESC`, p)
        .map((r): Cell[] => [link(r.name, `/attendance/miss-punch?employee=${r.id}`), r.dept, r.n, r.ok, r.dec, r.wait]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Requests', fmt: 'int' }, { header: 'Approved', fmt: 'int' }, { header: 'Declined', fmt: 'int' }, { header: 'Waiting', fmt: 'int' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5)] };
    } },

  // ===== Hiring =====
  { key: 'hire-time', module: 'hiring', title: 'Time to hire', about: 'People who accepted an offer or were hired in the period: days from application to offer accepted.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const rows = app.db.all<{ id: string; name: string; role: string; src: string | null; rec: string; acc: string; days: number; joined: string | null }>(`SELECT a.id, cd.full_name AS name, q.title AS role, upper(substr(a.source, 1, 1)) || substr(a.source, 2) AS src, date(a.received_at) AS rec, ${ld('o.responded_at')} AS acc, CAST(julianday(o.responded_at) - julianday(a.received_at) AS INTEGER) AS days, o.joining_date AS joined
        FROM offers o JOIN applications a ON a.id = o.application_id JOIN candidates cd ON cd.id = a.candidate_id JOIN requisitions q ON q.id = a.requisition_id WHERE o.status = 'accepted' AND ${ld('o.responded_at')} BETWEEN ? AND ? ORDER BY o.responded_at DESC`, [c.from, c.to]);
      const avg = rows.length ? Math.round(rows.reduce((n, r) => n + r.days, 0) / rows.length) : null;
      return { columns: [{ header: 'Candidate', fmt: 'link' }, { header: 'Vacancy' }, { header: 'Source' }, { header: 'Applied', fmt: 'date' }, { header: 'Accepted', fmt: 'date' }, { header: 'Days', fmt: 'int' }, { header: 'Joining', fmt: 'date' }], rows: rows.map((r): Cell[] => [link(r.name, `/hire/app/${r.id}`), r.role, r.src, r.rec, r.acc, r.days, r.joined]), totals: ['Average', null, null, null, null, avg, null] };
    } },
  { key: 'hire-sources', module: 'hiring', title: 'Candidates by source', about: 'Applications received in the period by where the candidate came from, and how far they went.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const i = (s: string): number => (HIRE_STAGES as readonly string[]).indexOf(s);
      const apps = app.db.all<{ src: string; stage: string; status: string; outcome: string | null; offer: number }>(`SELECT COALESCE(NULLIF(upper(substr(a.source, 1, 1)) || substr(a.source, 2), ''), 'Not recorded') AS src, a.stage, a.status, a.outcome, (SELECT COUNT(*) FROM offers o WHERE o.application_id = a.id AND o.status IN ('issued','accepted','declined','expired')) AS offer FROM applications a WHERE date(a.received_at) BETWEEN ? AND ?`, [c.from, c.to]);
      const by = new Map<string, typeof apps>(); for (const a of apps) by.set(a.src, [...(by.get(a.src) || []), a]);
      const rows = [...by.entries()].map(([src, l]): Cell[] => { const hired = l.filter((a) => i(a.stage) >= i('onboarding')).length; return [src, l.length, l.filter((a) => i(a.stage) >= i('interview')).length, l.filter((a) => a.offer > 0).length, hired, pct(hired, l.length)]; }).sort((a, b) => Number(b[1]) - Number(a[1]));
      return { columns: [{ header: 'Source' }, { header: 'Applications', fmt: 'int' }, { header: 'Reached interview', fmt: 'int' }, { header: 'Offered', fmt: 'int' }, { header: 'Accepted or hired', fmt: 'int' }, { header: 'Hired of applied', fmt: 'pct' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), pct(sum(rows, 4), sum(rows, 1))],
        chart: { title: 'Applications by source', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-funnel', module: 'hiring', title: 'Where candidates drop off', about: 'Applications received in the period: how many reached each stage, and how many were closed at that stage.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const apps = app.db.all<{ stage: string; status: string }>('SELECT stage, status FROM applications WHERE date(received_at) BETWEEN ? AND ?', [c.from, c.to]); let prev = apps.length;
      const rows = HIRE_STAGES.map((s, i): Cell[] => { const n = apps.filter((a) => (HIRE_STAGES as readonly string[]).indexOf(a.stage) >= i).length; const closedHere = apps.filter((a) => a.stage === s && a.status === 'closed').length; const row: Cell[] = [HIRE_LABEL[s], n, i === 0 ? null : pct(n, prev), closedHere, apps.filter((a) => a.stage === s && a.status !== 'closed').length]; prev = n; return row; });
      return { columns: [{ header: 'Stage' }, { header: 'Reached', fmt: 'int' }, { header: 'Of the stage before', fmt: 'pct' }, { header: 'Closed at this stage', fmt: 'int' }, { header: 'Here now', fmt: 'int' }], rows, note: `${apps.length} applications were received in the period.`,
        chart: { title: 'Candidates reaching each stage', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-offers', module: 'hiring', title: 'Offers', about: 'Offers issued in the period by vacancy, and what became of them.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const rows = app.db.all<{ role: string; n: number; acc: number; dec: number; exp: number; can: number; open: number }>(`SELECT q.title AS role, COUNT(*) AS n, SUM(CASE WHEN o.status = 'accepted' THEN 1 ELSE 0 END) AS acc, SUM(CASE WHEN o.status = 'declined' THEN 1 ELSE 0 END) AS dec, SUM(CASE WHEN o.status = 'expired' THEN 1 ELSE 0 END) AS exp, SUM(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) AS can, SUM(CASE WHEN o.status = 'issued' THEN 1 ELSE 0 END) AS open
        FROM offers o JOIN applications a ON a.id = o.application_id JOIN requisitions q ON q.id = a.requisition_id WHERE o.issued_at IS NOT NULL AND ${ld('o.issued_at')} BETWEEN ? AND ? GROUP BY q.id ORDER BY n DESC`, [c.from, c.to]).map((r): Cell[] => [r.role, r.n, r.acc, r.dec, r.exp, r.can, r.open, pct(r.acc, r.acc + r.dec + r.exp)]);
      return { columns: [{ header: 'Vacancy' }, { header: 'Issued', fmt: 'int' }, { header: 'Accepted', fmt: 'int' }, { header: 'Declined', fmt: 'int' }, { header: 'Expired', fmt: 'int' }, { header: 'Cancelled', fmt: 'int' }, { header: 'Waiting', fmt: 'int' }, { header: 'Accepted of answered', fmt: 'pct' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), pct(sum(rows, 2), sum(rows, 2) + sum(rows, 3) + sum(rows, 4))] };
    } },

  { key: 'hire-source-stage', module: 'hiring', title: 'Source by stage', about: 'Applications received in the period: for each source, where those candidates stand today, stage by stage.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const apps = app.db.all<{ src: string; stage: string; status: string; outcome: string | null }>(`SELECT COALESCE(NULLIF(upper(substr(a.source, 1, 1)) || substr(a.source, 2), ''), 'Not recorded') AS src, a.stage, a.status, a.outcome FROM applications a WHERE ${ld('a.received_at')} BETWEEN ? AND ?`, [c.from, c.to]);
      const srcs = [...new Set(apps.map((a) => a.src))];
      const rows = srcs.map((s): Cell[] => { const l = apps.filter((a) => a.src === s); const live = l.filter((a) => a.status !== 'closed');
        return [s, l.length, ...HIRE_STAGES.map((st) => live.filter((a) => a.stage === st).length), l.filter((a) => a.status === 'closed' && a.outcome !== 'hired').length, pct(l.filter((a) => a.stage === 'hired' || a.outcome === 'hired').length, l.length)]; }).sort((a, b) => Number(b[1]) - Number(a[1]));
      const n = HIRE_STAGES.length;
      return { columns: [{ header: 'Source' }, { header: 'Applications', fmt: 'int' }, ...HIRE_STAGES.map((st) => ({ header: HIRE_LABEL[st], fmt: 'int' as const })), { header: 'Closed, not hired', fmt: 'int' }, { header: 'Hired of applied', fmt: 'pct' }], rows,
        totals: ['Total', sum(rows, 1), ...HIRE_STAGES.map((_s, i) => sum(rows, 2 + i)), sum(rows, 2 + n), pct(apps.filter((a) => a.stage === 'hired' || a.outcome === 'hired').length, apps.length)],
        note: 'Stage columns count candidates still in play. A candidate who was closed is counted under “Closed, not hired”.', chart: { title: 'Applications by source', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-aging', module: 'hiring', title: 'Waiting time and overdue', about: 'Every candidate in play today: how long they have been in their stage, the time limit for that stage, and how far over it they are.', filters: [], noRange: true, allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app) {
      const limits = new Map(app.db.all<{ stage: string; days: number }>('SELECT stage, days FROM hire_stage_limits').map((r) => [r.stage, r.days]));
      const DEF: Record<string, number> = { applied: 2, screening: 3, assessment: 5, interview: 7, decision: 3, offer: 7, onboarding: 14 };
      const list = app.db.all<{ id: string; name: string; role: string; src: string; stage: string; since: string; days: number; owner: string | null; status: string }>(`SELECT a.id, cd.full_name AS name, q.title AS role, upper(substr(a.source, 1, 1)) || substr(a.source, 2) AS src, a.stage, a.stage_since AS since, CAST(julianday('now') - julianday(a.stage_since) AS INTEGER) AS days, e.full_name AS owner, a.status
        FROM applications a JOIN candidates cd ON cd.id = a.candidate_id JOIN requisitions q ON q.id = a.requisition_id LEFT JOIN employees e ON e.id = a.owner_id WHERE a.status IN ('active','on_hold') AND a.stage <> 'hired'`);
      const rows = list.map((r): Cell[] => { const lim = limits.get(r.stage) ?? DEF[r.stage] ?? 7; const over = r.status === 'active' && lim ? Math.max(0, r.days - lim) : 0; return [link(r.name, `/hire/app/${r.id}`), r.role, HIRE_LABEL[r.stage] || r.stage, r.status === 'on_hold' ? 'On hold' : 'Active', r.since.slice(0, 10), r.days, lim || null, over, r.owner, r.src]; })
        .sort((a, b) => Number(b[7]) - Number(a[7]) || Number(b[5]) - Number(a[5]));
      const overN = rows.filter((r) => Number(r[7]) > 0).length;
      const byStage = HIRE_STAGES.filter((s) => s !== 'hired').map((s) => rows.filter((r) => r[2] === HIRE_LABEL[s] && Number(r[7]) > 0).length);
      return { columns: [{ header: 'Candidate', fmt: 'link' }, { header: 'Vacancy' }, { header: 'Stage' }, { header: 'Status' }, { header: 'In stage since', fmt: 'date' }, { header: 'Days in stage', fmt: 'int' }, { header: 'Limit (days)', fmt: 'int' }, { header: 'Days over', fmt: 'int' }, { header: 'With' }, { header: 'Source' }], rows,
        totals: [`${overN} over the limit`, null, null, null, null, rows.length ? Math.round(sum(rows, 5) / rows.length) : null, null, sum(rows, 7), null, null], note: 'Candidates on hold are listed but never counted as over the limit. Limits are set in Hiring, Overdue.',
        chart: { title: 'Over the limit, by stage', labels: HIRE_STAGES.filter((s) => s !== 'hired').map((s) => HIRE_LABEL[s]), values: byStage } };
    } },
  { key: 'hire-stage-time', module: 'hiring', title: 'Days spent in each stage', about: 'For applications received in the period: how long candidates stayed in each stage before moving on or being closed.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const ev = app.db.all<{ id: string; from_stage: string | null; to_stage: string | null; at: string; received: string; kind: string }>(`SELECT a.id, ev.from_stage, ev.to_stage, ev.at, a.received_at AS received, ev.kind FROM application_events ev JOIN applications a ON a.id = ev.application_id
        WHERE ${ld('a.received_at')} BETWEEN ? AND ? AND (ev.from_stage IS NOT NULL OR ev.to_stage IS NOT NULL) ORDER BY ev.application_id, ev.at, ev.id`, [c.from, c.to]);
      const spent = new Map<string, number[]>(); const enter = new Map<string, { stage: string; at: string }>();
      for (const e of ev) {
        const cur = enter.get(e.id);
        if (cur && e.from_stage && cur.stage === e.from_stage && e.to_stage !== e.from_stage) { const d = (new Date(e.at).getTime() - new Date(cur.at).getTime()) / 86_400_000; spent.set(cur.stage, [...(spent.get(cur.stage) || []), d]); }
        if (e.to_stage) enter.set(e.id, { stage: e.to_stage, at: e.at }); else if (e.kind === 'closed') enter.delete(e.id);
      }
      const med = (l: number[]): number | null => { if (!l.length) return null; const s = [...l].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
      const rows = HIRE_STAGES.filter((s) => s !== 'hired').map((s): Cell[] => { const l = spent.get(s) || []; return [HIRE_LABEL[s], l.length, l.length ? Math.round((l.reduce((a, b) => a + b, 0) / l.length) * 10) / 10 : null, med(l), l.length ? Math.round(Math.max(...l) * 10) / 10 : null]; });
      return { columns: [{ header: 'Stage' }, { header: 'Candidates who left it', fmt: 'int' }, { header: 'Average days', fmt: 'num' }, { header: 'Middle value (days)', fmt: 'num' }, { header: 'Longest (days)', fmt: 'num' }], rows,
        note: 'Counts a candidate once for each time they left a stage, forward or by being closed. People still in a stage are in the “Waiting time and overdue” report.', chart: { title: 'Average days in each stage', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[2] || 0)) } };
    } },
  { key: 'hire-vacancies', module: 'hiring', title: 'Vacancy summary', about: 'Each vacancy that was open at some point in the period: applications, interviews, offers, people hired and how long it has been open.', filters: ['department'], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const p: Params = [c.to, c.from]; if (c.departmentId) p.push(c.departmentId);
      const rows = app.db.all<{ id: string; title: string; dept: string | null; status: string; positions: number; opened: string; closed: string | null; apps: number; link: number; live: number; ivs: number; offers: number; hired: number; rec: string | null }>(`SELECT q.id, q.title, d.name AS dept, q.status, q.positions, date(COALESCE(q.approved_at, q.created_at)) AS opened, date(q.closed_at) AS closed, e.full_name AS rec,
          (SELECT COUNT(*) FROM applications a WHERE a.requisition_id = q.id) AS apps, (SELECT COUNT(*) FROM applications a WHERE a.requisition_id = q.id AND a.source = 'Apply link') AS link,
          (SELECT COUNT(*) FROM applications a WHERE a.requisition_id = q.id AND a.status <> 'closed') AS live, (SELECT COUNT(*) FROM interviews i JOIN applications a ON a.id = i.application_id WHERE a.requisition_id = q.id AND i.status = 'completed') AS ivs,
          (SELECT COUNT(*) FROM offers o JOIN applications a ON a.id = o.application_id WHERE a.requisition_id = q.id AND o.issued_at IS NOT NULL) AS offers, (SELECT COUNT(*) FROM applications a WHERE a.requisition_id = q.id AND (a.stage = 'hired' OR a.outcome = 'hired')) AS hired
        FROM requisitions q LEFT JOIN departments d ON d.id = q.department_id LEFT JOIN employees e ON e.id = q.recruiter_id
        WHERE q.status <> 'draft' AND date(COALESCE(q.approved_at, q.created_at)) <= ? AND (q.closed_at IS NULL OR date(q.closed_at) >= ?) ${c.departmentId ? 'AND q.department_id = ?' : ''} ORDER BY opened DESC`, p)
        .map((r): Cell[] => { const end = r.closed || c.to; const open = Math.max(0, Math.round((new Date(end).getTime() - new Date(r.opened).getTime()) / 86_400_000)); return [link(r.title, `/hire/req/${r.id}`), r.dept, r.status.charAt(0).toUpperCase() + r.status.slice(1), r.positions, r.hired, r.apps, r.link, r.live, r.ivs, r.offers, open, r.rec]; });
      return { columns: [{ header: 'Vacancy', fmt: 'link' }, { header: 'Department' }, { header: 'Status' }, { header: 'Positions', fmt: 'int' }, { header: 'Hired', fmt: 'int' }, { header: 'Applications', fmt: 'int' }, { header: 'Through Apply link', fmt: 'int' }, { header: 'In play', fmt: 'int' }, { header: 'Interviews held', fmt: 'int' }, { header: 'Offers', fmt: 'int' }, { header: 'Days open', fmt: 'int' }, { header: 'Recruiter' }], rows,
        totals: ['Total', null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7), sum(rows, 8), sum(rows, 9), rows.length ? Math.round(sum(rows, 10) / rows.length) : null, null],
        chart: { title: 'Applications per vacancy', labels: rows.slice(0, 12).map((r) => (r[0] as { text: string }).text), values: rows.slice(0, 12).map((r) => Number(r[5])) } };
    } },
  { key: 'hire-interviewers', module: 'hiring', title: 'Interviews by interviewer', about: 'Interviews that took place in the period: how many each person sat on, and whether their scorecards came in.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const rows = app.db.all<{ name: string; n: number; done: number; noshow: number; upcoming: number; cards: number; avg: number | null; hrs: number | null; yes: number }>(`SELECT e.full_name AS name, COUNT(*) AS n, SUM(CASE WHEN i.status = 'completed' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN i.status = 'no_show' THEN 1 ELSE 0 END) AS noshow, SUM(CASE WHEN i.status = 'scheduled' THEN 1 ELSE 0 END) AS upcoming,
          SUM(CASE WHEN s.submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS cards, AVG(CASE WHEN s.submitted_at IS NOT NULL THEN s.overall END) AS avg, AVG(CASE WHEN s.submitted_at IS NOT NULL THEN (julianday(s.submitted_at) - julianday(i.ends_at)) * 24 END) AS hrs,
          SUM(CASE WHEN s.submitted_at IS NOT NULL AND s.recommendation IN ('strong_yes','yes','hire','strong_hire') THEN 1 ELSE 0 END) AS yes
        FROM interview_panel p JOIN interviews i ON i.id = p.interview_id JOIN employees e ON e.id = p.interviewer_id LEFT JOIN scorecards s ON s.interview_id = i.id AND s.interviewer_id = p.interviewer_id
        WHERE i.status <> 'cancelled' AND ${ld('i.starts_at')} BETWEEN ? AND ? GROUP BY p.interviewer_id ORDER BY n DESC`, [c.from, c.to])
        .map((r): Cell[] => [r.name, r.n, r.done, r.noshow, r.upcoming, r.cards, Math.max(0, r.done - r.cards), r.avg === null ? null : Math.round(r.avg * 10) / 10, pct(r.yes, r.cards), r.hrs === null ? null : Math.max(0, Math.round(r.hrs))]);
      return { columns: [{ header: 'Interviewer' }, { header: 'Interviews', fmt: 'int' }, { header: 'Held', fmt: 'int' }, { header: 'Candidate did not come', fmt: 'int' }, { header: 'Still to come', fmt: 'int' }, { header: 'Scorecards in', fmt: 'int' }, { header: 'Scorecards owed', fmt: 'int' }, { header: 'Average score', fmt: 'num' }, { header: 'Said yes', fmt: 'pct' }, { header: 'Hours to write scorecard', fmt: 'int' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), null, null, null], chart: { title: 'Interviews per interviewer', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-recruiters', module: 'hiring', title: 'Work by recruiter', about: 'Applications received in the period by the person looking after them: how many are still in play, hired, closed, and over the time limit today.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const limits = new Map(app.db.all<{ stage: string; days: number }>('SELECT stage, days FROM hire_stage_limits').map((r) => [r.stage, r.days])); const DEF: Record<string, number> = { applied: 2, screening: 3, assessment: 5, interview: 7, decision: 3, offer: 7, onboarding: 14 };
      const apps = app.db.all<{ owner: string; stage: string; status: string; outcome: string | null; days: number }>(`SELECT COALESCE(e.full_name, 'Nobody yet') AS owner, a.stage, a.status, a.outcome, CAST(julianday('now') - julianday(a.stage_since) AS INTEGER) AS days FROM applications a LEFT JOIN employees e ON e.id = a.owner_id WHERE ${ld('a.received_at')} BETWEEN ? AND ?`, [c.from, c.to]);
      const rows = [...new Set(apps.map((a) => a.owner))].map((o): Cell[] => { const l = apps.filter((a) => a.owner === o); const hired = l.filter((a) => a.stage === 'hired' || a.outcome === 'hired').length; const live = l.filter((a) => a.status !== 'closed' && a.stage !== 'hired');
        const over = live.filter((a) => a.status === 'active' && (limits.get(a.stage) ?? DEF[a.stage] ?? 7) > 0 && a.days > (limits.get(a.stage) ?? DEF[a.stage] ?? 7)).length;
        return [o, l.length, live.length, over, l.filter((a) => (HIRE_STAGES as readonly string[]).indexOf(a.stage) >= (HIRE_STAGES as readonly string[]).indexOf('interview')).length, hired, l.filter((a) => a.status === 'closed' && a.outcome !== 'hired').length, pct(hired, l.length)]; }).sort((a, b) => Number(b[1]) - Number(a[1]));
      return { columns: [{ header: 'Looked after by' }, { header: 'Applications', fmt: 'int' }, { header: 'In play', fmt: 'int' }, { header: 'Over the limit today', fmt: 'int' }, { header: 'Reached interview', fmt: 'int' }, { header: 'Hired', fmt: 'int' }, { header: 'Closed, not hired', fmt: 'int' }, { header: 'Hired of applied', fmt: 'pct' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), pct(sum(rows, 5), sum(rows, 1))], chart: { title: 'Applications by recruiter', labels: rows.map((r) => String(r[0])), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-closed', module: 'hiring', title: 'Why candidates were closed', about: 'Applications closed in the period without a hire: the outcome, the stage they had reached, and the reason written down.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const OUT: Record<string, string> = { rejected: 'Rejected', withdrawn: 'Withdrawn', no_show: 'No show', offer_declined: 'Offer declined', declined_offer: 'Offer declined', offer_expired: 'Offer expired', duplicate: 'Duplicate record' };
      const list = app.db.all<{ id: string; name: string; role: string; src: string; stage: string; outcome: string; reason: string; at: string; by: string | null; days: number }>(`SELECT a.id, cd.full_name AS name, q.title AS role, upper(substr(a.source, 1, 1)) || substr(a.source, 2) AS src, a.stage, a.outcome, a.outcome_reason AS reason, ${ld('a.decision_at')} AS at, e.full_name AS by, CAST(julianday(a.decision_at) - julianday(a.received_at) AS INTEGER) AS days
        FROM applications a JOIN candidates cd ON cd.id = a.candidate_id JOIN requisitions q ON q.id = a.requisition_id LEFT JOIN employees e ON e.id = a.decision_by WHERE a.status = 'closed' AND COALESCE(a.outcome, '') <> 'hired' AND a.decision_at IS NOT NULL AND ${ld('a.decision_at')} BETWEEN ? AND ? ORDER BY a.decision_at DESC`, [c.from, c.to]);
      const rows = list.map((r): Cell[] => [link(r.name, `/hire/app/${r.id}`), r.role, OUT[r.outcome] || r.outcome, HIRE_LABEL[r.stage] || r.stage, r.reason, r.at, r.days, r.by, r.src]);
      const kinds = [...new Set(list.map((r) => OUT[r.outcome] || r.outcome))];
      return { columns: [{ header: 'Candidate', fmt: 'link' }, { header: 'Vacancy' }, { header: 'Outcome' }, { header: 'Stage reached' }, { header: 'Reason' }, { header: 'Closed on', fmt: 'date' }, { header: 'Days after applying', fmt: 'int' }, { header: 'Closed by' }, { header: 'Source' }], rows,
        totals: [`${rows.length} closed`, null, null, null, null, null, rows.length ? Math.round(sum(rows, 6) / rows.length) : null, null, null], chart: { title: 'Closed applications by outcome', labels: kinds, values: kinds.map((k) => rows.filter((r) => r[2] === k).length) } };
    } },
  { key: 'hire-weekly', module: 'hiring', title: 'Applications week by week', about: 'Applications received each week in the period, how many came through the public Apply link, and how far that week’s candidates have gone.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const apps = app.db.all<{ d: string; src: string; stage: string; outcome: string | null }>(`SELECT ${ld('a.received_at')} AS d, upper(substr(a.source, 1, 1)) || substr(a.source, 2) AS src, a.stage, a.outcome FROM applications a WHERE ${ld('a.received_at')} BETWEEN ? AND ? ORDER BY a.received_at`, [c.from, c.to]);
      const monday = (d: string): string => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
      const idx = (s: string): number => (HIRE_STAGES as readonly string[]).indexOf(s);
      const rows = [...new Set(apps.map((a) => monday(a.d)))].map((w): Cell[] => { const l = apps.filter((a) => monday(a.d) === w); const hired = l.filter((a) => a.stage === 'hired' || a.outcome === 'hired').length;
        return [w, l.length, l.filter((a) => a.src === 'Apply link').length, l.filter((a) => /referr/i.test(a.src)).length, l.filter((a) => idx(a.stage) >= idx('interview')).length, l.filter((a) => idx(a.stage) >= idx('offer')).length, hired]; });
      return { columns: [{ header: 'Week starting', fmt: 'date' }, { header: 'Applications', fmt: 'int' }, { header: 'Through Apply link', fmt: 'int' }, { header: 'Referred', fmt: 'int' }, { header: 'Reached interview', fmt: 'int' }, { header: 'Reached offer', fmt: 'int' }, { header: 'Hired', fmt: 'int' }], rows,
        totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6)], chart: { title: 'Applications per week', labels: rows.map((r) => String(r[0]).slice(5)), values: rows.map((r) => Number(r[1])) } };
    } },
  { key: 'hire-messages', module: 'hiring', title: 'Messages to candidates', about: 'Every message sent or prepared for a candidate in the period, by template, with the result.', filters: [], allowed: (app, u) => can(app.db, u, 'hire.manage'),
    run(app, c) {
      const ST: Record<string, string> = { accepted: 'Emailed', manual: 'Sent by HR from own mail', failed: 'Failed', uncertain: 'Not confirmed', not_sent: 'Not sent' };
      const rows = app.db.all<{ id: string; name: string; role: string; kind: string; tname: string | null; subject: string; state: string; at: string; by: string | null }>(`SELECT a.id, cd.full_name AS name, q.title AS role, m.kind, t.name AS tname, m.subject, m.state, ${ld('m.at')} AS at, e.full_name AS by
        FROM hire_messages m JOIN applications a ON a.id = m.application_id JOIN candidates cd ON cd.id = a.candidate_id JOIN requisitions q ON q.id = a.requisition_id LEFT JOIN hire_templates t ON t.key = m.kind LEFT JOIN employees e ON e.id = m.actor_id
        WHERE ${ld('m.at')} BETWEEN ? AND ? ORDER BY m.at DESC`, [c.from, c.to]).map((r): Cell[] => [r.at, link(r.name, `/hire/app/${r.id}`), r.role, r.tname || r.kind.replace(/_/g, ' '), r.subject, ST[r.state] || r.state, r.by]);
      const kinds = [...new Set(rows.map((r) => String(r[3])))];
      return { columns: [{ header: 'Date', fmt: 'date' }, { header: 'Candidate', fmt: 'link' }, { header: 'Vacancy' }, { header: 'Message' }, { header: 'Subject' }, { header: 'Result' }, { header: 'Sent by' }], rows, totals: [`${rows.length} messages`, null, null, null, null, `${rows.filter((r) => r[5] === 'Failed').length} failed`, null],
        chart: { title: 'Messages by kind', labels: kinds, values: kinds.map((k) => rows.filter((r) => r[3] === k).length) } };
    } },

  // ===== Appraisals =====
  { key: 'appr-ratings', module: 'appraisals', title: 'Ratings by department', about: 'Final ratings on appraisals whose cycle ends in the period, department by department.', filters: ['department'], allowed: (app, u) => can(app.db, u, 'appraisals.manage'),
    run(app, c) {
      const p: Params = [c.from, c.to]; if (c.departmentId) p.push(c.departmentId);
      const all = app.db.all<{ dept: string; r: number | null }>(`SELECT d.name AS dept, COALESCE(a.final_rating, a.manager_rating) AS r FROM appraisals a JOIN employees e ON e.id = a.employee_id JOIN departments d ON d.id = e.department_id LEFT JOIN appraisal_cycles cy ON cy.id = a.cycle_id WHERE COALESCE(cy.period_to, a.due_date, date(a.created_at)) BETWEEN ? AND ?${c.departmentId ? ' AND e.department_id = ?' : ''}`, p);
      const depts = [...new Set(all.map((a) => a.dept))].sort();
      const rows = depts.map((d): Cell[] => { const l = all.filter((a) => a.dept === d); const rated = l.filter((a) => a.r != null); return [d, l.length, ...RATINGS.map((r) => rated.filter((a) => a.r === r.value).length), l.length - rated.length, rated.length ? r1(rated.reduce((n, a) => n + (a.r as number), 0) / rated.length) : null]; });
      return { columns: [{ header: 'Department' }, { header: 'Appraisals', fmt: 'int' }, ...RATINGS.map((r): Column => ({ header: `${r.value} · ${r.label}`, fmt: 'int' })), { header: 'Not rated yet', fmt: 'int' }, { header: 'Average', fmt: 'num' }], rows, totals: ['Total', sum(rows, 1), ...RATINGS.map((_, i) => sum(rows, 2 + i)), sum(rows, 2 + RATINGS.length), null] };
    } },
  { key: 'appr-increments', module: 'appraisals', title: 'Increments', about: 'Increments decided in the period, person by person.', filters: ['department', 'person'], allowed: (app, u) => can(app.db, u, 'appraisals.manage'),
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who({ ...c, people: null }, 'a.employee_id', p);
      const rows = app.db.all<{ id: string; eid: string; name: string; dept: string; rating: number | null; pct: number | null; amt: number | null; status: string; at: string | null }>(`SELECT a.id, e.id AS eid, e.full_name AS name, d.name AS dept, a.final_rating AS rating, a.increment_pct AS pct, a.increment_amount AS amt, a.status, ${ld('a.approved_at')} AS at FROM appraisals a JOIN employees e ON e.id = a.employee_id JOIN departments d ON d.id = e.department_id WHERE a.increment_pct IS NOT NULL AND ${ld('COALESCE(a.approved_at, a.updated_at)')} BETWEEN ? AND ?${w} ORDER BY a.increment_amount DESC`, p)
        .map((r): Cell[] => [link(r.name, `/appraisals/${r.id}`), r.dept, r.rating, r.pct, r.amt == null ? null : Math.round(r.amt), r.at ? 'Approved' : 'Waiting for approval', r.at]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Rating', fmt: 'int' }, { header: 'Increment', fmt: 'pct' }, { header: 'Increment a year', fmt: 'money' }, { header: 'Status' }, { header: 'Approved', fmt: 'date' }], rows, totals: ['Total', null, null, null, sum(rows, 4), null, null] };
    } },
  { key: 'appr-probation', module: 'appraisals', title: 'Probation reviews due', about: 'People whose probation ends in the period, and whether their review has been done.', filters: ['department'], allowed: (app, u) => can(app.db, u, 'appraisals.manage'),
    run(app, c) {
      const p: Params = [c.from, c.to]; if (c.departmentId) p.push(c.departmentId);
      const rows = app.db.all<{ id: string; name: string; dept: string; join: string | null; until: string; mgr: string | null; aid: string | null; status: string | null }>(`SELECT e.id, e.full_name AS name, d.name AS dept, e.join_date AS "join", e.probation_until AS until, m.full_name AS mgr, a.id AS aid, a.status FROM employees e JOIN departments d ON d.id = e.department_id LEFT JOIN employees m ON m.id = e.reporting_manager_id LEFT JOIN appraisals a ON a.employee_id = e.id AND a.kind = 'probation'
        WHERE e.status = 'active' AND e.probation_until BETWEEN ? AND ?${c.departmentId ? ' AND e.department_id = ?' : ''} ORDER BY e.probation_until`, p).map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.dept, r.join, r.until, r.mgr, r.aid ? (r.status === 'closed' || r.status === 'approved' ? 'Review done' : `Review in progress · ${r.status}`) : 'Review not started']);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Department' }, { header: 'Joined', fmt: 'date' }, { header: 'Probation ends', fmt: 'date' }, { header: 'Manager' }, { header: 'Review' }], rows };
    } },

  // ===== SOPs =====
  { key: 'sop-compliance', module: 'sops', title: 'Checklist compliance', about: 'Checklists due in the period, by SOP: done in time, done late, and not done.', filters: ['department'], allowed: (app, u) => can(app.db, u, 'sops.manage'),
    run(app, c) {
      const p: Params = [new Date().toISOString(), c.from, c.to]; if (c.departmentId) p.push(c.departmentId);
      const rows = app.db.all<{ name: string; dept: string | null; n: number; ok: number; late: number; missed: number }>(`SELECT s.name, d.name AS dept, COUNT(*) AS n, SUM(CASE WHEN i.status = 'complete' AND i.completed_at <= i.due_at THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN i.status = 'complete' AND i.completed_at > i.due_at THEN 1 ELSE 0 END) AS late, SUM(CASE WHEN i.status != 'complete' AND i.due_at < ? THEN 1 ELSE 0 END) AS missed
        FROM sop_instances i JOIN sop_definitions s ON s.id = i.sop_id LEFT JOIN departments d ON d.id = i.department_id WHERE i.date BETWEEN ? AND ?${c.departmentId ? ' AND i.department_id = ?' : ''} GROUP BY s.id ORDER BY missed DESC, late DESC`, p).map((r): Cell[] => [r.name, r.dept, r.n, r.ok, r.late, r.missed, pct(r.ok, r.n)]);
      return { columns: [{ header: 'SOP' }, { header: 'Department' }, { header: 'Checklists due', fmt: 'int' }, { header: 'Done in time', fmt: 'int' }, { header: 'Done late', fmt: 'int' }, { header: 'Not done', fmt: 'int' }, { header: 'In time', fmt: 'pct' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), pct(sum(rows, 3), sum(rows, 2))] };
    } },
  { key: 'sop-by-person', module: 'sops', title: 'Checklists by person', about: 'Checklists due in the period for each person.', filters: ['department', 'person'], allowed: (app, u) => can(app.db, u, 'sops.manage'),
    run(app, c) {
      const p: Params = [new Date().toISOString(), c.from, c.to]; const w = who(c, 'i.assignee_id', p);
      const rows = app.db.all<{ id: string; name: string; n: number; ok: number; late: number; missed: number }>(`SELECT e.id, e.full_name AS name, COUNT(*) AS n, SUM(CASE WHEN i.status = 'complete' AND i.completed_at <= i.due_at THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN i.status = 'complete' AND i.completed_at > i.due_at THEN 1 ELSE 0 END) AS late, SUM(CASE WHEN i.status != 'complete' AND i.due_at < ? THEN 1 ELSE 0 END) AS missed FROM sop_instances i JOIN employees e ON e.id = i.assignee_id WHERE i.date BETWEEN ? AND ?${w} GROUP BY e.id ORDER BY missed DESC, late DESC`, p)
        .map((r): Cell[] => [link(r.name, `/people/${r.id}`), r.n, r.ok, r.late, r.missed, pct(r.ok, r.n)]);
      return { columns: [{ header: 'Person', fmt: 'link' }, { header: 'Checklists due', fmt: 'int' }, { header: 'Done in time', fmt: 'int' }, { header: 'Done late', fmt: 'int' }, { header: 'Not done', fmt: 'int' }, { header: 'In time', fmt: 'pct' }], rows, totals: ['Total', sum(rows, 1), sum(rows, 2), sum(rows, 3), sum(rows, 4), pct(sum(rows, 2), sum(rows, 1))] };
    } },

  // ===== Approvals =====
  { key: 'approvals-waiting', module: 'approvals', title: 'How long approvals wait', about: 'Approval requests raised in the period, by kind and by approver: how many were decided, how long they took, and what is still waiting.', filters: [], allowed: managerOrAbove,
    run(app, c) {
      const rows = app.db.all<{ type: string; name: string | null; n: number; ok: number; dec: number; wait: number; h: number | null; oldest: number | null }>(`SELECT t.type, e.full_name AS name, COUNT(*) AS n, SUM(CASE WHEN t.status = 'approved' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN t.status = 'declined' THEN 1 ELSE 0 END) AS dec, SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS wait,
        AVG(CASE WHEN t.decided_at IS NOT NULL THEN (julianday(t.decided_at) - julianday(t.created_at)) * 24 END) AS h, MAX(CASE WHEN t.status = 'open' THEN julianday('now') - julianday(t.created_at) END) AS oldest FROM tasks t LEFT JOIN employees e ON e.id = t.assignee_id WHERE t.kind = 'approval' AND ${ld('t.created_at')} BETWEEN ? AND ? GROUP BY t.type, t.assignee_id ORDER BY wait DESC, n DESC`, [c.from, c.to])
        .map((r): Cell[] => [r.type.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()), r.name, r.n, r.ok, r.dec, r.wait, r1(r.h), r.oldest == null ? null : r1(r.oldest)]);
      return { columns: [{ header: 'Kind of request' }, { header: 'With' }, { header: 'Requests', fmt: 'int' }, { header: 'Approved', fmt: 'int' }, { header: 'Declined', fmt: 'int' }, { header: 'Waiting now', fmt: 'int' }, { header: 'Average hours to decide', fmt: 'num' }, { header: 'Oldest waiting (days)', fmt: 'num' }], rows, totals: ['Total', null, sum(rows, 2), sum(rows, 3), sum(rows, 4), sum(rows, 5), null, null] };
    } },

  // ===== Daily review =====
  { key: 'dsr-by-day', module: 'dsr', title: 'Daily review by day', about: 'Each team and day: what was planned, how it ended, what moved to the next day, and for sales the amount expected against the amount collected.', filters: ['department'], allowed: (app, u) => managerOrAbove(app, u) || scopeFor(app.db, u).level !== 'self',
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'i.employee_id', p, { deptVia: 'i.department_id' });
      const rows = app.db.all<{ day: string; team: string; n: number; done: number; part: number; nd: number; wait: number; carried: number; exp: number; got: number; closed: number }>(`SELECT i.day, d.name AS team, COUNT(*) AS n, SUM(i.status = 'done') AS done, SUM(i.status = 'partial') AS part, SUM(i.status IN ('not_done', 'blocked')) AS nd, SUM(i.status = 'planned') AS wait,
        SUM(i.carried_to IS NOT NULL) AS carried, COALESCE(SUM(i.amount_expected), 0) AS exp, COALESCE(SUM(i.amount_actual), 0) AS got, MAX(COALESCE((SELECT y.status = 'closed' FROM dsr_days y WHERE y.department_id = i.department_id AND y.day = i.day), 0)) AS closed
        FROM dsr_items i JOIN departments d ON d.id = i.department_id WHERE i.day BETWEEN ? AND ?${w} GROUP BY i.day, i.department_id ORDER BY i.day DESC, d.name`, p)
        .map((r): Cell[] => [r.day, r.team, r.closed ? 'Closed' : 'Open', r.n, r.done, r.part, r.nd, r.wait, r.carried, Math.round(r.exp), Math.round(r.got), pct(r.done, r.n)]);
      const byDay = new Map<string, [number, number]>(); for (const r of rows) { const v = byDay.get(String(r[0])) || [0, 0]; v[0] += Number(r[4]); v[1] += Number(r[3]); byDay.set(String(r[0]), v); }
      const days = [...byDay.keys()].sort().slice(-14);
      return { columns: [{ header: 'Day', fmt: 'date' }, { header: 'Team' }, { header: 'Sheet' }, { header: 'Planned', fmt: 'int' }, { header: 'Done', fmt: 'int' }, { header: 'Partly done', fmt: 'int' }, { header: 'Not done or blocked', fmt: 'int' }, { header: 'Not reviewed', fmt: 'int' }, { header: 'Moved to next day', fmt: 'int' }, { header: 'Expected', fmt: 'money' }, { header: 'Collected', fmt: 'money' }, { header: 'Done rate', fmt: 'pct' }], rows,
        totals: ['Total', null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7), sum(rows, 8), sum(rows, 9), sum(rows, 10), pct(sum(rows, 4), sum(rows, 3))],
        chart: { title: 'Lines done each day', labels: days.map((x) => x.slice(8) + '/' + x.slice(5, 7)), values: days.map((x) => byDay.get(x)![0]) } };
    } },
  { key: 'dsr-by-person', module: 'dsr', title: 'Daily review by person', about: 'For each person in the period: lines planned, done, partly done and not done, how often work moved to the next day, planned hours, and collections expected and received.', filters: ['department', 'person'], allowed: (app, u) => managerOrAbove(app, u) || scopeFor(app.db, u).level !== 'self',
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'i.employee_id', p, { deptVia: 'i.department_id' });
      const rows = app.db.all<{ id: string; name: string; team: string; days: number; n: number; done: number; part: number; nd: number; carried: number; h: number; exp: number; got: number }>(`SELECT e.id, e.full_name AS name, d.name AS team, COUNT(DISTINCT i.day) AS days, COUNT(*) AS n, SUM(i.status = 'done') AS done, SUM(i.status = 'partial') AS part, SUM(i.status IN ('not_done', 'blocked')) AS nd,
        SUM(i.carried_to IS NOT NULL) AS carried, COALESCE(SUM(i.planned_hours), 0) AS h, COALESCE(SUM(i.amount_expected), 0) AS exp, COALESCE(SUM(i.amount_actual), 0) AS got
        FROM dsr_items i JOIN employees e ON e.id = i.employee_id JOIN departments d ON d.id = i.department_id WHERE i.day BETWEEN ? AND ?${w} GROUP BY e.id, i.department_id ORDER BY done DESC, e.full_name`, p)
        .map((r): Cell[] => [{ text: r.name, href: `/people/${r.id}` }, r.team, r.days, r.n, r.done, r.part, r.nd, r.carried, r1(r.h), Math.round(r.exp), Math.round(r.got), pct(r.done, r.n)]);
      return { columns: [{ header: 'Person' }, { header: 'Team' }, { header: 'Days', fmt: 'int' }, { header: 'Planned', fmt: 'int' }, { header: 'Done', fmt: 'int' }, { header: 'Partly done', fmt: 'int' }, { header: 'Not done or blocked', fmt: 'int' }, { header: 'Moved to next day', fmt: 'int' }, { header: 'Planned hours', fmt: 'num' }, { header: 'Expected', fmt: 'money' }, { header: 'Collected', fmt: 'money' }, { header: 'Done rate', fmt: 'pct' }], rows,
        totals: ['Total', null, null, sum(rows, 3), sum(rows, 4), sum(rows, 5), sum(rows, 6), sum(rows, 7), r1(sum(rows, 8)), sum(rows, 9), sum(rows, 10), pct(sum(rows, 4), sum(rows, 3))],
        chart: { title: 'Lines done by person', labels: rows.slice(0, 15).map((r) => (r[0] as { text: string }).text), values: rows.slice(0, 15).map((r) => Number(r[4])) } };
    } },

  // ===== One person's work, across every module =====
  { key: 'emp-activity', module: 'dsr', title: 'What each person did', about: 'One line per person for the period: days at work, daily-review lines, hours logged, tickets closed, deals won, money collected, customer contacts, development items released and checklists completed. Choose a person to see everything they did, entry by entry.', filters: ['department', 'person'], allowed: (app, u) => managerOrAbove(app, u) || scopeFor(app.db, u).level !== 'self',
    run(app, c) {
      const slot = "((CAST(substr(i.slot_to, 1, 2) AS INTEGER) * 60 + CAST(substr(i.slot_to, 4, 2) AS INTEGER)) - (CAST(substr(i.slot_from, 1, 2) AS INTEGER) * 60 + CAST(substr(i.slot_from, 4, 2) AS INTEGER))) / 60.0";
      const hm = (col: string): string => `strftime('%H:%M', ${col}, ${TZ})`;
      if (c.personId) {
        // Everything one person did, newest first.
        const allowed = !c.people || c.people.has(c.personId); const id = c.personId; const rg: Params = [id, c.from, c.to];
        type E = { day: string; time: string | null; kind: string; what: string; result: string | null; href: string | null };
        const q = (sql: string): E[] => (allowed ? app.db.all<E>(sql, rg) : []);
        const all: E[] = [
          ...q(`SELECT date AS day, ${hm('check_in')} AS time, 'Attendance' AS kind, 'Came in' || CASE WHEN check_out IS NOT NULL THEN ', left at ' || ${hm('check_out')} ELSE '' END AS what, CASE WHEN minutes_late > 0 THEN minutes_late || ' min late' ELSE status END AS result, NULL AS href FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? AND check_in IS NOT NULL`),
          ...q(`SELECT i.day, NULLIF(i.slot_from, '') AS time, CASE WHEN i.kind = 'collection' THEN 'Collection' WHEN COALESCE(i.slot_from, '') <> '' THEN 'Work log' ELSE 'Daily review' END AS kind,
            CASE WHEN i.kind = 'collection' THEN COALESCE(NULLIF(i.customer, ''), i.title) ELSE i.title END || CASE WHEN COALESCE(i.slot_from, '') <> '' THEN ' (until ' || i.slot_to || ')' ELSE '' END AS what,
            CASE WHEN i.kind = 'collection' THEN 'Received ₹' || CAST(ROUND(COALESCE(i.amount_actual, i.self_amount, 0)) AS INTEGER) || ' of ₹' || CAST(ROUND(COALESCE(i.amount_expected, 0)) AS INTEGER) ELSE replace(CASE WHEN i.status = 'planned' THEN COALESCE(i.self_status, 'planned') ELSE i.status END, '_', ' ') END AS result, '/dsr?team=' || i.department_id || '&day=' || i.day AS href
            FROM dsr_items i WHERE i.employee_id = ? AND i.day BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('t.resolved_at')} AS day, ${hm('t.resolved_at')} AS time, 'Ticket closed' AS kind, t.subject AS what, CASE t.within_sla WHEN 1 THEN 'In promised time' WHEN 0 THEN 'Past promised time' ELSE NULL END AS result, '/tickets/' || t.id AS href FROM tickets t WHERE t.assignee_id = ? AND t.resolved_at IS NOT NULL AND ${ld('t.resolved_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('d.won_at')} AS day, ${hm('d.won_at')} AS time, 'Deal won' AS kind, d.title AS what, '₹' || CAST(ROUND(${netValue}) AS INTEGER) AS result, '/deals/' || d.id AS href FROM deals d WHERE d.owner_id = ? AND d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('a.at')} AS day, ${hm('a.at')} AS time, 'Customer ' || a.kind AS kind, COALESCE((SELECT name FROM customers WHERE id = a.customer_id), '') || CASE WHEN a.notes <> '' THEN ': ' || a.notes ELSE '' END AS what, NULLIF(a.outcome, '') AS result, CASE WHEN a.deal_id IS NOT NULL THEN '/deals/' || a.deal_id ELSE NULL END AS href FROM activities a WHERE a.actor_id = ? AND ${ld('a.at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('x.released_at')} AS day, ${hm('x.released_at')} AS time, 'Development released' AS kind, x.title AS what, x.type AS result, '/dev/' || x.id AS href FROM dev_issues x WHERE x.assignee_id = ? AND x.released_at IS NOT NULL AND ${ld('x.released_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('s.completed_at')} AS day, ${hm('s.completed_at')} AS time, 'Checklist completed' AS kind, COALESCE((SELECT name FROM sop_definitions WHERE id = s.sop_id), 'Checklist') AS what, NULL AS result, NULL AS href FROM sop_instances s WHERE s.assignee_id = ? AND s.completed_at IS NOT NULL AND ${ld('s.completed_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('k.decided_at')} AS day, ${hm('k.decided_at')} AS time, 'Approval decided' AS kind, k.title AS what, k.status AS result, NULL AS href FROM tasks k WHERE k.decided_by = ? AND k.decided_at IS NOT NULL AND ${ld('k.decided_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('w.started_at')} AS day, ${hm('w.started_at')} AS time, CASE w.kind WHEN 'break' THEN 'Break' ELSE 'Worked on' END AS kind, CASE WHEN w.kind = 'break' THEN COALESCE(NULLIF(w.note, ''), 'Break') ELSE w.title END || CASE WHEN w.ended_at IS NOT NULL THEN ' (until ' || ${hm('w.ended_at')} || ')' ELSE ' (still running)' END AS what, w.minutes || ' min' AS result, NULL AS href FROM work_sessions w WHERE w.employee_id = ? AND ${ld('w.started_at')} BETWEEN ? AND ?`),
          ...q(`SELECT ${ld('l.started_at')} AS day, ${hm('l.started_at')} AS time, 'Timed work' AS kind, COALESCE(NULLIF(l.note, ''), replace(l.entity_type, '_', ' ') || ' ' || l.entity_id) AS what, ROUND(COALESCE(l.minutes, 0) / 60.0, 1) || ' h' AS result, NULL AS href FROM time_logs l WHERE l.employee_id = ? AND ${ld('l.started_at')} BETWEEN ? AND ?`)
        ].sort((a, b) => (a.day === b.day ? (b.time || '').localeCompare(a.time || '') : b.day.localeCompare(a.day)));
        const by = new Map<string, number>(); for (const e of all) by.set(e.kind, (by.get(e.kind) || 0) + 1);
        const top = [...by.entries()].sort((a, b) => b[1] - a[1]);
        const shown = all.slice(0, 3000);
        return { columns: [{ header: 'Date', fmt: 'date' }, { header: 'Time' }, { header: 'Kind' }, { header: 'What', width: 60 }, { header: 'Result', width: 26 }],
          rows: shown.map((e): Cell[] => [e.day, e.time, e.kind, e.href ? { text: e.what, href: e.href } : e.what, e.result ? e.result.charAt(0).toUpperCase() + e.result.slice(1) : null]),
          chart: top.length ? { title: 'Entries by kind', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) } : undefined,
          note: `${all.length} entr${all.length === 1 ? 'y' : 'ies'} in the period${all.length > shown.length ? `; the first ${shown.length} are shown` : ''}. Clear the person to go back to one line per person.` };
      }
      const p0: Params = []; const w0 = who(c, 'e.id', p0, { deptVia: 'e.department_id' });
      const people = app.db.all<{ id: string; name: string; team: string }>(`SELECT e.id, e.full_name AS name, d.name AS team FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active'${w0} ORDER BY d.name, e.full_name`, p0);
      const agg = <T extends { id: string }>(sql: string): Map<string, T> => new Map(app.db.all<T>(sql, [c.from, c.to]).map((r) => [r.id, r]));
      const att = agg<{ id: string; days: number; late: number; h: number | null }>(`SELECT employee_id AS id, COALESCE(SUM(day_value), 0) AS days, SUM(minutes_late > 0) AS late, SUM((julianday(check_out) - julianday(check_in)) * 24) AS h FROM attendance WHERE date BETWEEN ? AND ? AND check_in IS NOT NULL GROUP BY employee_id`);
      const dsr = agg<{ id: string; n: number; done: number; h: number | null; got: number }>(`SELECT i.employee_id AS id, SUM(COALESCE(i.slot_from, '') = '') AS n, SUM(COALESCE(i.slot_from, '') = '' AND (i.status = 'done' OR (i.status = 'planned' AND i.self_status = 'done'))) AS done, SUM(CASE WHEN COALESCE(i.slot_from, '') <> '' AND COALESCE(i.slot_to, '') <> '' THEN ${slot} ELSE 0 END) AS h, COALESCE(SUM(CASE WHEN i.kind = 'collection' THEN COALESCE(i.amount_actual, i.self_amount, 0) ELSE 0 END), 0) AS got FROM dsr_items i WHERE i.day BETWEEN ? AND ? GROUP BY i.employee_id`);
      const tk = agg<{ id: string; n: number }>(`SELECT assignee_id AS id, COUNT(*) AS n FROM tickets WHERE resolved_at IS NOT NULL AND assignee_id IS NOT NULL AND ${ld('resolved_at')} BETWEEN ? AND ? GROUP BY assignee_id`);
      const dl = agg<{ id: string; n: number; v: number }>(`SELECT d.owner_id AS id, COUNT(*) AS n, COALESCE(SUM(${netValue}), 0) AS v FROM deals d WHERE d.stage = 'won' AND ${ld('d.won_at')} BETWEEN ? AND ? GROUP BY d.owner_id`);
      const ac = agg<{ id: string; n: number }>(`SELECT actor_id AS id, COUNT(*) AS n FROM activities WHERE kind IN ('call', 'visit', 'demo') AND ${ld('at')} BETWEEN ? AND ? GROUP BY actor_id`);
      const dv = agg<{ id: string; n: number }>(`SELECT assignee_id AS id, COUNT(*) AS n FROM dev_issues WHERE released_at IS NOT NULL AND assignee_id IS NOT NULL AND ${ld('released_at')} BETWEEN ? AND ? GROUP BY assignee_id`);
      const sp = agg<{ id: string; n: number }>(`SELECT assignee_id AS id, COUNT(*) AS n FROM sop_instances WHERE completed_at IS NOT NULL AND assignee_id IS NOT NULL AND ${ld('completed_at')} BETWEEN ? AND ? GROUP BY assignee_id`);
      const tl = agg<{ id: string; h: number }>(`SELECT employee_id AS id, COALESCE(SUM(minutes), 0) / 60.0 AS h FROM time_logs WHERE ${ld('started_at')} BETWEEN ? AND ? GROUP BY employee_id`);
      const ws = agg<{ id: string; h: number; b: number }>(`SELECT employee_id AS id, COALESCE(SUM(CASE WHEN kind = 'work' THEN minutes ELSE 0 END), 0) / 60.0 AS h, COALESCE(SUM(CASE WHEN kind = 'break' THEN minutes ELSE 0 END), 0) / 60.0 AS b FROM work_sessions WHERE ${ld('started_at')} BETWEEN ? AND ? GROUP BY employee_id`);
      const rows = people.map((e): Cell[] => { const a = att.get(e.id), d = dsr.get(e.id), x = dl.get(e.id);
        return [{ text: e.name, href: `/reports/emp-activity?person=${e.id}&from=${c.from}&to=${c.to}` }, e.team, r1(a?.days || 0), a?.late || 0, r1(a?.h || 0), d?.n || 0, d?.done || 0, r1((d?.h || 0) + (tl.get(e.id)?.h || 0)), r1(ws.get(e.id)?.h || 0), r1(ws.get(e.id)?.b || 0), tk.get(e.id)?.n || 0, x?.n || 0, Math.round(x?.v || 0), Math.round(d?.got || 0), ac.get(e.id)?.n || 0, dv.get(e.id)?.n || 0, sp.get(e.id)?.n || 0]; });
      const count = (r: Cell[]): number => Number(r[6]) + Number(r[10]) + Number(r[11]) + Number(r[14]) + Number(r[15]) + Number(r[16]);
      const busiest = [...rows].sort((a, b) => count(b) - count(a)).slice(0, 15);
      return { columns: [{ header: 'Person' }, { header: 'Team' }, { header: 'Days at work', fmt: 'num' }, { header: 'Days late', fmt: 'int' }, { header: 'Hours at work', fmt: 'num' }, { header: 'Review lines planned', fmt: 'int' }, { header: 'Review lines done', fmt: 'int' }, { header: 'Hours logged', fmt: 'num' }, { header: 'Hours timed on tasks', fmt: 'num' }, { header: 'Break hours', fmt: 'num' }, { header: 'Tickets closed', fmt: 'int' }, { header: 'Deals won', fmt: 'int' }, { header: 'Won value', fmt: 'money' }, { header: 'Collected', fmt: 'money' }, { header: 'Customer contacts', fmt: 'int' }, { header: 'Development released', fmt: 'int' }, { header: 'Checklists completed', fmt: 'int' }], rows,
        totals: ['Total', null, r1(sum(rows, 2)), sum(rows, 3), r1(sum(rows, 4)), sum(rows, 5), sum(rows, 6), r1(sum(rows, 7)), r1(sum(rows, 8)), r1(sum(rows, 9)), sum(rows, 10), sum(rows, 11), sum(rows, 12), sum(rows, 13), sum(rows, 14), sum(rows, 15), sum(rows, 16)],
        chart: busiest.some((r) => count(r) > 0) ? { title: 'Pieces of work finished, by person', labels: busiest.map((r) => (r[0] as { text: string }).text), values: busiest.map(count) } : undefined,
        note: 'Click a name to see everything that person did in the period, entry by entry. "Pieces of work finished" adds review lines done, tickets closed, deals won, customer contacts, development items released and checklists completed.' };
    } },

  { key: 'time-by-task', module: 'dsr', title: 'Time spent on each task', about: 'For every task, daily-review line, ticket and board item that someone timed in the period: who worked on it, how many times they sat down to it, the first and last time, hours worked, break time taken during it, and whether it is finished.', filters: ['department', 'person'], allowed: (app, u) => managerOrAbove(app, u) || scopeFor(app.db, u).level !== 'self',
    run(app, c) {
      const p: Params = [c.from, c.to]; const w = who(c, 'w.employee_id', p);
      const KIND: Record<string, string> = { task: 'Task', dsr: 'Daily review', ticket: 'Ticket', issue: 'Development' };
      const rows = app.db.all<{ emp: string; name: string; team: string; type: string; id: string; title: string; n: number; first: string; last: string; work: number; brk: number; breaks: number; state: string | null }>(`SELECT e.id AS emp, e.full_name AS name, d.name AS team, w.entity_type AS type, w.entity_id AS id, MAX(w.title) AS title,
          SUM(w.kind = 'work') AS n, MIN(w.started_at) AS first, MAX(COALESCE(w.ended_at, w.started_at)) AS last,
          COALESCE(SUM(CASE WHEN w.kind = 'work' THEN w.minutes ELSE 0 END), 0) AS work, COALESCE(SUM(CASE WHEN w.kind = 'break' THEN w.minutes ELSE 0 END), 0) AS brk, SUM(w.kind = 'break') AS breaks,
          CASE w.entity_type WHEN 'task' THEN (SELECT status FROM tasks WHERE id = w.entity_id) WHEN 'ticket' THEN (SELECT status FROM tickets WHERE id = w.entity_id) WHEN 'issue' THEN (SELECT status FROM dev_issues WHERE id = w.entity_id)
            ELSE (SELECT CASE WHEN status = 'planned' THEN COALESCE(NULLIF(self_status, ''), 'planned') ELSE status END FROM dsr_items WHERE id = w.entity_id) END AS state
        FROM work_sessions w JOIN employees e ON e.id = w.employee_id JOIN departments d ON d.id = e.department_id
        WHERE ${ld('w.started_at')} BETWEEN ? AND ?${w} GROUP BY w.employee_id, w.entity_type, w.entity_id ORDER BY work DESC, e.full_name LIMIT 3000`, p);
      const local = (iso: string): string => { const t = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString(); return `${t.slice(8, 10)} ${MONTHS[Number(t.slice(5, 7)) - 1]}, ${t.slice(11, 16)}`; };
      const href = (r: { type: string; id: string }): string | null => (r.type === 'ticket' ? `/tickets/${r.id}` : r.type === 'issue' ? `/dev/${r.id}` : null);
      const nice = (x: string | null): string | null => (x ? (x.charAt(0).toUpperCase() + x.slice(1)).replace(/_/g, ' ') : null);
      const out = rows.map((r): Cell[] => [{ text: r.name, href: `/reports/emp-activity?person=${r.emp}&from=${c.from}&to=${c.to}` }, r.team, KIND[r.type] || r.type, href(r) ? { text: r.title, href: href(r)! } : r.title, r.n, local(r.first), local(r.last), r1(r.work / 60), r1(r.brk / 60), r.breaks, nice(r.state)]);
      const byTask = new Map<string, number>(); for (const r of rows) byTask.set(r.title, (byTask.get(r.title) || 0) + r.work / 60);
      const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
      return { columns: [{ header: 'Person' }, { header: 'Team' }, { header: 'Kind' }, { header: 'Task', width: 50 }, { header: 'Times worked on', fmt: 'int' }, { header: 'First started' }, { header: 'Last worked' }, { header: 'Hours worked', fmt: 'num' }, { header: 'Break hours', fmt: 'num' }, { header: 'Breaks', fmt: 'int' }, { header: 'Status now' }], rows: out,
        totals: ['Total', null, null, null, sum(out, 4), null, null, r1(rows.reduce((n, r) => n + r.work, 0) / 60), r1(rows.reduce((n, r) => n + r.brk, 0) / 60), sum(out, 9), null],
        chart: top.length ? { title: 'Hours by task', unit: 'h', labels: top.map((t) => t[0].length > 38 ? t[0].slice(0, 37) + '…' : t[0]), values: top.map((t) => Math.round(t[1] * 10) / 10) } : undefined,
        note: rows.length ? 'Time counts only while the person had pressed Start on the item. Click a name to see their day entry by entry.' : 'Nothing was timed in this period. Time is recorded when a person presses Start on an item under My work.' };
    } },

  // ===== Administration =====
  { key: 'admin-audit', module: 'admin', title: 'Who changed what', about: 'Every recorded change in the period, newest first: settings, roles, salaries, records. Shows up to 1,000 lines.', filters: ['person'], allowed: (app, u) => can(app.db, u, 'settings.admin'),
    run(app, c) {
      const p: Params = [c.from, c.to]; if (c.personId) p.push(c.personId);
      const rows = app.db.all<{ at: string; name: string | null; entity: string; entity_id: string; action: string }>(`SELECT a.at, e.full_name AS name, a.entity, a.entity_id, a.action FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id WHERE ${ld('a.at')} BETWEEN ? AND ?${c.personId ? ' AND a.actor_id = ?' : ''} ORDER BY a.id DESC LIMIT 1000`, p)
        .map((r): Cell[] => [r.at.slice(0, 16).replace('T', ' ') + ' UTC', r.name || 'System or customer', r.entity.replace(/_/g, ' '), r.entity_id, r.action.replace(/_/g, ' ')]);
      const by = new Map<string, number>(); for (const r of rows) by.set(String(r[2]), (by.get(String(r[2])) || 0) + 1);
      const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      return { columns: [{ header: 'When' }, { header: 'Who' }, { header: 'What' }, { header: 'Which one' }, { header: 'Change' }], rows, chart: { title: 'Changes by kind of record', labels: top.map((t) => t[0]), values: top.map((t) => t[1]) } };
    } }
];

export function reportsFor(app: App, user: Employee): ReportDef[] { return REPORTS.filter((r) => r.allowed(app, user)); }
export function getReport(key: string): ReportDef | undefined { return REPORTS.find((r) => r.key === key); }

/** Default period: the last three whole months plus this month so far. */
export function defaultRange(now = new Date()): { from: string; to: string } {
  const today = localDateString(now); const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); const sm = m - 3;
  const from = sm >= 1 ? `${y}-${String(sm).padStart(2, '0')}-01` : `${y - 1}-${String(sm + 12).padStart(2, '0')}-01`;
  return { from, to: today };
}
export function runReport(app: App, user: Employee, def: ReportDef, q: { from?: string; to?: string; departmentId?: string; personId?: string }): { result: ReportResult; ctx: RunCtx } {
  const d = defaultRange(); const ok = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from = ok(q.from) ? q.from : d.from; let to = ok(q.to) ? q.to : d.to; if (from > to) [from, to] = [to, from];
  const scope = scopeFor(app.db, user);
  // Managers see their team; everyone-scope and the module's managers see all. Reports that list individuals honour this.
  const wide = scope.level === 'company' || (def.module === 'sales' && can(app.db, user, 'sales.manage')) || (def.module === 'attendance' && can(app.db, user, 'attendance.manage')) || (def.module === 'support' && can(app.db, user, 'desk.manage'));
  const ctx: RunCtx = { from, to, departmentId: def.filters.includes('department') ? q.departmentId || '' : '', personId: def.filters.includes('person') ? q.personId || '' : '', people: wide ? null : scope.people, viewer: user };
  return { result: def.run(app, ctx), ctx };
}
void addDays;
