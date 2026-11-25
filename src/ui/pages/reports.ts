// Reports: one hub and one report screen for every module.
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { button, notice, empty, icon } from '../components.ts';
import { MODULE_NAME, MENU_OF, type ReportDef, type ReportResult, type RunCtx, type Cell, type Column, type ModuleId } from '../../modules/reports/engine.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (d: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d; };
export const money = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
export function cellText(c: Cell, col: Column): string {
  if (c == null || c === '') return '—';
  if (typeof c === 'object') return c.text;
  if (typeof c === 'number') return col.fmt === 'money' ? money(c) : col.fmt === 'pct' ? `${c}%` : col.fmt === 'num' ? c.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : c.toLocaleString('en-IN');
  return col.fmt === 'date' ? day(c) : c;
}
const isNum = (col: Column): boolean => ['int', 'money', 'pct', 'num'].includes(col.fmt || '');
const cellHtml = (c: Cell, col: Column): Raw => (c && typeof c === 'object' ? html`<a href="${c.href}">${c.text}</a>` : html`${cellText(c, col)}`);

const TONE: Record<string, string> = { sales: 'orange', support: 'blue', dev: 'violet', production: 'grey', company: 'navy', people: 'green', admin: 'grey' };
const ICON: Record<ModuleId, string> = { sales: 'star', support: 'ticket', dev: 'code', production: 'factory', finance: 'rupee', attendance: 'calendar', hiring: 'user', appraisals: 'star', sops: 'checklist', approvals: 'approval', dsr: 'checklist', admin: 'settings' };

export function reportsHubPage(v: View, d: { reports: ReportDef[]; menu: string; floor?: boolean }): Raw {
  const groups = [...new Set(d.reports.map((r) => r.module))];
  return page(v, {
    title: 'Reports', navTab: `reports:${d.menu || 'company'}`,
    subtitle: `${d.reports.length} report${d.reports.length === 1 ? '' : 's'} you can run. Each takes a date range and exports to Excel.`,
    actions: d.floor ? button('View from above', { href: '/reports' }) : when(d.menu && d.menu !== 'company', () => button('All reports', { href: '/reports' })),
    body: d.reports.length ? html`${groups.map((g) => html`<section class="card"><div class="card-head"><h2 style="gap:10px"><span class="sq sq-sm sq-${TONE[MENU_OF[g]] || 'blue'}">${icon(ICON[g], 16)}</span>${MODULE_NAME[g]}</h2><span class="small muted">${d.reports.filter((r) => r.module === g).length}</span></div>
        <div class="report-grid">${d.reports.filter((r) => r.module === g).map((r) => html`<a class="report-link" href="/reports/${r.key}"><b>${r.title}</b><span class="small muted">${r.about}</span></a>`)}</div></section>`)}`
      : empty('There are no reports for your role here. Ask an administrator if you need one.', '📊')
  });
}

const short = (n: number, unit?: string): string => {
  const a = Math.abs(n); const f = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));
  const t = a >= 1e7 ? f(n / 1e7) + ' Cr' : a >= 1e5 ? f(n / 1e5) + ' L' : a >= 1e4 ? f(n / 1e3) + 'k' : n.toLocaleString('en-IN', { maximumFractionDigits: 1 });
  return unit === '₹' ? '₹' + t : t;
};
const isMonths = (labels: string[]): boolean => labels.length >= 2 && labels.every((l) => /^[A-Z][a-z]{2} \d{4}$/.test(l));

// Columns for a run of months: time reads left to right.
function columnChart(c: NonNullable<ReportResult['chart']>, fmt: (n: number) => string): Raw {
  const n = c.labels.length; const max = Math.max(...c.values);
  const step = Math.pow(10, Math.floor(Math.log10(max))); const top = Math.ceil(max / step) * step;
  const W = Math.max(900, n * 56), H = 210, L = 48, R = 12, T = 18, B = 30; const pw = W - L - R, ph = H - T - B; const slot = pw / n; const bw = Math.min(26, slot * 0.5);
  const y = (v: number): number => T + ph - (v / top) * ph; const every = Math.ceil(n / 12);
  return html`<svg class="colchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${c.title}. ${c.labels.map((l, i) => `${l}: ${fmt(c.values[i])}`).join('; ')}">
    ${[0, 0.5, 1].map((g) => html`<line class="cc-grid" x1="${L}" x2="${W - R}" y1="${y(top * g).toFixed(1)}" y2="${y(top * g).toFixed(1)}"></line><text class="cc-axis" x="${L - 6}" y="${(y(top * g) + 3.5).toFixed(1)}" text-anchor="end">${short(top * g, c.unit)}</text>`)}
    ${c.labels.map((l, i) => { const v = c.values[i]; const x = L + slot * i + (slot - bw) / 2; const h = Math.max(v > 0 ? 2 : 0, T + ph - y(v)); const r = Math.min(4, h); const yy = T + ph - h;
      return html`<g class="cc-col"><title>${l}: ${fmt(v)}</title><rect class="cc-hit" x="${(L + slot * i).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ph}"></rect>
        ${when(v > 0, () => html`<path class="cc-bar" d="M${x.toFixed(1)} ${T + ph}V${(yy + r).toFixed(1)}q0 ${-r} ${r} ${-r}h${(bw - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}V${T + ph}z"></path>`)}
        ${when(n <= 12 && v > 0, () => html`<text class="cc-val" x="${(x + bw / 2).toFixed(1)}" y="${(yy - 5).toFixed(1)}" text-anchor="middle">${short(v, c.unit)}</text>`)}
        ${when(i % every === 0, () => html`<text class="cc-axis" x="${(x + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${n > 6 ? l.replace(/ \d\d(\d\d)$/, " '$1") : l}</text>`)}</g>`; })}
  </svg>`;
}

function barChart(c: NonNullable<ReportResult['chart']>): Raw {
  const max = Math.max(0, ...c.values); if (!c.labels.length || max <= 0) return html``;
  const fmt = (n: number): string => (c.unit === '₹' ? money(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + (c.unit && c.unit !== '₹' ? ' ' + c.unit : ''));
  const total = c.values.reduce((a, b) => a + b, 0); const share = c.unit !== 'days' && c.labels.length > 1;
  return html`<section class="card"><div class="card-head"><h2>${c.title}</h2></div>
    ${isMonths(c.labels) ? columnChart(c, fmt) : html`<div class="hbars" role="img" aria-label="${c.title}. ${c.labels.map((l, i) => `${l}: ${fmt(c.values[i])}`).join('; ')}">${c.labels.map((l, i) => html`<div class="hbar" title="${l}: ${fmt(c.values[i])}"><span class="hbar-label">${l}</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(c.values[i] > 0 ? 0.6 : 0, (c.values[i] / max) * 100).toFixed(1)}%"></span></span><span class="hbar-value num">${fmt(c.values[i])}${when(share && total > 0, () => html` <span class="hbar-share">${Math.round((c.values[i] / total) * 100)}%</span>`)}</span></div>`)}</div>`}</section>`;
}

// Headline figures: the totals line as tiles, or the size and the biggest item when a report has no totals.
function kpiTiles(r: ReportResult): Raw {
  const tiles: { label: string; value: string; pct?: number }[] = [];
  if (r.totals) r.totals.forEach((c, i) => { if (i > 0 && typeof c === 'number' && tiles.length < 5) tiles.push({ label: r.columns[i].header, value: cellText(c, r.columns[i]), pct: r.columns[i].fmt === 'pct' ? c : undefined }); });
  if (!tiles.length) {
    tiles.push({ label: r.rows.length === 1 ? 'Line' : 'Lines', value: r.rows.length.toLocaleString('en-IN') });
    const ch = r.chart; if (ch && ch.values.length > 1 && Math.max(...ch.values) > 0) { const i = ch.values.indexOf(Math.max(...ch.values)); tiles.push({ label: 'Highest', value: ch.labels[i] }); }
  }
  return html`<div class="kpis">${tiles.map((t) => html`<div class="kpi"><span class="kpi-label">${t.label}</span><b class="kpi-value num">${t.value}</b>${when(t.pct != null, () => html`<span class="meter" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, t.pct!))}%"></span></span>`)}</div>`)}</div>`;
}

export interface ReportPageData { def: ReportDef; result: ReportResult; ctx: RunCtx; siblings: ReportDef[]; departments: { id: string; name: string }[]; people: { id: string; full_name: string }[]; ranges: { label: string; from: string; to: string }[]; query: string }
export function reportPage(v: View, d: ReportPageData): Raw {
  const { def, result: r, ctx } = d; const menu = MENU_OF[def.module];
  // Shade the first count or money column so the big lines stand out.
  const barCol = r.rows.length > 1 ? r.columns.findIndex((c, i) => i > 0 && (c.fmt === 'int' || c.fmt === 'money') && r.rows.some((row) => typeof row[i] === 'number' && (row[i] as number) > 0)) : -1;
  const barMax = barCol < 0 ? 1 : Math.max(...r.rows.map((row) => (typeof row[barCol] === 'number' ? (row[barCol] as number) : 0)));
  return page(v, {
    title: def.title, navTab: `reports:${menu}`, subtitle: def.about,
    actions: html`${button('Export to Excel', { href: `/reports/${def.key}.xlsx${d.query}`, icon: 'download' })}${button('Print', { cls: 'js-print' })}`,
    body: html`<div class="report-layout">
      <nav class="card report-side" aria-label="${MODULE_NAME[def.module]} reports"><h3>${MODULE_NAME[def.module]}</h3>${d.siblings.map((s) => html`<a href="/reports/${s.key}${d.query}" class="${s.key === def.key ? 'active' : ''}">${s.title}</a>`)}<a href="${menu === 'company' ? '/reports' : `/reports?module=${menu}`}" class="report-back">All ${menu === 'company' ? '' : MODULE_NAME[def.module].toLowerCase() + ' '}reports</a></nav>
      <div class="report-main">
        <form class="card report-filters" method="get" action="/reports/${def.key}">
          ${when(!def.noRange, () => html`<label>From<input class="input" type="date" name="from" value="${ctx.from}"></label><label>To<input class="input" type="date" name="to" value="${ctx.to}"></label>`)}
          ${when(def.filters.includes('department'), () => html`<label>Department<select class="input" name="department"><option value="">All</option>${d.departments.map((x) => html`<option value="${x.id}" ${when(x.id === ctx.departmentId, 'selected')}>${x.name}</option>`)}</select></label>`)}
          ${when(def.filters.includes('person'), () => html`<label>Person<select class="input" name="person"><option value="">Everyone</option>${d.people.map((x) => html`<option value="${x.id}" ${when(x.id === ctx.personId, 'selected')}>${x.full_name}</option>`)}</select></label>`)}
          ${when(!def.noRange || def.filters.length, () => html`<button class="btn btn-primary" type="submit">Show</button>`)}
          ${when(!def.noRange, () => html`<span class="report-quick">${d.ranges.map((q) => html`<a class="chip ${q.from === ctx.from && q.to === ctx.to ? 'on' : ''}" href="/reports/${def.key}?from=${q.from}&to=${q.to}${ctx.departmentId ? `&department=${ctx.departmentId}` : ''}${ctx.personId ? `&person=${ctx.personId}` : ''}">${q.label}</a>`)}</span>`)}
        </form>
        ${when(ctx.people, () => notice('accent', 'You are seeing your own team. People with company-wide access see everyone.'))}
        ${when(r.note, () => html`<p class="small muted" style="margin:0 2px">${r.note}</p>`)}
        ${when(r.rows.length, () => kpiTiles(r))}
        ${when(r.chart && r.rows.length, () => barChart(r.chart!))}
        <section class="card"><div class="card-head"><h2>${r.rows.length} ${r.rows.length === 1 ? 'line' : 'lines'}</h2>${when(!def.noRange, () => html`<span class="small muted">${day(ctx.from)} to ${day(ctx.to)}</span>`)}</div>
          ${r.rows.length ? html`<div class="table-wrap"><table><thead><tr>${r.columns.map((c) => html`<th class="${isNum(c) ? 'num' : ''}" style="${isNum(c) ? 'text-align:right' : ''}">${c.header}</th>`)}</tr></thead>
            <tbody>${r.rows.map((row) => html`<tr>${row.map((c, i) => { const col = r.columns[i]; const n = isNum(col);
              if (n && col.fmt === 'pct' && typeof c === 'number') return html`<td class="num" style="text-align:right;white-space:nowrap">${cellText(c, col)}<span class="meter meter-cell" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, c))}%"></span></span></td>`;
              const bar = i === barCol && typeof c === 'number' && c > 0 ? `background:linear-gradient(to left,var(--accent-soft) ${((c / barMax) * 100).toFixed(1)}%,transparent 0) no-repeat;` : '';
              return html`<td class="${n ? 'num' : ''}" style="${bar}${n ? 'text-align:right;white-space:nowrap' : ''}">${cellHtml(c, col)}</td>`; })}</tr>`)}</tbody>
            ${when(r.totals, () => html`<tfoot><tr>${r.totals!.map((c, i) => html`<td class="${isNum(r.columns[i]) ? 'num' : ''}" style="font-weight:700;border-top:2px solid var(--ink);${isNum(r.columns[i]) ? 'text-align:right;white-space:nowrap' : ''}">${c == null ? '' : cellText(c, r.columns[i])}</td>`)}</tr></tfoot>`)}</table></div>`
            : empty('Nothing in this period. Try a longer date range.', '🗓️')}</section>
      </div></div>
      <script>document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.js-print')) window.print(); });</script>`
  });
}
