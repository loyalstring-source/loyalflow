// JSON API for the mobile app (and integrations). Reads live here; writes reuse the web action routes
// (same paths, send `Accept: application/json` and `Authorization: Bearer <token>`). See docs/API.md.
import type { App } from '../app.ts';
import { Router, json, cookie } from '../lib/http.ts';
import { type Employee, listEmployees, listDepartments, getEmployee, getDepartment } from '../modules/people/model.ts';
import { login, logout } from '../lib/auth.ts';
import { listTickets, getTicket, ticketEvents, slaState } from '../modules/desk/service.ts';
import { listDeals, getDeal, listActivities, listCustomers } from '../modules/sales/service.ts';
import { listWorkOrders, getWorkOrder, stagesInUse, WO_LABEL } from '../modules/production/service.ts';
import { listInstances, instanceSteps } from '../modules/sops/service.ts';
import { listTasks } from '../modules/tasks/service.ts';
import { companyPage, tile, series, KPI_BY_KEY, type KpiScope } from '../modules/kpi/engine.ts';
import { can, scopeFor, type Action } from '../lib/scope.ts';
import { unreadNotifications } from '../lib/notify.ts';
import { localDateString } from '../lib/time.ts';
import { buildToday } from './today.ts';
import { str, user, view } from './helpers.ts';
import { SESSION_COOKIE } from './auth.ts';

const ACTIONS: Action[] = ['desk.write', 'desk.manage', 'dev.write', 'sales.write', 'sales.manage', 'production.write', 'people.admin', 'settings.admin', 'reports.company', 'reports.export', 'sops.manage', 'tasks.assign'];

function publicUser(app: App, e: Employee) {
  return { id: e.id, name: e.full_name, email: e.email, designation: e.designation, department: getDepartment(app.db, e.department_id)?.code || e.department_id, role: e.functional_role, lang: e.lang, mustChangePassword: e.must_change_password === 1, permissions: ACTIONS.filter((a) => can(app.db, e, a)), scope: scopeFor(app.db, e).level };
}

export function registerPublicApi(r: Router<Employee>, app: App): void {
  r.post('/api/v1/auth/login', async (ctx) => {
    const b = await ctx.body();
    const result = login(app, str(b, 'email'), str(b, 'password'), 'api', String(ctx.req.headers['user-agent'] || 'mobile'));
    if (!result.ok) return json({ ok: false, error: result.reason }, 401);
    ctx.setCookies.push(cookie(SESSION_COOKIE, result.token, { maxAge: app.cfg.apiTokenDays * 86400, secure: app.cfg.cookieSecure }));
    return json({ ok: true, token: result.token, expiresInDays: app.cfg.apiTokenDays, user: publicUser(app, result.user) });
  });
}

export function registerApi(r: Router<Employee>, app: App): void {
  r.post('/api/v1/auth/logout', (ctx) => { logout(app, ctx.sessionToken); return json({ ok: true }); });
  r.get('/api/v1/me', (ctx) => json({ ok: true, user: publicUser(app, user(ctx)) }));

  r.get('/api/v1/today', (ctx) => {
    const v = view(ctx);
    const d = buildToday(app, v.user, v.deptCode);
    return json({ ok: true, date: localDateString(d.now), streak: d.streak, attendance: d.attendance, alerts: d.alerts,
      sops: d.runs.map((i) => ({ id: i.id, name: i.sop_name, status: i.status, dueAt: i.due_at, steps: instanceSteps(i) })),
      tickets: d.tickets.map((t) => ({ ...t, sla: slaState(t, d.now) })), deals: d.deals, overdueFollowups: d.overdueFollowups, workOrders: d.orders, tasks: d.tasks, approvals: d.approvals, myRequests: d.myRequests, notifications: d.notifications, kpis: d.myTiles.length ? d.myTiles : d.teamTiles, leave: d.leave });
  });

  r.get('/api/v1/tickets', (ctx) => {
    const me = user(ctx);
    const q = ctx.query;
    const now = new Date();
    const rows = listTickets(app, { status: q.get('status') === 'all' ? undefined : 'open', assigneeId: q.get('mine') === '1' ? me.id : undefined, q: q.get('q') || undefined, limit: Number(q.get('limit') || 200) });
    return json({ ok: true, items: rows.map((t) => ({ ...t, sla: slaState(t, now) })) });
  });
  r.get('/api/v1/tickets/:id', (ctx) => { const t = getTicket(app, ctx.params.id); if (!t) return json({ ok: false, error: 'Not found' }, 404); return json({ ok: true, ticket: { ...t, sla: slaState(t) }, events: ticketEvents(app, t.id) }); });

  r.get('/api/v1/deals', (ctx) => { const me = user(ctx); const q = ctx.query; return json({ ok: true, items: listDeals(app, { ownerIds: q.get('mine') === '1' ? [me.id] : undefined, open: q.get('all') !== '1', limit: Number(q.get('limit') || 300) }) }); });
  r.get('/api/v1/deals/:id', (ctx) => { const d = getDeal(app, ctx.params.id); if (!d) return json({ ok: false, error: 'Not found' }, 404); return json({ ok: true, deal: d, activities: listActivities(app, { dealId: d.id, limit: 100 }) }); });
  r.get('/api/v1/customers', (ctx) => json({ ok: true, items: listCustomers(app, ctx.query.get('q') || '') }));

  r.get('/api/v1/work-orders', (ctx) => { const me = user(ctx); const lang = (me.lang === 'hi' ? 'hi' : 'en') as 'en' | 'hi'; return json({ ok: true, stages: stagesInUse(app).map((s) => ({ key: s, label: WO_LABEL[s][lang] })), items: listWorkOrders(app, { open: ctx.query.get('all') !== '1', limit: 500 }) }); });
  r.get('/api/v1/work-orders/:id', (ctx) => { const w = getWorkOrder(app, ctx.params.id); if (!w) return json({ ok: false, error: 'Not found' }, 404); return json({ ok: true, workOrder: w }); });

  r.get('/api/v1/sops/today', (ctx) => { const me = user(ctx); return json({ ok: true, items: listInstances(app, { assigneeId: me.id, date: localDateString(new Date()) }).map((i) => ({ id: i.id, name: i.sop_name, status: i.status, dueAt: i.due_at, steps: instanceSteps(i) })) }); });
  r.get('/api/v1/approvals', (ctx) => { const me = user(ctx); return json({ ok: true, forMe: listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'] }), mine: listTasks(app, { requesterId: me.id, kind: 'approval', limit: 50 }) }); });
  r.get('/api/v1/tasks', (ctx) => { const me = user(ctx); return json({ ok: true, items: listTasks(app, { assigneeId: me.id, kind: 'task', status: ['open', 'in_progress'] }) }); });
  r.get('/api/v1/notifications', (ctx) => json({ ok: true, items: unreadNotifications(app.db, user(ctx).id, 50) }));

  r.get('/api/v1/kpi/company', (ctx) => { const me = user(ctx); if (!can(app.db, me, 'reports.company')) return json({ ok: false, error: 'Managers only' }, 403); return json({ ok: true, week: new Date().toISOString().slice(0, 10), bands: companyPage(app, { type: 'company', id: 'company' }).map((b) => ({ ...b, tiles: b.tiles.map((t) => ({ ...t, series: undefined, spark: t.series.map((p) => p.value) })) })) }); });
  r.get('/api/v1/kpi/:key', (ctx) => {
    const me = user(ctx);
    if (!KPI_BY_KEY[ctx.params.key]) return json({ ok: false, error: 'Unknown KPI' }, 404);
    const type = (ctx.query.get('scope') || 'employee') as KpiScope['type'];
    const scope: KpiScope = type === 'company' ? { type, id: 'company' } : type === 'department' ? { type, id: ctx.query.get('id') || me.department_id } : { type: 'employee', id: ctx.query.get('id') || me.id };
    const s = scopeFor(app.db, me);
    const allowed = scope.type === 'company' ? can(app.db, me, 'reports.company') : scope.type === 'department' ? s.level !== 'self' : s.people.has(scope.id);
    if (!allowed) return json({ ok: false, error: 'Not in your scope' }, 403);
    return json({ ok: true, tile: tile(app, ctx.params.key, scope), series: series(app, ctx.params.key, scope, 13) });
  });

  r.get('/api/v1/people', (ctx) => { const depts = listDepartments(app.db); return json({ ok: true, items: listEmployees(app.db, { status: 'active' }).map((e) => ({ id: e.id, name: e.full_name, designation: e.designation, department: depts.find((d) => d.id === e.department_id)?.name, email: e.email, mobile: e.mobile, reportsTo: e.reporting_manager_id ? getEmployee(app.db, e.reporting_manager_id)?.full_name : null })) }); });
}
