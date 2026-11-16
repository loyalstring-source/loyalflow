import { html, when, type Raw, type HtmlValue } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { icon, pill, empty, statCard, notice, field, input, textarea, select, button, table, avatar, kv } from '../components.ts';
import type { Appraisal, AppraisalCycle, KpiEvidence } from '../../modules/hr/appraisal.ts';
import { RATINGS, ratingLabel, parseKpis } from '../../modules/hr/appraisal.ts';
import { fmtDate } from '../../lib/time.ts';

const STATUS: Record<string, { label: string; tone: 'ink' | 'accent' | 'good' | 'warn' | 'crit' | 'violet' }> = {
  self: { label: 'Self review', tone: 'accent' },
  manager: { label: 'With manager', tone: 'violet' },
  moderation: { label: 'HOD moderation', tone: 'warn' },
  approval: { label: 'With COO', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  closed: { label: 'Closed', tone: 'ink' }
};
export const statusPill = (s: string): Raw => { const m = STATUS[s] || { label: s, tone: 'ink' as const }; return pill(m.label, m.tone); };
const money = (n: number | null | undefined): string => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);

export interface AppraisalsData {
  cycles: AppraisalCycle[]; cycle: AppraisalCycle | null; rows: Appraisal[]; mine: Appraisal[]; forMe: Appraisal[];
  canManage: boolean; canModerate: boolean; probation: Appraisal[]; tab: string;
}

export function appraisalsPage(v: View, d: AppraisalsData): Raw {
  const counts = (st: string) => d.rows.filter((r) => r.status === st).length;
  const tabs: { key: string; label: string; n: number }[] = [
    { key: 'mine', label: 'Mine', n: d.mine.length },
    { key: 'forme', label: 'My team', n: d.forMe.length },
    ...(d.canManage ? [{ key: 'all', label: 'Everyone', n: d.rows.length }, { key: 'probation', label: 'Probation', n: d.probation.length }] : [])
  ];
  const tab = tabs.some((t) => t.key === d.tab) ? d.tab : 'mine';
  const rowFor = (a: Appraisal, opts: { who?: boolean } = {}): HtmlValue[] => [
    opts.who === false ? html`<a href="/appraisals/${a.id}">${a.cycle_name || (a.kind === 'probation' ? 'Probation review' : 'Appraisal')}</a>`
      : html`<a href="/appraisals/${a.id}" class="row" style="gap:8px;text-decoration:none">${avatar(a.employee_name, a.employee_id)}<span><b>${a.employee_name}</b><br><span class="xs muted">${a.designation}</span></span></a>`,
    a.kind === 'probation' ? pill('Probation', 'violet') : html`<span class="muted">${a.cycle_name || 'Annual'}</span>`,
    statusPill(a.status),
    a.self_rating == null ? html`<span class="muted">—</span>` : html`${a.self_rating}/5`,
    a.manager_rating == null ? html`<span class="muted">—</span>` : html`${a.manager_rating}/5`,
    a.final_rating == null ? html`<span class="muted">—</span>` : html`<b>${ratingLabel(a.final_rating)}</b>`,
    a.increment_pct == null ? html`<span class="muted">—</span>` : html`${a.increment_pct}%`,
    a.due_date ? html`<span class="xs muted">${fmtDate(a.due_date)}</span>` : ''
  ];
  const heads = ['Person', 'Cycle', 'Stage', 'Self', 'Manager', 'Final', 'Increment', 'Due'];
  return page(v, {
    title: 'Appraisals',
    subtitle: d.cycle ? html`${d.cycle.name} · ${fmtDate(d.cycle.period_from)} to ${fmtDate(d.cycle.period_to)} · ${d.cycle.done || 0} of ${d.cycle.count || 0} complete` : 'Performance reviews and probation confirmations',
    actions: html`${when(d.canManage, () => html`${button('Run probation check', { post: '/appraisals/probation-scan', kind: '', icon: 'refresh' })}${button('New cycle', { modal: '/appraisals/cycles/new', kind: 'primary', icon: 'plus' })}`)}`,
    body: html`
      ${when(d.canManage && d.cycle, () => html`<div class="grid grid-4">
        ${statCard({ value: d.cycle!.count || 0, label: 'In this cycle' })}
        ${statCard({ value: counts('self'), label: 'Awaiting self review', tone: counts('self') ? 'warn' : 'good' })}
        ${statCard({ value: counts('manager') + counts('moderation'), label: 'With managers and HODs', tone: 'accent' })}
        ${statCard({ value: counts('approved') + counts('closed'), label: 'Approved', tone: 'good' })}
      </div>`)}
      <div class="tabs" role="tablist">${tabs.map((t) => html`<a href="/appraisals?tab=${t.key}" class="${t.key === tab ? 'active' : ''}">${t.label}${when(t.n, () => html` <span class="muted">${t.n}</span>`)}</a>`)}</div>
      ${when(tab === 'mine', () => html`<section class="card">
        <h2>Your reviews</h2>
        ${d.mine.length ? table(['Review', 'Kind', 'Stage', 'Self', 'Manager', 'Final', 'Increment', 'Due'], d.mine.map((a) => rowFor(a, { who: false }))) : empty('No appraisal is open for you right now.')}
      </section>`)}
      ${when(tab === 'forme', () => html`<section class="card">
        <h2>Your team</h2>
        <p class="muted small">You write the manager review once the person has submitted their own.</p>
        ${d.forMe.length ? table(heads, d.forMe.map((a) => rowFor(a))) : empty('Nothing waiting on you.')}
      </section>`)}
      ${when(tab === 'all', () => html`<section class="card">
        <div class="row between"><h2>Everyone</h2>
          <form method="get" action="/appraisals" class="row"><input type="hidden" name="tab" value="all"><select class="input" name="cycle" data-autosubmit style="min-height:38px;width:auto">${d.cycles.map((c) => html`<option value="${c.id}" ${when(d.cycle?.id === c.id, 'selected')}>${c.name}</option>`)}</select></form></div>
        ${when(d.cycle && d.cycle.status === 'draft', () => html`${notice('accent', html`This cycle has not been opened yet. Opening it creates a review for every active employee and asks each of them for a self review. ${button('Open the cycle', { post: `/appraisals/cycles/${d.cycle!.id}/open`, kind: 'primary', size: 'sm', confirm: 'Open this cycle for everyone?' })}`)}`)}
        ${d.rows.length ? table(heads, d.rows.map((a) => rowFor(a))) : empty('No appraisals in this cycle yet.')}
      </section>`)}
      ${when(tab === 'probation', () => html`<section class="card">
        <h2>Probation reviews</h2>
        <p class="muted small">Created automatically three weeks before six months from the join date. The reporting manager confirms, extends or exits.</p>
        ${d.probation.length ? table(heads, d.probation.map((a) => rowFor(a))) : empty('No probation review is due in the next three weeks.')}
      </section>`)}`
  });
}

export function cycleModal(v: View, suggested: { name: string; from: string; to: string; selfDue: string; managerDue: string }): Raw {
  return modal({
    title: 'New appraisal cycle',
    body: html`<form data-post="/appraisals/cycles" class="stack">
      ${field('Name', input('name', { value: suggested.name, required: true }), 'What people will see, for example "FY25-26 annual review".')}
      <div class="grid grid-2">${field('Period from', input('periodFrom', { type: 'date', value: suggested.from, required: true }))}${field('Period to', input('periodTo', { type: 'date', value: suggested.to, required: true }))}</div>
      <div class="grid grid-2">${field('Self review due', input('selfDue', { type: 'date', value: suggested.selfDue }))}${field('Manager review due', input('managerDue', { type: 'date', value: suggested.managerDue }))}</div>
      ${notice('accent', 'The cycle is created as a draft. Nobody is asked for anything until you open it.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Create draft', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

function kpiTable(items: KpiEvidence[]): Raw {
  if (!items.length) return empty('No KPI is tracked for this role.');
  return table(['Measure', 'Result', 'Target'], items.map((k) => [
    html`${k.name}`,
    html`<b class="${k.rag === 'good' ? 'c-good' : k.rag === 'crit' ? 'c-crit' : k.rag === 'warn' ? 'c-warn' : ''}">${k.value}</b>`,
    html`<span class="muted">${k.target}</span>`
  ]));
}

const ratingSelect = (name: string, value: number | null): Raw =>
  select(name, RATINGS.map((r) => ({ value: String(r.value), label: `${r.value} · ${r.label} — ${r.hint}`, selected: value === r.value })), { blank: 'Choose a rating' });

export interface AppraisalDetail { a: Appraisal; canSelf: boolean; canManager: boolean; canModerate: boolean; canApplyIncrement: boolean; ctc: number | null; nextMonthStart: string }

export function appraisalPage(v: View, d: AppraisalDetail): Raw {
  const a = d.a; const kpis = parseKpis(a);
  const probation = a.kind === 'probation';
  return page(v, {
    title: probation ? 'Probation review' : a.cycle_name || 'Appraisal',
    subtitle: html`${a.employee_name} · ${a.designation} · reporting to ${a.manager_name || '—'}`,
    actions: html`${statusPill(a.status)}${when(a.due_date, () => pill(html`Due ${fmtDate(a.due_date!)}`, 'ink'))}`,
    body: html`<div class="cols">
      <div class="col-main stack">
        ${when(a.status === 'self' && !d.canSelf, () => notice('accent', html`Waiting for ${a.employee_name} to write their self review.`))}
        <section class="card">
          <h2>What the numbers say</h2>
          <p class="muted small">Captured when the review opened. Evidence for the conversation, not a score.</p>
          ${kpiTable(kpis)}
        </section>
        ${when(!probation, () => html`<section class="card">
          <h2>Self review</h2>
          ${d.canSelf ? html`<form data-post="/appraisals/${a.id}/self" class="stack">
              ${field('What went well, what was hard, what you want next', textarea('review', { rows: 8, required: true, placeholder: 'Write in your own words. Your manager and HOD will read this.' }))}
              ${field('How would you rate your own year?', ratingSelect('rating', null))}
              <div class="row right">${button('Submit self review', { type: 'submit', kind: 'primary' })}</div>
            </form>`
            : a.self_at ? html`<div class="row between"><b>${a.self_rating}/5 · ${ratingLabel(a.self_rating)}</b><span class="xs muted">${fmtDate(a.self_at)}</span></div><p style="white-space:pre-wrap">${a.self_review}</p>`
            : empty('Not submitted yet.')}
        </section>`)}
        <section class="card">
          <h2>${probation ? 'Manager’s decision' : 'Manager review'}</h2>
          ${when(d.canManager && probation, () => html`<form data-post="/appraisals/${a.id}/probation" class="stack">
            ${field('How did the six months go?', textarea('review', { rows: 6, required: true, placeholder: 'What they picked up, where they need support, whether the role fits.' }))}
            ${field('Rating', ratingSelect('rating', null))}
            ${field('Outcome', select('outcome', [{ value: 'confirm', label: 'Confirm — make them permanent' }, { value: 'extend', label: 'Extend probation' }, { value: 'exit', label: 'Exit — do not confirm' }], { blank: 'Choose' }))}
            ${field('If extending, until', input('extendTo', { type: 'date' }), 'Leave blank unless you are extending.')}
            ${notice('warn', 'An exit outcome only records your decision here. HR will take it forward with you.')}
            <div class="row right">${button('Record decision', { type: 'submit', kind: 'primary' })}</div>
          </form>`)}
          ${when(d.canManager && !probation, () => html`<form data-post="/appraisals/${a.id}/manager" class="stack">
            ${field('Your review', textarea('review', { rows: 8, required: true, placeholder: 'Be specific: what they delivered, how they work with others, what you want to see next year.' }))}
            ${field('Your rating', ratingSelect('rating', null))}
            <div class="row right">${button('Submit to HOD', { type: 'submit', kind: 'primary' })}</div>
          </form>`)}
          ${when(!d.canManager, () => a.manager_at
            ? html`<div class="row between"><b>${a.manager_rating}/5 · ${ratingLabel(a.manager_rating)}</b><span class="xs muted">${fmtDate(a.manager_at!)}</span></div><p style="white-space:pre-wrap">${a.manager_review}</p>${when(probation && a.decision, () => pill(a.decision === 'confirm' ? 'Confirmed' : a.decision === 'extend' ? 'Probation extended' : 'Exit', a.decision === 'confirm' ? 'good' : a.decision === 'extend' ? 'warn' : 'crit'))}`
            : empty(a.status === 'self' ? 'Opens once the self review is in.' : 'Not submitted yet.'))}
        </section>
        ${when(!probation && d.canModerate && ['moderation', 'approval'].includes(a.status), () => html`<section class="card">
          <h2>Moderation</h2>
          <p class="muted small">Set the rating that stands on record and the increment you recommend. It goes to the COO for approval.</p>
          <form data-post="/appraisals/${a.id}/moderate" class="stack">
            ${field('Final rating', ratingSelect('finalRating', a.final_rating))}
            ${field('Recommended increment', input('incrementPct', { type: 'number', step: '0.5', min: 0, max: 100, value: a.increment_pct }), d.ctc ? `Current CTC ${money(d.ctc)} a year. 10% would be ${money(d.ctc * 0.1)}.` : 'No salary structure on record yet, so no amount can be shown.')}
            ${field('Note for the COO', textarea('decision', { rows: 4, value: a.decision, placeholder: 'Why this rating and this number.' }))}
            <div class="row right">${button(a.status === 'approval' ? 'Update and resend' : 'Send to COO', { type: 'submit', kind: 'primary' })}</div>
          </form>
        </section>`)}
      </div>
      <aside class="col-side stack">
        <section class="card">
          <h2>Outcome</h2>
          ${kv([
            { label: 'Final rating', value: a.final_rating == null ? html`<span class="muted">Not set</span>` : html`<b>${a.final_rating}/5 · ${ratingLabel(a.final_rating)}</b>` },
            { label: 'Increment', value: a.increment_pct == null ? html`<span class="muted">—</span>` : html`<b>${a.increment_pct}%</b> ${when(a.increment_amount, () => html`<span class="muted">(${money(a.increment_amount)}/yr)</span>`)}` },
            { label: 'Current CTC', value: d.ctc ? money(d.ctc) : html`<span class="muted">Not on record</span>` },
            { label: 'Approved', value: a.approved_at ? fmtDate(a.approved_at) : html`<span class="muted">—</span>` }
          ])}
          ${when(a.decision && !probation, () => html`<p class="small muted" style="white-space:pre-wrap">${a.decision}</p>`)}
        </section>
        ${when(d.canApplyIncrement, () => html`<section class="card">
          <h2>Apply the increment</h2>
          <p class="muted small">This writes a new salary structure. Payroll picks it up from the month you choose; earlier payslips are untouched.</p>
          <form data-post="/appraisals/${a.id}/apply" class="stack">
            ${field('Effective from', input('effectiveFrom', { type: 'date', value: d.nextMonthStart, required: true }))}
            <div class="row right">${button('Write new salary', { type: 'submit', kind: 'primary', confirm: 'Create a new salary structure from this increment?' })}</div>
          </form>
        </section>`)}
        <section class="card">
          <h2>How this works</h2>
          <ol class="small muted stack-xs" style="padding-left:18px;display:grid;gap:6px">
            ${probation
              ? html`<li>Created three weeks before six months from the join date.</li><li>The reporting manager confirms, extends or exits.</li><li>HR is notified either way.</li>`
              : html`<li>You write your own review first.</li><li>Your manager writes theirs and sends it up.</li><li>Your HOD sets the final rating and the increment.</li><li>The COO approves. HR then applies the new salary.</li>`}
          </ol>
        </section>
      </aside>
    </div>`
  });
}
