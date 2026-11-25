// Company overview, monthly targets, and administrators.
import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError, type Response } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listEmployees } from '../modules/people/model.ts';
import { listTasks } from '../modules/tasks/service.ts';
import {
  buildBrief, briefSettings, saveBriefSettings, isCompanyLevel, teamsUserSees, teamsUserSets, measures, targetFor, saveTargets, canSetTargets, departments, listSetters, grantSetter, revokeSetter,
  listAdmins, setAdmin, addMonths, today
} from '../modules/brief/service.ts';
import { briefPage } from '../ui/pages/brief.ts';
import { targetsPage, adminsPage, type TargetRow } from '../ui/pages/targets.ts';
import { done, fail, view, user, str } from './helpers.ts';
import type { View } from '../ui/layout.ts';

/** The overview page for whoever is looking: the whole company, or the teams they lead. */
export function overviewResponse(app: App, v: View, start: string | null): Response {
  if (!teamsUserSees(app, v.user).length) throw new HttpError(403, 'The overview is for people who lead a team.');
  const now = new Date(); const company = isCompanyLevel(v.user);
  return htmlResponse(briefPage(v, {
    brief: buildBrief(app, v.user, now), settings: briefSettings(app), company, canSet: teamsUserSets(app, v.user).length > 0, now,
    approvals: company ? listTasks(app, { assigneeId: v.user.id, kind: 'approval', status: ['open'], limit: 20 }).map((t) => ({ id: t.id, title: t.title, created_at: t.created_at })) : [],
    start: start === 'week' || start === 'month' ? start : 'today'
  }));
}

export function register(r: Router<Employee>, app: App): void {
  const attempt = async (ctx: Parameters<typeof done>[0], fn: (b: Record<string, unknown>) => Parameters<typeof done>[1]) => {
    const b = await ctx.body();
    try { return done(ctx, fn(b)); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  };
  r.get('/overview', (ctx) => overviewResponse(app, view(ctx), ctx.query.get('view')));

  r.get('/targets', (ctx) => {
    const v = view(ctx); const mine = teamsUserSets(app, v.user); const manage = isCompanyLevel(v.user);
    if (!mine.length) throw new HttpError(403, 'Targets are set by team managers and the people an administrator has added.');
    const cur = today().slice(0, 7); const q = ctx.query.get('month') || ''; const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : cur;
    const months = [-3, -2, -1, 0, 1, 2, 3].map((k) => addMonths(cur, k)); if (!months.includes(month)) months.push(month);
    const ids = new Set(mine.map((d) => d.id)); const dept = new Map(departments(app).map((d) => [d.id, d])); const prev = addMonths(month, -1);
    const pastLocked = month < cur && !manage;
    const rows: TargetRow[] = measures(app).filter((m) => ids.has(m.deptId)).map((m) => ({ m, team: dept.get(m.deptId)!.name, head: dept.get(m.deptId)!.head, target: targetFor(app, m, month), last: m.actual(app, `${prev}-01`, `${prev}-31`), editable: !pastLocked && canSetTargets(app, v.user, m.deptId) }));
    return htmlResponse(targetsPage(v, { month, months: months.sort(), rows, canEdit: rows.some((x) => x.editable), pastLocked, manage, setters: manage ? listSetters(app) : [],
      people: manage ? listEmployees(app.db, { status: 'active' }).map((e) => ({ id: e.id, full_name: e.full_name, designation: e.designation })) : [], teams: [...new Map(measures(app).map((m) => [m.deptId, { id: m.deptId, name: dept.get(m.deptId)!.name }])).values()], settings: briefSettings(app) }));
  });
  r.post('/targets/save', (ctx) => attempt(ctx, (b) => { const n = saveTargets(app, user(ctx), str(b, 'month'), b); return { reload: true, toast: { title: n ? `${n} target${n === 1 ? '' : 's'} saved` : 'Nothing changed', kind: n ? 'success' : 'info' } }; }));
  r.post('/targets/access/grant', (ctx) => attempt(ctx, (b) => { grantSetter(app, user(ctx), str(b, 'employeeId'), str(b, 'team')); return { reload: true, toast: { title: 'Added', kind: 'success' } }; }));
  r.post('/targets/access/revoke', (ctx) => attempt(ctx, (b) => { revokeSetter(app, user(ctx), str(b, 'employeeId'), str(b, 'team')); return { reload: true, toast: { title: 'Removed', kind: 'info' } }; }));
  r.post('/targets/display', (ctx) => attempt(ctx, (b) => { saveBriefSettings(app, user(ctx), { seconds: b.seconds, rotate: b.rotate }); return { reload: true, toast: { title: 'Saved', kind: 'success' } }; }));

  r.get('/admins', (ctx) => {
    const v = view(ctx); if (!isCompanyLevel(v.user)) throw new HttpError(403, 'Only an administrator or an executive names administrators.');
    const admins = listAdmins(app); const have = new Set(admins.filter((a) => a.is_admin).map((a) => a.id));
    return htmlResponse(adminsPage(v, { admins, people: listEmployees(app.db, { status: 'active' }).filter((e) => !have.has(e.id)).map((e) => ({ id: e.id, full_name: e.full_name, designation: e.designation })) }));
  });
  r.post('/admins/set', (ctx) => attempt(ctx, (b) => { setAdmin(app, user(ctx), str(b, 'employeeId'), b.on === true || b.on === 'true'); return { reload: true, toast: { title: 'Saved', kind: 'success' } }; }));
}
