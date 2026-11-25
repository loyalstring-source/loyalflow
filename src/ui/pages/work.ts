// My work (what is pending for me, what I am on now, breaks) and Team at work (the same for a lead's people).
import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, avatar, empty, field, input, textarea, select, button } from '../components.ts';
import type { Task } from '../../modules/tasks/service.ts';
import { BREAK_REASONS, WORK_TYPE_LABEL, type Session, type PendingItem, type DayOfPerson, type WorkType } from '../../modules/work/service.ts';
import { fmtDate, fmtTime, fmtDuration } from '../../lib/time.ts';

const TYPE_TONE: Record<WorkType, 'accent' | 'violet' | 'coral' | 'ink'> = { task: 'accent', dsr: 'ink', ticket: 'coral', issue: 'violet' };
/** A clock that counts up from a start time; app code fills it in every second. */
const clock = (since: string): Raw => html`<b class="wk-clock num" data-since="${since}">0:00:00</b>`;
const CLOCK_JS = html`<script>(function () {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  function tick() { document.querySelectorAll('.wk-clock[data-since]').forEach(function (el) { var s = Math.max(0, Math.floor((Date.now() - Date.parse(el.getAttribute('data-since'))) / 1000)); el.textContent = Math.floor(s / 3600) + ':' + p(Math.floor(s / 60) % 60) + ':' + p(s % 60); }); }
  tick(); setInterval(tick, 1000);
})();</script>`;

export interface MyWorkData { now: Date; current: Session | null; pending: PendingItem[]; assigned: Task[]; done: Task[]; workedMin: number; breakMin: number; breaks: number; canWatch: boolean }

function banner(d: MyWorkData): Raw {
  const c = d.current; const totals = html`<span class="small muted">Today: <b>${fmtDuration(d.workedMin)}</b> worked${when(d.breaks, () => html` · <b>${fmtDuration(d.breakMin)}</b> on ${d.breaks} break${d.breaks === 1 ? '' : 's'}`)}</span>`;
  if (!c) return html`<section class="card wk-now"><div class="wk-now-main"><span class="wk-dot wk-idle" aria-hidden="true"></span><div><b>You are not working on anything right now.</b><br><span class="small muted">Press Start on an item below when you begin it. Your team lead sees what you are on.</span></div></div>${totals}</section>`;
  if (c.kind === 'break') return html`<section class="card wk-now wk-now-break"><div class="wk-now-main"><span class="wk-dot wk-break" aria-hidden="true"></span><div><span class="small muted">On a break${c.note && c.note !== 'Break' ? ` · ${c.note}` : ''} since ${fmtTime(c.started_at)}</span><br><b>${c.title}</b> is waiting</div></div>
      <div class="wk-now-side">${clock(c.started_at)}${button('Back to work', { post: '/work/resume', kind: 'primary', icon: 'check' })}${button('Stop for now', { post: '/work/stop' })}</div>${totals}</section>`;
  return html`<section class="card wk-now wk-now-on"><div class="wk-now-main"><span class="wk-dot wk-on" aria-hidden="true"></span><div><span class="small muted">Working since ${fmtTime(c.started_at)} · ${WORK_TYPE_LABEL[c.entity_type]}</span><br><b>${c.title}</b></div></div>
    <div class="wk-now-side">${clock(c.started_at)}
      <form class="wk-break" data-ajax action="/work/break"><select class="input" name="reason" aria-label="Reason for the break">${BREAK_REASONS.map((r) => html`<option value="${r}">${r}</option>`)}</select><button class="btn" type="submit">${icon('clock', 14)} Take a break</button></form>
      ${button('Stop', { post: '/work/stop' })}</div>${totals}</section>`;
}

export function myWorkPage(v: View, d: MyWorkData): Raw {
  const cur = d.current;
  const row = (p: PendingItem): Raw => {
    const on = !!cur && cur.entity_type === p.type && cur.entity_id === p.id;
    return html`<li id="${p.id}" class="${on ? 'wk-row-on' : ''}">
      ${p.type === 'task' ? html`<input type="checkbox" data-post="/tasks/${p.id}/complete" data-remove-on-success="li" aria-label="Mark ${p.title} as done" title="Mark as done" style="width:20px;height:20px;accent-color:var(--good)">` : html`<span style="width:20px"></span>`}
      <span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${p.href ? html`<a href="${p.href}" style="color:inherit">${p.title}</a>` : p.title}</b>
        <span class="small ${p.overdue ? 'c-crit' : 'muted'}">${pill(WORK_TYPE_LABEL[p.type], TYPE_TONE[p.type])} ${when(p.from, () => html`from ${p.from} · `)}${when(p.due, () => html`${p.overdue ? 'Overdue, was due' : 'Due'} ${fmtDate(p.due)} · `)}${p.minutes ? html`${fmtDuration(p.minutes)} worked so far` : 'Not started'}${when(p.sub, () => html`<br>${p.sub}`)}</span></span>
      ${when(p.type === 'task', () => button('Pass on', { modal: `/tasks/${p.id}/pass`, size: 'sm', kind: 'ghost' }))}
      ${on ? (cur!.kind === 'break' ? pill('On a break', 'warn') : pill('Working now', 'good')) : button(p.minutes ? 'Continue' : 'Start', { post: '/work/start', body: { type: p.type, id: p.id }, size: 'sm', kind: 'primary', icon: 'clock' })}</li>`;
  };
  const other = (t: Task): Raw => html`<li id="${t.id}">${avatar(t.assignee_name, t.assignee_id || '')}<span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${t.title}</b><span class="small muted">${t.assignee_name || 'Unassigned'}${when(t.due_at, () => html` · Due ${fmtDate(t.due_at)}`)}${when(t.minutes_logged, () => html` · ${fmtDuration(t.minutes_logged)} worked`)}${when(t.details, () => html`<br>${t.details}`)}</span></span>${t.status === 'done' ? pill(`Done ${fmtDate(t.decided_at)}`, 'good') : t.timer_started_at ? pill('Working now', 'good') : t.status === 'in_progress' ? pill('Started', 'accent') : pill('Not started', 'ink')}</li>`;
  return page(v, { title: 'My work', navTab: 'tasks', subtitle: 'Everything waiting for you: tasks, today\'s daily-review lines, tickets and board items. Start one when you begin it.',
    actions: html`${when(d.canWatch, () => button('Team at work', { href: '/tasks/team', icon: 'people' }))}${button('New task', { modal: '/tasks/new', kind: 'primary', icon: 'plus' })}`,
    body: html`${banner(d)}
      <section class="card"><div class="card-head"><h2>Pending for me</h2><span class="small muted">${d.pending.length} item${d.pending.length === 1 ? '' : 's'}</span></div>${d.pending.length ? html`<ul class="list">${d.pending.map(row)}</ul>` : empty('Nothing is waiting for you. 🎉')}</section>
      ${when(d.assigned.length, () => html`<section class="card"><div class="card-head"><h2>Tasks I gave to others</h2><span class="small muted">${d.assigned.length}</span></div><ul class="list">${d.assigned.map(other)}</ul></section>`)}
      ${when(d.done.length, () => html`<section class="card"><h2>Recently done</h2><ul class="list">${d.done.map(other)}</ul></section>`)}
      ${CLOCK_JS}` });
}

export function newTaskModal(v: View, people: { id: string; full_name: string; designation: string }[]): Raw {
  return modal({ title: 'New task', body: html`<form class="form" data-ajax action="/tasks">
    ${field('Task', input('title', { required: true }))}${field('Details', textarea('details', { rows: 2 }))}
    <div class="grid grid-2">${field('For', select('assigneeId', people.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.designation}` })), { blank: 'Me' }))}${field('Due', input('dueAt', { type: 'date' }))}</div>
    <div class="row between"><span class="small muted">The person is told at once and the task appears in their pending work.</span><button class="btn btn-primary" type="submit">Save</button></div></form>` });
}

export function passModal(v: View, task: { id: string; title: string }, people: { id: string; full_name: string; designation: string }[]): Raw {
  return modal({ title: 'Pass this task on', body: html`<form class="form" data-ajax action="/tasks/${task.id}/pass">
    <p class="small muted" style="margin:0"><b style="color:var(--ink)">${task.title}</b></p>
    ${field('Pass to', select('to', people.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.designation}` }))))}
    ${field('Why (they will see this)', textarea('note', { rows: 2, placeholder: 'For example: this is a hardware fault, better with you' }))}
    <div class="row between"><span class="small muted">Your timer on it stops. The person who gave you the task is told.</span><button class="btn btn-primary" type="submit">Pass on</button></div></form>` });
}

export interface TeamWorkData { now: Date; day: string; today: string; people: DayOfPerson[]; departments: { id: string; name: string }[]; departmentId: string }

export function teamWorkPage(v: View, d: TeamWorkData): Raw {
  const isToday = d.day === d.today; const n = (s: DayOfPerson['state']): number => d.people.filter((p) => p.state === s).length;
  const worked = d.people.reduce((a, p) => a + p.workedMin, 0); const started = d.people.filter((p) => p.sessions.length).length;
  const now = (p: DayOfPerson): Raw => (!isToday ? html`<span class="small muted">${p.sessions.length ? `${p.sessions.length} session${p.sessions.length === 1 ? '' : 's'}` : 'Nothing recorded'}</span>`
    : p.state === 'working' ? html`${pill('Working', 'good')} <b>${p.current!.title}</b><br><span class="small muted">since ${fmtTime(p.current!.started_at)} · ${clock(p.current!.started_at)}</span>`
    : p.state === 'break' ? html`${pill(`On a break${p.current!.note && p.current!.note !== 'Break' ? `: ${p.current!.note}` : ''}`, 'warn')} <span class="muted">${p.current!.title}</span><br><span class="small muted">since ${fmtTime(p.current!.started_at)} · ${clock(p.current!.started_at)}</span>`
    : html`${pill(p.sessions.length ? 'Not on a task' : 'Not started today', 'ink')}`);
  return page(v, { title: 'Team at work', navTab: 'tasks', autoRefresh: isToday ? 60 : undefined,
    subtitle: `${fmtDate(d.day)}${isToday ? ' · today, refreshes every minute' : ''} · who is working on what, time worked and breaks.`,
    actions: html`<form method="get" action="/tasks/team" class="row" style="gap:8px;flex-wrap:nowrap">${when(d.departments.length > 1, () => html`<select class="input" name="department" aria-label="Team" style="width:auto" onchange="this.form.submit()"><option value="all">All teams</option>${d.departments.map((x) => html`<option value="${x.id}" ${when(x.id === d.departmentId, 'selected')}>${x.name}</option>`)}</select>`)}<input class="input" type="date" name="day" value="${d.day}" max="${d.today}" aria-label="Day" style="width:auto" onchange="this.form.submit()"></form>${button('My work', { href: '/tasks' })}`,
    body: html`<div class="kpis">
        ${when(isToday, () => html`<div class="kpi"><span class="kpi-label">Working now</span><b class="kpi-value num">${n('working')}</b></div><div class="kpi"><span class="kpi-label">On a break</span><b class="kpi-value num">${n('break')}</b></div><div class="kpi"><span class="kpi-label">Not on a task</span><b class="kpi-value num">${n('idle')}</b></div>`)}
        <div class="kpi"><span class="kpi-label">Started work ${isToday ? 'today' : 'that day'}</span><b class="kpi-value num">${started} of ${d.people.length}</b></div><div class="kpi"><span class="kpi-label">Hours worked on tasks</span><b class="kpi-value num">${fmtDuration(worked)}</b></div></div>
      <section class="card">${d.people.length ? html`<div class="table-wrap"><table class="wk-team"><thead><tr><th>Person</th><th>${isToday ? 'Now' : 'Day'}</th><th class="num">Worked</th><th class="num">Breaks</th><th class="num">First start</th>${when(isToday, () => html`<th class="num">Pending</th>`)}</tr></thead><tbody>
        ${d.people.map((p) => html`<tr><td><span class="row" style="gap:8px;flex-wrap:nowrap">${avatar(p.name, p.id)}<span><a href="/people/${p.id}"><b>${p.name}</b></a><br><span class="small muted">${p.team}</span></span></span></td><td>${now(p)}</td><td class="num"><b>${fmtDuration(p.workedMin)}</b></td><td class="num">${p.breaks ? html`${fmtDuration(p.breakMin)}<br><span class="small muted">${p.breaks} break${p.breaks === 1 ? '' : 's'}</span>` : html`<span class="muted">None</span>`}</td><td class="num">${p.firstStart ? fmtTime(p.firstStart) : html`<span class="muted">—</span>`}</td>${when(isToday, () => html`<td class="num">${p.pending.length}${when(p.pending.some((x) => x.overdue), () => html`<br><span class="small c-crit">${p.pending.filter((x) => x.overdue).length} overdue</span>`)}</td>`)}</tr>
          ${when(p.sessions.length || p.pending.length, () => html`<tr class="wk-detail"><td colspan="${isToday ? 6 : 5}"><details><summary>${p.sessions.length ? `The day so far (${p.sessions.length})` : 'Nothing started'}${when(isToday && p.pending.length, () => html` · ${p.pending.length} pending`)}</summary><div class="wk-cols">
            ${when(p.sessions.length, () => html`<div><b class="small">Through the day</b><ul class="wk-line">${p.sessions.map((s) => html`<li><span class="num">${fmtTime(s.started_at)}${s.ended_at ? html` to ${fmtTime(s.ended_at)}` : ' to now'}</span><span>${s.kind === 'break' ? pill(`Break${s.note && s.note !== 'Break' ? `: ${s.note}` : ''}`, 'warn') : html`${pill(WORK_TYPE_LABEL[s.entity_type], TYPE_TONE[s.entity_type])} ${s.title}`}</span><span class="num muted">${fmtDuration(s.minutes)}</span></li>`)}</ul></div>`)}
            ${when(isToday && p.pending.length, () => html`<div><b class="small">Pending</b><ul class="wk-line">${p.pending.map((x) => html`<li><span>${pill(WORK_TYPE_LABEL[x.type], TYPE_TONE[x.type])}</span><span>${x.href ? html`<a href="${x.href}">${x.title}</a>` : x.title}${when(x.from, () => html` <span class="small muted">from ${x.from}</span>`)}</span><span class="num ${x.overdue ? 'c-crit' : 'muted'}">${x.overdue ? 'Overdue' : x.minutes ? fmtDuration(x.minutes) : 'Not started'}</span></li>`)}</ul></div>`)}
          </div></details></td></tr>`)}`)}
        </tbody></table></div>` : empty('There is no one to show here.', '👥')}</section>
      <p class="small muted">A person works on one item at a time. A timer left running is counted for at most 10 hours, a break for at most 3.</p>${CLOCK_JS}` });
}
