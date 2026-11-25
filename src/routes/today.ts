import * as lists from '../lib/lists.ts';
import { isCompanyLevel } from '../modules/brief/service.ts';
import { overviewResponse } from './brief.ts';
import { myItems, styleOf, today as dsrToday } from '../modules/dsr/service.ts';
import { pendingFor, openSession } from '../modules/work/service.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse, json } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listInstances, instanceSteps } from '../modules/sops/service.ts';
import { listTickets, slaState, listDevIssues } from '../modules/desk/service.ts';
import { listDeals } from '../modules/sales/service.ts';
import { listWorkOrders } from '../modules/production/service.ts';
import { listTasks } from '../modules/tasks/service.ts';
import { unreadNotifications, markAllRead } from '../lib/notify.ts';
import { companyPage, tilesFor, redStreak, type Tile } from '../modules/kpi/engine.ts';
import { personKpis, managerTiles, EXEC_TODAY_TILES } from '../modules/kpi/views.ts';
import { getSetting } from '../lib/settings.ts';
import { localDateString, addDays, toLocal, fmtDate } from '../lib/time.ts';
import { scopeFor } from '../lib/scope.ts';
import { todayPage, type TodayData } from '../ui/pages/today.ts';
import { page } from '../ui/layout.ts';
import { html } from '../lib/html.ts';
import { empty, icon } from '../ui/components.ts';
import { relativeAge } from '../lib/time.ts';
import { done, view, str, user, type RCtx } from './helpers.ts';
import { audit } from '../lib/audit.ts';
import { dayValue } from '../modules/hr/attendance.ts';
import { recomputeMonth } from '../modules/hr/attendance-rules.ts';

/** Consecutive working days (ending yesterday or today) on which every SOP step was done on time. */
export function onTimeStreak(app: App, employeeId: string, now = new Date()): number {
  const rows = listInstances(app, { assigneeId: employeeId, from: localDateString(addDays(now, -60)), to: localDateString(now), limit: 1000 });
  const byDate = new Map<string, boolean>();
  for (const r of rows) {
    const steps = instanceSteps(r);
    const allOnTime = steps.length > 0 && steps.every((s) => s.done && s.onTime);
    byDate.set(r.date, (byDate.get(r.date) ?? true) && allOnTime);
  }
  let streak = 0;
  const today = localDateString(now);
  for (let i = 0; i <= 60; i++) {
    const d = localDateString(addDays(now, -i));
    if (!byDate.has(d)) { if (d === today) continue; else if (i < 3) continue; else break; }
    if (byDate.get(d)) streak++; else if (d === today) continue; else break;
  }
  return streak;
}

export function leaveBalance(app: App, employeeId: string, now = new Date()): TodayData['leave'] {
  const lp = toLocal(now);
  const fyStart = `${lp.m >= 4 ? lp.y : lp.y - 1}-04-01`;
  const used = app.db.all<{ type: string; days: number }>("SELECT type, SUM(days) AS days FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND from_date >= ? GROUP BY type", [employeeId, fyStart]);
  const u = (t: string) => used.find((r) => r.type === t)?.days || 0;
  // Types that are switched off still show while someone has used days against them this year.
  return lists.allItems('hr.leaveTypes').filter((t) => t.active || u(t.value) > 0).map((t) => ({ code: t.value, label: t.label, quota: t.n ?? 0, used: u(t.value), active: t.active }));
}

export function buildToday(app: App, me: Employee, deptCode: string, now = new Date()): TodayData {
  const today = localDateString(now);
  const scope = scopeFor(app.db, me);
  const isManager = scope.level !== 'self';
  const runs = listInstances(app, { assigneeId: me.id, date: today, limit: 20 });
  const tickets = ['SUP', 'DEV', 'QA'].includes(deptCode) || isManager ? listTickets(app, { status: 'open', assigneeId: me.id, limit: 20 }).sort((a, b) => (a.resolve_due_at || '9').localeCompare(b.resolve_due_at || '9')) : [];
  const issues = ['DEV', 'QA'].includes(deptCode) ? listDevIssues(app, { assigneeId: me.id }).filter((i) => i.status !== 'released') : [];
  const deals = ['SAL', 'PRE'].includes(deptCode) || me.id === getSetting(app.db, 'company').salesHeadId ? listDeals(app, { ownerIds: [me.id], open: true, limit: 50 }) : [];
  const overdueFollowups = deals.filter((d) => d.next_step_due && d.next_step_due < today).length;
  const orders = deptCode === 'PRD' ? listWorkOrders(app, { open: true, limit: 200 }).filter((w) => w.assignee_id === me.id || me.functional_role !== 'ic') : [];
  const tasks = listTasks(app, { assigneeId: me.id, kind: 'task', status: ['open', 'in_progress'], limit: 20 });
  const approvals = listTasks(app, { assigneeId: me.id, kind: 'approval', status: ['open'], limit: 20 });
  const myRequests = listTasks(app, { requesterId: me.id, kind: 'approval', limit: 5 }).filter((t) => t.created_at >= addDays(now, -30).toISOString());
  const notifications = unreadNotifications(app.db, me.id, 8).filter((n) => !n.read_at).slice(0, 5);
  const attendance = app.db.get<{ check_in: string | null; check_out: string | null }>('SELECT check_in, check_out FROM attendance WHERE employee_id = ? AND date = ?', [me.id, today]) || null;
  const myTiles = isManager ? [] : tilesFor(app, personKpis(deptCode), { type: 'employee', id: me.id }, now);

  let teamTiles: Tile[] = [];
  const alerts: TodayData['alerts'] = [];
  if (scope.level === 'company') {
    teamTiles = tilesFor(app, EXEC_TODAY_TILES, { type: 'company', id: 'company' }, now);
    for (const band of companyPage(app, { type: 'company', id: 'company' }, now)) for (const t of band.tiles) {
      if (t.rag === 'crit') {
        const streak = redStreak(app, t.key, { type: 'company', id: 'company' }, now);
        alerts.push({ text: `${t.name} is red at ${t.display}${streak >= 2 ? ` (${streak} weeks running)` : ''}`, href: `/kpi/${t.key}`, tone: 'crit' });
      }
    }
  } else if (scope.level === 'team') {
    teamTiles = tilesFor(app, managerTiles(deptCode), { type: 'department', id: me.department_id }, now);
    for (const t of teamTiles) if (t.rag === 'crit') alerts.push({ text: `${t.name} is red at ${t.display}`, href: `/kpi/${t.key}?scope=department&id=${me.department_id}`, tone: 'crit' });
  }
  if (isManager) {
    const ids = [...scope.people];
    const breached = listTickets(app, { status: 'open', assigneeIds: ids, limit: 500 }).filter((t) => t.type !== 'implementation' && slaState(t, now).state === 'breach');
    if (breached.length) alerts.push({ text: `${breached.length} ticket${breached.length === 1 ? '' : 's'} past SLA${scope.level === 'company' ? ' across the company' : ' in your team'}`, href: '/desk?sla=breach', tone: 'crit' });
    const stale = listDeals(app, { ownerIds: ids, open: true, limit: 500 }).filter((d) => (d.days_in_stage || 0) > 14 && d.stage !== 'new');
    if (stale.length) alerts.push({ text: `${stale.length} deal${stale.length === 1 ? '' : 's'} stuck over 14 days in a stage`, href: '/pipeline?stale=1', tone: 'warn' });
    if (scope.level === 'company' || deptCode === 'PRD') {
      const late = listWorkOrders(app, { open: true, limit: 500 }).filter((w) => w.promised_date && w.promised_date < today);
      if (late.length) alerts.push({ text: `${late.length} work order${late.length === 1 ? '' : 's'} past the promised date`, href: '/production?late=1', tone: 'warn' });
    }
    const overdueSops = listInstances(app, { assigneeIds: ids, status: 'open', from: localDateString(addDays(now, -7)), to: today, limit: 500 }).filter((i) => i.due_at < now.toISOString());
    if (overdueSops.length) alerts.push({ text: `${overdueSops.length} SOP checklist${overdueSops.length === 1 ? '' : 's'} overdue${scope.level === 'company' ? '' : ' in your team'}`, href: '/sops?filter=overdue', tone: 'warn' });
  }
  const oldApprovals = approvals.filter((t) => t.created_at < addDays(now, -2).toISOString());
  if (oldApprovals.length) alerts.push({ text: `${oldApprovals.length} approval${oldApprovals.length === 1 ? '' : 's'} waiting on you for more than 2 days`, href: '/approvals', tone: 'warn' });

  return { now, runs, streak: onTimeStreak(app, me.id, now), tickets, issues, deals, overdueFollowups, orders, tasks, approvals, myRequests, notifications, attendance, myTiles, alerts, teamTiles, leave: leaveBalance(app, me.id, now), pwChanged: false };
}

export function register(r: Router<Employee>, app: App): void {
  const myDay = (ctx: Parameters<Parameters<typeof r.get>[1]>[0]) => {
    const v = view(ctx);
    const d = buildToday(app, v.user, v.deptCode);
    d.pwChanged = ctx.query.get('pw') === '1';
    d.dsr = myItems(app, v.user.id, dsrToday());
    d.dsrHourly = styleOf(app, v.user.department_id) === 'hourly';
    d.work = { pending: pendingFor(app, v.user.id, dsrToday()), current: openSession(app, v.user.id) || null };
    return htmlResponse(todayPage(v, d));
  };
  // The people who run the company land on the company overview; their own day is one tab along.
  r.get('/', (ctx) => (isCompanyLevel(user(ctx)) && ctx.query.get('pw') !== '1' ? overviewResponse(app, view(ctx), ctx.query.get('view')) : myDay(ctx)));
  r.get('/my-day', myDay);

  r.post('/attendance/check-in', async (ctx) => attendance(ctx, app, 'in'));
  r.post('/attendance/check-out', async (ctx) => attendance(ctx, app, 'out'));

  r.post('/me/lang', async (ctx) => {
    const body = await ctx.body();
    const lang = str(body, 'lang') === 'hi' ? 'hi' : 'en';
    app.db.run('UPDATE employees SET lang = ? WHERE id = ?', [lang, user(ctx).id]);
    return done(ctx, { reload: true });
  });

  r.get('/notifications', (ctx) => {
    const v = view(ctx);
    const rows = unreadNotifications(app.db, v.user.id, 60);
    markAllRead(app.db, v.user.id);
    return htmlResponse(page(v, { title: 'Notifications', subtitle: 'Everything that was sent to you, newest first. Opening this page marks them read.', body: html`<section class="card">${rows.length ? html`<ul class="list">${rows.map((n) => html`<li><span class="dot dot-${n.kind === 'critical' ? 'crit' : n.kind === 'warn' ? 'warn' : n.kind === 'success' ? 'good' : 'accent'}"></span><a href="${n.link || '#'}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><b style="display:block;font-size:13px;${n.read_at ? 'font-weight:500' : ''}">${n.title}</b><span class="small muted">${n.body}</span></a><span class="xs faint">${relativeAge(n.created_at)}</span>${icon('arrow', 16, 'faint')}</li>`)}</ul>` : empty('No notifications yet.', '🔔')}</section>` }));
  });

  r.get('/api/notifications', (ctx) => json({ ok: true, items: unreadNotifications(app.db, user(ctx).id, 50) }));
}

async function attendance(ctx: RCtx, app: App, kind: 'in' | 'out') {
  const me = user(ctx);
  const body = await ctx.body();
  const now = new Date();
  const today = localDateString(now);
  const lat = body.lat ? Number(body.lat) : null, lng = body.lng ? Number(body.lng) : null;
  const existing = app.db.get<{ id: number; check_in: string | null; check_out: string | null }>('SELECT id, check_in, check_out FROM attendance WHERE employee_id = ? AND date = ?', [me.id, today]);
  if (kind === 'in') {
    if (existing?.check_in) return done(ctx, { toast: { title: 'Already checked in', body: `You checked in at ${existing.check_in.slice(11, 16)} UTC.`, kind: 'info' } });
    const dv = dayValue(app, me, now);
    if (existing) app.db.run('UPDATE attendance SET check_in = ?, source = ?, minutes_late = ?, day_value = ? WHERE id = ?', [now.toISOString(), lat ? 'gps' : 'self', dv.late, dv.value, existing.id]);
    else app.db.run('INSERT INTO attendance (employee_id, date, check_in, source, status, minutes_late, day_value) VALUES (?, ?, ?, ?, ?, ?, ?)', [me.id, today, now.toISOString(), lat ? 'gps' : 'self', 'present', dv.late, dv.value]);
    recomputeMonth(app, me.id, today.slice(0, 7));
    audit(app.db, { entity: 'attendance', entityId: `${me.id}:${today}`, action: 'check_in', actorId: me.id, after: { lat, lng } });
    return done(ctx, { reload: true, toast: { title: 'Checked in', body: dv.late ? `${dv.late} minutes after your shift start.` : `Have a good day, ${me.full_name.split(' ')[0]}!`, kind: dv.late ? 'warn' : 'success' } });
  }
  if (!existing?.check_in) return done(ctx, { toast: { title: 'Check in first', kind: 'warn' } });
  if (existing.check_out) return done(ctx, { toast: { title: 'Already checked out', kind: 'info' } });
  const dvOut = dayValue(app, me, new Date(existing.check_in), now);
  app.db.run('UPDATE attendance SET check_out = ?, day_value = ? WHERE id = ?', [now.toISOString(), dvOut.value, existing.id]);
  recomputeMonth(app, me.id, today.slice(0, 7));
  audit(app.db, { entity: 'attendance', entityId: `${me.id}:${today}`, action: 'check_out', actorId: me.id, after: { lat, lng } });
  return done(ctx, { reload: true, toast: { title: 'Checked out', body: 'See you tomorrow.', kind: 'success' } });
}
