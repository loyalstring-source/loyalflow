import { estimatesOfDeal, canEditEstimate } from '../modules/sales/estimates.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getDepartment } from '../modules/people/model.ts';
import { listDeals, requireDeal, createDeal, updateDeal, moveDeal, createQuote, listQuotes, addActivity, listActivities, listCustomers, getCustomer, WIN_CHANCE, LOST_REASONS, STAGES, type Stage, type Deal, type Customer } from '../modules/sales/service.ts';
import { listTickets } from '../modules/desk/service.ts';
import { listWorkOrders } from '../modules/production/service.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { monthStart } from '../lib/time.ts';
import { pipelinePage, dealDrawer, dealPage, newLeadModal, activityModal, customersPage, customerPage, type PipelineData, type DealDetail } from '../ui/pages/sales.ts';
import { done, fail, view, user, str, num, bool, render } from './helpers.ts';

function salesPeople(app: App): Employee[] {
  return listEmployees(app.db, { status: 'active' }).filter((e) => ['SAL', 'PRE'].includes(getDepartment(app.db, e.department_id)?.code || '') || e.functional_role === 'executive');
}

function discountRule(app: App): string {
  const rules = getSetting(app.db, 'approvals').discount;
  const parts = rules.map((r) => `${r.maxPct !== undefined ? `up to ${r.maxPct}%` : 'above that'}: ${r.role === 'self' ? 'no approval' : r.role.replace('_', ' ')}`);
  return `Discount routing — ${parts.join('; ')}. Approval is requested automatically when the quote is created.`;
}

export function buildPipeline(app: App, me: Employee, q: URLSearchParams, now = new Date()): PipelineData {
  const scope = scopeFor(app.db, me);
  const filter = { mine: q.get('mine') === '1', team: q.get('team') === '1', stale: q.get('stale') === '1', q: q.get('q') || '', owner: q.get('owner') || '' };
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  let deals = listDeals(app, { ownerIds: filter.mine ? [me.id] : filter.team ? [...scope.people] : filter.owner ? [filter.owner] : undefined, limit: 2000 }).filter((d) => d.stage !== 'lost' && (d.stage !== 'won' || (d.won_at || '') >= since));
  if (filter.stale) deals = deals.filter((d) => (d.days_in_stage || 0) > 14 && d.stage !== 'won');
  if (q.get('overdue') === '1') deals = deals.filter((d) => d.next_step_due && d.next_step_due.slice(0, 10) < now.toISOString().slice(0, 10));
  if (filter.q) { const like = filter.q.toLowerCase(); deals = deals.filter((d) => (d.customer_name || '').toLowerCase().includes(like) || d.title.toLowerCase().includes(like) || d.id.toLowerCase().includes(like)); }
  const all = listDeals(app, { open: true, limit: 5000 });
  const month = monthStart(now).toISOString();
  const won = listDeals(app, { wonSince: month, limit: 1000 });
  const stats = {
    open: all.length, openValue: all.reduce((n, d) => n + d.value * (1 - d.discount_pct / 100), 0),
    weighted: all.reduce((n, d) => n + d.value * (1 - d.discount_pct / 100) * WIN_CHANCE[d.stage] / 100, 0),
    wonMonth: won.length, wonMonthValue: won.reduce((n, d) => n + d.value * (1 - d.discount_pct / 100), 0),
    overdue: all.filter((d) => d.next_step_due && d.next_step_due.slice(0, 10) < now.toISOString().slice(0, 10) && scope.people.has(d.owner_id)).length
  };
  return { now, deals, filter, owners: salesPeople(app).filter((e) => scope.people.has(e.id)), stats, canWrite: can(app.db, me, 'sales.write'), canExport: can(app.db, me, 'reports.export') };
}

export function dealDetail(app: App, me: Employee, id: string, now = new Date()): DealDetail {
  const d = requireDeal(app, id);
  return { d, activities: listActivities(app, { dealId: id, limit: 100 }), quotes: listQuotes(app, id), estimates: estimatesOfDeal(app, id), canEditEstimate: canEditEstimate(app, me, d), canOpenEstimate: (() => { const sc = scopeFor(app.db, me); return sc.level === 'company' || can(app.db, me, 'sales.manage') || sc.people.has(d.owner_id || ''); })(), now, canWrite: can(app.db, me, 'sales.write'), canManage: can(app.db, me, 'sales.manage'), owners: salesPeople(app), customer: getCustomer(app, d.customer_id) || null, discountRule: discountRule(app) };
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/pipeline', (ctx) => { const v = view(ctx); return htmlResponse(pipelinePage(v, buildPipeline(app, v.user, ctx.query))); });
  r.get('/pipeline/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'sales.write'); return htmlResponse(newLeadModal(v, { customers: listCustomers(app), owners: salesPeople(app), canManage: can(app.db, v.user, 'sales.manage') })); });
  r.get('/pipeline/activity', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'sales.write'); const mine = listDeals(app, { ownerIds: v.isManager ? undefined : [v.user.id], open: true, limit: 300 }); return htmlResponse(activityModal(v, { deals: mine, kind: ctx.query.get('kind') || 'call' })); });
  r.get('/sales', () => redirect('/pipeline'));
  r.get('/sales/:id', (ctx) => redirect(`/deals/${ctx.params.id}`));

  r.get('/deals/:id', (ctx) => { const v = view(ctx); const x = dealDetail(app, v.user, ctx.params.id); return render(ctx, () => dealPage(v, x), () => dealDrawer(v, x)); });

  r.post('/deals', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sales.write');
    const b = await ctx.body();
    const value = num(b, 'value');
    if (value === null) return fail(ctx, 400, 'Enter the estimated value.');
    const ownerId = can(app.db, me, 'sales.manage') && str(b, 'ownerId') ? str(b, 'ownerId') : me.id;
    const d = createDeal(app, me, { customerId: str(b, 'customerId') || undefined, customerName: str(b, 'customerName') || undefined, city: str(b, 'city'), title: str(b, 'title'), value, source: str(b, 'source'), nextStep: str(b, 'nextStep'), ownerId, expectedClose: str(b, 'expectedClose') || null });
    return done(ctx, { reload: true, toast: { title: `Lead created: ${d.customer_name}`, body: 'Qualify it: need, budget and timeline unlock the next stage.', kind: 'success' } });
  });

  r.post('/deals/:id/move', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sales.write');
    const b = await ctx.body();
    const to = str(b, 'stage') as Stage;
    if (!STAGES.includes(to)) return fail(ctx, 400, 'Unknown stage');
    try {
      const d = moveDeal(app, me, ctx.params.id, to);
      if (to === 'won') return done(ctx, { reload: true, confetti: true, close: true, toast: { title: `${d.customer_name} is won! 🎉`, body: 'Work order, invoice request and implementation ticket created.', kind: 'success' } });
      return done(ctx, { reload: true, toast: { title: `Moved to ${to}`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.post('/deals/:id/lost', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sales.write');
    const b = await ctx.body();
    const reason = LOST_REASONS.includes(str(b, 'reason')) ? str(b, 'reason') : (str(b, 'note') || 'No response');
    moveDeal(app, me, ctx.params.id, 'lost', { lostReason: reason });
    return done(ctx, { reload: true, close: true, toast: { title: 'Marked lost', body: reason, kind: 'warn' } });
  });

  r.post('/deals/:id/update', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sales.write');
    const b = await ctx.body();
    const patch: Parameters<typeof updateDeal>[3] = {
      title: str(b, 'title') || undefined, value: num(b, 'value') ?? undefined, expected_close: str(b, 'expected_close') || null,
      qualified_need: str(b, 'qualified_need'), qualified_budget: str(b, 'qualified_budget'), qualified_timeline: str(b, 'qualified_timeline'), po_received: bool(b, 'po_received') ? 1 : 0
    };
    if (can(app.db, me, 'sales.manage') && str(b, 'owner_id')) patch.owner_id = str(b, 'owner_id');
    updateDeal(app, me, ctx.params.id, patch);
    return done(ctx, { reload: true, toast: { title: 'Deal updated', kind: 'success' } });
  });

  r.post('/deals/:id/quote', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sales.write');
    const b = await ctx.body();
    const { deal, quoteId, approvalTaskId } = createQuote(app, me, ctx.params.id, { discountPct: num(b, 'discountPct') ?? 0, currency: str(b, 'currency') || undefined, listTotal: num(b, 'listTotal') ?? undefined });
    return done(ctx, { reload: true, toast: { title: `Quote ${quoteId} created`, body: approvalTaskId ? `${deal.discount_pct}% discount sent for approval.` : 'No approval needed.', kind: approvalTaskId ? 'warn' : 'success' } });
  });

  r.post('/deals/:id/activity', async (ctx) => logActivity(ctx, app, ctx.params.id));
  r.post('/activities', async (ctx) => logActivity(ctx, app, null));

  r.get('/customers', (ctx) => {
    const v = view(ctx);
    const q = ctx.query.get('q') || '';
    const rows = app.db.all<Customer & { deals: number; open_tickets: number; orders: number; owner_name: string | null }>(`SELECT c.*, e.full_name AS owner_name,
      (SELECT count(*) FROM deals d WHERE d.customer_id = c.id) AS deals,
      (SELECT count(*) FROM tickets t WHERE t.customer_id = c.id AND t.status NOT IN ('resolved','closed')) AS open_tickets,
      (SELECT count(*) FROM work_orders w WHERE w.customer_id = c.id) AS orders
      FROM customers c LEFT JOIN employees e ON e.id = c.owner_id ${q ? 'WHERE c.name LIKE ? OR c.city LIKE ?' : ''} ORDER BY c.name`, q ? [`%${q}%`, `%${q}%`] : []);
    return htmlResponse(customersPage(v, { customers: rows, q, canWrite: can(app.db, v.user, 'sales.write') }));
  });
  r.get('/customers/:id', (ctx) => {
    const v = view(ctx);
    const c = getCustomer(app, ctx.params.id);
    if (!c) throw new HttpError(404, 'Customer not found');
    const deals = listDeals(app, { limit: 200 }).filter((d) => d.customer_id === c.id);
    return htmlResponse(customerPage(v, { c, deals, tickets: listTickets(app, { customerId: c.id, limit: 100 }), orders: listWorkOrders(app, { limit: 500 }).filter((w) => w.customer_id === c.id), activities: listActivities(app, { limit: 500 }).filter((a) => a.customer_id === c.id) }));
  });
}

async function logActivity(ctx: Parameters<typeof user>[0], app: App, dealId: string | null) {
  const me = user(ctx); requireCan(app.db, me, 'sales.write');
  const b = await ctx.body();
  const kind = str(b, 'kind') as 'call' | 'visit' | 'demo' | 'email' | 'note';
  if (!['call', 'visit', 'demo', 'email', 'note'].includes(kind)) return fail(ctx, 400, 'Pick the activity type.');
  const id = dealId || str(b, 'dealId') || null;
  const lat = num(b, 'lat'), lng = num(b, 'lng');
  if (kind === 'visit' && (lat === null || lng === null) && !app.cfg.demo) return fail(ctx, 400, 'A visit needs your location. Allow location access and try again.');
  const a = addActivity(app, me, { dealId: id, kind, notes: str(b, 'notes'), outcome: str(b, 'outcome'), lat, lng });
  if (id && (str(b, 'next_step') || str(b, 'next_step_due'))) updateDeal(app, me, id, { next_step: str(b, 'next_step'), next_step_due: str(b, 'next_step_due') || null });
  return done(ctx, { reload: true, toast: { title: kind === 'visit' ? 'Visit logged' : kind === 'call' ? 'Call logged' : 'Activity saved', body: kind === 'visit' && a.km ? `${a.km} km from your previous visit today.` : kind === 'visit' && lat !== null ? 'Location captured.' : undefined, kind: 'success' } });
}

export type { Deal };
