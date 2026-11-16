import * as lists from '../../lib/lists.ts';
import { html, when, type Raw } from '../../lib/html.ts';
import { page, drawer, modal, type View } from '../layout.ts';
import { icon, pill, avatar, slaChip, priorityPill, empty, statCard, timeline, field, input, textarea, select, chips, button } from '../components.ts';
import { slaState, labelStatus, OPEN_STATUSES, type TicketView, type TicketEvent, type Priority } from '../../modules/desk/service.ts';
import type { Employee } from '../../modules/people/model.ts';
import type { Customer } from '../../modules/sales/service.ts';
import { fmtDateTime, relativeAge, fmtDate } from '../../lib/time.ts';

export interface DeskData {
  now: Date; tickets: TicketView[]; filter: { mine: boolean; q: string; priority: string; sla: string; type: string; team: boolean };
  stats: { open: number; breached: number; dueSoon: number; unassigned: number; resolvedToday: number }; canWrite: boolean; canExport: boolean;
}

const COLUMNS: { key: string; title: string; statuses: string[]; cls?: string }[] = [
  { key: 'new', title: 'New', statuses: ['new'], cls: 'column-warn' },
  { key: 'assigned', title: 'Assigned', statuses: ['assigned'] },
  { key: 'in_progress', title: 'In progress', statuses: ['in_progress'], cls: 'column-accent' },
  { key: 'waiting', title: 'Waiting', statuses: ['waiting_customer', 'waiting_dev'] },
  { key: 'resolved', title: 'Resolved', statuses: ['resolved'], cls: 'column-good' }
];

/** Implementation tickets run on a plan (default 21 days) rather than the SLA clock. */
export function implChip(t: TicketView, now: Date): Raw {
  const day = Math.max(1, Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 86_400_000) + 1);
  const plan = t.impl_plan_days || 21;
  return pill(`Day ${day} of ${plan}`, day > plan ? 'crit' : day > plan * 0.8 ? 'warn' : 'violet', `Implementation plan: ${plan} days`);
}

export function ticketCard(t: TicketView, now: Date): Raw {
  const s = slaState(t, now);
  return html`<a class="kcard ${t.priority === 'P1' ? 'kcard-p1' : ''}" href="/tickets/${t.id}" data-drawer="/tickets/${t.id}" style="text-decoration:none;color:inherit">
    <div class="row between"><span class="row" style="gap:6px">${priorityPill(t.priority)}<span class="xs faint mono">${t.id}</span></span>${t.type === 'implementation' ? pill('Impl.', 'violet') : t.type === 'internal' ? pill('Internal', 'ink') : ''}</div>
    <div class="kcard-title">${t.subject}</div>
    <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.customer_name || 'Internal'}</div>
    <div class="row between">${avatar(t.assignee_name, t.assignee_id || '')}${t.status === 'waiting_dev' ? pill(`Dev: ${(t.dev_status || 'backlog').replace('_', ' ')}`, 'violet') : t.status === 'waiting_customer' ? pill('Customer', 'ink') : t.status === 'resolved' ? pill(t.rating ? `★ ${t.rating}` : 'Resolved', 'good') : t.type === 'implementation' ? implChip(t, now) : slaChip(s)}</div>
  </a>`;
}

export function deskPage(v: View, d: DeskData): Raw {
  const f = d.filter;
  const link = (patch: Record<string, string | null>) => { const p = new URLSearchParams(); const cur: Record<string, string> = { mine: f.mine ? '1' : '', team: f.team ? '1' : '', q: f.q, priority: f.priority, sla: f.sla, type: f.type }; for (const [k, val] of Object.entries({ ...cur, ...patch })) if (val) p.set(k, val); const s = p.toString(); return '/desk' + (s ? '?' + s : ''); };
  return page(v, {
    title: 'Service desk', autoRefresh: 120, subtitle: html`${d.stats.open} open · ${d.stats.breached ? html`<b class="c-crit">${d.stats.breached} past SLA</b>` : html`<b class="c-good">nothing past SLA</b>`} · ${d.stats.dueSoon} due within the hour · ${d.stats.unassigned} unassigned`,
    actions: html`${when(d.canExport, button('Excel', { href: '/exports/tickets.xlsx', icon: 'download' }))}${when(d.canWrite, button('New ticket', { modal: '/desk/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`
      <div class="grid grid-4">${statCard({ href: link({ sla: 'breach' }), value: d.stats.breached, label: 'Past SLA', tone: d.stats.breached ? 'crit' : 'good', sub: 'Resolve clock exceeded' })}${statCard({ href: link({ sla: 'warn' }), value: d.stats.dueSoon, label: 'Due within 1 hour', tone: d.stats.dueSoon ? 'warn' : 'neutral', sub: 'Needs attention now' })}${statCard({ href: link({ priority: 'P1' }), value: d.tickets.filter((t) => t.priority === 'P1' && OPEN_STATUSES.includes(t.status)).length, label: 'P1 open', tone: 'crit', sub: '15 min response, 4 h resolve' })}${statCard({ value: d.stats.resolvedToday, label: 'Resolved today', tone: 'good', sub: 'Ratings arrive by email' })}</div>
      <div class="filters">
        <a class="chip ${!f.mine && !f.team ? 'on' : ''}" href="${link({ mine: null, team: null })}">All</a><a class="chip ${f.mine ? 'on' : ''}" href="${link({ mine: '1', team: null })}">Mine</a>${when(v.isManager, () => html`<a class="chip ${f.team ? 'on' : ''}" href="${link({ team: '1', mine: null })}">My team</a>`)}
        <span style="width:1px;height:24px;background:var(--line)"></span>
        ${['P1', 'P2', 'P3', 'P4'].map((p) => html`<a class="chip ${f.priority === p ? 'on' : ''}" href="${link({ priority: f.priority === p ? null : p })}">${p}</a>`)}
        <a class="chip ${f.type === 'implementation' ? 'on' : ''}" href="${link({ type: f.type === 'implementation' ? null : 'implementation' })}">Implementations</a>
        <form method="get" action="/desk" class="row" style="margin-left:auto">${when(f.mine, () => html`<input type="hidden" name="mine" value="1">`)}<input class="input" name="q" value="${f.q}" placeholder="Search subject, id, customer" style="min-height:36px;width:240px"></form>
      </div>
      <div class="board-wrap"><div class="board board-5">${COLUMNS.map((c) => { const items = d.tickets.filter((t) => c.statuses.includes(t.status)); return html`<div class="column ${c.cls || ''}"><div class="column-head"><span>${c.title}</span><span class="count">${items.length}</span></div>${items.length ? items.map((t) => ticketCard(t, d.now)) : empty(c.key === 'new' ? 'Inbox zero 🎉' : 'Nothing here', c.key === 'new' ? '📭' : '✨')}</div>`; })}</div></div>`
  });
}

export interface TicketDetail { t: TicketView; events: TicketEvent[]; now: Date; agents: Employee[]; canWrite: boolean; canManage: boolean; customer: Customer | null; responseMinutes: number | null }

function ticketBody(v: View, d: TicketDetail): Raw {
  const t = d.t; const s = slaState(t, d.now);
  const open = OPEN_STATUSES.includes(t.status);
  const items = d.events.map((e) => ({ at: fmtDateTime(e.at), who: e.actor_name, text: e.text, tone: (e.kind === 'resolved' ? 'good' : e.kind === 'breach' || e.kind === 'reopened' ? 'crit' : e.kind === 'warning' ? 'warn' : e.kind === 'reply' || e.kind === 'escalated' ? 'accent' : undefined) as 'good' | 'crit' | 'warn' | 'accent' | undefined }));
  return html`
    <div class="row" style="gap:8px">${priorityPill(t.priority)}${pill(labelStatus(t.status), t.status === 'resolved' || t.status === 'closed' ? 'good' : t.status === 'waiting_dev' ? 'violet' : 'accent')}${t.type === 'implementation' && open ? implChip(t, d.now) : slaChip(s)}${when(t.reopen_count, pill(`Reopened ×${t.reopen_count}`, 'warn'))}${when(t.rating, pill(`★ ${t.rating} from customer`, 'good'))}</div>
    <div class="kv"><div><span>Customer</span><b>${t.customer_name || 'Internal'}</b>${when(d.customer?.contact_name, () => html`<span class="small">${d.customer?.contact_name} · ${d.customer?.phone}</span>`)}</div><div><span>Assignee</span><b>${t.assignee_name || 'Unassigned'}</b></div><div><span>Raised</span><b>${fmtDateTime(t.created_at)}</b><span class="small">by ${t.channel}</span></div>
      <div><span>Response due</span><b>${fmtDateTime(t.response_due_at)}</b><span class="small">${t.first_response_at ? `answered in ${d.responseMinutes} min` : 'no response yet'}</span></div><div><span>Resolve due</span><b>${fmtDateTime(t.resolve_due_at)}</b></div><div><span>Type</span><b>${t.type}${when(t.impl_plan_days, () => html` · ${t.impl_plan_days} day plan`)}</b>${when(t.dev_issue_id, () => html`<span class="small"><a href="/dev#${t.dev_issue_id}">${t.dev_issue_id}</a> · ${(t.dev_status || '').replace('_', ' ')}</span>`)}</div></div>
    ${when(t.description, () => html`<div><h3>Description</h3><p style="margin-top:6px;white-space:pre-wrap">${t.description}</p></div>`)}
    ${when(d.canWrite && open, () => html`
      <form class="form" data-ajax data-reset action="/tickets/${t.id}/reply"><h3>Reply or note</h3>
        ${chips('channel', [{ value: 'email', label: 'Email customer' }, { value: 'call', label: 'Phone call' }, { value: 'note', label: 'Internal note' }], 'email')}
        ${textarea('text', { placeholder: 'What did you tell the customer, or what did you find?', required: true, rows: 3 })}
        <div class="row"><button class="btn btn-primary" type="submit">${icon('mail', 16)} Send</button><span class="small muted">The first reply stops the response clock.</span></div></form>
      <div class="row" style="gap:8px">
        ${when(t.status !== 'in_progress', button('Start work', { post: `/tickets/${t.id}/status`, body: { status: 'in_progress' }, icon: 'bolt' }))}
        ${when(t.status !== 'waiting_customer', button('Waiting on customer', { post: `/tickets/${t.id}/status`, body: { status: 'waiting_customer' }, icon: 'clock' }))}
        ${when(!t.dev_issue_id, button('Escalate to dev', { post: `/tickets/${t.id}/escalate`, confirm: 'Create a development issue linked to this ticket? The customer will be told the status follows development.', icon: 'code' }))}
      </div>
      <div class="card" style="padding:14px 16px;background:var(--soft)"><div class="row between"><div><b>Assignee</b><br><span class="small muted">Only Support, Development and QA can own tickets.</span></div>
        <form class="row" data-ajax action="/tickets/${t.id}/assign" style="flex-wrap:nowrap;flex:1 1 320px;min-width:0">${select('assigneeId', d.agents.map((a) => ({ value: a.id, label: `${a.full_name} (${a.designation})`, selected: a.id === t.assignee_id })), { blank: 'Unassigned' })}<button class="btn" type="submit">Save</button></form></div>
        <div class="row between" style="margin-top:12px"><div><b>Priority</b><br><span class="small muted">Changing priority resets the SLA clock from now.</span></div><span class="row" style="gap:6px">${(['P1', 'P2', 'P3', 'P4'] as Priority[]).map((p) => html`<button class="btn btn-sm ${p === t.priority ? 'btn-dark' : ''}" type="button" data-post="/tickets/${t.id}/priority" data-body='{"priority":"${p}"}'>${p}</button>`)}</span></div></div>`)}
    ${when(!open && d.canWrite && t.status !== 'closed', () => html`<div class="row">${button('Reopen', { post: `/tickets/${t.id}/reopen`, kind: '', icon: 'arrow', title: 'Reopen' })}<span class="small muted">Reopening restarts the SLA clock and counts against the reopen rate.</span></div>`)}
    <div><h3>Timeline</h3><div style="margin-top:8px">${timeline(items)}</div></div>`;
}

export function ticketDrawer(v: View, d: TicketDetail): Raw {
  const open = OPEN_STATUSES.includes(d.t.status);
  return drawer({ title: html`${d.t.subject}`, meta: html`<span class="mono">${d.t.id}</span> · ${d.t.customer_name || 'Internal'} · opened ${relativeAge(d.t.created_at, d.now)}`, href: `/tickets/${d.t.id}`, body: ticketBody(v, d),
    foot: when(d.canWrite && open, () => html`<span class="small muted">Resolving emails the customer a one-click rating link.</span>${button('Resolve ticket', { post: `/tickets/${d.t.id}/resolve`, kind: 'good', icon: 'check' })}`) });
}

export function ticketPage(v: View, d: TicketDetail): Raw {
  const open = OPEN_STATUSES.includes(d.t.status);
  return page(v, { title: d.t.subject, docTitle: d.t.id, subtitle: html`<span class="mono">${d.t.id}</span> · ${d.t.customer_name || 'Internal'} · opened ${relativeAge(d.t.created_at, d.now)}`,
    actions: html`${button('Board', { href: '/desk', kind: 'ghost' })}${when(d.canWrite && open, button('Resolve ticket', { post: `/tickets/${d.t.id}/resolve`, kind: 'good', icon: 'check' }))}`,
    body: html`<section class="card stack" style="gap:18px">${ticketBody(v, d)}</section>` });
}

export function newTicketModal(v: View, o: { customers: Customer[]; agents: Employee[] }): Raw {
  return modal({ title: 'New ticket', body: html`<form class="form" data-ajax action="/tickets">
    <div class="grid grid-2">${field('Customer', select('customerId', o.customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.city}` })), { blank: 'Internal / not a customer' }))}${field('Or a new customer name', input('customerName', { placeholder: 'Only if not in the list' }))}</div>
    ${field('Subject', input('subject', { required: true, placeholder: 'What is the problem, in one line' }))}
    ${field('Details', textarea('description', { rows: 3, placeholder: 'Steps, error messages, what the customer expects' }))}
    <div class="grid grid-2">${field('Priority', chips('priority', lists.options('desk.priorities'), 'P3'), 'P1 = business stopped. 15 min response, 4 h resolve, any day.')}${field('Type', select('type', lists.options('desk.types')))}</div>
    <div class="grid grid-2">${field('Channel', select('channel', lists.options('desk.channels')))}${field('Assign to', select('assigneeId', o.agents.map((a) => ({ value: a.id, label: a.full_name })), { blank: 'Leave in New' }))}</div>
    <div class="row between"><span class="small muted">The customer gets the ticket id by email when an address is on file.</span><button class="btn btn-primary" type="submit">Create ticket</button></div></form>` });
}

