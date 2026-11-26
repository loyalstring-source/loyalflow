import * as lists from '../../lib/lists.ts';
import { html, when, type Raw, type HtmlValue } from '../../lib/html.ts';
import { page, modal, drawer, type View } from '../layout.ts';
import { icon, pill, empty, statCard, notice, field, input, textarea, select, button, table, avatar, kv, bar } from '../components.ts';
import type { Requisition, Candidate, Application, Interview, Scorecard, Offer, PipelineCounts, HiringDecision, Onboarding, OnboardingItem } from '../../modules/hr/recruiting.ts';
import { STAGES, STAGE_LABEL, MANUAL_STAGES, OUTCOME_LABEL, SCORE_AREAS, RECOMMENDATION_LABEL, ROUND_TYPES, parseRatings } from '../../modules/hr/recruiting.ts';
import type { Employee } from '../../modules/people/model.ts';
import type { Invitation, HireMessage } from '../../modules/hr/assessment.ts';
import { statusPill as assessStatusPill, sendPill } from './assess.ts';
import { fmtDate, fmtDateTime, fmtTime } from '../../lib/time.ts';

const money = (n: number | null | undefined): string => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const lakhs = (n: number | null | undefined): string => (n == null ? '—' : `₹${(n / 100000).toFixed(1)}L`);

const REQ_STATUS: Record<string, { label: string; tone: 'ink' | 'accent' | 'good' | 'warn' | 'crit' | 'violet' }> = {
  draft: { label: 'Draft', tone: 'ink' }, open: { label: 'Open', tone: 'good' }, paused: { label: 'Paused', tone: 'warn' }, closed: { label: 'Closed', tone: 'ink' }
};
export const reqPill = (s: string): Raw => { const m = REQ_STATUS[s] || { label: s, tone: 'ink' as const }; return pill(m.label, m.tone); };
const stagePill = (s: string): Raw => pill(STAGE_LABEL[s] || s, s === 'offer' || s === 'decision' ? 'violet' : s === 'interview' || s === 'assessment' ? 'accent' : s === 'hired' || s === 'onboarding' ? 'good' : 'ink');
const outcomeLabel = (o: string): string => OUTCOME_LABEL[o] || o.replace('_', ' ');
const OFFER_TONE: Record<string, 'ink' | 'accent' | 'good' | 'warn' | 'crit' | 'violet'> = { draft: 'ink', issued: 'violet', accepted: 'good', declined: 'crit', expired: 'warn', cancelled: 'ink' };
const recPill = (r: string): Raw => pill(RECOMMENDATION_LABEL[r] || r || '—', r === 'strong_yes' ? 'good' : r === 'yes' ? 'accent' : r === 'no' ? 'warn' : r === 'strong_no' ? 'crit' : 'ink');

export interface HireData {
  stats: { openRoles: number; positions: number; activeCandidates: number; interviewsThisWeek: number; offersOut: number; hiredThisQuarter: number };
  requisitions: Requisition[]; pipeline: PipelineCounts[]; myInterviews: Interview[]; scorecardsDue: Interview[]; canRecruit: boolean;
  holds: (Application & { overdue: boolean })[]; onboarding: (Application & { done: number; total: number; gatesOpen: number })[];
  extras?: { actions: Raw; top: Raw };
}

export function hirePage(v: View, d: HireData): Raw {
  const maxN = Math.max(1, ...d.pipeline.map((p) => p.n));
  return page(v, {
    title: 'Hiring',
    subtitle: `${d.stats.openRoles} open ${d.stats.openRoles === 1 ? 'role' : 'roles'} · ${d.stats.positions} ${d.stats.positions === 1 ? 'position' : 'positions'} · ${d.stats.activeCandidates} people in play`,
    actions: html`${when(d.canRecruit, () => html`${button('Settings', { href: '/hire/settings', kind: 'ghost' })}`)}${d.extras?.actions || ''}${when(d.canRecruit, () => html`${button('Questions', { href: '/hire/questions' })}${button('Assessments', { href: '/hire/assessments' })}${button('Add candidate', { modal: '/hire/candidates/new', icon: 'plus' })}${button('New vacancy', { modal: '/hire/req/new', kind: 'primary', icon: 'plus' })}`)}`,
    body: html`
      ${d.extras?.top || ''}
      ${when(d.scorecardsDue.length, () => notice('warn', html`You owe ${d.scorecardsDue.length} scorecard${d.scorecardsDue.length > 1 ? 's' : ''}: ${d.scorecardsDue.map((i) => html`<a href="/hire/interview/${i.id}">${i.candidate_name}</a> `)}`))}
      <div class="grid grid-4">
        ${statCard({ value: d.stats.openRoles, label: 'Open roles', sub: `${d.stats.positions} positions` })}
        ${statCard({ value: d.stats.activeCandidates, label: 'Active candidates', tone: 'accent' })}
        ${statCard({ value: d.stats.interviewsThisWeek, label: 'Interviews this week' })}
        ${statCard({ value: d.stats.offersOut, label: 'Offers out', tone: d.stats.offersOut ? 'warn' : 'neutral', sub: `${d.stats.hiredThisQuarter} hired in 90 days` })}
      </div>
      <div class="cols">
        <div class="col-main stack">
          <section class="card">
            <h2>Vacancies</h2>
            ${d.requisitions.length ? table(['Role', 'Department', 'Status', 'Positions', 'In play', 'Hired', 'Budget'], d.requisitions.map((r) => [
              html`<a href="/hire/req/${r.id}"><b>${r.title}</b></a><br><span class="xs muted">${r.location || 'Pune'} · ${r.experience || r.employment_type.replace('_', ' ')}</span>`,
              html`<span class="muted">${r.department || r.department_id}</span>`,
              reqPill(r.status),
              html`${r.positions}`,
              html`${r.active_applications || 0}`,
              html`${r.hired_count || 0}`,
              html`<span class="muted">${lakhs(r.budget_ctc)}</span>`
            ])) : empty('No vacancies yet.')}
          </section>
          <section class="card">
            <h2>Where everyone is</h2>
            <div class="stack-xs" style="display:grid;gap:10px;margin-top:8px">
              ${d.pipeline.map((p) => html`<div class="row" style="gap:12px"><span style="width:90px;flex:none" class="small">${p.label}</span><span style="flex:1;min-width:0">${bar(p.n / maxN * 100)}</span><b style="width:28px;text-align:right;flex:none">${p.n}</b></div>`)}
            </div>
          </section>
        </div>
        <aside class="col-side stack">
          ${when(d.canRecruit && d.holds.length, () => html`<section class="card">
            <h2>On hold — follow up</h2>
            <div class="list">${d.holds.map((a) => html`<a class="list-row" href="/hire/app/${a.id}">
              <span><b>${a.candidate_name}</b><br><span class="xs muted">${a.requisition_title} · ${a.hold_reason}</span></span>
              <span style="text-align:right">${a.overdue ? pill('Overdue', 'crit') : pill('On hold', 'warn')}<br><span class="xs muted">${a.hold_until ? fmtDate(a.hold_until) : ''}</span></span></a>`)}</div>
          </section>`)}
          ${when(d.canRecruit && d.onboarding.length, () => html`<section class="card">
            <h2>Onboarding</h2>
            <div class="list">${d.onboarding.map((a) => html`<a class="list-row" href="/hire/app/${a.id}">
              <span><b>${a.candidate_name}</b><br><span class="xs muted">${a.requisition_title}</span></span>
              <span style="text-align:right"><b class="small">${a.done} of ${a.total}</b><br><span class="xs muted">${a.gatesOpen ? `${a.gatesOpen} required left` : 'Ready to complete'}</span></span></a>`)}</div>
          </section>`)}
          <section class="card">
            <h2>Your interviews</h2>
            ${d.myInterviews.length ? html`<div class="list">${d.myInterviews.map((i) => html`<a class="list-row" href="/hire/interview/${i.id}">
              <span><b>${i.candidate_name}</b><br><span class="xs muted">${i.requisition_title} · round ${i.round}</span></span>
              <span class="xs muted" style="text-align:right">${fmtDate(i.starts_at)}<br>${fmtTime(i.starts_at)}</span></a>`)}</div>`
              : empty('Nothing scheduled for you.')}
          </section>
          ${when(d.canRecruit, () => html`<section class="card"><h2>Candidates</h2><p class="muted small">Every person we have spoken to, across roles.</p>${button('Open the candidate list', { href: '/hire/candidates' })}</section>`)}
        </aside>
      </div>`
  });
}

export function requisitionModal(v: View, d: { departments: { id: string; name: string }[]; managers: Employee[]; req?: Requisition }): Raw {
  const r = d.req;
  return modal({
    title: r ? `Edit ${r.title}` : 'New vacancy',
    body: html`<form data-post="/hire/req" class="stack">
      ${when(r, () => html`<input type="hidden" name="id" value="${r!.id}">`)}
      ${field('Role title', input('title', { value: r?.title, required: true, placeholder: 'Technical Support Engineer' }))}
      <div class="grid grid-2">
        ${field('Department', select('departmentId', d.departments.map((x) => ({ value: x.id, label: x.name, selected: r?.department_id === x.id })), { blank: 'Choose' }))}
        ${field('Positions', input('positions', { type: 'number', min: 1, value: r?.positions ?? 1, required: true }))}
      </div>
      <div class="grid grid-2">
        ${field('Experience wanted', input('experience', { value: r?.experience, placeholder: '2–4 years' }))}
        ${field('Location', input('location', { value: r?.location, placeholder: 'Pune' }))}
      </div>
      <div class="grid grid-2">
        ${field('Work mode', select('workMode', lists.options('hire.workModes').map((o) => ({ ...o, selected: (r?.work_mode || 'office') === o.value })), {}))}
        ${field('Target date to fill', input('targetDate', { type: 'date', value: r?.target_date }))}
      </div>
      <div class="grid grid-2">
        ${field('Budget CTC a year', input('budgetCtc', { type: 'number', min: 0, step: 1000, value: r?.budget_ctc }), 'The approved budget for each position.')}
        ${field('Hiring manager', select('hiringManagerId', d.managers.map((m) => ({ value: m.id, label: m.full_name, selected: (r?.hiring_manager_id || v.user.id) === m.id })), { blank: 'Choose' }))}
      </div>
      ${field('Why this role is needed', textarea('justification', { rows: 3, value: r?.justification, required: true, placeholder: 'What breaks if we do not hire, and what this person will own.' }))}
      ${field('What the job involves', textarea('description', { rows: 4, value: r?.description, placeholder: 'Day to day work, the skills that matter, who they work with.' }))}
      ${field('Headcount approval reference', input('approvalRef', { value: r?.approval_ref, placeholder: 'Approved by COO, email of 3 Nov' }), 'Approval happens outside LoyalFlow. Record who approved it and where that can be found. You can add this later, but the vacancy cannot be opened without it.')}
      ${notice('accent', 'Saved as a draft. Nobody is contacted until you open the vacancy.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button(r ? 'Save' : 'Create draft', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export interface RequisitionData { req: Requisition; applications: Application[]; pipeline: PipelineCounts[]; canRecruit: boolean; canSubmit: boolean; canAssess?: boolean; extraSide?: Raw; screening?: Map<string, { total: number; max: number; missed: number }> }

export function requisitionPage(v: View, d: RequisitionData): Raw {
  const r = d.req;
  const byStage = (s: string) => d.applications.filter((a) => a.stage === s && a.status !== 'closed');
  const closed = d.applications.filter((a) => a.status === 'closed');
  return page(v, {
    title: r.title,
    subtitle: html`${r.department || r.department_id} · ${r.positions} position${r.positions > 1 ? 's' : ''} · ${r.location || 'Pune'} · budget ${lakhs(r.budget_ctc)}`,
    actions: html`${reqPill(r.status)}
      ${when(d.canSubmit, () => button('Open vacancy', { modal: `/hire/req/${r.id}/open`, kind: 'primary' }))}
      ${when(r.status === 'draft' && d.canRecruit, () => button('Edit', { modal: `/hire/req/${r.id}/edit`, icon: 'edit' }))}
      ${when(r.status === 'open' && d.canRecruit, () => html`${button('Add candidate', { modal: `/hire/req/${r.id}/add`, kind: 'primary', icon: 'plus' })}${button('Upload CVs', { href: `/hire/req/${r.id}/bulk` })}${when(d.canAssess, () => button('English assessment', { modal: `/hire/req/${r.id}/assess` }))}${button('Pause', { post: `/hire/req/${r.id}/pause`, prompt: 'Why is this vacancy being paused?', promptKey: 'reason' })}${button('Close vacancy', { modal: `/hire/req/${r.id}/close` })}`)}
      ${when(r.status === 'paused' && d.canRecruit, () => html`${button('Resume', { post: `/hire/req/${r.id}/resume`, kind: 'primary' })}${button('Close vacancy', { modal: `/hire/req/${r.id}/close` })}`)}`,
    body: html`
      ${when(r.status === 'draft', () => notice('accent', 'This vacancy is a draft. Open it once the headcount approval is on record; candidates can be added after that.'))}
      ${when(r.status === 'paused', () => notice('warn', 'This vacancy is paused. People already in play can continue, but no new candidates can be added.'))}
      <div class="cols">
        <div class="col-main stack">
          ${STAGES.filter((s) => s !== 'hired').map((s) => html`<section class="card">
            <div class="row between"><h2>${STAGE_LABEL[s]} <span class="muted">${byStage(s).length}</span></h2></div>
            ${byStage(s).length ? html`<div class="list">${byStage(s).map((a) => html`<a class="list-row" href="/hire/app/${a.id}">
                <span class="row" style="gap:10px">${avatar(a.candidate_name, a.candidate_id)}<span><b>${a.candidate_name}</b><br><span class="xs muted">${a.source} · since ${fmtDate(a.stage_since)}${when(d.screening?.get(a.id), () => html` · screening <b>${d.screening!.get(a.id)!.total}/${d.screening!.get(a.id)!.max}</b>${d.screening!.get(a.id)!.missed ? ' ⚑' : ''}`)}</span></span></span>
                <span class="xs muted">${a.status === 'on_hold' ? pill('On hold', 'warn') : a.owner_name || ''}</span></a>`)}</div>`
              : empty('Nobody here.')}
          </section>`)}
          ${when(closed.length, () => html`<section class="card"><h2>Closed <span class="muted">${closed.length}</span></h2>
            ${table(['Candidate', 'Stage reached', 'Outcome', 'Reason'], closed.map((a) => [
              html`<a href="/hire/app/${a.id}">${a.candidate_name}</a>`, stagePill(a.stage),
              pill(outcomeLabel(a.outcome), a.outcome === 'hired' ? 'good' : 'ink'), html`<span class="small muted">${a.outcome_reason}</span>`]))}
          </section>`)}
        </div>
        <aside class="col-side stack">
          <section class="card"><h2>The role</h2>
            ${kv([
              { label: 'Hiring manager', value: r.hiring_manager || '—' },
              { label: 'Recruiter', value: r.recruiter || '—' },
              { label: 'Experience', value: r.experience || '—' },
              { label: 'Type', value: r.employment_type.replace('_', ' ') },
              { label: 'Work mode', value: r.work_mode ? lists.label('hire.workModes', r.work_mode) : '—' },
              { label: 'Target date', value: r.target_date ? fmtDate(r.target_date) : '—' },
              { label: 'Opened', value: r.approved_at ? fmtDate(r.approved_at) : '—' },
              { label: 'Approval reference', value: r.approval_ref || 'Not recorded yet' }
            ])}
            ${when(r.description, () => html`<p class="small" style="white-space:pre-wrap;margin-top:10px">${r.description}</p>`)}
          </section>
          ${d.extraSide || ''}
          <section class="card"><h2>Why we are hiring</h2><p class="small muted" style="white-space:pre-wrap">${r.justification}</p></section>
        </aside>
      </div>`
  });
}

export function candidatesPage(v: View, d: { rows: (Candidate & { applications?: number })[]; q: string }): Raw {
  return page(v, {
    title: 'Candidates',
    subtitle: `${d.rows.length} people on record`,
    actions: html`<form method="get" action="/hire/candidates" class="search" role="search">${icon('search', 16)}<input type="search" name="q" value="${d.q}" placeholder="Name, email or phone"></form>${button('Add candidate', { modal: '/hire/candidates/new', kind: 'primary', icon: 'plus' })}`,
    body: html`<section class="card">
      ${notice('accent', 'These records are personal data. Only HR and the people working on a hire can open them.')}
      ${d.rows.length ? table(['Name', 'Contact', 'Now at', 'Experience', 'Expected', 'Notice', 'Applications'], d.rows.map((c) => [
        html`<a href="/hire/candidate/${c.id}" class="row" style="gap:8px;text-decoration:none">${avatar(c.full_name, c.id)}<b>${c.full_name}</b></a>`,
        html`<span class="xs muted">${c.email}${when(c.phone, () => html`<br>${c.phone}`)}</span>`,
        html`${c.current_employer || '—'}`,
        html`${c.experience_years == null ? '—' : `${c.experience_years} yrs`}`,
        html`${lakhs(c.expected_ctc)}`,
        html`${c.notice_days == null ? '—' : `${c.notice_days} days`}`,
        html`${c.applications || 0}`
      ])) : empty('No candidates yet.')}
    </section>`
  });
}

export function candidateModal(v: View, d: { openRoles: Requisition[]; duplicates?: Candidate[]; draft?: Record<string, string> }): Raw {
  return modal({
    title: 'Add a candidate',
    body: html`<form data-post="/hire/candidates" class="stack">
      ${when(d.duplicates && d.duplicates.length, () => notice('warn', html`We may already have this person: ${d.duplicates!.map((c) => html`<a href="/hire/candidate/${c.id}">${c.full_name}</a> `)}`))}
      ${field('Full name', input('fullName', { required: true }))}
      <div class="grid grid-2">${field('Email', input('email', { type: 'email' }))}${field('Phone', input('phone'))}</div>
      <div class="grid grid-2">${field('Currently at', input('currentEmployer'))}${field('Experience in years', input('experienceYears', { type: 'number', step: '0.5', min: 0 }))}</div>
      <div class="grid grid-2">${field('Current CTC', input('currentCtc', { type: 'number', min: 0, step: 1000 }))}${field('Expected CTC', input('expectedCtc', { type: 'number', min: 0, step: 1000 }))}</div>
      <div class="grid grid-2">${field('Notice period in days', input('noticeDays', { type: 'number', min: 0 }))}${field('Location', input('location'))}</div>
      ${field('Apply to', select('requisitionId', d.openRoles.map((r) => ({ value: r.id, label: `${r.title} · ${r.department || r.department_id}` })), { blank: 'Just add to the list for now' }))}
      ${field('Where they came from', select('source', lists.options('hire.sources').map((s) => ({ value: s.label.toLowerCase(), label: s.label })), { blank: 'Choose' }))}
      ${field('Notes', textarea('notes', { rows: 3, placeholder: 'First impressions, who referred them, anything worth remembering.' }))}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Save candidate', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export interface ApplicationData {
  a: Application; candidate: Candidate; req: Requisition; events: { id: number; kind: string; text: string; actor_name: string | null; at: string }[];
  interviews: Interview[]; offers: Offer[]; canRecruit: boolean; canDecide: boolean;
  decisions: HiringDecision[]; onboarding: Onboarding | undefined; onboardingItems: OnboardingItem[];
  assessments: Invitation[]; messages: HireMessage[]; canAssess: boolean;
  /** Cards from the sourcing and screening features, rendered by hire-extra.ts. */
  extraMain?: Raw; extraSide?: Raw; extraActions?: Raw;
}

export function applicationPage(v: View, d: ApplicationData): Raw {
  const a = d.a; const c = d.candidate;
  const live = a.status === 'active';
  const held = a.status === 'on_hold';
  const manual = live && MANUAL_STAGES.includes(a.stage);
  const nextStages = MANUAL_STAGES.filter((s) => s !== a.stage);
  const gatesOpen = d.onboardingItems.filter((i) => i.gate === 1 && !i.done_at);
  const hasEmployee = !!d.onboarding?.employee_id;
  const acceptedOffer = d.offers.find((o) => o.status === 'accepted');
  return page(v, {
    title: c.full_name,
    subtitle: html`${d.req.title} · ${a.source} · in ${STAGE_LABEL[a.stage]} since ${fmtDate(a.stage_since)}`,
    actions: html`${stagePill(a.stage)}${when(held, () => pill('On hold', 'warn'))}${d.extraActions || ''}
      ${when(manual && d.canRecruit, () => html`${button('Schedule interview', { modal: `/hire/app/${a.id}/schedule`, icon: 'calendar' })}${button('Record decision', { modal: `/hire/app/${a.id}/decision`, kind: 'primary' })}`)}
      ${when(live && a.stage === 'offer' && d.canRecruit && !d.offers.some((o) => ['draft', 'issued'].includes(o.status)), () => button('Draft offer', { modal: `/hire/app/${a.id}/offer`, kind: 'primary' }))}
      ${when(a.status === 'closed', () => pill(outcomeLabel(a.outcome), a.outcome === 'hired' ? 'good' : 'ink'))}`,
    body: html`<div class="cols">
      <div class="col-main stack">
        ${when(a.status === 'closed', () => notice(a.outcome === 'hired' ? 'good' : 'accent', html`<b>${outcomeLabel(a.outcome)}</b> — ${a.outcome_reason}${when(a.outcome !== 'hired' && d.canRecruit, () => html` ${button('Reopen', { post: `/hire/app/${a.id}/reopen`, size: 'sm', prompt: 'Why is this being reopened?', promptKey: 'reason' })}`)}`))}
        ${when(held, () => notice('warn', html`<b>On hold until ${a.hold_until ? fmtDate(a.hold_until) : '—'}</b> — ${a.hold_reason} ${button('Resume', { post: `/hire/app/${a.id}/resume`, size: 'sm' })}${button('Not going ahead', { modal: `/hire/app/${a.id}/close`, size: 'sm', kind: 'ghost' })}`))}
        ${when(manual && d.canRecruit, () => html`<section class="card">
          <h2>Move this application</h2>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            ${nextStages.map((s) => button(STAGE_LABEL[s], { post: `/hire/app/${a.id}/stage`, body: { to: s }, size: 'sm' }))}
            ${button('Put on hold', { modal: `/hire/app/${a.id}/hold`, size: 'sm', kind: 'ghost' })}
            ${button('Not going ahead', { modal: `/hire/app/${a.id}/close`, size: 'sm', kind: 'ghost' })}
          </div>
          <p class="xs muted" style="margin-top:8px">Offer, onboarding and hired are not buttons here: a recorded decision to hire moves the application to offer, an accepted offer starts onboarding, and a completed onboarding makes the person hired. No score rejects anybody.</p>
        </section>`)}
        ${when(live && a.stage === 'offer' && d.canRecruit, () => html`<section class="card"><div class="row between"><h2>Offer stage</h2><span class="row" style="gap:6px">${button('Put on hold', { modal: `/hire/app/${a.id}/hold`, size: 'sm', kind: 'ghost' })}${button('Not going ahead', { modal: `/hire/app/${a.id}/close`, size: 'sm', kind: 'ghost' })}</span></div>
          <p class="small muted">Draft the offer, check it, then issue it yourself. Nothing is sent to the candidate automatically. Record the candidate's answer when it arrives.</p></section>`)}
        ${when(d.onboarding, () => html`<section class="card">
          <div class="card-head"><h2>Onboarding</h2>${pill(d.onboarding!.status === 'complete' ? 'Complete' : d.onboarding!.status === 'in_progress' ? 'In progress' : 'Not started', d.onboarding!.status === 'complete' ? 'good' : d.onboarding!.status === 'in_progress' ? 'accent' : 'ink')}</div>
          <div class="list" style="margin-top:8px">${d.onboardingItems.map((it) => html`<div class="list-row" style="align-items:center">
            <span><b class="small" style="${it.done_at ? 'text-decoration:line-through;color:var(--faint)' : ''}">${it.label}</b>${when(it.gate === 1, () => html` ${pill('Required', 'violet')}`)}<br>
              <span class="xs muted">${it.done_at ? `Done by ${it.done_by_name || '—'} on ${fmtDate(it.done_at)}` : `${it.owner_name || 'HR'} · due ${it.due_date ? fmtDate(it.due_date) : '—'}`}</span></span>
            <span>${when(d.canRecruit && d.onboarding!.status !== 'complete' && it.key !== 'employee_record', () => it.done_at
              ? button('Undo', { post: `/hire/onboarding/item/${it.id}`, body: { done: '0' }, size: 'sm', kind: 'ghost' })
              : button('Mark done', { post: `/hire/onboarding/item/${it.id}`, body: { done: '1' }, size: 'sm' }))}
              ${when(d.canRecruit && it.key === 'employee_record' && !hasEmployee && acceptedOffer, () => button('Create employee', { modal: `/hire/offer/${acceptedOffer!.id}/onboard`, size: 'sm', kind: 'primary' }))}</span>
          </div>`)}</div>
          ${when(d.canRecruit && d.onboarding!.status !== 'complete', () => html`<div class="row between" style="margin-top:12px">
            <span class="small muted">${gatesOpen.length ? `Onboarding can be completed once these are done: ${gatesOpen.map((g) => g.label).join('; ')}.` : 'All required items are done.'}</span>
            ${button('Complete onboarding', { post: `/hire/app/${a.id}/onboarding/complete`, kind: 'good', disabled: gatesOpen.length > 0, confirm: 'Complete onboarding and mark this person as hired?' })}</div>`)}
        </section>`)}
        ${when(d.decisions.length, () => html`<section class="card">
          <h2>Hiring decision</h2>
          <div class="list">${d.decisions.map((x) => html`<div class="list-row"><span>${pill(x.outcome === 'hire' ? 'Hire' : x.outcome === 'hold' ? 'Hold' : 'Reject', x.outcome === 'hire' ? 'good' : x.outcome === 'hold' ? 'warn' : 'crit')} <span class="small" style="white-space:pre-wrap">${x.rationale}</span><br><span class="xs muted">${x.decided_by_name || '—'} · ${fmtDateTime(x.decided_at)}</span></span></div>`)}</div>
        </section>`)}
        ${d.extraMain || ''}
        ${when(d.canRecruit && (d.assessments.length || ((live || held) && d.canAssess && MANUAL_STAGES.includes(a.stage))), () => html`<section class="card">
          <div class="card-head"><h2>Workplace English assessment</h2>${when((live || held) && d.canAssess, () => button(d.assessments.length ? 'Reissue' : 'Invite', { modal: `/hire/app/${a.id}/assess`, size: 'sm' }))}</div>
          ${d.assessments.length ? table(['Level', 'Status', 'Email', 'Expires', 'Objective', 'Writing', ''], d.assessments.map((x) => [
            html`<b>${x.level}</b>`, assessStatusPill(x.status), sendPill(x.send_state), html`<span class="small">${fmtDateTime(x.expires_at)}</span>`,
            html`${x.objective_score == null ? '—' : `${x.objective_score} / ${x.objective_total}`}`,
            html`${x.status !== 'submitted' ? '—' : x.reviewed_at ? `${x.review_total} / 20` : pill('To review', 'warn')}`,
            html`${when(x.status === 'submitted', () => button(x.reviewed_at ? 'Open' : 'Review', { href: `/hire/assessments/${x.id}`, size: 'sm' }))}${when(['invited', 'started'].includes(x.status), () => button('Get link', { modal: `/hire/assessments/${x.id}/link`, size: 'sm', kind: 'primary' }))}`
          ])) : html`<p class="small muted">Not invited. The assessment is optional and advisory: it informs the decision and never makes it.</p>`}
        </section>`)}
        <section class="card">
          <h2>Interviews</h2>
          ${d.interviews.length ? html`<div class="list">${d.interviews.map((i) => html`<a class="list-row" href="/hire/interview/${i.id}">
            <span><b>Round ${i.round} · ${lists.label('hire.roundTypes', i.round_type)}</b><br><span class="xs muted">${(i.panel || []).map((p) => p.name).join(', ') || 'No panel'}</span></span>
            <span style="text-align:right"><span class="xs muted">${fmtDateTime(i.starts_at)}</span><br>${pill(i.status.replace('_', ' '), i.status === 'completed' ? 'good' : i.status === 'cancelled' ? 'ink' : 'accent')}</span></a>`)}</div>`
            : empty('No interviews yet.')}
        </section>
        ${when(d.offers.length, () => html`<section class="card">
          <h2>Offers</h2>
          ${table(['Role', 'CTC', 'Joining', 'Status', ''], d.offers.map((o) => [
            html`${o.designation}`, html`<b>${money(o.ctc_annual)}</b>`, html`${o.joining_date ? fmtDate(o.joining_date) : '—'}`,
            pill(o.status, OFFER_TONE[o.status] || 'ink'),
            html`<span class="row" style="gap:6px;justify-content:flex-end">
              ${when(o.status === 'draft' && d.canRecruit, () => html`${button('Issue offer', { post: `/hire/offer/${o.id}/issue`, size: 'sm', kind: 'primary', confirm: 'Issue this offer to the candidate? Nothing is sent automatically — you send the letter yourself.' })}${button('Cancel', { post: `/hire/offer/${o.id}/cancel`, size: 'sm', kind: 'ghost', prompt: 'Why is this offer being cancelled?', promptKey: 'reason' })}`)}
              ${when(o.status === 'issued' && d.canRecruit, () => html`${button('Accepted', { post: `/hire/offer/${o.id}/response`, body: { response: 'accepted' }, size: 'sm', kind: 'good' })}${button('Declined', { post: `/hire/offer/${o.id}/response`, body: { response: 'declined' }, size: 'sm', kind: 'ghost', prompt: 'What did they say?', promptKey: 'note' })}${button('Cancel', { post: `/hire/offer/${o.id}/cancel`, size: 'sm', kind: 'ghost', prompt: 'Why is this offer being cancelled?', promptKey: 'reason' })}`)}
            </span>`
          ]))}
        </section>`)}
        ${when(d.canRecruit && d.messages.length, () => html`<section class="card">
          <h2>Messages to the candidate</h2>
          ${table(['When', 'Message', 'To', 'Result'], d.messages.map((m) => [
            html`<span class="small">${fmtDateTime(m.at)}</span>`, html`<span class="small">${m.kind.replace(/_/g, ' ')}</span>`, html`<span class="small muted">${m.recipient || '—'}</span>`,
            html`${sendPill(m.state)}<br><span class="xs muted">${m.detail}</span>`]))}
        </section>`)}
        <section class="card">
          <h2>History</h2>
          ${d.events.length ? html`<div class="timeline">${d.events.map((e) => html`<div class="t-row"><span class="t-dot"></span><div><b class="small">${e.text}</b><br><span class="xs muted">${e.actor_name || 'System'} · ${fmtDateTime(e.at)}</span></div></div>`)}</div>` : empty('Nothing yet.')}
        </section>
      </div>
      <aside class="col-side stack">
        <section class="card">
          <h2>${c.full_name}</h2>
          ${kv([
            { label: 'Email', value: c.email || '—' }, { label: 'Phone', value: c.phone || '—' },
            { label: 'Now at', value: c.current_employer || '—' },
            { label: 'Experience', value: c.experience_years == null ? '—' : `${c.experience_years} years` },
            { label: 'Current CTC', value: money(c.current_ctc) }, { label: 'Expected', value: money(c.expected_ctc) },
            { label: 'Notice', value: c.notice_days == null ? '—' : `${c.notice_days} days` },
            { label: 'Location', value: c.location || '—' }
          ])}
          ${when(c.notes, () => html`<p class="small muted" style="white-space:pre-wrap;margin-top:10px">${c.notes}</p>`)}
        </section>
        ${d.extraSide || ''}
        ${when((live || held) && d.canRecruit, () => html`<section class="card">
          <h2>Screening notes</h2>
          <form data-post="/hire/app/${a.id}/notes" class="stack">
            ${textarea('notes', { rows: 5, value: a.screening_notes, placeholder: 'What you covered on the call and what you want the panel to probe.' })}
            <div class="row right">${button('Save', { type: 'submit', size: 'sm' })}</div>
          </form>
        </section>`)}
      </aside>
    </div>`
  });
}

export function scheduleModal(v: View, d: { a: Application; people: Employee[]; conflictWarning?: string; preset?: { name: string; interviewerId: string } }): Raw {
  return modal({
    title: `Interview · ${d.a.candidate_name}`,
    body: html`<form data-post="/hire/app/${d.a.id}/schedule" class="stack">
      ${when(d.conflictWarning, () => notice('warn', d.conflictWarning!))}
      ${field('Round name', input('roundName', { value: d.preset?.name || '', placeholder: 'HR round, Team manager round, COO round…' }))}
      <div class="grid grid-2">
        ${field('Kind', select('roundType', lists.options('hire.roundTypes'), {}))}
        ${field('Mode', select('mode', [{ value: 'in_person', label: 'In person' }, { value: 'video', label: 'Video call' }, { value: 'phone', label: 'Phone' }], {}))}
      </div>
      <div class="grid grid-2">
        ${field('Date and time', input('startsAt', { type: 'datetime-local', required: true }))}
        ${field('Minutes', input('minutes', { type: 'number', min: 15, step: 15, value: 45 }))}
      </div>
      ${field('Where / link', input('location', { placeholder: 'Pune office, meeting room 2' }))}
      ${field('Panel', html`<div class="chips-wrap" style="display:grid;gap:6px;max-height:220px;overflow:auto">${d.people.map((p) => html`<label class="row" style="gap:8px"><input type="checkbox" name="panel[]" value="${p.id}" ${d.preset && d.preset.interviewerId === p.id ? 'checked' : ''}> <span class="small">${p.full_name} <span class="muted">· ${p.designation}</span></span></label>`)}</div>`, 'Each of them writes their own scorecard. Nobody sees anyone else’s until all are in.')}
      <label class="row small" style="gap:8px"><input type="checkbox" name="force" value="1"> Schedule anyway — the panel is busy, or this already happened</label>
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Schedule', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function closeApplicationModal(v: View, a: Application): Raw {
  return modal({
    title: `Not going ahead · ${a.candidate_name}`,
    body: html`<form data-post="/hire/app/${a.id}/close" class="stack">
      ${field('Outcome', select('outcome', [{ value: 'rejected', label: 'We are not taking this forward' }, { value: 'withdrawn', label: 'The candidate withdrew' }, { value: 'no_show', label: 'The candidate did not turn up' }], {}))}
      ${field('Reason', textarea('reason', { rows: 4, required: true, placeholder: 'Specific and honest. This is what the candidate is owed and what we look back on.' }))}
      ${notice('accent', 'Scores never decide this. Your name goes on the decision.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Record decision', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function holdModal(v: View, a: Application): Raw {
  return modal({
    title: `Put on hold · ${a.candidate_name}`,
    body: html`<form data-post="/hire/app/${a.id}/hold" class="stack">
      ${field('Why', textarea('reason', { rows: 3, required: true, placeholder: 'What are we waiting for?' }))}
      ${field('Look at this again on', input('until', { type: 'date', required: true }))}
      ${notice('accent', 'The application stays open. It appears in the follow-up list on the Hiring page, and is flagged once this date passes.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Put on hold', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function decisionModal(v: View, d: { a: Application; cards: { interviewer: string; recommendation: string; overall: number | null; round: number }[] }): Raw {
  return modal({
    title: `Hiring decision · ${d.a.candidate_name}`,
    body: html`<form data-post="/hire/app/${d.a.id}/decision" class="stack">
      ${d.cards.length ? html`<div><span class="small muted">Submitted scorecards this decision rests on</span>${table(['Round', 'Interviewer', 'Recommendation', 'Overall'], d.cards.map((c) => [html`${c.round}`, html`${c.interviewer}`, recPill(c.recommendation), html`${c.overall ?? '—'}`]))}</div>`
        : notice('warn', 'No scorecards have been submitted. You can record hold or reject, but a decision to hire needs interview feedback first.')}
      ${field('Decision', select('outcome', [{ value: 'hire', label: 'Hire — move to offer' }, { value: 'hold', label: 'Hold — keep open and follow up' }, { value: 'reject', label: 'Reject — close the application' }], {}))}
      ${field('Reasons', textarea('rationale', { rows: 4, required: true, placeholder: 'What the panel saw, and why this is the decision.' }))}
      ${field('If hold: look at this again on', input('holdUntil', { type: 'date' }))}
      ${notice('accent', 'Your name and the time go on this decision. Scores are evidence; they never decide by themselves.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Record decision', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function openRequisitionModal(v: View, r: Requisition): Raw {
  return modal({
    title: `Open vacancy · ${r.title}`,
    body: html`<form data-post="/hire/req/${r.id}/open" class="stack">
      ${field('Headcount approval reference', input('approvalRef', { value: r.approval_ref, required: true, placeholder: 'Approved by COO, email of 3 Nov' }), 'Who approved this headcount, and where that approval can be found.')}
      ${notice('accent', 'Approval happens outside LoyalFlow. This only records the reference; nothing is sent to anyone for approval.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Open vacancy', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function closeRequisitionModal(v: View, r: Requisition): Raw {
  return modal({
    title: `Close vacancy · ${r.title}`,
    body: html`<form data-post="/hire/req/${r.id}/close" class="stack">
      ${field('Why is it closing', textarea('reason', { rows: 3, required: true }))}
      ${field(`What happens to the ${r.active_applications || 0} people still in play`, select('applicants', [{ value: 'keep', label: 'Keep their applications open for HR to finish' }, { value: 'close', label: 'Close their applications with this reason' }], {}), 'People already in offer or onboarding are never closed this way.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Close vacancy', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function offerModal(v: View, d: { a: Application; req: Requisition; candidate: Candidate }): Raw {
  return modal({
    title: `Draft offer · ${d.candidate.full_name}`,
    body: html`<form data-post="/hire/app/${d.a.id}/offer" class="stack">
      <div class="grid grid-2">
        ${field('Designation', input('designation', { value: d.req.title, required: true }))}
        ${field('CTC a year', input('ctcAnnual', { type: 'number', min: 0, step: 1000, value: d.req.budget_ctc, required: true }), d.req.budget_ctc ? `Approved budget ${money(d.req.budget_ctc)}. Expected ${money(d.candidate.expected_ctc)}.` : `Expected ${money(d.candidate.expected_ctc)}.`)}
      </div>
      <div class="grid grid-2">
        ${field('Joining date', input('joiningDate', { type: 'date', required: true }))}
        ${field('Offer valid until', input('expiryDate', { type: 'date' }))}
      </div>
      ${field('Anything else in the letter', textarea('body', { rows: 4, placeholder: 'Joining bonus, relocation, retention terms.' }))}
      ${notice('accent', 'This only drafts the offer. You check it and issue it yourself — nothing reaches the candidate automatically. Any approval of the terms happens outside LoyalFlow.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Save draft', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function onboardModal(v: View, d: { offer: Offer; suggestedId: string; managers: Employee[]; sites: { id: string; name: string }[]; shifts: { code: string; name: string }[] }): Raw {
  return modal({
    title: `Create employee · ${d.offer.candidate_name}`,
    body: html`<form data-post="/hire/offer/${d.offer.id}/onboard" class="stack">
      <div class="grid grid-2">${field('Employee ID', input('employeeId', { value: d.suggestedId, required: true }))}${field('Work email', input('email', { type: 'email', required: true }))}</div>
      ${field('Reporting manager', select('reportingManagerId', d.managers.map((m) => ({ value: m.id, label: m.full_name })), { blank: 'Choose' }))}
      <div class="grid grid-2">${field('Shift', select('shiftCode', d.shifts.map((x) => ({ value: x.code, label: x.name })), {}))}${field('Site', select('siteId', d.sites.map((x) => ({ value: x.id, label: x.name })), {}))}</div>
      ${notice('accent', 'This creates the employee record on probation and ticks that item on the onboarding checklist. Set their salary in Payroll before the first run.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Create record', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export interface InterviewData {
  i: Interview; a: Application; candidate: Candidate; mine: Scorecard | undefined; onPanel: boolean;
  visible: { cards: Scorecard[]; hidden: number; calibrated: boolean }; canRecruit: boolean;
  /** Who has submitted. Knowing that someone is done says nothing about what they said. */
  submittedBy: string[];
}

export function interviewPage(v: View, d: InterviewData): Raw {
  const i = d.i;
  const ratings = parseRatings(d.mine);
  const locked = !!(d.mine?.submitted_at && !d.mine?.reopened_at);
  return page(v, {
    title: `${d.candidate.full_name} · round ${i.round}`,
    subtitle: html`${i.requisition_title} · ${lists.label('hire.roundTypes', i.round_type)} · ${fmtDateTime(i.starts_at)}${when(i.location, () => html` · ${i.location}`)}`,
    actions: html`${pill(i.status.replace('_', ' '), i.status === 'completed' ? 'good' : i.status === 'cancelled' ? 'ink' : 'accent')}
      ${when(d.canRecruit && i.status === 'scheduled', () => html`${button('Mark done', { post: `/hire/interview/${i.id}/status`, body: { status: 'completed' }, kind: 'primary' })}${button('No show', { post: `/hire/interview/${i.id}/status`, body: { status: 'no_show' } })}${button('Reschedule', { modal: `/hire/interview/${i.id}/reschedule`, icon: 'calendar' })}`)}`,
    body: html`<div class="cols">
      <div class="col-main stack">
        ${when(d.onPanel, () => html`<section class="card">
          <h2>Your scorecard</h2>
          ${locked
            ? html`<p class="muted small">Submitted ${fmtDateTime(d.mine!.submitted_at!)}. Ask HR if you need it reopened.</p>${scorecardView(d.mine!)}`
            : html`<form data-post="/hire/interview/${i.id}/scorecard" class="stack">
                <p class="muted small">Write yours before you read anyone else’s. Rate 1 to 5, and say what they actually did or said.</p>
                ${SCORE_AREAS.map((area) => html`<div class="row between" style="gap:12px;align-items:center">
                  <span class="small" style="flex:1">${area.label}</span>
                  <span class="row" style="gap:4px">${[1, 2, 3, 4, 5].map((n) => html`<label class="rate"><input type="radio" name="r_${area.key}" value="${n}" ${when(ratings[area.key] === n, 'checked')}> <span>${n}</span></label>`)}</span>
                </div>`)}
                ${field('What they said or did', textarea('evidence', { rows: 5, value: d.mine?.evidence, placeholder: 'The actual answer, the actual code, the actual example. Not “good communication”.' }))}
                ${field('Anything else', textarea('notes', { rows: 3, value: d.mine?.notes }))}
                ${field('Would you hire them?', select('recommendation', Object.entries(RECOMMENDATION_LABEL).map(([k, l]) => ({ value: k, label: l, selected: d.mine?.recommendation === k })), { blank: 'Choose' }))}
                <div class="row right">${button('Save draft', { type: 'submit', kind: 'ghost' })}${button('Submit', { type: 'submit', kind: 'primary', cls: 'js-submit-final' })}<input type="hidden" name="submit" value="1"></div>
              </form>`}
        </section>`)}
        <section class="card">
          <h2>The panel’s view</h2>
          ${d.visible.calibrated
            ? (d.visible.cards.length ? html`<div class="stack">${d.visible.cards.map((s) => scorecardView(s))}</div>` : empty('No scorecards submitted.'))
            : html`${notice('accent', d.visible.hidden
                ? `${d.visible.hidden} other scorecard${d.visible.hidden > 1 ? 's are' : ' is'} in, hidden until everyone has submitted. This is on purpose: the first opinion should not become everyone's.`
                : 'Scorecards open once every interviewer has submitted.')}
              ${d.visible.cards.map((s) => scorecardView(s))}
              ${when(d.canRecruit, () => button('Open them now for calibration', { post: `/hire/interview/${i.id}/calibrate`, size: 'sm', confirm: 'Open all submitted scorecards to the panel?' }))}`}
        </section>
      </div>
      <aside class="col-side stack">
        <section class="card"><h2>Candidate</h2>
          ${kv([
            { label: 'Applied for', value: html`<a href="/hire/app/${d.a.id}">${i.requisition_title}</a>` },
            { label: 'Now at', value: d.candidate.current_employer || '—' },
            { label: 'Experience', value: d.candidate.experience_years == null ? '—' : `${d.candidate.experience_years} years` },
            { label: 'Notice', value: d.candidate.notice_days == null ? '—' : `${d.candidate.notice_days} days` }
          ])}
          ${when(d.a.screening_notes, () => html`<p class="small muted" style="white-space:pre-wrap;margin-top:10px"><b>Screening:</b> ${d.a.screening_notes}</p>`)}
        </section>
        <section class="card"><h2>Panel</h2><div class="list">${(i.panel || []).map((p) => html`<div class="list-row row between" style="gap:10px"><span class="row" style="gap:8px;min-width:0">${avatar(p.name, p.id)}<span class="small">${p.name}</span></span>${d.submittedBy.includes(p.id) ? pill('Scorecard in', 'good') : pill('Waiting', 'ink')}</div>`)}</div></section>
      </aside>
    </div>`
  });
}

function scorecardView(s: Scorecard): Raw {
  const r = parseRatings(s);
  return html`<div class="card" style="box-shadow:none;border:1px solid var(--line)">
    <div class="row between"><b>${s.interviewer_name}</b><span class="row" style="gap:8px">${recPill(s.recommendation)}${when(s.overall, () => pill(html`${s.overall}/5`, 'ink'))}</span></div>
    <div class="row small muted" style="gap:14px;flex-wrap:wrap;margin:6px 0">${SCORE_AREAS.map((a) => html`<span>${a.label} <b class="c-ink">${r[a.key] ?? '—'}</b></span>`)}</div>
    ${when(s.evidence, () => html`<p class="small" style="white-space:pre-wrap">${s.evidence}</p>`)}
    ${when(s.notes, () => html`<p class="small muted" style="white-space:pre-wrap">${s.notes}</p>`)}
  </div>`;
}

export function rescheduleModal(v: View, i: Interview, at = ''): Raw {
  const was = Math.max(15, Math.round((new Date(i.ends_at).getTime() - new Date(i.starts_at).getTime()) / 60_000));
  return modal({
    title: `Move round ${i.round}`,
    body: html`<form data-post="/hire/interview/${i.id}/reschedule" class="stack">
      <div class="grid grid-2">${field('New date and time', input('startsAt', { type: 'datetime-local', required: true, value: at }))}${field('Minutes', input('minutes', { type: 'number', min: 15, step: 15, value: was }))}</div>
      ${field('Why', input('reason', { required: true, placeholder: 'Panel clash, candidate asked to move' }))}
      <label class="row small" style="gap:8px"><input type="checkbox" name="force" value="1"> Move even if someone is already booked</label>
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Move it', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function candidateDrawer(v: View, d: { c: Candidate; apps: Application[] }): Raw {
  return drawer({
    title: d.c.full_name,
    meta: html`${d.c.email} · ${d.c.phone}`,
    body: html`${kv([
      { label: 'Now at', value: d.c.current_employer || '—' },
      { label: 'Experience', value: d.c.experience_years == null ? '—' : `${d.c.experience_years} years` },
      { label: 'Current CTC', value: money(d.c.current_ctc) }, { label: 'Expected', value: money(d.c.expected_ctc) },
      { label: 'Notice', value: d.c.notice_days == null ? '—' : `${d.c.notice_days} days` }
    ])}
    <h3 class="small" style="margin-top:14px">Applications</h3>
    ${d.apps.length ? html`<div class="list">${d.apps.map((a) => html`<a class="list-row" href="/hire/app/${a.id}"><span>${a.requisition_title}</span>${stagePill(a.stage)}</a>`)}</div>` : empty('None yet.')}
    ${when(d.c.notes, () => html`<p class="small muted" style="white-space:pre-wrap;margin-top:12px">${d.c.notes}</p>`)}`
  });
}
