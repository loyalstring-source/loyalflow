// Sales: product catalogue, estimates (builder, view, list) and the page the customer opens.
import { html, raw, when, jsonScript, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { field, input, textarea, select, notice, pill, table, button, empty, statCard } from '../components.ts';
import * as lists from '../../lib/lists.ts';
import { fmtDate, fmtDateTime } from '../../lib/time.ts';
import { STATUS_LABEL, shownStatus, computeTotals, type Product, type Estimate, type EstimateItem, type EstimateSettings } from '../../modules/sales/estimates.ts';

const fmt = (n: number): string => (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A date with its year, for a document that will be read months later. */
const docDate = (d: string | null): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''; };
const cur = (c: string): string => (c === 'INR' ? '₹' : c + ' ');
const tone = (s: string): 'ink' | 'accent' | 'good' | 'crit' | 'warn' => (s === 'accepted' ? 'good' : s === 'declined' ? 'crit' : s === 'expired' ? 'warn' : s === 'sent' || s === 'final' ? 'accent' : 'ink');
export const statusPill = (e: Estimate): Raw => { const s = shownStatus(e); return pill(STATUS_LABEL[s] || s, tone(s)); };
const salesTabs = (active: string): Raw => html`<div class="tabs"><a href="/pipeline">Pipeline</a><a href="/estimates" class="${active === 'estimates' ? 'active' : ''}">Estimates</a><a href="/products" class="${active === 'products' ? 'active' : ''}">Products</a></div>`;
const gstOptions = (current: number) => { const o = lists.options('sales.gstRates', String(current)); return o.map((x) => ({ value: x.value, label: `${x.label}%`, selected: Number(x.value) === Number(current) })); };

// ---------- Products ----------

export function productsPage(v: View, d: { products: Product[]; canManage: boolean; settings: EstimateSettings }): Raw {
  return page(v, {
    title: 'Products', subtitle: 'What you sell, with the picture, unit, price and GST that go on an estimate.',
    actions: when(d.canManage, () => button('Add product', { href: '/products/new', kind: 'primary', icon: 'plus' })),
    body: html`${salesTabs('products')}
      <section class="card">${d.products.length ? html`<div class="list">${d.products.map((p) => html`<div class="list-row" style="gap:14px;align-items:center;${p.active ? '' : 'opacity:.55'}">
        ${p.image_path ? html`<img src="/products/${p.id}/image?v=${encodeURIComponent(p.image_path)}" alt="" style="width:56px;height:56px;object-fit:contain;border:1px solid var(--line);border-radius:8px;background:#fff">` : html`<span style="width:56px;height:56px;border:1px dashed var(--line);border-radius:8px;display:inline-flex;align-items:center;justify-content:center" class="xs muted">No photo</span>`}
        <span style="flex:1;min-width:0"><b>${p.name}</b>${when(!p.active, () => html` ${pill('Not in use', 'ink')}`)}<br><span class="small muted">${p.description ? p.description.slice(0, 110) + (p.description.length > 110 ? '…' : '') : 'No description'}</span></span>
        <span class="small muted" style="white-space:nowrap">${p.hsn ? 'HSN ' + p.hsn + ' · ' : ''}GST ${p.gst_rate}%</span>
        <b class="num" style="white-space:nowrap;min-width:120px;text-align:right">₹${fmt(p.price)} <span class="small muted" style="font-weight:400">/ ${p.unit}</span></b>
        ${when(d.canManage, () => button('Edit', { href: `/products/${p.id}/edit`, size: 'sm' }))}</div>`)}</div>`
        : empty(d.canManage ? 'No products yet. Press Add product to start your list.' : 'No products yet. A sales manager adds them.', '📦')}</section>
      ${when(d.canManage, () => html`<form class="card form" data-ajax action="/estimates/settings" style="max-width:900px"><h2>What is printed on every estimate</h2>
        <div class="grid grid-2">${field('Company name', input('sellerName', { value: d.settings.sellerName, required: true }))}${field('GSTIN', input('gstin', { value: d.settings.gstin, placeholder: '15 characters' }))}</div>
        ${field('Address', textarea('address', { value: d.settings.address, rows: 2 }))}
        <div class="grid grid-3">${field('Phone', input('phone', { value: d.settings.phone }))}${field('Email', input('email', { value: d.settings.email }))}${field('Valid for (days)', input('validityDays', { type: 'number', value: d.settings.validityDays, min: 1, max: 180 }))}</div>
        ${field('Terms and conditions', textarea('terms', { value: d.settings.terms, rows: 4 }), 'Copied onto each new estimate, where it can be changed.')}
        ${field('Bank details (optional)', textarea('bank', { value: d.settings.bank, rows: 2 }))}
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Save</button></div></form>`)}`
  });
}

export function productFormPage(v: View, p: Product | null): Raw {
  return page(v, { title: p ? `Edit ${p.name}` : 'Add product', actions: button('All products', { href: '/products' }), body: html`<form class="card form" id="product-form" style="max-width:720px">
    <input type="hidden" name="id" value="${p?.id || ''}">
    ${field('Name', input('name', { value: p?.name || '', required: true }))}
    ${field('Description', textarea('description', { value: p?.description || '', rows: 3, placeholder: 'Shown under the name on the estimate' }))}
    <div class="grid grid-2">${field('Price before GST (₹)', input('price', { type: 'number', value: p?.price ?? '', min: 0, step: 0.01, required: true }))}${field('Unit', select('unit', lists.options('sales.units', p?.unit || 'Nos')))}</div>
    <div class="grid grid-2">${field('GST rate', select('gstRate', gstOptions(p?.gst_rate ?? 18)))}${field('HSN / SAC (optional)', input('hsn', { value: p?.hsn || '', placeholder: '4 to 8 digits' }))}</div>
    ${field('Picture', html`<input class="input" type="file" id="product-image" accept=".png,.jpg,.jpeg,.webp">`, p?.image_path ? 'Choose a file only to replace the current picture. PNG, JPG or WebP, up to 2 MB.' : 'PNG, JPG or WebP, up to 2 MB.')}
    ${when(p, () => field('In use', select('active', [{ value: '1', label: 'Yes', selected: !!p!.active }, { value: '0', label: 'No — keep on old estimates, hide from new ones', selected: !p!.active }])))}
    <div class="row" style="justify-content:flex-end;gap:8px"><a class="btn" href="/products">Cancel</a><button class="btn btn-primary" type="submit" id="product-save">Save</button></div></form>
    ${raw(`<script>
(function () {
  var f = document.getElementById('product-form'); if (!f) return;
  f.addEventListener('submit', function (ev) {
    ev.preventDefault(); var btn = document.getElementById('product-save'); btn.disabled = true;
    var body = {}; Array.prototype.forEach.call(f.elements, function (el) { if (el.name) body[el.name] = el.value; });
    var file = document.getElementById('product-image').files[0];
    function fail(msg) { btn.disabled = false; window.LF.toast({ title: 'That did not work', body: msg, kind: 'critical' }); }
    if (file && file.size > ${2 * 1024 * 1024}) return fail('The picture is larger than 2 MB.');
    window.LF.post('/products', body).then(function (res) {
      if (!res || !res.ok) return fail((res && res.error) || 'The product was not saved.');
      if (!file) { location.href = '/products'; return; }
      var rd = new FileReader();
      rd.onload = function () { window.LF.post('/products/' + res.data.id + '/image', { name: file.name, data: String(rd.result) }).then(function (r2) { if (!r2 || !r2.ok) { fail((r2 && r2.error) || 'The picture was not saved; the rest was.'); setTimeout(function () { location.href = '/products'; }, 1800); } else location.href = '/products'; }); };
      rd.onerror = function () { fail('The picture could not be read.'); };
      rd.readAsDataURL(file);
    });
  });
})();
</script>`)}` });
}

// ---------- The estimate as the customer sees it ----------

export function estimateDocument(e: Estimate, items: EstimateItem[], s: EstimateSettings, imgBase: string): Raw {
  const t = computeTotals(items); const sym = cur(e.currency); const anyDiscount = items.some((i) => i.discount_pct > 0);
  return html`<div class="est-doc">
    <div class="est-head"><div><div class="est-seller">${s.sellerName}</div>${when(s.address, () => html`<div class="est-small" style="white-space:pre-line">${s.address}</div>`)}
        <div class="est-small">${[s.gstin ? 'GSTIN ' + s.gstin : '', s.phone, s.email].filter(Boolean).join(' · ')}</div></div>
      <div style="text-align:right"><div class="est-title">Estimate</div><div class="est-small"><b>${e.number}${e.version > 1 ? ` · version ${e.version}` : ''}</b></div>
        <div class="est-small">Date: ${docDate(e.estimate_date)}</div><div class="est-small">Valid until: ${docDate(e.valid_until)}</div></div></div>
    <div class="est-bill"><div class="est-label">Estimate for</div><div><b>${e.bill_name}</b></div>${when(e.bill_address, () => html`<div class="est-small" style="white-space:pre-line">${e.bill_address}</div>`)}
      ${when(e.bill_gstin, () => html`<div class="est-small">GSTIN ${e.bill_gstin}</div>`)}${when(e.bill_contact, () => html`<div class="est-small">${e.bill_contact}</div>`)}</div>
    ${when(e.subject, () => html`<div class="est-subject">${e.subject}</div>`)}
    <div class="est-scroll"><table class="est-table"><thead><tr><th style="width:26px">#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th>${when(anyDiscount, () => html`<th class="r">Disc.</th>`)}<th class="r">Taxable</th><th class="r">GST</th><th class="r">Amount</th></tr></thead>
      <tbody>${items.map((i, n) => html`<tr><td>${n + 1}</td>
        <td><div class="est-item">${when(i.image_path, () => html`<img src="${imgBase}/${i.id}" alt="">`)}<div><b>${i.name}</b>${when(i.description, () => html`<div class="est-small" style="white-space:pre-line">${i.description}</div>`)}${when(i.hsn, () => html`<div class="est-small">HSN / SAC ${i.hsn}</div>`)}</div></div></td>
        <td class="r">${i.qty} ${i.unit}</td><td class="r">${fmt(i.rate)}</td>${when(anyDiscount, () => html`<td class="r">${i.discount_pct ? i.discount_pct + '%' : '—'}</td>`)}
        <td class="r">${fmt(i.taxable)}</td><td class="r">${fmt(i.tax)}<div class="est-small">${i.gst_rate}%</div></td><td class="r"><b>${fmt(i.amount)}</b></td></tr>`)}</tbody></table></div>
    <div class="est-foot"><div class="est-terms">${when(e.notes, () => html`<div class="est-label">Notes</div><div class="est-small" style="white-space:pre-line;margin-bottom:10px">${e.notes}</div>`)}
        ${when(e.terms, () => html`<div class="est-label">Terms and conditions</div><div class="est-small" style="white-space:pre-line">${e.terms}</div>`)}
        ${when(s.bank, () => html`<div class="est-label" style="margin-top:10px">Bank details</div><div class="est-small" style="white-space:pre-line">${s.bank}</div>`)}</div>
      <table class="est-totals"><tbody>
        ${when(t.discount > 0, () => html`<tr><td>Amount before discount</td><td class="r">${fmt(t.gross)}</td></tr><tr><td>Discount</td><td class="r">− ${fmt(t.discount)}</td></tr>`)}
        <tr><td>Taxable value</td><td class="r">${fmt(t.taxable)}</td></tr>
        ${t.byRate.filter((b) => b.tax > 0).map((b) => e.tax_mode === 'inter' ? html`<tr><td>IGST ${b.rate}%</td><td class="r">${fmt(b.tax)}</td></tr>`
          : html`<tr><td>CGST ${b.rate / 2}%</td><td class="r">${fmt(Math.round(b.tax * 50) / 100)}</td></tr><tr><td>SGST ${b.rate / 2}%</td><td class="r">${fmt(b.tax - Math.round(b.tax * 50) / 100)}</td></tr>`)}
        <tr class="est-grand"><td>Total (${e.currency})</td><td class="r">${sym}${fmt(t.total)}</td></tr></tbody></table></div>
    ${when(s.footer, () => html`<div class="est-small" style="margin-top:18px;text-align:center">${s.footer}</div>`)}
  </div>`;
}
export const ESTIMATE_CSS = raw(`<style>
.est-doc{background:#fff;color:#111;border:1px solid #e3e1da;border-radius:10px;padding:32px 36px;max-width:960px;font-size:13.5px;line-height:1.5}
.est-head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:16px}
.est-seller{font-size:20px;font-weight:600}.est-title{font-size:22px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.est-small{font-size:12px;color:#555}.est-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777;margin-bottom:3px}
.est-bill{margin:18px 0 6px}.est-subject{margin:12px 0 4px;font-weight:600}
.est-table{width:100%;border-collapse:collapse;margin-top:14px}.est-table th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#555;text-align:left;border-bottom:1px solid #111;padding:8px 6px}
.est-table td{padding:10px 6px;border-bottom:1px solid #e3e1da;vertical-align:top}.est-table .r,.est-totals .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.est-item{display:flex;gap:12px;align-items:flex-start}.est-item img{width:64px;height:64px;object-fit:contain;border:1px solid #e3e1da;border-radius:6px;background:#fff;flex:none}
.est-scroll{overflow-x:auto}.est-foot{display:flex;justify-content:space-between;gap:32px;margin-top:18px;align-items:flex-start}.est-terms{flex:1;min-width:0}
.est-totals{border-collapse:collapse;min-width:290px;width:auto!important;flex:none}.est-doc table{margin:0}.est-totals td{padding:5px 6px}.est-grand td{border-top:2px solid #111;font-weight:700;font-size:15px;padding-top:9px}
@media (max-width:700px){.est-doc{padding:18px 14px}.est-head,.est-foot{flex-direction:column}.est-head>div:last-child{text-align:left!important}.est-totals{width:100%;min-width:0}.est-item img{width:44px;height:44px}.est-table{min-width:620px}}
@media print{body{background:#fff!important}.no-print,.sidebar,.topbar,.mobile-nav,#toast-root,header,nav,.notice,.alert,.banner{display:none!important}.est-doc{border:0;padding:0;max-width:none}main,.main,.content{margin:0!important;padding:0!important}tr{break-inside:avoid}}
</style>`);

/** The page a customer opens from the link. No sign-in, no menu. */
export function publicEstimatePage(e: Estimate, items: EstimateItem[], s: EstimateSettings, token: string, msg: { ok?: string; error?: string }): Raw {
  const st = shownStatus(e);
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Estimate ${e.number} · ${s.sellerName}</title>
<style>body{margin:0;background:#f6f5f1;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}.wrap{max-width:960px;margin:0 auto;padding:20px 14px 60px}.bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
.btn{font:inherit;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid #111;background:#fff;color:#111;cursor:pointer}.btn-dark{background:#111;color:#fff}.box{background:#fff;border:1px solid #e3e1da;border-radius:10px;padding:18px 20px;margin-top:16px}
.note{padding:12px 14px;border-radius:8px;border:1px solid #e3e1da;background:#fff;margin-bottom:14px;font-size:14px}.in{font:inherit;font-size:14px;padding:10px 12px;border:1px solid #cfccc2;border-radius:8px;width:100%;box-sizing:border-box;margin-top:4px}label{font-size:13px;font-weight:600;display:block;margin-top:10px}</style>${ESTIMATE_CSS}</head>
<body><div class="wrap">
  <div class="bar no-print"><span style="font-size:14px;color:#555">Estimate from <b style="color:#111">${s.sellerName}</b></span><button class="btn" type="button" onclick="window.print()">Print or save as PDF</button></div>
  ${when(msg.ok, () => html`<div class="note no-print" style="border-color:#1f8a4c"><b>${msg.ok}</b></div>`)}${when(msg.error, () => html`<div class="note no-print" style="border-color:#c0392b"><b>${msg.error}</b></div>`)}
  ${when(st === 'expired', () => html`<div class="note no-print">This estimate passed its validity date on ${docDate(e.valid_until)}. Please ask ${s.sellerName} for a fresh one.</div>`)}
  ${when(st === 'superseded', () => html`<div class="note no-print">A newer version of this estimate has been issued. Please ask ${s.sellerName} for the latest link.</div>`)}
  ${when(st === 'accepted' || st === 'declined', () => html`<div class="note no-print">${st === 'accepted' ? 'Accepted' : 'Declined'} by ${e.decided_by} on ${docDate(e.decided_at)}.</div>`)}
  ${estimateDocument(e, items, s, `/e/${token}/img`)}
  ${when(st === 'sent', () => html`<form class="box no-print" method="post" action="/e/${token}/respond"><b>Your answer</b>
    <label for="by">Your name</label><input class="in" id="by" name="by" required minlength="2" maxlength="80">
    <label for="note">Anything you want us to know (optional)</label><textarea class="in" id="note" name="note" rows="2" maxlength="500"></textarea>
    <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-dark" type="submit" name="decision" value="accepted">Accept this estimate</button><button class="btn" type="submit" name="decision" value="declined">Decline</button></div></form>`)}
</div></body></html>`;
}
export function publicEstimateMissing(): Raw {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Estimate not found</title></head><body style="font-family:system-ui,sans-serif;background:#f6f5f1;padding:40px 16px;text-align:center"><h1 style="font-size:20px">This link does not open an estimate</h1><p style="color:#555">It may have been typed wrongly. Please ask the person who sent it for the link again.</p></body></html>`;
}

// ---------- Staff screens ----------

export interface EstimateViewData { e: Estimate; items: EstimateItem[]; settings: EstimateSettings; canEdit: boolean; sendBlock: string | null; link: string | null; versions: Estimate[]; products: Product[]; discountRule: string }

export function estimatesListPage(v: View, d: { rows: Estimate[]; total: number; status: string; q: string; pageNo: number; pages: number; counts: Record<string, number> }): Raw {
  const statuses = [{ value: '', label: 'All current' }, { value: 'draft', label: 'Draft' }, { value: 'final', label: 'Ready to send' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' }];
  const qs = (p: number): string => '/estimates?' + new URLSearchParams({ status: d.status, q: d.q, page: String(p) }).toString();
  return page(v, {
    title: 'Estimates', subtitle: 'Every estimate on your deals. Start a new one from the deal it belongs to.',
    body: html`${salesTabs('estimates')}
      <div class="grid grid-4">${statCard({ value: d.counts.draft || 0, label: 'Drafts' })}${statCard({ value: d.counts.sent || 0, label: 'With customers' })}${statCard({ value: d.counts.accepted || 0, label: 'Accepted', tone: 'good' })}${statCard({ value: d.counts.declined || 0, label: 'Declined' })}</div>
      <form class="card" method="get" action="/estimates" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><input class="input" name="q" value="${d.q}" placeholder="Customer or estimate number" style="max-width:280px" aria-label="Search">
        <select class="input" name="status" style="max-width:220px" aria-label="Status">${statuses.map((s) => html`<option value="${s.value}" ${when(s.value === d.status, 'selected')}>${s.label}</option>`)}</select><button class="btn" type="submit">Show</button><span class="small muted">${d.total} found</span></form>
      <section class="card">${table(['Estimate', 'Customer', 'Total incl. GST', 'Valid until', 'Status', 'Owner'], d.rows.map((e) => [html`<a href="/estimates/${e.id}"><b>${e.number}</b>${e.version > 1 ? ` v${e.version}` : ''}</a>`, e.customer_name || '', html`<b class="num">${cur(e.currency)}${fmt(e.total)}</b>`, fmtDate(e.valid_until), statusPill(e), e.owner_name || '—']), { emptyText: 'No estimates here. Open a deal and press New estimate.' })}
        ${when(d.pages > 1, () => html`<div class="row between" style="margin-top:12px"><span class="small muted">Page ${d.pageNo} of ${d.pages}</span><span class="row" style="gap:8px">${when(d.pageNo > 1, () => html`<a class="btn btn-sm" href="${qs(d.pageNo - 1)}">Previous</a>`)}${when(d.pageNo < d.pages, () => html`<a class="btn btn-sm" href="${qs(d.pageNo + 1)}">Next</a>`)}</span></div>`)}</section>`
  });
}

/** The card on a deal page. */
export function dealEstimatesCard(d: { dealId: string; estimates: Estimate[]; canEdit: boolean; open: boolean; canOpen?: boolean }): Raw {
  // Someone who can see the deal but not another person's estimate gets the list without links.
  const href = (id: string): Raw => (d.canOpen === false ? html`` : html` href="/estimates/${id}"`);
  const draft = d.estimates.find((e) => e.status === 'draft');
  return html`<section class="card" style="padding:14px 16px"><div class="card-head"><h3>Estimates</h3>${when(d.canEdit && d.open, () => draft ? button('Continue the draft', { href: `/estimates/${draft.id}`, size: 'sm', kind: 'primary' }) : button(d.estimates.length ? 'New version' : 'New estimate', { post: `/deals/${d.dealId}/estimate`, size: 'sm', kind: 'primary' }))}</div>
    ${d.estimates.length ? html`<div class="list">${d.estimates.map((e) => html`<a class="list-row"${href(e.id)} style="text-decoration:none;color:inherit"><span style="flex:1"><b>${e.number}${e.version > 1 ? ` v${e.version}` : ''}</b><br><span class="small muted">${fmtDate(e.estimate_date)} · valid until ${fmtDate(e.valid_until)}</span></span><b class="num">${cur(e.currency)}${fmt(e.total)}</b>${statusPill(e)}</a>`)}</div>`
      : html`<p class="small muted" style="margin-top:6px">No estimate yet. An estimate lists products with pictures, quantity, price and GST, and goes to the customer by a link.</p>`}</section>`;
}

export function estimatePage(v: View, d: EstimateViewData): Raw {
  const e = d.e; const st = shownStatus(e); const draft = e.status === 'draft';
  const head = html`<div class="row no-print" style="gap:8px;flex-wrap:wrap;margin-bottom:4px">${statusPill(e)}<a class="small" href="/deals/${e.deal_id}">Deal: ${e.customer_name}${e.deal_title ? ' · ' + e.deal_title : ''}</a>
    ${when(d.versions.length > 1, () => html`<span class="small muted">Versions: ${d.versions.map((x) => x.id === e.id ? html`<b>v${x.version}</b> ` : html`<a href="/estimates/${x.id}">v${x.version}</a> `)}</span>`)}</div>`;
  if (draft && d.canEdit) {
    const cfg = { id: e.id, products: d.products.map((p) => ({ id: p.id, name: p.name, description: p.description, unit: p.unit, price: p.price, hsn: p.hsn, gst: p.gst_rate, img: p.image_path ? `/products/${p.id}/image?v=${encodeURIComponent(p.image_path)}` : '' })),
      items: d.items.map((i) => ({ productId: i.product_id || '', name: i.name, description: i.description, hsn: i.hsn, unit: i.unit, qty: i.qty, rate: i.rate, discountPct: i.discount_pct, gstRate: i.gst_rate })), units: lists.items('sales.units').map((u) => u.value), gst: lists.items('sales.gstRates').map((g) => Number(g.value)).filter((n) => Number.isFinite(n)), inter: e.tax_mode === 'inter' };
    return page(v, {
      title: `${e.number}${e.version > 1 ? ' v' + e.version : ''} · draft`, docTitle: e.number, subtitle: 'Add the products, check the figures, then finalise. Nothing goes to the customer until you send it.',
      actions: html`${button('Save draft', { kind: '', cls: 'js-est-save' })}${button('Save and finalise', { kind: 'primary', cls: 'js-est-final' })}`,
      body: html`${head}
        ${when(!d.products.length, () => notice('warn', html`<b>The product list is empty.</b> You can still type lines by hand, or add products under <a href="/products">Products</a> first.`))}
        <form class="card form" id="est-form" onsubmit="return false">
          <div class="grid grid-3">${field('Estimate for', input('billName', { value: e.bill_name, required: true }))}${field('Customer GSTIN (optional)', input('billGstin', { value: e.bill_gstin, placeholder: '15 characters' }))}${field('Contact', input('billContact', { value: e.bill_contact }))}</div>
          ${field('Customer address', textarea('billAddress', { value: e.bill_address, rows: 2 }))}
          <div class="grid grid-4">${field('Estimate date', input('estimateDate', { type: 'date', value: e.estimate_date }))}${field('Valid until', input('validUntil', { type: 'date', value: e.valid_until }))}
            ${field('GST type', select('taxMode', [{ value: 'intra', label: 'Same state: CGST + SGST', selected: e.tax_mode !== 'inter' }, { value: 'inter', label: 'Other state: IGST', selected: e.tax_mode === 'inter' }]))}${field('Subject (optional)', input('subject', { value: e.subject }))}</div>
          <h3 style="margin-top:8px">Lines</h3>
          <div class="table-wrap"><table id="est-lines" style="min-width:980px"><thead><tr><th style="width:56px"></th><th style="min-width:230px">Product</th><th style="width:90px">Qty</th><th style="width:100px">Unit</th><th style="width:120px">Rate (₹)</th><th style="width:84px">Disc. %</th><th style="width:92px">GST %</th><th style="width:110px;text-align:right">GST (₹)</th><th style="width:130px;text-align:right">Amount (₹)</th><th style="width:40px"></th></tr></thead><tbody></tbody></table></div>
          <div class="row between" style="margin-top:10px;align-items:flex-start;gap:24px;flex-wrap:wrap"><button class="btn btn-sm" type="button" id="est-add">Add a line</button>
            <table id="est-totals" style="width:360px;max-width:100%;margin-left:auto"><tbody></tbody></table></div>
          <p class="small muted">${d.discountRule}</p>
          ${field('Notes for the customer (optional)', textarea('notes', { value: e.notes, rows: 2 }))}
          ${field('Terms and conditions', textarea('terms', { value: e.terms, rows: 4 }))}
        </form>
        <script id="est-config" type="application/json">${jsonScript(cfg)}</script>${raw(BUILDER_JS)}`
    });
  }
  return page(v, {
    title: `${e.number}${e.version > 1 ? ' v' + e.version : ''}`, docTitle: e.number, subtitle: `${e.customer_name} · ${cur(e.currency)}${fmt(e.total)} including GST`, headExtra: ESTIMATE_CSS,
    actions: html`<span class="no-print row" style="gap:8px">${button('Print or save as PDF', { cls: 'js-print' })}
      ${when(d.canEdit && (e.status === 'final' || e.status === 'sent') && !d.sendBlock, () => when(e.status === 'final' || !d.link, () => button(e.status === 'final' ? 'Send to customer' : 'Show the link', { post: `/estimates/${e.id}/send`, kind: 'primary' })))}
      ${when(d.canEdit && e.status !== 'draft' && e.status !== 'superseded' && !d.versions.some((x) => x.status === 'draft'), () => button('Make a new version', { post: `/deals/${e.deal_id}/estimate`, confirm: 'Start a new version? This one stays as it is until the new one is finalised.' }))}</span>`,
    body: html`${head}
      ${when(draft, () => notice('accent', 'This estimate is still a draft. Only the deal owner or a sales manager can change it.'))}
      ${when(d.sendBlock && e.status === 'final', () => notice('warn', html`<b>Not ready to send.</b> ${d.sendBlock}`))}
      ${when(d.link, () => html`<section class="card no-print" style="max-width:960px"><b>Link for the customer</b><p class="small muted" style="margin:4px 0 8px">Anyone with this link can open the estimate and accept or decline it. Send it by email or WhatsApp.</p>
        <div class="row" style="gap:8px"><span style="flex:1;min-width:0"><input class="input" id="est-link" value="${d.link}" readonly onclick="this.select()"></span><button class="btn js-copy" type="button" data-copy="est-link">Copy</button></div>
        ${when(/\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(d.link || ''), () => html`<p class="small" style="margin-top:8px;color:var(--warn)"><b>This link only opens on this computer or office network.</b> A customer can open it once LoyalFlow is hosted on the internet. Until then, use Print or save as PDF and send the PDF.</p>`)}</section>`)}
      ${when(st === 'accepted' || st === 'declined', () => notice(st === 'accepted' ? 'good' : 'crit', html`<b>${st === 'accepted' ? 'Accepted' : 'Declined'}</b> by ${e.decided_by} on ${fmtDateTime(e.decided_at)}${e.decision_note ? html`: “${e.decision_note}”` : ''}`))}
      ${when(st === 'expired', () => notice('warn', `This estimate passed its validity date on ${fmtDate(e.valid_until)}. Make a new version to offer it again.`))}
      ${estimateDocument(e, d.items, d.settings, `/estimates/${e.id}/img`)}
      ${when(d.canEdit && e.status === 'sent', () => html`<form class="card form no-print" data-ajax action="/estimates/${e.id}/decide" style="max-width:960px"><h3>Record the customer's answer yourself</h3><p class="small muted">Use this when they answered by phone, email or in person.</p>
        <div class="grid grid-3">${field('Who answered', input('by', { required: true, placeholder: 'Name at the customer' }))}${field('Answer', select('decision', [{ value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }]))}${field('Note (optional)', input('note', {}))}</div>
        <div class="row" style="justify-content:flex-end"><button class="btn" type="submit">Record</button></div></form>`)}
      ${raw(`<script>document.addEventListener('click', function (ev) { var t = ev.target.closest ? ev.target.closest('.js-print, .js-copy') : null; if (!t) return; if (t.classList.contains('js-print')) window.print(); else { var i = document.getElementById(t.getAttribute('data-copy')); i.select(); try { navigator.clipboard.writeText(i.value); } catch (e) { document.execCommand('copy'); } window.LF.toast({ title: 'Link copied', kind: 'success' }); } });</script>`)}`
  });
}

const BUILDER_JS = `<script>
(function () {
  var cfg = JSON.parse(document.getElementById('est-config').textContent);
  var body = document.querySelector('#est-lines tbody'), totals = document.querySelector('#est-totals tbody'), form = document.getElementById('est-form');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function opts(list, cur, suffix) { var seen = false, h = ''; list.forEach(function (x) { var sel = String(x) === String(cur); if (sel) seen = true; h += '<option value="' + esc(x) + '"' + (sel ? ' selected' : '') + '>' + esc(x) + (suffix || '') + '</option>'; }); if (!seen && cur !== '' && cur != null) h += '<option value="' + esc(cur) + '" selected>' + esc(cur) + (suffix || '') + '</option>'; return h; }
  function productOpts(cur) { var h = '<option value="">Type a line by hand</option>'; cfg.products.forEach(function (p) { h += '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }); return h; }
  function addRow(it) {
    it = it || { productId: '', name: '', description: '', hsn: '', unit: cfg.units[0] || 'Nos', qty: 1, rate: 0, discountPct: 0, gstRate: 18 };
    var p = cfg.products.filter(function (x) { return x.id === it.productId; })[0];
    var tr = document.createElement('tr'); tr.setAttribute('data-hsn', it.hsn || '');
    tr.innerHTML = '<td class="js-img">' + (p && p.img ? '<img src="' + esc(p.img) + '" alt="" style="width:44px;height:44px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff">' : '') + '</td>' +
      '<td><select class="input js-product" aria-label="Product">' + productOpts(it.productId) + '</select><input class="input js-name" style="margin-top:6px" placeholder="Name on the estimate" value="' + esc(it.name) + '" maxlength="120" aria-label="Name"><textarea class="input js-desc" style="margin-top:6px" rows="2" placeholder="Description (optional)" maxlength="1000" aria-label="Description">' + esc(it.description) + '</textarea></td>' +
      '<td><input class="input js-qty" type="number" min="0.001" step="any" value="' + esc(it.qty) + '" aria-label="Quantity"></td>' +
      '<td><select class="input js-unit" aria-label="Unit">' + opts(cfg.units, it.unit) + '</select></td>' +
      '<td><input class="input js-rate" type="number" min="0" step="0.01" value="' + esc(it.rate) + '" aria-label="Rate"></td>' +
      '<td><input class="input js-disc" type="number" min="0" max="100" step="0.5" value="' + esc(it.discountPct) + '" aria-label="Discount percent"></td>' +
      '<td><select class="input js-gst" aria-label="GST percent">' + opts(cfg.gst, it.gstRate) + '</select></td>' +
      '<td class="num js-tax" style="text-align:right;padding-top:16px"></td><td class="num js-amt" style="text-align:right;padding-top:16px;font-weight:600"></td>' +
      '<td><button class="btn btn-ghost btn-sm js-del" type="button" aria-label="Remove this line" title="Remove this line">✕</button></td>';
    body.appendChild(tr); return tr;
  }
  function line(tr) {
    var q = Number(tr.querySelector('.js-qty').value) || 0, r = Number(tr.querySelector('.js-rate').value) || 0, d = Number(tr.querySelector('.js-disc').value) || 0, g = Number(tr.querySelector('.js-gst').value) || 0;
    var gross = r2(q * r), disc = r2(gross * d / 100), taxable = r2(gross - disc), tax = r2(taxable * g / 100);
    return { gross: gross, disc: disc, taxable: taxable, tax: tax, amount: r2(taxable + tax), gst: g };
  }
  function recalc() {
    var t = { gross: 0, disc: 0, taxable: 0, tax: 0 }, by = {};
    Array.prototype.forEach.call(body.children, function (tr) { var l = line(tr); tr.querySelector('.js-tax').textContent = money(l.tax); tr.querySelector('.js-amt').textContent = money(l.amount); t.gross += l.gross; t.disc += l.disc; t.taxable += l.taxable; t.tax += l.tax; by[l.gst] = (by[l.gst] || 0) + l.tax; });
    var inter = form.elements.taxMode.value === 'inter', h = '';
    function row(a, b, strong) { return '<tr' + (strong ? ' style="font-weight:700;border-top:2px solid var(--ink)"' : '') + '><td style="padding:4px 8px">' + a + '</td><td class="num" style="padding:4px 8px;text-align:right">' + b + '</td></tr>'; }
    if (t.disc > 0) { h += row('Amount before discount', money(t.gross)); h += row('Discount (' + (t.gross ? r2(t.disc / t.gross * 100) : 0) + '% overall)', '− ' + money(t.disc)); }
    h += row('Taxable value', money(t.taxable));
    Object.keys(by).map(Number).sort(function (a, b) { return a - b; }).forEach(function (g) { if (!by[g]) return; if (inter) h += row('IGST ' + g + '%', money(by[g])); else { var half = Math.round(by[g] * 50) / 100; h += row('CGST ' + g / 2 + '%', money(half)); h += row('SGST ' + g / 2 + '%', money(by[g] - half)); } });
    h += row('Total', '₹' + money(r2(t.taxable) + r2(t.tax)), true);
    totals.innerHTML = h;
  }
  body.addEventListener('change', function (ev) {
    var tr = ev.target.closest('tr');
    if (ev.target.classList.contains('js-product')) {
      var p = cfg.products.filter(function (x) { return x.id === ev.target.value; })[0];
      if (p) { tr.querySelector('.js-name').value = p.name; tr.querySelector('.js-desc').value = p.description; tr.querySelector('.js-rate').value = p.price; tr.setAttribute('data-hsn', p.hsn || '');
        tr.querySelector('.js-unit').innerHTML = opts(cfg.units, p.unit); tr.querySelector('.js-gst').innerHTML = opts(cfg.gst, p.gst);
        tr.querySelector('.js-img').innerHTML = p.img ? '<img src="' + esc(p.img) + '" alt="" style="width:44px;height:44px;object-fit:contain;border:1px solid var(--line);border-radius:6px;background:#fff">' : ''; }
      else { tr.querySelector('.js-img').innerHTML = ''; tr.setAttribute('data-hsn', ''); }
    }
    recalc();
  });
  body.addEventListener('input', recalc);
  body.addEventListener('click', function (ev) { if (ev.target.classList.contains('js-del')) { ev.target.closest('tr').remove(); if (!body.children.length) addRow(); recalc(); } });
  form.elements.taxMode.addEventListener('change', recalc);
  document.getElementById('est-add').addEventListener('click', function () { var tr = addRow(); recalc(); tr.querySelector('.js-product').focus(); });
  function collect() {
    var b = {}; ['billName', 'billGstin', 'billContact', 'billAddress', 'estimateDate', 'validUntil', 'taxMode', 'subject', 'notes', 'terms'].forEach(function (k) { b[k] = form.elements[k].value; });
    b.items = Array.prototype.map.call(body.children, function (tr) { return { productId: tr.querySelector('.js-product').value, name: tr.querySelector('.js-name').value, description: tr.querySelector('.js-desc').value, hsn: tr.getAttribute('data-hsn') || '', unit: tr.querySelector('.js-unit').value, qty: tr.querySelector('.js-qty').value, rate: tr.querySelector('.js-rate').value, discountPct: tr.querySelector('.js-disc').value, gstRate: tr.querySelector('.js-gst').value }; }).filter(function (i) { return i.name.trim() || i.productId; });
    return b;
  }
  var busy = false;
  function save(finalise) {
    if (busy) return; busy = true;
    window.LF.post('/estimates/' + cfg.id, collect()).then(function (res) {
      if (!res || !res.ok) { busy = false; window.LF.toast({ title: 'That did not work', body: (res && res.error) || 'The estimate was not saved.', kind: 'critical' }); return; }
      if (!finalise) { busy = false; window.LF.toast({ title: 'Draft saved', kind: 'success' }); return; }
      if (!window.confirm('Finalise this estimate? The figures are fixed after this. To change them later you make a new version.')) { busy = false; return; }
      window.LF.post('/estimates/' + cfg.id + '/finalise', {}).then(function (r) { if (!r || !r.ok) { busy = false; window.LF.toast({ title: 'That did not work', body: (r && r.error) || 'The estimate was not finalised.', kind: 'critical' }); return; } location.reload(); });
    });
  }
  document.addEventListener('click', function (ev) { var t = ev.target.closest ? ev.target.closest('.js-est-save, .js-est-final') : null; if (t) save(t.classList.contains('js-est-final')); });
  (cfg.items.length ? cfg.items : [null]).forEach(function (i) { addRow(i || undefined); });
  recalc();
})();
</script>`;
