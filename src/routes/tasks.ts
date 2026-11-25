import * as lists from '../lib/lists.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees } from '../modules/people/model.ts';
import { listTasks, getTask, createTask, decideTask, completeTask, requestLeave, submitExpense, requestApproval, payloadOf } from '../modules/tasks/service.ts';
import { setTarget, type KpiScope } from '../modules/kpi/engine.ts';
import { applyRegularisationDecision, requireMissPunchComment } from '../modules/hr/attendance.ts';
import { applyAppraisalDecision } from '../modules/hr/appraisal.ts';
import { applyRequisitionDecision, applyOfferDecision } from '../modules/hr/recruiting.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { approvalsPage, leaveModal, expenseModal, purchaseModal, type ApprovalsData } from '../ui/pages/tasks.ts';
import { myWorkPage, teamWorkPage, newTaskModal, passModal } from '../ui/pages/work.ts';
import { openSession, startWork, takeBreak, resumeWork, stopWork, pendingFor, dayOf, canWatch, watchable, colleagues, passTask } from '../modules/work/service.ts';
import { localDateString } from '../lib/time.ts';
import { listDepartments } from '../modules/people/model.ts';
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

  // ----- My work: what is pending for me, what I am on now, and my breaks -----
  r.get('/tasks', (ctx) => {
    const v = view(ctx); const me = v.user; const now = new Date(); const day = localDateString(now);
    const mine = dayOf(app, [{ id: me.id, full_name: me.full_name, designation: me.designation, team: '' }], day, now)[0];
    const assigned = listTasks(app, { kind: 'task', status: ['open', 'in_progress'], limit: 500 }).filter((t) => t.created_by === me.id && t.assignee_id !== me.id);
    const doneRows = listTasks(app, { assigneeId: me.id, kind: 'task', status: ['done'], limit: 10 });
    return htmlResponse(myWorkPage(v, { now, current: mine.current, pending: mine.pending, assigned, done: doneRows, workedMin: mine.workedMin, breakMin: mine.breakMin, breaks: mine.breaks, canWatch: canWatch(app, me) }));
  });
  // Team at work: the same picture for a lead's people, and for everyone when an executive looks.
  r.get('/tasks/team', (ctx) => {
    const v = view(ctx); const me = v.user; if (!canWatch(app, me)) return fail(ctx, 403, 'This page is for team leads and managers.');
    const now = new Date(); const today = localDateString(now); const q = ctx.query.get('day') || ''; const day = /^\d{4}-\d{2}-\d{2}$/.test(q) && q <= today ? q : today;
    const all = watchable(app, me); const ids = new Set(all.map((e) => e.department_id)); const departments = listDepartments(app.db).filter((d) => ids.has(d.id)).map((d) => ({ id: d.id, name: d.name }));
    // A team lead opens on their own team; executives and administrators on everyone.
    const asked = ctx.query.get('department'); const top = !!me.is_admin || me.functional_role === 'executive';
    const departmentId = departments.some((d) => d.id === asked) ? asked! : asked === null && !top && departments.some((d) => d.id === me.department_id) ? me.department_id : '';
    const order = { working: 0, break: 1, idle: 2 };
    const people = dayOf(app, all.filter((e) => !departmentId || e.department_id === departmentId), day, now).sort((a, b) => order[a.state] - order[b.state] || b.workedMin - a.workedMin || a.name.localeCompare(b.name));
    return htmlResponse(teamWorkPage(v, { now, day, today, people, departments, departmentId }));
  });
  r.get('/tasks/new', (ctx) => { const v = view(ctx); return htmlResponse(newTaskModal(v, colleagues(app, v.user))); });
  r.post('/tasks', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const assignee = str(b, 'assigneeId') || me.id;
    // Anyone may give a task to someone in their own team; managers to anyone who reports to them.
    if (assignee !== me.id && !colleagues(app, me).some((e) => e.id === assignee)) return fail(ctx, 403, 'You can give a task to people in your own team.');
    const t = createTask(app, me, { kind: 'task', type: 'general', title: str(b, 'title'), details: str(b, 'details'), assigneeId: assignee, requesterId: me.id, dueAt: str(b, 'dueAt') ? `${str(b, 'dueAt')}T12:30:00.000Z` : null, link: '/tasks' });
    return done(ctx, { reload: true, toast: { title: assignee === me.id ? 'Task added' : 'Task given', body: t.title, kind: 'success' } });
  });
  r.post('/tasks/:id/complete', async (ctx) => {
    const me = user(ctx);
    const t = getTask(app, ctx.params.id);
    if (!t) return fail(ctx, 404, 'Task not found');
    if (t.assignee_id !== me.id && t.created_by !== me.id && !can(app.db, me, 'tasks.assign')) return fail(ctx, 403, 'Not your task');
    const r = completeTask(app, me, t.id);
    return done(ctx, { reload: true, confetti: true, toast: { title: 'Done ✓', body: r.minutes_logged ? `${r.minutes_logged} minutes logged.` : t.title, kind: 'success' } });
  });
  r.get('/tasks/:id/pass', (ctx) => {
    const v = view(ctx); const t = getTask(app, ctx.params.id);
    if (!t || t.assignee_id !== v.user.id) return fail(ctx, 403, 'You can pass on only a task that is assigned to you.');
    return htmlResponse(passModal(v, { id: t.id, title: t.title }, colleagues(app, v.user)));
  });
  r.post('/tasks/:id/pass', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const out = passTask(app, me, ctx.params.id, str(b, 'to'), str(b, 'note'));
    return done(ctx, { reload: true, toast: { title: `Passed to ${out.to}`, body: out.title, kind: 'success' } });
  });
  // The older start/stop button on a task.
  r.post('/tasks/:id/timer', async (ctx) => {
    const me = user(ctx); const cur = openSession(app, me.id);
    if (cur && cur.entity_type === 'task' && cur.entity_id === ctx.params.id) { stopWork(app, me); return done(ctx, { reload: true, toast: { title: 'Stopped', kind: 'info' } }); }
    startWork(app, me, 'task', ctx.params.id); return done(ctx, { reload: true, toast: { title: 'Started', kind: 'info' } });
  });
  r.post('/work/start', async (ctx) => { const me = user(ctx); const b = await ctx.body(); const s = startWork(app, me, str(b, 'type'), str(b, 'id')); return done(ctx, { reload: true, toast: { title: 'Started', body: s.title, kind: 'success' } }); });
  r.post('/work/break', async (ctx) => { const me = user(ctx); const b = await ctx.body(); const s = takeBreak(app, me, str(b, 'reason')); return done(ctx, { reload: true, toast: { title: `Break started${s.note && s.note !== 'Break' ? `: ${s.note}` : ''}`, body: 'Press "Back to work" when you return.', kind: 'info' } }); });
  r.post('/work/resume', async (ctx) => { const s = resumeWork(app, user(ctx)); return done(ctx, { reload: true, toast: { title: 'Back to work', body: s.title, kind: 'success' } }); });
  r.post('/work/stop', async (ctx) => { const s = stopWork(app, user(ctx)); return done(ctx, { reload: true, toast: { title: s ? `Stopped: ${s.minutes} min` : 'Nothing was running', kind: 'info' } }); });

  r.get('/api/approvals', (ctx) => { const me = user(ctx); return htmlResponse(JSON.stringify({ ok: true, items: listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'] }) }), 200, { 'content-type': 'application/json; charset=utf-8' }); });
  void getSetting;
}
