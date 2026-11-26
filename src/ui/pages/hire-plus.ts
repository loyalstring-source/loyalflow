// Pages for the second round of hiring features: the public Apply page, time limits and the overdue list,
// the interview calendar, message templates, and duplicate candidates.
import { html, raw, when, jsonScript, type Raw } from '../../lib/html.ts';
import { page, modal, drawer, publicPage, type View } from '../layout.ts';
import { pill, notice, field, input, textarea, select, button, table, empty, avatar, icon, statCard } from '../components.ts';
import type { Application, Requisition, Interview, Candidate } from '../../modules/hr/recruiting.ts';
import { STAGE_LABEL } from '../../modules/hr/recruiting.ts';
import type { Employee } from '../../modules/people/model.ts';
import { LIMIT_STAGES, localParts, FIELDS, MERGE_FIELDS, type ApplyLink, type Aging, type Calendar, type Template, type DupPair } from '../../modules/hr/hire-plus.ts';
import { fmtDate, fmtDateTime } from '../../lib/time.ts';

const inr = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : '₹' + Math.round(n).toLocaleString('en-IN'));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// =====================================================================================================================
// 1. Public Apply page
// =====================================================================================================================
const shell = (title: string, body: Raw): Raw => publicPage({ title, body: html`<div class="apply-wrap">
  <div class="apply-brand"><img src="/static/ls-mark.png" alt="" width="46"><b>Loyal String</b></div>${body}
  <p class="xs muted" style="margin-top:22px;text-align:center">Loyal String International Pvt. Ltd. · Your details are used only for hiring.</p></div>` });

const TYPE_LABEL: Record<string, string> = { full_time: 'Full time', part_time: 'Part time', contract: 'Contract', intern: 'Internship', internship: 'Internship' };
const MODE_LABEL: Record<string, string> = { office: 'Work from office', onsite: 'Work from office', hybrid: 'Hybrid', remote: 'Remote', field: 'Field work' };

export function applyPage(d: { req: Requisition; intro: string; token: string }): Raw {
  const r = d.req;
  const facts = [r.department, r.location || 'Pune', TYPE_LABEL[r.employment_type] || '', MODE_LABEL[r.work_mode] || '', r.experience ? `${r.experience} experience` : ''].filter(Boolean);
  return shell(`Apply: ${r.title}`, html`
    <section class="card apply-hero">
      <span class="pill pill-accent">We are hiring</span>
      <h1>${r.title}</h1>
      <div class="apply-facts">${facts.map((f) => html`<span>${f}</span>`)}</div>
      ${when(d.intro, () => html`<p class="apply-text">${d.intro}</p>`)}
      ${when(r.description, () => html`<h2>About the role</h2><p class="apply-text">${r.description}</p>`)}
    </section>
    <section class="card" style="margin-top:14px">
      <h2 style="font-size:18px">Apply for this role</h2>
      <p class="small muted" style="margin:4px 0 14px">It takes about two minutes. Fields marked * are needed.</p>
      <form data-ajax action="/apply/${d.token}" class="stack" id="apply-form">
        <div class="grid grid-2">
          ${field('Full name *', input('fullName', { required: true, autocomplete: 'name', placeholder: 'As on your CV' }))}
          ${field('Email *', input('email', { type: 'email', required: true, autocomplete: 'email', placeholder: 'you@example.com' }))}
        </div>
        <div class="grid grid-2">
          ${field('Phone *', input('phone', { type: 'tel', required: true, autocomplete: 'tel', placeholder: '10-digit mobile number' }))}
          ${field('City you live in', input('location', { placeholder: 'Pune' }))}
        </div>
        <div class="grid grid-2">
          ${field('Where you work now', input('currentEmployer', { placeholder: 'Company name, or “Fresher”' }))}
          ${field('Total experience (years)', input('experienceYears', { type: 'number', min: 0, max: 50, step: 0.5 }))}
        </div>
        <div class="grid grid-3">
          ${field('Current salary (₹ a year)', input('currentCtc', { type: 'number', min: 0, step: 1000 }))}
          ${field('Expected salary (₹ a year)', input('expectedCtc', { type: 'number', min: 0, step: 1000 }))}
          ${field('Notice period (days)', input('noticeDays', { type: 'number', min: 0, max: 365 }))}
        </div>
        ${field('How did you hear about this role?', select('heardFrom', ['Company website', 'LinkedIn', 'Naukri', 'Indeed', 'A friend or employee', 'College', 'Other'].map((x) => ({ value: x, label: x })), { blank: 'Choose one' }))}
        ${field('Your CV *', html`<label class="apply-drop" id="apply-drop"><input type="file" name="cv" accept=".pdf,.docx" required>
          <b id="apply-file">Choose a file, or drop it here</b><span class="xs muted">PDF or Word (.docx), up to 5 MB</span></label>`)}
        <div class="apply-hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <label class="apply-consent"><input type="checkbox" name="consent" value="1" required> <span>I agree that Loyal String may keep these details and my CV to consider me for this and similar roles. I can ask for them to be deleted at any time.</span></label>
        <div class="row right">${button('Send application', { type: 'submit', kind: 'primary', size: 'lg' })}</div>
      </form>
    </section>`);
}
export function applyThanksPage(title: string): Raw {
  return shell('Application received', html`<section class="card apply-hero" style="text-align:center">
    <div class="apply-tick">${icon('check', 30)}</div>
    <h1>Thank you</h1>
    <p class="apply-text">We have your application for <b>${title}</b>. Our HR team reads every application and will write or call if your profile fits the role.</p>
    <p class="small muted">You do not need to apply again. If you already applied for this role earlier, we kept your first application.</p></section>`);
}
export function applyClosedPage(kind: 'invalid' | 'closed', title = ''): Raw {
  return shell('Apply', html`<section class="card apply-hero"><h1>${kind === 'invalid' ? 'This link is not valid' : 'This role is not open right now'}</h1>
    <p class="apply-text">${kind === 'invalid' ? 'Please check that you opened the full link. If it still does not work, ask the person who shared it for a new one.' : html`${title ? html`<b>${title}</b> is` : 'This vacancy is'} not taking applications at the moment. Thank you for your interest in Loyal String.`}</p></section>`);
}

/** The card on a vacancy page where HR turns the public link on and shares it. */
export function applyLinkCard(d: { req: Requisition; link: ApplyLink; url: string; canEdit: boolean }): Raw {
  if (!d.canEdit) return raw('');
  const live = d.link.enabled && d.req.status === 'open';
  return html`<section class="card">
    <div class="card-head"><h2>Apply link</h2>${live ? pill('Open', 'good') : d.link.enabled ? pill('Vacancy not open', 'warn') : pill('Off', 'ink')}</div>
    ${d.link.enabled && d.link.token ? html`
      <p class="xs muted">Anyone with this link can apply, without signing in. Share it on LinkedIn, WhatsApp or your website.</p>
      <div class="apply-link"><input readonly value="${d.url}" onclick="this.select()" aria-label="Apply link"><button class="btn btn-sm" data-copy="${d.url}">Copy</button></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
        <a class="btn btn-sm" href="${d.url}" target="_blank" rel="noopener">Open the page</a>
        <a class="btn btn-sm" href="https://wa.me/?text=${encodeURIComponent(`We are hiring: ${d.req.title}. Apply here: ${d.url}`)}" target="_blank" rel="noopener">WhatsApp</a>
        <a class="btn btn-sm" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(d.url)}" target="_blank" rel="noopener">LinkedIn</a>
      </div>
      <p class="small" style="margin-top:10px"><b>${d.link.received}</b> ${d.link.received === 1 ? 'application' : 'applications'} came through this link.</p>
      <form data-post="/hire/req/${d.req.id}/apply-link" class="stack" style="margin-top:8px">
        ${field('A line or two shown above the form', textarea('intro', { value: d.link.intro, rows: 3, placeholder: 'Why this role matters, what the team is like…' }))}
        <div class="row right" style="gap:6px">
          ${button('New link', { post: `/hire/req/${d.req.id}/apply-link`, body: { renew: '1' }, kind: 'ghost', size: 'sm', confirm: 'Make a new link? The link you already shared will stop working.' })}
          ${button('Turn off', { post: `/hire/req/${d.req.id}/apply-link`, body: { enabled: '0' }, kind: 'ghost', size: 'sm', confirm: 'Turn the Apply link off? People who open it will see that the role is not open.' })}
          ${button('Save', { type: 'submit', size: 'sm', kind: 'primary' })}
        </div>
      </form>` : html`
      <p class="small muted">Let people apply on their own from a public page. Each application lands in this vacancy as “Applied”, with the CV attached.</p>
      <div class="row right">${button('Turn on the Apply link', { post: `/hire/req/${d.req.id}/apply-link`, body: { enabled: '1' }, kind: 'primary', size: 'sm' })}</div>`}
  </section>`;
}

// =====================================================================================================================
// 2. Time limits and the overdue list
// =====================================================================================================================
export const agePill = (a: { days: number; limit: number; over: number }): Raw =>
  a.over > 0 ? pill(`${a.over} ${a.over === 1 ? 'day' : 'days'} over`, 'crit', `${a.days} days in this stage; the limit is ${a.limit}`)
    : a.limit && a.days >= a.limit - 1 ? pill(a.days >= a.limit ? 'Due today' : 'Due tomorrow', 'warn', `${a.days} of ${a.limit} days`) : pill(a.limit ? `${a.days}d of ${a.limit}` : `${a.days}d`, 'ink');

export function overduePage(v: View, d: { rows: Aging[]; all: Aging[]; limits: Record<string, number>; canEdit: boolean; stage: string }): Raw {
  const byStage = LIMIT_STAGES.map((s) => ({ s, total: d.all.filter((a) => a.stage === s).length, over: d.all.filter((a) => a.stage === s && a.over > 0).length }));
  const over = d.all.filter((a) => a.over > 0); const soon = d.all.filter((a) => a.over <= 0 && a.limit && a.days >= a.limit - 1);
  const shown = d.stage ? d.rows.filter((a) => a.stage === d.stage) : d.rows;
  return page(v, {
    title: 'Overdue in hiring', navTab: 'hire',
    subtitle: 'Candidates who have waited in one stage longer than the limit you set.',
    actions: html`${button('Back to hiring', { href: '/hire' })}${button('Download', { href: '/reports/hire-aging.xlsx', kind: 'ghost', icon: 'download' })}`,
    body: html`
      <div class="grid grid-4">
        ${statCard({ value: over.length, label: 'Over the limit', tone: over.length ? 'crit' : 'good' })}
        ${statCard({ value: soon.length, label: 'Due today or tomorrow', tone: soon.length ? 'warn' : 'neutral' })}
        ${statCard({ value: over.length ? Math.max(...over.map((a) => a.over)) : 0, label: 'Longest wait over (days)' })}
        ${statCard({ value: d.all.length, label: 'Active candidates', tone: 'accent' })}
      </div>
      <div class="cols" style="margin-top:14px"><div class="col-main stack">
        <section class="card">
          <div class="card-head"><h2>${d.stage ? `${STAGE_LABEL[d.stage]}: who is waiting` : 'Who is waiting'}</h2><span class="row" style="gap:6px;flex-wrap:wrap">
            <a class="chip ${d.stage ? '' : 'on'}" href="/hire/overdue">All</a>${byStage.filter((b) => b.over).map((b) => html`<a class="chip ${d.stage === b.s ? 'on' : ''}" href="/hire/overdue?stage=${b.s}">${STAGE_LABEL[b.s]} · ${b.over}</a>`)}</span></div>
          ${shown.length ? table(['Candidate', 'Vacancy', 'Stage', 'Waiting', 'With', ''], shown.map((a) => [
            html`<a href="/hire/app/${a.id}" class="row" style="gap:8px;text-decoration:none">${avatar(a.candidate_name, a.candidate_id)}<b>${a.candidate_name}</b></a>`,
            html`<a class="small" href="/hire/req/${a.requisition_id}">${a.requisition_title}</a>`,
            html`${pill(STAGE_LABEL[a.stage], 'ink')}<br><span class="xs muted">since ${fmtDate(a.stage_since)}</span>`,
            agePill(a), html`<span class="small">${a.owner_name || 'Nobody yet'}</span>`,
            when(d.canEdit, () => button('Message', { modal: `/hire/app/${a.id}/message`, size: 'sm', icon: 'mail' }))])) : empty('Nobody is over the limit. Well kept.', '⏱️')}
        </section>
      </div><div class="col-side stack">
        <section class="card">
          <h2>By stage</h2>
          <div class="stage-bars">${byStage.map((b) => html`<a href="/hire/overdue?stage=${b.s}" class="stage-bar"><span>${STAGE_LABEL[b.s]}</span>
            <i><b style="width:${b.total ? Math.round((b.over / b.total) * 100) : 0}%"></b></i><em>${b.over} of ${b.total}</em></a>`)}</div>
          <p class="xs muted" style="margin-top:8px">Red is the share of people in that stage who are over the limit.</p>
        </section>
        <section class="card">
          <div class="card-head"><h2>Time limits</h2>${pill('days', 'ink')}</div>
          ${d.canEdit ? html`<form data-post="/hire/limits" class="stack">
            <div class="limit-grid">${LIMIT_STAGES.map((s) => html`<label><span>${STAGE_LABEL[s]}</span><input type="number" name="${s}" min="0" max="120" value="${d.limits[s] ?? 0}"></label>`)}</div>
            <p class="xs muted">How many days a candidate may stay in a stage. 0 means no limit. When someone goes over, the recruiter gets a reminder once.</p>
            <div class="row right">${button('Save limits', { type: 'submit', kind: 'primary', size: 'sm' })}</div>
          </form>` : html`<div class="limit-grid">${LIMIT_STAGES.map((s) => html`<label><span>${STAGE_LABEL[s]}</span><b>${d.limits[s] || '—'}</b></label>`)}</div>`}
        </section>
      </div></div>`
  });
}

// =====================================================================================================================
// 3. Interview calendar
// =====================================================================================================================
const PX_PER_MIN = 1.15;
const toneOf = (i: Interview): string => (i.status === 'completed' ? 'done' : i.status === 'no_show' ? 'miss' : i.round_type === 'hr' ? 'hr' : i.round_type === 'final' || i.round_type === 'culture' ? 'final' : 'tech');
const hhmm12 = (m: number): string => { const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`; };
const mins = (i: Interview): number => Math.max(15, Math.round((new Date(i.ends_at).getTime() - new Date(i.starts_at).getTime()) / 60_000));

/** Interviews that overlap in time sit side by side instead of on top of each other. */
function lanes(list: Interview[]): { i: Interview; lane: number; of: number }[] {
  const sorted = [...list].sort((a, b) => a.starts_at.localeCompare(b.starts_at)); const out: { i: Interview; lane: number; of: number }[] = [];
  let group: { i: Interview; lane: number; of: number }[] = [], ends: number[] = [], groupEnd = 0;
  const flush = (): void => { for (const g of group) g.of = ends.length; out.push(...group); group = []; ends = []; };
  for (const i of sorted) { const st = new Date(i.starts_at).getTime(), en = st + mins(i) * 60_000;
    if (group.length && st >= groupEnd) flush();
    let lane = ends.findIndex((e) => e <= st); if (lane < 0) { lane = ends.length; ends.push(en); } else ends[lane] = en;
    group.push({ i, lane, of: 1 }); groupEnd = Math.max(groupEnd, en); }
  flush(); return out;
}
export interface CalendarData { cal: Calendar; people: Employee[]; vacancies: Requisition[]; waiting: Application[]; interviewerId: string; requisitionId: string; canEdit: boolean; date: string }

export function calendarPage(v: View, d: CalendarData): Raw {
  const c = d.cal; const qs = (o: Record<string, string>): string => { const p = new URLSearchParams({ view: c.view, date: d.date, ...(d.interviewerId ? { who: d.interviewerId } : {}), ...(d.requisitionId ? { req: d.requisitionId } : {}), ...o }); return `/hire/calendar?${p.toString()}`; };
  const upcoming = c.interviews.filter((i) => i.status === 'scheduled'); const load = new Map<string, number>();
  for (const i of upcoming) for (const p of i.panel || []) load.set(p.name, (load.get(p.name) || 0) + 1);
  // The grid runs 8 am to 8 pm, and stretches when an interview is booked earlier or later than that.
  const startsAll = c.interviews.map((i) => localParts(i.starts_at).minutes); const endsAll = c.interviews.map((i) => localParts(i.starts_at).minutes + mins(i));
  const DAY_START = Math.min(8 * 60, ...startsAll.map((m) => Math.floor(m / 60) * 60)); const DAY_END = Math.min(24 * 60, Math.max(20 * 60, ...endsAll.map((m) => Math.ceil(m / 60) * 60)));
  const hours: number[] = []; for (let m = DAY_START; m < DAY_END; m += 60) hours.push(m);
  const week = html`<div class="cal-week" data-cal data-edit="${d.canEdit ? '1' : ''}" data-start="${DAY_START}" data-ppm="${PX_PER_MIN}">
    <div class="cal-head"><span></span>${c.days.map((day) => html`<a href="${qs({ view: 'week', date: day.date })}" class="${day.today ? 'today' : ''}"><em>${day.dow}</em><b>${day.label}</b>${when(day.interviews.length, () => html`<i>${day.interviews.length}</i>`)}</a>`)}</div>
    <div class="cal-body" style="height:${(DAY_END - DAY_START) * PX_PER_MIN}px">
      <div class="cal-hours">${hours.map((m) => html`<span style="top:${(m - DAY_START) * PX_PER_MIN}px">${hhmm12(m)}</span>`)}</div>
      ${c.days.map((day) => html`<div class="cal-col ${day.today ? 'today' : ''}" data-day="${day.date}">
        ${hours.map((m) => html`<u style="top:${(m - DAY_START) * PX_PER_MIN}px"></u>`)}
        ${lanes(day.interviews).map(({ i, lane, of }) => { const lp = localParts(i.starts_at); const top = Math.max(0, Math.min(DAY_END - DAY_START - 20, lp.minutes - DAY_START)) * PX_PER_MIN; const h = Math.max(26, mins(i) * PX_PER_MIN - 2);
          return html`<button type="button" class="cal-ev ev-${toneOf(i)} ${mins(i) < 45 ? 'short' : mins(i) < 60 ? 'mid' : ''}" style="top:${top}px;height:${h}px;left:calc(${(lane / of) * 100}% + 3px);width:calc(${100 / of}% - 6px)" data-ev="${i.id}" data-min="${mins(i)}" ${d.canEdit && i.status === 'scheduled' ? raw('draggable="true"') : ''} data-drawer="/hire/calendar/interview/${i.id}" title="${i.candidate_name} · ${lp.hhmm}">
            <b>${i.candidate_name}</b><span>${hhmm12(lp.minutes)} · ${i.round_name || `Round ${i.round}`}</span><span class="xs">${(i.panel || []).map((p) => p.name.split(' ')[0]).join(', ')}</span></button>`; })}
      </div>`)}
    </div></div>`;
  const month = html`<div class="cal-month" data-cal data-edit="${d.canEdit ? '1' : ''}">
    <div class="cal-mhead">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => html`<span>${x}</span>`)}</div>
    <div class="cal-mgrid">${c.days.map((day) => html`<div class="cal-cell ${day.today ? 'today' : ''} ${day.inMonth ? '' : 'out'}" data-day="${day.date}">
      <a class="cal-num" href="${qs({ view: 'week', date: day.date })}">${day.label}</a>
      ${day.interviews.slice(0, 4).map((i) => html`<button type="button" class="cal-chip ev-${toneOf(i)}" data-ev="${i.id}" data-min="${mins(i)}" data-time="${localParts(i.starts_at).hhmm}" ${d.canEdit && i.status === 'scheduled' ? raw('draggable="true"') : ''} data-drawer="/hire/calendar/interview/${i.id}"><em>${hhmm12(localParts(i.starts_at).minutes)}</em> ${i.candidate_name}</button>`)}
      ${when(day.interviews.length > 4, () => html`<a class="xs muted" href="${qs({ view: 'week', date: day.date })}">+${day.interviews.length - 4} more</a>`)}
    </div>`)}</div></div>`;
  return page(v, {
    title: 'Interview calendar', navTab: 'hire', wide: true,
    subtitle: c.all ? 'Every interview, by day. Drag one to move it. Click an empty time to book a new one.' : 'The interviews you sit on.',
    actions: html`${button('Back to hiring', { href: '/hire' })}${when(d.canEdit, () => button('Book an interview', { modal: `/hire/calendar/new?at=${d.date}T11:00`, kind: 'primary', icon: 'plus' }))}`,
    body: html`
      <div class="cal-bar">
        <div class="row" style="gap:6px"><a class="btn btn-sm btn-icon" href="${qs({ date: c.prev })}" aria-label="Earlier">‹</a><a class="btn btn-sm" href="${qs({ date: '' })}">Today</a><a class="btn btn-sm btn-icon" href="${qs({ date: c.next })}" aria-label="Later">›</a><h2 class="cal-title">${c.title}</h2></div>
        <form method="get" action="/hire/calendar" class="row" style="gap:8px;flex-wrap:wrap">
          <input type="hidden" name="view" value="${c.view}"><input type="hidden" name="date" value="${d.date}">
          ${when(c.all, () => html`<select name="who" class="input" data-autosubmit aria-label="Interviewer"><option value="">All interviewers</option>${d.people.map((p) => html`<option value="${p.id}" ${p.id === d.interviewerId ? 'selected' : ''}>${p.full_name}</option>`)}</select>`)}
          <select name="req" class="input" data-autosubmit aria-label="Vacancy"><option value="">All vacancies</option>${d.vacancies.map((r) => html`<option value="${r.id}" ${r.id === d.requisitionId ? 'selected' : ''}>${r.title}</option>`)}</select>
          <span class="seg"><a class="${c.view === 'week' ? 'on' : ''}" href="${qs({ view: 'week' })}">Week</a><a class="${c.view === 'month' ? 'on' : ''}" href="${qs({ view: 'month' })}">Month</a></span>
        </form>
      </div>
      <div class="cal-layout">
        <div class="card cal-card">${c.view === 'week' ? week : month}</div>
        <aside class="stack">
          <section class="card">
            <h2>${c.view === 'week' ? 'This week' : 'This month'}</h2>
            <div class="cal-stats"><div><b>${c.interviews.length}</b><span>interviews</span></div><div><b>${upcoming.length}</b><span>still to come</span></div><div><b>${c.interviews.filter((i) => i.status === 'completed').length}</b><span>done</span></div></div>
            <div class="cal-legend"><span><i class="ev-hr"></i>HR round</span><span><i class="ev-tech"></i>Technical or manager</span><span><i class="ev-final"></i>Final</span><span><i class="ev-done"></i>Done</span></div>
          </section>
          ${when(d.canEdit, () => html`<section class="card">
            <div class="card-head"><h2>Waiting for an interview</h2>${pill(String(d.waiting.length), d.waiting.length ? 'warn' : 'good')}</div>
            ${d.waiting.length ? html`<p class="xs muted">Drag a name onto a day and time to book it.</p><div class="cal-wait">${d.waiting.slice(0, 12).map((a) => html`<div class="cal-person" draggable="true" data-app="${a.id}">${avatar(a.candidate_name, a.candidate_id)}<div><b>${a.candidate_name}</b><span class="xs muted">${a.requisition_title} · ${STAGE_LABEL[a.stage]}</span></div></div>`)}</div>` : html`<p class="small muted">Everyone at the interview stage has a time booked.</p>`}
          </section>`)}
          ${when(load.size, () => html`<section class="card">
            <h2>Interviewer load</h2>
            <div class="stage-bars">${[...load.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => html`<div class="stage-bar load"><span>${n}</span><i><b style="width:${Math.min(100, k * 20)}%"></b></i><em>${k}</em></div>`)}</div>
          </section>`)}
        </aside>
      </div>`
  });
}

export function calendarEventDrawer(d: { i: Interview; canEdit: boolean; informed: boolean }): Raw {
  const i = d.i; const lp = localParts(i.starts_at);
  return drawer({
    title: i.candidate_name || 'Interview', meta: html`${i.requisition_title} · ${i.round_name || `Round ${i.round}`}`,
    body: html`<div class="stack">
      <div class="row" style="gap:8px;flex-wrap:wrap">${pill(i.status === 'scheduled' ? 'Booked' : i.status.replace('_', ' '), i.status === 'scheduled' ? 'accent' : i.status === 'completed' ? 'good' : 'warn')}${i.candidate_informed ? pill('Candidate told', 'good') : pill('Candidate not told yet', 'warn')}</div>
      <ul class="list" style="font-size:14px">
        <li><span class="muted" style="width:90px">When</span><b>${fmtDate(i.starts_at)}, ${hhmm12(lp.minutes)}</b> <span class="muted">· ${mins(i)} min</span></li>
        <li><span class="muted" style="width:90px">How</span>${i.mode === 'video' ? 'Video call' : i.mode === 'phone' ? 'Phone' : 'In person'}${when(i.location, () => html` · ${i.location}`)}</li>
        <li><span class="muted" style="width:90px">Panel</span>${(i.panel || []).map((p) => p.name).join(', ') || '—'}</li>
        ${when(i.previous_starts_at, () => html`<li><span class="muted" style="width:90px">Moved</span><span class="small">from ${fmtDateTime(i.previous_starts_at)}: ${i.reschedule_reason}</span></li>`)}
      </ul>
    </div>`,
    foot: html`${button('Open interview', { href: `/hire/interview/${i.id}`, kind: 'primary' })}
      ${when(d.canEdit && i.status === 'scheduled', () => html`${button('Move', { modal: `/hire/interview/${i.id}/reschedule` })}${button(i.candidate_informed ? 'Message again' : 'Tell the candidate', { modal: `/hire/app/${i.application_id}/message?t=${i.previous_starts_at ? 'interview_reschedule' : 'interview_invite'}&interview=${i.id}`, icon: 'mail' })}`)}
      ${button('Candidate', { href: `/hire/app/${i.application_id}`, kind: 'ghost' })}`
  });
}

export function calendarNewModal(d: { apps: Application[]; people: Employee[]; at: string; appId: string; types: { value: string; label: string }[] }): Raw {
  return modal({
    title: 'Book an interview',
    body: html`<form data-post="/hire/calendar/new" class="stack">
      ${field('Candidate', select('applicationId', d.apps.map((a) => ({ value: a.id, label: `${a.candidate_name} · ${a.requisition_title} (${STAGE_LABEL[a.stage]})`, selected: a.id === d.appId })), { blank: d.apps.length ? 'Choose a candidate' : 'Nobody is at a stage that takes interviews' }))}
      ${field('Round name', input('roundName', { placeholder: 'HR round, Team manager round, COO round…' }))}
      <div class="grid grid-2">${field('Kind', select('roundType', d.types, {}))}${field('Mode', select('mode', [{ value: 'in_person', label: 'In person' }, { value: 'video', label: 'Video call' }, { value: 'phone', label: 'Phone' }], {}))}</div>
      <div class="grid grid-2">${field('Date and time', input('startsAt', { type: 'datetime-local', required: true, value: d.at }))}${field('Minutes', input('minutes', { type: 'number', min: 15, step: 15, value: 45 }))}</div>
      ${field('Where / link', input('location', { placeholder: 'Pune office, meeting room 2' }))}
      ${field('Panel', html`<div style="display:grid;gap:6px;max-height:180px;overflow:auto">${d.people.map((p) => html`<label class="row" style="gap:8px"><input type="checkbox" name="panel[]" value="${p.id}"> <span class="small">${p.full_name} <span class="muted">· ${p.designation}</span></span></label>`)}</div>`)}
      <label class="row small" style="gap:8px"><input type="checkbox" name="force" value="1"> Book anyway if someone on the panel is busy</label>
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Book', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

// =====================================================================================================================
// 4. Message templates
// =====================================================================================================================
const GROUPS: { name: string; keys: string[] }[] = [
  { name: 'Candidate and role', keys: ['candidate_name', 'first_name', 'role', 'department', 'location', 'company'] },
  { name: 'Interview', keys: ['interview_date', 'interview_time', 'interview_round', 'interview_mode', 'interview_place', 'interviewers'] },
  { name: 'Offer', keys: ['offer_designation', 'offer_ctc', 'joining_date', 'offer_valid_until', 'hold_until'] },
  { name: 'You', keys: ['sender_name', 'sender_title'] }
];
export function templatesPage(v: View, d: { templates: Template[]; current: Template | null; isNew: boolean; mail: boolean }): Raw {
  const t = d.current; const samples = Object.fromEntries(FIELDS.map((f) => [f.key, f.sample])); const labels = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
  return page(v, {
    title: 'Message templates', navTab: 'hire', wide: true,
    subtitle: 'Write a message once. LoyalFlow fills in the candidate, the role, the interview and the offer each time you send it.',
    actions: html`${button('Back to hiring', { href: '/hire' })}${button('New template', { href: '/hire/templates?new=1', kind: 'primary', icon: 'plus' })}`,
    body: html`
      ${when(!d.mail, () => notice('accent', 'Email from LoyalFlow is not connected yet (Microsoft 365). Until then each message opens in your own mail, already written, and LoyalFlow records that it was sent.'))}
      <div class="tpl-layout">
        <nav class="card tpl-list">
          ${d.templates.map((x) => html`<a href="/hire/templates?t=${x.key}" class="${t && x.key === t.key && !d.isNew ? 'on' : ''}"><b>${x.name}</b><span class="xs muted">${x.builtin ? 'Standard' : 'Yours'}${x.updated_by_name ? ` · edited by ${x.updated_by_name.split(' ')[0]}` : ''}</span></a>`)}
          ${when(d.isNew, () => html`<a class="on" href="/hire/templates?new=1"><b>New template</b><span class="xs muted">Not saved yet</span></a>`)}
        </nav>
        <section class="card tpl-edit">
          <form data-post="/hire/templates" class="stack" data-tpl>
            <input type="hidden" name="key" value="${d.isNew || !t ? '' : t.key}">
            ${field('Name', input('name', { value: d.isNew ? '' : t?.name || '', required: true, placeholder: 'Second round invitation' }))}
            ${field('Subject', input('subject', { value: d.isNew ? '' : t?.subject || '', required: true, id: 'tpl-subject', placeholder: 'Interview for {{role}} at {{company}}' }))}
            ${field('Message', html`<textarea name="body" id="tpl-body" class="input tpl-body" rows="14" required placeholder="Dear {{first_name}}, …">${d.isNew ? '' : t?.body || ''}</textarea>`, 'Click a field on the right to drop it in where the cursor is.')}
            <div class="row between" style="flex-wrap:wrap;gap:8px">
              <span class="row" style="gap:6px">${when(t && !d.isNew && !t.builtin, () => button('Delete', { post: `/hire/templates/${t!.key}/delete`, kind: 'ghost', size: 'sm', confirm: 'Delete this template?' }))}${when(t && !d.isNew && t.builtin, () => button('Put back the standard wording', { post: `/hire/templates/${t!.key}/reset`, kind: 'ghost', size: 'sm', confirm: 'Replace your wording with the standard wording?' }))}</span>
              ${button(d.isNew ? 'Create template' : 'Save', { type: 'submit', kind: 'primary' })}
            </div>
          </form>
        </section>
        <aside class="stack">
          <section class="card">
            <h2>Fields</h2>
            ${GROUPS.map((g) => html`<p class="xs muted" style="margin:10px 0 6px">${g.name}</p><div class="tpl-chips">${g.keys.filter((k) => labels[k]).map((k) => html`<button type="button" class="tpl-chip" data-field="${k}" title="{{${k}}}">${labels[k]}</button>`)}</div>`)}
          </section>
          <section class="card tpl-preview">
            <div class="card-head"><h2>Preview</h2>${pill('Sample candidate', 'ink')}</div>
            <p class="tpl-psub" id="tpl-psub"></p><div class="tpl-pbody" id="tpl-pbody"></div>
            <p class="xs muted" id="tpl-pwarn" style="margin-top:8px"></p>
          </section>
        </aside>
      </div>
      <script type="application/json" id="tpl-samples">${jsonScript({ samples, labels })}</script>`
  });
}

export function messageModal(d: { a: Application; templates: Template[]; key: string; interviewId: string; interviews: Interview[]; to: string; subject: string; body: string; missing: string[]; mail: boolean }): Raw {
  const labels = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
  return modal({
    title: `Message ${d.a.candidate_name}`,
    body: html`<form data-post="/hire/app/${d.a.id}/message" class="stack" data-msg="/hire/app/${d.a.id}/compose">
      <div class="grid grid-2">
        ${field('Template', select('templateKey', d.templates.map((t) => ({ value: t.key, label: t.name, selected: t.key === d.key })), {}))}
        ${d.interviews.length ? field('About which interview', select('interviewId', d.interviews.map((i) => ({ value: i.id, label: `${i.round_name || `Round ${i.round}`} · ${fmtDateTime(i.starts_at)}`, selected: i.id === d.interviewId })), { blank: 'The next one' })) : html`<input type="hidden" name="interviewId" value="">`}
      </div>
      ${field('To', input('to', { value: d.to || 'No email on record', readonly: true }))}
      ${field('Subject', input('subject', { value: d.subject, required: true }))}
      ${field('Message', html`<textarea name="body" class="input" rows="12" required>${d.body}</textarea>`)}
      <div data-msg-missing>${when(d.missing.length, () => notice('warn', html`Not known yet: <b>${d.missing.map((m) => labels[m] || m).join(', ')}</b>. They are shown in [square brackets]. Type them in, or book the interview / draft the offer first.`))}</div>
      ${when(!d.mail, () => html`<p class="xs muted">Email is not connected, so press <b>Open in my mail</b> to send it yourself, then <b>Mark as sent</b> so the record is kept.</p>`)}
      <div class="row right" style="gap:8px">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}
        ${when(!d.mail, () => html`<a class="btn" data-msg-mailto data-to="${d.to}" href="#" target="_blank" rel="noopener">${icon('mail', 16)} Open in my mail</a>`)}
        ${button(d.mail ? 'Send email' : 'Mark as sent', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

// =====================================================================================================================
// 5. Duplicate candidates
// =====================================================================================================================
export function duplicatesPage(v: View, d: { pairs: DupPair[] }): Raw {
  const strong = d.pairs.filter((p) => p.strong).length;
  return page(v, {
    title: 'Duplicate candidates', navTab: 'hire',
    subtitle: 'Records that look like the same person. You decide; nothing is merged by itself.',
    actions: html`${button('Back to hiring', { href: '/hire' })}${button('All candidates', { href: '/hire/candidates', kind: 'ghost' })}`,
    body: html`
      <div class="grid grid-3">
        ${statCard({ value: d.pairs.length, label: 'Pairs to look at', tone: d.pairs.length ? 'warn' : 'good' })}
        ${statCard({ value: strong, label: 'Same email or phone', tone: strong ? 'crit' : 'neutral', sub: 'Almost certainly one person' })}
        ${statCard({ value: d.pairs.length - strong, label: 'Same name only', sub: 'Check before merging' })}
      </div>
      <section class="card" style="margin-top:14px">
        ${d.pairs.length ? html`<div class="dup-list">${d.pairs.map((p) => html`<div class="dup-row">
          <div class="dup-pair">
            <a href="/hire/candidate/${p.a.id}" class="dup-who">${avatar(p.a.full_name, p.a.id)}<div><b>${p.a.full_name}</b><span class="xs muted">${p.a.email || 'no email'} · ${p.a.phone || 'no phone'}<br>${plural(p.a.apps, 'application')} · added ${fmtDate(p.a.created_at)}</span></div></a>
            <span class="dup-eq">≈</span>
            <a href="/hire/candidate/${p.b.id}" class="dup-who">${avatar(p.b.full_name, p.b.id)}<div><b>${p.b.full_name}</b><span class="xs muted">${p.b.email || 'no email'} · ${p.b.phone || 'no phone'}<br>${plural(p.b.apps, 'application')} · added ${fmtDate(p.b.created_at)}</span></div></a>
          </div>
          <div class="row" style="gap:6px;flex-wrap:wrap">${p.why.map((w) => pill(w, w === 'Same name' ? 'warn' : 'crit'))}</div>
          <div class="row" style="gap:6px">${button('Not the same person', { post: '/hire/duplicates/dismiss', body: { a: p.a.id, b: p.b.id }, kind: 'ghost', size: 'sm' })}${button('Compare and merge', { href: `/hire/duplicates/review?a=${p.a.id}&b=${p.b.id}`, kind: 'primary', size: 'sm' })}</div>
        </div>`)}</div>` : empty('No duplicates found. Every candidate is on record once.', '🧹')}
      </section>`
  });
}

type Cand = Candidate & { apps?: number; cv_name?: string };
export function mergePage(v: View, d: { a: Cand; b: Cand; appsA: Application[]; appsB: Application[]; why: string[] }): Raw {
  const show = (k: string, val: unknown): string => (val === null || val === undefined || val === '' ? '' : k === 'current_ctc' || k === 'expected_ctc' ? inr(Number(val)) : String(val));
  const apps = (l: Application[]): Raw => (l.length ? html`${l.map((x) => html`<a class="dup-app" href="/hire/app/${x.id}">${x.requisition_title}<span class="xs muted"> · ${STAGE_LABEL[x.stage]}${x.status === 'closed' ? ' (closed)' : ''}</span></a>`)}` : html`<span class="small muted">None</span>`);
  // The older record is kept by default: it usually has the history.
  return page(v, {
    title: 'Compare and merge', navTab: 'hire',
    subtitle: html`${d.why.join(' · ') || 'Chosen by you'}. Pick the record to keep, then the value to keep on each line.`,
    actions: html`${button('Back to the list', { href: '/hire/duplicates' })}`,
    body: html`<form data-post="/hire/duplicates/merge" class="stack" data-merge>
      <section class="card">
        <div class="merge-grid merge-head">
          <span></span>
          <label class="merge-pick"><input type="radio" name="keep" value="${d.a.id}" checked><div>${avatar(d.a.full_name, d.a.id)}<div><b>${d.a.full_name}</b><span class="xs muted">${d.a.id} · added ${fmtDate(d.a.created_at)}</span></div></div><em>Keep this record</em></label>
          <label class="merge-pick"><input type="radio" name="keep" value="${d.b.id}"><div>${avatar(d.b.full_name, d.b.id)}<div><b>${d.b.full_name}</b><span class="xs muted">${d.b.id} · added ${fmtDate(d.b.created_at)}</span></div></div><em>Keep this record</em></label>
        </div>
        <input type="hidden" name="a" value="${d.a.id}"><input type="hidden" name="b" value="${d.b.id}">
        ${MERGE_FIELDS.map((f) => { const va = show(String(f.key), d.a[f.key]), vb = show(String(f.key), d.b[f.key]); const same = va === vb; const pickB = !va && !!vb;
          return html`<div class="merge-grid merge-row ${same ? 'same' : ''}"><span class="muted small">${f.label}</span>
            <label class="merge-val ${va ? '' : 'blank'}"><input type="radio" name="f_${String(f.key)}" value="a" ${pickB || !va ? '' : 'checked'} ${va ? '' : 'disabled'}><span>${va || 'Blank'}</span></label>
            <label class="merge-val ${vb ? '' : 'blank'}"><input type="radio" name="f_${String(f.key)}" value="b" ${pickB ? 'checked' : ''} ${vb ? '' : 'disabled'}><span>${vb || 'Blank'}</span></label></div>`; })}
        ${(() => { const ca = d.a.cv_path ? d.a.cv_name || 'CV on file' : '', cb = d.b.cv_path ? d.b.cv_name || 'CV on file' : ''; const pickB = !ca && !!cb;
          return html`<div class="merge-grid merge-row"><span class="muted small">CV</span>
            <label class="merge-val ${ca ? '' : 'blank'}"><input type="radio" name="f_cv" value="a" ${pickB || !ca ? '' : 'checked'} ${ca ? '' : 'disabled'}><span>${ca || 'No CV'}</span></label>
            <label class="merge-val ${cb ? '' : 'blank'}"><input type="radio" name="f_cv" value="b" ${pickB ? 'checked' : ''} ${cb ? '' : 'disabled'}><span>${cb || 'No CV'}</span></label></div>`; })()}
        <div class="merge-grid merge-row"><span class="muted small">Applications</span><div class="stack" style="gap:4px">${apps(d.appsA)}</div><div class="stack" style="gap:4px">${apps(d.appsB)}</div></div>
      </section>
      ${notice('accent', 'All applications, interviews, scorecards and messages move to the record you keep. If both applied to the same vacancy, the application that got further carries on and the other is closed as a duplicate. The other record is hidden, not deleted, and the merge is written to the audit log.')}
      <div class="row right" style="gap:8px">${button('Not the same person', { post: '/hire/duplicates/dismiss', body: { a: d.a.id, b: d.b.id, back: '1' }, kind: 'ghost' })}${button('Merge these two records', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

/** Buttons and alerts added to the hiring home page. */
export function hireHomeExtras(d: { canRecruit: boolean; overdue: number; duplicates: number; viaLink: number }): { actions: Raw; top: Raw } {
  return {
    actions: html`${button('Calendar', { href: '/hire/calendar', icon: 'calendar' })}${when(d.canRecruit, () => html`${button('Upload CVs', { modal: '/hire/upload' })}${button('Overdue', { href: '/hire/overdue' })}${button('Templates', { href: '/hire/templates' })}${button('Duplicates', { href: '/hire/duplicates' })}`)}`,
    top: html`${when(d.canRecruit && d.overdue, () => notice('warn', html`<b>${plural(d.overdue, 'candidate')}</b> ${d.overdue === 1 ? 'has' : 'have'} waited longer than the time limit. <a href="/hire/overdue">See who</a>`))}
      ${when(d.canRecruit && d.duplicates, () => notice('accent', html`<b>${plural(d.duplicates, 'pair')}</b> of candidate records look like the same person. <a href="/hire/duplicates">Compare and merge</a>`))}`
  };
}

/** Chosen from the hiring home: which vacancy are these CVs for? */
export function uploadChooserModal(open: Requisition[]): Raw {
  return modal({
    title: 'Upload CVs',
    body: html`<div class="stack">
      <p class="small muted">Choose the vacancy the CVs are for. You can then drop many files at once; LoyalFlow reads each one, shows you what it found, and adds them as candidates when you confirm.</p>
      ${open.length ? html`<div class="list">${open.map((r) => html`<a class="list-row" href="/hire/req/${r.id}/bulk"><span><b>${r.title}</b> <span class="muted small">· ${r.department || ''}</span></span><span class="btn btn-sm">Upload here</span></a>`)}</div>`
        : notice('warn', 'There is no open vacancy. Open a vacancy first; CVs are always uploaded against a vacancy.')}
      <p class="xs muted">For one person, use “Add candidate”: it has a CV field too.</p>
      <div class="row right">${button('Close', { kind: 'ghost', cls: 'js-close-modal' })}</div>
    </div>`
  });
}
