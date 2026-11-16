import { html, when, type Raw } from '../../lib/html.ts';
import { page, drawer, modal, type View } from '../layout.ts';
import { icon, pill, avatar, empty, statCard, field, input, textarea, select, button, timeline, chips } from '../components.ts';
import { WO_LABEL, type WorkOrder, type WoStage } from '../../modules/production/service.ts';
import type { Employee } from '../../modules/people/model.ts';
import type { Customer } from '../../modules/sales/service.ts';
import { fmtDate, fmtDateTime, relativeAge, daysBetween } from '../../lib/time.ts';
import { timeBlock } from './ops.ts';
import type { TimeLog, ProcItem } from '../../modules/ops/service.ts';

const T = {
  en: { title: 'Production', board: 'Work orders by stage', late: 'Late', dueToday: 'Due today', queue: 'In queue', wip: 'In production', onTime: 'On-time dispatch (30 d)', newOrder: 'New work order', move: 'Move to', dispatchNeeds: 'Dispatch needs invoice number, courier and consignment. A photo of the packed goods is optional but recommended.', promised: 'Promised', customer: 'Customer', qty: 'Qty', notes: 'Notes', photo: 'Photo of packed goods', invoice: 'Invoice number', courier: 'Courier', consignment: 'Consignment number', confirm: 'Confirm', history: 'History', assignee: 'Assigned to', lead: 'Lead time', days: 'days', qc: 'QC result', pass: 'Pass', rework: 'Rework', reject: 'Reject', openLate: 'Late orders', all: 'All', mine: 'Mine', design: 'Design request' },
  hi: { title: 'उत्पादन', board: 'चरण के अनुसार वर्क ऑर्डर', late: 'देर', dueToday: 'आज देना है', queue: 'कतार में', wip: 'उत्पादन में', onTime: 'समय पर डिस्पैच (30 दिन)', newOrder: 'नया वर्क ऑर्डर', move: 'आगे बढ़ाएँ', dispatchNeeds: 'डिस्पैच के लिए इनवॉइस नंबर, कूरियर और कंसाइनमेंट नंबर ज़रूरी हैं। पैक किए माल की फ़ोटो लगाएँ।', promised: 'वादा तारीख़', customer: 'ग्राहक', qty: 'मात्रा', notes: 'नोट', photo: 'पैक माल की फ़ोटो', invoice: 'इनवॉइस नंबर', courier: 'कूरियर', consignment: 'कंसाइनमेंट नंबर', confirm: 'पक्का करें', history: 'इतिहास', assignee: 'ज़िम्मेदार', lead: 'लीड टाइम', days: 'दिन', qc: 'जाँच नतीजा', pass: 'पास', rework: 'दोबारा', reject: 'रिजेक्ट', openLate: 'देर वाले ऑर्डर', all: 'सभी', mine: 'मेरे', design: 'डिज़ाइन अनुरोध' }
};
export type Lang = keyof typeof T;
export function t(lang: Lang, key: keyof typeof T['en']): string { return T[lang][key]; }

export interface ProductionData { now: Date; orders: WorkOrder[]; stages: WoStage[]; filter: { late: boolean; mine: boolean }; stats: { queue: number; wip: number; late: number; dueToday: number; onTime: number | null }; canWrite: boolean; canExport: boolean }

export function woCard(w: WorkOrder, lang: Lang, now: Date): Raw {
  const today = now.toISOString().slice(0, 10);
  const late = !!w.promised_date && w.promised_date < today && !['dispatched', 'delivered'].includes(w.stage);
  const dueToday = w.promised_date === today && !['dispatched', 'delivered'].includes(w.stage);
  return html`<a class="kcard ${late ? 'kcard-p1' : dueToday ? 'kcard-stale' : ''}" href="/work-orders/${w.id}" data-drawer="/work-orders/${w.id}" style="text-decoration:none;color:inherit">
    <div class="row between"><span class="xs faint mono">${w.id}</span>${w.kind === 'design_request' ? pill(t(lang, 'design'), 'violet') : late ? pill(`${t(lang, 'late')} ${daysBetween(w.promised_date!, now)} ${t(lang, 'days')}`, 'crit') : dueToday ? pill(t(lang, 'dueToday'), 'warn') : pill(fmtDate(w.promised_date), 'ink')}</div>
    <div class="kcard-title" style="font-size:15px">${w.product} <span class="muted">× ${w.qty}</span></div>
    <div class="small muted">${w.customer_name || '—'}</div>
    <div class="row between">${avatar(w.assignee_name, w.assignee_id || '')}${when(w.photo_path, icon('camera', 16, 'faint'))}</div>
  </a>`;
}

export function productionPage(v: View, d: ProductionData): Raw {
  const lang = v.lang;
  return page(v, {
    title: t(lang, 'title'), autoRefresh: 180, subtitle: html`${d.stats.queue} ${t(lang, 'queue').toLowerCase()} · ${d.stats.wip} ${t(lang, 'wip').toLowerCase()} · ${d.stats.late ? html`<b class="c-crit">${d.stats.late} ${t(lang, 'late').toLowerCase()}</b>` : html`<b class="c-good">0 ${t(lang, 'late').toLowerCase()}</b>`}`,
    actions: html`<div class="lang"><button type="button" class="${lang === 'en' ? 'on' : ''}" data-lang="en">English</button><button type="button" class="${lang === 'hi' ? 'on' : ''}" data-lang="hi">हिन्दी</button></div>${when(d.canExport, button('Excel', { href: '/exports/production.xlsx', icon: 'download' }))}${when(d.canWrite, button(t(lang, 'newOrder'), { modal: '/production/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`
      <div class="grid grid-4">${statCard({ href: '/production?late=1', value: d.stats.late, label: t(lang, 'openLate'), tone: d.stats.late ? 'crit' : 'good' })}${statCard({ value: d.stats.dueToday, label: t(lang, 'dueToday'), tone: d.stats.dueToday ? 'warn' : 'neutral' })}${statCard({ value: d.stats.wip, label: t(lang, 'wip'), tone: 'accent' })}${statCard({ value: d.stats.onTime === null ? '—' : `${d.stats.onTime}%`, label: t(lang, 'onTime'), tone: d.stats.onTime === null ? 'neutral' : d.stats.onTime >= 95 ? 'good' : d.stats.onTime >= 85 ? 'warn' : 'crit' })}</div>
      <div class="filters"><a class="chip ${!d.filter.late && !d.filter.mine ? 'on' : ''}" href="/production">${t(lang, 'all')}</a><a class="chip ${d.filter.mine ? 'on' : ''}" href="/production?mine=1">${t(lang, 'mine')}</a><a class="chip ${d.filter.late ? 'on' : ''}" href="/production?late=1">${t(lang, 'late')}</a></div>
      <div class="board-wrap"><div class="board" style="grid-template-columns:repeat(${d.stages.length},minmax(200px,1fr))">${d.stages.map((st) => { const items = d.orders.filter((w) => w.stage === st); return html`<div class="column ${st === 'in_production' ? 'column-accent' : st === 'dispatched' || st === 'delivered' ? 'column-good' : ''}"><div class="column-head"><span>${WO_LABEL[st][lang]}</span><span class="count">${items.length}</span></div>${items.length ? items.map((w) => woCard(w, lang, d.now)) : empty('—', '·')}</div>`; })}</div></div>`
  });
}

export interface WoDetail { w: WorkOrder; stages: WoStage[]; history: { at: string; who: string | null; text: string }[]; canWrite: boolean; now: Date; people: Employee[]; qcEnabled: boolean; time: { logs: TimeLog[]; minutes: number; running: TimeLog | undefined }; procurement: ProcItem[] }

function woBody(v: View, x: WoDetail): Raw {
  const lang = v.lang, w = x.w;
  const idx = x.stages.indexOf(w.stage);
  const next = x.stages[idx + 1];
  const today = x.now.toISOString().slice(0, 10);
  const late = !!w.promised_date && w.promised_date < today && !['dispatched', 'delivered'].includes(w.stage);
  return html`
    <div class="row" style="gap:8px">${pill(WO_LABEL[w.stage][lang], w.stage === 'dispatched' || w.stage === 'delivered' ? 'good' : 'accent')}${when(late, pill(`${t(lang, 'late')} ${daysBetween(w.promised_date!, x.now)} ${t(lang, 'days')}`, 'crit'))}${when(w.qc_result, pill(`QC: ${w.qc_result}`, w.qc_result === 'pass' ? 'good' : 'warn'))}</div>
    <div class="kv"><div><span>${t(lang, 'customer')}</span><b>${w.customer_name || '—'}</b></div><div><span>${t(lang, 'qty')}</span><b class="num">${w.qty}</b></div><div><span>${t(lang, 'promised')}</span><b class="${late ? 'c-crit' : ''}">${fmtDate(w.promised_date)}</b><span class="small">${t(lang, 'lead')} ${w.lead_time_days} ${t(lang, 'days')}</span></div>
      <div><span>${t(lang, 'assignee')}</span><b>${w.assignee_name || '—'}</b></div><div><span>${t(lang, 'invoice')}</span><b>${w.invoice_ref || '—'}</b></div><div><span>${t(lang, 'courier')}</span><b>${w.courier || '—'}</b><span class="small">${w.consignment}</span></div></div>
    ${when(w.notes, () => html`<p class="small" style="white-space:pre-wrap">${w.notes}</p>`)}
    ${when(w.photo_path, () => html`<a href="/uploads/${w.photo_path}" target="_blank"><img src="/uploads/${w.photo_path}" alt="Packed goods" style="max-width:100%;border-radius:12px;border:1px solid var(--line)"></a>`)}
    ${when(w.stage === 'queued' || w.stage === 'in_production', () => html`<div class="card" style="padding:14px 16px;background:var(--soft)"><div class="row between"><div><b>${lang === 'hi' ? 'सामग्री' : 'Materials'}</b><br><span class="small muted">${w.materials_status === 'ready' ? (lang === 'hi' ? 'सब तैयार' : 'All materials available') : w.materials_status === 'short' ? (lang === 'hi' ? 'कमी: ' : 'Short: ') + (w.materials_note || '') : (lang === 'hi' ? 'जाँच बाकी' : 'Not checked yet')}${when(x.procurement.length, () => html` · ${x.procurement.filter((p) => p.status === 'received').length}/${x.procurement.length} items received`)}</span></div>
      ${when(x.canWrite, () => html`<span class="row" style="gap:6px">${pill(w.materials_status, w.materials_status === 'ready' ? 'good' : w.materials_status === 'short' ? 'crit' : 'warn')}${button(lang === 'hi' ? 'तैयार' : 'Ready', { post: `/work-orders/${w.id}/materials`, body: { status: 'ready' }, size: 'sm', kind: 'good' })}${button(lang === 'hi' ? 'कमी' : 'Short', { post: `/work-orders/${w.id}/materials`, body: { status: 'short' }, size: 'sm', prompt: lang === 'hi' ? 'क्या कम है?' : 'What is short?' })}${button(lang === 'hi' ? 'खरीद' : 'Buy', { modal: `/procurement/new?wo=${w.id}`, size: 'sm' })}</span>`)}</div></div>`)}
    ${timeBlock(v, { entityType: 'work_order', entityId: w.id, logs: x.time.logs, minutes: x.time.minutes, running: x.time.running, planned: w.planned_hours, canLog: x.canWrite })}
    ${when(x.canWrite && next, () => html`<div class="card" style="padding:14px 16px;background:var(--soft)"><h3>${t(lang, 'move')}: ${WO_LABEL[next!][lang]}</h3>
      ${next === 'dispatched' ? html`<form class="form" data-ajax action="/work-orders/${w.id}/move" style="margin-top:10px"><input type="hidden" name="stage" value="dispatched"><p class="small muted">${t(lang, 'dispatchNeeds')}</p>
        <div class="grid grid-3">${field(t(lang, 'invoice'), input('invoiceRef', { value: w.invoice_ref, required: true }))}${field(t(lang, 'courier'), input('courier', { value: w.courier, required: true }))}${field(t(lang, 'consignment'), input('consignment', { value: w.consignment, required: true }))}</div>
        ${field(t(lang, 'photo'), html`<input class="input" type="file" name="photo" accept="image/*" capture="environment" style="padding:8px">`)}
        <button class="btn btn-good btn-lg" type="submit">${icon('truck', 18)} ${t(lang, 'confirm')}: ${WO_LABEL.dispatched[lang]}</button></form>`
      : next === 'qc' ? html`<form class="form" data-ajax action="/work-orders/${w.id}/move" style="margin-top:10px"><input type="hidden" name="stage" value="qc">${chips('qcResult', [{ value: 'pass', label: '✅ ' + t(lang, 'pass') }, { value: 'rework', label: '🔁 ' + t(lang, 'rework') }, { value: 'reject', label: '❌ ' + t(lang, 'reject') }], 'pass')}${field(t(lang, 'notes'), textarea('notes', { rows: 2 }))}<button class="btn btn-primary btn-lg" type="submit">${t(lang, 'confirm')}</button></form>`
      : html`<form class="form" data-ajax action="/work-orders/${w.id}/move" style="margin-top:10px"><input type="hidden" name="stage" value="${next}">${field(t(lang, 'notes'), textarea('notes', { rows: 2 }))}<button class="btn btn-primary btn-lg" type="submit">${icon('arrow', 18)} ${WO_LABEL[next!][lang]}</button></form>`}
      </div>
      ${when(x.canWrite, () => html`<form class="row" data-ajax action="/work-orders/${w.id}/assign">${select('assigneeId', x.people.map((p) => ({ value: p.id, label: p.full_name, selected: p.id === w.assignee_id })), { blank: '—' })}<button class="btn" type="submit">${t(lang, 'assignee')}</button></form>`)}`)}
    <div><h3>${t(lang, 'history')}</h3><div style="margin-top:8px">${timeline(x.history.map((h) => ({ at: fmtDateTime(h.at), who: h.who, text: h.text })))}</div></div>`;
}

export function woDrawer(v: View, x: WoDetail): Raw {
  return drawer({ title: html`${x.w.product} × ${x.w.qty}`, meta: html`<span class="mono">${x.w.id}</span> · ${x.w.customer_name || ''} · ${relativeAge(x.w.created_at, x.now)}`, href: `/work-orders/${x.w.id}`, body: woBody(v, x) });
}
export function woPage(v: View, x: WoDetail): Raw {
  return page(v, { title: `${x.w.product} × ${x.w.qty}`, docTitle: x.w.id, subtitle: html`<span class="mono">${x.w.id}</span> · ${x.w.customer_name || ''}`, actions: button(t(v.lang, 'title'), { href: '/production', kind: 'ghost' }), body: html`<section class="card stack" style="gap:18px">${woBody(v, x)}</section>` });
}

export function newWoModal(v: View, o: { customers: Customer[]; people: Employee[]; lead: number }): Raw {
  const lang = v.lang;
  return modal({ title: t(lang, 'newOrder'), body: html`<form class="form" data-ajax action="/work-orders">
    ${field(t(lang, 'customer'), select('customerId', o.customers.map((c) => ({ value: c.id, label: `${c.name} · ${c.city}` })), { blank: '—' }))}
    <div class="grid grid-2">${field('Product', input('product', { required: true }))}${field(t(lang, 'qty'), input('qty', { type: 'number', value: 1, min: 1 }))}</div>
    <div class="grid grid-3">${field('Type', select('kind', [{ value: 'order', label: 'Order' }, { value: 'design_request', label: t(lang, 'design') }]))}${field(`${t(lang, 'lead')} (${t(lang, 'days')})`, input('leadTimeDays', { type: 'number', value: o.lead, min: 1 }))}${field(t(lang, 'promised'), input('promisedDate', { type: 'date' }))}</div>
    ${field(t(lang, 'assignee'), select('assigneeId', o.people.map((p) => ({ value: p.id, label: p.full_name })), { blank: 'Auto (team lead / engineer)' }))}
    ${field(t(lang, 'notes'), textarea('notes', { rows: 2 }))}
    <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">${t(lang, 'confirm')}</button></div></form>` });
}
