import * as lists from '../../lib/lists.ts';
import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, avatar, empty, field, input, textarea, select, chips, button, table } from '../components.ts';
import type { Task } from '../../modules/tasks/service.ts';
import type { Employee } from '../../modules/people/model.ts';
import { fmtDate, fmtDateTime, relativeAge, inr, fmtDuration } from '../../lib/time.ts';
import type { TodayData } from './today.ts';

export interface ApprovalsData { now: Date; forMe: Task[]; mine: Task[]; history: Task[]; tab: string; budgetByRequester: Record<string, { remaining: number; amount: number; department: string }>; leave: TodayData['leave']; leaveRows: { id: string; type: string; from_date: string; to_date: string; days: number; status: string; reason: string }[]; expenseRows: { id: string; category: string; amount: number; status: string; description: string; created_at: string }[] }

function statusPill(s: string): Raw { return pill(s === 'open' ? 'Waiting' : s === 'approved' ? 'Approved' : s === 'declined' ? 'Declined' : s, s === 'approved' ? 'good' : s === 'declined' ? 'crit' : s === 'open' ? 'warn' : 'ink'); }

export function approvalsPage(v: View, d: ApprovalsData): Raw {
  const tabs = [{ key: 'forme', label: `For me (${d.forMe.length})` }, { key: 'mine', label: 'My requests' }, { key: 'history', label: 'Decided by me' }];
  const row = (t: Task, decide: boolean) => html`<li id="${t.id}">
    ${avatar(t.requester_name, t.requester_id || '')}
    <span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${t.title}</b><span class="small muted">${t.requester_name || '—'} · ${relativeAge(t.created_at, d.now)}${when(t.amount, () => html` · <b class="num">${t.type === 'discount' ? `${t.amount}%` : t.type === 'leave' ? `${t.amount} day${t.amount === 1 ? '' : 's'}` : inr(t.amount!)}</b>`)}${when(t.details, () => html` · ${t.details}`)}${when(t.decision_note, () => html` · <i>“${t.decision_note}”</i>`)}${when(decide && (t.type === 'expense' || t.type === 'purchase') && t.requester_id && d.budgetByRequester[t.requester_id] && d.budgetByRequester[t.requester_id].amount > 0, () => { const bgt = d.budgetByRequester[t.requester_id!]; return html` · <span class="${bgt.remaining - (t.amount || 0) < 0 ? 'c-crit' : 'c-good'}">${bgt.department} budget left ${inr(bgt.remaining)}</span>`; })}</span></span>
    ${when(t.link, () => html`<a class="btn btn-sm btn-ghost" href="${t.link}">Open</a>`)}
    ${decide ? html`<span class="row" style="gap:6px"><button class="btn btn-sm btn-good" data-post="/tasks/${t.id}/decide" data-body='{"decision":"approved"}' ${when(t.title.startsWith('Miss punch') || t.type === 'leave', () => html`data-prompt="${t.title.startsWith('Miss punch') ? 'Your comment (required — it is kept with the request)' : 'Comment (optional)'}" data-prompt-key="note"`)} data-remove-on-success="li">${icon('check', 14)} Approve</button><button class="btn btn-sm" data-post="/tasks/${t.id}/decide" data-body='{"decision":"declined"}' data-prompt="Reason for declining (the requester will see it)" data-prompt-key="note" data-remove-on-success="li">Decline</button></span>` : html`${statusPill(t.status)}${when(t.status === 'open' && t.assignee_name, () => html`<span class="xs muted">with ${t.assignee_name}</span>`)}`}</li>`;
  return page(v, {
    title: 'Approvals', subtitle: 'Leave, expenses, discounts, purchases and target proposals, routed by the thresholds in Settings.',
    actions: html`${button('Request leave', { modal: '/approvals/leave/new', icon: 'calendar' })}${button('Claim expense', { modal: '/approvals/expense/new', icon: 'rupee' })}${when(v.isManager, button('Purchase request', { modal: '/approvals/purchase/new', icon: 'file' }))}`,
    body: html`<div class="tabs">${tabs.map((t) => html`<a href="/approvals?tab=${t.key}" class="${d.tab === t.key ? 'active' : ''}">${t.label}</a>`)}</div>
      ${d.tab === 'forme' ? html`<section class="card">${d.forMe.length ? html`<ul class="list">${d.forMe.map((t) => row(t, true))}</ul>` : empty('Nothing waiting for you. Enjoy it while it lasts.', '🎉')}</section>`
      : d.tab === 'mine' ? html`<section class="card"><h2>Requests</h2>${d.mine.length ? html`<ul class="list">${d.mine.map((t) => row(t, false))}</ul>` : empty('You have not requested anything yet.', '📝')}</section>
        <div class="grid grid-2"><section class="card"><div class="card-head"><h2>Leave</h2><span class="small muted">${d.leave.map((t) => `${t.code} ${t.quota - t.used}/${t.quota}`).join(' · ')} left</span></div>${table(['Type', 'From', 'To', 'Days', 'Status'], d.leaveRows.map((l) => [l.type, fmtDate(l.from_date), fmtDate(l.to_date), l.days, statusPill(l.status)]), { emptyText: 'No leave requests this year.' })}</section>
        <section class="card"><h2>Expenses</h2>${table(['Category', 'Amount', 'Status', 'When'], d.expenseRows.map((e) => [e.category, html`<b class="num">${inr(e.amount)}</b>`, statusPill(e.status), fmtDate(e.created_at)]), { emptyText: 'No expense claims yet.' })}</section></div>`
      : html`<section class="card">${d.history.length ? html`<ul class="list">${d.history.map((t) => row(t, false))}</ul>` : empty('You have not decided anything yet.', '🗂️')}</section>`}`
  });
}

export function leaveModal(v: View, leave: TodayData['leave']): Raw {
  return modal({ title: 'Request leave', body: html`<form class="form" data-ajax action="/leave">
    ${chips('type', leave.filter((t) => t.active).map((t) => ({ value: t.code, label: `${t.label} · ${t.quota - t.used} left` })), leave.find((t) => t.active)?.code || '')}
    <div class="grid grid-2">${field('From', input('from', { type: 'date', required: true }))}${field('To', input('to', { type: 'date', required: true }))}</div>
    ${field('Reason', textarea('reason', { rows: 2, placeholder: 'Optional, but it helps your manager plan' }))}
    <div class="row between"><span class="small muted">Up to 3 days: your manager approves. Longer: your HOD.</span><button class="btn btn-primary" type="submit">Send request</button></div></form>` });
}

export function expenseModal(v: View, deals: { id: string; label: string }[] = [], budget: { remaining: number; amount: number } | null = null): Raw {
  return modal({ title: 'Claim an expense', body: html`<form class="form" data-ajax action="/expenses">
    <div class="grid grid-2">${field('Category', select('category', lists.options('finance.expenseCategories')))}${field('Amount (₹)', input('amount', { type: 'number', min: 1, step: 1, required: true }))}</div>
    ${field('What was it for?', textarea('description', { rows: 2, required: true }))}
    <div class="grid grid-2">${when(deals.length, () => field('Related deal (for travel impact)', select('dealId', deals.map((d) => ({ value: d.id, label: d.label })), { blank: '—' })))}${field('Km travelled (optional)', input('km', { type: 'number', min: 0, step: 1 }))}</div>
    <div class="row between"><span class="small muted">Up to ₹10,000: team lead. Up to ₹50,000: HOD. Above: COO.${when(budget && budget.amount > 0, () => html` Department budget left: <b>${inr(budget!.remaining)}</b>.`)}</span><button class="btn btn-primary" type="submit">Submit claim</button></div></form>` });
}

export function purchaseModal(v: View): Raw {
  return modal({ title: 'Purchase request', body: html`<form class="form" data-ajax action="/purchases">
    ${field('What do you need?', input('title', { required: true, placeholder: 'Item or service' }))}
    <div class="grid grid-2">${field('Estimated amount (₹)', input('amount', { type: 'number', min: 1, step: 1, required: true }))}${field('Needed by', input('neededBy', { type: 'date' }))}</div>
    ${field('Why?', textarea('details', { rows: 2, required: true }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Send request</button></div></form>` });
}

export interface TasksData { now: Date; mine: Task[]; assigned: Task[]; done: Task[]; canAssign: boolean }

export function tasksPage(v: View, d: TasksData): Raw {
  const row = (t: Task, own: boolean) => { const overdue = t.due_at && t.due_at < d.now.toISOString() && !['done', 'cancelled'].includes(t.status); return html`<li id="${t.id}">
    ${own ? html`<input type="checkbox" data-post="/tasks/${t.id}/complete" data-remove-on-success="li" aria-label="Complete" style="width:20px;height:20px;accent-color:var(--good)">` : avatar(t.assignee_name, t.assignee_id || '')}
    <span style="flex:1;min-width:0"><b style="display:block;font-size:13px">${t.title}</b><span class="small ${overdue ? 'c-crit' : 'muted'}">${t.type.replace('_', ' ')}${when(!own, () => html` · ${t.assignee_name || 'Unassigned'}`)}${when(t.requester_name && t.requester_id !== v.user.id, () => html` · from ${t.requester_name}`)}${when(t.due_at, () => html` · ${overdue ? 'Overdue, was due' : 'Due'} ${fmtDate(t.due_at)}`)}${when(t.minutes_logged || t.timer_started_at, () => html` · ${fmtDuration(t.minutes_logged)} logged`)}${when(t.details, () => html`<br>${t.details}`)}</span></span>
    ${when(t.link, () => html`<a class="btn btn-sm btn-ghost" href="${t.link}">Open</a>`)}
    ${when(own && !['done', 'cancelled'].includes(t.status), () => html`<button class="btn btn-sm ${t.timer_started_at ? 'btn-dark' : ''}" data-post="/tasks/${t.id}/timer">${icon('clock', 14)} ${t.timer_started_at ? 'Stop timer' : 'Start timer'}</button>`)}
    ${when(t.status === 'done', pill(`Done ${fmtDate(t.decided_at)}`, 'good'))}</li>`; };
  return page(v, { title: 'Tasks', subtitle: 'Work handed to you, with a timer for executive-assigned tasks.', actions: when(d.canAssign, button('Assign a task', { modal: '/tasks/new', kind: 'primary', icon: 'plus' })),
    body: html`<section class="card"><h2>My open tasks</h2>${d.mine.length ? html`<ul class="list">${d.mine.map((t) => row(t, true))}</ul>` : empty('No open tasks. 🎉')}</section>
      ${when(d.canAssign, () => html`<section class="card"><h2>Tasks I assigned</h2>${d.assigned.length ? html`<ul class="list">${d.assigned.map((t) => row(t, false))}</ul>` : empty('You have not assigned any tasks.')}</section>`)}
      ${when(d.done.length, () => html`<section class="card"><h2>Recently done</h2><ul class="list">${d.done.map((t) => row(t, false))}</ul></section>`)}` });
}

export function newTaskModal(v: View, people: Employee[]): Raw {
  return modal({ title: 'Assign a task', body: html`<form class="form" data-ajax action="/tasks">
    ${field('Task', input('title', { required: true }))}${field('Details', textarea('details', { rows: 2 }))}
    <div class="grid grid-2">${field('Assign to', select('assigneeId', people.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.designation}` })), { blank: 'Me' }))}${field('Due', input('dueAt', { type: 'date' }))}</div>
    <div class="row between"><span class="small muted">The person is notified and the task appears on their Today page.</span><button class="btn btn-primary" type="submit">Assign</button></div></form>` });
}

export { fmtDateTime };
