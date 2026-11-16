import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, listDepartments, getDepartment } from '../modules/people/model.ts';
import { listSops, getSop, saveSop, listInstances, getInstance, completeStep, compliance, startInstance, assigneeFor, stepsOf } from '../modules/sops/service.ts';
import type { SopStep } from '../db/seed-master.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { localDateString, addDays } from '../lib/time.ts';
import { sopsPage, sopEditorPage, sopRunPage, type SopsData } from '../ui/pages/sops.ts';
import { done, fail, view, user, str, bool } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  r.get('/sops', (ctx) => {
    const v = view(ctx); const me = v.user; const now = new Date();
    const scope = scopeFor(app.db, me);
    const ids = [...scope.people];
    const today = localDateString(now);
    const canManage = can(app.db, me, 'sops.manage');
    const tab = ['today', 'overdue', 'library', 'people'].includes(ctx.query.get('tab') || '') ? ctx.query.get('tab')! : (ctx.query.get('filter') === 'overdue' ? 'overdue' : 'today');
    const todayRuns = listInstances(app, { assigneeIds: ids, date: today, limit: 300 });
    const overdue = listInstances(app, { assigneeIds: ids, status: 'open', from: localDateString(addDays(now, -14)), to: today, limit: 300 }).filter((i) => i.due_at < now.toISOString());
    const from7 = localDateString(addDays(now, -7)), from30 = localDateString(addDays(now, -30));
    const library: SopsData['library'] = listSops(app, false).map((s) => ({ ...s, stepCount: stepsOf(s).length, c7: compliance(app, { departmentId: s.department_id || undefined, from: from7, to: today }).pct, c30: compliance(app, { departmentId: s.department_id || undefined, from: from30, to: today }).pct }))
      .filter((s) => canManage || s.department_id === me.department_id);
    const byPerson: SopsData['byPerson'] = canManage ? listEmployees(app.db, { status: 'active' }).filter((e) => scope.people.has(e.id)).map((e) => { const c = compliance(app, { assigneeIds: [e.id], from: from30, to: today }); return { emp: e, done: c.onTime, total: c.total, pct: c.pct }; }).filter((p) => p.total > 0).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)) : [];
    const overall7 = compliance(app, { assigneeIds: ids, from: from7, to: today }).pct;
    const d: SopsData = { now, tab, today: todayRuns, overdue, library, byPerson, canManage, overall7, filter: ctx.query.get('filter') || '' };
    return htmlResponse(sopsPage(v, d));
  });

  r.get('/sops/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'sops.manage'); return htmlResponse(sopEditorPage(v, { sop: null, departments: listDepartments(app.db) })); });
  r.get('/sops/:id/edit', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'sops.manage'); const sop = getSop(app, ctx.params.id); if (!sop) throw new HttpError(404, 'SOP not found'); return htmlResponse(sopEditorPage(v, { sop, departments: listDepartments(app.db) })); });

  const save = async (ctx: Parameters<typeof user>[0], id?: string) => {
    const me = user(ctx); requireCan(app.db, me, 'sops.manage');
    const b = await ctx.body();
    const titles: string[] = Array.isArray(b.step_title) ? b.step_title : b.step_title ? [b.step_title] : [];
    const keys: string[] = Array.isArray(b.step_key) ? b.step_key : b.step_key ? [b.step_key] : [];
    const evidence: string[] = Array.isArray(b.step_evidence) ? b.step_evidence : b.step_evidence ? [b.step_evidence] : [];
    const dues: string[] = Array.isArray(b.step_due) ? b.step_due : b.step_due ? [b.step_due] : [];
    const steps: SopStep[] = [];
    titles.forEach((title, i) => {
      if (!String(title).trim()) return;
      const key = String(keys[i] || '').trim() || String(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) + '_' + (i + 1);
      steps.push({ key, title: String(title).trim(), evidence: (['none', 'note', 'call', 'file', 'record'].includes(String(evidence[i])) ? String(evidence[i]) : 'none') as SopStep['evidence'], dueOffsetMin: Math.max(0, Number(dues[i]) || 0) });
    });
    try {
      const sop = saveSop(app, me, { id, name: str(b, 'name'), departmentId: str(b, 'departmentId') || me.department_id, ownerRole: str(b, 'ownerRole') || 'team_lead', trigger: str(b, 'trigger') || 'daily', triggerDetail: str(b, 'triggerDetail'), steps });
      return ctx.wantsJson ? done(ctx, { redirect: '/sops?tab=library', toast: { title: 'SOP saved', body: `${sop.name} v${sop.version}`, kind: 'success' } }) : redirect('/sops?tab=library');
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  };
  r.post('/sops', (ctx) => save(ctx));
  r.post('/sops/:id', (ctx) => save(ctx, ctx.params.id));

  r.post('/sops/:id/start', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'sops.manage');
    const sop = getSop(app, ctx.params.id); if (!sop) return fail(ctx, 404, 'SOP not found');
    const b = await ctx.body();
    const dept = sop.department_id ? getDepartment(app.db, sop.department_id) : undefined;
    const inst = startInstance(app, sop, new Date(), str(b, 'assigneeId') || assigneeFor(app, sop), dept?.shift_code || 'GEN');
    if (!inst) return fail(ctx, 400, 'This SOP already has a checklist today for that person.');
    if (inst.assignee_id && inst.assignee_id !== me.id) app.notify.send({ employeeId: inst.assignee_id, title: `Checklist started: ${sop.name}`, body: `${stepsOf(sop).length} steps`, link: `/sop-runs/${inst.id}`, kind: 'info' });
    return done(ctx, { redirect: `/sop-runs/${inst.id}`, toast: { title: 'Checklist started', kind: 'success' } });
  });

  r.get('/sop-runs/:id', (ctx) => { const v = view(ctx); const inst = getInstance(app, ctx.params.id); if (!inst) throw new HttpError(404, 'Checklist not found'); return htmlResponse(sopRunPage(v, inst, new Date())); });

  r.post('/sop-runs/:id/steps/:key', async (ctx) => {
    const me = user(ctx);
    const inst = getInstance(app, ctx.params.id); if (!inst) return fail(ctx, 404, 'Checklist not found');
    if (inst.assignee_id !== me.id && !can(app.db, me, 'sops.manage')) return fail(ctx, 403, 'This checklist belongs to someone else.');
    const b = await ctx.body();
    try {
      const updated = completeStep(app, me, inst.id, ctx.params.key, str(b, 'evidence'), b.done === undefined ? true : bool(b, 'done'));
      const all = updated.status === 'complete';
      return done(ctx, { reload: true, confetti: all, toast: all ? { title: 'Checklist complete! 🎉', body: `${updated.sop_name} is done for today.`, kind: 'success' } : { title: bool(b, 'done') || b.done === undefined ? 'Step done' : 'Step reopened', kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
}
