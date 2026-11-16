import type { App } from '../../app.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { holidaySet, shiftByCode } from '../../lib/settings.ts';
import { addDays, businessMinutesBetween, isoWeek, localDateString, monthStart, weekStart } from '../../lib/time.ts';
import { compliance } from '../sops/service.ts';
import { onTimeDispatchRate } from '../production/service.ts';
import type { Employee } from '../people/model.ts';

export type Band = 'revenue' | 'service' | 'operations' | 'people';
export type Unit = 'number' | 'pct' | 'inr' | 'minutes' | 'days' | 'ratio' | 'rating';
export type ScopeType = 'company' | 'department' | 'employee';
export interface KpiScope { type: ScopeType; id: string }
export interface Period { start: Date; end: Date; label: string }

export interface KpiCtx { app: App; scope: KpiScope; period: Period; people: string[]; now: Date }

export interface KpiDef {
  key: string; name: string; band: Band; ownerDept: string; unit: Unit; direction: 'up' | 'down' | 'none'; target: number | null; amberFactor: number;
  source: 'computed' | 'manual'; perPerson: boolean; definition: string; periodKind: 'week' | 'month' | 'now';
  compute?: (c: KpiCtx) => number | null;
}

const inList = (ids: string[]) => ids.map(() => '?').join(',');

function peopleClause(c: KpiCtx, column: string): { sql: string; params: string[] } {
  if (c.scope.type === 'company') return { sql: '1=1', params: [] };
  if (!c.people.length) return { sql: '0=1', params: [] };
  return { sql: `${column} IN (${inList(c.people)})`, params: c.people };
}

function count(app: App, sql: string, params: (string | number)[] = []): number { return app.db.get<{ n: number }>(sql, params)?.n || 0; }

export const KPI_DEFS: KpiDef[] = [
  // Revenue and pipeline ---------------------------------------------------------------------------
  { key: 'bookings_mtd', name: 'Bookings, month to date', band: 'revenue', ownerDept: 'SAL', unit: 'inr', direction: 'up', target: 6_000_000, amberFactor: 0.7, source: 'computed', perPerson: true, periodKind: 'month',
    definition: 'Value of deals marked Won in the month, all owners in scope. Source: Sales pipeline.',
    compute: (c) => { const p = peopleClause(c, 'owner_id'); return app0(c).db.get<{ v: number }>(`SELECT COALESCE(SUM(value * (1 - discount_pct / 100.0)), 0) AS v FROM deals WHERE stage = 'won' AND won_at >= ? AND won_at < ? AND ${p.sql}`, [monthStart(c.now).toISOString(), c.now.toISOString(), ...p.params])?.v || 0; } },
  { key: 'pipeline_coverage', name: 'Pipeline coverage', band: 'revenue', ownerDept: 'SAL', unit: 'ratio', direction: 'up', target: 3, amberFactor: 0.8, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Weighted open pipeline divided by the month target still to be met. Source: Sales pipeline.',
    compute: (c) => { const p = peopleClause(c, 'owner_id'); const open = app0(c).db.get<{ v: number }>(`SELECT COALESCE(SUM(value * CASE stage WHEN 'new' THEN 0.1 WHEN 'contacted' THEN 0.2 WHEN 'qualified' THEN 0.4 WHEN 'demo' THEN 0.55 WHEN 'proposal' THEN 0.7 WHEN 'negotiation' THEN 0.85 ELSE 0 END), 0) AS v FROM deals WHERE stage NOT IN ('won','lost') AND ${p.sql}`, p.params)?.v || 0;
      const target = targetFor(app0(c), 'bookings_mtd', c.scope) ?? 6_000_000; const won = KPI_DEFS[0].compute!(c) || 0; const remaining = Math.max(target * 0.25, target - won); return Math.round((open / remaining) * 10) / 10; } },
  { key: 'new_leads_week', name: 'New leads this week', band: 'revenue', ownerDept: 'PRE', unit: 'number', direction: 'up', target: 35, amberFactor: 0.7, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Deals created in the week from all channels. Source: Sales pipeline.',
    compute: (c) => { const p = peopleClause(c, 'owner_id'); return count(app0(c), `SELECT count(*) AS n FROM deals WHERE created_at >= ? AND created_at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); } },
  { key: 'overdue_followups', name: 'Overdue follow-ups', band: 'revenue', ownerDept: 'SAL', unit: 'number', direction: 'down', target: 0, amberFactor: 3, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Open deals whose next step is past its due date. Source: Sales pipeline.',
    compute: (c) => { const p = peopleClause(c, 'owner_id'); return count(app0(c), `SELECT count(*) AS n FROM deals WHERE stage NOT IN ('won','lost') AND next_step_due < ? AND ${p.sql}`, [c.now.toISOString(), ...p.params]); } },
  { key: 'win_rate_90d', name: 'Win rate, 90 days', band: 'revenue', ownerDept: 'SAL', unit: 'pct', direction: 'up', target: 30, amberFactor: 0.7, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Deals won divided by deals closed (won plus lost) in the last 90 days. Source: Sales pipeline.',
    compute: (c) => { const p = peopleClause(c, 'owner_id'); const since = addDays(c.now, -90).toISOString(); const won = count(app0(c), `SELECT count(*) AS n FROM deals WHERE stage = 'won' AND won_at >= ? AND ${p.sql}`, [since, ...p.params]); const lost = count(app0(c), `SELECT count(*) AS n FROM deals WHERE stage = 'lost' AND lost_at >= ? AND ${p.sql}`, [since, ...p.params]); return won + lost ? Math.round((won / (won + lost)) * 100) : null; } },
  { key: 'appointments_week', name: 'Appointments this week', band: 'revenue', ownerDept: 'SAL', unit: 'number', direction: 'up', target: 42, amberFactor: 0.7, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Visits and demos logged in the week. Source: Sales activities.',
    compute: (c) => { const p = peopleClause(c, 'actor_id'); return count(app0(c), `SELECT count(*) AS n FROM activities WHERE kind IN ('visit','demo') AND at >= ? AND at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); } },
  { key: 'calls_week', name: 'Calls this week', band: 'revenue', ownerDept: 'PRE', unit: 'number', direction: 'up', target: 150, amberFactor: 0.7, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Calls logged in the week, by hand or from Smartflo. Source: Sales activities.',
    compute: (c) => { const p = peopleClause(c, 'actor_id'); return count(app0(c), `SELECT count(*) AS n FROM activities WHERE kind = 'call' AND at >= ? AND at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); } },
  { key: 'campaign_leads', name: 'Leads from campaigns', band: 'revenue', ownerDept: 'DM', unit: 'number', direction: 'up', target: 15, amberFactor: 0.6, source: 'computed', perPerson: false, periodKind: 'week',
    definition: 'Deals created in the week whose source is a marketing channel (IndiaMART, website, campaign). Source: Sales pipeline.',
    compute: (c) => count(app0(c), "SELECT count(*) AS n FROM deals WHERE created_at >= ? AND created_at < ? AND (lower(source) LIKE '%indiamart%' OR lower(source) LIKE '%website%' OR lower(source) LIKE '%campaign%')", [c.period.start.toISOString(), c.period.end.toISOString()]) },
  // Service and delivery ---------------------------------------------------------------------------
  { key: 'open_tickets', name: 'Open tickets', band: 'service', ownerDept: 'SUP', unit: 'number', direction: 'down', target: 60, amberFactor: 1.15, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Tickets not yet resolved, all priorities. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); return count(app0(c), `SELECT count(*) AS n FROM tickets WHERE status NOT IN ('resolved','closed') AND ${p.sql}`, p.params); } },
  { key: 'sla_breaches_today', name: 'SLA breaches today', band: 'service', ownerDept: 'SUP', unit: 'number', direction: 'down', target: 0, amberFactor: 2, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Open tickets past their resolution clock plus tickets resolved today outside SLA. Source: Service desk SLA clocks.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const day = localDateString(c.now); return count(app0(c), `SELECT count(*) AS n FROM tickets WHERE type != 'implementation' AND ((status NOT IN ('resolved','closed') AND resolve_due_at < ?) OR (within_sla = 0 AND substr(resolved_at,1,10) = ?)) AND ${p.sql}`, [c.now.toISOString(), day, ...p.params]); } },
  { key: 'backlog_7d', name: 'Backlog over 7 days', band: 'service', ownerDept: 'SUP', unit: 'number', direction: 'down', target: 5, amberFactor: 1.4, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Open tickets older than seven calendar days. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); return count(app0(c), `SELECT count(*) AS n FROM tickets WHERE status NOT IN ('resolved','closed') AND created_at < ? AND ${p.sql}`, [addDays(c.now, -7).toISOString(), ...p.params]); } },
  { key: 'implementations_avg_days', name: 'Implementations: average days open', band: 'service', ownerDept: 'SUP', unit: 'days', direction: 'down', target: 21, amberFactor: 1.25, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Average days since start for customer implementations not yet signed off. Source: Service desk implementation tickets.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const rows = app0(c).db.all<{ created_at: string }>(`SELECT created_at FROM tickets WHERE type = 'implementation' AND status NOT IN ('resolved','closed') AND ${p.sql}`, p.params); if (!rows.length) return null; return Math.round(rows.reduce((s, r) => s + (c.now.getTime() - new Date(r.created_at).getTime()) / 86_400_000, 0) / rows.length); } },
  { key: 'first_response_median', name: 'First response, median', band: 'service', ownerDept: 'SUP', unit: 'minutes', direction: 'down', target: 60, amberFactor: 1.5, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Median business minutes from ticket creation to the first agent reply, tickets created in the period. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const app = app0(c); const shift = shiftByCode(app.db, 'SUP'); const hol = holidaySet(app.db); const rows = app.db.all<{ created_at: string; first_response_at: string }>(`SELECT created_at, first_response_at FROM tickets WHERE first_response_at IS NOT NULL AND created_at >= ? AND created_at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); if (!rows.length) return null; const mins = rows.map((r) => businessMinutesBetween(new Date(r.created_at), new Date(r.first_response_at), shift, hol)).sort((a, b) => a - b); return mins[Math.floor(mins.length / 2)]; } },
  { key: 'sla_compliance', name: 'SLA compliance', band: 'service', ownerDept: 'SUP', unit: 'pct', direction: 'up', target: 95, amberFactor: 0.95, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Tickets resolved within SLA divided by tickets resolved in the period. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const r = app0(c).db.get<{ total: number; ok: number }>(`SELECT count(*) AS total, COALESCE(SUM(within_sla), 0) AS ok FROM tickets WHERE resolved_at >= ? AND resolved_at < ? AND within_sla IS NOT NULL AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); return r && r.total ? Math.round((r.ok / r.total) * 100) : null; } },
  { key: 'reopen_rate', name: 'Reopen rate', band: 'service', ownerDept: 'SUP', unit: 'pct', direction: 'down', target: 5, amberFactor: 1.6, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Share of tickets resolved in the period that were reopened at least once. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const r = app0(c).db.get<{ total: number; re: number }>(`SELECT count(*) AS total, SUM(CASE WHEN reopen_count > 0 THEN 1 ELSE 0 END) AS re FROM tickets WHERE resolved_at >= ? AND resolved_at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); return r && r.total ? Math.round(((r.re || 0) / r.total) * 100) : null; } },
  { key: 'customer_rating', name: 'Customer rating', band: 'service', ownerDept: 'SUP', unit: 'rating', direction: 'up', target: 4.5, amberFactor: 0.9, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Average one-click rating on tickets resolved in the period. Source: Service desk.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); const r = app0(c).db.get<{ avg: number | null }>(`SELECT AVG(rating) AS avg FROM tickets WHERE rating IS NOT NULL AND resolved_at >= ? AND resolved_at < ? AND ${p.sql}`, [c.period.start.toISOString(), c.period.end.toISOString(), ...p.params]); return r?.avg != null ? Math.round(r.avg * 10) / 10 : null; } },
  { key: 'escalation_closure_days', name: 'Escalation closure, days', band: 'service', ownerDept: 'DEV', unit: 'days', direction: 'down', target: 7, amberFactor: 1.5, source: 'computed', perPerson: false, periodKind: 'week',
    definition: 'Average days from a support escalation to the release of its fix, for issues released in the period. Source: Service desk and development issues.',
    compute: (c) => { const rows = app0(c).db.all<{ created_at: string; released_at: string }>('SELECT created_at, released_at FROM dev_issues WHERE released_at >= ? AND released_at < ? AND id IN (SELECT dev_issue_id FROM tickets WHERE dev_issue_id IS NOT NULL)', [c.period.start.toISOString(), c.period.end.toISOString()]); if (!rows.length) return null; return Math.round(rows.reduce((s, r) => s + (new Date(r.released_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000, 0) / rows.length * 10) / 10; } },
  { key: 'sprint_delivery', name: 'Sprint delivery', band: 'service', ownerDept: 'DEV', unit: 'pct', direction: 'up', target: 90, amberFactor: 0.85, source: 'computed', perPerson: false, periodKind: 'week',
    definition: 'Issues released in the week divided by issues released plus issues still in progress, review or QA. Source: Development issues.',
    compute: (c) => { const released = count(app0(c), 'SELECT count(*) AS n FROM dev_issues WHERE released_at >= ? AND released_at < ?', [c.period.start.toISOString(), c.period.end.toISOString()]); const carried = count(app0(c), "SELECT count(*) AS n FROM dev_issues WHERE status IN ('in_progress','in_review','in_qa','ready')"); return released + carried ? Math.round((released / (released + carried)) * 100) : null; } },
  { key: 'open_bugs_p1p2', name: 'Open P1 and P2 issues', band: 'service', ownerDept: 'DEV', unit: 'number', direction: 'down', target: 3, amberFactor: 2, source: 'computed', perPerson: false, periodKind: 'now',
    definition: 'Development issues of priority P1 or P2 not yet released. Source: Development issues.',
    compute: (c) => count(app0(c), "SELECT count(*) AS n FROM dev_issues WHERE status != 'released' AND priority IN ('P1','P2')") },
  // Operations --------------------------------------------------------------------------------------
  { key: 'work_orders_queue', name: 'Work orders in queue', band: 'operations', ownerDept: 'PRD', unit: 'number', direction: 'down', target: 25, amberFactor: 1.2, source: 'computed', perPerson: false, periodKind: 'now',
    definition: 'Work orders accepted and not yet dispatched. Source: Production work orders.',
    compute: (c) => count(app0(c), "SELECT count(*) AS n FROM work_orders WHERE kind = 'order' AND stage NOT IN ('dispatched','delivered')") },
  { key: 'wip_over_lead', name: 'WIP over lead time', band: 'operations', ownerDept: 'PRD', unit: 'number', direction: 'down', target: 0, amberFactor: 3, source: 'computed', perPerson: false, periodKind: 'now',
    definition: 'Work orders in production longer than their standard lead time. Source: Production work orders.',
    compute: (c) => count(app0(c), "SELECT count(*) AS n FROM work_orders WHERE kind = 'order' AND stage IN ('in_production','qc','packed') AND started_at IS NOT NULL AND julianday(?) - julianday(started_at) > lead_time_days", [c.now.toISOString()]) },
  { key: 'on_time_dispatch', name: 'On-time dispatch', band: 'operations', ownerDept: 'PRD', unit: 'pct', direction: 'up', target: 95, amberFactor: 0.93, source: 'computed', perPerson: false, periodKind: 'week',
    definition: 'Orders dispatched by the promised date as a share of orders dispatched in the period. Source: Dispatch records.',
    compute: (c) => { const r = onTimeDispatchRate(app0(c), c.period.start.toISOString()); return r.total ? Math.round((r.onTime / r.total) * 100) : null; } },
  { key: 'procurement_gap', name: 'Procurement forecast gap', band: 'operations', ownerDept: 'PRD', unit: 'inr', direction: 'down', target: 0, amberFactor: 1, source: 'manual', perPerson: false, periodKind: 'week',
    definition: 'Hardware value needed by deals expected to close in 30 days, minus stock and open purchase orders. Reported weekly by the Production HOD until procurement is in the system.' },
  { key: 'output_vs_plan', name: 'Output vs plan', band: 'operations', ownerDept: 'PRD', unit: 'pct', direction: 'up', target: 100, amberFactor: 0.9, source: 'manual', perPerson: false, periodKind: 'week',
    definition: 'Units completed against the plan for the week. Reported weekly by the Production HOD.' },
  // People and cash ---------------------------------------------------------------------------------
  { key: 'receivables_overdue', name: 'Receivables overdue', band: 'people', ownerDept: 'ACC', unit: 'inr', direction: 'down', target: 8_000_000, amberFactor: 1.25, source: 'manual', perPerson: false, periodKind: 'week',
    definition: 'Invoices past due date. Reported from Tally until the ledger sync is live.' },
  { key: 'collections_mtd', name: 'Collections, month to date', band: 'people', ownerDept: 'ACC', unit: 'inr', direction: 'up', target: 5_500_000, amberFactor: 0.7, source: 'manual', perPerson: false, periodKind: 'month',
    definition: 'Receipts recorded in the month. Reported from Tally until the ledger sync is live.' },
  { key: 'open_positions', name: 'Open positions', band: 'people', ownerDept: 'HR', unit: 'number', direction: 'none', target: null, amberFactor: 1, source: 'manual', perPerson: false, periodKind: 'week',
    definition: 'Approved vacancies not yet filled. Reported by HR until recruiting is in the system.' },
  { key: 'headcount', name: 'Active headcount', band: 'people', ownerDept: 'HR', unit: 'number', direction: 'none', target: null, amberFactor: 1, source: 'computed', perPerson: false, periodKind: 'now',
    definition: 'Employees with status active. Source: Employee master.',
    compute: (c) => count(app0(c), "SELECT count(*) AS n FROM employees WHERE status = 'active'") },
  { key: 'on_leave_today', name: 'On leave today', band: 'people', ownerDept: 'HR', unit: 'number', direction: 'none', target: null, amberFactor: 1, source: 'computed', perPerson: false, periodKind: 'now',
    definition: 'Employees with approved leave covering today. Source: Leave requests.',
    compute: (c) => { const d = localDateString(c.now); return count(app0(c), "SELECT count(DISTINCT employee_id) AS n FROM leave_requests WHERE status = 'approved' AND from_date <= ? AND to_date >= ?", [d, d]); } },
  { key: 'sop_compliance', name: 'SOP compliance', band: 'people', ownerDept: 'LEAD', unit: 'pct', direction: 'up', target: 90, amberFactor: 0.9, source: 'computed', perPerson: true, periodKind: 'week',
    definition: 'Checklist steps completed on time with evidence, as a share of steps due in the period. Source: SOP engine.',
    compute: (c) => compliance(app0(c), { assigneeIds: c.scope.type === 'company' ? undefined : c.people, from: localDateString(addDays(c.now, -7)), to: localDateString(c.now) }).pct },
  { key: 'overdue_tasks', name: 'Overdue tasks', band: 'people', ownerDept: 'LEAD', unit: 'number', direction: 'down', target: 0, amberFactor: 4, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Open tasks and approvals past their due date. Source: Tasks.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); return count(app0(c), `SELECT count(*) AS n FROM tasks WHERE status IN ('open','in_progress') AND due_at < ? AND ${p.sql}`, [c.now.toISOString(), ...p.params]); } },
  { key: 'approvals_pending_2d', name: 'Approvals waiting over 2 days', band: 'people', ownerDept: 'LEAD', unit: 'number', direction: 'down', target: 0, amberFactor: 3, source: 'computed', perPerson: true, periodKind: 'now',
    definition: 'Approval requests open for more than two days. Source: Tasks.',
    compute: (c) => { const p = peopleClause(c, 'assignee_id'); return count(app0(c), `SELECT count(*) AS n FROM tasks WHERE kind = 'approval' AND status = 'open' AND created_at < ? AND ${p.sql}`, [addDays(c.now, -2).toISOString(), ...p.params]); } }
];

function app0(c: KpiCtx): App { return c.app; }

export const KPI_BY_KEY: Record<string, KpiDef> = Object.fromEntries(KPI_DEFS.map((d) => [d.key, d]));

/** The 16 tiles of the company page, four per band (decision B2). */
export const COMPANY_TILES: Record<Band, string[]> = {
  revenue: ['bookings_mtd', 'pipeline_coverage', 'new_leads_week', 'overdue_followups'],
  service: ['open_tickets', 'sla_breaches_today', 'backlog_7d', 'implementations_avg_days'],
  operations: ['work_orders_queue', 'wip_over_lead', 'on_time_dispatch', 'procurement_gap'],
  people: ['receivables_overdue', 'collections_mtd', 'sop_compliance', 'headcount']
};

export const BAND_META: Record<Band, { name: string; owners: string }> = {
  revenue: { name: 'Revenue and pipeline', owners: 'Sales Head, Pre-sales' },
  service: { name: 'Service and delivery', owners: 'Technical Support, Development' },
  operations: { name: 'Operations', owners: 'Production' },
  people: { name: 'People and cash', owners: 'HR, Accounts' }
};

export function peopleInScope(app: App, scope: KpiScope): string[] {
  if (scope.type === 'company') return app.db.all<{ id: string }>("SELECT id FROM employees WHERE status = 'active'").map((r) => r.id);
  if (scope.type === 'department') return app.db.all<{ id: string }>("SELECT id FROM employees WHERE department_id = ? AND status = 'active'", [scope.id]).map((r) => r.id);
  return [scope.id];
}

export function weekPeriod(now: Date, weeksBack = 0): Period {
  const start = addDays(weekStart(now), -7 * weeksBack);
  return { start, end: addDays(start, 7), label: isoWeek(start) };
}

/** The live window for weekly KPIs: the last 7 days ending now, labelled with the current ISO week. */
export function livePeriod(now: Date): Period { return { start: addDays(now, -7), end: now, label: isoWeek(now) }; }

/** Month-to-date targets are prorated by the share of the month elapsed, so the first days of a month are not red by default. */
export function proratedTarget(def: KpiDef, target: number | null, now: Date): number | null {
  if (target === null || def.periodKind !== 'month') return target;
  const start = monthStart(now);
  const daysInMonth = Math.round((monthStart(addDays(start, 35)).getTime() - start.getTime()) / 86_400_000);
  const elapsed = Math.min(daysInMonth, Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86_400_000)));
  return Math.round(target * (elapsed / daysInMonth));
}

export function targetFor(app: App, key: string, scope: KpiScope): number | null {
  const row = app.db.get<{ target: number }>('SELECT target FROM kpi_targets WHERE key = ? AND scope_type = ? AND scope_id = ?', [key, scope.type, scope.id]);
  if (row) return row.target;
  const def = KPI_BY_KEY[key];
  if (!def) return null;
  if (scope.type === 'company') {
    const company = app.db.get<{ target: number }>('SELECT target FROM kpi_targets WHERE key = ? AND scope_type = ? AND scope_id = ?', [key, 'company', 'company']);
    return company ? company.target : def.target;
  }
  return def.target;
}

export function setTarget(app: App, actor: Employee, key: string, scope: KpiScope, target: number, reason: string): void {
  if (!KPI_BY_KEY[key]) throw new HttpError(404, 'Unknown KPI');
  if (!reason.trim()) throw new HttpError(400, 'A target change needs a reason.');
  const before = targetFor(app, key, scope);
  app.db.run('INSERT INTO kpi_targets (key, scope_type, scope_id, target, set_by, set_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key, scope_type, scope_id) DO UPDATE SET target = excluded.target, set_by = excluded.set_by, set_at = excluded.set_at, reason = excluded.reason',
    [key, scope.type, scope.id, target, actor.id, new Date().toISOString(), reason]);
  audit(app.db, { entity: 'kpi_target', entityId: `${key}:${scope.type}:${scope.id}`, action: 'set', actorId: actor.id, before: { target: before }, after: { target, reason } });
}

export type Rag = 'good' | 'warn' | 'crit' | 'neutral';

export function rag(def: KpiDef, value: number | null, target: number | null): Rag {
  if (value === null || target === null || def.direction === 'none') return 'neutral';
  if (def.direction === 'up') return value >= target ? 'good' : value >= target * def.amberFactor ? 'warn' : 'crit';
  if (target === 0) return value === 0 ? 'good' : value <= def.amberFactor ? 'warn' : 'crit';
  return value <= target ? 'good' : value <= target * def.amberFactor ? 'warn' : 'crit';
}

export function compute(app: App, key: string, scope: KpiScope, period: Period, now = new Date()): number | null {
  const def = KPI_BY_KEY[key];
  if (!def) throw new HttpError(404, 'Unknown KPI');
  if (def.source === 'manual' || !def.compute) {
    const row = app.db.get<{ value: number | null }>('SELECT value FROM kpi_snapshots WHERE key = ? AND scope_type = ? AND scope_id = ? AND period = ?', [key, scope.type, scope.id, period.label]);
    return row ? row.value : null;
  }
  return def.compute({ app, scope, period, people: peopleInScope(app, scope), now });
}

export function recordManual(app: App, actor: Employee, key: string, scope: KpiScope, period: string, value: number): void {
  const def = KPI_BY_KEY[key];
  if (!def) throw new HttpError(404, 'Unknown KPI');
  if (def.source !== 'manual') throw new HttpError(400, 'This KPI is computed by the system; it cannot be typed in.');
  app.db.run('INSERT INTO kpi_snapshots (key, scope_type, scope_id, period, value, target, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key, scope_type, scope_id, period) DO UPDATE SET value = excluded.value, computed_at = excluded.computed_at',
    [key, scope.type, scope.id, period, value, targetFor(app, key, scope), new Date().toISOString()]);
  audit(app.db, { entity: 'kpi_manual', entityId: `${key}:${scope.id}:${period}`, action: 'report', actorId: actor.id, after: { value } });
}

/** Store this week's computed values for every KPI and scope (runs every 15 minutes). */
export function snapshotNow(app: App, now = new Date()): number {
  const period = livePeriod(now);
  const scopes: KpiScope[] = [{ type: 'company', id: 'company' }];
  for (const d of app.db.all<{ id: string }>('SELECT id FROM departments')) scopes.push({ type: 'department', id: d.id });
  const people = app.db.all<{ id: string }>("SELECT id FROM employees WHERE status = 'active'").map((r) => ({ type: 'employee' as const, id: r.id }));
  let n = 0;
  app.db.transaction(() => {
    for (const def of KPI_DEFS) {
      if (def.source === 'manual' || !def.compute) continue;
      const targets = def.perPerson ? [...scopes, ...people] : scopes;
      for (const scope of targets) {
        const value = compute(app, def.key, scope, period, now);
        app.db.run('INSERT INTO kpi_snapshots (key, scope_type, scope_id, period, value, target, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key, scope_type, scope_id, period) DO UPDATE SET value = excluded.value, target = excluded.target, computed_at = excluded.computed_at',
          [def.key, scope.type, scope.id, period.label, value, targetFor(app, def.key, scope), now.toISOString()]);
        n++;
      }
    }
  });
  return n;
}

export interface SeriesPoint { period: string; value: number | null }

export function series(app: App, key: string, scope: KpiScope, weeks = 13, now = new Date()): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const current = weekPeriod(now).label;
  for (let i = weeks - 1; i >= 0; i--) {
    const label = weekPeriod(now, i).label;
    if (label === current && KPI_BY_KEY[key]?.source === 'computed') { out.push({ period: label, value: compute(app, key, scope, livePeriod(now), now) }); continue; }
    const row = app.db.get<{ value: number | null }>('SELECT value FROM kpi_snapshots WHERE key = ? AND scope_type = ? AND scope_id = ? AND period = ?', [key, scope.type, scope.id, label]);
    out.push({ period: label, value: row ? row.value : null });
  }
  return out;
}

export interface Tile { key: string; name: string; unit: Unit; value: number | null; display: string; target: number | null; targetDisplay: string; rag: Rag; delta: string; series: SeriesPoint[]; manual: boolean; definition: string; band: Band; ownerDept: string }

export function formatValue(unit: Unit, v: number | null): string {
  if (v === null || v === undefined) return '–';
  switch (unit) {
    case 'pct': return `${Math.round(v)}%`;
    case 'inr': return Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : `₹${Math.round(v).toLocaleString('en-IN')}`;
    case 'minutes': return v < 60 ? `${Math.round(v)} min` : `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')} h`;
    case 'days': return `${Math.round(v * 10) / 10} d`;
    case 'ratio': return `${(Math.round(v * 10) / 10).toFixed(1)}×`;
    case 'rating': return `${v.toFixed(1)} / 5`;
    default: return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString();
  }
}

export function tile(app: App, key: string, scope: KpiScope, now = new Date()): Tile {
  const def = KPI_BY_KEY[key];
  if (!def) throw new HttpError(404, `Unknown KPI ${key}`);
  const period = def.periodKind === 'month' ? { start: monthStart(now), end: now, label: isoWeek(now) } : livePeriod(now);
  const value = compute(app, key, scope, period, now);
  const fullTarget = targetFor(app, key, scope);
  const target = proratedTarget(def, fullTarget, now);
  const s = series(app, key, scope, 13, now);
  const prev = s.length >= 2 ? s[s.length - 2].value : null;
  let delta = '';
  if (value !== null && prev !== null && prev !== undefined) {
    const diff = value - prev;
    delta = diff === 0 ? 'unchanged vs last week' : `${diff > 0 ? '+' : ''}${def.unit === 'pct' ? Math.round(diff) + ' pts' : formatValue(def.unit, diff)} vs last week`;
  }
  if (def.periodKind === 'month' && fullTarget !== null && value !== null) delta = `${Math.round((value / fullTarget) * 100)}% of ${formatValue(def.unit, fullTarget)} month target`;
  return { key, name: def.name, unit: def.unit, value, display: formatValue(def.unit, value), target, targetDisplay: fullTarget === null ? 'not set' : formatValue(def.unit, fullTarget), rag: rag(def, value, target), delta, series: s, manual: def.source === 'manual', definition: def.definition, band: def.band, ownerDept: def.ownerDept };
}

export function tilesFor(app: App, keys: string[], scope: KpiScope, now = new Date()): Tile[] { return keys.map((k) => tile(app, k, scope, now)); }

export function companyPage(app: App, scope: KpiScope, now = new Date()): { band: Band; name: string; owners: string; tiles: Tile[] }[] {
  return (Object.keys(COMPANY_TILES) as Band[]).map((band) => ({ band, name: BAND_META[band].name, owners: BAND_META[band].owners, tiles: tilesFor(app, COMPANY_TILES[band], scope, now) }));
}

export function redStreak(app: App, key: string, scope: KpiScope, now = new Date()): number {
  const def = KPI_BY_KEY[key]; if (!def) return 0;
  const target = targetFor(app, key, scope);
  let streak = 0;
  for (const p of series(app, key, scope, 8, now).reverse()) { if (rag(def, p.value, target) === 'crit') streak++; else break; }
  return streak;
}

export function weekLabel(now = new Date()): string { return weekPeriod(now).label; }
