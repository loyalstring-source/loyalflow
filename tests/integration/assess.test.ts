// Workplace English assessment: the acceptance checks from the LoyalHire specification (AT-08 to AT-15), over HTTP where it matters.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, HR, SUPPORT_LEAD, SUPPORT_IC } from '../helpers.ts';
import { listRequisitions, listApplications, getApplication, saveCandidate, addApplication } from '../../src/modules/hr/recruiting.ts';
import { listInvitations, getInvitation, invitationsOf, demoLink, runAssessmentJobs, messagesOf, inviteOne, attemptByToken, beginAttempt, saveAttempt, submitAttempt, canIssue } from '../../src/modules/hr/assessment.ts';
import { TEMPLATES, publicTemplate, scoreObjective } from '../../src/modules/hr/assessment-templates.ts';
import { createGraphMailer, type GraphMailer, type GraphResult } from '../../src/lib/graph-mail.ts';
import { emp } from '../helpers.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const openReq = () => listRequisitions(s.app, { status: ['open'] })[0];
const tokenOf = (id: string): string => demoLink(s.app, emp(s.app, HR), id).split('/assess/')[1];
const activeApps = () => listApplications(s.app, { requisitionId: openReq().id, status: 'active' });
let n = 0;
const fresh = () => { n++; const hrUser = emp(s.app, HR); const c = saveCandidate(s.app, hrUser, { fullName: `Assess Person ${n}`, email: `assess${n}@example.com` }); return addApplication(s.app, hrUser, { candidateId: c.id, requisitionId: openReq().id }); };
const post = (path: string, body: unknown) => fetch(s.base + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
const fakeGraph = (results: GraphResult['state'][], sent: { to: string; subject: string; html: string }[] = []): GraphMailer => ({
  configured: true, sender: 'hiring@loyalstring.com',
  async send(m) { sent.push(m); const state = results.length > 1 ? results.shift()! : results[0]; return { state, detail: state, ref: 'req-1' }; }
});

describe('the templates', () => {
  test('both levels have 15 objective items, a writing task and a key that fits the options', () => {
    for (const level of ['A2', 'B1']) {
      const t = TEMPLATES[level];
      assert.equal(t.items.length, 15); assert.equal(t.minutes, 25);
      for (const i of t.items) { assert.equal(i.options.length, 4, i.id); assert.ok(i.answer >= 0 && i.answer < 4, i.id); assert.equal(new Set(i.options).size, 4, `${level} ${i.id} has a repeated option`); }
      assert.equal(new Set(t.items.map((i) => i.id)).size, 15);
      const all = Object.fromEntries(t.items.map((i) => [i.id, i.answer]));
      assert.deepEqual(scoreObjective(level, all), { score: 15, total: 15, reading: 5, readingTotal: 5, language: 10, languageTotal: 10 });
      assert.equal(scoreObjective(level, {}).score, 0);
    }
  });
  test('what the candidate is sent has no answer key in it', () => {
    const pub = JSON.stringify(publicTemplate('B1'));
    assert.ok(!pub.includes('"answer"'));
  });
});

describe('issuing', () => {
  test('a batch is limited to 20 active applicants of one open vacancy, one level, 1 to 14 days', async () => {
    const hr = await login(HR);
    const req = openReq(); const apps = activeApps();
    assert.ok(apps.length >= 2, 'demo data has applicants');
    const ids = apps.slice(0, 2).map((a) => a.id);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: ids, level: 'C1', expiryDays: 7 })).status, 400);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: ids, level: 'A2', expiryDays: 0 })).status, 400);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: ids, level: 'A2', expiryDays: 15 })).status, 400);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: [], level: 'A2', expiryDays: 7 })).status, 400);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: Array.from({ length: 21 }, (_, i) => `APP-X${i}`), level: 'A2', expiryDays: 7 })).status, 400);
    const other = listApplications(s.app, { limit: 300 }).find((a) => a.requisition_id !== req.id);
    if (other) assert.equal((await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: [other.id], level: 'A2', expiryDays: 7 })).status, 400, 'another vacancy’s applicant is refused');
    const ok = await hr.postJson(`/hire/req/${req.id}/assess`, { applicationIds: ids, level: 'A2', expiryDays: 7 });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    const made = listInvitations(s.app, { requisitionId: req.id });
    assert.equal(made.length, 2);
    assert.ok(made.every((i) => i.level === 'A2' && i.status === 'invited' && i.batch_id && i.send_state === 'not_sent'), 'without Microsoft 365 nothing is sent');
    assert.ok(messagesOf(s.app, ids[0]).some((m) => m.state === 'not_sent'));
  });

  test('only HR can issue, see the queue or read the writing', async () => {
    const lead = await login(SUPPORT_LEAD);
    const a = activeApps()[0];
    assert.equal((await lead.postJson(`/hire/app/${a.id}/assess`, { level: 'A2', expiryDays: 3 })).status, 403);
    assert.equal((await lead.get('/hire/assessments')).status, 403);
    const inv = invitationsOf(s.app, a.id)[0];
    assert.equal((await lead.get(`/hire/assessments/${inv.id}`)).status, 403);
    const ic = await login(SUPPORT_IC);
    assert.equal((await ic.get(`/hire/assessments/${inv.id}/link`)).status, 403, 'nobody outside HR can take a link');
  });

  test('the token, its hash and its cipher never appear in what HR is given', async () => {
    const hr = await login(HR);
    const inv = listInvitations(s.app)[0];
    const token = tokenOf(inv.id);
    const row = s.app.db.get<{ token_hash: string; token_cipher: string }>('SELECT token_hash, token_cipher FROM assessment_invitations WHERE id = ?', [inv.id])!;
    assert.ok(!row.token_cipher.includes(token), 'the link is not stored in the clear');
    for (const path of ['/hire/assessments', `/hire/app/${inv.application_id}`]) {
      const body = await (await hr.get(path)).text();
      for (const secret of [token, row.token_hash, row.token_cipher]) assert.ok(!body.includes(secret), `${path} leaks a link secret`);
    }
    const asJson = JSON.stringify([getInvitation(s.app, inv.id), listInvitations(s.app)]);
    for (const secret of [token, row.token_hash, row.token_cipher, 'token_hash', 'token_cipher']) assert.ok(!asJson.includes(secret));
  });

  test('without email the link is shared by hand, and every time it is shown is recorded', async () => {
    const hr = await login(HR);
    assert.deepEqual(canIssue(s.app), { ok: true, mode: 'manual' });
    const inv = listInvitations(s.app).find((i) => i.status === 'invited')!;
    const before = messagesOf(s.app, inv.application_id).filter((m) => m.kind === 'assessment_link_shared_by_hand').length;
    const res = await hr.get(`/hire/assessments/${inv.id}/link`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /\/assess\/[A-Za-z0-9_-]{20,}/, 'the modal carries the link');
    assert.match(body, /only to this candidate/i);
    assert.equal(messagesOf(s.app, inv.application_id).filter((m) => m.kind === 'assessment_link_shared_by_hand').length, before + 1);
    assert.ok(s.app.db.get("SELECT id FROM audit_log WHERE entity = 'assessment' AND entity_id = ? AND action = 'link_shown'", [inv.id]), 'audited');
    const queue = await (await hr.get('/hire/assessments')).text();
    assert.match(queue, /Get link/);
    assert.ok(!/\/assess\/[A-Za-z0-9_-]{20,}/.test(queue), 'the queue itself never carries a link');
  });
});

describe('the candidate attempt', () => {
  test('the timer starts on Begin, answers autosave and resume, and there is one submission', async () => {
    const hr = await login(HR);
    const a = activeApps()[0];
    const inv = invitationsOf(s.app, a.id)[0];
    const token = tokenOf(inv.id);

    const intro = await fetch(`${s.base}/assess/${token}`);
    assert.equal(intro.status, 200);
    const introHtml = await intro.text();
    assert.match(introHtml, /Begin/);
    assert.equal(getInvitation(s.app, inv.id)!.started_at, null, 'opening the page does not start the clock');
    assert.equal((await post(`/assess/${token}/save`, { answers: { r1: 1 } })).status, 400, 'nothing can be saved before Begin');

    const begin = await fetch(`${s.base}/assess/${token}/begin`, { method: 'POST', redirect: 'manual' });
    assert.equal(begin.status, 303);
    const started = getInvitation(s.app, inv.id)!;
    assert.equal(started.status, 'started');
    assert.equal(Math.round((new Date(started.deadline_at!).getTime() - new Date(started.started_at!).getTime()) / 60_000), 25);

    const key = Object.fromEntries(TEMPLATES.A2.items.map((i) => [i.id, i.answer]));
    const partial = { r1: key.r1, r2: key.r2, l1: key.l1 };
    assert.equal((await post(`/assess/${token}/save`, { answers: partial, writing: 'Dear Sir, I am sorry' })).status, 200);

    const page = await (await fetch(`${s.base}/assess/${token}`)).text();
    assert.match(page, /Dear Sir, I am sorry/, 'the saved writing is there when the link is opened again');
    assert.match(page, /name="r1" value="1" checked/);
    assert.ok(!page.includes('"answer"'), 'no answer key on the page');
    assert.equal(getInvitation(s.app, inv.id)!.deadline_at, started.deadline_at, 'resuming does not restart the clock');

    const answers = { ...key, l10: (key.l10 + 1) % 4, l9: (key.l9 + 1) % 4 };
    const submit = await post(`/assess/${token}/submit`, { answers, writing: 'Dear Sir, I am sorry but I cannot come on Sunday because of a family function. I can work on Saturday instead. Thank you.' });
    assert.equal(submit.status, 200);
    const doneRow = getInvitation(s.app, inv.id)!;
    assert.equal(doneRow.status, 'submitted');
    assert.equal(doneRow.objective_score, 13); assert.equal(doneRow.reading_score, 5); assert.equal(doneRow.language_score, 8);
    assert.equal(doneRow.reviewed_at, null, 'the writing waits for a person');

    assert.equal((await post(`/assess/${token}/submit`, { answers: key })).status, 400, 'a second submission is refused');
    assert.equal((await post(`/assess/${token}/save`, { answers: key })).status, 400);
    assert.equal(getInvitation(s.app, inv.id)!.objective_score, 13);
    const after = await (await fetch(`${s.base}/assess/${token}`)).text();
    assert.match(after, /has been submitted/);
    const seen = after.replace(/<svg[\s\S]*?<\/svg>/g, ''); // the logo drawing is numbers too
    assert.ok(!seen.includes('13') && !/score/i.test(seen), 'the candidate is not shown a score');

    const app = getApplication(s.app, a.id)!;
    assert.equal(app.status, 'active'); assert.equal(app.stage, a.stage, 'a result moves nothing and closes nothing');

    // HR review
    assert.equal((await hr.postJson(`/hire/assessments/${inv.id}/review`, { s_task: 3, s_organisation: 3, s_grammar: 2, outcome: 'meets' })).status, 400, 'all five parts are needed');
    assert.equal((await hr.postJson(`/hire/assessments/${inv.id}/review`, { s_task: 3, s_organisation: 3, s_grammar: 2, s_vocabulary: 3, s_tone: 5, outcome: 'meets' })).status, 400);
    const rev = await hr.postJson(`/hire/assessments/${inv.id}/review`, { s_task: 3, s_organisation: 3, s_grammar: 2, s_vocabulary: 3, s_tone: 4, outcome: 'meets', note: 'Clear and polite.' });
    assert.equal(rev.status, 200, JSON.stringify(rev.json));
    const reviewed = getInvitation(s.app, inv.id)!;
    assert.equal(reviewed.review_total, 15); assert.equal(reviewed.outcome, 'meets'); assert.ok(reviewed.reviewed_by);
    assert.equal(getApplication(s.app, a.id)!.status, 'active', 'a review moves nothing either');
  });

  test('a low score rejects nobody', async () => {
    const a = activeApps()[1];
    const token = tokenOf(invitationsOf(s.app, a.id)[0].id);
    beginAttempt(s.app, token);
    submitAttempt(s.app, token, { answers: {}, writing: '' });
    assert.equal(invitationsOf(s.app, a.id)[0].objective_score, 0);
    const app = getApplication(s.app, a.id)!;
    assert.equal(app.status, 'active'); assert.equal(app.outcome, '');
  });

  test('when the 25 minutes run out, what was saved is submitted', () => {
    const hrUser = emp(s.app, HR); const a = fresh();
    return inviteOne(s.app, hrUser, a.id, 'B1', 2).then((inv) => {
      const token = tokenOf(inv.id); const t0 = new Date();
      beginAttempt(s.app, token, t0);
      saveAttempt(s.app, token, { answers: { r1: TEMPLATES.B1.items[0].answer }, writing: 'Half a reply' }, new Date(t0.getTime() + 60_000));
      const late = new Date(t0.getTime() + 26 * 60_000);
      assert.throws(() => saveAttempt(s.app, token, { answers: {} }, late), /not open/);
      const after = getInvitation(s.app, inv.id)!;
      assert.equal(after.status, 'submitted'); assert.equal(after.objective_score, 1);
    });
  });

  test('reissuing kills the earlier link, and an expired link cannot start', async () => {
    const hr = await login(HR);
    const a = fresh();
    const first = await inviteOne(s.app, emp(s.app, HR), a.id, 'A2', 1);
    const oldToken = tokenOf(first.id);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/assess`, { level: 'B1', expiryDays: 1 })).status, 200);
    assert.equal(getInvitation(s.app, first.id)!.status, 'replaced');
    assert.throws(() => beginAttempt(s.app, oldToken), /no longer active/);
    assert.match(await (await fetch(`${s.base}/assess/${oldToken}`)).text(), /newer link/);

    const second = invitationsOf(s.app, a.id)[0];
    const token = tokenOf(second.id);
    const past = new Date(Date.now() + 25 * 3_600_000);
    assert.equal(attemptByToken(s.app, token, past)!.status, 'expired');
    assert.throws(() => beginAttempt(s.app, token, past), /no longer active/);
    assert.equal((await fetch(`${s.base}/assess/not-a-real-token-not-a-real-token`)).status, 404);
  });
});

describe('mail and reminders', () => {
  test('accepted is not delivered, uncertain is shown and never retried', async () => {
    const sent: { to: string; subject: string; html: string }[] = [];
    const original = s.app.graph;
    try {
      const hrUser = emp(s.app, HR);
      const apps = [fresh(), fresh(), fresh()];
      s.app.graph = fakeGraph(['uncertain'], sent);
      const unsure = await inviteOne(s.app, hrUser, apps[0].id, 'A2', 5);
      assert.equal(unsure.send_state, 'uncertain');
      assert.equal(sent.length, 1);
      assert.match(sent[0].html, /\/assess\//);
      const far = new Date(Date.now() + 4 * 24 * 3_600_000 + 60_000);
      const r = await runAssessmentJobs(s.app, far);
      assert.equal(r.reminders, 0); assert.equal(sent.length, 1, 'no retry and no reminder for an uncertain send');
      assert.equal(messagesOf(s.app, apps[0].id).filter((m) => m.state === 'uncertain').length, 1);

      s.app.graph = fakeGraph(['accepted'], sent);
      const ok = await inviteOne(s.app, hrUser, apps[1].id, 'B1', 5);
      assert.equal(ok.send_state, 'accepted');

      const t0 = new Date(ok.sent_at!).getTime(); const H = 3_600_000;
      assert.equal((await runAssessmentJobs(s.app, new Date(t0 + 47 * H))).reminders, 0, 'nothing before 48 hours');
      assert.equal((await runAssessmentJobs(s.app, new Date(t0 + 49 * H))).reminders, 1, 'first reminder after 48 hours');
      assert.equal((await runAssessmentJobs(s.app, new Date(t0 + 50 * H))).reminders, 0, 'and only once');
      assert.equal((await runAssessmentJobs(s.app, new Date(t0 + 5 * 24 * H - 23 * H))).reminders, 1, 'second reminder inside the last 24 hours');
      assert.equal((await runAssessmentJobs(s.app, new Date(t0 + 5 * 24 * H - 22 * H))).reminders, 0);
      assert.equal(messagesOf(s.app, apps[1].id).filter((m) => m.kind.startsWith('assessment_reminder')).length, 2);

      const started = await inviteOne(s.app, hrUser, apps[2].id, 'A2', 5);
      const tok = decodeURIComponent(sent[sent.length - 1].html.match(/\/assess\/([A-Za-z0-9_-]+)/)![1]);
      beginAttempt(s.app, tok, new Date());
      const before = sent.length;
      const res = await runAssessmentJobs(s.app, new Date(new Date(started.sent_at!).getTime() + 49 * H));
      assert.equal(res.reminders, 0, 'no reminder once the candidate has started');
      assert.equal(sent.length, before);
    } finally { s.app.graph = original; }
  });

  test('the Graph client tells accepted, failed and uncertain apart', async () => {
    const cfg = { tenantId: 't', clientId: 'c', clientSecret: 'x', sender: 'hiring@loyalstring.com' };
    const mk = (mailStatus: number | 'throw', tokenStatus = 200) => createGraphMailer(cfg, (async (url: string) => {
      if (url.includes('login.microsoftonline.com')) return { status: tokenStatus, headers: { get: () => null }, json: async () => ({ access_token: 'tok', expires_in: 3600 }), text: async () => '' };
      if (mailStatus === 'throw') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      return { status: mailStatus, headers: { get: () => 'abc-123' }, json: async () => ({}), text: async () => '' };
    }) as never);
    const msg = { to: 'a@example.com', subject: 's', html: '<p>x</p>' };
    assert.deepEqual((await mk(202).send(msg)).state, 'accepted');
    assert.equal((await mk(202).send(msg)).ref, 'abc-123');
    assert.match((await mk(202).send(msg)).detail, /not proof of delivery/i);
    assert.equal((await mk(403).send(msg)).state, 'failed');
    assert.equal((await mk(503).send(msg)).state, 'uncertain');
    assert.equal((await mk('throw').send(msg)).state, 'uncertain');
    assert.equal((await mk(202, 401).send(msg)).state, 'failed', 'a sign-in failure sent nothing, so it is a clean failure');
    assert.equal(createGraphMailer({ tenantId: '', clientId: '', clientSecret: '', sender: '' }).configured, false);
  });
});
