// Routes for the second round of hiring features: the public Apply page, time limits and overdue list,
// interview calendar, message templates and messages, duplicate candidates.
import type { App } from '../app.ts';
import { Router, htmlResponse, json, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listEmployees } from '../modules/people/model.ts';
import * as lists from '../lib/lists.ts';
import { isRecruiter, getApplication, getRequisition, getCandidate, getInterview, listRequisitions, listApplications, listInterviews, scheduleInterview, requireSeeApplication, onPanel, type Candidate } from '../modules/hr/recruiting.ts';
import { vacancyByToken, applyPublic, setApplyLink, stageLimits, saveStageLimits, aging, overdue, calendar, schedulable, listTemplates, getTemplate, saveTemplate, deleteTemplate, resetTemplate, compose, sendMessage,
  duplicatePairs, notDuplicates, mergeCandidates, MERGE_FIELDS, LIMIT_STAGES } from '../modules/hr/hire-plus.ts';
import { applyPage, applyThanksPage, applyClosedPage, overduePage, calendarPage, calendarEventDrawer, calendarNewModal, templatesPage, messageModal, duplicatesPage, mergePage } from '../ui/pages/hire-plus.ts';
import { localDateString } from '../lib/time.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

/** The applicant's side. No sign-in: anyone with the vacancy's link can apply to that one vacancy and see nothing else. */
export function registerPublic(r: Router<Employee>, app: App): void {
  const noStore = (res: ReturnType<typeof htmlResponse>) => { res.headers = { ...(res.headers || {}), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }; return res; };
  r.get('/apply/:token', (ctx) => {
    const v = vacancyByToken(app, ctx.params.token);
    if (!v) return noStore(htmlResponse(applyClosedPage('invalid'), 404));
    if (!v.open) return noStore(htmlResponse(applyClosedPage('closed', v.req.title)));
    return noStore(htmlResponse(applyPage({ req: v.req, intro: v.intro, token: ctx.params.token })));
  });
  r.get('/apply/:token/thanks', (ctx) => {
    const v = vacancyByToken(app, ctx.params.token);
    return noStore(htmlResponse(v ? applyThanksPage(v.req.title) : applyClosedPage('invalid'), v ? 200 : 404));
  });
  r.post('/apply/:token', async (ctx) => {
    const b = await ctx.body() as Record<string, unknown>;
    try {
      applyPublic(app, ctx.params.token, { fullName: str(b, 'fullName'), email: str(b, 'email'), phone: str(b, 'phone'), currentEmployer: str(b, 'currentEmployer'), experienceYears: num(b, 'experienceYears'), currentCtc: num(b, 'currentCtc'),
        expectedCtc: num(b, 'expectedCtc'), noticeDays: num(b, 'noticeDays'), location: str(b, 'location'), heardFrom: str(b, 'heardFrom'), consent: b.consent, website: str(b, 'website'), cv: typeof b.cv === 'string' ? b.cv : '', cvName: str(b, 'cvName') }, ctx.ip);
      return done(ctx, { redirect: `/apply/${ctx.params.token}/thanks` });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
}

export function register(r: Router<Employee>, app: App): void {
  const hrOnly = (e: Employee): void => { if (!isRecruiter(app, e)) throw new HttpError(403, 'This part of hiring is run by HR.'); };
  const guard = async <T>(ctx: Parameters<typeof fail>[0], fn: () => T | Promise<T>): Promise<T | ReturnType<typeof fail>> => { try { return await fn(); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } };

  // ---- Apply link ----
  r.post('/hire/req/:id/apply-link', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>;
    const link = setApplyLink(app, user(ctx), ctx.params.id, { enabled: b.enabled === undefined ? undefined : String(b.enabled) === '1', renew: !!b.renew, intro: b.intro === undefined ? undefined : str(b, 'intro') });
    return done(ctx, { reload: true, toast: { title: b.renew ? 'New link made' : b.enabled === undefined ? 'Saved' : link.enabled ? 'Apply link is on' : 'Apply link is off', body: b.renew ? 'The old link no longer works.' : undefined, kind: 'success' } });
  }));

  // ---- Time limits and overdue ----
  r.get('/hire/overdue', (ctx) => {
    const v = view(ctx); const rec = isRecruiter(app, v.user); const all = aging(app, rec ? undefined : v.user);
    if (!rec && !all.length) throw new HttpError(403, 'This list is kept by HR.');
    const stage = ctx.query.get('stage') || '';
    return htmlResponse(overduePage(v, { rows: all.filter((a) => a.over > 0).sort((a, b) => b.over - a.over), all, limits: stageLimits(app), canEdit: rec, stage: (LIMIT_STAGES as readonly string[]).includes(stage) ? stage : '' }));
  });
  r.post('/hire/limits', async (ctx) => guard(ctx, async () => { saveStageLimits(app, user(ctx), await ctx.body() as Record<string, unknown>); return done(ctx, { reload: true, toast: { title: 'Time limits saved', kind: 'success' } }); }));

  // ---- Calendar ----
  r.get('/hire/calendar', (ctx) => {
    const v = view(ctx); const rec = isRecruiter(app, v.user);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('date') || '') ? ctx.query.get('date')! : localDateString(new Date());
    const interviewerId = rec ? ctx.query.get('who') || '' : ''; const requisitionId = ctx.query.get('req') || '';
    const cal = calendar(app, v.user, { view: ctx.query.get('view') || 'week', date, interviewerId, requisitionId });
    if (!rec && !listInterviews(app, { interviewerId: v.user.id, limit: 1 }).length) throw new HttpError(403, 'You will see the calendar when HR puts you on an interview panel.');
    const booked = new Set(app.db.all<{ application_id: string }>("SELECT DISTINCT application_id FROM interviews WHERE status = 'scheduled'").map((x) => x.application_id));
    return htmlResponse(calendarPage(v, { cal, date, interviewerId, requisitionId, canEdit: rec,
      people: rec ? listEmployees(app.db, { status: 'active' }) : [], vacancies: rec ? listRequisitions(app, { status: ['open', 'paused'], limit: 100 }) : [],
      waiting: rec ? schedulable(app).filter((a) => a.stage === 'interview' && !booked.has(a.id)) : [] }));
  });
  r.get('/hire/calendar/interview/:id', (ctx) => {
    const v = view(ctx); const i = getInterview(app, ctx.params.id); if (!i) throw new HttpError(404, 'Interview not found.');
    const rec = isRecruiter(app, v.user); if (!rec && !onPanel(app, i.id, v.user.id)) throw new HttpError(403, 'You are not on this panel.');
    const a = getApplication(app, i.application_id)!; const req = getRequisition(app, a.requisition_id)!;
    return htmlResponse(calendarEventDrawer({ i: { ...i, candidate_name: a.candidate_name, requisition_title: req.title }, canEdit: rec, informed: !!i.candidate_informed }));
  });
  r.get('/hire/calendar/new', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const at = ctx.query.get('at') || '';
    return htmlResponse(calendarNewModal({ apps: schedulable(app), people: listEmployees(app.db, { status: 'active' }), at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? at : '', appId: ctx.query.get('app') || '', types: lists.options('hire.roundTypes') }));
  });
  r.post('/hire/calendar/new', async (ctx) => guard(ctx, async () => {
    const me = user(ctx); hrOnly(me); const b = await ctx.body() as Record<string, unknown>;
    if (!str(b, 'applicationId')) throw new HttpError(400, 'Choose a candidate.');
    const panel = Array.isArray(b.panel) ? (b.panel as string[]) : b.panel ? [String(b.panel)] : [];
    const i = scheduleInterview(app, me, { applicationId: str(b, 'applicationId'), roundName: str(b, 'roundName'), roundType: str(b, 'roundType') || 'technical', mode: str(b, 'mode'), location: str(b, 'location'), startsAt: str(b, 'startsAt'), minutes: num(b, 'minutes') || 45, panel, force: !!b.force });
    return done(ctx, { reload: true, toast: { title: 'Interview booked', body: `Round ${i.round} with ${(i.panel || []).map((p) => p.name).join(', ')}. Remember to tell the candidate.`, kind: 'success' } });
  }));

  // ---- Templates and messages ----
  r.get('/hire/templates', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const list = listTemplates(app); const isNew = ctx.query.get('new') === '1';
    return htmlResponse(templatesPage(v, { templates: list, current: isNew ? null : list.find((t) => t.key === ctx.query.get('t')) || list[0] || null, isNew, mail: app.graph.configured }));
  });
  r.post('/hire/templates', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>; const t = saveTemplate(app, user(ctx), { key: str(b, 'key'), name: str(b, 'name'), subject: str(b, 'subject'), body: str(b, 'body') });
    return done(ctx, { redirect: `/hire/templates?t=${t.key}`, toast: { title: 'Template saved', body: t.name, kind: 'success' } });
  }));
  r.post('/hire/templates/:key/delete', async (ctx) => guard(ctx, () => { deleteTemplate(app, user(ctx), ctx.params.key); return done(ctx, { redirect: '/hire/templates', toast: { title: 'Template deleted', kind: 'info' } }); }));
  r.post('/hire/templates/:key/reset', async (ctx) => guard(ctx, () => { resetTemplate(app, user(ctx), ctx.params.key); return done(ctx, { reload: true, toast: { title: 'Standard wording is back', kind: 'info' } }); }));

  const pickTemplate = (a: { stage: string; status: string }, asked: string): string => {
    if (asked && getTemplate(app, asked)) return asked;
    return a.status === 'on_hold' ? 'on_hold' : a.status === 'closed' ? 'rejection' : a.stage === 'interview' ? 'interview_invite' : a.stage === 'offer' ? 'offer_letter' : a.stage === 'onboarding' ? 'documents' : 'application_received';
  };
  r.get('/hire/app/:id/message', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const a = getApplication(app, ctx.params.id); if (!a) throw new HttpError(404, 'Application not found.');
    const key = pickTemplate(a, ctx.query.get('t') || ''); const interviewId = ctx.query.get('interview') || '';
    const c = compose(app, v.user, a.id, key, interviewId || undefined);
    return htmlResponse(messageModal({ a, templates: listTemplates(app), key, interviewId, interviews: listInterviews(app, { applicationId: a.id }).filter((i) => i.status === 'scheduled'), to: c.to, subject: c.subject, body: c.body, missing: c.missing, mail: app.graph.configured }));
  });
  r.get('/hire/app/:id/compose', (ctx) => {
    const me = user(ctx); hrOnly(me);
    try { const c = compose(app, me, ctx.params.id, ctx.query.get('t') || '', ctx.query.get('interview') || undefined); return json({ ok: true, subject: c.subject, body: c.body, missing: c.missing }); }
    catch (e) { if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status); throw e; }
  });
  r.post('/hire/app/:id/message', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>;
    const res = await sendMessage(app, user(ctx), ctx.params.id, { templateKey: str(b, 'templateKey'), subject: str(b, 'subject'), body: str(b, 'body'), interviewId: str(b, 'interviewId') || undefined });
    if (res.state === 'failed') return fail(ctx, 502, `The email could not be sent: ${res.detail}`);
    return done(ctx, { reload: true, toast: { title: res.state === 'accepted' ? 'Email sent' : res.state === 'manual' ? 'Recorded as sent' : 'Sent, not yet confirmed', body: res.state === 'manual' ? 'It is in the candidate’s message history.' : res.detail, kind: 'success' } });
  }));

  // ---- Duplicates ----
  r.get('/hire/duplicates', (ctx) => { const v = view(ctx); hrOnly(v.user); return htmlResponse(duplicatesPage(v, { pairs: duplicatePairs(app) })); });
  r.get('/hire/duplicates/review', (ctx) => {
    const v = view(ctx); hrOnly(v.user);
    const row = (id: string) => app.db.get<Candidate & { merged_into: string | null; cv_name: string }>('SELECT * FROM candidates WHERE id = ?', [id]);
    let a = row(ctx.query.get('a') || ''), b = row(ctx.query.get('b') || '');
    if (!a || !b || a.id === b.id || a.merged_into || b.merged_into) throw new HttpError(404, 'Those two records cannot be compared. One may already have been merged.');
    if (b.created_at < a.created_at) [a, b] = [b, a];   // the older record first: it is kept unless HR chooses otherwise
    const pair = duplicatePairs(app).find((p) => (p.a.id === a!.id && p.b.id === b!.id) || (p.a.id === b!.id && p.b.id === a!.id));
    return htmlResponse(mergePage(v, { a, b, appsA: listApplications(app, { candidateId: a.id, limit: 50 }), appsB: listApplications(app, { candidateId: b.id, limit: 50 }), why: pair?.why || [] }));
  });
  r.post('/hire/duplicates/merge', async (ctx) => guard(ctx, async () => {
    const body = await ctx.body() as Record<string, unknown>; const a = str(body, 'a'), b = str(body, 'b'); const keep = str(body, 'keep') === b ? b : a; const other = keep === a ? b : a;
    // The form says 'a' or 'b' for each line; the service wants to know whether the kept record's value or the other's wins.
    const side = keep === a ? 'a' : 'b'; const choose: Record<string, string> = {};
    for (const f of [...MERGE_FIELDS.map((x) => String(x.key)), 'cv']) { const pick = str(body, `f_${f}`); if (pick) choose[f] = pick === side ? 'keep' : 'other'; }
    const res = mergeCandidates(app, user(ctx), keep, other, choose); const name = getCandidate(app, keep)?.full_name || keep;
    return done(ctx, { redirect: '/hire/duplicates', toast: { title: 'Records merged', body: `${name}: ${res.moved} application${res.moved === 1 ? '' : 's'} moved${res.closed ? `, ${res.closed} closed as duplicate` : ''}.`, kind: 'success' } });
  }));
  r.post('/hire/duplicates/dismiss', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>; notDuplicates(app, user(ctx), str(b, 'a'), str(b, 'b'));
    return done(ctx, b.back ? { redirect: '/hire/duplicates', toast: { title: 'Kept as two people', kind: 'info' } } : { reload: true, toast: { title: 'Kept as two people', kind: 'info' } });
  }));
}
