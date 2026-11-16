import { html, when, type Raw } from '../../lib/html.ts';
import { modulesFor, page, greeting, todayLine, type View } from '../layout.ts';
import { icon, pill, avatar, slaChip, tileCard, statCard, empty, emptyRich, checkMark, priorityPill, ring, button } from '../components.ts';
import { sopChecklist, quickAction } from './shared.ts';
import type { SopInstance } from '../../modules/sops/service.ts';
import { slaState, type TicketView } from '../../modules/desk/service.ts';
import { STAGE_LABEL, type Deal } from '../../modules/sales/service.ts';
import { WO_LABEL, type WorkOrder } from '../../modules/production/service.ts';
import type { Task } from '../../modules/tasks/service.ts';
import type { DevIssue } from '../../modules/desk/service.ts';
import { STATUS_LABEL, typePill } from './dev.ts';
import type { Tile } from '../../modules/kpi/engine.ts';
import { fmtDate, fmtTime, money, relativeAge, inr } from '../../lib/time.ts';

export interface TodayData {
  now: Date;
  runs: SopInstance[];
  streak: number;
  tickets: TicketView[];
  issues: DevIssue[];
  deals: Deal[];
  overdueFollowups: number;
  orders: WorkOrder[];
  tasks: Task[];
  approvals: Task[];
  myRequests: Task[];
  notifications: { id: number; title: string; body: string; link: string; kind: string; created_at: string }[];
  attendance: { check_in: string | null; check_out: string | null } | null;
  myTiles: Tile[];
  alerts: { text: string; href: string; tone: 'crit' | 'warn' | 'accent' | 'good' }[];
  teamTiles: Tile[];
  leave: { code: string; label: string; quota: number; used: number; active: boolean }[];
  /** My lines on today's daily review. */
  dsr?: { id: string; kind: string; title: string; customer: string; amount_expected: number | null; planned_hours: number | null; status: string; self_status: string; department_id: string }[];
  pwChanged: boolean;
}

/** A card that fades up as it comes into view, rather than all at once on load. */
const section = (body: Raw): Raw => html`<section class="card reveal">${body}</section>`;

export function todayPage(v: View, d: TodayData): Raw {
  const first = v.user.full_name.split(' ')[0];
  const dept = v.deptCode;
  const stepsTotal = d.runs.reduce((n, r) => n + JSON.parse(r.steps).length, 0);
  const stepsDone = d.runs.reduce((n, r) => n + JSON.parse(r.steps).filter((s: { done: boolean }) => s.done).length, 0);
  const pct = stepsTotal ? Math.round((stepsDone / stepsTotal) * 100) : null;
  const left = stepsTotal - stepsDone;

  const actions: Raw[] = [];
  if (dept === 'DEV' || dept === 'QA') actions.push(quickAction('New issue', 'code', { modal: '/dev/new' }));
  if (dept === 'SUP' || v.isManager) actions.push(quickAction('New ticket', 'ticket', { modal: '/desk/new' }));
  if (dept === 'SAL' || dept === 'PRE' || v.isManager) { actions.push(quickAction('Log a visit', 'pin', { modal: '/pipeline/activity?kind=visit' })); actions.push(quickAction('New lead', 'funnel', { modal: '/pipeline/new' })); }
  if (dept === 'PRD') actions.push(quickAction(v.lang === 'hi' ? 'उत्पादन बोर्ड' : 'Production board', 'factory', { href: '/production' }));
  actions.push(quickAction('Request leave', 'calendar', { modal: '/approvals/leave/new' }));
  actions.push(quickAction('Claim expense', 'rupee', { modal: '/approvals/expense/new' }));

  const checkedIn = !!d.attendance?.check_in;
  const attendance = checkedIn
    ? html`<span class="pill pill-good lf-done" style="display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px">${icon('check', 14)} In at ${fmtTime(d.attendance!.check_in)}${when(d.attendance!.check_out, () => html` · out ${fmtTime(d.attendance!.check_out)}`)}</span>
        ${when(!d.attendance!.check_out, () => html`<button class="btn" type="button" data-post="/attendance/check-out" data-gps>Check out</button>`)}`
    : html`<button class="btn btn-primary" type="button" data-post="/attendance/check-in" data-gps data-burst="#6BE3A8">${icon('pin', 14)} Check in for today</button>`;
  const apps = html`<section class="card reveal"><div class="card-head"><h2>Your apps</h2></div><div class="apps">${modulesFor(v).filter((m) => m.key !== 'home').map((m) => html`<a class="appicon" href="${m.tabs[0].href}"><span class="sq sq-lg sq-${m.tone}">${icon(m.icon, 22)}</span>${m.name}</a>`)}</div></section>`;
  const dsrLines = d.dsr || [];
  const myDay = dsrLines.length ? html`<section class="card reveal"><div class="card-head"><h2>Your day plan</h2><a class="small" href="/dsr">Update</a></div>
    <ul class="list" style="margin-top:4px">${dsrLines.slice(0, 8).map((i) => { const st = i.status !== 'planned' ? i.status : i.self_status; return html`<li style="display:flex;justify-content:space-between;gap:10px;align-items:center"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.kind === 'collection' ? `${i.customer} · ₹${Math.round(i.amount_expected || 0).toLocaleString('en-IN')}` : i.title}</span><span class="pill pill-${st === 'done' ? 'good' : st === 'partial' ? 'warn' : st ? 'crit' : 'ink'}">${st === 'done' ? 'Done' : st === 'partial' ? 'Partly' : st === 'blocked' ? 'Blocked' : st === 'not_done' ? 'Not done' : 'To do'}</span></li>`; })}</ul>
    ${when(dsrLines.length > 8, () => html`<p class="small muted" style="margin:6px 0 0">and ${dsrLines.length - 8} more</p>`)}</section>` : html``;
  const waiting = d.approvals.length + d.alerts.length;


  // ── Needs you ───────────────────────────────────────────────────────────
  const alerts = d.alerts.length ? section(html`
    <div class="card-head"><h2>Needs you</h2><span class="small muted">${d.alerts.length} item${d.alerts.length === 1 ? '' : 's'}${when(d.alerts.length > 6, () => html` · <a href="${v.isManager && v.user.functional_role !== 'team_lead' ? '/company' : '/analytics'}">see all</a>`)}</span></div>
    <ul class="list list-hover stagger-rows" style="margin-top:6px">${d.alerts.slice(0, 6).map((a) => html`<li><span class="dot dot-${a.tone === 'accent' ? 'accent' : a.tone}"></span><a href="${a.href}" style="flex:1;text-decoration:none;color:inherit;font-weight:500">${a.text}</a>${icon('arrow', 16, 'faint')}</li>`)}</ul>`) : '';

  // ── Approvals: decide without leaving the page, and the row leaves when you do ──
  const approvals = d.approvals.length ? section(html`
    <div class="card-head"><h2>Waiting for your approval</h2><a class="small" href="/approvals">All approvals</a></div>
    <ul class="list list-hover stagger-rows">${d.approvals.slice(0, 5).map((t) => html`<li>
      ${avatar(t.requester_name, t.requester_id || '')}
      <span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${t.title}</b><span class="small muted">${t.requester_name} · ${relativeAge(t.created_at, d.now)}${when(t.amount, () => html` · <b class="num">${t.type === 'discount' ? `${t.amount}%` : t.type === 'leave' ? `${t.amount} day${t.amount === 1 ? '' : 's'}` : inr(t.amount!)}</b>`)}</span></span>
      <span class="row" style="gap:6px"><button class="btn btn-sm btn-good" data-post="/tasks/${t.id}/decide" data-body='{"decision":"approved"}' data-remove-on-success="li" data-burst="#1E8E5A">Approve</button><button class="btn btn-sm" data-post="/tasks/${t.id}/decide" data-body='{"decision":"declined"}' data-prompt="Reason for declining (the requester will see it)" data-prompt-key="note" data-remove-on-success="li">Decline</button></span>
    </li>`)}</ul>`) : '';

  const tickets = d.tickets.length ? section(html`
    <div class="card-head"><h2>My open tickets</h2><a class="small" href="/desk?mine=1">Board</a></div>
    <ul class="list list-hover stagger-rows">${d.tickets.slice(0, 6).map((t) => { const s = slaState(t, d.now); return html`<li>
      ${priorityPill(t.priority)}<a href="/tickets/${t.id}" data-drawer="/tickets/${t.id}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><b style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.subject}</b><span class="small muted">${t.id} · ${t.customer_name || 'Internal'}</span></a>${slaChip(s)}</li>`; })}</ul>`) : '';

  const issues = d.issues.length ? section(html`
    <div class="card-head"><h2>My sprint work</h2><a class="small" href="/dev?mine=1">Board</a></div>
    <ul class="list list-hover stagger-rows">${d.issues.slice(0, 8).map((i) => html`<li>
      ${typePill(i.type)}<a href="/dev/${i.id}" data-drawer="/dev/${i.id}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><b style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${when(i.blocked, '⛔ ')}${i.title}</b><span class="small muted">${i.id}${when(i.project_name, () => html` · ${i.project_name}`)}${when(i.points, () => html` · ${i.points} pt`)}${when(i.due_date, () => html` · due ${fmtDate(i.due_date)}`)}</span></a>
      ${pill(STATUS_LABEL[i.status], i.status === 'ready' || i.status === 'released' ? 'good' : i.status === 'in_qa' ? 'warn' : 'accent')}
      ${i.status === 'planned' || i.status === 'backlog' ? html`<button class="btn btn-sm" data-post="/dev/${i.id}/status" data-body='{"status":"in_progress"}'>Start</button>` : i.status === 'in_progress' ? html`<button class="btn btn-sm" data-post="/dev/${i.id}/status" data-body='{"status":"in_review"}'>To review</button>` : i.status === 'in_review' ? html`<button class="btn btn-sm" data-post="/dev/${i.id}/status" data-body='{"status":"in_qa"}'>To QA</button>` : ''}</li>`)}</ul>`) : '';

  const deals = d.deals.length ? section(html`
    <div class="card-head"><h2>My pipeline</h2><span class="small ${d.overdueFollowups ? 'c-crit' : 'muted'}">${d.overdueFollowups ? `${d.overdueFollowups} overdue follow-up${d.overdueFollowups === 1 ? '' : 's'}` : 'Follow-ups on time'}</span></div>
    <ul class="list list-hover stagger-rows">${d.deals.slice(0, 6).map((dl) => { const overdue = dl.next_step_due && dl.next_step_due < d.now.toISOString().slice(0, 10); return html`<li>
      <a href="/deals/${dl.id}" data-drawer="/deals/${dl.id}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><b style="display:block;font-size:13px">${dl.customer_name} <span class="muted" style="font-weight:400">· ${dl.title}</span></b><span class="small ${overdue ? 'c-crit' : 'muted'}">${dl.next_step || 'No next step set'}${when(dl.next_step_due, () => html` · ${fmtDate(dl.next_step_due)}`)}</span></a>
      ${pill(STAGE_LABEL[dl.stage], dl.stage === 'negotiation' ? 'good' : 'ink')}<b class="num small">${money(dl.value, dl.currency)}</b></li>`; })}</ul>`) : '';

  const orders = d.orders.length ? section(html`
    <div class="card-head"><h2>${v.lang === 'hi' ? 'मेरे वर्क ऑर्डर' : 'My work orders'}</h2><a class="small" href="/production">Board</a></div>
    <ul class="list list-hover stagger-rows">${d.orders.slice(0, 6).map((w) => { const late = w.promised_date && w.promised_date < d.now.toISOString().slice(0, 10); return html`<li>
      <a href="/work-orders/${w.id}" data-drawer="/work-orders/${w.id}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><b style="display:block;font-size:13px">${w.product} × ${w.qty}</b><span class="small muted">${w.id} · ${w.customer_name || ''}</span></a>
      ${pill(WO_LABEL[w.stage][v.lang], late ? 'crit' : 'ink')}<span class="small ${late ? 'c-crit' : 'muted'}">${late ? (v.lang === 'hi' ? 'देर' : 'Late') : ''} ${fmtDate(w.promised_date)}</span></li>`; })}</ul>`) : '';

  const tasks = d.tasks.length ? section(html`
    <div class="card-head"><h2>My tasks</h2><a class="small" href="/tasks">All tasks</a></div>
    <ul class="list list-hover stagger-rows">${d.tasks.slice(0, 6).map((t) => { const overdue = t.due_at && t.due_at < d.now.toISOString(); return html`<li>
      <input type="checkbox" data-post="/tasks/${t.id}/complete" data-remove-on-success="li" aria-label="Complete ${t.title}" style="width:20px;height:20px;accent-color:var(--good)">
      <span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${t.title}</b><span class="small ${overdue ? 'c-crit' : 'muted'}">${t.type.replace('_', ' ')}${when(t.due_at, () => html` · ${overdue ? 'Overdue, was due' : 'Due'} ${fmtDate(t.due_at)}`)}</span></span>
      ${when(t.link, () => html`<a class="btn btn-sm btn-ghost" href="${t.link}">Open</a>`)}</li>`; })}</ul>`) : '';

  const myTiles = d.myTiles.length ? section(html`
    <div class="card-head"><h2>My numbers this week</h2>${when(v.deptCode !== 'HR', () => html`<a class="small" href="/analytics?me=1">Detail</a>`)}</div>
    <div class="grid grid-4 stagger-grid" style="margin-top:14px">${d.myTiles.map((t) => tileCard(t, `/kpi/${t.key}?scope=employee&id=${v.user.id}`))}</div>`) : '';

  const teamTiles = d.teamTiles.length ? section(html`
    <div class="card-head"><h2>${v.isManager && v.user.functional_role === 'team_lead' ? 'My team this week' : 'Company at a glance'}</h2><a class="small" href="${v.user.functional_role === 'team_lead' ? '/analytics' : '/company'}">${v.user.functional_role === 'team_lead' ? 'Analytics' : 'Company page'}</a></div>
    <div class="grid grid-4 stagger-grid" style="margin-top:14px">${d.teamTiles.map((t) => tileCard(t))}</div>`) : '';

  // ── Side column ─────────────────────────────────────────────────────────
  const leave = html`<section class="card reveal" style="padding:18px 20px">
    <div class="card-head"><h2>Leave balance</h2><a class="small" href="/approvals">Requests</a></div>
    <div class="grid grid-3 stagger-grid" style="margin-top:12px;gap:10px">${d.leave.map((lt) => {
      const used = lt.used, total = lt.quota, remaining = total - used;
      const frac = total ? Math.max(0, Math.min(1, remaining / total)) : 0;
      return html`<div class="tile" style="text-align:center;padding:12px 8px;gap:5px;align-items:center">
        <b class="num" style="font-size:21px;font-weight:650" data-countup="${remaining}">${remaining}</b>
        <span class="xs muted" style="display:block">${lt.label}</span>
        <span style="display:block;width:100%;height:3px;border-radius:3px;background:var(--line2);overflow:hidden"><span style="display:block;height:100%;width:${Math.round(frac * 100)}%;border-radius:3px;background:${frac > .5 ? 'var(--good)' : frac > .2 ? 'var(--warn)' : 'var(--crit)'};transform-origin:left;animation:lf-edge .7s var(--spring) .3s both"></span></span>
        <span class="xs faint">of ${total}</span>
      </div>`;
    })}</div>
  </section>`;

  const notes = html`<section class="card reveal" style="padding:18px 20px">
    <div class="card-head"><h2>Updates</h2><a class="small" href="/notifications">All</a></div>
    ${d.notifications.length
      ? html`<ul class="list list-hover stagger-rows">${d.notifications.map((n) => html`<li style="padding:9px 6px"><span class="dot dot-${n.kind === 'critical' ? 'crit' : n.kind === 'warn' ? 'warn' : n.kind === 'success' ? 'good' : 'accent'}"></span><a href="${n.link || '/notifications'}" style="flex:1;min-width:0;text-decoration:none;color:inherit"><span style="display:block;font-size:13px;font-weight:500">${n.title}</span><span class="xs muted">${relativeAge(n.created_at, d.now)}</span></a></li>`)}</ul>`
      : emptyRich({ icon: 'check', title: 'You are all caught up', body: 'Nothing new since you last looked.' })}
  </section>`;

  const requests = d.myRequests.length ? html`<section class="card reveal" style="padding:18px 20px">
    <div class="card-head"><h2>My requests</h2></div>
    <ul class="list stagger-rows">${d.myRequests.map((t) => html`<li style="padding:9px 0"><span style="flex:1;font-size:13px">${t.title}</span>${pill(t.status === 'open' ? `With ${t.assignee_name?.split(' ')[0] || 'approver'}` : t.status, t.status === 'approved' ? 'good' : t.status === 'declined' ? 'crit' : 'warn')}</li>`)}</ul>
  </section>` : '';

  // Somebody with a genuinely clear day should be told so, not shown a blank page.
  const nothingOn = !d.alerts.length && !d.approvals.length && !d.runs.length && !d.tickets.length
    && !d.issues.length && !d.deals.length && !d.orders.length && !d.tasks.length;

  return page(v, {
    title: greeting(d.now, first), docTitle: 'Today',
    subtitle: html`${todayLine(d.now)} · ${v.user.designation}${when(waiting, () => html` · <b>${waiting} thing${waiting === 1 ? '' : 's'} waiting for you</b>`)}${when(stepsTotal, () => html` · checklist ${stepsDone} of ${stepsTotal} done`)}${when(d.streak >= 2, () => html` · ${d.streak}-day streak`)}`,
    actions: html`${attendance}${when(dept === 'PRD', () => html`<div class="lang"><button type="button" class="${v.lang === 'en' ? 'on' : ''}" data-lang="en">English</button><button type="button" class="${v.lang === 'hi' ? 'on' : ''}" data-lang="hi">हिन्दी</button></div>`)}`,
    body: html`${when(d.pwChanged, () => html`<div class="notice notice-good">${icon('check')} Password saved. You are all set.</div>`)}
      <div class="grid grid-actions stagger-grid">${actions}</div>
      <div class="cols">
        <div class="col-main">
          ${approvals}${alerts}
          ${when(d.runs.length, () => html`<section class="reveal"><div class="band-head" style="margin-bottom:12px"><h2>Today's SOPs</h2><span class="band-rule"></span><a class="small" href="/sops">All checklists</a></div><div class="stack stagger">${d.runs.map((r) => sopChecklist(r, { compact: true, now: d.now }))}</div></section>`)}
          ${issues}${tickets}${deals}${orders}${tasks}${myTiles}${teamTiles}
          ${when(nothingOn, () => section(emptyRich({
            icon: 'sun', title: 'A clear run today',
            body: 'No approvals, no checklist steps, nothing overdue. If something comes in it will appear here.',
            action: button('Look at the company page', { href: '/company', size: 'sm' })
          })))}
        </div>
        <div class="col-side">${myDay}${apps}${notes}${requests}${leave}</div>
      </div>`
  });
}

export { statCard, empty };
