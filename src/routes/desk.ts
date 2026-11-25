import type { App } from '../app.ts';
import { Router, htmlResponse, redirect } from '../lib/http.ts';
import { type Employee, listEmployees, getDepartment } from '../modules/people/model.ts';
import { listTickets, requireTicket, ticketEvents, slaState, createTicket, assignTicket, setPriority, setStatus, replyToCustomer, escalateToDev, resolveTicket, reopenTicket, firstResponseMinutes, OPEN_STATUSES, PRIORITIES, type Priority, type TicketStatus } from '../modules/desk/service.ts';
import { listCustomers, getCustomer, createCustomer } from '../modules/sales/service.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { localDateString } from '../lib/time.ts';
import { deskPage, ticketDrawer, ticketPage, newTicketModal, type DeskData, type TicketDetail } from '../ui/pages/desk.ts';
import { done, fail, view, user, str, num, render } from './helpers.ts';

function agents(app: App): Employee[] {
  return listEmployees(app.db, { status: 'active' }).filter((e) => ['SUP', 'DEV', 'QA'].includes(getDepartment(app.db, e.department_id)?.code || '') || e.functional_role === 'executive');
}

export function buildDesk(app: App, me: Employee, q: URLSearchParams, now = new Date()): DeskData {
  const mine = q.get('mine') === '1', team = q.get('team') === '1';
  const filter = { mine, team, q: q.get('q') || '', priority: q.get('priority') || '', sla: q.get('sla') || '', type: q.get('type') || '' };
  const today = localDateString(now);
  const scope = scopeFor(app.db, me);
  let tickets = listTickets(app, { q: filter.q || undefined, type: filter.type || undefined, assigneeId: mine ? me.id : undefined, assigneeIds: team ? [...scope.people] : undefined, limit: 800 })
    .filter((t) => OPEN_STATUSES.includes(t.status) || (t.status === 'resolved' && (t.resolved_at || '') >= now.toISOString().slice(0, 10)) || (t.status === 'resolved' && (t.resolved_at || '') >= new Date(now.getTime() - 86_400_000).toISOString()));
  const code = getDepartment(app.db, me.department_id)?.code || '';
  if (['DEV', 'QA'].includes(code) && scope.level === 'self' && q.get('all') !== '1') tickets = tickets.filter((t) => t.dev_issue_id);
  if (filter.priority) tickets = tickets.filter((t) => t.priority === filter.priority);
  if (filter.sla === 'breach') tickets = tickets.filter((t) => slaState(t, now).state === 'breach');
  if (filter.sla === 'warn') tickets = tickets.filter((t) => { const s = slaState(t, now); return s.state === 'warn' && s.minutesLeft !== null && s.minutesLeft <= 60; });
  const all = listTickets(app, { status: 'open', limit: 2000 });
  const stats = {
    open: all.length,
    breached: all.filter((t) => t.type !== 'implementation' && slaState(t, now).state === 'breach').length,
    dueSoon: all.filter((t) => { const s = slaState(t, now); return s.state !== 'breach' && s.minutesLeft !== null && s.minutesLeft >= 0 && s.minutesLeft <= 60; }).length,
    unassigned: all.filter((t) => !t.assignee_id).length,
    resolvedToday: app.db.get<{ n: number }>("SELECT count(*) AS n FROM tickets WHERE resolved_at >= ?", [today])?.n || 0
  };
  return { now, tickets, filter, stats, canWrite: can(app.db, me, 'desk.write'), canExport: can(app.db, me, 'reports.export') };
}

export function ticketDetail(app: App, me: Employee, id: string, now = new Date()): TicketDetail {
  const t = requireTicket(app, id);
  return { t, events: ticketEvents(app, id), now, agents: agents(app), canWrite: can(app.db, me, 'desk.write'), canManage: can(app.db, me, 'desk.manage'), customer: t.customer_id ? getCustomer(app, t.customer_id) || null : null, responseMinutes: firstResponseMinutes(app, t) };
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/desk', (ctx) => { const v = view(ctx); return htmlResponse(deskPage(v, buildDesk(app, v.user, ctx.query))); });
  r.get('/desk/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'desk.write'); return htmlResponse(newTicketModal(v, { customers: listCustomers(app), agents: agents(app) })); });
  r.get('/desk/dev', () => redirect('/dev'));
  r.get('/desk/:id', (ctx) => redirect(`/tickets/${ctx.params.id}`));

  r.get('/tickets/:id', (ctx) => {
    const v = view(ctx);
    const d = ticketDetail(app, v.user, ctx.params.id);
    return render(ctx, () => ticketPage(v, d), () => ticketDrawer(v, d));
  });

  r.post('/tickets', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    let customerId = str(b, 'customerId') || null;
    if (!customerId && str(b, 'customerName')) customerId = createCustomer(app, me, { name: str(b, 'customerName') }).id;
    if (!str(b, 'subject')) return fail(ctx, 400, 'Give the ticket a subject.');
    const t = createTicket(app, me, { customerId, subject: str(b, 'subject'), description: str(b, 'description'), type: str(b, 'type') || 'support', priority: (str(b, 'priority') || 'P3') as Priority, channel: str(b, 'channel') || 'phone', assigneeId: str(b, 'assigneeId') || null, implPlanDays: num(b, 'implPlanDays') });
    return done(ctx, { reload: true, redirect: ctx.wantsJson ? undefined : `/tickets/${t.id}`, toast: { title: `${t.id} created`, body: t.priority === 'P1' ? 'P1: the clock is running. 15 minutes to respond.' : `${t.priority} · respond by ${(t.response_due_at || '').slice(11, 16)} UTC`, kind: t.priority === 'P1' ? 'critical' : 'success' } });
  });

  r.post('/tickets/:id/reply', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const channel = (['email', 'call', 'note'].includes(str(b, 'channel')) ? str(b, 'channel') : 'email') as 'email' | 'call' | 'note';
    const t = replyToCustomer(app, me, ctx.params.id, str(b, 'text'), channel);
    return done(ctx, { reload: true, toast: { title: channel === 'note' ? 'Note added' : channel === 'call' ? 'Call logged' : 'Reply sent', body: t.first_response_at && !b._second ? 'Response clock stopped.' : undefined, kind: 'success' } });
  });

  r.post('/tickets/:id/assign', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const t = assignTicket(app, me, ctx.params.id, str(b, 'assigneeId') || null);
    return done(ctx, { reload: true, toast: { title: t.assignee_name ? `Assigned to ${t.assignee_name}` : 'Unassigned', kind: 'success' } });
  });

  r.post('/tickets/:id/priority', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const p = str(b, 'priority') as Priority;
    if (!PRIORITIES.includes(p)) return fail(ctx, 400, 'Unknown priority');
    const t = setPriority(app, me, ctx.params.id, p);
    return done(ctx, { reload: true, toast: { title: `Priority ${t.priority}`, body: `Resolve by ${(t.resolve_due_at || '').replace('T', ' ').slice(0, 16)} UTC`, kind: p === 'P1' ? 'critical' : 'success' } });
  });

  r.post('/tickets/:id/status', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const s = str(b, 'status') as TicketStatus;
    if (!['in_progress', 'waiting_customer', 'assigned', 'closed'].includes(s)) return fail(ctx, 400, 'Unknown status');
    setStatus(app, me, ctx.params.id, s, str(b, 'note'));
    return done(ctx, { reload: true, toast: { title: s === 'in_progress' ? 'Work started' : s === 'waiting_customer' ? 'Waiting on the customer' : 'Status updated', kind: 'success' } });
  });

  // Dragging a ticket to another column on the board, or a remark written on its tile.
  r.post('/tickets/:id/move', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write'); const b = await ctx.body(); const id = ctx.params.id;
    const to = str(b, 'to'); const note = str(b, 'note').trim().slice(0, 1000); const t = requireTicket(app, id);
    if (!to) { if (!note) return fail(ctx, 400, 'Write a remark, or choose where to move the ticket.'); replyToCustomer(app, me, id, note, 'note'); return done(ctx, { reload: true, toast: { title: 'Remark added', body: t.id, kind: 'success' } }); }
    if (!['assigned', 'in_progress', 'waiting', 'resolved'].includes(to)) return fail(ctx, 400, 'A ticket cannot be moved there.');
    if (to === 'resolved') { if (!['resolved', 'closed'].includes(t.status)) resolveTicket(app, me, id, note); else if (note) replyToCustomer(app, me, id, note, 'note'); return done(ctx, { reload: true, toast: { title: `${t.id} resolved`, kind: 'success' } }); }
    // Coming back from Resolved is a reopening and is recorded as one.
    if (t.status === 'resolved' || t.status === 'closed') reopenTicket(app, me, id, note || 'Moved back on the board');
    if (!t.assignee_id) assignTicket(app, me, id, me.id);   // work cannot start on a ticket nobody holds
    const status: TicketStatus = to === 'waiting' ? 'waiting_customer' : (to as TicketStatus);
    if (requireTicket(app, id).status !== status) setStatus(app, me, id, status, note); else if (note && t.status !== 'resolved' && t.status !== 'closed') replyToCustomer(app, me, id, note, 'note');
    return done(ctx, { reload: true, toast: { title: `${t.id} moved to ${to === 'waiting' ? 'Waiting' : to === 'assigned' ? 'Assigned' : 'In progress'}`, kind: 'success' } });
  });

  r.post('/tickets/:id/escalate', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const { issueId } = escalateToDev(app, me, ctx.params.id, str(b, 'title') || undefined);
    return done(ctx, { reload: true, toast: { title: `Escalated as ${issueId}`, body: 'Development has been notified. The ticket waits on the issue.', kind: 'success' } });
  });

  r.post('/tickets/:id/resolve', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    const t = resolveTicket(app, me, ctx.params.id, str(b, 'note'));
    return done(ctx, { reload: true, confetti: t.within_sla === 1, close: true, toast: { title: `${t.id} resolved`, body: t.within_sla === 1 ? 'Within SLA. The customer has a rating link.' : t.within_sla === 0 ? 'Outside SLA. It counts against compliance; the customer still gets a rating link.' : 'Resolved.', kind: t.within_sla === 0 ? 'warn' : 'success' } });
  });

  r.post('/tickets/:id/reopen', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'desk.write');
    const b = await ctx.body();
    reopenTicket(app, me, ctx.params.id, str(b, 'reason') || str(b, 'note') || 'Customer reported the issue again');
    return done(ctx, { reload: true, toast: { title: 'Reopened', body: 'SLA clock restarted from now.', kind: 'warn' } });
  });

}
