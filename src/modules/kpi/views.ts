// Which KPIs each department and each person sees. Keys refer to KPI_DEFS in engine.ts.
import { KPI_BY_KEY } from './engine.ts';

export const DEPT_KPIS: Record<string, string[]> = {
  SAL: ['bookings_mtd', 'pipeline_coverage', 'overdue_followups', 'win_rate_90d', 'appointments_week', 'sop_compliance'],
  PRE: ['new_leads_week', 'calls_week', 'overdue_followups', 'sop_compliance'],
  DM: ['campaign_leads', 'new_leads_week', 'sop_compliance'],
  SUP: ['open_tickets', 'sla_breaches_today', 'backlog_7d', 'first_response_median', 'sla_compliance', 'reopen_rate', 'customer_rating', 'implementations_avg_days', 'sop_compliance'],
  DEV: ['sprint_delivery', 'open_bugs_p1p2', 'escalation_closure_days', 'sop_compliance'],
  QA: ['sprint_delivery', 'open_bugs_p1p2', 'sop_compliance'],
  PRD: ['work_orders_queue', 'wip_over_lead', 'on_time_dispatch', 'procurement_gap', 'output_vs_plan', 'sop_compliance'],
  ACC: ['receivables_overdue', 'collections_mtd', 'sop_compliance'],
  HR: ['open_positions', 'headcount', 'on_leave_today', 'sop_compliance'],
  LEAD: ['sop_compliance', 'overdue_tasks', 'approvals_pending_2d']
};

/** The per-person KPIs shown on an employee's own Today page and profile. */
export function personKpis(deptCode: string): string[] {
  const base = DEPT_KPIS[deptCode] || DEPT_KPIS.LEAD;
  const keys = base.filter((k) => KPI_BY_KEY[k]?.perPerson);
  return keys.slice(0, 4);
}

export function deptKpis(deptCode: string): string[] { return DEPT_KPIS[deptCode] || DEPT_KPIS.LEAD; }

/** The four tiles a manager sees on Today for their own area. */
export function managerTiles(deptCode: string): string[] { return deptKpis(deptCode).slice(0, 4); }

export const EXEC_TODAY_TILES = ['bookings_mtd', 'sla_breaches_today', 'wip_over_lead', 'sop_compliance'];
