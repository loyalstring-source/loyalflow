// The three rules LoyalHire exists to enforce, tested over HTTP:
// candidate privacy, no automatic rejection, no automatic offer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, COO, SUPPORT_LEAD, SUPPORT_IC, HR, DEV_LEAD } from '../helpers.ts';
import { listRequisitions, getRequisition, listApplications, getApplication, listInterviews, getInterview, offersOf, getOffer, findDuplicates, holdQueue, decisionsOf, onboardingOf, onboardingItems, normalizeEmail, scorecardsOf, visibleScorecards, panelConflicts } from '../../src/modules/hr/recruiting.ts';
import { localDateString, addDays } from '../../src/lib/time.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const openReq = () => listRequisitions(s.app, { status: ['open'] })[0];
const future = (days: number, hour = 11) => `${localDateString(addDays(new Date(), days))}T${String(hour).padStart(2, '0')}:00`;

describe('candidate privacy', () => {
  test('an unrelated colleague cannot open a candidate or an application', async () => {
    const ic = await login(SUPPORT_IC);
    const a = listApplications(s.app, { limit: 1 })[0];
    assert.equal((await ic.get('/hire/candidates')).status, 403);
    assert.equal((await ic.get(`/hire/app/${a.id}`)).status, 403);
    assert.equal((await ic.get('/hire')).status, 403, 'the hiring area itself is closed to them');
  });
  test('somebody on the panel can see that one application and nothing else', async () => {
    const interview = listInterviews(s.app, { limit: 5 })[0];
    const panellist = interview.panel![0];
    const c = new Client(s.base);
    const email = s.app.db.get<{ email: string }>('SELECT email FROM employees WHERE id = ?', [panellist.id])!.email;
    await c.login(email);
    assert.equal((await c.get(`/hire/app/${interview.application_id}`)).status, 200, 'their own hire');
    assert.equal((await c.get('/hire/candidates')).status, 403, 'but not the whole candidate list');
  });
  test('HR sees everything', async () => {
    const hr = await login(HR);
    assert.equal((await hr.get('/hire/candidates')).status, 200);
    assert.equal((await hr.get(`/hire/app/${listApplications(s.app, { limit: 1 })[0].id}`)).status, 200);
  });
});

describe('requisitions', () => {
  test('headcount is approved outside the app and the vacancy needs a reference to open', async () => {
    const hr = await login(HR);
    const create = await hr.postJson('/hire/req', { title: 'QA Engineer', departmentId: 'QA', positions: 1, budgetCtc: 600000, experience: '2+ years', location: 'Pune', justification: 'Releases are tested by the developers who wrote them, which is how the GST bug reached a customer.' });
    assert.equal(create.status, 200, JSON.stringify(create.json));
    const req = listRequisitions(s.app, { limit: 10 }).find((r) => r.title === 'QA Engineer')!;
    assert.equal(req.status, 'draft');

    const cand = await hr.postJson('/hire/candidates', { fullName: 'Early Bird', email: 'early@example.com', requisitionId: req.id });
    assert.equal(cand.status, 400, 'nobody can be added to a draft vacancy');

    assert.equal((await hr.postJson(`/hire/req/${req.id}/open`, {})).status, 400, 'no approval reference, no opening');
    assert.equal((await hr.postJson(`/hire/req/${req.id}/open`, { approvalRef: 'Approved by the COO, email of 3 Nov' })).status, 200);
    const opened = getRequisition(s.app, req.id)!;
    assert.equal(opened.status, 'open');
    assert.match(opened.approval_ref, /COO/);
    assert.equal(s.app.db.get("SELECT id FROM tasks WHERE payload LIKE ?", [`%${req.id}%`]), undefined, 'no approval task is raised inside the app');
  });

  test('a vacancy can be paused, resumed and closed with a choice for the people in play', async () => {
    const hr = await login(HR);
    const req = listRequisitions(s.app, { limit: 10 }).find((r) => r.title === 'QA Engineer')!;
    await hr.postJson('/hire/candidates', { fullName: 'Paused Person', email: 'paused@example.com', requisitionId: req.id, confirmDuplicate: '1' });
    assert.equal((await hr.postJson(`/hire/req/${req.id}/pause`, { reason: 'Budget review pending' })).status, 200);
    assert.equal(getRequisition(s.app, req.id)!.status, 'paused');
    assert.equal((await hr.postJson('/hire/candidates', { fullName: 'Too Late', email: 'late@example.com', requisitionId: req.id, confirmDuplicate: '1' })).status, 400);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/resume`, {})).status, 200);
    assert.equal((await hr.postJson(`/hire/req/${req.id}/close`, { reason: 'Role merged into another team', applicants: 'close' })).status, 200);
    const a = listApplications(s.app, { requisitionId: req.id })[0];
    assert.equal(a.status, 'closed');
    assert.match(a.outcome_reason, /Vacancy closed/);
  });

  test('a thin justification is refused', async () => {
    const hr = await login(HR);
    const res = await hr.postJson('/hire/req', { title: 'Another role', departmentId: 'SUP', positions: 1, justification: 'need one' });
    assert.equal(res.status, 400);
  });
});

describe('candidates', () => {
  test('a repeat applicant is spotted before a second record is made', async () => {
    const hr = await login(HR);
    const first = await hr.postJson('/hire/candidates', { fullName: 'Rahul Repeat', email: 'Rahul.Repeat@Example.com', phone: '98765 43210' });
    assert.equal(first.status, 200);
    const again = await hr.postJson('/hire/candidates', { fullName: 'Rahul Repeat', email: 'rahul.repeat+jobs@example.com' });
    assert.equal(again.status, 409, 'the same person with a tagged address is still the same person');
    assert.match(String(again.json.error), /already have/i);
    const forced = await hr.postJson('/hire/candidates', { fullName: 'Rahul Repeat', email: 'rahul.repeat+jobs@example.com', confirmDuplicate: '1' });
    assert.equal(forced.status, 200, 'HR can still override deliberately');
  });
  test('addresses are compared without the tag or the case', () => {
    assert.equal(normalizeEmail('  Rahul.Repeat+jobs@Example.COM '), 'rahul.repeat@example.com');
    assert.ok(findDuplicates(s.app, { phone: '+91 98765 43210' }).length, 'and by the last ten digits of the phone');
  });
  test('the same person cannot be added to one role twice', async () => {
    const hr = await login(HR);
    const a = listApplications(s.app, { limit: 1 })[0];
    const res = await hr.postJson('/hire/candidates', { fullName: 'x', email: 'x@x.com', confirmDuplicate: '1' });
    assert.equal(res.status, 200);
    const direct = s.app.db.get<{ id: string }>('SELECT id FROM candidates ORDER BY created_at DESC LIMIT 1')!;
    s.app.db.run("INSERT INTO applications (id, candidate_id, requisition_id, source, received_at, stage, stage_since, status, workflow_version, created_at, updated_at) VALUES ('APP-DUP', ?, ?, 'test', ?, 'applied', ?, 'active', 1, ?, ?)",
      [direct.id, a.requisition_id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]);
    assert.throws(() => s.app.db.run("INSERT INTO applications (id, candidate_id, requisition_id, source, received_at, stage, stage_since, status, workflow_version, created_at, updated_at) VALUES ('APP-DUP2', ?, ?, 'test', ?, 'applied', ?, 'active', 1, ?, ?)",
      [direct.id, a.requisition_id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()]), 'the database refuses a second application for the same pair');
  });
});

describe('interviews and scorecards', () => {
  test('a clashing panel is flagged and can be overridden deliberately', async () => {
    const hr = await login(HR);
    const req = openReq();
    await hr.postJson('/hire/candidates', { fullName: 'Clash Test', email: 'clash@example.com', requisitionId: req.id, source: 'direct', confirmDuplicate: '1' });
    const a = listApplications(s.app, { requisitionId: req.id, limit: 50 }).find((x) => x.candidate_name === 'Clash Test')!;
    const lead = s.app.db.get<{ id: string }>('SELECT id FROM employees WHERE email = ?', [SUPPORT_LEAD])!.id;

    const first = await hr.postJson(`/hire/app/${a.id}/schedule`, { roundType: 'technical', startsAt: future(3), minutes: 60, panel: [lead] });
    assert.equal(first.status, 200, JSON.stringify(first.json));

    await hr.postJson('/hire/candidates', { fullName: 'Clash Test Two', email: 'clash2@example.com', requisitionId: req.id, source: 'direct', confirmDuplicate: '1' });
    const b = listApplications(s.app, { requisitionId: req.id, limit: 50 }).find((x) => x.candidate_name === 'Clash Test Two')!;
    const clash = await hr.postJson(`/hire/app/${b.id}/schedule`, { roundType: 'technical', startsAt: future(3), minutes: 60, panel: [lead] });
    assert.equal(clash.status, 409, 'the double booking is refused');
    assert.match(String(clash.json.error), /already with/i);

    const forced = await hr.postJson(`/hire/app/${b.id}/schedule`, { roundType: 'technical', startsAt: future(3), minutes: 60, panel: [lead], force: '1' });
    assert.equal(forced.status, 200, 'but HR can insist');
    assert.equal(panelConflicts(s.app, [lead], new Date(`${future(3)}:00`).toISOString(), new Date(Date.parse(`${future(3)}:00`) + 3_600_000).toISOString()).length, 1);
  });

  test('a scorecard needs evidence, and nobody sees anyone else’s until all are in', async () => {
    const hr = await login(HR);
    const req = openReq();
    await hr.postJson('/hire/candidates', { fullName: 'Panel Subject', email: 'panel.subject@example.com', requisitionId: req.id, source: 'direct', confirmDuplicate: '1' });
    const a = listApplications(s.app, { requisitionId: req.id, limit: 50 }).find((x) => x.candidate_name === 'Panel Subject')!;
    const lead = s.app.db.get<{ id: string }>('SELECT id FROM employees WHERE email = ?', [SUPPORT_LEAD])!.id;
    const dev = s.app.db.get<{ id: string }>('SELECT id FROM employees WHERE email = ?', [DEV_LEAD])!.id;
    const sched = await hr.postJson(`/hire/app/${a.id}/schedule`, { roundType: 'technical', startsAt: future(5, 15), minutes: 45, panel: [lead, dev], force: '1' });
    assert.equal(sched.status, 200, JSON.stringify(sched.json));
    const iv = listInterviews(s.app, { applicationId: a.id })[0];
    await hr.postJson(`/hire/interview/${iv.id}/status`, { status: 'completed' });

    const leadClient = await login(SUPPORT_LEAD);
    const noEvidence = await leadClient.postJson(`/hire/interview/${iv.id}/scorecard`, { r_skill: 4, r_problem: 4, r_communication: 4, r_ownership: 4, r_fit: 4, recommendation: 'yes', evidence: 'good', submit: '1' });
    assert.equal(noEvidence.status, 400, 'a rating without evidence is not a scorecard');

    const ok = await leadClient.postJson(`/hire/interview/${iv.id}/scorecard`, { r_skill: 4, r_problem: 4, r_communication: 5, r_ownership: 3, r_fit: 4, recommendation: 'yes', evidence: 'Debugged a stock mismatch live: checked the GRN first, then the transfer note. Explained it to me as he went.', notes: '', submit: '1' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));

    const leadEmp = s.app.db.get<{ id: string }>('SELECT id FROM employees WHERE email = ?', [SUPPORT_LEAD])!;
    const devEmp = s.app.db.get('SELECT * FROM employees WHERE email = ?', [DEV_LEAD]) as never;
    const seenByDev = visibleScorecards(s.app, devEmp, iv.id);
    assert.equal(seenByDev.cards.length, 0, 'the second interviewer sees nothing yet');
    assert.equal(seenByDev.hidden, 1, 'but is told one is in');
    void leadEmp;

    const devClient = await login(DEV_LEAD);
    const ok2 = await devClient.postJson(`/hire/interview/${iv.id}/scorecard`, { r_skill: 3, r_problem: 3, r_communication: 4, r_ownership: 3, r_fit: 3, recommendation: 'no', evidence: 'Struggled with the API question; could not say what a 409 means or when he would use one.', submit: '1' });
    assert.equal(ok2.status, 200, JSON.stringify(ok2.json));
    assert.equal(visibleScorecards(s.app, devEmp, iv.id).cards.length, 2, 'both open once everyone is in');
    assert.equal(scorecardsOf(s.app, iv.id).length, 2);
  });

  test('somebody who was not on the panel cannot write a scorecard', async () => {
    const iv = listInterviews(s.app, { limit: 10 }).find((i) => i.status === 'completed')!;
    const ic = await login(SUPPORT_IC);
    const res = await ic.postJson(`/hire/interview/${iv.id}/scorecard`, { r_skill: 1, r_problem: 1, r_communication: 1, r_ownership: 1, r_fit: 1, recommendation: 'strong_no', evidence: 'I have never met this person but here is my opinion anyway.', submit: '1' });
    assert.ok([403, 404].includes(res.status), `expected a refusal, got ${res.status}`);
  });

  test('a low score does not reject anybody', async () => {
    // The application with two scorecards, one of them a "no", is still live.
    const a = listApplications(s.app, { limit: 100 }).find((x) => x.candidate_name === 'Panel Subject')!;
    assert.equal(getApplication(s.app, a.id)!.status, 'active', 'still open after a negative scorecard');
    assert.equal(getApplication(s.app, a.id)!.outcome, '');
  });

  test('closing an application takes a person and a reason', async () => {
    const hr = await login(HR);
    const a = listApplications(s.app, { limit: 100 }).find((x) => x.candidate_name === 'Panel Subject')!;
    const thin = await hr.postJson(`/hire/app/${a.id}/close`, { outcome: 'rejected', reason: 'no' });
    assert.equal(thin.status, 400, 'a one-word reason is not a reason');
    const real = await hr.postJson(`/hire/app/${a.id}/close`, { outcome: 'rejected', reason: 'The API round showed the gap is wider than two weeks of training. Told him plainly and kept him on file.' });
    assert.equal(real.status, 200, JSON.stringify(real.json));
    const after = getApplication(s.app, a.id)!;
    assert.equal(after.status, 'closed');
    assert.ok(after.decision_by, 'a named person owns the decision');
    assert.ok(after.outcome_reason.length > 20);
  });
});

describe('hold, decision, offer and onboarding', () => {
  test('a hold keeps the application open and shows in the follow-up list', async () => {
    const hr = await login(HR);
    const req = openReq();
    await hr.postJson('/hire/candidates', { fullName: 'Hold Me', email: 'hold@example.com', requisitionId: req.id, source: 'direct', confirmDuplicate: '1' });
    const a = listApplications(s.app, { requisitionId: req.id, limit: 50 }).find((x) => x.candidate_name === 'Hold Me')!;
    assert.equal((await hr.postJson(`/hire/app/${a.id}/hold`, { reason: 'Waiting for the manager', until: 'soon' })).status, 400);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/hold`, { reason: 'Waiting for the manager', until: localDateString(addDays(new Date(), 5)) })).status, 200);
    assert.equal(getApplication(s.app, a.id)!.status, 'on_hold');
    assert.ok(holdQueue(s.app).some((h) => h.id === a.id));
    assert.equal((await hr.postJson(`/hire/app/${a.id}/stage`, { to: 'screening' })).status, 400, 'nothing moves while on hold');
    assert.equal((await hr.postJson(`/hire/app/${a.id}/resume`, {})).status, 200);
    assert.equal(getApplication(s.app, a.id)!.status, 'active');
    assert.equal((await hr.postJson(`/hire/app/${a.id}/close`, { outcome: 'no_show', reason: 'Did not turn up for two scheduled calls.' })).status, 200);
    assert.equal(getApplication(s.app, a.id)!.outcome, 'no_show');
    assert.equal((await hr.postJson(`/hire/app/${a.id}/reopen`, { reason: 'Candidate called back, had a family emergency' })).status, 200);
    assert.equal(getApplication(s.app, a.id)!.status, 'active');
  });

  test('offer, onboarding and hired cannot be reached by moving a card', async () => {
    const hr = await login(HR);
    const req = openReq();
    await hr.postJson('/hire/candidates', { fullName: 'Straight To Offer', email: 'sto@example.com', requisitionId: req.id, source: 'direct', confirmDuplicate: '1' });
    const a = listApplications(s.app, { requisitionId: req.id, limit: 50 }).find((x) => x.candidate_name === 'Straight To Offer')!;
    for (const to of ['offer', 'onboarding', 'hired']) assert.equal((await hr.postJson(`/hire/app/${a.id}/stage`, { to })).status, 400, to);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/stage`, { to: 'assessment' })).status, 200);
    const res = await hr.postJson(`/hire/app/${a.id}/decision`, { outcome: 'hire', rationale: 'Looks good on paper, skipping interviews.' });
    assert.equal(res.status, 400);
    assert.match(String(res.json.error), /scorecard/i);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/offer`, { designation: 'X', ctcAnnual: 1, joiningDate: localDateString(addDays(new Date(), 30)) })).status, 400, 'no offer before a decision');
  });

  test('a decision to hire leads to an offer that HR issues by hand, with no approval task', async () => {
    const hr = await login(HR);
    const a = listApplications(s.app, { limit: 100 }).find((x) => x.status === 'active' && x.candidate_name === 'Clash Test')!;
    const iv = listInterviews(s.app, { applicationId: a.id })[0];
    await hr.postJson(`/hire/interview/${iv.id}/status`, { status: 'completed' });
    const leadClient = await login(SUPPORT_LEAD);
    await leadClient.postJson(`/hire/interview/${iv.id}/scorecard`, { r_skill: 4, r_problem: 4, r_communication: 4, r_ownership: 4, r_fit: 4, recommendation: 'yes', evidence: 'Clear on the ERP basics and talked through a real customer escalation he had handled end to end.', submit: '1' });

    assert.equal((await leadClient.postJson(`/hire/app/${a.id}/decision`, { outcome: 'hire', rationale: 'I liked him a lot in the interview.' })).status, 403, 'HR records the decision');
    const dec = await hr.postJson(`/hire/app/${a.id}/decision`, { outcome: 'hire', rationale: 'Panel recommended. Clear on ERP basics and good with customers.' });
    assert.equal(dec.status, 200, JSON.stringify(dec.json));
    assert.equal(getApplication(s.app, a.id)!.stage, 'offer');
    assert.equal(decisionsOf(s.app, a.id)[0].outcome, 'hire');

    const draft = await hr.postJson(`/hire/app/${a.id}/offer`, { designation: 'Technical Support Engineer', ctcAnnual: 460000, joiningDate: localDateString(addDays(new Date(), 30)) });
    assert.equal(draft.status, 200, JSON.stringify(draft.json));
    const offer = offersOf(s.app, a.id)[0];
    assert.equal(offer.status, 'draft');
    assert.equal(getOffer(s.app, offer.id)!.issued_at, null, 'drafting sends nothing');
    assert.equal(s.app.db.get("SELECT id FROM tasks WHERE payload LIKE ?", [`%${offer.id}%`]), undefined, 'no approval task');

    const issue = await hr.postJson(`/hire/offer/${offer.id}/issue`, {});
    assert.equal(issue.status, 200, JSON.stringify(issue.json));
    const issued = getOffer(s.app, offer.id)!;
    assert.ok(issued.issued_at && issued.issued_by, 'a named person issued it');
  });

  test('an accepted offer starts onboarding, and hired waits for training and the training assessment', async () => {
    const hr = await login(HR);
    const a = listApplications(s.app, { limit: 100 }).find((x) => x.candidate_name === 'Clash Test')!;
    const offer = offersOf(s.app, a.id)[0];
    const resp = await hr.postJson(`/hire/offer/${offer.id}/response`, { response: 'accepted', note: 'Accepted on call, joining as agreed.' });
    assert.equal(resp.status, 200, JSON.stringify(resp.json));
    let after = getApplication(s.app, a.id)!;
    assert.equal(after.stage, 'onboarding');
    assert.equal(after.status, 'active', 'accepting an offer does not make anybody hired');
    const ob = onboardingOf(s.app, a.id)!;
    const items = () => onboardingItems(s.app, ob.id);
    assert.equal(items().length, 7);

    assert.equal((await hr.postJson(`/hire/app/${a.id}/onboarding/complete`, {})).status, 400, 'nothing is done yet');

    const onboard = await hr.postJson(`/hire/offer/${offer.id}/onboard`, { employeeId: 'LS900', email: 'clash.test@loyalstring.com', reportingManagerId: s.app.db.get<{ id: string }>('SELECT id FROM employees WHERE email = ?', [SUPPORT_LEAD])!.id });
    assert.equal(onboard.status, 200, JSON.stringify(onboard.json));
    const e = s.app.db.get<{ employment_type: string; hired_from_candidate: string | null; must_change_password: number }>('SELECT employment_type, hired_from_candidate, must_change_password FROM employees WHERE id = ?', ['LS900'])!;
    assert.equal(e.employment_type, 'probation');
    assert.ok(e.hired_from_candidate, 'the employee is linked back to the candidate record');
    assert.ok(items().find((i) => i.key === 'employee_record')!.done_at, 'creating the employee ticks the item');

    const tick = async (key: string) => hr.postJson(`/hire/onboarding/item/${items().find((i) => i.key === key)!.id}`, { done: '1' });
    assert.equal((await tick('training_done')).status, 200);
    const early = await hr.postJson(`/hire/app/${a.id}/onboarding/complete`, {});
    assert.equal(early.status, 400, 'training done is not enough');
    assert.match(String(early.json.error), /assessment/i);
    assert.equal((await tick('training_assessment')).status, 200);
    assert.equal((await hr.postJson(`/hire/app/${a.id}/onboarding/complete`, {})).status, 200);
    after = getApplication(s.app, a.id)!;
    assert.equal(after.stage, 'hired');
    assert.equal(after.outcome, 'hired');
  });

  test('only HR issues an offer', async () => {
    const lead = await login(SUPPORT_LEAD);
    const anyOffer = s.app.db.get<{ id: string }>("SELECT id FROM offers WHERE status = 'issued' LIMIT 1")!;
    const res = await lead.postJson(`/hire/offer/${anyOffer.id}/response`, { response: 'accepted' });
    assert.ok([403, 400].includes(res.status));
  });
});

describe('HR access', () => {
  test('HR reaches the people side and the KPIs, and nothing else', async () => {
    const hr = await login(HR);
    for (const p of ['/', '/people', '/attendance', '/appraisals', '/hire', '/payroll', '/company']) assert.equal((await hr.get(p)).status, 200, p);
    for (const p of ['/desk', '/dev', '/pipeline', '/production', '/procurement', '/budgets', '/analytics', '/api/v1/tickets', '/exports/pipeline.xlsx']) assert.equal((await hr.get(p)).status, 403, p);
    const home = await (await hr.get('/')).text();
    assert.ok(!home.includes('href="/desk"') && !home.includes('href="/pipeline"'), 'the navigation does not offer them either');
    const lead = await login(SUPPORT_LEAD);
    assert.equal((await lead.get('/desk')).status, 200, 'other departments are unaffected');
  });
});
