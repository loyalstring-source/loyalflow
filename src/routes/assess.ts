import type { App } from '../app.ts';
import { Router, htmlResponse, json, redirect, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { isRecruiter, getApplication, getRequisition, listApplications, listRequisitions } from '../modules/hr/recruiting.ts';
import { attemptByToken, beginAttempt, saveAttempt, submitAttempt, listInvitations, pilotMetrics, canIssue, inviteOne, inviteBatch, invitationsOf, reviewDetail, saveReview } from '../modules/hr/assessment.ts';
import { RUBRIC } from '../modules/hr/assessment-templates.ts';
import { assessmentQueuePage, inviteOneModal, inviteBatchModal, assessmentReviewPage, assessInvalidPage, assessClosedPage, assessIntroPage, assessTestPage } from '../ui/pages/assess.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

/** The candidate's side. No sign-in: the private link is the only key, and it opens this one assessment and nothing else. */
export function registerPublic(r: Router<Employee>, app: App): void {
  const noStore = (res: ReturnType<typeof htmlResponse>) => { res.headers = { ...(res.headers || {}), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }; return res; };
  r.get('/assess/:token', (ctx) => {
    const a = attemptByToken(app, ctx.params.token);
    if (!a) return noStore(htmlResponse(assessInvalidPage(), 404));
    if (a.status === 'invited') return noStore(htmlResponse(assessIntroPage(a, ctx.params.token)));
    if (a.status === 'started') return noStore(htmlResponse(assessTestPage(a, ctx.params.token)));
    return noStore(htmlResponse(assessClosedPage(a)));
  });
  r.post('/assess/:token/begin', (ctx) => {
    try { beginAttempt(app, ctx.params.token); } catch (e) { if (!(e instanceof HttpError)) throw e; }
    return redirect(`/assess/${ctx.params.token}`);
  });
  r.post('/assess/:token/save', async (ctx) => {
    const b = await ctx.body() as Record<string, unknown>;
    try { return json(saveAttempt(app, ctx.params.token, { answers: b.answers, writing: b.writing })); }
    catch (e) { if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status); throw e; }
  });
  r.post('/assess/:token/submit', async (ctx) => {
    const b = await ctx.body() as Record<string, unknown>;
    // A plain form post sends each answer as its own field; the autosave sends them as one object.
    const answers = b.answers && typeof b.answers === 'object' ? b.answers : b;
    try { submitAttempt(app, ctx.params.token, { answers, writing: b.writing }); }
    catch (e) { if (e instanceof HttpError) { if (ctx.wantsJson) return json({ ok: false, error: e.message }, e.status); } else throw e; }
    return ctx.wantsJson ? json({ ok: true }) : redirect(`/assess/${ctx.params.token}`);
  });
}

export function register(r: Router<Employee>, app: App): void {
  const hrOnly = (e: Employee): void => { if (!isRecruiter(app, e)) throw new HttpError(403, 'Assessments are run by HR.'); };

  r.get('/hire/assessments', (ctx) => {
    const v = view(ctx); hrOnly(v.user);
    const requisitionId = ctx.query.get('req') || '', status = ctx.query.get('status') || '', q = (ctx.query.get('q') || '').trim();
    return htmlResponse(assessmentQueuePage(v, {
      rows: listInvitations(app, { requisitionId: requisitionId || undefined, status: status || undefined, q: q || undefined }),
      metrics: pilotMetrics(app, requisitionId || undefined), vacancies: listRequisitions(app, { limit: 100 }).filter((x) => x.status !== 'draft'),
      requisitionId, status, q, issue: canIssue(app), demo: !app.graph.configured
    }));
  });
  r.get('/hire/assessments/:id', (ctx) => {
    const v = view(ctx);
    return htmlResponse(assessmentReviewPage(v, reviewDetail(app, v.user, ctx.params.id)));
  });
  r.post('/hire/assessments/:id/review', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const scores: Record<string, number> = {};
    for (const x of RUBRIC) { const n = num(b, `s_${x.key}`); if (n != null) scores[x.key] = n; }
    try { const inv = saveReview(app, me, ctx.params.id, { scores, outcome: str(b, 'outcome'), note: str(b, 'note') }); return done(ctx, { redirect: '/hire/assessments?status=review', toast: { title: 'Review saved', body: `${inv.candidate_name}: ${inv.review_total} for writing.`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.get('/hire/app/:id/assess', (ctx) => {
    const v = view(ctx); hrOnly(v.user);
    const a = getApplication(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Application not found.');
    return htmlResponse(inviteOneModal(v, { a, live: invitationsOf(app, a.id).find((i) => ['invited', 'started'].includes(i.status)) }));
  });
  r.post('/hire/app/:id/assess', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try {
      const inv = await inviteOne(app, me, ctx.params.id, str(b, 'level'), num(b, 'expiryDays') ?? 0);
      return done(ctx, { reload: true, toast: { title: 'Invitation issued', body: inv.send_state === 'accepted' ? 'Microsoft 365 accepted the email. That is not proof it reached the inbox.' : inv.send_state === 'uncertain' ? 'The email result is uncertain. Check Sent Items before issuing another.' : inv.send_state === 'failed' ? 'The email failed. See the message log on the application.' : 'Nothing was emailed. Use “Get link” on the Assessments page to send it yourself.', kind: inv.send_state === 'accepted' || inv.send_state === 'not_sent' ? 'success' : 'warn' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/hire/req/:id/assess', (ctx) => {
    const v = view(ctx); hrOnly(v.user);
    const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Vacancy not found.');
    const live = new Set(listInvitations(app, { requisitionId: req.id, limit: 2000 }).filter((i) => ['invited', 'started'].includes(i.status)).map((i) => i.application_id));
    return htmlResponse(inviteBatchModal(v, { req, applicants: listApplications(app, { requisitionId: req.id, status: 'active' }).filter((a) => !['offer', 'onboarding', 'hired'].includes(a.stage)).map((a) => ({ ...a, hasLive: live.has(a.id) })) }));
  });
  r.post('/hire/req/:id/assess', async (ctx) => {
    const me = user(ctx); const b = await ctx.body() as Record<string, unknown>;
    const ids = Array.isArray(b.applicationIds) ? (b.applicationIds as unknown[]).map(String) : b.applicationIds ? [String(b.applicationIds)] : [];
    try {
      const res = await inviteBatch(app, me, ctx.params.id, ids, str(b, 'level'), num(b, 'expiryDays') ?? 0);
      const n = (s: string) => res.invitations.filter((i) => i.send_state === s).length;
      return done(ctx, { redirect: `/hire/assessments?req=${ctx.params.id}`, toast: { title: `${res.invitations.length} invitation${res.invitations.length > 1 ? 's' : ''} issued`, body: app.graph.configured ? `${n('accepted')} accepted by Microsoft 365, ${n('uncertain')} uncertain, ${n('failed')} failed.` : 'Nothing was emailed. Use “Get link” on the Assessments page to send it yourself.', kind: n('uncertain') + n('failed') ? 'warn' : 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
}
