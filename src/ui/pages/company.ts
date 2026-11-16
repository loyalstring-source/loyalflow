import { html, when, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, tileCard, pill, lineChart, legend, table, empty, field, input, textarea, notice, ragTone, button } from '../components.ts';
import type { Tile, Band, Rag, SeriesPoint, KpiDef, KpiScope } from '../../modules/kpi/engine.ts';
import { formatValue } from '../../modules/kpi/engine.ts';
import type { Department, Employee } from '../../modules/people/model.ts';
import { fiscalYear } from '../../lib/time.ts';

export interface CompanyData {
  now: Date; week: string; bands: { band: Band; name: string; owners: string; tiles: Tile[] }[];
  streaks: { tile: Tile; weeks: number }[]; approvalsOld: number; canExport: boolean; isExec: boolean; lastSnapshot: string | null;
}

export function companyPageView(v: View, d: CompanyData): Raw {
  const all = d.bands.flatMap((b) => b.tiles);
  const reds = all.filter((t) => t.rag === 'crit').length;
  const ambers = all.filter((t) => t.rag === 'warn').length;
  const greens = all.filter((t) => t.rag === 'good').length;
  const scored = reds + ambers + greens;
  // One bar that says where the company stands before a single number is read.
  const seg = (n: number, cls: string) => when(n, () => html`<span style="flex:${n};background:var(--${cls});height:100%"></span>`);

  return page(v, {
    title: 'Company', docTitle: 'Company page',
    subtitle: html`Week ${d.week.split('-W')[1]} · ${fiscalYear(d.now)} · reviewed every Monday by the CEO and COO`,
    actions: html`${when(d.canExport, () => html`${button('PowerPoint', { href: '/exports/company.pptx', icon: 'download' })}${button('Excel', { href: '/exports/company.xlsx', icon: 'download' })}`)}${when(d.isExec, button('Targets', { href: '/settings/targets', icon: 'target' }))}`,
    body: html`
      <section class="hero" style="padding:24px 28px">
        <div class="row between" style="gap:24px;align-items:flex-end">
          <div style="flex:1 1 300px;min-width:0">
            <span class="eyebrow" style="color:#7E92B8">Where we stand</span>
            <h2 style="margin-top:7px">${reds ? html`${reds} measure${reds === 1 ? '' : 's'} in the red` : 'Nothing in the red'}</h2>
            <p class="hero-sub">${greens} of ${scored} on target${when(ambers, () => html` · ${ambers} amber`)}. ${reds ? 'Start the review at the top of this list.' : 'A clean week.'}</p>
          </div>
          <div class="row" style="gap:26px;flex:none">
            ${[['good', greens, 'On target'], ['warn', ambers, 'Amber'], ['crit', reds, 'Red']].map(([cls, n, label]) => html`<div style="text-align:right">
              <b class="num" style="font-size:30px;font-weight:650;letter-spacing:-.03em;color:${cls === 'good' ? 'var(--good)' : cls === 'warn' ? 'var(--warn)' : 'var(--crit)'}" data-countup="${n}">${n}</b>
              <span class="eyebrow" style="display:block;color:#7E92B8;margin-top:2px">${label}</span>
            </div>`)}
          </div>
        </div>
        <div style="margin-top:20px;height:6px;border-radius:6px;overflow:hidden;display:flex;gap:2px;background:rgba(255,255,255,.08)">
          ${seg(greens, 'good')}${seg(ambers, 'warn')}${seg(reds, 'crit')}
        </div>
      </section>

      ${when(d.streaks.length, () => html`<div class="notice notice-crit reveal">${icon('flame')}<div><b>Red for ${d.streaks[0].weeks} weeks running:</b> ${d.streaks.map((s, i) => html`${when(i > 0, ', ')}<a href="/kpi/${s.tile.key}" style="color:inherit;font-weight:600">${s.tile.name}</a> (${s.tile.display})`)}. The weekly review should start here.</div></div>`)}

      ${d.bands.map((b) => { const on = b.tiles.filter((t) => t.rag === 'good').length; return html`<section class="card reveal">
        <div class="band-head">
          <div><span class="eyebrow">${b.band} band</span><h2 style="margin-top:3px">${b.name}</h2></div>
          <span class="band-rule"></span>
          <span class="band-score"><span class="dot dot-${on === b.tiles.length ? 'good' : on >= b.tiles.length / 2 ? 'warn' : 'crit'}"></span> ${on} of ${b.tiles.length} on target</span>
        </div>
        <span class="small muted" style="display:block;margin-top:4px">Owners: ${b.owners}</span>
        <div class="grid grid-4 stagger-grid" style="margin-top:16px">${b.tiles.map((t) => tileCard(t))}</div></section>`; })}

      <p class="xs faint">Numbers are live. Weekly history is stored every 15 minutes${when(d.lastSnapshot, () => html` (last at ${d.lastSnapshot})`)}; manual KPIs (marked "entered weekly") are typed in by their owners each Monday. Click any tile for its definition, trend and the people behind it.</p>`
  });
}

export interface KpiDetailData {
  def: KpiDef; tile: Tile; scope: KpiScope; scopeName: string; series: SeriesPoint[]; fullTarget: number | null;
  people: { id: string; name: string; dept: string; value: number | null; display: string; rag: Rag }[];
  canSetTarget: boolean; canPropose: boolean; canEnter: boolean; targetHistory: { set_at: string; set_by_name: string; target: number; reason: string }[];
  departments: { id: string; name: string; code: string }[]; streak: number;
}

export function kpiDetailPage(v: View, d: KpiDetailData): Raw {
  const t = d.tile;
  const unitFmt = (x: number) => formatValue(d.def.unit, x);
  const colour = t.rag === 'good' ? 'var(--good)' : t.rag === 'warn' ? 'var(--warn)' : t.rag === 'crit' ? 'var(--crit)' : 'var(--accent)';
  return page(v, {
    title: d.def.name, docTitle: d.def.name,
    subtitle: html`${d.scopeName} · ${d.def.band} band · owned by ${d.def.ownerDept} · ${d.def.source === 'manual' ? 'entered weekly' : 'computed live'}`,
    actions: html`${button('Company page', { href: '/company', icon: 'grid', kind: 'ghost' })}`,
    body: html`
      <div class="cols"><div class="col-main">
        <section class="card"><div class="cols" style="align-items:center"><div style="flex:1 1 220px">
          <span class="small muted">${d.def.periodKind === 'month' ? 'Month to date' : d.def.periodKind === 'week' ? 'Last 7 days' : 'Right now'}</span>
          <div class="row" style="gap:12px;align-items:baseline"><span class="num c-${t.rag} kpi-morph" style="font-size:46px;font-weight:650;letter-spacing:-.03em;view-transition-name:kpi-${d.def.key}">${t.display}</span>${pill(t.rag === 'good' ? 'On target' : t.rag === 'warn' ? 'Amber' : t.rag === 'crit' ? 'Red' : 'No target', ragTone(t.rag))}</div>
          <div class="small muted">${t.target === null ? 'No target set' : html`Target ${t.targetDisplay}${when(d.def.periodKind === 'month' && t.target !== null, () => html` (prorated to ${formatValue(d.def.unit, t.target)} so far this month)`)}`}${when(t.delta, () => html` · ${t.delta}`)}${when(d.streak >= 2, () => html` · <b class="c-crit">${d.streak} red weeks in a row</b>`)}</div>
        </div></div>
          <div style="margin-top:18px">${lineChart([{ name: 'Actual', points: d.series, colour }], { unitFormat: unitFmt, target: t.target })}</div>
          ${legend([{ name: 'Actual, by ISO week', colour }, { name: 'Target', colour: 'var(--ink)' }])}
        </section>
        <section class="card"><h2>Definition</h2><p style="margin-top:8px">${d.def.definition}</p>
          <p class="small muted" style="margin-top:8px">Direction: ${d.def.direction === 'up' ? 'higher is better' : d.def.direction === 'down' ? 'lower is better' : 'informational'}. Amber starts at ${d.def.direction === 'up' ? `${Math.round(d.def.amberFactor * 100)}% of target` : d.def.direction === 'down' ? (t.target === 0 ? `${d.def.amberFactor} or more` : `${Math.round(d.def.amberFactor * 100)}% of target`) : 'n/a'}.</p></section>
        ${when(d.people.length, () => html`<section class="card"><div class="card-head"><h2>By person</h2><span class="small muted">Transparent model: managers see every individual number</span></div>
          ${table(['Person', 'Department', 'Value', 'Status'], d.people.map((p) => [html`<a href="/people/${p.id}">${p.name}</a>`, p.dept, html`<b class="num">${p.display}</b>`, pill(p.rag === 'good' ? 'On target' : p.rag === 'warn' ? 'Amber' : p.rag === 'crit' ? 'Red' : '—', ragTone(p.rag))]))}</section>`)}
      </div>
      <div class="col-side">
        ${when(d.canEnter, () => html`<section class="card"><h2>Enter this week's value</h2><p class="small muted" style="margin:6px 0 12px">Manual KPI. The owner enters it every Monday before the review; it stays until replaced.</p>
          <form class="form" data-ajax action="/kpi/${d.def.key}/manual"><input type="hidden" name="scopeType" value="${d.scope.type}"><input type="hidden" name="scopeId" value="${d.scope.id}">
          ${field('Value' + (d.def.unit === 'inr' ? ' (₹)' : d.def.unit === 'pct' ? ' (%)' : ''), input('value', { type: 'number', step: 'any', required: true, value: t.value ?? '' }))}
          <button class="btn btn-primary" type="submit">Save value</button></form></section>`)}
        ${when(d.canSetTarget || d.canPropose, () => html`<section class="card"><h2>${d.canSetTarget ? 'Set the target' : 'Propose a target'}</h2>
          <p class="small muted" style="margin:6px 0 12px">${d.canSetTarget ? 'Targets can be changed any time; every change is logged with its reason.' : 'HODs propose, the COO approves (decision B4). The proposal becomes an approval task for the COO.'}</p>
          <form class="form" data-ajax action="/kpi/${d.def.key}/target"><input type="hidden" name="scopeType" value="${d.scope.type}"><input type="hidden" name="scopeId" value="${d.scope.id}">
          ${field('Target' + (d.def.unit === 'inr' ? ' (₹)' : d.def.unit === 'pct' ? ' (%)' : ''), input('target', { type: 'number', step: 'any', required: true, value: d.fullTarget ?? '' }))}
          ${field('Reason', textarea('reason', { required: true, rows: 2, placeholder: 'Why is this the right number for this period?' }))}
          <button class="btn btn-primary" type="submit">${d.canSetTarget ? 'Save target' : 'Send proposal to COO'}</button></form></section>`)}
        ${when(d.targetHistory.length, () => html`<section class="card"><h2>Target history</h2><ul class="list" style="margin-top:6px">${d.targetHistory.map((h) => html`<li style="padding:8px 0"><span style="flex:1"><b class="num">${formatValue(d.def.unit, h.target)}</b> <span class="small muted">by ${h.set_by_name}, ${h.set_at.slice(0, 10)}</span><br><span class="small">${h.reason}</span></span></li>`)}</ul></section>`)}
        ${when(d.scope.type === 'company' && d.departments.length, () => html`<section class="card"><h2>Look at one department</h2><div class="checks" style="margin-top:10px">${d.departments.map((dp) => html`<a class="chip" href="/kpi/${d.def.key}?scope=department&id=${dp.id}">${dp.name}</a>`)}</div></section>`)}
      </div></div>`
  });
}

export interface AnalyticsData {
  departments: Department[]; dept: Department | null; scopeLabel: string; tiles: Tile[]; keys: string[];
  people: { emp: Employee; values: { key: string; display: string; rag: Rag }[] }[]; selfOnly: boolean; selected: string; chart: { def: KpiDef; series: SeriesPoint[]; target: number | null };
}

export function analyticsPage(v: View, d: AnalyticsData): Raw {
  const colour = 'var(--accent)';
  return page(v, {
    title: 'Analytics', subtitle: d.selfOnly ? 'Your own numbers, week by week.' : html`${d.scopeLabel} · the same KPIs every manager sees, by person`,
    actions: when(!d.selfOnly && v.isManager, button('Excel', { href: `/exports/analytics.xlsx?dept=${d.dept?.id || ''}`, icon: 'download' })),
    body: html`
      ${when(!d.selfOnly, () => html`<div class="checks">${d.departments.map((dp) => html`<a class="chip ${d.dept?.id === dp.id ? 'on' : ''}" href="/analytics?dept=${dp.id}">${dp.name}</a>`)}</div>`)}
      <section class="card"><div class="card-head"><h2>${d.selfOnly ? 'My KPIs' : `${d.dept?.name || 'Company'} KPIs`}</h2><span class="small muted">Click a tile for definition and trend</span></div>
        ${d.tiles.length ? html`<div class="grid grid-4" style="margin-top:14px">${d.tiles.map((t) => tileCard(t, `/kpi/${t.key}?scope=${d.selfOnly ? 'employee' : 'department'}&id=${d.selfOnly ? v.user.id : d.dept?.id || ''}`))}</div>` : empty('No KPIs defined for this department yet.')}</section>
      <section class="card"><div class="card-head"><h2>Trend: ${d.chart.def.name}</h2><form method="get" action="/analytics" class="row">${when(d.dept, () => html`<input type="hidden" name="dept" value="${d.dept?.id}">`)}${when(d.selfOnly, () => html`<input type="hidden" name="me" value="1">`)}<select class="input" name="kpi" data-autosubmit style="min-height:36px;width:auto">${d.keys.map((k) => html`<option value="${k}" ${when(k === d.selected, 'selected')}>${k.replace(/_/g, ' ')}</option>`)}</select></form></div>
        <div style="margin-top:12px">${lineChart([{ name: d.chart.def.name, points: d.chart.series, colour }], { unitFormat: (x) => formatValue(d.chart.def.unit, x), target: d.chart.target })}</div></section>
      ${when(d.people.length, () => html`<section class="card"><div class="card-head"><h2>By person</h2><span class="small muted">${d.people.length} people · last 7 days</span></div>
        <div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Person</th>${d.keys.filter((k) => d.people[0].values.some((x) => x.key === k)).map((k) => html`<th>${k.replace(/_/g, ' ')}</th>`)}</tr></thead>
        <tbody>${d.people.map((p) => html`<tr><td><a href="/people/${p.emp.id}">${p.emp.full_name}</a><br><span class="xs muted">${p.emp.designation}</span></td>${p.values.map((x) => html`<td><span class="row" style="gap:6px;flex-wrap:nowrap"><span class="dot dot-${x.rag}"></span><b class="num">${x.display}</b></span></td>`)}</tr>`)}</tbody></table></div></section>`)}`
  });
}

export function targetsModal(v: View, keys: { key: string; name: string; target: string }[]): Raw {
  return modal({ title: 'Targets', body: html`<p class="small muted">Edit any KPI's company target from its own page.</p>${table(['KPI', 'Target'], keys.map((k) => [html`<a href="/kpi/${k.key}">${k.name}</a>`, k.target]))}` });
}

export { notice };
