import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getEmployee } from '../modules/people/model.ts';
import {
  isRecruiter, canSeeApplication, requireSeeApplication,
  listRequisitions, getRequisition, saveRequisition, openRequisition, pauseRequisition, resumeRequisition, closeRequisition,
  getCandidate, saveCandidate, findDuplicates,
  listApplications, getApplication, applicationEvents, addApplication, moveStage, screeningNotes, closeApplication, holdApplication, resumeApplication, reopenApplication, holdQueue, recordDecision, decisionsOf,
  onboardingOf, onboardingItems, setOnboardingItem, completeOnboarding, onboardingQueue, expireOffers, cancelOffer, type CloseOutcome,
  listInterviews, getInterview, scheduleInterview, rescheduleInterview, setInterviewStatus, onPanel,
  myScorecard, saveScorecard, visibleScorecards, calibrate, scorecardsOf,
  getOffer, offersOf, draftOffer, issueOffer, recordOfferResponse, onboardFromOffer,
  pipelineCounts, hiringStats, SCORE_AREAS, type Stage, type Candidate
} from '../modules/hr/recruiting.ts';
import { hirePage, requisitionModal, requisitionPage, candidatesPage, candidateModal, applicationPage, scheduleModal, closeApplicationModal, holdModal, decisionModal, openRequisitionModal, closeRequisitionModal, offerModal, onboardModal, interviewPage, rescheduleModal, candidateDrawer } from '../ui/pages/hire.ts';
import { getSetting } from '../lib/settings.ts';
import { invitationsOf, messagesOf, canIssue } from '../modules/hr/assessment.ts';
import { screeningFor, planTrack, planOf, setFor, screeningTotals } from '../modules/hr/screening.ts';
import { cvOf, aiSettings } from '../modules/hr/cv.ts';
import { screeningCard, planCard, cvCard, vacancyExtras } from '../ui/pages/hire-extra.ts';
import { html, when } from '../lib/html.ts';
import { page } from '../ui/layout.ts';
import { empty } from '../ui/components.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

function requireRecruiter(app: App, e: Employee): void {
  if (!isRecruiter(app, e)) throw new HttpError(403, 'Hiring is run by HR. Ask them to add you to the panel if you need to see a candidate.');
}
function nextEmployeeId(app: App): string {
  const last = app.db.get<{ id: string }>("SELECT id FROM employees WHERE id LIKE 'LS%' ORDER BY CAST(substr(id, 3) AS INTEGER) DESC LIMIT 1")?.id || 'LS000';
  return `LS${String(Number(last.slice(2)) + 1).padStart(3, '0')}`;
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/hire', (ctx) => {
    const v = view(ctx); const me = v.user; const rec = isRecruiter(app, me);
    const mine = listInterviews(app, { interviewerId: me.id, from: new Date(Date.now() - 86_400_000).toISOString(), limit: 20 }).filter((i) => i.status === 'scheduled');
    const due = listInterviews(app, { interviewerId: me.id, limit: 50 }).filter((i) => i.status === 'completed' && !myScorecard(app, i.id, me.id)?.submitted_at);
    if (!rec && !mine.length && !due.length && !listInterviews(app, { interviewerId: me.id, limit: 1 }).length) return htmlResponse(page(v, { title: 'Hiring', navTab: 'hire', subtitle: 'Hiring is run by HR.', body: empty('You will see a candidate here when HR puts you on an interview panel.', '👥') }));
    if (rec) expireOffers(app);
    return htmlResponse(hirePage(v, {
      holds: rec ? holdQueue(app) : [], onboarding: rec ? onboardingQueue(app) : [],
      stats: hiringStats(app),
      requisitions: rec ? listRequisitions(app, { limit: 50 }) : [],
      pipeline: pipelineCounts(app), myInterviews: mine, scorecardsDue: due, canRecruit: rec
    }));
  });

  // ---- Requisitions ----
  r.get('/hire/req/new', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    return htmlResponse(requisitionModal(v, { departments: app.db.all('SELECT id, name FROM departments ORDER BY name'), managers: listEmployees(app.db, { status: 'active' }).filter((e) => e.functional_role !== 'ic') }));
  });
  r.get('/hire/req/:id/edit', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Requisition not found.');
    return htmlResponse(requisitionModal(v, { departments: app.db.all('SELECT id, name FROM departments ORDER BY name'), managers: listEmployees(app.db, { status: 'active' }).filter((e) => e.functional_role !== 'ic'), req }));
  });
  r.post('/hire/req', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR raises requisitions.');
    const b = await ctx.body();
    try {
      const req = saveRequisition(app, me, { id: str(b, 'id') || undefined, title: str(b, 'title'), departmentId: str(b, 'departmentId'), positions: num(b, 'positions') || 1, employmentType: str(b, 'employmentType'), experience: str(b, 'experience'), budgetCtc: num(b, 'budgetCtc'), location: str(b, 'location'), justification: str(b, 'justification'), description: str(b, 'description'), hiringManagerId: str(b, 'hiringManagerId'), recruiterId: str(b, 'recruiterId') || undefined, approvalRef: str(b, 'approvalRef'), workMode: str(b, 'workMode'), targetDate: str(b, 'targetDate') });
      return done(ctx, { redirect: `/hire/req/${req.id}`, toast: { title: 'Vacancy saved', body: 'It is a draft. Open it when the headcount approval is on record.', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/req/:id/open', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Requisition not found.');
    return htmlResponse(openRequisitionModal(v, req));
  });
  r.post('/hire/req/:id/open', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR opens a vacancy.');
    const b = await ctx.body();
    try { const req = openRequisition(app, me, ctx.params.id, str(b, 'approvalRef')); return done(ctx, { reload: true, toast: { title: 'Vacancy open', body: `${req.title} can take candidates now.`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/req/:id/pause', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR pauses a vacancy.');
    const b = await ctx.body();
    try { pauseRequisition(app, me, ctx.params.id, str(b, 'reason')); return done(ctx, { reload: true, toast: { title: 'Vacancy paused', body: 'No new candidates can be added until it is resumed.', kind: 'info' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/req/:id/resume', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR resumes a vacancy.');
    try { resumeRequisition(app, me, ctx.params.id); return done(ctx, { reload: true, toast: { title: 'Vacancy open again', kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/req/:id/close', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Requisition not found.');
    return htmlResponse(closeRequisitionModal(v, req));
  });
  r.post('/hire/req/:id/close', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR closes a vacancy.');
    const b = await ctx.body();
    if (str(b, 'reason').trim().length < 5) return fail(ctx, 400, 'Say why the vacancy is closing.');
    closeRequisition(app, me, ctx.params.id, str(b, 'reason').trim(), str(b, 'applicants') === 'close' ? 'close' : 'keep');
    return done(ctx, { reload: true, toast: { title: 'Vacancy closed', kind: 'info' } });
  });
  r.get('/hire/req/:id', (ctx) => {
    const v = view(ctx); const rec = isRecruiter(app, v.user);
    const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Requisition not found.');
    if (!rec && req.hiring_manager_id !== v.user.id) throw new HttpError(403, 'This requisition is not yours.');
    return htmlResponse(requisitionPage(v, {
      req, applications: listApplications(app, { requisitionId: req.id, limit: 300 }), pipeline: pipelineCounts(app, req.id),
      canRecruit: rec, canSubmit: req.status === 'draft' && rec, canAssess: canIssue(app).ok, screening: screeningTotals(app, req.id),
      extraSide: (() => { const p = planOf(app, req.id); const qs = setFor(app, req.id); return vacancyExtras({ req, steps: p.steps, planOwn: p.own, questions: qs.questions.length, points: qs.questions.reduce((n, q) => n + q.maxPoints, 0), questionsOwn: qs.own, canEdit: rec }); })()
    }));
  });
  r.get('/hire/req/:id/add', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    return htmlResponse(candidateModal(v, { openRoles: listRequisitions(app, { status: ['open'] }) }));
  });

  // ---- Candidates ----
  r.get('/hire/candidates', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const q = (ctx.query.get('q') || '').trim();
    const rows = q
      ? app.db.all<Candidate>("SELECT * FROM candidates WHERE lower(full_name) LIKE ? OR email_normalized LIKE ? OR phone LIKE ? ORDER BY created_at DESC LIMIT 200", [`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`, `%${q}%`])
      : app.db.all<Candidate>('SELECT * FROM candidates ORDER BY created_at DESC LIMIT 200');
    const withCounts = rows.map((c) => ({ ...c, applications: app.db.get<{ n: number }>('SELECT count(*) AS n FROM applications WHERE candidate_id = ?', [c.id])?.n || 0 }));
    return htmlResponse(candidatesPage(v, { rows: withCounts, q }));
  });
  r.get('/hire/candidates/new', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    return htmlResponse(candidateModal(v, { openRoles: listRequisitions(app, { status: ['open'] }) }));
  });
  r.post('/hire/candidates', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR adds candidates.');
    const b = await ctx.body();
    try {
      const dupes = findDuplicates(app, { email: str(b, 'email'), phone: str(b, 'phone'), fullName: str(b, 'fullName') });
      if (dupes.length && !str(b, 'confirmDuplicate')) return fail(ctx, 409, `We may already have ${dupes[0].full_name} on record. Open that record and add the new role to it, or resubmit to create a second record.`);
      const c = saveCandidate(app, me, { fullName: str(b, 'fullName'), email: str(b, 'email'), phone: str(b, 'phone'), currentEmployer: str(b, 'currentEmployer'), experienceYears: num(b, 'experienceYears'), currentCtc: num(b, 'currentCtc'), expectedCtc: num(b, 'expectedCtc'), noticeDays: num(b, 'noticeDays'), location: str(b, 'location'), notes: str(b, 'notes') });
      const reqId = str(b, 'requisitionId');
      if (reqId) { const a = addApplication(app, me, { candidateId: c.id, requisitionId: reqId, source: str(b, 'source') || 'direct' }); return done(ctx, { redirect: `/hire/app/${a.id}`, toast: { title: 'Candidate added', body: `${c.full_name} is on the role.`, kind: 'success' } }); }
      return done(ctx, { redirect: '/hire/candidates', toast: { title: 'Candidate saved', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/candidate/:id', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const c = getCandidate(app, ctx.params.id);
    if (!c) throw new HttpError(404, 'Candidate not found.');
    return htmlResponse(candidateDrawer(v, { c, apps: listApplications(app, { candidateId: c.id }) }));
  });

  // ---- Applications ----
  r.get('/hire/app/:id', (ctx) => {
    const v = view(ctx);
    const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    requireSeeApplication(app, v.user, a);
    const rec = isRecruiter(app, v.user);
    return htmlResponse(applicationPage(v, {
      a, candidate: getCandidate(app, a.candidate_id)!, req: getRequisition(app, a.requisition_id)!,
      events: applicationEvents(app, a.id), interviews: listInterviews(app, { applicationId: a.id }), offers: offersOf(app, a.id),
      extraMain: (() => { const sc = screeningFor(app, a.id); const tr = planTrack(app, a.id); return html`${when(rec, () => screeningCard({ a, set: sc.set, review: sc.review, newer: sc.newerSetAvailable, canEdit: rec }))}${planCard({ a, steps: tr.steps, next: tr.next, canEdit: rec })}`; })(),
      extraSide: rec ? cvCard({ candidateId: a.candidate_id, cv: cvOf(app, a.candidate_id), canEdit: rec, ai: aiSettings(app) }) : undefined,
      assessments: rec ? invitationsOf(app, a.id) : [], messages: rec ? messagesOf(app, a.id) : [], canAssess: canIssue(app).ok,
      decisions: decisionsOf(app, a.id), onboarding: onboardingOf(app, a.id), onboardingItems: onboardingOf(app, a.id) ? onboardingItems(app, onboardingOf(app, a.id)!.id) : [],
      canRecruit: rec, canDecide: rec
    }));
  });
  r.post('/hire/app/:id/stage', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { const a = moveStage(app, me, ctx.params.id, str(b, 'to') as Stage, str(b, 'note')); return done(ctx, { reload: true, toast: { title: 'Moved', body: `${a.candidate_name} is now in ${a.stage}.`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/app/:id/notes', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { screeningNotes(app, me, ctx.params.id, str(b, 'notes')); return done(ctx, { toast: { title: 'Notes saved', kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/app/:id/close', (ctx) => {
    const v = view(ctx); const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    requireSeeApplication(app, v.user, a);
    return htmlResponse(closeApplicationModal(v, a));
  });
  r.post('/hire/app/:id/close', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try {
      const a = closeApplication(app, me, ctx.params.id, (str(b, 'outcome') || 'rejected') as CloseOutcome, str(b, 'reason'));
      return done(ctx, { reload: true, toast: { title: 'Recorded', body: `${a.candidate_name}: ${a.outcome}.`, kind: 'info' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.get('/hire/app/:id/hold', (ctx) => {
    const v = view(ctx); const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    requireSeeApplication(app, v.user, a);
    return htmlResponse(holdModal(v, a));
  });
  r.post('/hire/app/:id/hold', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { const a = holdApplication(app, me, ctx.params.id, str(b, 'reason'), str(b, 'until')); return done(ctx, { reload: true, toast: { title: 'On hold', body: `${a.candidate_name} will show in the follow-up list on ${a.hold_until}.`, kind: 'info' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/app/:id/resume', async (ctx) => {
    const me = user(ctx);
    try { resumeApplication(app, me, ctx.params.id); return done(ctx, { reload: true, toast: { title: 'Taken off hold', kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/app/:id/reopen', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { reopenApplication(app, me, ctx.params.id, str(b, 'reason')); return done(ctx, { reload: true, toast: { title: 'Reopened', kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/app/:id/decision', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    const cards = app.db.all<{ interviewer: string; recommendation: string; overall: number | null; round: number }>(
      `SELECT e.full_name AS interviewer, s.recommendation, s.overall, i.round FROM scorecards s JOIN interviews i ON i.id = s.interview_id LEFT JOIN employees e ON e.id = s.interviewer_id
       WHERE i.application_id = ? AND s.submitted_at IS NOT NULL ORDER BY i.round`, [a.id]);
    return htmlResponse(decisionModal(v, { a, cards }));
  });
  r.post('/hire/app/:id/decision', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const outcome = str(b, 'outcome') as 'hire' | 'hold' | 'reject';
    try {
      const a = recordDecision(app, me, ctx.params.id, { outcome, rationale: str(b, 'rationale'), holdUntil: str(b, 'holdUntil') });
      return done(ctx, { reload: true, toast: { title: 'Decision recorded', body: outcome === 'hire' ? `${a.candidate_name} moves to offer.` : outcome === 'hold' ? 'On hold with a follow-up date.' : 'Application closed.', kind: outcome === 'hire' ? 'success' : 'info' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/onboarding/item/:id', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { setOnboardingItem(app, me, Number(ctx.params.id), str(b, 'done') === '1'); return done(ctx, { reload: true }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/app/:id/onboarding/complete', async (ctx) => {
    const me = user(ctx);
    try { const a = completeOnboarding(app, me, ctx.params.id); return done(ctx, { reload: true, confetti: true, toast: { title: 'Onboarding complete', body: `${a.candidate_name} is hired.`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  // ---- Interviews ----
  r.get('/hire/app/:id/schedule', (ctx) => {
    const v = view(ctx); const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    requireSeeApplication(app, v.user, a);
    const roundNo = Number(ctx.query.get('round') || 0);
    const step = roundNo ? planOf(app, a.requisition_id).steps[roundNo - 1] : undefined;
    return htmlResponse(scheduleModal(v, { a, people: listEmployees(app.db, { status: 'active' }), preset: step ? { name: step.name, interviewerId: step.interviewerId } : undefined }));
  });
  r.post('/hire/app/:id/schedule', async (ctx) => {
    const me = user(ctx); const b = await ctx.body() as Record<string, unknown>;
    const panel = Array.isArray(b.panel) ? (b.panel as string[]) : b.panel ? [String(b.panel)] : [];
    try {
      const i = scheduleInterview(app, me, { applicationId: ctx.params.id, roundName: str(b, 'roundName'), roundType: str(b, 'roundType') || 'technical', mode: str(b, 'mode'), location: str(b, 'location'), startsAt: str(b, 'startsAt'), minutes: num(b, 'minutes') || 45, panel, force: !!b.force });
      return done(ctx, { reload: true, toast: { title: 'Interview scheduled', body: `Round ${i.round} with ${(i.panel || []).map((p) => p.name).join(', ')}.`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/interview/:id', (ctx) => {
    const v = view(ctx); const me = v.user;
    const i = getInterview(app, ctx.params.id);
    if (!i) throw new HttpError(404, 'Interview not found.');
    const a = getApplication(app, i.application_id)!;
    requireSeeApplication(app, me, a);
    return htmlResponse(interviewPage(v, {
      i, a, candidate: getCandidate(app, a.candidate_id)!, mine: myScorecard(app, i.id, me.id), onPanel: onPanel(app, i.id, me.id),
      visible: visibleScorecards(app, me, i.id), canRecruit: isRecruiter(app, me),
      submittedBy: scorecardsOf(app, i.id).filter((s) => s.submitted_at).map((s) => s.interviewer_id)
    }));
  });
  r.get('/hire/interview/:id/reschedule', (ctx) => {
    const v = view(ctx); const i = getInterview(app, ctx.params.id);
    if (!i) throw new HttpError(404, 'Interview not found.');
    return htmlResponse(rescheduleModal(v, i));
  });
  r.post('/hire/interview/:id/reschedule', async (ctx) => {
    const me = user(ctx); const b = await ctx.body() as Record<string, unknown>;
    try { rescheduleInterview(app, me, ctx.params.id, str(b, 'startsAt'), num(b, 'minutes') || 45, str(b, 'reason'), !!b.force); return done(ctx, { reload: true, toast: { title: 'Interview moved', kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/interview/:id/status', async (ctx) => {
    const me = user(ctx); if (!isRecruiter(app, me)) return fail(ctx, 403, 'Only HR changes an interview status.');
    const b = await ctx.body();
    const s = str(b, 'status');
    if (!['completed', 'cancelled', 'no_show'].includes(s)) return fail(ctx, 400, 'Unknown status.');
    setInterviewStatus(app, me, ctx.params.id, s as 'completed', str(b, 'note'));
    return done(ctx, { reload: true, toast: { title: 'Updated', body: s === 'completed' ? 'The panel has been asked for scorecards.' : '', kind: 'success' } });
  });
  r.post('/hire/interview/:id/scorecard', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const ratings: Record<string, number> = {};
    for (const a of SCORE_AREAS) { const n = num(b, `r_${a.key}`); if (n != null) ratings[a.key] = n; }
    try {
      const s = saveScorecard(app, me, ctx.params.id, { ratings, recommendation: str(b, 'recommendation'), notes: str(b, 'notes'), evidence: str(b, 'evidence'), submit: str(b, 'submit') === '1' });
      return done(ctx, { reload: true, toast: { title: s.submitted_at ? 'Scorecard submitted' : 'Draft saved', body: s.submitted_at ? 'You can see the others once everyone is in.' : '', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/interview/:id/calibrate', async (ctx) => {
    const me = user(ctx);
    try { calibrate(app, me, ctx.params.id); return done(ctx, { reload: true, toast: { title: 'Scorecards opened', kind: 'info' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  // ---- Offers ----
  r.get('/hire/app/:id/offer', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    return htmlResponse(offerModal(v, { a, req: getRequisition(app, a.requisition_id)!, candidate: getCandidate(app, a.candidate_id)! }));
  });
  r.post('/hire/app/:id/offer', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try {
      draftOffer(app, me, { applicationId: ctx.params.id, ctcAnnual: num(b, 'ctcAnnual') || 0, designation: str(b, 'designation'), joiningDate: str(b, 'joiningDate'), expiryDate: str(b, 'expiryDate'), body: str(b, 'body') });
      return done(ctx, { reload: true, toast: { title: 'Offer drafted', body: 'Nothing has been sent. Check it, then issue it yourself.', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/offer/:id/cancel', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { cancelOffer(app, me, ctx.params.id, str(b, 'reason')); return done(ctx, { reload: true, toast: { title: 'Offer cancelled', kind: 'info' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/offer/:id/issue', async (ctx) => {
    const me = user(ctx);
    try { const o = issueOffer(app, me, ctx.params.id); return done(ctx, { reload: true, confetti: true, toast: { title: 'Offer issued', body: `${o.candidate_name} · ${o.designation}`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/hire/offer/:id/response', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const resp = str(b, 'response') === 'accepted' ? 'accepted' : 'declined';
    try {
      const { offer } = recordOfferResponse(app, me, ctx.params.id, resp, str(b, 'note'));
      return done(ctx, { reload: true, confetti: resp === 'accepted', toast: { title: resp === 'accepted' ? 'Offer accepted' : 'Offer declined', body: resp === 'accepted' ? `Onboarding has started for ${offer.candidate_name || 'the candidate'}.` : offer.candidate_name || '', kind: resp === 'accepted' ? 'success' : 'warn' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/offer/:id/onboard', (ctx) => {
    const v = view(ctx); requireRecruiter(app, v.user);
    const o = getOffer(app, ctx.params.id);
    if (!o) throw new HttpError(404, 'Offer not found.');
    return htmlResponse(onboardModal(v, { offer: o, suggestedId: nextEmployeeId(app), managers: listEmployees(app.db, { status: 'active' }).filter((e) => e.functional_role !== 'ic'),
      sites: app.db.all('SELECT id, name FROM sites ORDER BY name'), shifts: getSetting(app.db, 'shifts').map((x) => ({ code: x.code, name: `${x.name} (${x.start}–${x.end})` })) }));
  });
  r.post('/hire/offer/:id/onboard', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try {
      const res = onboardFromOffer(app, me, ctx.params.id, { employeeId: str(b, 'employeeId'), email: str(b, 'email'), reportingManagerId: str(b, 'reportingManagerId'), shiftCode: str(b, 'shiftCode'), siteId: str(b, 'siteId') });
      return done(ctx, { reload: true, toast: { title: 'Employee created', body: `${res.employeeId} is on probation. Set their salary in Payroll.`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  void canSeeApplication; void getEmployee;
}
