import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getDepartment } from '../modules/people/model.ts';
import { listWorkOrders, requireWorkOrder, createWorkOrder, moveWorkOrder, stagesInUse, onTimeDispatchRate, WO_LABEL, type WoStage } from '../modules/production/service.ts';
import { listCustomers } from '../modules/sales/service.ts';
import { auditTrail } from '../lib/audit.ts';
import { can, requireCan } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { localDateString, addDays } from '../lib/time.ts';
import { productionPage, woDrawer, woPage, newWoModal, type ProductionData, type WoDetail } from '../ui/pages/production.ts';
import { done, fail, view, user, str, num, render } from './helpers.ts';
import { timeFor, runningTimer, listProcurement } from '../modules/ops/service.ts';

function productionPeople(app: App): Employee[] {
  return listEmployees(app.db, { status: 'active' }).filter((e) => ['PRD', 'ACC'].includes(getDepartment(app.db, e.department_id)?.code || '') || e.designation.includes('Mechanical'));
}

export function buildProduction(app: App, me: Employee, q: URLSearchParams, now = new Date()): ProductionData {
  const today = localDateString(now);
  const filter = { late: q.get('late') === '1', mine: q.get('mine') === '1' };
  const open = listWorkOrders(app, { limit: 1000 }).filter((w) => w.stage !== 'delivered' || (w.delivered_at || '') >= addDays(now, -7).toISOString());
  let orders = open;
  if (filter.mine) orders = orders.filter((w) => w.assignee_id === me.id);
  if (filter.late) orders = orders.filter((w) => w.promised_date && w.promised_date < today && !['dispatched', 'delivered'].includes(w.stage));
  const ot = onTimeDispatchRate(app, addDays(now, -30).toISOString());
  const stats = {
    queue: open.filter((w) => w.stage === 'queued').length,
    wip: open.filter((w) => ['in_production', 'qc', 'packed'].includes(w.stage)).length,
    late: open.filter((w) => w.promised_date && w.promised_date < today && !['dispatched', 'delivered'].includes(w.stage)).length,
    dueToday: open.filter((w) => w.promised_date === today && !['dispatched', 'delivered'].includes(w.stage)).length,
    onTime: ot.total ? Math.round((ot.onTime / ot.total) * 100) : null
  };
  return { now, orders, stages: stagesInUse(app), filter, stats, canWrite: can(app.db, me, 'production.write'), canExport: can(app.db, me, 'reports.export') };
}

export function woDetail(app: App, me: Employee, id: string, now = new Date()): WoDetail {
  const w = requireWorkOrder(app, id);
  const trail = auditTrail(app.db, 'work_order', id, 50) as { at: string; actor_name?: string | null; action: string; after: string | null }[];
  const history = trail.map((a) => { let text = a.action; try { const after = a.after ? JSON.parse(a.after) : {}; if (a.action === 'stage') text = `→ ${WO_LABEL[(after.stage as WoStage)]?.en || after.stage}${after.qc ? ` (QC ${after.qc})` : ''}`; if (a.action === 'create') text = `Created · promised ${after.promised}`; if (a.action === 'assign') text = `Assigned to ${after.assignee}`; } catch { /* keep action */ } return { at: a.at, who: a.actor_name || null, text }; }).reverse();
  const t = timeFor(app, 'work_order', id);
  return { w, stages: stagesInUse(app), history, canWrite: can(app.db, me, 'production.write'), now, people: productionPeople(app), qcEnabled: getSetting(app.db, 'production').qcEnabled, time: { logs: t.logs, minutes: t.minutes, running: runningTimer(app, me.id) }, procurement: listProcurement(app, { workOrderId: id }) };
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/production', (ctx) => { const v = view(ctx); return htmlResponse(productionPage(v, buildProduction(app, v.user, ctx.query))); });
  r.get('/production/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'production.write'); return htmlResponse(newWoModal(v, { customers: listCustomers(app), people: productionPeople(app), lead: getSetting(app.db, 'production').defaultLeadTimeDays })); });
  r.get('/production/:id', (ctx) => redirect(`/work-orders/${ctx.params.id}`));
  r.get('/work-orders/:id', (ctx) => { const v = view(ctx); const x = woDetail(app, v.user, ctx.params.id); return render(ctx, () => woPage(v, x), () => woDrawer(v, x)); });

  r.post('/work-orders', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    const w = createWorkOrder(app, me, { customerId: str(b, 'customerId') || null, product: str(b, 'product'), qty: num(b, 'qty') ?? 1, kind: str(b, 'kind') === 'design_request' ? 'design_request' : 'order', promisedDate: str(b, 'promisedDate') || null, leadTimeDays: num(b, 'leadTimeDays') ?? undefined, assigneeId: str(b, 'assigneeId') || null, notes: str(b, 'notes') });
    return done(ctx, { reload: true, toast: { title: `${w.id} created`, body: `Promised ${w.promised_date}`, kind: 'success' } });
  });

  r.post('/work-orders/:id/move', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    const to = str(b, 'stage') as WoStage;
    try {
      const w = moveWorkOrder(app, me, ctx.params.id, to, { courier: str(b, 'courier'), consignment: str(b, 'consignment'), invoiceRef: str(b, 'invoiceRef'), photoBase64: str(b, 'photo') || undefined, photoName: str(b, 'photoName') || undefined, qcResult: (str(b, 'qcResult') || undefined) as 'pass' | 'rework' | 'reject' | undefined, notes: str(b, 'notes') });
      const lang = view(ctx).lang;
      const label = WO_LABEL[w.stage][lang];
      return done(ctx, { reload: true, confetti: w.stage === 'dispatched', close: w.stage === 'dispatched', toast: { title: `${w.id}: ${label}`, body: w.stage === 'dispatched' ? (lang === 'hi' ? 'ग्राहक को ईमेल भेज दिया गया।' : 'Customer notified by email.') : undefined, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.post('/work-orders/:id/assign', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    const w = requireWorkOrder(app, ctx.params.id);
    const assignee = str(b, 'assigneeId') || null;
    app.db.run('UPDATE work_orders SET assignee_id = ?, updated_at = ? WHERE id = ?', [assignee, new Date().toISOString(), w.id]);
    const { audit } = await import('../lib/audit.ts');
    audit(app.db, { entity: 'work_order', entityId: w.id, action: 'assign', actorId: me.id, after: { assignee: assignee ? listEmployees(app.db).find((e) => e.id === assignee)?.full_name : 'nobody' } });
    if (assignee && assignee !== me.id) app.notify.send({ employeeId: assignee, title: `${w.id} assigned to you`, body: `${w.product} × ${w.qty}`, link: `/work-orders/${w.id}` });
    return done(ctx, { reload: true, toast: { title: 'Assignee saved', kind: 'success' } });
  });
}
