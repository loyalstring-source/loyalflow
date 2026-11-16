// Pages for the sourcing and screening features: screening questions, interview plan, CV upload and summary,
// bulk upload, hiring settings and the assessment link shared by hand.
import { number as limit } from '../../lib/lists.ts';
import { html, raw, when, jsonScript, type Raw } from '../../lib/html.ts';
import { page, modal, type View } from '../layout.ts';
import { pill, notice, field, input, textarea, select, button, table } from '../components.ts';
import type { Application, Requisition } from '../../modules/hr/recruiting.ts';
import type { Employee } from '../../modules/people/model.ts';
import type { ScreeningSet, ScreeningReview, PlanStep, PlanTrackStep } from '../../modules/hr/screening.ts';
import type { AiSettings } from '../../modules/hr/cv.ts';
import type { CvData } from '../../lib/gemini.ts';
import { MAX_BULK } from '../../modules/hr/cv.ts';
import { fmtDate, fmtDateTime } from '../../lib/time.ts';

const sourceLabel = (s: string): string => (s.startsWith('ai') ? 'Read by AI' : s.startsWith('rules') ? 'Read by simple rules' : s.startsWith('manual') ? 'Written by HR' : 'Not read') + (s.includes('+edited') ? ', edited by HR' : '');

// ---------- Screening ----------

export function screeningCard(d: { a: Application; set: ScreeningSet; review: ScreeningReview | undefined; newer: boolean; canEdit: boolean }): Raw {
  const r = d.review; const open = d.canEdit && d.a.status !== 'closed';
  return html`<section class="card">
    <div class="card-head"><h2>Screening</h2>${r ? html`<span class="row" style="gap:8px">${when(r.must_missed, () => pill(`${r!.must_missed} must-have${r!.must_missed > 1 ? 's' : ''} missed`, 'warn'))}<b style="font-size:20px">${r.total} <span class="muted small">/ ${r.max_total}</span></b></span>` : pill('Not scored yet', 'ink')}</div>
    ${when(r, () => html`<p class="xs muted">Scored by ${r!.reviewed_by_name || '—'} on ${fmtDateTime(r!.reviewed_at)} · question set v${d.set.version}${d.newer ? ' (a newer set exists; this score keeps the set it was made with)' : ''}</p>`)}
    <form data-post="/hire/app/${d.a.id}/screening" class="stack" style="margin-top:10px">
      ${d.set.questions.map((q, i) => { const ans = r?.answers[q.id]; return html`<div style="border-top:1px solid var(--line2);padding-top:12px">
        <div class="row between" style="gap:14px;align-items:flex-start">
          <span style="flex:1;min-width:0"><b class="small">${i + 1}. ${q.text}</b>${when(q.mustHave, () => html` ${pill('Must-have', 'violet')}`)}${when(q.guidance, () => html`<br><span class="xs muted">${q.guidance}</span>`)}</span>
          <span style="flex:none;width:92px">${open ? html`<select class="input" name="p_${q.id}" required style="min-height:38px" aria-label="Points for question ${i + 1}"><option value="">Points</option>${Array.from({ length: q.maxPoints + 1 }, (_, n) => html`<option value="${n}" ${ans && ans.points === n ? 'selected' : ''}>${n} / ${q.maxPoints}</option>`)}</select>` : html`<b>${ans ? ans.points : '—'} / ${q.maxPoints}</b>`}</span>
        </div>
        ${open ? html`<input class="input" name="n_${q.id}" value="${ans?.note || ''}" placeholder="What they said" style="margin-top:8px;min-height:38px" aria-label="Note for question ${i + 1}">` : when(ans?.note, () => html`<p class="small muted" style="margin:6px 0 0">${ans!.note}</p>`)}
      </div>`; })}
      ${when(open, () => html`<div class="row between"><span class="xs muted">Points help you compare people. They never reject anybody; a missed must-have is only flagged.</span>
        <span class="row" style="gap:8px">${when(d.newer, () => html`<label class="row xs" style="gap:6px"><input type="checkbox" name="useLatest" value="1"> Re-score on the newest questions</label>`)}${button(r ? 'Update score' : 'Save score', { type: 'submit', kind: 'primary', size: 'sm' })}</span></div>`)}
    </form>
  </section>`;
}

export function questionsPage(v: View, d: { set: ScreeningSet; req: Requisition | null; own: boolean; vacancies: Requisition[] }): Raw {
  const rows = [...d.set.questions, ...Array.from({ length: 3 }, () => ({ id: '', text: '', guidance: '', maxPoints: 3, mustHave: false }))];
  const action = d.req ? `/hire/req/${d.req.id}/questions` : '/hire/questions';
  const total = d.set.questions.reduce((n, q) => n + q.maxPoints, 0);
  return page(v, {
    title: d.req ? `Screening questions · ${d.req.title}` : 'Screening questions',
    subtitle: d.req ? (d.own ? `This vacancy has its own set (version ${d.set.version}).` : 'This vacancy uses the company default set. Saving here gives it its own set.') : `The company default set, version ${d.set.version}. Used by every vacancy that does not have its own.`,
    actions: html`${button(d.req ? 'Back to vacancy' : 'Back to hiring', { href: d.req ? `/hire/req/${d.req.id}` : '/hire' })}${when(d.req && d.own, () => button('Use company default', { post: `/hire/req/${d.req!.id}/questions/reset`, confirm: 'Go back to the company default questions for this vacancy? Scores already saved are kept.' }))}`,
    body: html`
      ${notice('accent', `${d.set.questions.length} questions, ${total} points in all. Saving makes a new version. People already screened keep the version they were scored on, so their points still mean the same thing.`)}
      <section class="card">
        <form data-post="${action}" class="stack">
          ${rows.map((q, i) => html`<div style="border-top:${i ? '1px solid var(--line2)' : '0'};padding-top:${i ? '14px' : '0'}">
            <input type="hidden" name="id_${i}" value="${q.id}">
            <div class="row" style="gap:10px;align-items:flex-start;flex-wrap:wrap">
              <span style="flex:1 1 380px;min-width:0">${field(q.id ? `Question ${i + 1}` : 'New question', textarea(`text_${i}`, { rows: 2, value: q.text, placeholder: q.id ? '' : 'Leave empty if you do not need another question' }))}</span>
              <span style="flex:0 0 110px">${field('Max points', input(`max_${i}`, { type: 'number', min: 1, max: 10, value: q.maxPoints }))}</span>
              <span style="flex:0 0 150px;padding-top:30px"><label class="row small" style="gap:8px"><input type="checkbox" name="must_${i}" value="1" ${q.mustHave ? 'checked' : ''}> Must-have</label>${when(q.id, () => html`<label class="row small" style="gap:8px;margin-top:6px"><input type="checkbox" name="del_${i}" value="1"> Remove</label>`)}</span>
            </div>
            ${field('What a good answer looks like', input(`guide_${i}`, { value: q.guidance, placeholder: 'Guidance for whoever is scoring' }))}
          </div>`)}
          <input type="hidden" name="count" value="${rows.length}">
          <div class="row between"><span class="xs muted">To add more than three questions, save and open this page again.</span>${button('Save as new version', { type: 'submit', kind: 'primary' })}</div>
        </form>
      </section>
      ${when(!d.req && d.vacancies.length, () => html`<section class="card"><h2>Questions for one vacancy</h2><p class="small muted">A vacancy can have its own set, for example with a skill question that only that role needs.</p>
        <div class="list" style="margin-top:6px">${d.vacancies.map((r) => html`<a class="list-row" href="/hire/req/${r.id}/questions"><span><b>${r.title}</b></span><span class="xs muted">Edit questions</span></a>`)}</div></section>`)}`
  });
}

// ---------- Interview plan ----------

export function planCard(d: { a: Application; steps: PlanTrackStep[]; next: PlanTrackStep | undefined; canEdit: boolean }): Raw {
  const tone = (s: PlanTrackStep) => s.state === 'done' ? (s.proceed === false ? 'crit' : 'good') : s.state === 'scheduled' ? 'accent' : s.state === 'next' ? 'violet' : 'ink';
  const label = (s: PlanTrackStep) => s.state === 'done' ? (s.interview!.status === 'no_show' ? 'No show' : s.proceed === false ? 'Done · not to proceed' : s.proceed === null ? 'Done · scorecard awaited' : 'Done · proceed') : s.state === 'scheduled' ? `Scheduled ${fmtDateTime(s.interview!.starts_at)}` : s.state === 'next' ? 'Next' : 'Later';
  return html`<section class="card">
    <div class="card-head"><h2>Interview plan</h2><a class="small" href="/hire/req/${d.a.requisition_id}/plan" data-modal="/hire/req/${d.a.requisition_id}/plan">${d.canEdit ? 'Change plan' : ''}</a></div>
    <div class="list" style="margin-top:6px">${d.steps.map((s) => html`<div class="list-row" style="align-items:center">
      <span><b class="small">${s.round}. ${s.name}</b><br><span class="xs muted">${s.interview ? (s.interview.panel || []).map((p) => p.name).join(', ') : s.interviewerName || 'Interviewer not set'}</span></span>
      <span class="row" style="gap:8px">${pill(label(s), tone(s))}${when(s.interview, () => html`<a class="btn btn-sm" href="/hire/interview/${s.interview!.id}">Open</a>`)}
        ${when(d.canEdit && d.next && d.next.round === s.round, () => button('Schedule', { modal: `/hire/app/${d.a.id}/schedule?round=${s.round}`, size: 'sm', kind: 'primary' }))}</span>
    </div>`)}</div>
    <p class="xs muted" style="margin-top:10px">The plan is a guide. You can skip a round, add one with “Schedule interview”, or record the decision at any point.</p>
  </section>`;
}

export function planModal(v: View, d: { req: Requisition; steps: PlanStep[]; own: boolean; people: Employee[] }): Raw {
  const rows = [...d.steps, ...Array.from({ length: 2 }, () => ({ name: '', interviewerId: '' }))];
  const people = (sel: string) => [{ value: '', label: 'Decide when scheduling' }, ...d.people.map((p) => ({ value: p.id, label: `${p.full_name} · ${p.designation}`, selected: p.id === sel }))];
  return modal({
    title: `Interview plan · ${d.req.title}`,
    body: html`<form data-post="/hire/req/${d.req.id}/plan" class="stack">
      ${when(!d.own, () => notice('accent', 'This is the usual order: HR, team manager, COO, CEO. Change it for this vacancy however you like.'))}
      ${rows.map((s, i) => html`<div class="row" style="gap:10px;align-items:flex-end">
        <span style="flex:0 0 64px">${field('Order', input(`order_${i}`, { type: 'number', min: 1, max: 20, value: i + 1 }))}</span>
        <span style="flex:1 1 180px;min-width:0">${field(i < d.steps.length ? 'Round' : 'New round', input(`name_${i}`, { value: s.name, placeholder: i < d.steps.length ? '' : 'Leave empty if not needed' }))}</span>
        <span style="flex:1 1 220px;min-width:0">${field('Interviewer', select(`who_${i}`, people(s.interviewerId), {}))}</span>
      </div>`)}
      <input type="hidden" name="count" value="${rows.length}">
      <p class="xs muted">Clear a round’s name to remove it. Change the order numbers to move rounds. Nothing here is enforced: it only decides what “Next” suggests on each application.</p>
      <div class="row right">${button('Cancel', { kind: 'ghost', cls: 'js-close-modal' })}${button('Save plan', { type: 'submit', kind: 'primary' })}</div>
    </form>`
  });
}

export function vacancyExtras(d: { req: Requisition; steps: PlanStep[]; planOwn: boolean; questions: number; points: number; questionsOwn: boolean; canEdit: boolean }): Raw {
  return html`<section class="card">
      <div class="card-head"><h2>Interview plan</h2>${when(d.canEdit, () => button('Change', { modal: `/hire/req/${d.req.id}/plan`, size: 'sm' }))}</div>
      <ol style="margin:8px 0 0;padding-left:20px;line-height:1.9">${d.steps.map((s) => html`<li><b class="small">${s.name}</b> <span class="xs muted">· ${s.interviewerName || 'interviewer not set'}</span></li>`)}</ol>
      ${when(!d.planOwn, () => html`<p class="xs muted" style="margin-top:6px">The usual order. Not changed for this vacancy.</p>`)}
    </section>
    <section class="card">
      <div class="card-head"><h2>Screening questions</h2>${when(d.canEdit, () => button('Edit', { href: `/hire/req/${d.req.id}/questions`, size: 'sm' }))}</div>
      <p class="small" style="margin-top:6px">${d.questions} questions · ${d.points} points</p>
      <p class="xs muted">${d.questionsOwn ? 'This vacancy has its own set.' : 'Using the company default set.'}</p>
    </section>`;
}

// ---------- CV ----------

const uploadScript = (cfg: unknown): Raw => html`<script id="cv-config" type="application/json">${jsonScript(cfg)}</script>${raw(`<script>
(function () {
  var cfg = JSON.parse(document.getElementById('cv-config').textContent);
  var inputEl = document.getElementById('cv-file'), stateEl = document.getElementById('cv-state');
  if (!inputEl) return;
  function b64(file) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = bad; r.readAsDataURL(file); }); }
  inputEl.addEventListener('change', function () {
    var f = inputEl.files && inputEl.files[0]; if (!f) return;
    if (f.size > cfg.max) { window.LF.toast({ title: 'That did not work', body: 'The file is larger than 5 MB.', kind: 'error' }); inputEl.value = ''; return; }
    stateEl.textContent = 'Reading ' + f.name + '… this can take up to a minute.'; inputEl.disabled = true;
    b64(f).then(function (data) { return window.LF.post(cfg.url, { name: f.name, data: data }); }).then(function (res) {
      inputEl.disabled = false; inputEl.value = '';
      if (res && res.ok) { window.LF.toast(res.toast || { title: 'CV saved', kind: 'success' }); setTimeout(function () { location.reload(); }, 700); }
      else { stateEl.textContent = ''; window.LF.toast({ title: 'That did not work', body: (res && res.error) || 'The file could not be uploaded.', kind: 'error' }); }
    });
  });
})();
</script>`)}`;

export function cvCard(d: { candidateId: string; cv: { name: string; summary: string; source: string; uploadedAt: string | null; data: CvData } | undefined; canEdit: boolean; ai: AiSettings }): Raw {
  const cv = d.cv;
  return html`<section class="card">
    <div class="card-head"><h2>CV and summary</h2>${when(cv?.name, () => html`<a class="btn btn-sm" href="/hire/candidates/${d.candidateId}/cv" target="_blank" rel="noopener">Open CV</a>`)}</div>
    ${cv ? html`
      <p class="xs muted" style="margin:6px 0 10px">${cv.name || 'No file'}${cv.uploadedAt ? ` · uploaded ${fmtDate(cv.uploadedAt)}` : ''} · ${sourceLabel(cv.source)}</p>
      ${d.canEdit ? html`<form data-post="/hire/candidates/${d.candidateId}/summary" class="stack">${textarea('summary', { rows: 7, value: cv.summary, placeholder: 'Summary of the CV' })}<div class="row right">${button('Save summary', { type: 'submit', size: 'sm' })}</div></form>`
        : html`<p class="small" style="white-space:pre-wrap">${cv.summary || 'No summary.'}</p>`}
      ${when(cv.data.currentRole || cv.data.currentEmployer, () => html`<p class="small" style="margin-top:10px"><span class="muted">Most recent:</span> ${[cv.data.currentRole, cv.data.currentEmployer].filter(Boolean).join(', ')}</p>`)}
      ${when(cv.data.skills.length, () => html`<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:10px">${cv.data.skills.map((s) => pill(s, 'ink'))}</div>`)}
      ${when(cv.data.education.length, () => html`<p class="xs muted" style="margin-top:10px">${cv.data.education.join(' · ')}</p>`)}
    ` : html`<p class="small muted" style="margin-top:6px">No CV uploaded yet.</p>`}
    ${when(d.canEdit, () => html`<div style="margin-top:12px;border-top:1px solid var(--line2);padding-top:12px">
      <label class="small" for="cv-file"><b>${cv?.name ? 'Replace the CV' : 'Upload a CV'}</b> <span class="muted">· PDF or Word (.docx), up to 5 MB</span></label>
      <input class="input" type="file" id="cv-file" accept=".pdf,.docx,.txt" style="margin-top:6px;padding:8px">
      <p class="xs muted" id="cv-state" style="margin-top:6px">${d.ai.enabled ? 'The file is sent to Google Gemini to be read.' : 'Read by simple rules inside the app. Add a Gemini key under Hiring → Settings for a proper summary.'}</p>
      ${uploadScript({ url: `/hire/candidates/${d.candidateId}/cv`, max: 5 * 1024 * 1024 })}</div>`)}
  </section>`;
}

export function bulkPage(v: View, d: { req: Requisition; batchId: string; ai: AiSettings }): Raw {
  return page(v, {
    title: `Upload CVs · ${d.req.title}`,
    subtitle: `Up to ${limit('hire.cvBulkMax')} files at a time. Nothing is created until you have checked the table and pressed Create.`,
    actions: html`${button('Back to vacancy', { href: `/hire/req/${d.req.id}` })}`,
    body: html`
      ${d.ai.enabled ? notice('accent', `Each file is sent to Google Gemini (${d.ai.model}) to be read. On the free plan this takes a few seconds a file.`) : notice('warn', html`AI reading is off, so files are read by simple rules: Word files and plain PDFs work, scans do not. <a href="/hire/settings">Add a Gemini key</a> for proper summaries.`)}
      <section class="card stack">
        <div><label for="bulk-files"><b>Choose CVs</b> <span class="muted small">· PDF or Word (.docx), up to 5 MB each</span></label>
          <input class="input" type="file" id="bulk-files" multiple accept=".pdf,.docx,.txt" style="margin-top:8px;padding:8px"></div>
        <p class="small muted" id="bulk-state" aria-live="polite"></p>
        <div id="bulk-table" style="overflow-x:auto"></div>
        <div class="row between" id="bulk-actions" style="display:none">
          <span class="row" style="gap:10px"><label class="small" for="bulk-source">Where they came from</label>
            <select class="input" id="bulk-source" style="width:auto;min-height:38px"><option value="direct">Direct</option><option value="referral">Referral</option><option value="job_board">Job board</option><option value="agency">Agency</option><option value="linkedin">LinkedIn</option><option value="campus">Campus</option><option value="walk_in">Walk-in</option></select></span>
          <button class="btn btn-primary" type="button" id="bulk-create">Create candidates</button>
        </div>
        <div id="bulk-result"></div>
      </section>
      <script id="bulk-config" type="application/json">${jsonScript({ reqId: d.req.id, batchId: d.batchId, max: limit('hire.cvBulkMax'), maxBytes: 5 * 1024 * 1024 })}</script>
      ${raw(`<script>
(function () {
  var cfg = JSON.parse(document.getElementById('bulk-config').textContent);
  var filesEl = document.getElementById('bulk-files'), stateEl = document.getElementById('bulk-state'), tableEl = document.getElementById('bulk-table');
  var actionsEl = document.getElementById('bulk-actions'), createBtn = document.getElementById('bulk-create'), resultEl = document.getElementById('bulk-result');
  var rows = [], busy = false;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function b64(file) { return new Promise(function (ok, bad) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = bad; r.readAsDataURL(file); }); }
  function cell(i, key, val, w) { return '<input class="input" data-i="' + i + '" data-k="' + key + '" value="' + esc(val) + '" style="min-height:36px;min-width:' + w + 'px" aria-label="' + key + '">'; }
  function render() {
    if (!rows.length) { tableEl.innerHTML = ''; actionsEl.style.display = 'none'; return; }
    var h = '<table><thead><tr><th>Add</th><th>File</th><th>Name</th><th>Email</th><th>Phone</th><th>Years</th><th>Current company</th><th>Summary</th></tr></thead><tbody>';
    rows.forEach(function (r, i) {
      if (r.error) { h += '<tr><td></td><td class="small">' + esc(r.file) + '</td><td colspan="6"><span class="pill pill-crit">Not uploaded</span> <span class="small muted">' + esc(r.error) + '</span></td></tr>'; return; }
      var d = r.data, warn = '';
      if (r.note) warn += '<div class="xs" style="color:var(--warn-ink,#7A5600);margin-top:4px">' + esc(r.note) + '</div>';
      if (r.duplicates && r.duplicates.length) warn += '<div class="xs" style="color:#A3221F;margin-top:4px">Looks like ' + esc(r.duplicates[0].full_name) + ', already a candidate. <label><input type="checkbox" data-i="' + i + '" data-k="allowDuplicate"' + (r.allowDuplicate ? ' checked' : '') + '> add anyway</label></div>';
      h += '<tr><td><input type="checkbox" data-i="' + i + '" data-k="include"' + (r.include ? ' checked' : '') + ' aria-label="Include ' + esc(r.file) + '"></td><td class="small">' + esc(r.file) + warn + '</td><td>' + cell(i, 'fullName', d.fullName, 150) + '</td><td>' + cell(i, 'email', d.email, 170) + '</td><td>' + cell(i, 'phone', d.phone, 120) + '</td><td>' + cell(i, 'experienceYears', d.experienceYears == null ? '' : d.experienceYears, 56) + '</td><td>' + cell(i, 'currentEmployer', d.currentEmployer, 140) + '</td><td><textarea class="input" data-i="' + i + '" data-k="summary" rows="3" style="min-width:260px" aria-label="summary">' + esc(d.summary) + '</textarea></td></tr>';
    });
    tableEl.innerHTML = h + '</tbody></table>';
    actionsEl.style.display = rows.some(function (r) { return !r.error; }) ? 'flex' : 'none';
  }
  tableEl.addEventListener('input', function (e) {
    var t = e.target, i = Number(t.getAttribute('data-i')), k = t.getAttribute('data-k'); if (!k || !rows[i]) return;
    if (k === 'include' || k === 'allowDuplicate') rows[i][k] = t.checked; else rows[i].data[k] = t.value;
  });
  tableEl.addEventListener('change', function (e) { var t = e.target, i = Number(t.getAttribute('data-i')), k = t.getAttribute('data-k'); if ((k === 'include' || k === 'allowDuplicate') && rows[i]) rows[i][k] = t.checked; });
  filesEl.addEventListener('change', function () {
    if (busy) return;
    var list = Array.prototype.slice.call(filesEl.files || []); if (!list.length) return;
    var room = cfg.max - rows.filter(function (r) { return !r.error; }).length;
    if (list.length > room) { window.LF.toast({ title: 'Too many files', body: 'A batch holds ' + cfg.max + ' CVs. Only the first ' + room + ' were taken.', kind: 'error' }); list = list.slice(0, Math.max(0, room)); }
    busy = true; filesEl.disabled = true; resultEl.innerHTML = '';
    var n = 0;
    (function next() {
      if (n >= list.length) { busy = false; filesEl.disabled = false; filesEl.value = ''; stateEl.textContent = 'Read ' + list.length + ' file' + (list.length > 1 ? 's' : '') + '. Check the table, correct anything, then press Create candidates.'; render(); return; }
      var f = list[n]; n++;
      stateEl.textContent = 'Reading ' + n + ' of ' + list.length + ': ' + f.name + '…';
      if (f.size > cfg.maxBytes) { rows.push({ file: f.name, error: 'Larger than 5 MB.' }); render(); return next(); }
      b64(f).then(function (data) { return window.LF.post('/hire/req/' + cfg.reqId + '/bulk/file', { batchId: cfg.batchId, name: f.name, data: data }); }).then(function (res) {
        if (res && res.ok && res.row) rows.push({ id: res.row.id, file: res.row.file_name, data: res.row.data, note: res.row.note, duplicates: res.row.duplicates, include: !(res.row.duplicates && res.row.duplicates.length), allowDuplicate: false });
        else rows.push({ file: f.name, error: (res && res.error) || 'Could not be uploaded.' });
        render(); next();
      });
    })();
  });
  createBtn.addEventListener('click', function () {
    if (busy) return;
    var payload = rows.filter(function (r) { return !r.error; }).map(function (r) { return { stagingId: r.id, include: !!r.include, allowDuplicate: !!r.allowDuplicate, fullName: r.data.fullName, email: r.data.email, phone: r.data.phone, experienceYears: r.data.experienceYears === '' || r.data.experienceYears == null ? null : Number(r.data.experienceYears), currentEmployer: r.data.currentEmployer, location: r.data.location, summary: r.data.summary }; });
    if (!payload.some(function (p) { return p.include; })) { window.LF.toast({ title: 'Nothing to create', body: 'Tick at least one row.', kind: 'error' }); return; }
    busy = true; createBtn.disabled = true; stateEl.textContent = 'Creating…';
    window.LF.post('/hire/req/' + cfg.reqId + '/bulk/commit', { batchId: cfg.batchId, source: document.getElementById('bulk-source').value, rows: payload }).then(function (res) {
      busy = false; createBtn.disabled = false;
      if (!res || !res.ok) { stateEl.textContent = ''; window.LF.toast({ title: 'That did not work', body: (res && res.error) || 'Nothing was created.', kind: 'error' }); return; }
      rows = []; render(); filesEl.disabled = true;
      var h = '<h2 style="margin-top:8px">' + res.created.length + ' created' + (res.skipped.length ? ', ' + res.skipped.length + ' not created' : '') + '</h2><div class="list">';
      res.created.forEach(function (c) { h += '<a class="list-row" href="/hire/app/' + esc(c.applicationId) + '"><span><b>' + esc(c.name) + '</b></span><span class="pill pill-good">Created</span></a>'; });
      res.skipped.forEach(function (s) { h += '<div class="list-row"><span><b>' + esc(s.name) + '</b><br><span class="xs muted">' + esc(s.reason) + '</span></span><span class="pill pill-warn">Not created</span></div>'; });
      resultEl.innerHTML = h + '</div><p style="margin-top:12px"><a class="btn" href="/hire/req/' + cfg.reqId + '">Back to the vacancy</a> <a class="btn" href="/hire/req/' + cfg.reqId + '/bulk">Upload more</a></p>';
      stateEl.textContent = '';
    });
  });
})();
</script>`)}`
  });
}

// ---------- Settings and the shared link ----------

export function hireSettingsPage(v: View, d: { ai: AiSettings }): Raw {
  return page(v, {
    title: 'Hiring settings',
    subtitle: 'Reading CVs with AI, and where the questions and plans live.',
    actions: html`${button('Back to hiring', { href: '/hire' })}`,
    body: html`<div class="cols"><div class="col-main stack">
      <section class="card">
        <div class="card-head"><h2>Read CVs with Google Gemini</h2>${d.ai.enabled ? pill('On', 'good') : d.ai.hasKey ? pill('Off', 'warn') : pill('No key', 'ink')}</div>
        <form data-post="/hire/settings/ai" class="stack" style="margin-top:8px">
          ${field('Gemini API key', input('apiKey', { type: 'password', placeholder: d.ai.hasKey ? `Saved (${d.ai.keyHint}). Paste a new key to replace it.` : 'Paste the key from Google AI Studio', autocomplete: 'off' }), 'Stored encrypted on this computer. It is never shown again and never sent anywhere except Google.')}
          ${field('Model', input('model', { value: d.ai.model }), 'The model name exactly as Google lists it. Change it only if Google retires this one or the test fails with “model not found”.')}
          <label class="row small" style="gap:8px"><input type="checkbox" name="enabled" value="1" ${d.ai.enabled || !d.ai.hasKey ? 'checked' : ''}> Use AI to read CVs</label>
          <div class="row right" style="gap:8px">${when(d.ai.hasKey, () => html`${button('Remove key', { post: '/hire/settings/ai', body: { clearKey: '1' }, kind: 'ghost', confirm: 'Remove the saved Gemini key? CVs will be read by simple rules.' })}${button('Test', { post: '/hire/settings/ai/test' })}`)}${button('Save', { type: 'submit', kind: 'primary' })}</div>
        </form>
      </section>
      <section class="card"><h2>What happens to a CV</h2>
        <ul style="margin:8px 0 0;padding-left:20px;line-height:1.8" class="small">
          <li>With AI on, the CV file (or the text of a Word file) is sent to Google to be read. It contains the candidate’s name, phone and email.</li>
          <li>On Google’s free plan, what you send may be used by Google to improve its products. The paid plan does not do this. Check Google’s current terms before using real CVs.</li>
          <li>With AI off, CVs are read inside this app by simple rules. Nothing leaves the computer; scans cannot be read.</li>
          <li>The CV file is kept on this computer and can be opened only by HR and the people working on that hire.</li>
        </ul>
      </section>
    </div>
    <aside class="col-side stack">
      <section class="card"><h2>Also here</h2><div class="list" style="margin-top:6px">
        <a class="list-row" href="/hire/questions"><span><b>Screening questions</b><br><span class="xs muted">The company default set</span></span></a>
        <a class="list-row" href="/hire/assessments"><span><b>Assessments</b><br><span class="xs muted">Workplace English, A2 and B1</span></span></a>
      </div></section>
    </aside></div>`
  });
}

export function shareLinkModal(v: View, d: { name: string; link: string; expires: string; level: string }): Raw {
  return modal({
    title: `Assessment link · ${d.name}`,
    body: html`<div class="stack">
      ${field(`Level ${d.level} · open until ${fmtDateTime(d.expires)}`, html`<input class="input" id="share-link" readonly value="${d.link}" onfocus="this.select()">`)}
      <div class="row right" style="gap:8px">${html`<button class="btn" type="button" data-copy="${d.link}">Copy link</button>`}<a class="btn" href="${d.link}" target="_blank" rel="noopener">Open as the candidate</a>${button('Close', { kind: 'ghost', cls: 'js-close-modal' })}</div>
      ${notice('warn', 'Send this link only to this candidate. Anyone who has it can take the test in their name, and it can be submitted only once. Your name and the time are recorded each time this link is shown.')}
      ${when(/localhost|127\.0\.0\.1/.test(d.link), () => notice('accent', 'This link points to this computer, so it opens only here. Once LoyalFlow is hosted at a web address, the link will open on the candidate’s own phone or computer.'))}
    </div>`
  });
}
