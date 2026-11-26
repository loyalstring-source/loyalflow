// Hiring, second round: public Apply link, time limits and overdue, calendar, message templates, merging duplicates, reports.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, HR, SUPPORT_IC, SUPPORT_LEAD, emp } from '../helpers.ts';
import { listRequisitions, listApplications, getApplication, saveCandidate, addApplication, getCandidate, scheduleInterview, moveStage, getInterview } from '../../src/modules/hr/recruiting.ts';
import { applyLink, setApplyLink, resetApplyThrottle, stageLimits, aging, overdue, overdueReminders, calendar, fromLocal, localParts, mondayOf, listTemplates, fill, unknownFields, compose, duplicatePairs, mergeCandidates } from '../../src/modules/hr/hire-plus.ts';
import { cvOf } from '../../src/modules/hr/cv.ts';
import { zipStore } from '../zip.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const openReq = () => listRequisitions(s.app, { status: ['open'] })[0];
const hrEmp = () => emp(s.app, HR);
let n = 0;
const fresh = (over: Record<string, unknown> = {}) => { n++; const c = saveCandidate(s.app, hrEmp(), { fullName: `Plus Person ${n}`, email: `plus${n}@example.com`, ...over }); return addApplication(s.app, hrEmp(), { candidateId: c.id, requisitionId: openReq().id }); };
const docx = (text: string): string => zipStore({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` }).toString('base64');
const CV = docx('Meera Kulkarni\nmeera.k@example.com | 9822012345 | Pune\nSupport engineer with 3 years of experience in ERP support.\nSkills: Excel, SQL');
const form = (over: Record<string, unknown> = {}) => ({ fullName: 'Meera Kulkarni', email: 'meera.k@example.com', phone: '98220 12345', location: 'Pune', currentEmployer: 'Sample Tech', experienceYears: 3, expectedCtc: 420000, noticeDays: 30, heardFrom: 'LinkedIn', consent: true, website: '', cv: CV, cvName: 'meera.docx', ...over });

describe('public Apply link', () => {
  test('HR turns the link on; an outsider can open the page and nobody else can change it', async () => {
    const hr = await login(HR); const ic = await login(SUPPORT_IC); const req = openReq();
    assert.equal(applyLink(s.app, req.id).enabled, false);
    assert.equal((await ic.postJson(`/hire/req/${req.id}/apply-link`, { enabled: '1' })).status, 403);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/apply-link`, { enabled: '1' })).status, 200);
    const link = applyLink(s.app, req.id); assert.ok(link.enabled && link.token && link.token.length >= 20);
    const page = await (await hr.get(`/hire/req/${req.id}`)).text(); assert.ok(page.includes(`/apply/${link.token}`), 'the vacancy page shows the link');
    const anon = new Client(s.base); const res = await anon.get(`/apply/${link.token}`); assert.equal(res.status, 200);
    const html = await res.text(); assert.ok(html.includes(req.title) && html.includes('Send application'));
    assert.ok(!html.includes(String(req.budget_ctc || 'no-budget-here')) || !req.budget_ctc, 'the budget is never shown');
    assert.equal((await anon.get('/apply/not-a-real-token-at-all-123')).status, 404);
  });
  test('an application creates the candidate, the application and stores the CV', async () => {
    resetApplyThrottle(); const req = openReq(); const token = applyLink(s.app, req.id).token!; const anon = new Client(s.base);
    const before = listApplications(s.app, { requisitionId: req.id, limit: 500 }).length;
    const res = await anon.postJson(`/apply/${token}`, form()); assert.equal(res.status, 200); assert.equal(res.json.redirect, `/apply/${token}/thanks`);
    const apps = listApplications(s.app, { requisitionId: req.id, limit: 500 }); assert.equal(apps.length, before + 1);
    const a = apps.find((x) => x.candidate_email === 'meera.k@example.com')!; assert.equal(a.source, 'Apply link'); assert.equal(a.stage, 'applied');
    const c = getCandidate(s.app, a.candidate_id)!; assert.equal(c.phone, '98220 12345'); assert.equal(c.expected_ctc, 420000); assert.ok(c.consent_at);
    assert.ok(cvOf(s.app, c.id), 'the CV is on the record');
    assert.equal((await anon.get(`/apply/${token}/thanks`)).status, 200);
    // Applying twice keeps one application.
    const again = await anon.postJson(`/apply/${token}`, form({ email: 'Meera.K@example.com' })); assert.equal(again.status, 200);
    assert.equal(listApplications(s.app, { requisitionId: req.id, limit: 500 }).length, before + 1);
    assert.equal(applyLink(s.app, req.id).received, 1);
  });
  test('bad input, scripts and floods are refused', async () => {
    resetApplyThrottle(); const token = applyLink(s.app, openReq().id).token!; const anon = new Client(s.base);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x1@example.com', fullName: 'A' }))).status, 400);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'not-an-email' }))).status, 400);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x2@example.com', phone: '123' }))).status, 400);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x3@example.com', consent: false }))).status, 400);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x4@example.com', cv: '' }))).status, 400);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x5@example.com', website: 'http://spam.example' }))).status, 400, 'the hidden field catches scripts');
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'x6@example.com', cv: Buffer.from('MZ-not-a-document').toString('base64'), cvName: 'virus.exe' }))).status, 400);
    for (let i = 0; i < 5; i++) assert.equal((await anon.postJson(`/apply/${token}`, form({ email: `flood${i}@example.com`, fullName: `Flood Person ${i}` }))).status, 200);
    assert.equal((await anon.postJson(`/apply/${token}`, form({ email: 'flood9@example.com' }))).status, 429);
    resetApplyThrottle();
  });
  test('a new link stops the old one; turning it off closes the page', async () => {
    const hr = await login(HR); const req = openReq(); const old = applyLink(s.app, req.id).token!; const anon = new Client(s.base);
    await hr.postJson(`/hire/req/${req.id}/apply-link`, { renew: '1' }); const fresh2 = applyLink(s.app, req.id).token!; assert.notEqual(fresh2, old);
    assert.equal((await anon.get(`/apply/${old}`)).status, 404); assert.equal((await anon.get(`/apply/${fresh2}`)).status, 200);
    await hr.postJson(`/hire/req/${req.id}/apply-link`, { enabled: '0' });
    const closed = await anon.get(`/apply/${fresh2}`); assert.ok((await closed.text()).includes('not open right now'));
    assert.equal((await anon.postJson(`/apply/${fresh2}`, form({ email: 'late@example.com' }))).status, 410);
    setApplyLink(s.app, hrEmp(), req.id, { enabled: true });
  });
});

describe('time limits and overdue', () => {
  test('a candidate past the limit is listed, reminded once, and limits can be changed', async () => {
    const hr = await login(HR); const a = fresh();
    assert.equal(stageLimits(s.app).applied, 2);
    s.app.db.run('UPDATE applications SET stage_since = ? WHERE id = ?', [new Date(Date.now() - 6 * 86_400_000).toISOString(), a.id]);
    const row = overdue(s.app).find((x) => x.id === a.id)!; assert.equal(row.days, 6); assert.equal(row.over, 4);
    const page = await (await hr.get('/hire/overdue')).text(); assert.ok(page.includes(a.candidate_name!) && page.includes('4 days over'));
    const first = overdueReminders(s.app); assert.ok(first >= 1); assert.equal(overdueReminders(s.app), 0, 'nobody is reminded twice for the same stage');
    assert.equal((await hr.postJson('/hire/limits', { applied: 10 })).status, 200);
    assert.ok(!overdue(s.app).some((x) => x.id === a.id));
    assert.equal((await hr.postJson('/hire/limits', { applied: 0 })).status, 200); assert.equal(aging(s.app).find((x) => x.id === a.id)!.over, 0, '0 means no limit');
    assert.equal((await hr.postJson('/hire/limits', { applied: 500 })).status, 400);
    await hr.postJson('/hire/limits', { applied: 2 });
    const ic = await login(SUPPORT_IC); assert.equal((await ic.postJson('/hire/limits', { applied: 9 })).status, 403); assert.equal((await ic.get('/hire/overdue')).status, 403);
  });
});

describe('interview calendar', () => {
  test('office time is kept whatever clock the server runs on', () => {
    assert.equal(fromLocal('2026-12-01', '10:30'), '2026-12-01T05:00:00.000Z'); assert.equal(localParts('2026-12-01T05:00:00.000Z').hhmm, '10:30'); assert.equal(mondayOf('2026-12-03'), '2026-11-30');
    const a = fresh(); moveStage(s.app, hrEmp(), a.id, 'screening'); const i = scheduleInterview(s.app, hrEmp(), { applicationId: a.id, roundType: 'hr', startsAt: '2031-03-04T10:30', minutes: 45, panel: [emp(s.app, SUPPORT_LEAD).id] });
    assert.equal(i.starts_at, '2031-03-04T05:00:00.000Z', 'a time typed in a form is India time');
  });
  test('HR books from the calendar, sees it on the right day, and moves it by a new time with a reason', async () => {
    const hr = await login(HR); const a = fresh(); moveStage(s.app, hrEmp(), a.id, 'screening'); const lead = emp(s.app, SUPPORT_LEAD);
    const modalHtml = await (await hr.get(`/hire/calendar/new?at=2031-05-06T11:00&app=${a.id}`)).text(); assert.ok(modalHtml.includes('2031-05-06T11:00') && modalHtml.includes(a.candidate_name!));
    assert.equal((await hr.postJson('/hire/calendar/new', { applicationId: '', startsAt: '2031-05-06T11:00', panel: [lead.id] })).status, 400);
    assert.equal((await hr.postJson('/hire/calendar/new', { applicationId: a.id, roundName: 'HR round', roundType: 'hr', mode: 'video', startsAt: '2031-05-06T11:00', minutes: 30, panel: [lead.id] })).status, 200);
    const cal = calendar(s.app, hrEmp(), { view: 'week', date: '2031-05-06' }); assert.equal(cal.start, '2031-05-05');
    const day = cal.days.find((d) => d.date === '2031-05-06')!; const iv = day.interviews.find((x) => x.application_id === a.id)!; assert.ok(iv); assert.equal(localParts(iv.starts_at).hhmm, '11:00');
    const page = await (await hr.get('/hire/calendar?view=week&date=2031-05-06')).text(); assert.ok(page.includes(`data-ev="${iv.id}"`) && page.includes(a.candidate_name!));
    assert.ok((await (await hr.get('/hire/calendar?view=month&date=2031-05-06')).text()).includes(`data-ev="${iv.id}"`));
    assert.ok((await (await hr.get(`/hire/calendar/interview/${iv.id}`)).text()).includes('Tell the candidate'));
    assert.ok((await (await hr.get(`/hire/interview/${iv.id}/reschedule?at=2031-05-08T15:15`)).text()).includes('2031-05-08T15:15'), 'a drop on the calendar pre-fills the new time');
    assert.equal((await hr.postJson(`/hire/interview/${iv.id}/reschedule`, { startsAt: '2031-05-08T15:15', minutes: 30, reason: 'no' })).status, 400, 'a reason is needed');
    assert.equal((await hr.postJson(`/hire/interview/${iv.id}/reschedule`, { startsAt: '2031-05-08T15:15', minutes: 30, reason: 'Panel asked to move it' })).status, 200);
    assert.equal(localParts(getInterview(s.app, iv.id)!.starts_at).date, '2031-05-08');
    // Filters, and what an interviewer sees.
    assert.equal(calendar(s.app, hrEmp(), { view: 'week', date: '2031-05-08', interviewerId: emp(s.app, SUPPORT_IC).id }).interviews.length, 0);
    const leadC = await login(SUPPORT_LEAD); const mine = await (await leadC.get('/hire/calendar?view=week&date=2031-05-08')).text(); assert.ok(mine.includes(a.candidate_name!) && !mine.includes('Book an interview'));
    assert.equal((await leadC.get('/hire/calendar/new')).status, 403);
    const ic = await login(SUPPORT_IC); assert.equal((await ic.get('/hire/calendar')).status, 403); assert.equal((await ic.get(`/hire/calendar/interview/${iv.id}`)).status, 403);
  });
});

describe('message templates', () => {
  test('fields are filled for the candidate; unknown fields are refused; blanks stay visible', async () => {
    const hr = await login(HR); const a = fresh();
    assert.ok(listTemplates(s.app).length >= 6);
    assert.deepEqual(unknownFields('Hi {{first_name}} {{favourite_colour}}'), ['favourite_colour']);
    assert.deepEqual(fill('Hi {{first_name}}, see you {{interview_date}}', { first_name: 'Asha', interview_date: '' }), { text: 'Hi Asha, see you [Interview date]', missing: ['interview_date'] });
    const c = compose(s.app, hrEmp(), a.id, 'application_received'); assert.ok(c.body.includes('Plus') && c.subject.includes(openReq().title) && !c.missing.length);
    assert.ok(compose(s.app, hrEmp(), a.id, 'interview_invite').missing.includes('interview_date'), 'no interview is booked yet');
    assert.equal((await hr.postJson('/hire/templates', { name: 'Bad one', subject: 'Hello {{nobody}}', body: 'Dear {{first_name}}, this has an unknown field.' })).status, 400);
    const made = await hr.postJson('/hire/templates', { name: 'Second round', subject: 'Second round for {{role}}', body: 'Dear {{first_name}},\n\nPlease come for a second round on {{interview_date}} at {{interview_time}}.\n\n{{sender_name}}' });
    assert.equal(made.status, 200); const key = /t=([\w-]+)/.exec(made.json.redirect)![1];
    assert.ok((await (await hr.get(`/hire/templates?t=${key}`)).text()).includes('Second round'));
    assert.equal((await hr.postJson('/hire/templates/application_received/delete', {})).status, 400, 'standard templates stay');
    assert.equal((await hr.postJson(`/hire/templates/${key}/delete`, {})).status, 200);
    const ic = await login(SUPPORT_IC); assert.equal((await ic.get('/hire/templates')).status, 403);
  });
  test('HR sends a message: it is recorded, and one with unfilled fields is stopped', async () => {
    const hr = await login(HR); const a = fresh(); moveStage(s.app, hrEmp(), a.id, 'screening');
    const modalHtml = await (await hr.get(`/hire/app/${a.id}/message`)).text(); assert.ok(modalHtml.includes('Mark as sent') && modalHtml.includes(a.candidate_email!));
    const draft = await (await hr.get(`/hire/app/${a.id}/compose?t=interview_invite`)).json() as { ok: boolean; subject: string; body: string; missing: string[] }; assert.ok(draft.ok && draft.missing.length);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/message`, { templateKey: 'interview_invite', subject: draft.subject, body: draft.body })).status, 400, 'blanks cannot be sent');
    const iv = scheduleInterview(s.app, hrEmp(), { applicationId: a.id, roundType: 'hr', roundName: 'HR round', startsAt: '2031-07-01T11:00', minutes: 45, panel: [emp(s.app, SUPPORT_LEAD).id] });
    const ready = await (await hr.get(`/hire/app/${a.id}/compose?t=interview_invite&interview=${iv.id}`)).json() as { subject: string; body: string; missing: string[] };
    assert.deepEqual(ready.missing.filter((m) => m !== 'interview_place'), []); assert.ok(ready.body.includes('11:00 AM') && ready.subject.includes('1 July 2031'));
    const sent = await hr.postJson(`/hire/app/${a.id}/message`, { templateKey: 'interview_invite', subject: ready.subject, body: ready.body.replace('[Address or meeting link]', 'Pune office'), interviewId: iv.id });
    assert.equal(sent.status, 200);
    const row = s.app.db.get<{ kind: string; state: string; body: string }>('SELECT kind, state, body FROM hire_messages WHERE application_id = ? ORDER BY id DESC LIMIT 1', [a.id])!;
    assert.equal(row.kind, 'interview_invite'); assert.equal(row.state, 'manual'); assert.ok(row.body.includes('Pune office'));
    assert.equal(getInterview(s.app, iv.id)!.candidate_informed, 1);
    assert.ok((await (await hr.get(`/hire/app/${a.id}`)).text()).includes('Sent by HR from own mail'));
    const lead = await login(SUPPORT_LEAD); assert.equal((await lead.postJson(`/hire/app/${a.id}/message`, { subject: 'Hello there', body: 'A message from the panel.' })).status, 403);
  });
});

describe('duplicate candidates', () => {
  test('same phone is found, compared and merged; applications move and the history is kept', async () => {
    const hr = await login(HR); const reqs = listRequisitions(s.app, { status: ['open'] });
    const c1 = saveCandidate(s.app, hrEmp(), { fullName: 'Rohan Patil', email: 'rohan.patil@example.com', phone: '9890011223', currentEmployer: 'Alpha Systems' });
    const c2 = saveCandidate(s.app, hrEmp(), { fullName: 'Rohan S Patil', email: 'rohanp@example.org', phone: '+91 98900 11223', expectedCtc: 500000 });
    const a1 = addApplication(s.app, hrEmp(), { candidateId: c1.id, requisitionId: reqs[0].id }); const a2 = addApplication(s.app, hrEmp(), { candidateId: c2.id, requisitionId: reqs[0].id });
    moveStage(s.app, hrEmp(), a2.id, 'screening');
    const pair = duplicatePairs(s.app).find((p) => [p.a.id, p.b.id].includes(c1.id) && [p.a.id, p.b.id].includes(c2.id))!; assert.ok(pair && pair.strong && pair.why.includes('Same phone'));
    assert.ok((await (await hr.get('/hire/duplicates')).text()).includes('Rohan S Patil'));
    const review = await (await hr.get(`/hire/duplicates/review?a=${c1.id}&b=${c2.id}`)).text(); assert.ok(review.includes('Alpha Systems') && review.includes('₹5,00,000') && review.includes('Merge these two records'));
    const res = await hr.postJson('/hire/duplicates/merge', { a: c1.id, b: c2.id, keep: c1.id, f_full_name: 'b', f_email: 'a', f_phone: 'a' }); assert.equal(res.status, 200);
    const kept = getCandidate(s.app, c1.id)!; assert.equal(kept.full_name, 'Rohan S Patil'); assert.equal(kept.email, 'rohan.patil@example.com'); assert.equal(kept.expected_ctc, 500000, 'a blank is filled from the other record'); assert.equal(kept.current_employer, 'Alpha Systems');
    // Both applied to the same vacancy: the one further along carries on under the kept record.
    assert.equal(getApplication(s.app, a2.id)!.candidate_id, c1.id); assert.equal(getApplication(s.app, a2.id)!.status, 'active');
    const lost = getApplication(s.app, a1.id)!; assert.equal(lost.status, 'closed'); assert.equal(lost.outcome, 'duplicate');
    assert.equal(s.app.db.get<{ merged_into: string }>('SELECT merged_into FROM candidates WHERE id = ?', [c2.id])!.merged_into, c1.id);
    assert.ok(!(await (await hr.get('/hire/candidates?q=rohan')).text()).includes(c2.id), 'the merged record is hidden from the list');
    assert.ok(!duplicatePairs(s.app).some((p) => [p.a.id, p.b.id].includes(c2.id)));
    assert.equal((await hr.postJson('/hire/duplicates/merge', { a: c1.id, b: c2.id, keep: c1.id })).status, 400, 'a merged record cannot be merged again');
    assert.throws(() => mergeCandidates(s.app, emp(s.app, SUPPORT_IC), c1.id, c2.id), /HR/);
  });
  test('“not the same person” takes a pair off the list for good', async () => {
    const hr = await login(HR);
    const c1 = saveCandidate(s.app, hrEmp(), { fullName: 'Sneha Joshi', email: 'sneha.j1@example.com' }); const c2 = saveCandidate(s.app, hrEmp(), { fullName: 'Sneha Joshi', email: 'sneha.j2@example.com' });
    const has = () => duplicatePairs(s.app).some((p) => [p.a.id, p.b.id].includes(c1.id) && [p.a.id, p.b.id].includes(c2.id)); assert.ok(has());
    const ic = await login(SUPPORT_IC); assert.equal((await ic.postJson('/hire/duplicates/dismiss', { a: c1.id, b: c2.id })).status, 403); assert.equal((await ic.get('/hire/duplicates')).status, 403);
    assert.equal((await hr.postJson('/hire/duplicates/dismiss', { a: c1.id, b: c2.id })).status, 200); assert.ok(!has());
  });
});

describe('hiring reports', () => {
  test('every new report opens and downloads for HR and is closed to others', async () => {
    const hr = await login(HR); const ic = await login(SUPPORT_IC);
    for (const key of ['hire-source-stage', 'hire-aging', 'hire-stage-time', 'hire-vacancies', 'hire-interviewers', 'hire-recruiters', 'hire-closed', 'hire-weekly', 'hire-messages']) {
      const page = await hr.get(`/reports/${key}?range=this_year`); assert.equal(page.status, 200, key); await page.text();
      const x = await hr.get(`/reports/${key}.xlsx?range=this_year`); assert.equal(x.status, 200, `${key} export`); assert.ok((await x.arrayBuffer()).byteLength > 500);
      assert.notEqual((await ic.get(`/reports/${key}?range=this_year`)).status, 200, `${key} is HR only`);
    }
    const src = await (await hr.get('/reports/hire-source-stage?range=this_year')).text(); assert.ok(src.includes('Apply link'));
  });
  test('the hiring home shows the new tools and alerts', async () => {
    const hr = await login(HR); const home = await (await hr.get('/hire')).text();
    for (const href of ['/hire/calendar', '/hire/overdue', '/hire/templates', '/hire/duplicates']) assert.ok(home.includes(`href="${href}"`), href);
  });
});
