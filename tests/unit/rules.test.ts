import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, COO, CEO, SALES_HEAD, SUPPORT_LEAD, SUPPORT_IC, BDM, PRODUCTION_LEAD, HR } from '../helpers.ts';
import { can, scopeFor } from '../../src/lib/scope.ts';
import { routeApproval } from '../../src/modules/tasks/service.ts';
import { rag, formatValue, proratedTarget, KPI_BY_KEY } from '../../src/modules/kpi/engine.ts';
import { dueDates, slaState } from '../../src/modules/desk/service.ts';
import { fromLocal } from '../../src/lib/time.ts';
import { exitRuleProblem, type Deal } from '../../src/modules/sales/service.ts';

test('permissions follow department and role', () => {
  const app = testApp();
  const coo = emp(app, COO), lead = emp(app, SUPPORT_LEAD), ic = emp(app, SUPPORT_IC), bdm = emp(app, BDM), prd = emp(app, PRODUCTION_LEAD), hr = emp(app, HR);
  assert.equal(can(app.db, coo, 'settings.admin'), true);
  assert.equal(can(app.db, lead, 'settings.admin'), false);
  assert.equal(can(app.db, lead, 'desk.manage'), true);
  assert.equal(can(app.db, ic, 'desk.write'), true);
  assert.equal(can(app.db, ic, 'desk.manage'), false);
  assert.equal(can(app.db, ic, 'sales.write'), false);
  assert.equal(can(app.db, bdm, 'sales.write'), true);
  assert.equal(can(app.db, bdm, 'sales.manage'), false);
  assert.equal(can(app.db, emp(app, SALES_HEAD), 'sales.manage'), true);
  assert.equal(can(app.db, prd, 'production.write'), true);
  assert.equal(can(app.db, bdm, 'production.write'), false);
  assert.equal(can(app.db, hr, 'people.admin'), true);
  assert.equal(can(app.db, ic, 'reports.company'), false);
  assert.equal(can(app.db, lead, 'reports.company'), true);
});

test('scope: executives see the company, team leads their subtree, ICs themselves', () => {
  const app = testApp();
  assert.equal(scopeFor(app.db, emp(app, CEO)).level, 'company');
  const lead = scopeFor(app.db, emp(app, SUPPORT_LEAD));
  assert.equal(lead.level, 'team');
  assert.ok(lead.people.has(emp(app, SUPPORT_IC).id));
  assert.ok(!lead.people.has(emp(app, BDM).id));
  const self = scopeFor(app.db, emp(app, SUPPORT_IC));
  assert.equal(self.level, 'self');
  assert.equal(self.people.size, 1);
});

test('approval routing follows the thresholds', () => {
  const app = testApp();
  const ic = emp(app, SUPPORT_IC), bdm = emp(app, BDM);
  assert.equal(routeApproval(app, ic, 'expense', 5000).approverId, ic.reporting_manager_id); // team lead
  assert.equal(routeApproval(app, ic, 'expense', 30000).approverId, 'LS002'); // SUP HOD is the COO
  assert.equal(routeApproval(app, ic, 'expense', 80000).approverId, 'LS002'); // COO
  assert.equal(routeApproval(app, bdm, 'discount', 4).ruleRole, 'self');
  assert.equal(routeApproval(app, bdm, 'discount', 8).approverId, 'LS028'); // Sales Head
  assert.equal(routeApproval(app, bdm, 'discount', 14).approverId, 'LS002'); // COO
  assert.equal(routeApproval(app, ic, 'leave', 2).approverId, ic.reporting_manager_id);
  assert.equal(routeApproval(app, bdm, 'leave', 5).approverId, 'LS028'); // HOD of sales
});

test('KPI RAG thresholds, formatting and prorated month targets', () => {
  const up = KPI_BY_KEY.sla_compliance, down = KPI_BY_KEY.sla_breaches_today, downT = KPI_BY_KEY.backlog_7d;
  assert.equal(rag(up, 96, 95), 'good'); assert.equal(rag(up, 92, 95), 'warn'); assert.equal(rag(up, 80, 95), 'crit'); assert.equal(rag(up, null, 95), 'neutral');
  assert.equal(rag(down, 0, 0), 'good'); assert.equal(rag(down, 2, 0), 'warn'); assert.equal(rag(down, 3, 0), 'crit');
  assert.equal(rag(downT, 5, 5), 'good'); assert.equal(rag(downT, 6, 5), 'warn'); assert.equal(rag(downT, 9, 5), 'crit');
  assert.equal(formatValue('inr', 6_000_000), '₹60.0 L'); assert.equal(formatValue('pct', 95.4), '95%'); assert.equal(formatValue('minutes', 110), '1:50 h'); assert.equal(formatValue('ratio', 2.96), '3.0×'); assert.equal(formatValue('number', null), '–');
  const t = proratedTarget(KPI_BY_KEY.bookings_mtd, 6_000_000, fromLocal(2026, 11, 15, 12, 0));
  assert.equal(t, 3_000_000);
  assert.equal(proratedTarget(KPI_BY_KEY.sla_compliance, 95, new Date()), 95);
});

test('SLA clocks: P1 runs always-on, P2 on the support calendar; states move ok → warn → breach', () => {
  const app = testApp();
  const from = fromLocal(2026, 11, 7, 18, 30); // Saturday 18:30 IST
  const p1 = dueDates(app, 'P1', from);
  assert.equal(p1.resolveDue.getTime() - from.getTime(), 240 * 60_000);
  const p2 = dueDates(app, 'P2', from);
  assert.equal(p2.responseDue.getTime(), fromLocal(2026, 11, 10, 10, 30).getTime()); // skips Sunday and the 9 Nov holiday
  const t = { status: 'in_progress' as const, resolve_due_at: new Date(from.getTime() + 240 * 60_000).toISOString(), resolved_at: null, within_sla: null, created_at: from.toISOString() };
  assert.equal(slaState(t, new Date(from.getTime() + 60 * 60_000)).state, 'ok');
  assert.equal(slaState(t, new Date(from.getTime() + 200 * 60_000)).state, 'warn');
  assert.equal(slaState(t, new Date(from.getTime() + 300 * 60_000)).state, 'breach');
  assert.equal(slaState({ ...t, status: 'resolved', resolved_at: 'x', within_sla: 1 }).state, 'met');
  assert.equal(slaState({ ...t, status: 'resolved', resolved_at: 'x', within_sla: 0 }).state, 'missed');
});

test('pipeline exit rules block premature stage moves', () => {
  const d = { qualified_need: '', qualified_budget: '', qualified_timeline: '', quote_attached: 0, discount_status: 'none', po_received: 0 } as unknown as Deal;
  assert.match(exitRuleProblem(d, 'qualified')!, /need, budget and timeline/);
  assert.match(exitRuleProblem(d, 'proposal')!, /estimate/);
  assert.match(exitRuleProblem({ ...d, discount_status: 'pending' }, 'won')!, /discount/);
  assert.match(exitRuleProblem({ ...d, discount_status: 'approved' }, 'won')!, /PO/);
  assert.equal(exitRuleProblem({ ...d, quote_attached: 1, discount_status: 'approved', po_received: 1 }, 'won'), null);
  assert.equal(exitRuleProblem(d, 'contacted'), null);
});
