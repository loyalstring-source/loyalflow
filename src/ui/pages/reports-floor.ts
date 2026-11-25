// Reports seen from above: one group of blocks per team with a status marker. A marker opens that team's panel,
// which holds its figures, a three-dimensional bar chart and its reports.
import { html, when, type Raw } from '../../lib/html.ts';
import { page, type View } from '../layout.ts';
import { button, pill, icon } from '../components.ts';
import { MENU_OF, type ReportDef, type ModuleId } from '../../modules/reports/engine.ts';
import { fmt, monthName, type Brief, type Row, type ChartCard, type Attention, type Tone } from '../../modules/brief/service.ts';

const C30 = Math.cos(Math.PI / 6);
const f1 = (n: number): string => n.toFixed(1);
/** Darker (f < 1) or lighter (f > 1) version of a colour, for the faces of a block. */
function shade(hex: string, f: number): string {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).map((c) => Math.round(f < 1 ? c * f : c + (255 - c) * (f - 1)));
  return '#' + n.map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}
type Pt = [number, number];
const pts = (a: Pt[]): string => a.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
/** A point on the floor (x, y) at height z, drawn from above at an angle. */
const iso = (ox: number, oy: number, u: number) => (x: number, y: number, z = 0): Pt => [ox + (x - y) * C30 * u, oy + (x + y) * 0.5 * u - z * u];
function box(p: (x: number, y: number, z?: number) => Pt, x: number, y: number, w: number, d: number, h: number, color: string, z0: number, cls = ''): Raw {
  const z1 = z0 + h;
  return html`<g class="${cls}"><polygon points="${pts([p(x, y + d, z1), p(x + w, y + d, z1), p(x + w, y + d, z0), p(x, y + d, z0)])}" fill="${shade(color, 0.82)}"></polygon><polygon points="${pts([p(x + w, y, z1), p(x + w, y + d, z1), p(x + w, y + d, z0), p(x + w, y, z0)])}" fill="${shade(color, 0.64)}"></polygon><polygon points="${pts([p(x, y, z1), p(x + w, y, z1), p(x + w, y + d, z1), p(x, y + d, z1)])}" fill="${color}"></polygon></g>`;
}

const COLORS: Record<string, string> = { SAL: '#B8651B', SUP: '#0B5CAB', DEV: '#5B4B9E', PRD: '#6B6B6B', HR: '#2E6B4A', ACC: '#8A5A00', QA: '#0B3E78', PRE: '#9A4D7A', DM: '#2B7A8C', LEAD: '#444444' };
const MODULES: Record<string, ModuleId[]> = { SAL: ['sales'], SUP: ['support'], DEV: ['dev'], PRD: ['production'], HR: ['attendance', 'hiring', 'appraisals'], ACC: ['finance', 'approvals'] };
const TONE_COLOR: Record<Tone, string> = { good: '#2E6B4A', warn: '#8A5A00', crit: '#B3261E', ink: '#747474' };
const TONE_WORD: Record<Tone, string> = { good: 'On course', warn: 'Watch', crit: 'Behind', ink: 'No data yet' };
const RANK: Record<Tone, number> = { crit: 3, warn: 2, good: 1, ink: 0 };

interface Team { code: string; name: string; head: string | null; rows: Row[]; charts: ChartCard[]; attention: Attention[]; tone: Tone; reports: ReportDef[]; menu: string }

function teamsOf(b: Brief, reports: ReportDef[]): Team[] {
  const out: Team[] = [];
  for (const r of b.rows) {
    let t = out.find((x) => x.code === r.teamCode);
    if (!t) { t = { code: r.teamCode, name: r.team, head: r.head, rows: [], charts: [], attention: [], tone: 'ink', reports: [], menu: '' }; out.push(t); }
    t.rows.push(r);
  }
  for (const t of out) {
    t.charts = b.charts.filter((c) => c.teamCode === t.code || (c.teamCode === 'HIRE' && t.rows.some((r) => r.m.key === 'roles_filled')));
    const names = new Set([t.name, ...t.charts.map((c) => c.team)]);
    t.attention = b.attention.filter((a) => names.has(a.team));
    const tones: Tone[] = [...t.rows.map((r) => r.tone), ...t.attention.map((a) => a.tone)];
    t.tone = tones.reduce<Tone>((a, x) => (RANK[x] > RANK[a] ? x : a), 'ink');
    const mods = MODULES[t.code] || [];
    t.reports = reports.filter((r) => mods.includes(r.module)); t.menu = mods.length ? MENU_OF[mods[0]] : '';
    if (!t.reports.length) t.reports = reports.filter((r) => r.module === 'dsr');
  }
  return out;
}

/** Height of one week's block: that week's figure against the target (a monthly sum is spread over the weeks). */
function weekHeights(r: Row): (number | null)[] {
  const weekly = r.m.kind === 'sum' ? r.target.value / 4.33 : r.target.value;
  return r.weeks.slice(-4).map((v) => (v == null || !weekly ? null : Math.max(0.06, Math.min(1.5, v / weekly))));
}

function floor(teams: Team[]): Raw {
  const W = 940; const per = teams.length <= 4 ? teams.length : 4; const rowH = 252; const U = 30;
  // Rows of four and three, so the back row never hides behind the front one.
  const spots: Pt[] = []; let i = 0; let row = 0;
  while (i < teams.length) { const n = Math.min(teams.length - i, row % 2 === 0 ? per : Math.max(1, per - 1)); const gap = 210; const x0 = W / 2 - ((n - 1) * gap) / 2; for (let k = 0; k < n; k++) spots.push([x0 + k * gap, 150 + row * rowH]); i += n; row++; }
  const H = 150 + (row - 1) * rowH + 172; const t30 = Math.tan(Math.PI / 6);
  const grid: Raw[] = []; for (let k = -30; k < 60; k++) { const c = k * 30; grid.push(html`<line x1="0" y1="${c}" x2="${W}" y2="${f1(c + W * t30)}"></line><line x1="0" y1="${c}" x2="${W}" y2="${f1(c - W * t30)}"></line>`); }
  return html`<svg class="floor" viewBox="0 0 ${W} ${H}" role="group" aria-label="Teams seen from above. Each has a status marker that opens its figures.">
    <g class="floor-grid" aria-hidden="true">${grid}</g>
    ${teams.map((t, n) => {
      const p = iso(spots[n][0], spots[n][1], U); const color = COLORS[t.code] || '#0B3E78'; const hs = weekHeights(t.rows[0]);
      const tallest = Math.max(0.3, ...hs.map((h) => (h || 0) * 1.6));
      const top = p(1.5, 1.5, tallest + 1.75); const stem = p(1.5, 1.5, tallest + 0.5); const lab = p(3, 3, 0);
      const first = t.rows[0]; const figure = `${fmt(first.m.unit, first.mtd)}${first.pctOfTarget == null ? '' : ` · ${Math.round(first.pctOfTarget)}% of target`}`;
      return html`<a class="floor-team" href="#team-${t.code}" data-team="${t.code}" aria-label="${t.name}: ${TONE_WORD[t.tone]}${t.attention.length ? `, ${t.attention.length} need attention` : ''}. ${first.m.name} ${figure}. Open figures.">
        <polygon class="floor-hit" points="${pts([p(-0.4, -0.4), p(3.4, -0.4), p(3.4, 3.4), p(-0.4, 3.4)])}"></polygon>
        ${box(p, 0, 0, 3, 3, 0.3, '#FFFFFF', 0, 'floor-slab')}
        ${hs.map((h, k) => box(p, 0.35 + (k % 2) * 1.25, 0.35 + Math.floor(k / 2) * 1.25, 0.85, 0.85, h == null ? 0.08 : h * 1.6, h == null ? '#C9C9C9' : color, 0.3))}
        <line x1="${f1(top[0])}" y1="${f1(top[1])}" x2="${f1(stem[0])}" y2="${f1(stem[1])}" stroke="${TONE_COLOR[t.tone]}" stroke-width="1.5" stroke-dasharray="2 3"></line>
        <g class="hotspot" style="color:${TONE_COLOR[t.tone]}"><circle class="hs-sel" cx="${f1(top[0])}" cy="${f1(top[1])}" r="27"></circle><circle class="hs-pulse" cx="${f1(top[0])}" cy="${f1(top[1])}" r="20"></circle><circle class="hs-mid" cx="${f1(top[0])}" cy="${f1(top[1])}" r="13"></circle><circle class="hs-dot" cx="${f1(top[0])}" cy="${f1(top[1])}" r="9"></circle>${when(t.attention.length, () => html`<text x="${f1(top[0])}" y="${f1(top[1] + 3.7)}" text-anchor="middle">${t.attention.length}</text>`)}</g>
        <text class="floor-name" x="${f1(lab[0])}" y="${f1(lab[1] + 20)}" text-anchor="middle">${t.name}</text><text class="floor-fig" x="${f1(lab[0])}" y="${f1(lab[1] + 36)}" text-anchor="middle">${figure}</text>
      </a>`; })}
  </svg>`;
}

const short = (n: number, money?: boolean): string => {
  const a = Math.abs(n); const f = (x: number): string => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));
  return money && a >= 1e5 ? (a >= 1e7 ? f(n / 1e7) + ' Cr' : f(n / 1e5) + ' L') : a >= 1e4 ? f(n / 1e3) + 'k' : String(Math.round(n * 10) / 10);
};
function niceTop(max: number): number { if (max <= 0) return 1; const step = Math.pow(10, Math.floor(Math.log10(max))); const m = max / step; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * step; }

/** Bars with depth. Every bar carries its figure, because a bar seen at an angle is hard to read against the scale. */
function bars3d(c: ChartCard): Raw {
  const labels = c.labels.slice(-8); const series = c.series.slice(0, 2).map((s) => s.slice(-8)); const n = labels.length; const k = series.length;
  if (!n) return html``;
  const colors = ['#0B5CAB', '#8FC1F2']; const W = 388, Hh = 232, PW = 300, PH = 120, D = 16; const top = c.top || niceTop(Math.max(1, ...series.flat()));
  const P = (x: number, d: number, z: number): Pt => [58 + x + d * 0.55, Hh - 44 - z - d * 0.32];
  const span = PW / n; const bw = Math.min(26, (span * 0.66 - (k - 1) * 3) / k); const group = bw * k + (k - 1) * 3;
  // Money is shown in one unit for the whole chart (lakh or crore), named in the legend, so the figures on the bars stay short.
  const money = !!c.money; const div = money ? (top >= 2e7 ? 1e7 : top >= 1e5 ? 1e5 : 1) : 1; const unit = money ? (div === 1e7 ? '₹ crore' : div === 1e5 ? '₹ lakh' : '₹') : c.unit || '';
  const lab = (v: number): string => { const x = v / div; return div > 1 ? (x >= 10 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, '')) : short(v); };
  return html`<svg class="bars3d" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${c.title}. ${series.map((s, j) => `${c.names[j] || ''}: ${labels.map((l, i) => `${l} ${lab(s[i] || 0)}`).join(', ')}`).join('. ')}">
    ${[0, 1, 2, 3, 4].map((t) => { const z = (PH * t) / 4; const a = P(0, D, z), b = P(PW + 6, D, z), o = P(0, 0, z); return html`<line class="b3-grid" x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(b[0])}" y2="${f1(b[1])}"></line><line class="b3-grid" x1="${f1(o[0])}" y1="${f1(o[1])}" x2="${f1(a[0])}" y2="${f1(a[1])}"></line><text class="b3-axis" x="${f1(o[0] - 6)}" y="${f1(o[1] + 4)}" text-anchor="end">${lab((top * t) / 4)}</text>`; })}
    <polygon class="b3-floor" points="${pts([P(0, 0, 0), P(PW + 6, 0, 0), P(PW + 6, D, 0), P(0, D, 0)])}"></polygon>
    ${labels.map((l, i) => html`${series.map((s, j) => {
      const v = Math.max(0, s[i] || 0); const x = i * span + (span - group) / 2 + j * (bw + 3); const z = Math.max(v > 0 ? 2 : 0, (v / top) * PH); const col = colors[j]; const d = D - 4;
      return html`<g><title>${l}${c.names[j] ? `, ${c.names[j]}` : ''}: ${lab(v)}</title><polygon points="${pts([P(x + bw, 0, 0), P(x + bw, d, 0), P(x + bw, d, z), P(x + bw, 0, z)])}" fill="${shade(col, 0.62)}"></polygon><polygon points="${pts([P(x, 0, z), P(x + bw, 0, z), P(x + bw, d, z), P(x, d, z)])}" fill="${shade(col, 1.35)}"></polygon><polygon points="${pts([P(x, 0, 0), P(x + bw, 0, 0), P(x + bw, 0, z), P(x, 0, z)])}" fill="${col}"></polygon>
        ${when(n * k <= 14, () => html`<text class="b3-val" x="${f1(P(x + bw / 2, d, z)[0] - 2)}" y="${f1(P(x, d, z)[1] - 4 - (k > 1 && j === 0 && n > 4 ? 9 : 0))}" text-anchor="middle">${lab(v)}</text>`)}</g>`; })}
      <text class="b3-axis" x="${f1(P(i * span + span / 2, 0, 0)[0])}" y="${f1(P(0, 0, 0)[1] + 16)}" text-anchor="middle">${l.length > 9 ? l.slice(0, 8) + '…' : l}</text>`)}
  </svg>
  <div class="b3-legend">${series.map((_, j) => html`<span><i style="background:${colors[j]}"></i>${(c.names[j] || '').replace(' (dashed)', '')}</span>`)}${when(unit, () => html`<span class="muted">${unit}</span>`)}${when(c.note, () => html`<span class="muted">${c.note}</span>`)}</div>`;
}

function panel(t: Team): Raw {
  const main = t.charts[0]; const tone = t.tone === 'ink' ? 'ink' : t.tone;
  return html`<aside class="card floor-panel" id="team-${t.code}" tabindex="-1" aria-label="${t.name}">
    <div class="card-head"><h2 style="gap:10px"><span class="sq sq-sm" style="background:${COLORS[t.code] || '#0B3E78'}">${icon('chart', 16)}</span><span>${t.name}${when(t.head, () => html`<br><span class="small muted" style="font-weight:400">${t.head}</span>`)}</span></h2><span style="display:flex;align-items:center;gap:8px">${pill(TONE_WORD[t.tone], tone)}<a class="btn btn-ghost btn-sm" href="#floor" aria-label="Close">${icon('x', 14)}</a></span></div>
    <div class="fp-figs">${t.rows.map((r) => html`<div><span class="kpi-label">${r.m.name}</span><b class="kpi-value num">${fmt(r.m.unit, r.mtd)}</b><span class="small fp-${r.tone}">${r.pctOfTarget == null ? r.outlook : `${Math.round(r.pctOfTarget)}% of target · ${r.outlook}`}</span></div>`)}</div>
    ${t.charts.map((c) => html`<div class="fp-chart"><h3>${c.title}</h3>${bars3d(c)}</div>`)}
    ${when(!t.charts.length, () => html`<p class="small muted" style="padding:0 16px">Nothing to draw for this team yet.</p>`)}
    ${when(t.attention.length, () => html`<div class="fp-sub">Needs attention</div>${t.attention.map((a) => html`<a class="fp-line" href="${a.href}"><span>${pill(a.tag, a.tone)} ${a.title}</span></a>`)}`)}
    ${when(t.reports.length, () => html`<div class="fp-sub">Reports for this team</div>${t.reports.slice(0, 5).map((r) => html`<a class="fp-line" href="/reports/${r.key}"><span>${r.title}</span></a>`)}`)}
    <div class="fp-foot">${when(main, () => button('Open full report', { href: main!.report, kind: 'primary' }))}${when(t.reports.length > 5 && t.menu, () => button(`All ${t.reports.length} reports`, { href: `/reports?module=${t.menu}` }))}</div>
  </aside>`;
}

export function reportsFloorPage(v: View, d: { brief: Brief; reports: ReportDef[] }): Raw {
  const teams = teamsOf(d.brief, d.reports); const order = [...teams].sort((a, b) => RANK[b.tone] - RANK[a.tone] || b.attention.length - a.attention.length);
  return page(v, {
    title: 'Reports', navTab: 'reports:company',
    subtitle: `${monthName(d.brief.month, true)} · the company seen from above. Click a marker to open that team.`,
    actions: button(`Show as a list (${d.reports.length})`, { href: '/reports?view=list' }),
    body: html`<div class="floor-wrap" id="floor">
      <section class="card floor-stage"><div class="floor-key"><span class="small muted">Each block is one of the last four weeks against target · the number on a marker is how many items need attention</span><span class="b3-legend">${(['good', 'warn', 'crit'] as Tone[]).map((k) => html`<span><i style="background:${TONE_COLOR[k]};border-radius:50%"></i>${TONE_WORD[k]}</span>`)}</span></div>${floor(teams)}</section>
      <div class="floor-side">
        <aside class="card floor-hint"><div class="card-head"><h2>Where to look first</h2></div>
          ${order.slice(0, 6).map((t) => html`<a class="fp-line" href="#team-${t.code}"><span>${pill(TONE_WORD[t.tone], t.tone)} <b>${t.name}</b></span><span class="small muted">${t.attention.length ? `${t.attention.length} need attention` : fmt(t.rows[0].m.unit, t.rows[0].mtd)}</span></a>`)}
          <p class="small muted" style="padding:10px 16px;margin:0">Click a marker on the left, or a team here, to see its figures and a chart.</p></aside>
        ${teams.map(panel)}
      </div></div>
      <script>(function () {
        function sync() { var id = (location.hash || '').slice(1); document.querySelectorAll('.floor-team').forEach(function (a) { a.classList.toggle('on', 'team-' + a.getAttribute('data-team') === id); }); }
        window.addEventListener('hashchange', sync); sync();
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && /^#team-/.test(location.hash)) location.hash = 'floor'; });
      })();</script>`
  });
}
