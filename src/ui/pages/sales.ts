import { dealEstimatesCard } from './estimates.ts';
import type { Estimate } from '../../modules/sales/estimates.ts';
import * as lists from '../../lib/lists.ts';
import { html, when, type Raw } from '../../lib/html.ts';
import { page, drawer, modal, type View } from '../layout.ts';
import { icon, pill, avatar, empty, statCard, timeline, field, input, textarea, select, chips, button, table, notice } from '../components.ts';
import { STAGES, STAGE_LABEL, WIN_CHANCE, LOST_REASONS, exitRuleProblem, type Deal, type Activity, type Customer, type Stage } from '../../modules/sales/service.ts';
import type { Employee } from '../../modules/people/model.ts';
import type { TicketView } from '../../modules/desk/service.ts';
import type { WorkOrder } from '../../modules/production/service.ts';
import { fmtDate, fmtDateTime, money, inr, relativeAge } from '../../lib/time.ts';

export interface PipelineData {
  now: Date; deals: Deal[]; filter: { mine: boolean; team: boolean; stale: boolean; q: string; owner: string };
  owners: Employee[]; stats: { open: number; openValue: number; weighted: number; wonMonth: number; wonMonthValue: number; overdue: number }; canWrite: boolean; canExport: boolean;
}

export function dealCard(d: Deal, now: Date): Raw {
  const today = now.toISOString().slice(0, 10);
  const days = d.days_in_stage || 0;
  const overdue = !!d.next_step_due && d.next_step_due.slice(0, 10) < today && d.stage !== 'won' && d.stage !== 'lost';
  return html`<a class="kcard ${days > 14 && d.stage !== 'won' ? 'kcard-stale' : ''}" href="/deals/${d.id}" data-drawer="/deals/${d.id}" style="text-decoration:none;color:inherit">
    <div class="row between"><b class="num" style="font-size:14px">${money(d.value * (1 - d.discount_pct / 100), d.currency)}</b>${d.discount_status === 'pending' ? pill('Discount pending', 'warn') : d.stage === 'won' ? pill('Won', 'good') : days > 14 ? pill(`${days} d in stage`, 'crit') : days > 7 ? pill(`${days} d`, 'warn') : ''}</div>
    <div class="kcard-title">${d.customer_name}</div>
    <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${d.title || 'Untitled deal'}</div>
    <div class="row between">${avatar(d.owner_name, d.owner_id)}<span class="xs ${overdue ? 'c-crit' : 'muted'}" style="text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:60%">${overdue ? '⚠ ' : ''}${d.next_step || 'No next step'}${when(d.next_step_due, () => html` · ${fmtDate(d.next_step_due)}`)}</span></div>
  </a>`;
}

export function pipelinePage(v: View, d: PipelineData): Raw {
  const f = d.filter;
  const link = (patch: Record<string, string | null>) => { const p = new URLSearchParams(); const cur: Record<string, string> = { mine: f.mine ? '1' : '', team: f.team ? '1' : '', stale: f.stale ? '1' : '', q: f.q, owner: f.owner }; for (const [k, val] of Object.entries({ ...cur, ...patch })) if (val) p.set(k, val); const s = p.toString(); return '/pipeline' + (s ? '?' + s : ''); };
  const cols: Stage[] = [...STAGES];
  return page(v, {
    title: 'Pipeline', subtitle: html`${d.stats.open} open deals worth <b class="num">${inr(d.stats.openValue)}</b> · weighted <b class="num">${inr(d.stats.weighted)}</b> · ${d.stats.wonMonth} won this month (${inr(d.stats.wonMonthValue)})`,
    actions: html`${when(d.canExport, button('Excel', { href: '/exports/pipeline.xlsx', icon: 'download' }))}${when(d.canWrite, () => html`${button('Log activity', { modal: '/pipeline/activity', icon: 'phone' })}${button('New lead', { modal: '/pipeline/new', kind: 'primary', icon: 'plus' })}`)}`,
    body: html`
      <div class="grid grid-4">${statCard({ href: link({ stale: null }), value: d.stats.open, label: 'Open deals', tone: 'accent', sub: inr(d.stats.openValue) })}${statCard({ value: Math.round(d.stats.weighted / 100000) / 10 + ' L', label: 'Weighted pipeline', tone: 'neutral', sub: 'value × stage win chance' })}${statCard({ href: '/pipeline?mine=1&overdue=1', value: d.stats.overdue, label: 'Overdue follow-ups', tone: d.stats.overdue ? 'crit' : 'good', sub: 'next step date passed' })}${statCard({ value: d.stats.wonMonth, label: 'Won this month', tone: 'good', sub: inr(d.stats.wonMonthValue) })}</div>
      <div class="filters">
        <a class="chip ${!f.mine && !f.team ? 'on' : ''}" href="${link({ mine: null, team: null })}">All</a><a class="chip ${f.mine ? 'on' : ''}" href="${link({ mine: '1', team: null })}">Mine</a>${when(v.isManager, () => html`<a class="chip ${f.team ? 'on' : ''}" href="${link({ team: '1', mine: null })}">My team</a>`)}
        <a class="chip ${f.stale ? 'on' : ''}" href="${link({ stale: f.stale ? null : '1' })}">Stuck &gt; 14 days</a>
        ${when(v.isManager && d.owners.length, () => html`<form method="get" action="/pipeline"><select class="input" name="owner" data-autosubmit style="min-height:36px;width:auto"><option value="">Any owner</option>${d.owners.map((o) => html`<option value="${o.id}" ${when(o.id === f.owner, 'selected')}>${o.full_name}</option>`)}</select></form>`)}
        <form method="get" action="/pipeline" class="row" style="margin-left:auto"><input class="input" name="q" value="${f.q}" placeholder="Search customer or deal" style="min-height:36px;width:220px"></form>
      </div>
      <div class="board-wrap"><div class="board board-7">${cols.map((st) => { const items = d.deals.filter((x) => x.stage === st); const total = items.reduce((n, x) => n + x.value * (1 - x.discount_pct / 100), 0); return html`<div class="column ${st === 'negotiation' ? 'column-accent' : st === 'won' ? 'column-good' : ''}"><div class="column-head"><span>${STAGE_LABEL[st]} <span class="xs faint">${WIN_CHANCE[st]}%</span></span><span class="count">${items.length} · ${inr(total)}</span></div>${items.length ? items.map((x) => dealCard(x, d.now)) : empty(st === 'new' ? 'No new leads' : 'Empty', '·')}</div>`; })}</div></div>`
  });
}

export interface DealDetail { d: Deal; activities: Activity[]; quotes: { id: string; version: number; currency: string; list_total: number; discount_pct: number; total: number; status: string; created_at: string }[]; now: Date; canWrite: boolean; canManage: boolean; estimates: Estimate[]; canEditEstimate: boolean; owners: Employee[]; customer: Customer | null; discountRule: string }

function dealBody(v: View, x: DealDetail, sideActivity = false): Raw {
  const d = x.d;
  const open = d.stage !== 'won' && d.stage !== 'lost';
  const net = d.value * (1 - d.discount_pct / 100);
  const stageButtons = STAGES.map((st) => {
    const idx = STAGES.indexOf(st), cur = STAGES.indexOf(d.stage);
    const problem = st !== d.stage ? exitRuleProblem(d, st) : null;
    const cls = st === d.stage ? (d.stage === 'lost' ? 'lost' : 'now') : idx < cur ? 'done' : '';
    return html`<button class="path-step ${cls}" type="button" ${when(st !== d.stage && x.canWrite && open, () => html`data-post="/deals/${d.id}/move" data-body='{"stage":"${st}"}'`)} ${when(st === 'won' && st !== d.stage, () => html`data-confirm="Mark this deal as won? A work order, an invoice request and an implementation ticket are created automatically."`)} ${when(!x.canWrite || !open || st === d.stage, 'disabled')} title="${problem || STAGE_LABEL[st]}">${problem ? '🔒 ' : ''}${STAGE_LABEL[st]}</button>`;
  });
  const items = x.activities.map((a) => ({ at: fmtDateTime(a.at), who: a.actor_name, text: html`<b style="font-weight:600;text-transform:capitalize">${a.kind}</b>${when(a.notes, () => html` · ${a.notes}`)}${when(a.outcome, () => html` <span class="pill pill-ink">${a.outcome}</span>`)}${when(a.kind === 'visit' && a.lat, () => html` <span class="xs faint">📍 ${a.lat?.toFixed(4)}, ${a.lng?.toFixed(4)}${when(a.km, () => html` · ${a.km} km`)}</span>`)}`, tone: (a.kind === 'won' ? 'good' : a.kind === 'stage' ? 'accent' : a.kind === 'quote' ? 'warn' : undefined) as 'good' | 'accent' | 'warn' | undefined }));
  return html`
    <div class="row" style="gap:8px">${pill(STAGE_LABEL[d.stage], d.stage === 'won' ? 'good' : d.stage === 'lost' ? 'crit' : 'accent')}${when(d.discount_pct, pill(`${d.discount_pct}% discount · ${d.discount_status}`, d.discount_status === 'pending' ? 'warn' : d.discount_status === 'approved' ? 'good' : 'ink'))}${when(d.po_received, pill('PO received', 'good'))}${when((d.days_in_stage || 0) > 14 && open, pill(`${d.days_in_stage} days in stage`, 'crit'))}${when(d.lost_reason, pill(`Lost: ${d.lost_reason}`, 'crit'))}</div>
    <div class="kv"><div><span>Net value</span><b class="num">${money(net, d.currency)}</b>${when(d.discount_pct, () => html`<span class="small">list ${money(d.value, d.currency)}</span>`)}</div><div><span>Owner</span><b>${d.owner_name}</b></div><div><span>Win chance</span><b>${WIN_CHANCE[d.stage]}%</b><span class="small">weighted ${money(net * WIN_CHANCE[d.stage] / 100, d.currency)}</span></div>
      <div><span>Next step</span><b>${d.next_step || '—'}</b>${when(d.next_step_due, () => html`<span class="small ${d.next_step_due!.slice(0, 10) < x.now.toISOString().slice(0, 10) && open ? 'c-crit' : ''}">due ${fmtDate(d.next_step_due)}</span>`)}</div><div><span>Expected close</span><b>${d.expected_close ? fmtDate(d.expected_close) : '—'}</b></div><div><span>Source</span><b>${d.source || '—'}</b>${when(x.customer, () => html`<span class="small">${x.customer?.city}${when(x.customer?.contact_name, () => html` · ${x.customer?.contact_name}`)}</span>`)}</div></div>
    <div><h3>Stage</h3><div class="path" style="margin-top:8px">${stageButtons}</div><p class="small muted" style="margin-top:6px">🔒 means an exit rule blocks the move; hover to see which. Qualified needs need, budget and timeline; Proposal needs a quote; Won needs an approved discount and a PO.</p></div>
    ${when(x.canWrite && open, () => html`
      <form class="form card" data-ajax data-reset data-gps action="/deals/${d.id}/activity" style="background:var(--soft);padding:14px 16px"><h3>Log an activity</h3>
        ${chips('kind', [{ value: 'call', label: '📞 Call' }, { value: 'visit', label: '📍 Visit' }, { value: 'demo', label: '🖥 Demo' }, { value: 'email', label: '✉️ Email' }, { value: 'note', label: '📝 Note' }], 'call')}
        ${textarea('notes', { rows: 2, placeholder: 'What happened and what is next?', required: true })}
        <div class="grid grid-2">${field('Outcome', select('outcome', lists.options('sales.outcomes')))}${field('Next step and date', html`<div class="row" style="flex-wrap:nowrap">${input('next_step', { value: d.next_step, placeholder: 'Next step' })}${input('next_step_due', { type: 'date', value: d.next_step_due ? d.next_step_due.slice(0, 10) : '' })}</div>`)}</div>
        <div class="row between"><span class="small muted">Visits record your location (field GPS is mandatory).</span><button class="btn btn-primary" type="submit">Save activity</button></div></form>
      <details class="card" style="padding:14px 16px"><summary style="cursor:pointer;font-weight:600">Qualification, PO and details</summary>
        <form class="form" data-ajax action="/deals/${d.id}/update" style="margin-top:12px"><div class="grid grid-3">${field('Need', input('qualified_need', { value: d.qualified_need, placeholder: 'What problem?' }))}${field('Budget', input('qualified_budget', { value: d.qualified_budget, placeholder: 'Confirmed budget' }))}${field('Timeline', input('qualified_timeline', { value: d.qualified_timeline, placeholder: 'When?' }))}</div>
          <div class="grid grid-3">${field('Deal title / product', input('title', { value: d.title }))}${field('List value', input('value', { type: 'number', value: d.value, min: 0, step: 1 }))}${field('Expected close', input('expected_close', { type: 'date', value: d.expected_close ? d.expected_close.slice(0, 10) : '' }))}</div>
          <div class="grid grid-2">${when(x.canManage, field('Owner', select('owner_id', x.owners.map((o) => ({ value: o.id, label: o.full_name, selected: o.id === d.owner_id })))))}<label class="row" style="gap:10px;align-items:center;padding-top:26px"><input type="checkbox" name="po_received" ${when(d.po_received, 'checked')} style="width:20px;height:20px;accent-color:var(--good)"> PO or advance received</label></div>
          <div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Save details</button></div></form></details>
      ${dealEstimatesCard({ dealId: d.id, estimates: x.estimates, canEdit: x.canEditEstimate, open: true })}
      <details class="card" style="padding:14px 16px"><summary style="cursor:pointer;font-weight:600">Quick figure without an estimate</summary><p class="small muted" style="margin-top:8px">Use this only when there is no product list to quote from. An estimate sets these figures for you.</p>
        <form class="form" data-ajax action="/deals/${d.id}/quote" style="margin-top:12px"><div class="grid grid-3">${field('List total', input('listTotal', { type: 'number', value: d.value, min: 0, step: 1, required: true }))}${field('Discount %', input('discountPct', { type: 'number', value: d.discount_pct, min: 0, max: 50, step: 0.5 }))}${field('Currency', select('currency', lists.options('sales.currencies', d.currency)))}</div>
          <p class="small muted">${x.discountRule}</p><div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Create quote</button></div></form>
        ${when(x.quotes.length, table(['Quote', 'List', 'Discount', 'Total', 'Created'], x.quotes.map((q) => [html`${q.id} v${q.version}`, money(q.list_total, q.currency), `${q.discount_pct}%`, html`<b class="num">${money(q.total, q.currency)}</b>`, fmtDate(q.created_at)])))}</details>
      <div class="row" style="gap:8px">${button('Mark lost', { post: `/deals/${d.id}/lost`, confirm: 'Mark this deal as lost?', kind: 'ghost', icon: 'x' })}<span class="small muted">Lost deals keep their history and feed the win rate.</span></div>`)}
    ${when(!sideActivity, () => html`<div><h3>Activity</h3><div style="margin-top:8px">${timeline(items)}</div></div>`)}`;
}
function dealActivity(x: DealDetail): Raw {
  return timeline(x.activities.map((a) => ({ at: fmtDateTime(a.at), who: a.actor_name, text: html`<b style="font-weight:600;text-transform:capitalize">${a.kind}</b>${when(a.notes, () => html` · ${a.notes}`)}${when(a.outcome, () => html` <span class="pill pill-ink">${a.outcome}</span>`)}`, tone: (a.kind === 'won' ? 'good' : a.kind === 'stage' ? 'accent' : a.kind === 'quote' ? 'warn' : undefined) as 'good' | 'accent' | 'warn' | undefined })));
}

export function dealDrawer(v: View, x: DealDetail): Raw {
  const open = x.d.stage !== 'won' && x.d.stage !== 'lost';
  return drawer({ title: x.d.customer_name || '', meta: html`<span class="mono">${x.d.id}</span> · ${x.d.title || 'Untitled deal'} · owner ${x.d.owner_name}`, href: `/deals/${x.d.id}`, body: dealBody(v, x),
    foot: when(x.canWrite && open, () => html`<span class="small muted">${exitRuleProblem(x.d, 'won') || 'All exit rules met.'}</span>${button('Won 🎉', { post: `/deals/${x.d.id}/move`, body: { stage: 'won' }, kind: 'good', confirm: 'Mark this deal as won? A work order, invoice request and implementation ticket will be created.', disabled: !!exitRuleProblem(x.d, 'won') })}`) });
}

export function dealPage(v: View, x: DealDetail): Raw {
  return page(v, { title: x.d.customer_name || '', docTitle: x.d.id, subtitle: html`<span class="mono">${x.d.id}</span> · ${x.d.title || 'Untitled deal'} · created ${relativeAge(x.d.created_at, x.now)}`, actions: button('Pipeline', { href: '/pipeline', kind: 'ghost' }), body: html`<div class="cols"><div class="col-main"><section class="card stack" style="gap:14px">${dealBody(v, x, true)}</section></div>
    <div class="col-side"><section class="card"><div class="card-head"><h2>Activity</h2><span class="small muted">${x.activities.length}</span></div>${x.activities.length ? dealActivity(x) : html`<p class="small muted">Nothing logged yet. Calls, visits, estimates and stage changes appear here.</p>`}</section>
      ${when(x.customer, () => html`<section class="card"><div class="card-head"><h2>Customer</h2></div><a href="/customers/${x.customer!.id}"><b>${x.customer!.name}</b></a><div class="small muted" style="margin-top:2px">${x.customer!.city}${when(x.customer!.contact_name, () => html` · ${x.customer!.contact_name}`)}${when(x.customer!.phone, () => html` · ${x.customer!.phone}`)}</div></section>`)}</div></div>` });
}

export function newLeadModal(v: View, o: { customers: Customer[]; owners: Employee[]; canManage: boolean }): Raw {
  return modal({ title: 'New lead', body: html`<form class="form" data-ajax action="/deals">
    <div class="grid grid-2">${field('Existing customer', select('customerId', o.customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.city}` })), { blank: 'New customer (fill the name)' }))}${field('New customer name', input('customerName', { placeholder: 'Company name' }))}</div>
    <div class="grid grid-2">${field('City', input('city'))}${field('Source', select('source', lists.options('sales.sources')))}</div>
    <div class="grid grid-2">${field('What are they buying?', input('title', { placeholder: 'Product or solution', required: true }))}${field('Estimated value (₹)', input('value', { type: 'number', min: 0, step: 1000, required: true }))}</div>
    <div class="grid grid-2">${when(o.canManage, field('Owner', select('ownerId', o.owners.map((e) => ({ value: e.id, label: e.full_name, selected: e.id === v.user.id })))))}${field('Expected close', input('expectedClose', { type: 'date' }))}</div>
    ${field('Next step', input('nextStep', { value: 'Qualify: need, budget, timeline' }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Create lead</button></div></form>` });
}

export function activityModal(v: View, o: { deals: Deal[]; kind: string }): Raw {
  return modal({ title: 'Log an activity', body: html`<form class="form" data-ajax data-gps action="/activities">
    ${field('Deal', select('dealId', o.deals.map((d) => ({ value: d.id, label: `${d.customer_name} · ${d.title || d.id} (${STAGE_LABEL[d.stage]})` })), { blank: 'Not linked to a deal' }))}
    ${chips('kind', [{ value: 'call', label: '📞 Call' }, { value: 'visit', label: '📍 Visit' }, { value: 'demo', label: '🖥 Demo' }, { value: 'email', label: '✉️ Email' }], o.kind || 'call')}
    ${field('Notes', textarea('notes', { rows: 3, required: true, placeholder: 'Who you met, what was agreed, what is next' }))}
    ${field('Outcome', select('outcome', lists.options('sales.outcomes')))}
    <div class="row between"><span class="small muted">Visits capture your GPS position and distance from the previous visit today.</span><button class="btn btn-primary" type="submit">Save</button></div></form>` });
}

export function customersPage(v: View, o: { customers: (Customer & { deals: number; open_tickets: number; orders: number; owner_name: string | null })[]; q: string; canWrite: boolean }): Raw {
  return page(v, { title: 'Customers', subtitle: `${o.customers.length} customers`, actions: html`<form method="get" action="/customers" class="row"><input class="input" name="q" value="${o.q}" placeholder="Search" style="min-height:36px;width:200px"></form>${when(o.canWrite, button('New lead', { modal: '/pipeline/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`<section class="card">${table(['Customer', 'City', 'Contact', 'Owner', 'Deals', 'Open tickets', 'Orders'], o.customers.map((c) => [html`<a href="/customers/${c.id}"><b>${c.name}</b></a>`, c.city, html`${c.contact_name}<br><span class="xs muted">${c.phone}</span>`, c.owner_name || '—', c.deals, c.open_tickets ? pill(c.open_tickets, 'warn') : '0', c.orders]), { emptyText: 'No customers yet. Create a lead to add one.' })}</section>` });
}

export function customerPage(v: View, o: { c: Customer; deals: Deal[]; tickets: TicketView[]; orders: WorkOrder[]; activities: Activity[] }): Raw {
  return page(v, { title: o.c.name, subtitle: html`${o.c.city} · ${o.c.segment || 'segment not set'} · ${o.c.contact_name} ${o.c.phone} ${o.c.email}`, actions: button('Customers', { href: '/customers', kind: 'ghost' }),
    body: html`<div class="cols"><div class="col-main">
      <section class="card"><h2>Deals</h2>${table(['Deal', 'Stage', 'Value', 'Owner', 'Updated'], o.deals.map((d) => [html`<a href="/deals/${d.id}">${d.title || d.id}</a>`, pill(STAGE_LABEL[d.stage], d.stage === 'won' ? 'good' : d.stage === 'lost' ? 'crit' : 'accent'), money(d.value, d.currency), d.owner_name, fmtDate(d.updated_at)]), { emptyText: 'No deals.' })}</section>
      <section class="card"><h2>Tickets</h2>${table(['Ticket', 'Subject', 'Priority', 'Status', 'Raised'], o.tickets.map((t) => [html`<a href="/tickets/${t.id}">${t.id}</a>`, t.subject, t.priority, t.status.replace('_', ' '), fmtDate(t.created_at)]), { emptyText: 'No tickets.' })}</section>
      <section class="card"><h2>Work orders</h2>${table(['Order', 'Product', 'Stage', 'Promised'], o.orders.map((w) => [html`<a href="/work-orders/${w.id}">${w.id}</a>`, `${w.product} × ${w.qty}`, w.stage.replace('_', ' '), fmtDate(w.promised_date)]), { emptyText: 'No orders.' })}</section>
    </div><div class="col-side"><section class="card"><h2>Recent activity</h2><div style="margin-top:8px">${timeline(o.activities.slice(0, 12).map((a) => ({ at: fmtDateTime(a.at), who: a.actor_name, text: `${a.kind}: ${a.notes}` })))}</div></section></div></div>` });
}

export { notice, icon, LOST_REASONS };
