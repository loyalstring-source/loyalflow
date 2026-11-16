import { can } from '../lib/scope.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import { type Employee } from '../modules/people/model.ts';
import { listCycles, getCycle, createCycle, openCycle, listAppraisals, getAppraisal, myAppraisals, submitSelf, submitManager, moderate, applyIncrement, decideProbation, generateProbationReviews } from '../modules/hr/appraisal.ts';
import { currentStructure } from '../modules/hr/payroll.ts';
import { appraisalsPage, cycleModal, appraisalPage } from '../ui/pages/appraisal.ts';
import { localDateString } from '../lib/time.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

/** HR and Accounts run appraisals; HODs and executives moderate. */
function isHr(app: App, e: Employee): boolean { return can(app.db, e, 'appraisals.manage'); }
function canModerate(app: App, e: Employee, a: { employee_id: string }): boolean {
  if (a.employee_id === e.id) return false;
  return e.functional_role === 'hod' || e.functional_role === 'executive' || e.is_admin === 1;
}
function nextMonthStart(now = new Date()): string {
  return `${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 8)}01`;
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/appraisals', (ctx) => {
    const v = view(ctx); const me = v.user; const hr = isHr(app, me);
    const cycles = listCycles(app);
    const wanted = ctx.query.get('cycle');
    const cycle = (wanted ? cycles.find((c) => c.id === wanted) : cycles.find((c) => c.status === 'open')) || cycles[0] || null;
    return htmlResponse(appraisalsPage(v, {
      cycles, cycle,
      rows: hr && cycle ? listAppraisals(app, { cycleId: cycle.id, limit: 500 }) : [],
      mine: myAppraisals(app, me.id),
      forMe: listAppraisals(app, { managerId: me.id, limit: 200 }).filter((a) => a.employee_id !== me.id),
      probation: hr ? listAppraisals(app, { kind: 'probation', limit: 200 }) : [],
      canManage: hr, canModerate: me.functional_role === 'hod' || me.functional_role === 'executive',
      tab: ctx.query.get('tab') || (hr ? 'all' : 'mine')
    }));
  });

  r.get('/appraisals/cycles/new', (ctx) => {
    const v = view(ctx);
    if (!isHr(app, v.user)) throw new HttpError(403, 'Only HR can create an appraisal cycle.');
    const y = new Date().getUTCFullYear();
    const fyStart = new Date().getUTCMonth() + 1 >= 4 ? y : y - 1;
    return htmlResponse(cycleModal(v, {
      name: `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)} annual review`,
      from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31`,
      selfDue: localDateString(new Date(Date.now() + 10 * 86_400_000)), managerDue: localDateString(new Date(Date.now() + 24 * 86_400_000))
    }));
  });

  r.post('/appraisals/cycles', async (ctx) => {
    const me = user(ctx); if (!isHr(app, me)) return fail(ctx, 403, 'Only HR can create an appraisal cycle.');
    const b = await ctx.body();
    try {
      const c = createCycle(app, me, { name: str(b, 'name'), periodFrom: str(b, 'periodFrom'), periodTo: str(b, 'periodTo'), selfDue: str(b, 'selfDue'), managerDue: str(b, 'managerDue') });
      return done(ctx, { reload: true, toast: { title: 'Cycle created', body: `${c.name} is a draft. Open it when you are ready.`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.post('/appraisals/cycles/:id/open', async (ctx) => {
    const me = user(ctx); if (!isHr(app, me)) return fail(ctx, 403, 'Only HR can open a cycle.');
    try {
      const res = openCycle(app, me, ctx.params.id);
      return done(ctx, { reload: true, confetti: true, toast: { title: `${res.created} reviews opened`, body: res.skipped.length ? `${res.skipped.length} skipped (joined too recently).` : 'Everyone has been asked for a self review.', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  r.post('/appraisals/probation-scan', async (ctx) => {
    const me = user(ctx); if (!isHr(app, me)) return fail(ctx, 403, 'Only HR can run this.');
    const made = generateProbationReviews(app);
    return done(ctx, { reload: true, toast: { title: made ? `${made} probation reviews created` : 'Nothing due', body: made ? 'Managers have been notified.' : 'No probation ends in the next three weeks.', kind: made ? 'success' : 'info' } });
  });

  r.get('/appraisals/:id', (ctx) => {
    const v = view(ctx); const me = v.user;
    const a = getAppraisal(app, ctx.params.id);
    if (!a) throw new HttpError(404, 'Appraisal not found.');
    const hr = isHr(app, me);
    const mod = canModerate(app, me, a);
    if (a.employee_id !== me.id && a.manager_id !== me.id && !hr && !mod) throw new HttpError(403, 'This appraisal is not yours to read.');
    const st = currentStructure(app, a.employee_id);
    return htmlResponse(appraisalPage(v, {
      a, canSelf: a.status === 'self' && a.employee_id === me.id,
      canManager: a.status === 'manager' && (a.manager_id === me.id || (hr && me.functional_role === 'executive')),
      canModerate: mod, canApplyIncrement: hr && a.status === 'approved' && !!a.increment_pct,
      ctc: st?.ctc_annual ?? null, nextMonthStart: nextMonthStart()
    }));
  });

  const act = (path: string, fn: (me: Employee, id: string, b: Record<string, unknown>) => { title: string; body: string }) =>
    r.post(path, async (ctx) => {
      const me = user(ctx); const b = await ctx.body();
      try { const t = fn(me, ctx.params.id, b as Record<string, unknown>); return done(ctx, { reload: true, toast: { title: t.title, body: t.body, kind: 'success' } }); }
      catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
    });

  act('/appraisals/:id/self', (me, id, b) => { const a = submitSelf(app, me, id, { review: str(b, 'review'), rating: num(b, 'rating') || 0 }); return { title: 'Self review submitted', body: `${a.manager_name || 'Your manager'} will review it next.` }; });
  act('/appraisals/:id/manager', (me, id, b) => { const a = submitManager(app, me, id, { review: str(b, 'review'), rating: num(b, 'rating') || 0 }); return { title: 'Review submitted', body: `${a.employee_name} now goes to HOD moderation.` }; });
  act('/appraisals/:id/moderate', (me, id, b) => { const a = moderate(app, me, id, { finalRating: num(b, 'finalRating') || 0, incrementPct: num(b, 'incrementPct') ?? 0, decision: str(b, 'decision') }); return { title: 'Sent to the COO', body: `${a.employee_name}: ${a.final_rating}/5 and ${a.increment_pct}%.` }; });
  act('/appraisals/:id/probation', (me, id, b) => { const a = decideProbation(app, me, id, { outcome: str(b, 'outcome'), review: str(b, 'review'), rating: num(b, 'rating') || 0, extendTo: str(b, 'extendTo') }); return { title: 'Decision recorded', body: `${a.employee_name}: ${a.decision}.` }; });
  act('/appraisals/:id/apply', (me, id, b) => {
    if (!isHr(app, me)) throw new HttpError(403, 'Only HR can write a new salary.');
    const res = applyIncrement(app, me, id, str(b, 'effectiveFrom'));
    return { title: 'New salary saved', body: `CTC ₹${res.oldCtc.toLocaleString('en-IN')} → ₹${res.newCtc.toLocaleString('en-IN')} a year.` };
  });

  void getCycle;
}
