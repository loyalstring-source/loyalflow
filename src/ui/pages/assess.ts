import { number as limit } from '../../lib/lists.ts';
import { html, raw, when, jsonScript, type Raw } from '../../lib/html.ts';
import { page, modal, publicPage, type View } from '../layout.ts';
import { pill, empty, statCard, notice, field, input, textarea, select, button, table, brand } from '../components.ts';
import type { Invitation, PilotMetrics, Attempt } from '../../modules/hr/assessment.ts';
import { STATUS_LABEL, SEND_LABEL, OUTCOMES, MAX_BATCH, MIN_EXPIRY_DAYS, MAX_EXPIRY_DAYS } from '../../modules/hr/assessment.ts';
import { RUBRIC, RUBRIC_MAX, publicTemplate } from '../../modules/hr/assessment-templates.ts';
import type { Application, Requisition } from '../../modules/hr/recruiting.ts';
import { fmtDate, fmtDateTime } from '../../lib/time.ts';

type Tone = 'ink' | 'accent' | 'good' | 'warn' | 'crit' | 'violet';
const STATUS_TONE: Record<string, Tone> = { invited: 'accent', started: 'violet', submitted: 'good', expired: 'warn', replaced: 'ink' };
const SEND_TONE: Record<string, Tone> = { not_sent: 'ink', accepted: 'good', uncertain: 'warn', failed: 'crit' };
export const statusPill = (s: string): Raw => pill(STATUS_LABEL[s] || s, STATUS_TONE[s] || 'ink');
export const sendPill = (s: string): Raw => pill(SEND_LABEL[s] || s, SEND_TONE[s] || 'ink');
const outcomeLabel = (o: string): string => OUTCOMES.find((x) => x.value === o)?.label || '';
const score = (v: Invitation): string => (v.objective_score == null ? '—' : `${v.objective_score} / ${v.objective_total}`);
const reviewPill = (v: Invitation): Raw => v.status !== 'submitted' ? html`<span class="muted">—</span>` : v.reviewed_at ? pill(`Reviewed · ${v.review_total} / ${RUBRIC.length * RUBRIC_MAX}`, 'good') : pill('Writing to review', 'warn');
const levelOptions = [{ value: 'A2', label: 'A2 — basic workplace English' }, { value: 'B1', label: 'B1 — independent workplace English' }];
const dayOptions = (sel: number) => Array.from({ length: limit('hire.assessExpiryMaxDays') - MIN_EXPIRY_DAYS + 1 }, (_, i) => i + MIN_EXPIRY_DAYS).map((d) => ({ value: String(d), label: `${d} day${d > 1 ? 's' : ''}`, selected: d === sel }));

export interface QueueData { rows: Invitation[]; metrics: PilotMetrics; vacancies: Requisition[]; requisitionId: string; status: string; q: string; issue: { ok: boolean; mode: string }; demo: boolean }

export function assessmentQueuePage(v: View, d: QueueData): Raw {
  const m = d.metrics;
  const qs = (o: Record<string, string>) => { const p = new URLSearchParams({ req: d.requisitionId, status: d.status, q: d.q, ...o }); for (const [k, val] of [...p]) if (!val) p.delete(k); const s = p.toString(); return `/hire/assessments${s ? '?' + s : ''}`; };
  const tabs: [string, string][] = [['', 'All'], ['invited', 'Invited'], ['started', 'Started'], ['review', 'To review'], ['submitted', 'Submitted'], ['expired', 'Expired']];
  return page(v, {
    title: 'Assessments',
    subtitle: 'Workplace English, levels A2 and B1. An advisory input for HR — it never rejects or ranks anybody by itself.',
    actions: html`${button('Back to hiring', { href: '/hire' })}`,
    body: html`
      ${when(d.issue.mode === 'manual', () => notice('accent', 'Email is not set up yet, so nothing is sent to candidates. Use “Get link” on a row and send it to the candidate yourself. Their answers come back here as soon as they submit.'))}
      <div class="grid grid-4">
        ${statCard({ value: m.issued, label: 'Invitations', sub: `${m.started} in progress · ${m.expired} expired` })}
        ${statCard({ value: m.completionPct == null ? '—' : `${m.completionPct}%`, label: 'Completed', tone: 'accent', sub: `${m.submitted} submitted` })}
        ${statCard({ value: m.avgObjectivePct == null ? '—' : `${Math.round(m.avgObjectivePct)}%`, label: 'Average objective score', sub: m.avgMinutes == null ? '' : `${Math.round(m.avgMinutes)} min on average` })}
        ${statCard({ value: m.awaitingReview, label: 'Writing to review', tone: m.awaitingReview ? 'warn' : 'neutral', sub: m.avgWriting == null ? `${m.reviewed} reviewed` : `${m.reviewed} reviewed · avg ${m.avgWriting} / ${RUBRIC.length * RUBRIC_MAX}` })}
      </div>
      <section class="card">
        <div class="row between" style="margin-bottom:12px">
          <div class="filters">${tabs.map(([key, label]) => html`<a class="chip ${d.status === key ? 'on' : ''}" href="${qs({ status: key })}" style="display:inline-flex;align-items:center">${label}</a>`)}</div>
          <form method="get" action="/hire/assessments" class="row" style="gap:8px">
            <input type="hidden" name="status" value="${d.status}">
            <select class="input" name="req" style="width:auto;min-height:38px" onchange="this.form.submit()"><option value="">All vacancies</option>${d.vacancies.map((r) => html`<option value="${r.id}" ${r.id === d.requisitionId ? 'selected' : ''}>${r.title}</option>`)}</select>
            <input class="input" type="search" name="q" value="${d.q}" placeholder="Candidate name" style="width:180px;min-height:38px">
          </form>
        </div>
        ${d.rows.length ? table(['Candidate', 'Vacancy', 'Level', 'Status', 'Email', 'Expires', 'Objective', 'Writing', ''], d.rows.map((r) => [
          html`<a href="/hire/app/${r.application_id}"><b>${r.candidate_name}</b></a>`,
          html`<span class="small muted">${r.requisition_title}</span>`,
          html`${r.level}`,
          statusPill(r.status),
          html`${sendPill(r.send_state)}${when(r.reminder1_at || r.reminder2_at, () => html`<br><span class="xs muted">${r.reminder2_at ? '2 reminders' : '1 reminder'}</span>`)}`,
          html`<span class="small">${fmtDateTime(r.expires_at)}</span>`,
          html`<b>${score(r)}</b>`,
          reviewPill(r),
          html`<span class="row" style="gap:6px;justify-content:flex-end;flex-wrap:nowrap">
            ${when(r.status === 'submitted', () => button(r.reviewed_at ? 'Open' : 'Review', { href: `/hire/assessments/${r.id}`, size: 'sm', kind: r.reviewed_at ? '' : 'primary' }))}
            ${when(['invited', 'started'].includes(r.status), () => button('Get link', { modal: `/hire/assessments/${r.id}/link`, size: 'sm', kind: r.send_state === 'accepted' ? 'ghost' : 'primary' }))}
            ${when(['invited', 'started', 'expired'].includes(r.status) && d.issue.ok, () => button('Reissue', { modal: `/hire/app/${r.application_id}/assess`, size: 'sm', kind: 'ghost' }))}
          </span>`
        ])) : empty('No assessments here yet. Invite people from a vacancy or from a candidate’s application.')}
      </section>
      <section class="card">
        <h2>Pilot summary by level</h2>
        ${table(['Level', 'Issued', 'Submitted', 'Average objective score'], m.byLevel.map((l) => [html`<b>${l.level}</b>`, html`${l.issued}`, html`${l.submitted}`, html`${l.avgObjectivePct == null ? '—' : `${Math.round(l.avgObjectivePct)}%`}`]))}
        <p class="xs muted" style="margin-top:10px">These tests were written in-house. They are not a formal CEFR certificate and have not been validated as a hiring exam. Use the pilot to see whether the two levels sort people the way your interviewers would.</p>
      </section>`
  });
}

export function inviteOneModal(v: View, d: { a: Application; live: Invitation | undefined }): Raw {
  return modal({
    title: `English assessment · ${d.a.candidate_name}`,
    body: html`<form data-post="/hire/app/${d.a.id}/assess" class="stack">
      ${when(d.live, () => notice('warn', `There is already a live invitation (${d.live!.level}, ${STATUS_LABEL[d.live!.status]}). Issuing a new one cancels that link.`))}
      <div class="grid grid-2">${field('Level', select('level', levelOptions, {}))}${field('Link stays open for', select('expiryDays', dayOptions(7), {}))}</div>
      ${notice('accent', 'The candidate gets a private link. The 25 minutes start only when they press Begin. The result is an input for you; it does not move or close the application.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button(d.live ? 'Reissue' : 'Issue invitation', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function inviteBatchModal(v: View, d: { req: Requisition; applicants: (Application & { hasLive: boolean })[] }): Raw {
  return modal({
    title: `English assessment · ${d.req.title}`,
    body: html`<form data-post="/hire/req/${d.req.id}/assess" class="stack">
      ${field(`Applicants (choose up to ${limit('hire.assessBatchMax')})`, html`<div style="display:grid;gap:6px;max-height:260px;overflow:auto">${d.applicants.map((a) => html`<label class="row" style="gap:8px"><input type="checkbox" name="applicationIds[]" value="${a.id}"> <span class="small">${a.candidate_name} <span class="muted">· ${a.stage}${a.hasLive ? ' · already has a live invitation' : ''}</span></span></label>`)}</div>`)}
      <div class="grid grid-2">${field('Level for everyone in this batch', select('level', levelOptions, {}))}${field('Link stays open for', select('expiryDays', dayOptions(7), {}))}</div>
      ${notice('accent', 'One level and one expiry for the whole batch. Anyone who already has a live invitation gets a new link and the old one stops working.')}
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Issue invitations', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function assessmentReviewPage(v: View, d: { inv: Invitation; writing: string; review: Record<string, number>; words: number }): Raw {
  const i = d.inv; const t = publicTemplate(i.level);
  const scale = Array.from({ length: RUBRIC_MAX + 1 }, (_, n) => n);
  return page(v, {
    title: `${i.candidate_name} · ${i.level}`,
    subtitle: html`${i.requisition_title} · submitted ${i.submitted_at ? fmtDateTime(i.submitted_at) : '—'}`,
    actions: html`${statusPill(i.status)}${button('Queue', { href: '/hire/assessments' })}${button('Application', { href: `/hire/app/${i.application_id}` })}`,
    body: html`<div class="cols">
      <div class="col-main stack">
        <section class="card"><h2>Writing task</h2>
          <p class="small muted" style="margin:6px 0 12px">${t.writingPrompt} (${t.writingWords[0]}–${t.writingWords[1]} words)</p>
          <div style="white-space:pre-wrap;background:var(--soft);border:1px solid var(--line2);border-radius:12px;padding:16px;font-size:15px;line-height:1.6">${d.writing || 'The candidate wrote nothing.'}</div>
          <p class="xs muted" style="margin-top:8px">${d.words} words</p>
        </section>
        <section class="card"><h2>Your review</h2>
          <form data-post="/hire/assessments/${i.id}/review" class="stack" style="margin-top:8px">
            ${RUBRIC.map((r) => html`<div class="row between" style="gap:16px;border-top:1px solid var(--line2);padding-top:10px">
              <span style="flex:1;min-width:200px"><b class="small">${r.label}</b><br><span class="xs muted">${r.help}</span></span>
              <span class="row" style="gap:6px">${scale.map((n) => html`<label class="row" style="gap:4px"><input type="radio" name="s_${r.key}" value="${n}" ${d.review[r.key] === n ? 'checked' : ''} required> <span class="small">${n}</span></label>`)}</span>
            </div>`)}
            <p class="xs muted">0 = not shown · 1 = weak · 2 = adequate · 3 = good · 4 = strong</p>
            ${field('Outcome for this role', select('outcome', OUTCOMES.map((o) => ({ ...o, selected: i.outcome === o.value })), { blank: 'Choose' }))}
            ${field('Note', textarea('note', { rows: 3, value: i.review_note, placeholder: 'What you saw in the writing.' }))}
            ${notice('accent', 'This is advice to the hiring decision, not the decision. Saving it does not move or close the application.')}
            <div class="row right">${button(i.reviewed_at ? 'Update review' : 'Save review', { type: 'submit', kind: 'primary' })}</div>
          </form>
        </section>
      </div>
      <aside class="col-side stack">
        <section class="card"><h2>Objective score</h2>
          <p style="font-size:34px;font-weight:700;margin:6px 0">${score(i)}</p>
          <p class="small muted">Reading ${i.reading_score ?? '—'} / 5 · Language in context ${i.language_score ?? '—'} / 10. Scored by the system.</p>
        </section>
        <section class="card"><h2>Attempt</h2>
          ${table(['', ''], [
            ['Level', i.level], ['Issued', fmtDateTime(i.created_at)], ['Started', i.started_at ? fmtDateTime(i.started_at) : '—'], ['Submitted', i.submitted_at ? fmtDateTime(i.submitted_at) : '—'],
            ['Email', SEND_LABEL[i.send_state] || i.send_state], ['Reviewed', i.reviewed_at ? `${i.reviewed_by_name || ''} · ${fmtDate(i.reviewed_at)}` : 'Not yet']
          ].map(([a, b]) => [html`<span class="muted small">${a}</span>`, html`<span class="small">${b}</span>`]))}
          ${when(i.outcome, () => html`<p class="small" style="margin-top:10px"><b>${outcomeLabel(i.outcome)}</b></p>`)}
        </section>
      </aside>
    </div>`
  });
}

// ---------- The candidate's pages (public, reached only through the private link) ----------

const shell = (title: string, body: Raw): Raw => publicPage({ title, body: html`<div style="max-width:820px;margin:0 auto;padding:28px 16px 64px">
  <div style="margin-bottom:22px">${brand({ onDark: false, href: '#', style: 'padding:0;pointer-events:none' })}</div>${body}</div>` });

export function assessInvalidPage(): Raw {
  return shell('Assessment', html`<section class="card"><h1 style="font-size:24px">This link is not valid</h1><p class="muted" style="margin-top:8px">Please check that you opened the full link from your email. If it still does not work, reply to that email and HR will help you.</p></section>`);
}

export function assessClosedPage(a: Attempt): Raw {
  const done = a.status === 'submitted';
  return shell('Assessment', html`<section class="card"><h1 style="font-size:24px">${done ? 'Thank you — your assessment has been submitted' : 'This link is no longer active'}</h1>
    <p class="muted" style="margin-top:8px">${done ? 'HR at Loyal String will be in touch about the next step. You can close this page.' : a.status === 'replaced' ? 'A newer link was sent to you. Please use the most recent email from us.' : 'The time allowed for this link has passed. Please reply to the email you received and HR will help you.'}</p></section>`);
}

export function assessIntroPage(a: Attempt, token: string): Raw {
  const t = publicTemplate(a.level);
  return shell(t.title, html`<section class="card stack">
    <div><span class="pill pill-accent">${a.requisition_title}</span></div>
    <h1 style="font-size:26px">Hello ${a.candidate_name}</h1>
    <p>This is a short Workplace English assessment for your application to Loyal String.</p>
    <ul style="margin:0;padding-left:20px;line-height:1.8">
      <li>You have <b>${t.minutes} minutes</b>. The timer starts only when you press <b>Begin</b>.</li>
      <li>There are ${t.items.length} multiple-choice questions and one short piece of writing (${t.writingWords[0]}–${t.writingWords[1]} words).</li>
      <li>Your answers are saved as you go. If your connection drops, open the same link again and carry on; the timer keeps running.</li>
      <li>You can submit only once. When the time ends, what you have written is submitted for you.</li>
      <li>Please work alone, without a dictionary or a translator.</li>
    </ul>
    <p class="small muted">This link is open until ${fmtDateTime(a.expires_at)} (India time).</p>
    <form method="post" action="/assess/${token}/begin"><button class="btn btn-primary btn-lg" type="submit">Begin</button></form>
  </section>`);
}

export function assessTestPage(a: Attempt, token: string): Raw {
  const t = publicTemplate(a.level);
  const reading = t.items.filter((i) => i.section === 'reading'), language = t.items.filter((i) => i.section === 'language');
  const q = (i: { id: string; prompt: string; options: string[] }, n: number): Raw => html`<fieldset style="border:0;padding:14px 0 0;margin:0;border-top:1px solid var(--line2)">
    <legend style="font-weight:600;padding:0;float:left;width:100%;margin-bottom:8px">${n}. ${i.prompt}</legend>
    <div style="display:grid;gap:6px;clear:both">${i.options.map((o, idx) => html`<label class="row" style="gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:10px;cursor:pointer"><input type="radio" name="${i.id}" value="${idx}" ${a.answers[i.id] === idx ? 'checked' : ''}> <span>${o}</span></label>`)}</div>
  </fieldset>`;
  return shell(t.title, html`
    <div id="timer-bar" style="position:sticky;top:0;z-index:5;background:#0A0A0A;color:#fff;border-radius:14px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <span class="small">${t.title} · <span id="save-state">Saved</span></span><b id="timer" style="font-size:20px;font-variant-numeric:tabular-nums" aria-live="off">--:--</b>
    </div>
    <form id="assess-form" method="post" action="/assess/${token}/submit" class="stack">
      <section class="card stack"><h2>Part 1 · Reading</h2><p class="small muted">${t.passageTitle}, then answer the questions.</p>
        <div style="background:var(--soft);border:1px solid var(--line2);border-radius:12px;padding:16px;line-height:1.65">${t.passage.map((p) => html`<p style="margin:0 0 8px">${p}</p>`)}</div>
        ${reading.map((i, n) => q(i, n + 1))}
      </section>
      <section class="card stack"><h2>Part 2 · Language at work</h2><p class="small muted">Choose the best answer.</p>${language.map((i, n) => q(i, reading.length + n + 1))}</section>
      <section class="card stack"><h2>Part 3 · Writing</h2><p>${t.writingPrompt}</p><p class="small muted">Write ${t.writingWords[0]}–${t.writingWords[1]} words. <span id="word-count">0 words</span></p>
        <textarea class="input" name="writing" id="writing" rows="10" spellcheck="false" autocomplete="off" style="font-size:15px;line-height:1.6">${a.writing}</textarea>
      </section>
      <div class="row between"><span class="small muted">You can submit only once.</span><button class="btn btn-primary btn-lg" type="submit" id="submit-btn">Submit my assessment</button></div>
    </form>
    <script id="assess-config" type="application/json">${jsonScript({ token, secondsLeft: a.secondsLeft })}</script>
    ${raw(`<script>
(function () {
  var cfg = JSON.parse(document.getElementById('assess-config').textContent);
  var form = document.getElementById('assess-form'), timerEl = document.getElementById('timer'), stateEl = document.getElementById('save-state');
  var writing = document.getElementById('writing'), wc = document.getElementById('word-count');
  var end = Date.now() + cfg.secondsLeft * 1000, dirty = false, saving = false, submitted = false, saveTimer = null;
  function collect() {
    var answers = {};
    form.querySelectorAll('input[type=radio]:checked').forEach(function (r) { answers[r.name] = Number(r.value); });
    return { answers: answers, writing: writing.value };
  }
  function words() { var t = writing.value.trim(); wc.textContent = (t ? t.split(/\\s+/).length : 0) + ' words'; }
  function save() {
    if (saving || submitted || !dirty) return;
    saving = true; dirty = false; stateEl.textContent = 'Saving…';
    fetch('/assess/' + cfg.token + '/save', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(collect()) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (x) { saving = false; if (x.ok) { stateEl.textContent = 'Saved'; if (typeof x.j.secondsLeft === 'number') end = Date.now() + x.j.secondsLeft * 1000; } else { stateEl.textContent = 'Closed'; location.reload(); } })
      .catch(function () { saving = false; dirty = true; stateEl.textContent = 'Offline — will retry'; });
  }
  function touch() { dirty = true; stateEl.textContent = 'Not saved yet'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1200); }
  form.addEventListener('change', touch);
  writing.addEventListener('input', function () { words(); touch(); });
  setInterval(save, 15000);
  function tick() {
    var left = Math.max(0, Math.round((end - Date.now()) / 1000));
    timerEl.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    if (left <= 120) timerEl.style.color = '#F5C04A';
    if (left <= 0 && !submitted) { submitted = true; form.submit(); }
  }
  form.addEventListener('submit', function (e) {
    if (submitted) return;
    if (!confirm('Submit your assessment now? You cannot change your answers afterwards.')) { e.preventDefault(); return; }
    submitted = true;
  });
  words(); tick(); setInterval(tick, 1000);
})();
</script>`)}`);
}
