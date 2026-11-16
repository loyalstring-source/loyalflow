import * as lists from '../lib/lists.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees } from '../modules/people/model.ts';
import { listTasks, getTask, createTask, decideTask, completeTask, toggleTimer, requestLeave, submitExpense, requestApproval, payloadOf } from '../modules/tasks/service.ts';
import { setTarget, type KpiScope } from '../modules/kpi/engine.ts';
import { applyRegularisationDecision, requireMissPunchComment } from '../modules/hr/attendance.ts';
import { applyAppraisalDecision } from '../modules/hr/appraisal.ts';
import { applyRequisitionDecision, applyOfferDecision } from '../modules/hr/recruiting.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { approvalsPage, leaveModal, expenseModal, purchaseModal, tasksPage, newTaskModal, type ApprovalsData } from '../ui/pages/tasks.ts';
import { leaveBalance } from './today.ts';
import { budgets, budgetFor } from '../modules/ops/service.ts';
import { listDeals } from '../modules/sales/service.ts';
import { getEmployee } from '../modules/people/model.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  r.get('/approvals', (ctx) => {
    const v = view(ctx); const me = v.user; const now = new Date();
    const tab = ['forme', 'mine', 'history'].includes(ctx.query.get('tab') || '') ? ctx.query.get('tab')! : 'forme';
    const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const d: ApprovalsData = {
      now, tab,
      forMe: listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'], limit: 200 }),
      mine: listTasks(app, { requesterId: me.id, kind: 'approval', limit: 100 }).filter((t) => t.created_at >= since),
      history: listTasks(app, { kind: 'approval', status: ['approved', 'declined'], limit: 500 }).filter((t) => t.decided_by === me.id).slice(0, 60),
      leave: leaveBalance(app, me.id, now),
      budgetByRequester: (() => { const all = budgets(app); const out: ApprovalsData['budgetByRequester'] = {}; for (const t of listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'], limit: 200 })) { if (!t.requester_id || out[t.requester_id]) continue; const e = getEmployee(app.db, t.requester_id); const b = e ? all.find((x) => x.department_id === e.department_id) : undefined; if (b) out[t.requester_id] = { remaining: b.remaining, amount: b.amount, department: b.department }; } return out; })(),
      leaveRows: app.db.all('SELECT id, type, from_date, to_date, days, status, reason FROM leave_requests WHERE employee_id = ? ORDER BY from_date DESC LIMIT 20', [me.id]),
      expenseRows: app.db.all('SELECT id, category, amount, status, description, created_at FROM expenses WHERE employee_id = ? ORDER BY created_at DESC LIMIT 20', [me.id])
    };
    return htmlResponse(approvalsPage(v, d));
  });
  r.get('/approvals/leave/new', (ctx) => { const v = view(ctx); return htmlResponse(leaveModal(v, leaveBalance(app, v.user.id))); });
  r.get('/approvals/expense/new', (ctx) => { const v = view(ctx); const deals = ['SAL', 'PRE'].includes(v.deptCode) || v.isManager ? listDeals(app, { ownerIds: v.isManager ? undefined : [v.user.id], open: true, limit: 200 }).map((d) => ({ id: d.id, label: `${d.customer_name} · ${d.title || d.id}` })) : []; const b = budgetFor(app, v.user.id); return htmlResponse(expenseModal(v, deals, b ? { remaining: b.remaining, amount: b.amount } : null)); });
  r.get('/approvals/purchase/new', (ctx) => htmlResponse(purchaseModal(view(ctx))));

  r.post('/leave', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try {
      const { task } = requestLeave(app, me, { type: lists.isActive('hr.leaveTypes', str(b, 'type')) ? str(b, 'type') : (lists.items('hr.leaveTypes')[0]?.value || 'CL'), from: str(b, 'from'), to: str(b, 'to'), reason: str(b, 'reason') });
      if (task.assignee_id && task.assignee_id !== me.id) app.notify.send({ employeeId: task.assignee_id, title: `Leave request from ${me.full_name}`, body: task.details, link: '/approvals', kind: 'info' });
      return done(ctx, { reload: true, toast: { title: task.status === 'approved' ? 'Leave approved' : 'Leave request sent', body: task.status === 'approved' ? 'Within your own limit.' : `Waiting for ${task.assignee_name}.`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.post('/expenses', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const amount = num(b, 'amount');
    if (!amount || amount <= 0) return fail(ctx, 400, 'Enter an amount.');
    const { task, expenseId } = submitExpense(app, me, { category: str(b, 'category') || 'Other', amount, description: str(b, 'description') });
    if (str(b, 'dealId') || num(b, 'km') !== null) app.db.run('UPDATE expenses SET deal_id = ?, km = ? WHERE id = ?', [str(b, 'dealId') || null, num(b, 'km'), expenseId]);
    if (task.assignee_id && task.assignee_id !== me.id) app.notify.send({ employeeId: task.assignee_id, title: `Expense claim from ${me.full_name}`, body: task.title, link: '/approvals', kind: 'info' });
    return done(ctx, { reload: true, toast: { title: 'Expense submitted', body: `Routed to ${task.assignee_name}.`, kind: 'success' } });
  });

  r.post('/purchases', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const amount = num(b, 'amount');
    if (!amount || amount <= 0 || !str(b, 'title')) return fail(ctx, 400, 'Give the request a title and an amount.');
    const task = requestApproval(app, me, 'purchase', amount, `Purchase: ${str(b, 'title')} (₹${Math.round(amount).toLocaleString('en-IN')})`, `${str(b, 'details')}${str(b, 'neededBy') ? ` Needed by ${str(b, 'neededBy')}.` : ''}`, {}, '/approvals');
    if (task.assignee_id && task.assignee_id !== me.id) app.notify.send({ employeeId: task.assignee_id, title: `Purchase request from ${me.full_name}`, body: task.title, link: '/approvals', kind: 'info' });
    return done(ctx, { reload: true, toast: { title: 'Purchase request sent', body: `Routed to ${task.assignee_name}.`, kind: 'success' } });
  });

  r.post('/tasks/:id/decide', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const decision = str(b, 'decision') === 'approved' ? 'approved' : 'declined';
    try {
      const pre = getTask(app, ctx.params.id);
      if (pre && payloadOf<{ kind?: string }>(pre).kind === 'regularisation') requireMissPunchComment(str(b, 'note'));
      const t = decideTask(app, me, ctx.params.id, decision, str(b, 'note'));
      const p = payloadOf<{ kind?: string; key?: string; scope?: KpiScope; target?: number; regularisationId?: string; appraisalId?: string; requisitionId?: string; offerId?: string }>(t);
      if (decision === 'approved' && p.kind === 'kpi_target' && p.key && p.scope && typeof p.target === 'number') setTarget(app, me, p.key, p.scope, p.target, `Approved proposal ${t.id} from ${t.requester_name}`);
      if (p.kind === 'regularisation' && p.regularisationId) applyRegularisationDecision(app, me, p.regularisationId, decision, str(b, 'note'));
      if (p.kind === 'appraisal' && p.appraisalId) applyAppraisalDecision(app, me, p.appraisalId, decision);
      if (p.kind === 'requisition' && p.requisitionId) applyRequisitionDecision(app, me, p.requisitionId, decision);
      if (p.kind === 'offer' && p.offerId) applyOfferDecision(app, me, p.offerId, decision);
      return done(ctx, { toast: { title: decision === 'approved' ? 'Approved' : 'Declined', body: t.title, kind: decision === 'approved' ? 'success' : 'warn' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.get('/tasks', (ctx) => {
    const v = view(ctx); const me = v.user;
    const canAssign = can(app.db, me, 'tasks.assign');
    const mine = listTasks(app, { assigneeId: me.id, kind: 'task', status: ['open', 'in_progress'], limit: 200 });
    const assigned = canAssign ? listTasks(app, { kind: 'task', status: ['open', 'in_progress'], limit: 500 }).filter((t) => t.created_by === me.id && t.assignee_id !== me.id) : [];
    const doneRows = listTasks(app, { assigneeId: me.id, kind: 'task', status: ['done'], limit: 10 });
    return htmlResponse(tasksPage(v, { now: new Date(), mine, assigned, done: doneRows, canAssign }));
  });
  r.get('/tasks/new', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'tasks.assign');
    const scope = scopeFor(app.db, v.user);
    return htmlResponse(newTaskModal(v, listEmployees(app.db, { status: 'active' }).filter((e) => scope.people.has(e.id) && e.id !== v.user.id)));
  });
  r.post('/tasks', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const assignee = str(b, 'assigneeId') || me.id;
    if (assignee !== me.id) { requireCan(app.db, me, 'tasks.assign'); if (!scopeFor(app.db, me).people.has(assignee)) return fail(ctx, 403, 'You can only assign tasks to people in your reporting line.'); }
    const t = createTask(app, me, { kind: 'task', type: 'general', title: str(b, 'title'), details: str(b, 'details'), assigneeId: assignee, requesterId: me.id, dueAt: str(b, 'dueAt') ? `${str(b, 'dueAt')}T12:30:00.000Z` : null });
    if (assignee !== me.id) app.notify.send({ employeeId: assignee, title: `New task from ${me.full_name}`, body: t.title, link: '/tasks', kind: 'info' });
    return done(ctx, { reload: true, toast: { title: 'Task assigned', body: t.title, kind: 'success' } });
  });
  r.post('/tasks/:id/complete', async (ctx) => {
    const me = user(ctx);
    const t = getTask(app, ctx.params.id);
    if (!t) return fail(ctx, 404, 'Task not found');
    if (t.assignee_id !== me.id && t.created_by !== me.id && !can(app.db, me, 'tasks.assign')) return fail(ctx, 403, 'Not your task');
    const r = completeTask(app, me, t.id);
    return done(ctx, { confetti: true, toast: { title: 'Done ✓', body: r.minutes_logged ? `${r.minutes_logged} minutes logged.` : t.title, kind: 'success' } });
  });
  r.post('/tasks/:id/timer', async (ctx) => {
    const me = user(ctx);
    const t = getTask(app, ctx.params.id);
    if (!t || t.assignee_id !== me.id) return fail(ctx, 403, 'Not your task');
    const r = toggleTimer(app, me, t.id);
    return done(ctx, { reload: true, toast: { title: r.timer_started_at ? 'Timer running' : `Timer stopped: ${r.minutes_logged} min logged`, kind: 'info' } });
  });

  r.get('/api/approvals', (ctx) => { const me = user(ctx); return htmlResponse(JSON.stringify({ ok: true, items: listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'] }) }), 200, { 'content-type': 'application/json; charset=utf-8' }); });
  void getSetting;
}
