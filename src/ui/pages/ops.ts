import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, empty, statCard, field, input, textarea, select, button, table, bar, timeline } from '../components.ts';
import type { PreviewRow, ImportEntity } from '../../modules/imports/service.ts';
import { ENTITIES } from '../../modules/imports/service.ts';
import type { ProcItem, ForecastLine, BudgetLine, TravelRow, TimeLog } from '../../modules/ops/service.ts';
import type { Department } from '../../modules/people/model.ts';
import type { WorkOrder } from '../../modules/production/service.ts';
import type { Deal } from '../../modules/sales/service.ts';
import { fmtDate, fmtDateTime, inr, fmtDuration } from '../../lib/time.ts';

// ---------- Imports ----------
export function importsPage(v: View, o: { history: { id: number; entity: string; filename: string; status: string; created_at: string; result: string | null; by: string | null; n: number }[] }): Raw {
  return page(v, { title: 'Import data', subtitle: 'Bring your real customers, leads, tickets and work orders in from Excel or CSV. Download the template, fill it, upload, check the preview, confirm.',
    body: html`<div class="grid grid-2">${(Object.keys(ENTITIES) as ImportEntity[]).map((k) => { const d = ENTITIES[k]; return html`<section class="card stack"><div><h2>${d.title}</h2><p class="small muted" style="margin-top:4px">${d.description}</p></div>
      <div class="row" style="gap:8px">${button('Template', { href: `/imports/${k}/template.xlsx`, icon: 'download', size: 'sm' })}<span class="xs faint">Columns: ${d.columns.map((c) => c.label + (c.required ? '*' : '')).join(', ')}</span></div>
      <form class="form" data-ajax action="/imports/${k}">${field('Your file (.xlsx or .csv)', html`<input class="input" type="file" name="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required style="padding:8px">`)}<button class="btn btn-primary" type="submit">${icon('arrow', 16)} Upload and preview</button></form></section>`; })}</div>
      ${when(o.history.length, () => html`<section class="card"><h2>Recent imports</h2>${table(['When', 'Type', 'File', 'Rows', 'Status', 'By'], o.history.map((h) => [fmtDateTime(h.created_at), ENTITIES[h.entity as ImportEntity]?.title || h.entity, h.filename, h.n, h.status === 'committed' ? pill(`Done ${h.result ? JSON.parse(h.result).created + ' created' : ''}`, 'good') : html`<a href="/imports/preview/${h.id}">${pill('Preview', 'warn')}</a>`, h.by || '']))}</section>`)}
      <section class="card"><h2>Tips</h2><ul class="small muted" style="margin:8px 0 0 18px;line-height:1.7"><li>Header names are matched loosely ("Customer", "Company", "Party name" all work); unknown columns are ignored.</li><li>Dates as YYYY-MM-DD, dd/mm/yyyy or Excel dates. Amounts may contain ₹ and commas.</li><li>Owner and assignee columns take the work email as in LoyalFlow; unknown emails are left blank, not rejected.</li><li>Rows with errors are skipped; everything else is imported. You can re-upload the corrected rows.</li><li>Tally: Gateway of Tally → Display → List of Accounts → Export as Excel, then keep the name and address columns.</li></ul></section>` });
}

export function importPreviewPage(v: View, o: { id: number; entity: ImportEntity; filename: string; rows: PreviewRow[]; valid: number; invalid: number; committed?: { created: number; updated: number; skipped: number } | null }): Raw {
  const def = ENTITIES[o.entity];
  const cols = def.columns.filter((c) => o.rows.some((r) => r.data[c.key]));
  return page(v, { title: `Preview: ${def.title}`, subtitle: html`${o.filename} · <b class="c-good">${o.valid} ready</b>${when(o.invalid, () => html` · <b class="c-crit">${o.invalid} with errors (will be skipped)</b>`)}`,
    actions: html`${button('Back', { href: '/imports', kind: 'ghost' })}${when(!o.committed && o.valid > 0, () => button(`Import ${o.valid} rows`, { post: `/imports/preview/${o.id}/commit`, kind: 'good', icon: 'check', confirm: `Import ${o.valid} rows into LoyalFlow? This cannot be undone automatically.` }))}`,
    body: html`${when(o.committed, () => html`<div class="notice notice-good">${icon('check')}<div><b>Imported.</b> ${o.committed!.created} created, ${o.committed!.updated} updated, ${o.committed!.skipped} skipped.</div></div>`)}
      <section class="card"><div class="table-wrap"><table><thead><tr><th>Row</th><th>Check</th>${cols.map((c) => html`<th>${c.label}</th>`)}</tr></thead><tbody>${o.rows.map((r) => html`<tr style="${r.errors.length ? 'background:var(--crit-soft)' : ''}"><td>${r.n}</td><td>${r.errors.length ? r.errors.map((e) => pill(e, 'crit')) : r.warnings.length ? r.warnings.map((w) => pill(w, 'warn')) : pill('OK', 'good')}</td>${cols.map((c) => html`<td>${r.data[c.key] || ''}</td>`)}</tr>`)}</tbody></table></div></section>` });
}

// ---------- Procurement ----------
export interface ProcurementData { items: ProcItem[]; forecast: { lines: ForecastLine[]; weightedValue: number; firmValue: number; byMonth: { month: string; firm: number; weighted: number }[] }; shortOrders: WorkOrder[]; canWrite: boolean; tab: string }

export function procurementPage(v: View, d: ProcurementData): Raw {
  const open = d.items.filter((i) => i.status === 'planned' || i.status === 'ordered');
  const late = open.filter((i) => i.needed_by && i.needed_by < new Date().toISOString().slice(0, 10));
  const tabs = [{ key: 'items', label: `Items (${open.length})` }, { key: 'forecast', label: 'Forecast from pipeline' }, { key: 'materials', label: `Material check (${d.shortOrders.length})` }];
  return page(v, { title: 'Procurement', subtitle: 'What the factory needs to buy, when, and what the pipeline says is coming.',
    actions: when(d.canWrite, () => button('Add item', { modal: '/procurement/new', kind: 'primary', icon: 'plus' })),
    body: html`<div class="grid grid-4">${statCard({ value: open.length, label: 'Open items', tone: 'accent' })}${statCard({ value: late.length, label: 'Past needed-by date', tone: late.length ? 'crit' : 'good' })}${statCard({ value: inr(d.forecast.firmValue), label: 'Firm orders queued', tone: 'neutral', sub: 'won, not yet started' })}${statCard({ value: inr(d.forecast.weightedValue), label: 'Weighted pipeline, 90 days', tone: 'neutral', sub: 'qualified and beyond' })}</div>
      <div class="tabs">${tabs.map((t) => html`<a href="/procurement?tab=${t.key}" class="${d.tab === t.key ? 'active' : ''}">${t.label}</a>`)}</div>
      ${d.tab === 'forecast' ? html`<section class="card"><div class="card-head"><h2>Demand, next 90 days</h2><span class="small muted">Deals from Qualified onward weighted by win chance, plus queued work orders</span></div>
          <div class="grid grid-4" style="margin:12px 0">${d.forecast.byMonth.map((m) => html`<div class="tile" style="pointer-events:none"><span class="tile-label">${m.month}</span><span class="tile-value num" style="font-size:20px">${inr(m.firm + m.weighted)}</span><span class="tile-delta muted">firm ${inr(m.firm)} · weighted ${inr(m.weighted)}</span></div>`)}</div>
          ${table(['Type', 'Customer', 'Product', 'Qty', 'Stage', 'Chance', 'Value', 'Weighted', 'Expected', 'Owner', ''], d.forecast.lines.map((l) => [l.kind === 'order' ? pill('Order', 'good') : pill('Deal', 'accent'), l.customer, l.product, l.qty, l.stage, `${l.chance}%`, inr(l.value), html`<b class="num">${inr(l.weighted)}</b>`, l.expected ? fmtDate(l.expected) : '—', l.owner, when(d.canWrite, () => button('Plan item', { modal: `/procurement/new?${l.kind === 'order' ? 'wo' : 'deal'}=${l.id}&item=${encodeURIComponent(l.product)}&qty=${l.qty}`, size: 'sm' }))]), { emptyText: 'Nothing qualified in the pipeline yet.' })}</section>`
      : d.tab === 'materials' ? html`<section class="card"><div class="card-head"><h2>Work orders needing a material check</h2><span class="small muted">Queued orders not marked ready</span></div>
          ${table(['Order', 'Product', 'Customer', 'Promised', 'Materials', 'Note', ''], d.shortOrders.map((w) => [html`<a href="/work-orders/${w.id}" data-drawer="/work-orders/${w.id}">${w.id}</a>`, `${w.product} × ${w.qty}`, w.customer_name || '', fmtDate(w.promised_date), pill((w as WorkOrder & { materials_status?: string }).materials_status || 'unchecked', ((w as WorkOrder & { materials_status?: string }).materials_status === 'short' ? 'crit' : 'warn')), (w as WorkOrder & { materials_note?: string }).materials_note || '', when(d.canWrite, () => html`<span class="row" style="gap:4px">${button('Ready', { post: `/work-orders/${w.id}/materials`, body: { status: 'ready' }, size: 'sm', kind: 'good' })}${button('Short', { post: `/work-orders/${w.id}/materials`, body: { status: 'short' }, size: 'sm', confirm: undefined })}</span>`)]), { emptyText: 'Every queued order has its materials.' })}</section>`
      : html`<section class="card">${table(['Item', 'Qty', 'Needed by', 'Supplier', 'Est. cost', 'For', 'Status', ''], d.items.map((i) => { const lateItem = i.needed_by && i.needed_by < new Date().toISOString().slice(0, 10) && i.status !== 'received'; return [html`<b>${i.item}</b>${when(i.notes, () => html`<br><span class="xs muted">${i.notes}</span>`)}`, `${i.qty} ${i.unit}`, html`<span class="${lateItem ? 'c-crit' : ''}">${i.needed_by ? fmtDate(i.needed_by) : '—'}</span>`, i.supplier || '—', inr(i.est_cost), i.work_order_id ? html`<a href="/work-orders/${i.work_order_id}">${i.work_order_id}</a> ${i.wo_product || ''}` : i.deal_id ? html`<a href="/deals/${i.deal_id}">${i.deal_customer || i.deal_id}</a>` : '—', pill(i.status + (i.expected_at && i.status === 'ordered' ? ` · ${fmtDate(i.expected_at)}` : ''), i.status === 'received' ? 'good' : i.status === 'ordered' ? 'accent' : i.status === 'cancelled' ? 'ink' : 'warn'), when(d.canWrite && i.status !== 'received' && i.status !== 'cancelled', () => html`<span class="row" style="gap:4px;flex-wrap:nowrap">${i.status === 'planned' ? button('Ordered', { post: `/procurement/${i.id}/status`, body: { status: 'ordered' }, size: 'sm', title: 'Mark as ordered' }) : ''}${button('Received', { post: `/procurement/${i.id}/status`, body: { status: 'received' }, size: 'sm', kind: 'good' })}${button('Edit', { modal: `/procurement/${i.id}/edit`, size: 'sm', kind: 'ghost' })}</span>`)]; }), { emptyText: 'No procurement items yet. Add one, or plan from the forecast tab.' })}</section>`}` });
}

export function procurementModal(v: View, o: { item: ProcItem | null; orders: WorkOrder[]; deals: Deal[]; prefill: { item?: string; qty?: string; wo?: string; deal?: string } }): Raw {
  const i = o.item;
  return modal({ title: i ? `Edit ${i.id}` : 'Procurement item', body: html`<form class="form" data-ajax action="${i ? `/procurement/${i.id}` : '/procurement'}">
    <div class="grid grid-3">${field('Item', input('item', { value: i?.item || o.prefill.item || '', required: true }))}${field('Qty', input('qty', { type: 'number', value: i?.qty ?? (o.prefill.qty || 1), min: 0, step: 'any' }))}${field('Unit', input('unit', { value: i?.unit || 'pcs' }))}</div>
    <div class="grid grid-3">${field('Needed by', input('neededBy', { type: 'date', value: i?.needed_by || '' }))}${field('Supplier', input('supplier', { value: i?.supplier || '' }))}${field('Estimated cost (₹)', input('estCost', { type: 'number', value: i?.est_cost ?? 0, min: 0 }))}</div>
    <div class="grid grid-2">${field('For work order', select('workOrderId', o.orders.map((w) => ({ value: w.id, label: `${w.id} · ${w.product} (${w.customer_name || ''})`, selected: w.id === (i?.work_order_id || o.prefill.wo) })), { blank: '—' }))}${field('For deal', select('dealId', o.deals.map((d) => ({ value: d.id, label: `${d.customer_name} · ${d.title || d.id}`, selected: d.id === (i?.deal_id || o.prefill.deal) })), { blank: '—' }))}</div>
    ${field('Notes', textarea('notes', { value: i?.notes || '', rows: 2 }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save</button></div></form>` });
}

// ---------- Budgets ----------
export function budgetsPage(v: View, o: { lines: BudgetLine[]; fy: string; fys: string[]; canSet: boolean; departments: Department[] }): Raw {
  const total = o.lines.reduce((n, l) => n + l.amount, 0), spent = o.lines.reduce((n, l) => n + l.spent, 0);
  return page(v, { title: 'Budgets', subtitle: html`${o.fy} · ${inr(spent)} spent of ${inr(total)} across departments (approved expenses and purchases)`,
    actions: html`<form method="get" action="/budgets"><select class="input" name="fy" data-autosubmit style="min-height:36px;width:auto">${o.fys.map((f) => html`<option value="${f}" ${when(f === o.fy, 'selected')}>${f}</option>`)}</select></form>`,
    body: html`<section class="card">${table(['Department', 'Budget', 'Spent', 'Waiting approval', 'Remaining', 'Used', ''], o.lines.map((l) => [html`<b>${l.department}</b>${when(l.notes, () => html`<br><span class="xs muted">${l.notes}</span>`)}`, inr(l.amount), inr(l.spent), inr(l.committed), html`<b class="num ${l.remaining < 0 ? 'c-crit' : ''}">${inr(l.remaining)}</b>`, html`<div style="min-width:120px">${bar(l.pct, l.pct === null ? 'neutral' : l.pct > 100 ? 'crit' : l.pct > 85 ? 'warn' : 'good')}<span class="xs muted">${l.pct === null ? 'no budget' : `${l.pct}%`}</span></div>`, when(o.canSet, () => button('Set', { modal: `/budgets/${l.department_id}/edit?fy=${o.fy}`, size: 'sm' }))]))}</section>
      <p class="xs faint">Spent = approved expense claims and purchase requests from people in the department in the fiscal year. Approvers see the remaining budget on each request.</p>` });
}

export function budgetModal(v: View, o: { dept: Department; fy: string; line: BudgetLine | undefined }): Raw {
  return modal({ title: `${o.dept.name} budget, ${o.fy}`, body: html`<form class="form" data-ajax action="/budgets/${o.dept.id}"><input type="hidden" name="fy" value="${o.fy}">
    ${field('Annual budget (₹)', input('amount', { type: 'number', value: o.line?.amount ?? 0, min: 0, step: 1000, required: true }))}${field('Notes', textarea('notes', { value: o.line?.notes || '', rows: 2, placeholder: 'What it covers' }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save budget</button></div></form>` });
}

// ---------- Travel ----------
export function travelPage(v: View, o: { rows: TravelRow[]; ratePerKm: number; from: string; to: string; visits: { at: string; actor_name?: string; notes: string; km: number; lat: number | null; lng: number | null; deal_id: string | null }[] }): Raw {
  const tot = o.rows.reduce((a, r) => ({ visits: a.visits + r.visits, km: a.km + r.km, cost: a.cost + r.estCost, claimed: a.claimed + r.claimed, won: a.won + r.wonValue }), { visits: 0, km: 0, cost: 0, claimed: 0, won: 0 });
  return page(v, { title: 'Sales travel', subtitle: html`${fmtDate(o.from)} – ${fmtDate(o.to)} · ${tot.visits} visits · ${Math.round(tot.km)} km · est. ${inr(tot.cost)} at ₹${o.ratePerKm}/km · claimed ${inr(tot.claimed)} · won ${inr(tot.won)}`,
    actions: html`<form method="get" action="/travel" class="row">${input('from', { type: 'date', value: o.from })}${input('to', { type: 'date', value: o.to })}<button class="btn" type="submit">Show</button></form>${button('Excel', { href: `/exports/travel.xlsx?from=${o.from}&to=${o.to}`, icon: 'download' })}`,
    body: html`<section class="card"><div class="card-head"><h2>By person</h2><span class="small muted">Sales impact = deals won in the period by the same person</span></div>
      ${table(['Person', 'Visits', 'Km', 'Est. travel cost', 'Claimed', 'Won (count)', 'Won value', 'Open pipeline', 'Cost per ₹1 L won'], o.rows.map((r) => [html`<a href="/people/${r.employee_id}">${r.name}</a>`, r.visits, r.km, inr(r.estCost), inr(r.claimed), r.wonDeals, html`<b class="num">${inr(r.wonValue)}</b>`, inr(r.openValue), r.wonValue ? inr(Math.max(r.claimed, r.estCost) / (r.wonValue / 100000)) : '—']), { emptyText: 'No visits logged in this period.' })}</section>
      <section class="card"><h2>Visits</h2><div style="margin-top:8px">${timeline(o.visits.slice(0, 60).map((a) => ({ at: fmtDateTime(a.at), who: a.actor_name, text: html`${a.notes || 'Visit'}${when(a.km, () => html` · ${a.km} km`)}${when(a.lat, () => html` · <a href="https://maps.google.com/?q=${a.lat},${a.lng}" target="_blank" rel="noopener">map</a>`)}${when(a.deal_id, () => html` · <a href="/deals/${a.deal_id}">${a.deal_id}</a>`)}` })))}</div></section>` });
}

// ---------- Time ----------
export function timeBlock(v: View, o: { entityType: string; entityId: string; logs: TimeLog[]; minutes: number; running: TimeLog | undefined; planned?: number | null; canLog: boolean }): Raw {
  const runningHere = o.running && o.running.entity_type === o.entityType && o.running.entity_id === o.entityId;
  return html`<div class="card" style="padding:14px 16px;background:var(--soft)"><div class="row between"><div><b>Man-hours</b><br><span class="small muted">${fmtDuration(o.minutes)} logged${when(o.planned, () => html` of ${o.planned} h planned`)}</span></div>
    ${when(o.canLog, () => html`<span class="row" style="gap:6px">${runningHere ? button('Stop timer', { post: '/time/stop', kind: 'dark', icon: 'clock' }) : button('Start timer', { post: '/time/start', body: { entityType: o.entityType, entityId: o.entityId }, icon: 'clock' })}${button('Log hours', { modal: `/time/log?entityType=${o.entityType}&entityId=${o.entityId}`, size: '' })}</span>`)}</div>
    ${when(o.logs.length, () => html`<ul class="list" style="margin-top:8px">${o.logs.slice(0, 8).map((l) => html`<li style="padding:6px 0"><span style="flex:1;font-size:13px">${l.employee_name}${when(l.note, () => html` · <span class="muted">${l.note}</span>`)}</span><span class="small muted">${fmtDate(l.started_at)}</span><b class="num small">${l.ended_at ? fmtDuration(l.minutes) : 'running'}</b></li>`)}</ul>`)}</div>`;
}

export function timeLogModal(v: View, o: { entityType: string; entityId: string; label: string; people: { id: string; name: string }[] }): Raw {
  return modal({ title: `Log hours on ${o.label}`, body: html`<form class="form" data-ajax action="/time/log"><input type="hidden" name="entityType" value="${o.entityType}"><input type="hidden" name="entityId" value="${o.entityId}">
    <div class="grid grid-2">${field('Hours', input('hours', { type: 'number', min: 0.25, step: 0.25, required: true, value: 1 }))}${when(o.people.length > 1, () => field('For', select('employeeId', o.people.map((p) => ({ value: p.id, label: p.name, selected: p.id === v.user.id })))))}</div>
    ${field('What was done', input('note', { placeholder: 'Assembly, testing, design…' }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save</button></div></form>` });
}

export function hoursPage(v: View, o: { rows: { employee_id: string; name: string; minutes: number; entries: number }[]; from: string; to: string; byEntity: { entity_type: string; entity_id: string; label: string; minutes: number }[] }): Raw {
  const total = o.rows.reduce((n, r) => n + r.minutes, 0);
  return page(v, { title: 'Man-hours', subtitle: html`${fmtDate(o.from)} – ${fmtDate(o.to)} · ${fmtDuration(total)} logged by ${o.rows.length} people`,
    actions: html`<form method="get" action="/hours" class="row">${input('from', { type: 'date', value: o.from })}${input('to', { type: 'date', value: o.to })}<button class="btn" type="submit">Show</button></form>${button('Excel', { href: `/exports/hours.xlsx?from=${o.from}&to=${o.to}`, icon: 'download' })}`,
    body: html`<div class="cols"><section class="card col-main"><h2>By person</h2>${table(['Person', 'Hours', 'Entries', 'Share'], o.rows.map((r) => [html`<a href="/people/${r.employee_id}">${r.name}</a>`, html`<b class="num">${fmtDuration(r.minutes)}</b>`, r.entries, html`<div style="min-width:120px">${bar(total ? (r.minutes / total) * 100 : 0, 'accent')}</div>`]), { emptyText: 'No time logged in this period. Timers live on work orders and tasks.' })}</section>
      <section class="card col-side"><h2>By work item</h2>${table(['Item', 'Hours'], o.byEntity.slice(0, 30).map((e) => [html`<a href="${e.entity_type === 'work_order' ? `/work-orders/${e.entity_id}` : e.entity_type === 'issue' ? `/dev/${e.entity_id}` : '/tasks'}">${e.label}</a>`, fmtDuration(e.minutes)]), { emptyText: '—' })}</section></div>` });
}

export { empty };
