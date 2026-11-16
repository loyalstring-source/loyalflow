// Company overview: what needs attention, one line per measure, and the same teams by week and by month.
// The three views change by themselves so the page can sit on a wall display.
import { html, when, raw, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { button, icon, pill, empty } from '../components.ts';
import { fmtDateFull, relativeAge } from '../../lib/time.ts';
import { fmt, monthName, dayLabel, type ChartCard, type Brief, type Row, type Tone, type BriefSettings, type Unit } from '../../modules/brief/service.ts';

const A = 'var(--accent)'; const LIGHT = '#8FC1F2';
const TEAM_ICON: Record<string, [string, string]> = { SAL: ['star', 'orange'], SUP: ['ticket', 'blue'], DEV: ['code', 'violet'], QA: ['check', 'violet'], PRD: ['factory', 'grey'], HR: ['people', 'green'], ACC: ['rupee', 'amber'], PRE: ['phone', 'orange'], DM: ['grid', 'navy'], HIRE: ['user', 'navy'] };
const TONE_PILL: Record<Tone, 'good' | 'warn' | 'crit' | 'ink'> = { good: 'good', warn: 'warn', crit: 'crit', ink: 'ink' };
const n1 = (x: number): string => x.toFixed(1);
const meter = (p: number | null, tone: Tone = 'good'): Raw => html`<span class="meter" role="img" aria-label="${p ?? 0} percent"><span style="width:${Math.max(0, Math.min(100, p ?? 0))}%;${tone === 'crit' ? 'background:var(--crit)' : tone === 'warn' ? 'background:var(--warn)' : ''}"></span></span>`;
const delta = (kind: 'up' | 'dn' | 'flat', text: string): Raw => html`<span class="bf-${kind}">${kind === 'up' ? '▲' : kind === 'dn' ? '▼' : '■'} ${text}</span>`;
/** Change between two figures, worded so that better is ▲ green and worse is ▼ red whatever the direction. */
function change(unit: Unit, now: number | null, before: number | null, better: 'up' | 'down' = 'up'): Raw {
  if (now == null || before == null) return html`<span class="small muted">—</span>`;
  const d = now - before; if (Math.abs(d) < (unit === 'inr' ? 1 : 0.05)) return delta('flat', 'about the same');
  const good = better === 'up' ? d > 0 : d < 0; const size = unit === 'pct' ? `${Math.round(Math.abs(d) * 10) / 10} points` : fmt(unit, Math.abs(d));
  return delta(good ? 'up' : 'dn', `${size} ${d > 0 ? 'more' : 'less'}`);
}

function spark(vals: (number | null)[], w = 120, h = 30): Raw {
  const pts = vals.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null); if (pts.length < 2) return html`<span class="small muted">Not enough data</span>`;
  const lo = Math.min(...pts.map((p) => p.v)); const hi = Math.max(...pts.map((p) => p.v)); const r = hi - lo || 1;
  const xy = pts.map((p) => [(p.i * w) / (vals.length - 1), h - 4 - ((p.v - lo) / r) * (h - 8)]);
  return html`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Last 8 weeks: ${pts.map((p) => Math.round(p.v * 10) / 10).join(', ')}"><path d="${xy.map(([x, y], i) => `${i ? 'L' : 'M'}${n1(x)} ${n1(y)}`).join(' ')}" fill="none" stroke="${A}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="${n1(xy[xy.length - 1][0])}" cy="${n1(xy[xy.length - 1][1])}" r="3" fill="${A}" stroke="#fff" stroke-width="1.5"></circle></svg>`;
}
function miniCols(vals: (number | null)[], labels: string[], unit: Unit, w = 132, h = 34): Raw {
  const m = Math.max(...vals.map((v) => v || 0)) || 1; const slot = w / vals.length; const bw = slot * 0.56; const last = vals.reduce((a: number, v, i) => (v != null ? i : a), -1);
  return html`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${labels.map((l, i) => `${l}: ${fmt(unit, vals[i])}`).join('; ')}">${vals.map((v, i) => { const bh = v == null ? 0 : Math.max(2, ((v || 0) / m) * (h - 2)); return html`<rect x="${n1(i * slot + (slot - bw) / 2)}" y="${n1(h - bh)}" width="${n1(bw)}" height="${n1(bh)}" rx="2" fill="${i === last ? 'var(--deep)' : A}"><title>${labels[i]}: ${fmt(unit, v)}</title></rect>`; })}<line x1="0" x2="${w}" y1="${h - 0.5}" y2="${h - 0.5}" stroke="var(--line2)"></line></svg>`;
}
const nice = (m: number): number => { if (m <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(m))); return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((c) => c * p).find((x) => x >= m)!; };
const lakh = (v: number): string => (v >= 1e7 ? `${n1(v / 1e7).replace(/\.0$/, '')} Cr` : v >= 1e5 ? `${n1(v / 1e5).replace(/\.0$/, '')} L` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v * 10) / 10));
function cols(labels: string[], series: number[][], colors: string[], names: string[], o: { w?: number; h?: number; money?: boolean; top?: number } = {}): Raw {
  const w = o.w || 340; const h = o.h || 150; const L = 40, R = 6, T = 14, B = 22; const pw = w - L - R, ph = h - T - B; const n = labels.length; const k = series.length;
  const top = o.top || nice(Math.max(1, ...series.flat())); const slot = pw / n; const bw = Math.min(18, (slot * 0.62) / k); const f = (v: number): string => (o.money ? lakh(v) : String(Math.round(v * 10) / 10));
  return html`<svg class="bf-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${names.map((nm, j) => `${nm}: ${labels.map((l, i) => `${l} ${f(series[j][i])}`).join(', ')}`).join('. ')}">
    ${[0, 0.5, 1].map((g) => html`<line x1="${L}" x2="${w - R}" y1="${n1(T + ph - g * ph)}" y2="${n1(T + ph - g * ph)}" stroke="var(--line2)"></line><text class="bf-ax" x="${L - 5}" y="${n1(T + ph - g * ph + 3.5)}" text-anchor="end">${f(top * g)}</text>`)}
    ${labels.map((lab, i) => { const x0 = L + slot * i + (slot - (bw * k + 2 * (k - 1))) / 2;
      return html`${series.map((s, j) => { const v = s[i] || 0; const bh = v > 0 ? Math.max(2, (v / top) * ph) : 0; const x = x0 + j * (bw + 2); const y = T + ph - bh; const r = Math.min(3, bh);
        return html`${when(bh > 0, () => html`<path d="M${n1(x)} ${T + ph}V${n1(y + r)}q0 ${-r} ${r} ${-r}h${n1(bw - 2 * r)}q${r} 0 ${r} ${r}V${T + ph}z" fill="${colors[j]}"><title>${lab} · ${names[j]}: ${f(v)}</title></path>`)}${when(k === 1 && n <= 8 && bh > 0, () => html`<text class="bf-vl" x="${n1(x + bw / 2)}" y="${n1(y - 4)}" text-anchor="middle">${f(v)}</text>`)}`; })}<text class="bf-ax" x="${n1(L + slot * i + slot / 2)}" y="${h - 6}" text-anchor="middle">${lab}</text>`; })}
  </svg>`;
}
function lines(labels: string[], series: number[][], colors: string[], names: string[], o: { w?: number; h?: number } = {}): Raw {
  const w = o.w || 400; const h = o.h || 180; const L = 40, R = 14, T = 16, B = 22; const pw = w - L - R, ph = h - T - B; const n = labels.length; const all = series.flat();
  const hi = nice(Math.max(1, ...all)); const lo0 = Math.min(...all); const lo = lo0 > hi * 0.45 ? Math.floor((lo0 * 0.8) / (hi / 10)) * (hi / 10) : 0;
  const X = (i: number): number => L + (pw * i) / Math.max(1, n - 1); const Y = (v: number): number => T + ph - ((v - lo) / (hi - lo || 1)) * ph; const f = (v: number): string => String(Math.round(v * 10) / 10);
  const ends = series.map((sr) => Y(sr[n - 1])); const clash = series.length > 1 && Math.abs(ends[0] - ends[1]) < 16;
  return html`<svg class="bf-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${names.map((nm, j) => `${nm}: ${labels.map((l, i) => `${l} ${f(series[j][i])}`).join(', ')}`).join('. ')}">
    ${[0, 0.5, 1].map((g) => html`<line x1="${L}" x2="${w - R}" y1="${n1(T + ph - g * ph)}" y2="${n1(T + ph - g * ph)}" stroke="var(--line2)"></line><text class="bf-ax" x="${L - 5}" y="${n1(T + ph - g * ph + 3.5)}" text-anchor="end">${f(lo + (hi - lo) * g)}</text>`)}
    ${series.map((sr, j) => html`<path d="${sr.map((v, i) => `${i ? 'L' : 'M'}${n1(X(i))} ${n1(Y(v))}`).join(' ')}" fill="none" stroke="${colors[j]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${j ? raw('stroke-dasharray="5 4"') : ''}></path>
      ${sr.map((v, i) => html`<circle cx="${n1(X(i))}" cy="${n1(Y(v))}" r="${i === n - 1 ? 3.5 : 7}" fill="${i === n - 1 ? colors[j] : 'transparent'}" stroke="${i === n - 1 ? '#fff' : 'none'}" stroke-width="2"><title>${labels[i]} · ${names[j]}: ${f(v)}</title></circle>`)}
      <text class="bf-vl" x="${n1(X(n - 1) - 6)}" y="${n1(ends[j] + (clash ? (ends[j] >= ends[1 - j] ? 16 : -8) : -8))}" text-anchor="end">${f(sr[n - 1])}</text>`)}
    ${labels.map((lab, i) => html`<text class="bf-ax" x="${n1(X(i))}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${lab}</text>`)}
  </svg>`;
}
function hbars(labels: string[], vals: number[]): Raw {
  const m = Math.max(1, ...vals);
  return html`<div class="bf-hb" role="img" aria-label="${labels.map((l, i) => `${l}: ${vals[i]}`).join('; ')}">${labels.map((l, i) => html`<div title="${l}: ${vals[i]}"><span class="small muted">${l}</span><span class="bf-hb-track"><i style="width:${n1((vals[i] / m) * 100)}%"></i></span><b class="num">${vals[i]}</b></div>`)}</div>`;
}
const GREY = '#6B6B6B';
function chartCard(c: ChartCard): Raw {
  const [ic, tone] = TEAM_ICON[c.teamCode] || ['chart', 'grey']; const two = c.series.length > 1;
  const body = c.type === 'lines' ? lines(c.labels, c.series, [A, GREY], c.names) : c.type === 'hbars' ? hbars(c.labels, c.series[0]) : cols(c.labels, c.series, [A, LIGHT], c.names, { w: 400, h: 180, money: c.money, top: c.top });
  return html`<section class="card bf-card"><div class="bf-card-head"><span class="bf-team"><span class="sq sq-sm sq-${tone}">${icon(ic, 16)}</span><span><span class="small muted">${c.team}</span><br><b>${c.title}</b></span></span><a href="${c.report}">Open report</a></div>
    <div class="bf-card-big"><b class="num">${c.big}</b>${c.subTone === 'muted' ? html`<span class="small muted">${c.sub}</span>` : delta(c.subTone, c.sub)}</div>
    <div class="bf-card-body">${body}</div>
    <div class="bf-card-foot">${two ? legend(c.type === 'lines' ? [[A, c.names[0]], [GREY, c.names[1]]] : [[A, c.names[0]], [LIGHT, c.names[1]]], c.unit || '') : html`<span class="small muted">${c.note || (c.unit ? c.unit : '')}</span>`}</div></section>`;
}
const chartWall = (b: Brief): Raw => html`${when(b.charts.length, () => html`<div class="bf-cards">${b.charts.map(chartCard)}</div>`)}${when(b.noCharts.length, () => html`<p class="small muted" style="margin:0">No figures to draw yet for ${b.noCharts.join(', ')}. Their graphs appear once they start their daily review.</p>`)}`;
const legend = (items: [string, string][], unit = ''): Raw => html`<div class="bf-legend">${items.map(([c, t]) => html`<span><i style="background:${c}"></i>${t}</span>`)}${when(unit, () => html`<span class="muted">${unit}</span>`)}</div>`;

function teamCell(r: Row, first: boolean): Raw {
  const [ic, tone] = TEAM_ICON[r.teamCode] || ['chart', 'grey'];
  return html`<td>${first ? html`<span class="bf-team"><span class="sq sq-sm sq-${tone}">${icon(ic, 16)}</span><span><a href="/dsr?team=${r.teamId}"><b>${r.team}</b></a><br><span class="small muted">${r.head || 'No head set'}</span></span></span>` : ''}</td>`;
}
const firsts = (rows: Row[]): boolean[] => rows.map((r, i) => i === 0 || rows[i - 1].teamId !== r.teamId);
const attnList = (b: Brief): Raw => html`${b.attention.map((a) => html`<a class="bf-attn" href="${a.href}">${pill(a.tag, a.tone)}<span class="bf-attn-main"><b>${a.title}</b><span class="small muted">${a.sub}</span></span><span class="small muted" style="white-space:nowrap">${a.team}</span></a>`)}`;
const kpi = (label: string, value: string, sub: Raw | string, bar?: Raw): Raw => html`<div class="kpi"><span class="kpi-label">${label}</span><b class="kpi-value num">${value}</b><span class="small">${sub}</span>${bar || ''}</div>`;
const figure = (k: string, v: string, sub: Raw | string = ''): Raw => html`<div class="bf-fig"><span class="small muted">${k}</span><b class="num">${v}</b>${sub}</div>`;

// ---------- view 1: today ----------
function todayView(b: Brief, approvals: { id: string; title: string; created_at: string }[], company: boolean): Raw {
  const f = firsts(b.rows);
  return html`${chartWall(b)}<div class="bf-grid"><div class="bf-main">
      <section class="card"><div class="card-head"><h2>What needs your attention</h2><span class="small muted">${b.attention.length ? `${b.attention.length} item${b.attention.length === 1 ? '' : 's'}, worst first` : ''}${when(b.quiet, () => html`${b.attention.length ? ' · ' : ''}${b.quiet} team${b.quiet === 1 ? ' has' : 's have'} nothing to flag`)}</span></div>
        ${b.attention.length ? html`<div class="bf-attns">${attnList(b)}</div>` : html`<p class="small muted" style="margin:0">Nothing is behind or late right now.</p>`}</section>
      <section class="card"><div class="card-head"><h2>Every team in one line</h2><span class="small muted">${monthName(b.month, true)}, so far</span></div>
        <div class="table-wrap"><table class="bf-table"><thead><tr><th>Team</th><th>This month so far</th><th>Against target</th><th>Last 8 weeks</th><th>Daily review today</th><th>Status</th><th></th></tr></thead><tbody>
        ${b.rows.map((r, i) => html`<tr class="${f[i] ? 'bf-first' : ''}">${teamCell(r, f[i])}<td><span class="small muted">${r.m.name}</span><br><b class="num bf-big">${fmt(r.m.unit, r.mtd)}</b></td>
          <td class="bf-w150">${meter(r.pctOfTarget, r.tone === 'ink' ? 'good' : r.tone)}<span class="small muted">${r.pctOfTarget == null ? 'No data yet' : `${r.pctOfTarget}% of ${fmt(r.m.unit, r.target.value)}`}</span></td><td>${spark(r.weeks)}</td>
          <td class="bf-w180">${f[i] && r.dsrToday ? html`${meter(r.dsrToday.total ? Math.round((r.dsrToday.done / r.dsrToday.total) * 100) : 0)}<span class="small muted">${r.dsrToday.text}</span>` : f[i] ? html`<span class="small muted">Not held</span>` : ''}</td>
          <td>${pill(r.status, TONE_PILL[r.tone])}</td><td style="text-align:right"><a href="${r.m.report}">Report</a></td></tr>`)}
        </tbody></table></div>${when(!b.rows.length, () => empty('No team has a measure yet.', '📊'))}</section>
    </div><div class="bf-side">
      ${when(b.people, () => { const p = b.people!; return html`<section class="card"><div class="card-head"><h2>People today</h2><a class="small" href="/attendance">Attendance</a></div><div class="bf-figs">${figure('At work', String(p.atWork), html`<span class="small muted">of ${p.heads}</span>`)}${figure('On leave', String(p.onLeave))}${figure('Late', String(p.late))}${figure('Not in', String(p.notIn))}</div>${meter(p.heads ? Math.round((p.atWork / p.heads) * 100) : 0)}</section>`; })}
      ${when(company, () => html`<section class="card"><div class="card-head"><h2>Awaiting your approval</h2>${when(approvals.length, () => html`<a class="small" href="/approvals">See all ${approvals.length}</a>`)}</div>
        ${approvals.length ? html`<div class="bf-attns">${approvals.slice(0, 4).map((t) => html`<a class="bf-attn" href="/approvals"><span class="bf-attn-main"><b>${t.title}</b><span class="small muted">Waiting ${relativeAge(t.created_at)}</span></span><span class="btn btn-sm">Open</span></a>`)}</div>` : html`<p class="small muted" style="margin:0">Nothing is waiting for you.</p>`}</section>`)}
    </div></div>`;
}

// ---------- view 2: this week ----------
function weekView(b: Brief): Raw {
  const w = b.week; const f = firsts(b.rows); const dl = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return html`<div class="kpis">
      ${kpi('Sales won this week', fmt('inr', w.won[0]), change('inr', w.won[0], w.won[1]))}
      ${kpi('Collected this week', fmt('inr', w.collected[0]), html`<span class="muted">of ${fmt('inr', w.expected)} expected</span>`, meter(w.expected ? Math.round((w.collected[0] / w.expected) * 100) : 0))}
      ${kpi('Tickets closed', String(w.closed[0]), change('count', w.closed[0], w.closed[1]))}
      ${kpi('Orders dispatched', String(w.dispatched[0]), w.dispatched[0] ? html`<span class="muted">${w.onTime} of ${w.dispatched[0]} on time</span>` : html`<span class="muted">last week ${w.dispatched[1]}</span>`)}
      ${kpi('Daily review lines done', fmt('pct', w.dsr[0]), change('pct', w.dsr[0], w.dsr[1]))}
    </div>
    <div class="bf-grid"><div class="bf-main"><section class="card"><div class="card-head"><h2>Every team this week</h2><span class="small muted">${dayLabel(b.weekFrom)} to ${dayLabel(b.weekTo)}, against ${dayLabel(b.lastFrom)} to ${dayLabel(b.lastTo)}</span></div>
      <div class="table-wrap"><table class="bf-table"><thead><tr><th>Team</th><th>This week</th><th>Last week</th><th>Change</th><th>Day by day</th><th>Daily review, whole week</th><th>Status</th></tr></thead><tbody>
      ${b.rows.map((r, i) => html`<tr class="${f[i] ? 'bf-first' : ''}">${teamCell(r, f[i])}<td><span class="small muted">${r.m.name}</span><br><b class="num bf-big">${fmt(r.m.unit, r.week)}</b></td><td class="num">${fmt(r.m.unit, r.lastWeek)}</td><td>${change(r.m.unit, r.week, r.lastWeek, r.m.direction === 'down' ? 'down' : 'up')}</td><td>${miniCols(r.days, dl, r.m.unit)}</td>
        <td class="bf-w180">${f[i] && r.dsrWeek ? (r.dsrWeek.total ? html`${meter(Math.round((r.dsrWeek.done / r.dsrWeek.total) * 100))}<span class="small muted">${r.dsrWeek.done} of ${r.dsrWeek.total} lines done</span>` : html`<span class="small muted">Nothing planned</span>`) : f[i] ? html`<span class="small muted">Not held</span>` : ''}</td><td>${pill(r.status, TONE_PILL[r.tone])}</td></tr>`)}
      </tbody></table></div></section></div>
    <div class="bf-side">
      <section class="card"><div class="card-head"><h2>Collections, day by day</h2></div>${cols(dl, [w.collByDay, w.expByDay], [A, LIGHT], ['Collected', 'Expected'], { money: true })}${legend([[A, 'Collected'], [LIGHT, 'Expected']], '₹')}</section>
      <section class="card"><div class="card-head"><h2>Brought forward 3 times or more</h2></div>${w.carried.length ? html`<div class="bf-attns">${w.carried.map((c) => html`<a class="bf-attn" href="${c.href}">${pill(`×${c.count}`, c.count > 3 ? 'crit' : 'warn')}<span class="bf-attn-main"><b>${c.title}</b><span class="small muted">${c.sub}</span></span><span class="small muted">${c.team}</span></a>`)}</div>` : html`<p class="small muted" style="margin:0">Nothing has been carried that often this week.</p>`}</section>
    </div></div>`;
}

// ---------- view 3: this month ----------
function projBar(r: Row): Raw {
  if (r.pctOfTarget == null || r.projectedPct == null) return html`<span class="small muted">No data yet</span>`;
  const a = r.m.kind === 'rate' ? r.projectedPct : r.pctOfTarget; const e = r.projectedPct; const scale = Math.max(120, e + 5, a + 5);
  return html`<span class="bf-proj" role="img" aria-label="Achieved ${a} percent of target, projected ${e} percent"><i class="bf-proj-e" style="width:${n1((e / scale) * 100)}%"></i><i class="bf-proj-a" style="width:${n1((a / scale) * 100)}%"></i><i class="bf-proj-t" style="left:${n1((100 / scale) * 100)}%"></i></span>`;
}
function cumChart(b: Brief): Raw {
  const mv = b.monthView; const w = 340, h = 170, L = 40, R = 10, T = 14, B = 22; const pw = w - L - R, ph = h - T - B; const N = mv.daysInMonth; const cur = mv.cum.length ? mv.cum[mv.cum.length - 1] : { day: 1, value: 0 };
  const top = nice(Math.max(1, mv.collTarget || 0, mv.collProjected || 0, cur.value) * 1.08); const X = (d: number): number => L + (pw * (d - 1)) / Math.max(1, N - 1); const Y = (v: number): number => T + ph - (v / top) * ph;
  const mo = monthName(b.month);
  return html`<svg class="bf-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Collected so far ${lakh(cur.value)}, projected ${lakh(mv.collProjected || 0)}, target ${lakh(mv.collTarget || 0)}">
    ${[0, 0.5, 1].map((g) => html`<line x1="${L}" x2="${w - R}" y1="${n1(Y(top * g))}" y2="${n1(Y(top * g))}" stroke="var(--line2)"></line><text class="bf-ax" x="${L - 5}" y="${n1(Y(top * g) + 3.5)}" text-anchor="end">${lakh(top * g)}</text>`)}
    ${when(mv.collTarget, () => html`<line x1="${n1(X(1))}" y1="${n1(Y(0))}" x2="${n1(X(N))}" y2="${n1(Y(mv.collTarget!))}" stroke="#6B6B6B" stroke-width="1.5" stroke-dasharray="2 4"></line><text class="bf-ax" x="${n1(X(N))}" y="${n1(Y(mv.collTarget!) - 6)}" text-anchor="end">Target ${lakh(mv.collTarget!)}</text>`)}
    ${when(mv.cum.length > 1, () => html`<path d="${mv.cum.map((p, i) => `${i ? 'L' : 'M'}${n1(X(p.day))} ${n1(Y(p.value))}`).join(' ')}" fill="none" stroke="${A}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>`)}
    ${when(mv.collProjected != null && cur.day < N, () => html`<line x1="${n1(X(cur.day))}" y1="${n1(Y(cur.value))}" x2="${n1(X(N))}" y2="${n1(Y(mv.collProjected!))}" stroke="${A}" stroke-width="2" stroke-dasharray="6 4"></line><circle cx="${n1(X(N))}" cy="${n1(Y(mv.collProjected!))}" r="3.5" fill="#fff" stroke="${A}" stroke-width="2"></circle>`)}
    <circle cx="${n1(X(cur.day))}" cy="${n1(Y(cur.value))}" r="3.5" fill="${A}" stroke="#fff" stroke-width="2"></circle>
    ${[1, 8, 15, 22, N].map((d) => html`<text class="bf-ax" x="${n1(X(d))}" y="${h - 6}" text-anchor="${d === N ? 'end' : d === 1 ? 'start' : 'middle'}">${d} ${mo}</text>`)}
  </svg>`;
}
function monthView(b: Brief, canSet: boolean): Raw {
  const f = firsts(b.rows); const mv = b.monthView; const key = b.rows.filter((r) => ['sales_won', 'collections', 'tickets_in_time', 'on_time_dispatch'].includes(r.m.key)).slice(0, 4); const tiles = key.length ? key : b.rows.slice(0, 4);
  return html`<div class="kpis">
      ${kpi('Targets on course', `${mv.onCourse} of ${b.rows.length}`, html`<span class="muted">projected to meet target</span>`, meter(b.rows.length ? Math.round((mv.onCourse / b.rows.length) * 100) : 0))}
      ${tiles.map((r) => kpi(r.m.name, fmt(r.m.unit, r.mtd), r.tone === 'ink' ? html`<span class="muted">target ${fmt(r.m.unit, r.target.value)}</span>` : delta(r.tone === 'good' ? 'up' : 'dn', `target ${fmt(r.m.unit, r.target.value)} · projected ${fmt(r.m.unit, r.projected)}`)))}
    </div>
    <div class="bf-grid"><div class="bf-main"><section class="card"><div class="card-head"><h2>Targets achieved and where the month will end</h2>${legend([[A, 'Achieved so far'], [LIGHT, 'Projected by month end'], ['#181818', 'Target']])}</div>
      <div class="table-wrap"><table class="bf-table"><thead><tr><th>Team</th><th>Measure and target</th><th>Achieved so far</th><th>Against target</th><th>Projected by ${dayLabel(`${b.month}-${String(mv.daysInMonth).padStart(2, '0')}`)}</th><th>Outlook</th></tr></thead><tbody>
      ${b.rows.map((r, i) => html`<tr class="${f[i] ? 'bf-first' : ''}">${teamCell(r, f[i])}<td><span class="small muted">${r.m.name}</span><br><span style="white-space:nowrap">Target <b class="num">${fmt(r.m.unit, r.target.value)}</b></span>${when(r.target.source === 'default', () => html`<br><span class="small muted">starting figure, not set yet</span>`)}</td>
        <td style="white-space:nowrap"><b class="num bf-big">${fmt(r.m.unit, r.mtd)}</b>${when(r.pctOfTarget != null, () => html` <span class="small muted">${r.pctOfTarget}%</span>`)}</td><td class="bf-w240">${projBar(r)}</td>
        <td style="white-space:nowrap"><b class="num bf-big">${fmt(r.m.unit, r.projected)}</b>${when(r.projectedPct != null, () => html` <span class="small muted">${r.projectedPct}%</span>`)}</td><td>${pill(r.outlook, TONE_PILL[r.tone])}</td></tr>`)}
      </tbody></table></div>
      <p class="small muted" style="margin:10px 0 0">Projection: for money and counts, what is achieved so far carried forward at this month's daily rate for the ${b.left} working day${b.left === 1 ? '' : 's'} left. For percentages, the rate so far.${when(canSet, () => html` <a href="/targets">Set targets</a>`)}</p></section></div>
    <div class="bf-side">
      ${when(mv.collTarget != null, () => html`<section class="card"><div class="card-head"><h2>Collections: on course for the month?</h2></div>${cumChart(b)}<div class="bf-figs" style="margin:6px 0 0">${figure('Collected so far', fmt('inr', mv.cum.length ? mv.cum[mv.cum.length - 1].value : 0))}${figure('Projected', fmt('inr', mv.collProjected))}${figure('Target', fmt('inr', mv.collTarget))}</div><span class="small muted">Solid line is collected so far; dashed is the projection.</span></section>`)}
      <section class="card"><div class="card-head"><h2>Targets met, last six months</h2></div>${cols(mv.met.map((x) => monthName(x.month)), [mv.met.map((x) => x.n)], [A], ['Targets met'], { h: 130, top: Math.max(1, ...mv.met.map((x) => x.of)) })}<span class="small muted">Out of ${Math.max(0, ...mv.met.map((x) => x.of))} measures · ${monthName(b.month)} is projected</span></section>
    </div></div>`;
}

export interface BriefPageData { brief: Brief; settings: BriefSettings; approvals: { id: string; title: string; created_at: string }[]; company: boolean; canSet: boolean; start: 'today' | 'week' | 'month'; now: Date }
export function briefPage(v: View, d: BriefPageData): Raw {
  const b = d.brief; const first = v.user.full_name.split(' ')[0]; const h = new Date(d.now.getTime() + 330 * 60000).getUTCHours();
  const views: [string, string][] = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']];
  return page(v, {
    title: d.company ? 'Company overview' : 'Team overview', navTab: 'overview',
    subtitle: html`${fmtDateFull(d.now)} · Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${first} · <span id="bf-what">today</span>`,
    actions: html`<div class="bf-ctl" data-seconds="${d.settings.seconds}" data-rotate="${d.settings.rotate ? '1' : '0'}" data-start="${d.start}">
      ${views.map(([k, label], i) => html`<button class="chip" type="button" data-bf-go="${k}">${i + 1} · ${label}</button>`)}
      <span class="bf-count"><span class="small muted" id="bf-left"></span><span class="meter bf-count-bar" aria-hidden="true"><span id="bf-bar" style="width:0%"></span></span></span>
      <button class="btn btn-sm" type="button" id="bf-pause" aria-pressed="false">Pause</button><button class="btn btn-sm" type="button" id="bf-full">Full screen</button>${when(d.canSet, () => button('Targets', { href: '/targets', size: 'sm' }))}</div>`,
    body: html`
      <div class="bf-view" data-bf-view="today" data-what="today">${todayView(b, d.approvals, d.company)}</div>
      <div class="bf-view" data-bf-view="week" data-what="this week, ${dayLabel(b.weekFrom)} to ${dayLabel(b.weekTo)}" hidden>${weekView(b)}</div>
      <div class="bf-view" data-bf-view="month" data-what="${monthName(b.month, true)}, working day ${b.elapsed} of ${b.workdays}" hidden>${monthView(b, d.canSet)}</div>
      ${raw(`<script>(function () {
        var ctl = document.querySelector('.bf-ctl'); if (!ctl) return;
        var order = ['today', 'week', 'month'], secs = Number(ctl.getAttribute('data-seconds')) || 60, auto = ctl.getAttribute('data-rotate') === '1';
        var paused = !auto, cur = Math.max(0, order.indexOf(ctl.getAttribute('data-start'))), left = secs;
        try { var s = sessionStorage.getItem('bf-paused'); if (s === '1') paused = true; if (s === '0' && auto) paused = false; } catch (e) {}
        var bar = document.getElementById('bf-bar'), txt = document.getElementById('bf-left'), pb = document.getElementById('bf-pause'), what = document.getElementById('bf-what');
        function show(i) {
          cur = (i + order.length) % order.length; left = secs;
          document.querySelectorAll('.bf-view').forEach(function (el) { var on = el.getAttribute('data-bf-view') === order[cur]; el.hidden = !on; if (on && what) what.textContent = el.getAttribute('data-what'); });
          document.querySelectorAll('[data-bf-go]').forEach(function (el) { el.classList.toggle('on', el.getAttribute('data-bf-go') === order[cur]); });
          draw();
        }
        function draw() {
          if (pb) { pb.textContent = paused ? 'Resume' : 'Pause'; pb.setAttribute('aria-pressed', paused ? 'true' : 'false'); }
          if (txt) txt.textContent = paused ? 'Paused' : 'Next view in ' + Math.floor(left / 60) + ':' + ('0' + (left % 60)).slice(-2);
          if (bar) bar.style.width = (paused ? 0 : (1 - left / secs) * 100) + '%';
        }
        setInterval(function () {
          if (paused || document.hidden) return; left -= 1;
          if (left <= 0) {
            // After a full round, fetch fresh figures and carry on from the first view.
            if (cur === order.length - 1) { try { sessionStorage.setItem('bf-paused', '0'); } catch (e) {} location.href = location.pathname + '?view=today'; return; }
            show(cur + 1);
          } else draw();
        }, 1000);
        document.addEventListener('click', function (e) {
          var go = e.target.closest && e.target.closest('[data-bf-go]'); if (go) { show(order.indexOf(go.getAttribute('data-bf-go'))); return; }
          if (e.target.id === 'bf-pause') { paused = !paused; try { sessionStorage.setItem('bf-paused', paused ? '1' : '0'); } catch (err) {} draw(); }
          if (e.target.id === 'bf-full') { if (document.fullscreenElement) document.exitFullscreen(); else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); }
        });
        document.addEventListener('fullscreenchange', function () { document.documentElement.classList.toggle('bf-wall', !!document.fullscreenElement); var f = document.getElementById('bf-full'); if (f) f.textContent = document.fullscreenElement ? 'Leave full screen' : 'Full screen'; });
        show(cur);
      })();</script>`)}`
  });
}
