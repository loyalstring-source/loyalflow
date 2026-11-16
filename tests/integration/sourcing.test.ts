// Screening questions, interview plan, CV upload and summary, bulk upload.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, Client, type TestServer, HR, SUPPORT_LEAD, SUPPORT_IC, emp } from '../helpers.ts';
import { listRequisitions, listApplications, getApplication, saveCandidate, addApplication, getCandidate, scheduleInterview, setInterviewStatus, saveScorecard } from '../../src/modules/hr/recruiting.ts';
import { defaultSet, setFor, saveSet, saveScreening, reviewOf, screeningFor, planOf, savePlan, planTrack, DEFAULT_QUESTIONS } from '../../src/modules/hr/screening.ts';
import { rulesExtract, docxText, pdfText, looksLikeText, readCv, aiHook, aiSettings, saveAiSettings, cvOf, stagedBatch } from '../../src/modules/hr/cv.ts';
import { createGemini, cleanCvData } from '../../src/lib/gemini.ts';
import { zipStore } from '../zip.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { aiHook.extract = null; await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const openReq = () => listRequisitions(s.app, { status: ['open'] })[0];
let n = 0;
const fresh = () => { n++; const hr = emp(s.app, HR); const c = saveCandidate(s.app, hr, { fullName: `Source Person ${n}`, email: `source${n}@example.com` }); return addApplication(s.app, hr, { candidateId: c.id, requisitionId: openReq().id }); };

const CV_TEXT = `Rahul Deshmukh
rahul.deshmukh@example.com | +91 98765 43210 | Pune

Summary
Technical support engineer with 4 years of experience supporting ERP and billing software for retail stores.

Experience
Support Engineer, Example Retail Systems Pvt Ltd, Jan 2022 to Present
Handled GST billing and inventory tickets for 60 stores. Trained store staff on barcode and RFID stock counts.
Junior Support Executive, Sample Tech, 2020 to 2021

Education
B.Com, Savitribai Phule Pune University, 2019

Skills: Excel, SQL, Tally, customer support, ERP, inventory`;
const docx = (text: string): Buffer => zipStore({ '[Content_Types].xml': '<Types/>', 'word/document.xml': `<w:document><w:body>${text.split('\n').map((l) => `<w:p><w:r><w:t>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')}</w:body></w:document>` });
const pdf = (text: string): Buffer => {
  const content = `BT /F1 11 Tf 50 780 Td ${text.split('\n').map((l) => `(${l.replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ')} ET`;
  const z = deflateSync(Buffer.from(content, 'latin1'));
  return Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), z, Buffer.from('\nendstream\nendobj\n%%EOF', 'latin1')]);
};
const b64 = (b: Buffer) => b.toString('base64');

describe('screening questions', () => {
  test('the default set exists, and a score is point-wise, capped and never rejects', async () => {
    const hr = await login(HR);
    const set = defaultSet(s.app);
    assert.equal(set.questions.length, DEFAULT_QUESTIONS.length);
    const a = fresh();
    const page = await (await hr.get(`/hire/app/${a.id}`)).text();
    assert.match(page, /Screening/); assert.match(page, /Must-have/);

    const full: Record<string, unknown> = {}; for (const q of set.questions) { full[`p_${q.id}`] = q.maxPoints; full[`n_${q.id}`] = 'ok'; }
    assert.equal((await hr.postJson(`/hire/app/${a.id}/screening`, { ...full, p_q1: 99 })).status, 400, 'points above the maximum are refused');
    const partial = { ...full }; delete partial.p_q3;
    assert.equal((await hr.postJson(`/hire/app/${a.id}/screening`, partial)).status, 400, 'every question needs points');

    const low = { ...full, p_q1: 0, p_q4: 1 };
    const res = await hr.postJson(`/hire/app/${a.id}/screening`, low);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const rev = reviewOf(s.app, a.id)!;
    const max = set.questions.reduce((t, q) => t + q.maxPoints, 0);
    assert.equal(rev.max_total, max); assert.equal(rev.total, max - 5 - 2);
    assert.equal(rev.must_missed, 2, 'q1 scored 0 of 5 and q4 scored 1 of 3: both under half');
    assert.equal(rev.answers.q2.note, 'ok');
    const after = getApplication(s.app, a.id)!;
    assert.equal(after.status, 'active'); assert.equal(after.outcome, '', 'a low score and missed must-haves reject nobody');

    const lead = await login(SUPPORT_LEAD);
    assert.equal((await lead.postJson(`/hire/app/${a.id}/screening`, full)).status, 403);
  });

  test('editing questions makes a new version and old scores keep the version they were made with', async () => {
    const hr = await login(HR); const hrUser = emp(s.app, HR);
    const a = listApplications(s.app, { requisitionId: openReq().id, limit: 200 }).find((x) => reviewOf(s.app, x.id))!;
    const before = reviewOf(s.app, a.id)!;
    const v1 = defaultSet(s.app);

    const body: Record<string, unknown> = { count: v1.questions.length + 1 };
    v1.questions.forEach((q, i) => { body[`id_${i}`] = q.id; body[`text_${i}`] = i === 0 ? 'What do you do in a normal week? (reworded)' : q.text; body[`guide_${i}`] = q.guidance; body[`max_${i}`] = q.maxPoints; if (q.mustHave) body[`must_${i}`] = true; });
    body.del_8 = true;
    const k = v1.questions.length; body[`id_${k}`] = ''; body[`text_${k}`] = 'Can you start within two weeks?'; body[`max_${k}`] = 2;
    const res = await hr.postJson('/hire/questions', body);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const v2 = defaultSet(s.app);
    assert.equal(v2.version, v1.version + 1);
    assert.equal(v2.questions.length, v1.questions.length, 'one removed, one added');
    assert.ok(!v2.questions.some((q) => q.id === 'q9'));
    assert.ok(v2.questions.some((q) => q.text.startsWith('Can you start')));

    const kept = screeningFor(s.app, a.id);
    assert.equal(kept.review!.set_id, before.set_id, 'the old score still points at version 1');
    assert.equal(kept.set.version, v1.version); assert.equal(kept.newerSetAvailable, true);
    assert.equal(kept.review!.total, before.total);

    // A vacancy can have its own set, and go back to the default.
    const req = openReq();
    assert.equal(setFor(s.app, req.id).own, false);
    saveSet(s.app, hrUser, req.id, [{ text: 'Have you supported a billing product before?', maxPoints: 5, mustHave: true }]);
    assert.equal(setFor(s.app, req.id).own, true); assert.equal(setFor(s.app, req.id).questions.length, 1);
    const b = fresh();
    saveScreening(s.app, hrUser, b.id, { q1: { points: 4 } });
    assert.equal(reviewOf(s.app, b.id)!.max_total, 5);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/questions/reset`, {})).status, 200);
    assert.equal(setFor(s.app, req.id).own, false);
    assert.throws(() => saveSet(s.app, hrUser, null, [{ text: '', maxPoints: 3 }]), /at least one/);
    assert.throws(() => saveSet(s.app, hrUser, null, [{ text: 'x', maxPoints: 50 }]), /between 1 and 10/);
    assert.equal((await (await login(SUPPORT_IC)).get('/hire/questions')).status, 403);
  });
});

describe('interview plan', () => {
  test('the usual order is HR, team manager, COO, CEO, and a vacancy can change it freely', async () => {
    const hr = await login(HR); const req = openReq();
    const p = planOf(s.app, req.id);
    assert.equal(p.own, false);
    assert.deepEqual(p.steps.map((x) => x.name), ['HR round', 'Team manager round', 'COO round', 'CEO round']);
    assert.ok(p.steps[1].interviewerId, 'the hiring manager takes the team round');
    const lead = emp(s.app, SUPPORT_LEAD);
    const res = await hr.postJson(`/hire/req/${req.id}/plan`, { count: 4, name_0: 'COO round', who_0: p.steps[2].interviewerId, order_0: 3, name_1: 'HR round', who_1: p.steps[0].interviewerId, order_1: 1, name_2: 'Practical test', who_2: lead.id, order_2: 2, name_3: '', order_3: 4 });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const mine = planOf(s.app, req.id);
    assert.equal(mine.own, true);
    assert.deepEqual(mine.steps.map((x) => x.name), ['HR round', 'Practical test', 'COO round'], 'ordered by the numbers given; the empty round is dropped');
    assert.equal((await (await login(SUPPORT_LEAD)).postJson(`/hire/req/${req.id}/plan`, { count: 1, name_0: 'x' })).status, 403);
  });

  test('each finished round hands on to the next, and nothing is enforced', async () => {
    const hr = await login(HR); const hrUser = emp(s.app, HR); const lead = emp(s.app, SUPPORT_LEAD);
    const a = fresh();
    let t = planTrack(s.app, a.id);
    assert.equal(t.next!.round, 1); assert.equal(t.next!.name, 'HR round');
    const modal = await (await hr.get(`/hire/app/${a.id}/schedule?round=1`)).text();
    assert.match(modal, /value="HR round"/, 'the round name is filled in');
    assert.match(modal, new RegExp(`value="${t.next!.interviewerId}" checked`), 'the planned interviewer is ticked');

    const when = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
    const i1 = scheduleInterview(s.app, hrUser, { applicationId: a.id, roundName: 'HR round', roundType: 'hr', startsAt: when(2), minutes: 30, panel: [hrUser.id] });
    assert.equal(i1.round_name, 'HR round');
    t = planTrack(s.app, a.id);
    assert.equal(t.steps[0].state, 'scheduled'); assert.equal(t.next, undefined, 'nothing is offered while a round is still to happen');

    setInterviewStatus(s.app, hrUser, i1.id, 'completed');
    saveScorecard(s.app, hrUser, i1.id, { ratings: { skill: 4, problem: 4, communication: 4, ownership: 4, fit: 4 }, recommendation: 'yes', notes: '', evidence: 'Clear, relevant experience, good questions about the role and the team.', submit: true });
    t = planTrack(s.app, a.id);
    assert.equal(t.steps[0].state, 'done'); assert.equal(t.steps[0].proceed, true);
    assert.equal(t.next!.name, 'Practical test'); assert.equal(t.next!.interviewerId, lead.id, 'handed to the next level');

    // Not enforced: HR may record the decision now, skipping the remaining rounds.
    const dec = await hr.postJson(`/hire/app/${a.id}/decision`, { outcome: 'hire', rationale: 'Strong HR round; the role is urgent and the manager already knows this person.' });
    assert.equal(dec.status, 200, JSON.stringify(dec.json));
    assert.equal(getApplication(s.app, a.id)!.stage, 'offer');
  });

  test('a “no” on a round is shown, and still rejects nobody', () => {
    const hrUser = emp(s.app, HR); const a = fresh();
    const i1 = scheduleInterview(s.app, hrUser, { applicationId: a.id, roundName: 'HR round', roundType: 'hr', startsAt: new Date(Date.now() + 86_400_000).toISOString(), minutes: 30, panel: [hrUser.id] });
    setInterviewStatus(s.app, hrUser, i1.id, 'completed');
    saveScorecard(s.app, hrUser, i1.id, { ratings: { skill: 2, problem: 2, communication: 2, ownership: 2, fit: 2 }, recommendation: 'no', notes: '', evidence: 'Could not describe any ticket handled alone; vague on the product they supported.', submit: true });
    const t = planTrack(s.app, a.id);
    assert.equal(t.steps[0].proceed, false);
    assert.equal(getApplication(s.app, a.id)!.status, 'active');
  });
});

describe('reading a CV', () => {
  test('rules find the contact details, experience, skills and education, and say they are rules', () => {
    const d = rulesExtract(CV_TEXT);
    assert.equal(d.fullName, 'Rahul Deshmukh'); assert.equal(d.email, 'rahul.deshmukh@example.com'); assert.match(d.phone, /98765\s?43210/);
    assert.equal(d.experienceYears, 4);
    for (const k of ['excel', 'sql', 'tally', 'erp']) assert.ok(d.skills.includes(k), k);
    assert.match(d.education[0], /B\.Com/);
    assert.match(d.summary, /simple rules, not AI/);
  });
  test('Word and plain PDF files are read; a scan is recognised as unreadable', async () => {
    assert.match(docxText(docx(CV_TEXT)), /Rahul Deshmukh\nrahul\.deshmukh@example\.com/);
    const t = pdfText(pdf(CV_TEXT));
    assert.match(t, /Support Engineer, Example Retail Systems Pvt Ltd/); assert.ok(looksLikeText(t));
    const scan = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length 300 >>\nstream\n', 'latin1'), Buffer.alloc(300, 0x80), Buffer.from('\nendstream\n%%EOF', 'latin1')]);
    const r = await readCv(s.app, 'scan.pdf', scan);
    assert.equal(r.source, 'none'); assert.match(r.note, /scan/i); assert.equal(r.data.fullName, '');
    await assert.rejects(() => readCv(s.app, 'cv.doc', Buffer.alloc(500, 65)), /not a PDF, Word/);
    await assert.rejects(() => readCv(s.app, 'cv.pdf', Buffer.alloc(500, 65)), /not a real PDF/);
    await assert.rejects(() => readCv(s.app, 'cv.pdf', Buffer.alloc(6 * 1024 * 1024, 65)), /larger than 5 MB/);
  });
  test('the Gemini client sends the PDF and the key the documented way, and cleans what comes back', async () => {
    let seen: { url: string; headers: Record<string, string>; body: { contents: { parts: Record<string, unknown>[] }[]; generationConfig: Record<string, unknown> } } | undefined;
    const reply = { fullName: '  Asha Verma ', email: 'ASHA@Example.com', phone: '+91 90000 00000', experienceYears: 3.26, skills: Array.from({ length: 30 }, (_, i) => `skill${i}`), education: ['B.Com'], summary: 'x'.repeat(2000), extra: '<script>' };
    const g = createGemini({ apiKey: 'k'.repeat(39), model: 'gemini-test' }, (async (url: string, init: { headers: Record<string, string>; body: string }) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), text: async () => '' }; }) as never);
    const res = await g.extract({ file: { mime: 'application/pdf', base64: 'AAAA' } });
    assert.ok(res.ok);
    assert.equal(seen!.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.equal(seen!.headers['x-goog-api-key'], 'k'.repeat(39)); assert.ok(!seen!.url.includes('kkk'), 'the key is not in the address');
    assert.deepEqual(seen!.body.contents[0].parts[0], { inline_data: { mime_type: 'application/pdf', data: 'AAAA' } });
    assert.equal(seen!.body.generationConfig.response_mime_type, 'application/json');
    assert.equal(res.data!.fullName, 'Asha Verma'); assert.equal(res.data!.email, 'asha@example.com'); assert.equal(res.data!.experienceYears, 3.3);
    assert.equal(res.data!.skills.length, 12); assert.equal(res.data!.summary.length, 900); assert.ok(!('extra' in res.data!));
    assert.deepEqual(cleanCvData('nonsense').skills, []);
    const fail = (status: number, message = '') => createGemini({ apiKey: 'k'.repeat(39) }, (async () => ({ status, json: async () => ({ error: { message } }), text: async () => '' })) as never).extract({ text: 'x' });
    assert.equal((await fail(429)).retryable, true); assert.match((await fail(429)).error!, /free limit/);
    assert.match((await fail(404)).error!, /model/); assert.match((await fail(400, 'API key not valid')).error!, /key was not accepted/);
    assert.equal((await createGemini({ apiKey: '' }).extract({ text: 'x' })).ok, false);
  });
});

describe('uploading CVs', () => {
  test('the API key is stored sealed and never shown', async () => {
    const hr = await login(HR);
    assert.equal(aiSettings(s.app).hasKey, false);
    assert.equal((await hr.postJson('/hire/settings/ai', { apiKey: 'short' })).status, 400);
    const key = 'AIzaTESTKEY0123456789abcdefghijklmnopqr';
    assert.equal((await hr.postJson('/hire/settings/ai', { apiKey: key, model: 'gemini-test', enabled: true })).status, 200);
    const st = aiSettings(s.app);
    assert.deepEqual([st.hasKey, st.enabled, st.model, st.keyHint], [true, true, 'gemini-test', '••••opqr']);
    const stored = s.app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'hire.ai.gemini_key'")!.value;
    assert.ok(!stored.includes(key), 'sealed at rest');
    assert.ok(!(await (await hr.get('/hire/settings')).text()).includes(key), 'never sent back to the page');
    assert.equal((await (await login(SUPPORT_LEAD)).get('/hire/settings')).status, 403);
    assert.equal((await hr.postJson('/hire/settings/ai', { clearKey: '1' })).status, 200);
    assert.equal(aiSettings(s.app).hasKey, false);
  });

  test('one CV on a candidate: stored privately, summary filled, empty fields filled, nothing overwritten', async () => {
    const hr = await login(HR); const a = fresh(); const cid = a.candidate_id;
    s.app.db.run("UPDATE candidates SET phone = '9000000001' WHERE id = ?", [cid]);
    const res = await hr.postJson(`/hire/candidates/${cid}/cv`, { name: 'Rahul CV.docx', data: b64(docx(CV_TEXT)) });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const cv = cvOf(s.app, cid)!;
    assert.equal(cv.name, 'Rahul CV.docx'); assert.equal(cv.source, 'rules'); assert.match(cv.summary, /4 years/);
    const c = getCandidate(s.app, cid)!;
    assert.equal(c.phone, '9000000001', 'what HR typed is kept'); assert.equal(c.experience_years, 4, 'an empty field is filled');
    assert.equal(c.full_name, a.candidate_name, 'the name is never changed by a CV');
    assert.ok(existsSync(join(s.app.cfg.dataDir, 'cv', (c as unknown as { cv_path: string }).cv_path)));
    const dl = await hr.get(`/hire/candidates/${cid}/cv`);
    assert.equal(dl.status, 200); assert.match(dl.headers.get('content-disposition') || '', /Rahul CV\.docx/);
    assert.equal((await (await login(SUPPORT_IC)).get(`/hire/candidates/${cid}/cv`)).status, 403, 'not on this hire, no CV');
    assert.equal((await (await login(SUPPORT_IC)).postJson(`/hire/candidates/${cid}/cv`, { name: 'x.docx', data: b64(docx(CV_TEXT)) })).status, 403);
    assert.equal((await hr.postJson(`/hire/candidates/${cid}/summary`, { summary: 'Edited by HR after the call.' })).status, 200);
    assert.equal(cvOf(s.app, cid)!.summary, 'Edited by HR after the call.'); assert.match(cvOf(s.app, cid)!.source, /edited/);
    assert.match(await (await hr.get(`/hire/app/${a.id}`)).text(), /CV and summary/);
  });

  test('with AI on, the summary comes from AI; if AI fails, rules take over and say so', async () => {
    const hr = await login(HR); const a = fresh(); const calls: string[] = [];
    aiHook.extract = async (_app, input) => { calls.push(input.file ? `file:${input.file.mime}` : 'text'); return { ok: true, data: cleanCvData({ fullName: 'Rahul Deshmukh', email: 'rahul.deshmukh@example.com', currentEmployer: 'Example Retail Systems Pvt Ltd', currentRole: 'Support Engineer', experienceYears: 4, skills: ['ERP support', 'GST billing'], education: ['B.Com, SPPU, 2019'], summary: 'Support engineer with four years on retail ERP and billing products.' }) }; };
    assert.equal((await hr.postJson(`/hire/candidates/${a.candidate_id}/cv`, { name: 'cv.pdf', data: b64(pdf(CV_TEXT)) })).status, 200);
    assert.deepEqual(calls, ['file:application/pdf'], 'a PDF is sent as the file itself, so scans can be read');
    const cv = cvOf(s.app, a.candidate_id)!;
    assert.equal(cv.source, 'ai'); assert.match(cv.summary, /four years/); assert.deepEqual(cv.data.skills, ['ERP support', 'GST billing']);
    assert.equal(getCandidate(s.app, a.candidate_id)!.current_employer, 'Example Retail Systems Pvt Ltd');

    aiHook.extract = async () => ({ ok: false, error: 'Gemini answered 429. The free limit for this minute or day has been reached.' });
    const r = await readCv(s.app, 'cv.docx', docx(CV_TEXT));
    assert.equal(r.source, 'rules'); assert.match(r.note, /AI reading failed.*429/);
    aiHook.extract = null;
  });

  test('bulk: up to 20 files are read into a table, duplicates are flagged, and only ticked rows are created', async () => {
    const hr = await login(HR); const req = openReq();
    const page = await (await hr.get(`/hire/req/${req.id}/bulk`)).text();
    const batchId = page.match(/"batchId":"([a-z0-9]+)"/)![1];
    const person = (i: number) => CV_TEXT.replace('Rahul Deshmukh', `Bulk Person${String.fromCharCode(65 + i)}`).replace('rahul.deshmukh@example.com', `bulk${i}@example.com`).replace('98765 43210', `98765 4${String(1000 + i)}`);
    const rows: { id: number; data: { fullName: string; email: string; phone: string; experienceYears: number | null; summary: string }; duplicates: unknown[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await hr.postJson(`/hire/req/${req.id}/bulk/file`, { batchId, name: `cv${i}.${i % 2 ? 'pdf' : 'docx'}`, data: b64(i % 2 ? pdf(person(i)) : docx(person(i))) });
      assert.equal(r.status, 200, JSON.stringify(r.json)); rows.push(r.json.row as never);
    }
    assert.equal(rows[0].data.fullName, 'Bulk Persona'.replace('a', 'A')); assert.equal(rows[1].data.email, 'bulk1@example.com'); assert.equal(rows[2].duplicates.length, 0);
    // An existing candidate's CV in the same batch is flagged.
    const existing = getCandidate(s.app, fresh().candidate_id)!;
    const dupe = await hr.postJson(`/hire/req/${req.id}/bulk/file`, { batchId, name: 'dupe.docx', data: b64(docx(CV_TEXT.replace('rahul.deshmukh@example.com', existing.email).replace('Rahul Deshmukh', 'Someone Else'))) });
    assert.equal((dupe.json.row as { duplicates: { full_name: string }[] }).duplicates[0].full_name, existing.full_name);
    const bad = await hr.postJson(`/hire/req/${req.id}/bulk/file`, { batchId, name: 'photo.jpg', data: b64(Buffer.alloc(500, 1)) });
    assert.equal(bad.status, 400); assert.match(String(bad.json.error), /not a PDF, Word/);
    assert.equal(stagedBatch(s.app, batchId).length, 5);
    assert.equal(listApplications(s.app, { requisitionId: req.id, limit: 500 }).filter((x) => x.candidate_name?.startsWith('Bulk Person')).length, 0, 'nothing is created before HR confirms');

    const payload = [
      { stagingId: rows[0].id, include: true, ...rows[0].data, fullName: 'Bulk PersonA (corrected)' },
      { stagingId: rows[1].id, include: true, ...rows[1].data },
      { stagingId: rows[2].id, include: false, ...rows[2].data },
      { stagingId: rows[3].id, include: true, ...rows[3].data, fullName: '' },
      { stagingId: (dupe.json.row as { id: number }).id, include: true, fullName: 'Someone Else', email: existing.email }
    ];
    const done = await hr.postJson(`/hire/req/${req.id}/bulk/commit`, { batchId, source: 'job_board', rows: payload });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    const created = done.json.created as { name: string; applicationId: string }[]; const skipped = done.json.skipped as { name: string; reason: string }[];
    assert.deepEqual(created.map((c) => c.name), ['Bulk PersonA (corrected)', 'Bulk PersonB']);
    assert.equal(skipped.length, 3);
    assert.match(skipped.find((x) => x.name === 'Someone Else')!.reason, /already a candidate/);
    assert.match(skipped.find((x) => x.name === 'cv3.pdf')!.reason, /No name/);
    const app1 = getApplication(s.app, created[0].applicationId)!;
    assert.equal(app1.source, 'job_board'); assert.equal(app1.stage, 'applied');
    const cv = cvOf(s.app, app1.candidate_id)!;
    assert.equal(cv.name, 'cv0.docx'); assert.match(cv.summary, /4 years/);
    assert.equal(stagedBatch(s.app, batchId).length, 0, 'the staging area is emptied, left-out files included');

    // The limit of 20.
    const b2 = (await (await hr.get(`/hire/req/${req.id}/bulk`)).text()).match(/"batchId":"([a-z0-9]+)"/)![1];
    for (let i = 0; i < 20; i++) s.app.db.run("INSERT INTO cv_staging (batch_id, requisition_id, file_name, path, created_at) VALUES (?, ?, ?, 'x', ?)", [b2, req.id, `f${i}.pdf`, new Date().toISOString()]);
    const over = await hr.postJson(`/hire/req/${req.id}/bulk/file`, { batchId: b2, name: 'cv21.docx', data: b64(docx(person(9))) });
    assert.equal(over.status, 400); assert.match(String(over.json.error), /at most 20/);
    assert.equal((await (await login(SUPPORT_LEAD)).get(`/hire/req/${req.id}/bulk`)).status, 403);
  });
});
