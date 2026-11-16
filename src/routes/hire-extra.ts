import type { App } from '../app.ts';
import { Router, htmlResponse, json, file, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listEmployees } from '../modules/people/model.ts';
import { isRecruiter, getApplication, getRequisition, listRequisitions } from '../modules/hr/recruiting.ts';
import { defaultSet, setFor, saveSet, dropOwnSet, saveScreening, planOf, savePlan } from '../modules/hr/screening.ts';
import { aiSettings, saveAiSettings, testAi, uploadCv, saveSummary, cvFile, newBatch, stageCv, commitBatch, MAX_CV_BYTES, type BulkRow } from '../modules/hr/cv.ts';
import { shareLink } from '../modules/hr/assessment.ts';
import { questionsPage, planModal, bulkPage, hireSettingsPage, shareLinkModal } from '../ui/pages/hire-extra.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  const hrOnly = (e: Employee): void => { if (!isRecruiter(app, e)) throw new HttpError(403, 'This part of hiring is run by HR.'); };
  const guard = async <T>(ctx: Parameters<typeof fail>[0], fn: () => T | Promise<T>): Promise<T | ReturnType<typeof fail>> => { try { return await fn(); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } };
  const decode = (b: Record<string, unknown>): { name: string; buf: Buffer } => {
    const name = String(b.name || '').replace(/[\\/]/g, '_').slice(0, 160); const data = String(b.data || '');
    if (!name || !data) throw new HttpError(400, 'Choose a file.');
    if (data.length > MAX_CV_BYTES * 1.4) throw new HttpError(400, `"${name}" is larger than 5 MB.`);
    return { name, buf: Buffer.from(data, 'base64') };
  };

  // ---- Screening questions ----
  const readQuestions = (b: Record<string, unknown>) => {
    const n = Math.min(40, num(b, 'count') ?? 0); const out = [];
    for (let i = 0; i < n; i++) { if (b[`del_${i}`]) continue; out.push({ id: str(b, `id_${i}`), text: str(b, `text_${i}`), guidance: str(b, `guide_${i}`), maxPoints: num(b, `max_${i}`) ?? 3, mustHave: !!b[`must_${i}`] }); }
    return out;
  };
  r.get('/hire/questions', (ctx) => { const v = view(ctx); hrOnly(v.user); return htmlResponse(questionsPage(v, { set: defaultSet(app), req: null, own: true, vacancies: listRequisitions(app, { status: ['open', 'draft', 'paused'], limit: 100 }) })); });
  r.post('/hire/questions', async (ctx) => guard(ctx, async () => { const s = saveSet(app, user(ctx), null, readQuestions(await ctx.body())); return done(ctx, { reload: true, toast: { title: 'Questions saved', body: `Version ${s.version}, ${s.questions.length} questions.`, kind: 'success' } }); }));
  r.get('/hire/req/:id/questions', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Vacancy not found.');
    const s = setFor(app, req.id);
    return htmlResponse(questionsPage(v, { set: s, req, own: s.own, vacancies: [] }));
  });
  r.post('/hire/req/:id/questions', async (ctx) => guard(ctx, async () => { const s = saveSet(app, user(ctx), ctx.params.id, readQuestions(await ctx.body())); return done(ctx, { reload: true, toast: { title: 'Questions saved for this vacancy', body: `Version ${s.version}, ${s.questions.length} questions.`, kind: 'success' } }); }));
  r.post('/hire/req/:id/questions/reset', async (ctx) => guard(ctx, () => { dropOwnSet(app, user(ctx), ctx.params.id); return done(ctx, { reload: true, toast: { title: 'Using the company default questions', kind: 'info' } }); }));
  r.post('/hire/app/:id/screening', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>; const input: Record<string, { points: unknown; note?: unknown }> = {};
    for (const k of Object.keys(b)) if (k.startsWith('p_')) input[k.slice(2)] = { points: b[k], note: b[`n_${k.slice(2)}`] };
    const rev = saveScreening(app, user(ctx), ctx.params.id, input, { useLatest: !!b.useLatest });
    return done(ctx, { reload: true, toast: { title: 'Screening saved', body: `${rev.total} of ${rev.max_total}${rev.must_missed ? ` · ${rev.must_missed} must-have missed` : ''}.`, kind: rev.must_missed ? 'warn' : 'success' } });
  }));

  // ---- Interview plan ----
  r.get('/hire/req/:id/plan', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Vacancy not found.');
    const p = planOf(app, req.id);
    return htmlResponse(planModal(v, { req, steps: p.steps, own: p.own, people: listEmployees(app.db, { status: 'active' }) }));
  });
  r.post('/hire/req/:id/plan', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>; const n = Math.min(20, num(b, 'count') ?? 0); const steps = [];
    for (let i = 0; i < n; i++) steps.push({ name: str(b, `name_${i}`), interviewerId: str(b, `who_${i}`), order: num(b, `order_${i}`) ?? i + 1 });
    const saved = savePlan(app, user(ctx), ctx.params.id, steps);
    return done(ctx, { reload: true, toast: { title: 'Interview plan saved', body: saved.length ? saved.map((s) => s.name).join(' → ') : 'Back to the usual order.', kind: 'success' } });
  }));

  // ---- CV: one candidate ----
  r.post('/hire/candidates/:id/cv', async (ctx) => guard(ctx, async () => {
    const { name, buf } = decode(await ctx.body() as Record<string, unknown>);
    const res = await uploadCv(app, user(ctx), ctx.params.id, name, buf);
    return json({ ok: true, toast: { title: res.source === 'none' ? 'CV saved, but it could not be read' : 'CV saved and read', body: res.note || (res.source === 'ai' ? 'Summary written by AI. Check it against the CV.' : ''), kind: res.source === 'none' ? 'warn' : 'success' } });
  }));
  r.get('/hire/candidates/:id/cv', (ctx) => { const f = cvFile(app, user(ctx), ctx.params.id); const res = file(f.buf, f.name, f.mime, f.mime === 'application/pdf'); res.headers = { ...res.headers, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }; return res; });
  r.post('/hire/candidates/:id/summary', async (ctx) => guard(ctx, async () => { saveSummary(app, user(ctx), ctx.params.id, str(await ctx.body(), 'summary')); return done(ctx, { reload: true, toast: { title: 'Summary saved', kind: 'success' } }); }));

  // ---- CV: bulk for a vacancy ----
  r.get('/hire/req/:id/bulk', (ctx) => {
    const v = view(ctx); hrOnly(v.user); const req = getRequisition(app, ctx.params.id);
    if (!req) throw new HttpError(404, 'Vacancy not found.');
    return htmlResponse(bulkPage(v, { req, batchId: newBatch(app, v.user, req.id), ai: aiSettings(app) }));
  });
  r.post('/hire/req/:id/bulk/file', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>; const { name, buf } = decode(b);
    return json({ ok: true, row: await stageCv(app, user(ctx), ctx.params.id, String(b.batchId || ''), name, buf) });
  }));
  r.post('/hire/req/:id/bulk/commit', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>;
    const rows = Array.isArray(b.rows) ? (b.rows as BulkRow[]) : [];
    return json({ ok: true, ...commitBatch(app, user(ctx), ctx.params.id, String(b.batchId || ''), rows, String(b.source || 'direct')) });
  }));

  // ---- Settings ----
  r.get('/hire/settings', (ctx) => { const v = view(ctx); hrOnly(v.user); return htmlResponse(hireSettingsPage(v, { ai: aiSettings(app) })); });
  r.post('/hire/settings/ai', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>;
    const s = b.clearKey ? saveAiSettings(app, user(ctx), { clearKey: true }) : saveAiSettings(app, user(ctx), { apiKey: str(b, 'apiKey'), model: str(b, 'model'), enabled: !!b.enabled });
    return done(ctx, { reload: true, toast: { title: 'Settings saved', body: s.enabled ? `CVs will be read by ${s.model}. Press Test to check the key.` : s.hasKey ? 'AI reading is off.' : 'No key saved. CVs are read by simple rules.', kind: 'success' } });
  }));
  r.post('/hire/settings/ai/test', async (ctx) => guard(ctx, async () => {
    const res = await testAi(app, user(ctx));
    return res.ok ? done(ctx, { toast: { title: 'Gemini answered', body: `Read the sample CV as “${res.data?.fullName || 'no name'}”. The key and the model work.`, kind: 'success' } }) : fail(ctx, 400, res.error || 'Gemini did not answer.');
  }));

  // ---- The assessment link, shared by hand ----
  r.get('/hire/assessments/:id/link', (ctx) => {
    const v = view(ctx);
    const s = shareLink(app, v.user, ctx.params.id);
    const res = htmlResponse(shareLinkModal(v, s)); res.headers = { ...(res.headers || {}), 'cache-control': 'no-store' }; return res;
  });
  void getApplication;
}
