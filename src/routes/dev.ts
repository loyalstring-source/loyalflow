import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getDepartment } from '../modules/people/model.ts';
import { listDevIssues, getDevIssue, createDevIssue, setDevStatus, listTickets, PRIORITIES, DEV_STATUSES, ISSUE_TYPES, type Priority, type DevStatus, type IssueType } from '../modules/desk/service.ts';
import { listProjects, getProject, saveProject, listSprints, getSprint, currentSprint, ensureSprint, startSprint, closeSprint, planIssue, burndown, listReleases, getRelease, saveRelease, addToRelease, signRelease, shipRelease, releaseNotes, comments, addComment, checks, addCheck, setCheck, deleteCheck, updateIssue, devMetrics } from '../modules/dev/service.ts';
import { listCustomers } from '../modules/sales/service.ts';
import { timeFor, runningTimer } from '../modules/ops/service.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { localDateString, addDays, weekStart } from '../lib/time.ts';
import { devBoardPage, issueDrawer, issuePage, newIssueModal, planningPage, sprintPage, projectsPage, projectPage, projectModal, releasesPage, releasePage, releaseModal, metricsPage, type IssueDetail } from '../ui/pages/dev.ts';
import { done, fail, view, user, str, num, bool, render } from './helpers.ts';

function devs(app: App): Employee[] { return listEmployees(app.db, { status: 'active' }).filter((e) => ['DEV', 'QA'].includes(getDepartment(app.db, e.department_id)?.code || '')); }
function isQa(app: App, e: Employee): boolean { return getDepartment(app.db, e.department_id)?.code === 'QA'; }
function isDevHod(app: App, e: Employee): boolean { return getDepartment(app.db, 'DEV')?.hod_id === e.id || e.functional_role === 'executive'; }

export function register(r: Router<Employee>, app: App): void {
  r.get('/dev', (ctx) => {
    const v = view(ctx); const q = ctx.query; const now = new Date();
    const sprint = currentSprint(app, now);
    const filter = { project: q.get('project') || '', assignee: q.get('assignee') || '', type: q.get('type') || '', mine: q.get('mine') === '1', q: q.get('q') || '', sprint: q.get('sprint') || '' };
    let issues = listDevIssues(app, { projectId: filter.project || undefined, assigneeId: filter.mine ? v.user.id : filter.assignee || undefined, type: filter.type || undefined, q: filter.q || undefined });
    if (filter.sprint && filter.sprint !== 'all') issues = issues.filter((i) => i.sprint_id === filter.sprint);
    else if (!filter.sprint && sprint) issues = issues.filter((i) => !i.sprint_id || i.sprint_id === sprint.id || i.status === 'released');
    const all = listDevIssues(app);
    const stats = { open: all.filter((i) => i.status !== 'released').length, blocked: all.filter((i) => i.blocked && i.status !== 'released').length, bugs: all.filter((i) => i.type === 'bug' && i.status !== 'released').length, inQa: all.filter((i) => i.status === 'in_qa').length };
    return htmlResponse(devBoardPage(v, { issues, sprint, sprints: listSprints(app, 8), projects: listProjects(app), filter, people: devs(app), canWrite: can(app.db, v.user, 'dev.write'), canManage: can(app.db, v.user, 'desk.manage') && ['DEV', 'QA', 'LEAD'].includes(v.deptCode) || v.user.functional_role === 'executive', stats, tab: 'board', now }));
  });
  r.get('/dev/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'dev.write'); return htmlResponse(newIssueModal(v, { devs: devs(app), projects: listProjects(app), sprints: listSprints(app, 6), customers: listCustomers(app), sprint: currentSprint(app), projectId: ctx.query.get('project') || undefined })); });
  r.post('/dev', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'dev.write');
    const b = await ctx.body();
    try {
      const i = createDevIssue(app, me, { title: str(b, 'title'), description: str(b, 'description'), priority: str(b, 'priority') as Priority, type: str(b, 'type'), projectId: str(b, 'projectId') || null, sprintId: str(b, 'sprintId') || null, assigneeId: str(b, 'assigneeId') || null, points: num(b, 'points'), estimateHours: num(b, 'estimateHours'), component: str(b, 'component'), acceptance: str(b, 'acceptance'), customerId: str(b, 'customerId') || null, dueDate: str(b, 'dueDate') || null });
      return done(ctx, { reload: true, toast: { title: `${i.id} created`, body: i.title, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  // Planning and sprints
  r.get('/dev/planning', (ctx) => {
    const v = view(ctx); const now = new Date();
    const sprint = currentSprint(app, now);
    const next = ensureSprint(app, addDays(weekStart(now), 7));
    const canManage = can(app.db, v.user, 'desk.manage') && ['DEV', 'QA', 'LEAD'].includes(v.deptCode) || v.user.functional_role === 'executive';
    const team = devs(app).length;
    return htmlResponse(planningPage(v, { backlog: listDevIssues(app, { sprintId: null }).filter((i) => i.status !== 'released'), sprint, sprintIssues: sprint ? listDevIssues(app, { sprintId: sprint.id, includeReleased: true }) : [], next, nextIssues: listDevIssues(app, { sprintId: next.id, includeReleased: true }), canManage, capacityHint: `${team} developers and testers · one-week sprints Mon–Fri · a sensible commitment is what the team released in the last two weeks` }));
  });
  r.post('/dev/sprints/ensure', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'desk.manage'); const b = await ctx.body(); const s = ensureSprint(app, weekStart(addDays(new Date(), 7 * (num(b, 'weeks') ?? 1)))); return done(ctx, { redirect: `/dev/sprints/${s.id}` }); });
  r.get('/dev/sprints/:id', (ctx) => {
    const v = view(ctx); const s = getSprint(app, ctx.params.id); if (!s) throw new HttpError(404, 'Sprint not found');
    const issues = listDevIssues(app, { sprintId: s.id, includeReleased: true });
    const byMap = new Map<string, { name: string; total: number; done: number; points: number }>();
    for (const i of issues) { const k = i.assignee_name || 'Unassigned'; const e = byMap.get(k) || { name: k, total: 0, done: 0, points: 0 }; e.total++; if (['ready', 'released'].includes(i.status)) { e.done++; e.points += i.points || 0; } byMap.set(k, e); }
    return htmlResponse(sprintPage(v, { sprint: s, issues, burndown: burndown(app, s), canManage: can(app.db, v.user, 'desk.manage') && ['DEV', 'QA', 'LEAD'].includes(v.deptCode) || v.user.functional_role === 'executive', byPerson: [...byMap.values()] }));
  });
  r.post('/dev/sprints/:id/start', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'desk.manage'); const b = await ctx.body(); const s = startSprint(app, me, ctx.params.id, str(b, 'goal') || undefined); return done(ctx, { reload: true, toast: { title: `${s.name} started`, body: `${s.committed_count} issues committed`, kind: 'success' } }); });
  r.post('/dev/sprints/:id/close', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'desk.manage'); const { carried } = closeSprint(app, me, ctx.params.id); return done(ctx, { reload: true, confetti: carried === 0, toast: { title: 'Sprint closed', body: carried ? `${carried} issue${carried === 1 ? '' : 's'} carried over.` : 'Everything delivered. 🎉', kind: carried ? 'warn' : 'success' } }); });
  r.post('/dev/:id/plan', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'desk.manage'); const b = await ctx.body(); const sid = b.sprintId === null || str(b, 'sprintId') === '' ? null : str(b, 'sprintId'); const i = planIssue(app, me, ctx.params.id, sid); return done(ctx, { reload: true, toast: { title: sid ? `${i.id} planned into ${i.sprint_name}` : `${i.id} back to backlog`, kind: 'success' } }); });

  // Projects
  r.get('/dev/projects', (ctx) => { const v = view(ctx); const all = ctx.query.get('all') === '1'; return htmlResponse(projectsPage(v, { projects: listProjects(app, { all }), canManage: can(app.db, v.user, 'dev.write'), showAll: all })); });
  r.get('/dev/projects/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'dev.write'); return htmlResponse(projectModal(v, { p: null, people: listEmployees(app.db, { status: 'active' }), customers: listCustomers(app) })); });
  r.get('/dev/projects/:id/edit', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'dev.write'); const p = getProject(app, ctx.params.id); if (!p) throw new HttpError(404, 'Project not found'); return htmlResponse(projectModal(v, { p, people: listEmployees(app.db, { status: 'active' }), customers: listCustomers(app) })); });
  r.get('/dev/projects/:id', (ctx) => {
    const v = view(ctx); const p = getProject(app, ctx.params.id); if (!p) throw new HttpError(404, 'Project not found');
    const issues = listDevIssues(app, { projectId: p.id, includeReleased: true });
    const hours = app.db.get<{ m: number }>(`SELECT COALESCE(SUM(t.minutes),0) AS m FROM time_logs t JOIN dev_issues d ON d.id = t.entity_id WHERE t.entity_type = 'issue' AND d.project_id = ? AND t.ended_at IS NOT NULL`, [p.id])?.m || 0;
    return htmlResponse(projectPage(v, { p, issues, releases: listReleases(app).filter((x) => x.project_id === p.id), canManage: can(app.db, v.user, 'dev.write'), canWrite: can(app.db, v.user, 'dev.write'), hours }));
  });
  const saveProj = async (ctx: Parameters<typeof user>[0], id?: string) => {
    const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body();
    try { const p = saveProject(app, me, { id, name: str(b, 'name'), description: str(b, 'description'), kind: str(b, 'kind'), status: str(b, 'status'), ownerId: str(b, 'ownerId') || null, customerId: str(b, 'customerId') || null, startDate: str(b, 'startDate') || null, targetDate: str(b, 'targetDate') || null, notes: str(b, 'notes') }); return done(ctx, { redirect: `/dev/projects/${p.id}`, toast: { title: `${p.name} saved`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  };
  r.post('/dev/projects', (ctx) => saveProj(ctx));
  r.post('/dev/projects/:id', (ctx) => saveProj(ctx, ctx.params.id));

  // Releases
  r.get('/dev/releases', (ctx) => { const v = view(ctx); return htmlResponse(releasesPage(v, { releases: listReleases(app), canManage: can(app.db, v.user, 'dev.write') })); });
  r.get('/dev/releases/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'dev.write'); return htmlResponse(releaseModal(v, { r: null, projects: listProjects(app) })); });
  r.get('/dev/releases/:id', (ctx) => { const v = view(ctx); const rel = getRelease(app, ctx.params.id); if (!rel) throw new HttpError(404, 'Release not found'); return htmlResponse(releasePage(v, { r: rel, issues: listDevIssues(app, { releaseId: rel.id, includeReleased: true }), notes: releaseNotes(app, rel.id), canManage: can(app.db, v.user, 'dev.write'), isQa: isQa(app, v.user), isHod: isDevHod(app, v.user) })); });
  const saveRel = async (ctx: Parameters<typeof user>[0], id?: string) => { const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body(); try { const rel = saveRelease(app, me, { id, version: str(b, 'version'), name: str(b, 'name'), projectId: str(b, 'projectId') || null, plannedDate: str(b, 'plannedDate') || null, notes: str(b, 'notes') }); return done(ctx, { redirect: `/dev/releases/${rel.id}`, toast: { title: `Release ${rel.version} saved`, kind: 'success' } }); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } };
  r.post('/dev/releases', (ctx) => saveRel(ctx));
  r.post('/dev/releases/:id', (ctx) => saveRel(ctx, ctx.params.id));
  r.post('/dev/releases/:id/sign', async (ctx) => { const me = user(ctx); const b = await ctx.body(); try { const rel = signRelease(app, me, ctx.params.id, str(b, 'role') === 'hod' ? 'hod' : 'qa'); return done(ctx, { reload: true, toast: { title: rel.status === 'approved' ? 'Approved by HOD' : 'QA signed off', kind: 'success' } }); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } });
  r.post('/dev/releases/:id/ship', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'dev.write'); try { const { release } = shipRelease(app, me, ctx.params.id); return done(ctx, { reload: true, confetti: true, toast: { title: `${release.version} shipped 🚀`, body: 'Linked tickets are back with support; CEO and COO notified.', kind: 'success' } }); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } });
  r.post('/dev/:id/release', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body(); addToRelease(app, me, ctx.params.id, str(b, 'releaseId') || null); return done(ctx, { reload: true, toast: { title: 'Release updated', kind: 'success' } }); });

  // Metrics
  r.get('/dev/metrics', (ctx) => {
    const v = view(ctx);
    const scope = scopeFor(app.db, v.user);
    const now = new Date();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('from') || '') ? ctx.query.get('from')! : localDateString(addDays(weekStart(now), -28));
    const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('to') || '') ? ctx.query.get('to')! : localDateString(now);
    const people = scope.level === 'self' ? [v.user.id] : undefined;
    return htmlResponse(metricsPage(v, { m: devMetrics(app, from, to, people), from, to, people: devs(app) }));
  });

  // Issue detail and actions
  r.get('/dev/:id', (ctx) => {
    const v = view(ctx); const i = getDevIssue(app, ctx.params.id); if (!i) throw new HttpError(404, 'Issue not found');
    const t = timeFor(app, 'issue', i.id);
    const d: IssueDetail = { i, comments: comments(app, i.id), checks: checks(app, i.id), linked: listTickets(app, { limit: 2000 }).filter((x) => x.dev_issue_id === i.id), people: devs(app), projects: listProjects(app), sprints: listSprints(app, 6), releases: listReleases(app), customers: listCustomers(app), canWrite: can(app.db, v.user, 'dev.write'), canManage: can(app.db, v.user, 'desk.manage') && ['DEV', 'QA', 'LEAD'].includes(v.deptCode) || v.user.functional_role === 'executive', isQa: isQa(app, v.user), time: { logs: t.logs, minutes: t.minutes, running: runningTimer(app, v.user.id) }, now: new Date() };
    return render(ctx, () => issuePage(v, d), () => issueDrawer(v, d));
  });
  r.post('/dev/:id/status', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body();
    const s = str(b, 'status') as DevStatus; if (!DEV_STATUSES.includes(s)) return fail(ctx, 400, 'Unknown status');
    try { const i = setDevStatus(app, me, ctx.params.id, s); return done(ctx, { reload: true, confetti: i.status === 'released', toast: { title: `${i.id} → ${s.replace('_', ' ')}`, body: i.status === 'released' ? 'Linked tickets are back with support.' : undefined, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/dev/:id/update', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body();
    try {
      const i = updateIssue(app, me, ctx.params.id, { title: str(b, 'title') || undefined, description: str(b, 'description'), acceptance: str(b, 'acceptance'), type: ISSUE_TYPES.includes(str(b, 'type') as IssueType) ? str(b, 'type') as IssueType : undefined, priority: PRIORITIES.includes(str(b, 'priority') as Priority) ? str(b, 'priority') as Priority : undefined, project_id: str(b, 'project_id') || null, points: num(b, 'points'), estimate_hours: num(b, 'estimate_hours'), component: str(b, 'component'), assignee_id: str(b, 'assignee_id') || null, customer_id: str(b, 'customer_id') || null, due_date: str(b, 'due_date') || null });
      return done(ctx, { reload: true, toast: { title: `${i.id} saved`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/dev/:id/block', async (ctx) => { const me = user(ctx); requireCan(app.db, me, 'dev.write'); const b = await ctx.body(); const blocked = bool(b, 'blocked'); const i = updateIssue(app, me, ctx.params.id, { blocked: blocked ? 1 : 0, blocked_reason: blocked ? str(b, 'reason') || str(b, 'note') : '' }); return done(ctx, { reload: true, toast: { title: blocked ? `${i.id} blocked` : `${i.id} unblocked`, body: blocked ? i.blocked_reason : undefined, kind: blocked ? 'warn' : 'success' } }); });
  r.post('/dev/:id/comments', async (ctx) => { const me = user(ctx); const b = await ctx.body(); try { addComment(app, me, ctx.params.id, str(b, 'text')); return done(ctx, { reload: true, toast: { title: 'Comment added', kind: 'success' } }); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } });
  r.post('/dev/:id/checks', async (ctx) => { const me = user(ctx); const b = await ctx.body(); const kind = str(b, 'kind') === 'test' ? 'test' : 'subtask'; if (kind === 'subtask') requireCan(app.db, me, 'dev.write'); try { addCheck(app, me, ctx.params.id, kind, str(b, 'title')); return done(ctx, { reload: true, toast: { title: kind === 'test' ? 'Test case added' : 'Sub-task added', kind: 'success' } }); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } });
  r.post('/dev/checks/:id', async (ctx) => { const me = user(ctx); const b = await ctx.body(); const c = setCheck(app, me, Number(ctx.params.id), bool(b, 'done'), str(b, 'result') === 'fail' ? 'fail' : 'pass'); return done(ctx, { reload: true, toast: { title: c.kind === 'test' ? (c.result === 'fail' ? 'Marked failed; back to In progress' : 'Test passed') : (c.done ? 'Sub-task done' : 'Sub-task reopened'), kind: c.result === 'fail' ? 'warn' : 'success' } }); });
  r.post('/dev/checks/:id/delete', (ctx) => { const me = user(ctx); requireCan(app.db, me, 'dev.write'); deleteCheck(app, Number(ctx.params.id)); return done(ctx, { reload: true, toast: { title: 'Removed', kind: 'info' } }); });
}
