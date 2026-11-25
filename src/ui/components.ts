// Small, dependency-free UI building blocks shared by every page.
import { html, raw, join, when, type Raw, type HtmlValue } from '../lib/html.ts';
import { initials } from '../modules/people/model.ts';
import type { Tile, Rag, SeriesPoint } from '../modules/kpi/engine.ts';
import type { SlaState } from '../modules/desk/service.ts';
import { fmtDuration } from '../lib/time.ts';

const ICONS: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"/><path d="M12 6v12"/>',
  code: '<path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/><path d="m14 4-4 16"/>',
  funnel: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  factory: '<path d="M3 21V9l6 4V9l6 4V5h6v16Z"/><path d="M7 17h2"/><path d="M12 17h2"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.5A5 5 0 0 1 22 19"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  checklist: '<path d="m4 7 2 2 4-4"/><path d="M12 7h8"/><path d="m4 14 2 2 4-4"/><path d="M12 15h8"/>',
  approval: '<path d="M9 12l2 2 4-4"/><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  pin: '<path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  star: '<path d="m12 3 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4L2.8 9.7l6.4-.8Z"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  flame: '<path d="M12 22c4.4 0 7-2.8 7-7 0-3-2-5.5-3.5-7-.5 2-1.5 3-2.5 3.5C13.5 9 12 6 9 3c0 3-1 5-2.5 7S5 13 5 15c0 4.2 2.6 7 7 7Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  truck: '<path d="M3 7h11v10H3Z"/><path d="M14 10h4l3 3v4h-7Z"/><circle cx="7" cy="18" r="1.5"/><circle cx="17" cy="18" r="1.5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  rupee: '<path d="M6 4h12"/><path d="M6 9h12"/><path d="M9 4c4 0 6 1.5 6 4.5S13 13 9 13H6l8 7"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v12H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0-4-4L4 16Z"/><path d="m13 6 4 4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 21h8"/><path d="M9 17h6v4H9Z"/>',
  warn: '<path d="M12 3 2 21h20Z"/><path d="M12 10v5"/><path d="M12 18h.01"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
  moon: '<path d="M21 13A8 8 0 1 1 11 3a6 6 0 0 0 10 10Z"/>'
};

export function icon(name: string, size = 20, cls = ''): Raw {
  const d = ICONS[name] || ICONS.grid;
  return raw(`<svg class="ico-${name} ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
}

export function pill(text: HtmlValue, tone: 'ink' | 'accent' | 'good' | 'warn' | 'crit' | 'violet' | 'coral' = 'ink', title = ''): Raw {
  return html`<span class="pill pill-${tone}" title="${title}">${text}</span>`;
}

export function dot(tone: Rag | 'accent'): Raw { return html`<span class="dot dot-${tone}"></span>`; }

const AVATAR_TONES = 6;
function toneFor(id: string): number { let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % AVATAR_TONES; }

export function avatar(name: string | null | undefined, id = '', size: 'sm' | 'lg' = 'sm'): Raw {
  if (!name) return html`<span class="avatar ${size === 'lg' ? 'avatar-lg' : ''}" title="Unassigned">–</span>`;
  return html`<span class="avatar avatar-${toneFor(id || name)} ${size === 'lg' ? 'avatar-lg' : ''}" title="${name}">${initials(name)}</span>`;
}

export function priorityPill(p: string): Raw {
  const tone = p === 'P1' ? 'crit' : p === 'P2' ? 'warn' : p === 'P3' ? 'accent' : 'ink';
  return pill(p, tone, p === 'P1' ? 'Critical: 15 min response, 4 h resolve' : p === 'P2' ? 'High: 1 h response, 1 business day' : p === 'P3' ? 'Normal: 4 h response, 3 days' : 'Low: next day response, 7 days');
}

export function slaChip(s: SlaState): Raw {
  const map: Record<SlaState['state'], { tone: 'ink' | 'good' | 'warn' | 'crit' | 'accent'; text: string }> = {
    ok: { tone: 'good', text: s.minutesLeft === null ? 'On track' : `${fmtDuration(s.minutesLeft)} left` },
    warn: { tone: 'warn', text: s.minutesLeft === null ? 'Due soon' : `${fmtDuration(s.minutesLeft)} left` },
    breach: { tone: 'crit', text: s.minutesLeft === null ? 'Breached' : `${fmtDuration(-s.minutesLeft)} over` },
    met: { tone: 'good', text: 'Met SLA' },
    missed: { tone: 'crit', text: 'Missed SLA' },
    none: { tone: 'ink', text: 'No SLA clock' }
  };
  const m = map[s.state];
  return html`<span class="pill pill-${m.tone}" title="${s.label}">${icon('clock', 12)} ${m.text}</span>`;
}

export function ring(pct: number | null, opts: { size?: number; stroke?: number; tone?: Rag | 'accent'; label?: HtmlValue; sub?: HtmlValue } = {}): Raw {
  const size = opts.size || 72, stroke = opts.stroke || 7, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const colour = opts.tone === 'good' ? 'var(--good)' : opts.tone === 'warn' ? 'var(--warn)' : opts.tone === 'crit' ? 'var(--crit)' : opts.tone === 'neutral' ? 'var(--ink)' : 'var(--accent)';
  return html`<span class="ring" style="width:${size}px;height:${size}px" data-ring-pct="${p}">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line2)" stroke-width="${stroke}"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${c.toFixed(2)}" data-target-offset="${(c * (1 - p / 100)).toFixed(2)}"/>
    </svg>
    <span class="ring-label" style="font-size:${Math.round(size / 4.2)}px">${opts.label ?? (pct === null ? '–' : `${Math.round(p)}%`)}</span>
  </span>`;
}

export function sparkline(points: SeriesPoint[], tone: Rag | 'accent' = 'accent', w = 84, h = 28): Raw {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < 2) return html`<svg class="sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="0" y1="${h - 2}" x2="${w}" y2="${h - 2}" stroke="var(--line)" stroke-width="2"/></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1;
  const xs = points.length;
  const coords = points.map((p, i) => {
    const x = (i / (xs - 1)) * (w - 4) + 2;
    const y = p.value === null ? null : h - 3 - ((p.value - min) / range) * (h - 6);
    return y === null ? null : `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter((s): s is string => s !== null);
  const colour = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'crit' ? 'var(--crit)' : tone === 'neutral' ? 'var(--muted)' : 'var(--accent)';
  const last = coords[coords.length - 1].split(',');
  return raw(`<svg class="sparkline spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path pathLength="1" d="M${coords.join(' L')}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${colour}" class="spark-tip"/></svg>`);
}

export function tileCard(t: Tile, href?: string, opts: { compact?: boolean; owner?: boolean } = {}): Raw {
  const link = href ?? `/kpi/${t.key}`;
  const targetText = t.target === null ? (t.manual ? 'Entered weekly' : 'No target') : `Target ${t.targetDisplay}`;
  return html`<a class="tile kpi-morph" href="${link}" data-kpi="${t.key}" data-rag="${t.rag}" style="view-transition-name:kpi-${t.key}" aria-label="${t.name}: ${t.display}">
    <span class="tile-label" title="${t.name}">${t.name}</span>
    <span class="tile-row"><span class="tile-value num c-${t.rag}">${t.display}</span>${sparkline(t.series, t.rag)}</span>
    <span class="tile-delta muted"><span class="dot dot-${t.rag}"></span> ${targetText}${when(t.delta, () => html` <span class="faint">· ${t.delta}</span>`)}</span>
    ${when(opts.owner, () => html`<span class="xs faint">${t.ownerDept}</span>`)}
  </a>`;
}

export function statCard(opts: { href?: string; value: HtmlValue; label: HtmlValue; tone?: Rag | 'accent'; sub?: HtmlValue }): Raw {
  const tone = opts.tone || 'neutral';
  const bg = tone === 'good' ? 'var(--good-soft)' : tone === 'warn' ? 'var(--warn-soft)' : tone === 'crit' ? 'var(--crit-soft)' : tone === 'accent' ? 'var(--accent-soft)' : 'var(--line2)';
  const inner = html`<span class="stat-value num c-${tone}" style="background:${bg}">${opts.value}</span><span style="min-width:0"><b style="display:block;font-size:13px">${opts.label}</b>${when(opts.sub, () => html`<span class="small muted">${opts.sub}</span>`)}</span>`;
  return opts.href ? html`<a class="stat" href="${opts.href}">${inner}</a>` : html`<div class="stat">${inner}</div>`;
}

export function empty(text: HtmlValue, emoji = '✨'): Raw {
  return html`<div class="empty"><span style="font-size:22px">${emoji}</span><span>${text}</span></div>`;
}

/** An empty state worth looking at: an icon that breathes, a line of why, and a way forward. */
export function emptyRich(o: { icon?: string; title: HtmlValue; body?: HtmlValue; action?: HtmlValue }): Raw {
  return html`<div class="empty-rich">
    <span class="glyph">${icon(o.icon || 'check', 24)}</span>
    <b>${o.title}</b>
    ${when(o.body, () => html`<span>${o.body}</span>`)}
    ${when(o.action, () => html`<span style="margin-top:4px">${o.action}</span>`)}
  </div>`;
}

/** A checkmark that draws itself rather than appearing. */
export function checkMark(size = 20, colour = 'currentColor'): Raw {
  return raw(`<svg class="lf-check" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle pathLength="1" cx="12" cy="12" r="10" stroke="${colour}" stroke-width="2" opacity=".35"/><path pathLength="1" d="M7.5 12.4l3.1 3.1 6-6.4" stroke="${colour}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
}

export function notice(kind: 'good' | 'warn' | 'crit' | 'accent', body: HtmlValue, iconName = kind === 'good' ? 'check' : kind === 'crit' ? 'warn' : 'bolt'): Raw {
  return html`<div class="notice notice-${kind}">${icon(iconName, 20)}<div style="flex:1;min-width:0">${body}</div></div>`;
}

export function button(label: HtmlValue, opts: { href?: string; post?: string; body?: unknown; confirm?: string; kind?: 'primary' | 'dark' | 'good' | 'ghost' | ''; size?: 'sm' | 'lg' | ''; icon?: string; drawer?: string; modal?: string; type?: 'submit' | 'button'; disabled?: boolean; title?: string; cls?: string; prompt?: string; promptKey?: string } = {}): Raw {
  const cls = `btn ${opts.kind ? 'btn-' + opts.kind : ''} ${opts.size ? 'btn-' + opts.size : ''} ${opts.cls || ''}`.trim();
  const inner = html`${when(opts.icon, () => icon(opts.icon!, 16))}${label}`;
  if (opts.href) return html`<a class="${cls}" href="${opts.href}" title="${opts.title || ''}">${inner}</a>`;
  return html`<button class="${cls}" type="${opts.type || 'button'}" ${when(opts.post, () => html`data-post="${opts.post}"`)} ${when(opts.body !== undefined, () => html`data-body="${JSON.stringify(opts.body)}"`)} ${when(opts.confirm, () => html`data-confirm="${opts.confirm}"`)} ${when(opts.prompt, () => html`data-prompt="${opts.prompt}" data-prompt-key="${opts.promptKey || 'note'}"`)} ${when(opts.drawer, () => html`data-drawer="${opts.drawer}"`)} ${when(opts.modal, () => html`data-modal="${opts.modal}"`)} ${when(opts.disabled, 'disabled')} title="${opts.title || ''}">${inner}</button>`;
}

export function field(label: HtmlValue, control: Raw, hint?: HtmlValue): Raw {
  return html`<div class="field"><label>${label}</label>${control}${when(hint, () => html`<span class="hint">${hint}</span>`)}</div>`;
}

export function input(name: string, opts: { type?: string; value?: string | number | null; placeholder?: string; required?: boolean; min?: number | string; max?: number | string; step?: number | string; autocomplete?: string; id?: string; readonly?: boolean } = {}): Raw {
  return html`<input class="input" id="${opts.id || 'f-' + name}" name="${name}" type="${opts.type || 'text'}" value="${opts.value ?? ''}" placeholder="${opts.placeholder || ''}" ${when(opts.required, 'required')} ${when(opts.min !== undefined, () => html`min="${opts.min}"`)} ${when(opts.max !== undefined, () => html`max="${opts.max}"`)} ${when(opts.step !== undefined, () => html`step="${opts.step}"`)} ${when(opts.autocomplete, () => html`autocomplete="${opts.autocomplete}"`)} ${when(opts.readonly, 'readonly')}>`;
}

export function textarea(name: string, opts: { value?: string; placeholder?: string; required?: boolean; rows?: number } = {}): Raw {
  return html`<textarea class="input" id="f-${name}" name="${name}" placeholder="${opts.placeholder || ''}" rows="${opts.rows || 3}" ${when(opts.required, 'required')}>${opts.value || ''}</textarea>`;
}

export function select(name: string, options: { value: string; label: HtmlValue; selected?: boolean }[], opts: { id?: string; blank?: string } = {}): Raw {
  return html`<select class="input" id="${opts.id || 'f-' + name}" name="${name}">${when(opts.blank !== undefined, () => html`<option value="">${opts.blank}</option>`)}${options.map((o) => html`<option value="${o.value}" ${when(o.selected, 'selected')}>${o.label}</option>`)}</select>`;
}

export function chips(name: string, options: { value: string; label: HtmlValue }[], selected: string): Raw {
  return html`<div class="checks" data-chips="${name}"><input type="hidden" name="${name}" value="${selected}">${options.map((o) => html`<button type="button" class="chip ${o.value === selected ? 'on' : ''}" data-value="${o.value}">${o.label}</button>`)}</div>`;
}

export function timeline(items: { at: string; who?: string | null; text: HtmlValue; tone?: Rag | 'accent' }[]): Raw {
  if (!items.length) return empty('Nothing has happened yet.', '🕊️');
  return html`<ul class="timeline">${items.map((it, i) => html`<li>
    <span class="t">${it.at}</span>
    <span class="line"><i style="background:${it.tone === 'good' ? 'var(--good)' : it.tone === 'warn' ? 'var(--warn)' : it.tone === 'crit' ? 'var(--crit)' : it.tone === 'accent' ? 'var(--accent)' : 'var(--line)'}"></i>${when(i < items.length - 1, () => html`<b></b>`)}</span>
    <span>${when(it.who, () => html`<b style="font-weight:600">${it.who}</b> · `)}${it.text}</span>
  </li>`)}</ul>`;
}

export function table(headers: HtmlValue[], rows: HtmlValue[][], opts: { emptyText?: string; cls?: string } = {}): Raw {
  if (!rows.length) return empty(opts.emptyText || 'Nothing here yet.', '🗂️');
  return html`<div class="table-wrap"><table class="${opts.cls || ''}"><thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr>${r.map((c) => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>`;
}

export function bar(pct: number | null, tone: Rag | 'accent' = 'accent'): Raw {
  const colour = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'crit' ? 'var(--crit)' : tone === 'neutral' ? 'var(--ink)' : 'var(--accent)';
  return html`<span class="bar"><span style="width:${pct === null ? 0 : Math.max(0, Math.min(100, pct))}%;background:${colour}"></span></span>`;
}

/** Simple SVG line chart with up to three series, used for KPI trends and the analytics page. */
export function lineChart(series: { name: string; points: SeriesPoint[]; colour: string; dashed?: boolean }[], opts: { height?: number; unitFormat?: (v: number) => string; target?: number | null } = {}): Raw {
  const W = 720, H = opts.height || 220, padL = 52, padR = 16, padT = 14, padB = 30;
  const all = series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null && Number.isFinite(v));
  if (opts.target !== null && opts.target !== undefined) all.push(opts.target);
  if (!all.length) return empty('No history yet. Snapshots are taken every 15 minutes.', '📈');
  let min = Math.min(0, ...all), max = Math.max(...all); if (max === min) max = min + 1;
  const pad = (max - min) * 0.08; max += pad; if (min < 0) min -= pad;
  const n = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const fmt = opts.unitFormat || ((v: number) => String(Math.round(v)));
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => { const v = min + (max - min) * f; return `<g><line x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line2)"/><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--faint)">${fmt(v)}</text></g>`; }).join('');
  const labels = series[0].points.map((p, i) => (n > 8 && i % 2 === 1) ? '' : `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--faint)">${p.period.includes('-W') ? 'W' + p.period.split('-W')[1] : p.period}</text>`).join('');
  const paths = series.map((s) => {
    const pts = s.points.map((p, i) => p.value === null ? null : `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).filter((v): v is string => v !== null);
    const last = pts[pts.length - 1]?.split(',');
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.colour}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" ${s.dashed ? 'stroke-dasharray="6 5"' : ''}/>${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.colour}"/>` : ''}`;
  }).join('');
  const target = (opts.target !== null && opts.target !== undefined) ? `<line x1="${padL}" x2="${W - padR}" y1="${y(opts.target).toFixed(1)}" y2="${y(opts.target).toFixed(1)}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".5"/><text x="${W - padR}" y="${(y(opts.target) - 5).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--muted)">target ${fmt(opts.target)}</text>` : '';
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend chart">${gridLines}${labels}${target}${paths}</svg>`);
}

export function legend(items: { name: string; colour: string }[]): Raw {
  return html`<div class="legend">${items.map((i) => html`<span><i style="background:${i.colour}"></i>${i.name}</span>`)}</div>`;
}

export function kv(items: { label: HtmlValue; value: HtmlValue }[]): Raw {
  return html`<div class="kv">${items.map((i) => html`<div><span>${i.label}</span><b>${i.value}</b></div>`)}</div>`;
}

export function ragTone(r: Rag): 'good' | 'warn' | 'crit' | 'ink' { return r === 'neutral' ? 'ink' : r; }

export { join };


/** The Loyal Flow logo: two woven rings (one in ink, one gold) and the wordmark. `onDark` picks the colours for a black ground. */
export function brandMark(onDark: boolean, width = 56): Raw {
  // The Loyal String mark (monochrome), in white on dark backgrounds.
  const w = Math.round(width * 0.82); const h = Math.round((w * 265) / 360);
  return html`<img class="brand-rings" src="/static/${onDark ? 'ls-mark-white.png' : 'ls-mark.png'}" width="${w}" height="${h}" alt="">`;
}

export function brand(o: { onDark: boolean; href?: string; tagline?: boolean; width?: number; style?: string }): Raw {
  return html`<a class="brand" href="${o.href || '/'}" aria-label="LoyalFlow"${when(o.style, () => html` style="${o.style}"`)}>${brandMark(o.onDark, o.width || 56)}<span class="brand-text"><span class="brand-word">Loyal<span class="brand-flow">Flow</span></span>${when(o.tagline, () => html`<span class="brand-tag">Vision 2030</span>`)}</span></a>`;
}
