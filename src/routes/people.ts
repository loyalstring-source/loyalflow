import type { App } from '../app.ts';
import { Router, htmlResponse, json, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getEmployee, getEmployeeByEmail, listDepartments, getDepartment, listSites, directReports, validateReportingLine } from '../modules/people/model.ts';
import { tilesFor } from '../modules/kpi/engine.ts';
import { personKpis } from '../modules/kpi/views.ts';
import { compliance } from '../modules/sops/service.ts';
import { listTickets } from '../modules/desk/service.ts';
import { listDeals } from '../modules/sales/service.ts';
import { listTasks } from '../modules/tasks/service.ts';
import { requestPasswordReset, logoutEverywhere } from '../lib/auth.ts';
import { audit } from '../lib/audit.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { localDateString, addDays } from '../lib/time.ts';
import { peoplePage, profilePage, employeeModal, type PeopleData, type ProfileData, type TreeNode } from '../ui/pages/people.ts';
import { done, fail, view, user, str } from './helpers.ts';

function buildTree(all: Employee[], rootId: string): TreeNode | null {
  const byManager = new Map<string | null, Employee[]>();
  for (const e of all) { const k = e.reporting_manager_id; if (!byManager.has(k)) byManager.set(k, []); byManager.get(k)!.push(e); }
  const root = all.find((e) => e.id === rootId); if (!root) return null;
  const seen = new Set<string>();
  const make = (e: Employee): TreeNode => { seen.add(e.id); return { e, children: (byManager.get(e.id) || []).filter((c) => !seen.has(c.id)).map(make) }; };
  return make(root);
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/people', (ctx) => {
    const v = view(ctx);
    const dept = ctx.query.get('dept') || '', q = (ctx.query.get('q') || '').toLowerCase();
    const all = listEmployees(app.db, { status: 'active' });
    let employees = all;
    if (dept) employees = employees.filter((e) => e.department_id === dept);
    if (q) employees = employees.filter((e) => e.full_name.toLowerCase().includes(q) || e.designation.toLowerCase().includes(q) || e.sub_team.toLowerCase().includes(q));
    const departments = listDepartments(app.db);
    const today = localDateString(new Date());
    const onLeave = app.db.all<{ employee_id: string; full_name: string; type: string; to_date: string }>("SELECT l.employee_id, e.full_name, l.type, l.to_date FROM leave_requests l JOIN employees e ON e.id = l.employee_id WHERE l.status = 'approved' AND l.from_date <= ? AND l.to_date >= ?", [today, today]);
    const present = app.db.get<{ n: number }>('SELECT count(*) AS n FROM attendance WHERE date = ? AND check_in IS NOT NULL', [today])?.n || 0;
    const d: PeopleData = { employees, departments, dept, q, tree: buildTree(all, getSetting(app.db, 'company').ceoId), onLeave, headcount: all.length, present, canAdmin: can(app.db, v.user, 'people.admin'), byDept: departments.map((dp) => ({ dept: dp, n: all.filter((e) => e.department_id === dp.id).length })).filter((x) => x.n > 0), month: today.slice(0, 7) };
    return htmlResponse(peoplePage(v, d));
  });

  const modalData = (e: Employee | null) => ({ e, departments: listDepartments(app.db), managers: listEmployees(app.db, { status: 'active' }), sites: listSites(app.db), shifts: getSetting(app.db, 'shifts').map((s) => ({ code: s.code, name: s.name })) });
  r.get('/people/new', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'people.admin'); return htmlResponse(employeeModal(v, modalData(null))); });
  r.get('/people/:id/edit', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'people.admin'); const e = getEmployee(app.db, ctx.params.id); if (!e) throw new HttpError(404, 'Not found'); return htmlResponse(employeeModal(v, modalData(e))); });

  r.get('/people/:id', (ctx) => {
    const v = view(ctx);
    const e = getEmployee(app.db, ctx.params.id); if (!e) throw new HttpError(404, 'Employee not found');
    const now = new Date();
    const scope = scopeFor(app.db, v.user);
    const inScope = scope.people.has(e.id) || can(app.db, v.user, 'people.admin');
    const code = getDepartment(app.db, e.department_id)?.code || '';
    const d: ProfileData = {
      e, manager: e.reporting_manager_id ? getEmployee(app.db, e.reporting_manager_id) || null : null, reports: directReports(app.db, e.id), dept: getDepartment(app.db, e.department_id) || null, site: listSites(app.db).find((s) => s.id === e.site_id) || null,
      tiles: inScope ? tilesFor(app, personKpis(code), { type: 'employee', id: e.id }, now) : [],
      sop: inScope ? (() => { const c = compliance(app, { assigneeIds: [e.id], from: localDateString(addDays(now, -30)), to: localDateString(now) }); return { pct: c.pct, done: c.onTime, total: c.total }; })() : { pct: null, done: 0, total: 0 },
      attendance: inScope ? app.db.all('SELECT date, check_in, check_out FROM attendance WHERE employee_id = ? ORDER BY date DESC LIMIT 10', [e.id]) : [],
      leave: inScope ? app.db.all('SELECT type, from_date, to_date, days, status FROM leave_requests WHERE employee_id = ? ORDER BY from_date DESC LIMIT 10', [e.id]) : [],
      canAdmin: can(app.db, v.user, 'people.admin'), inScope, self: e.id === v.user.id,
      openWork: { tickets: listTickets(app, { status: 'open', assigneeId: e.id, limit: 500 }).length, deals: listDeals(app, { ownerIds: [e.id], open: true, limit: 500 }).length, orders: app.db.get<{ n: number }>("SELECT count(*) AS n FROM work_orders WHERE assignee_id = ? AND stage NOT IN ('dispatched','delivered')", [e.id])?.n || 0, tasks: listTasks(app, { assigneeId: e.id, kind: 'task', status: ['open', 'in_progress'] }).length }
    };
    return htmlResponse(profilePage(v, d));
  });

  const saveEmployee = async (ctx: Parameters<typeof user>[0], existing: Employee | null) => {
    const me = user(ctx); requireCan(app.db, me, 'people.admin');
    const b = await ctx.body();
    const email = str(b, 'email').toLowerCase();
    if (!str(b, 'full_name') || !email) return fail(ctx, 400, 'Name and email are required.');
    const clash = getEmployeeByEmail(app.db, email);
    if (clash && clash.id !== existing?.id) return fail(ctx, 400, 'That email already belongs to another employee.');
    const managerId = str(b, 'reporting_manager_id') || null;
    const id = existing?.id || nextEmployeeId(app);
    const problem = validateReportingLine(app.db, id, managerId);
    if (problem && existing) return fail(ctx, 400, problem);
    const role = ['ic', 'team_lead', 'hod', 'executive'].includes(str(b, 'functional_role')) ? str(b, 'functional_role') : 'ic';
    const nowIso = new Date().toISOString();
    const fields = { full_name: str(b, 'full_name'), email, designation: str(b, 'designation'), department_id: str(b, 'department_id') || existing?.department_id || 'LEAD', sub_team: str(b, 'sub_team'), site_id: str(b, 'site_id') || existing?.site_id || 'HO', functional_role: role, reporting_manager_id: managerId, shift_code: str(b, 'shift_code') || 'GEN', join_date: str(b, 'join_date') || null, status: str(b, 'status') === 'inactive' ? 'inactive' : 'active', lang: str(b, 'lang') === 'hi' ? 'hi' : 'en', mobile: str(b, 'mobile') };
    if (existing) {
      app.db.run('UPDATE employees SET full_name = ?, email = ?, designation = ?, department_id = ?, sub_team = ?, site_id = ?, functional_role = ?, reporting_manager_id = ?, shift_code = ?, join_date = ?, status = ?, lang = ?, mobile = ?, updated_at = ? WHERE id = ?',
        [fields.full_name, fields.email, fields.designation, fields.department_id, fields.sub_team, fields.site_id, fields.functional_role, fields.reporting_manager_id, fields.shift_code, fields.join_date, fields.status, fields.lang, fields.mobile, nowIso, existing.id]);
      if (fields.status === 'inactive') logoutEverywhere(app, existing.id);
      audit(app.db, { entity: 'employee', entityId: existing.id, action: 'update', actorId: me.id, before: { designation: existing.designation, department_id: existing.department_id, reporting_manager_id: existing.reporting_manager_id, functional_role: existing.functional_role, status: existing.status }, after: fields });
      return done(ctx, { reload: true, toast: { title: 'Saved', body: fields.full_name, kind: 'success' } });
    }
    app.db.run('INSERT INTO employees (id, full_name, email, password_hash, must_change_password, designation, department_id, sub_team, site_id, functional_role, reporting_manager_id, secondary_manager_id, shift_code, join_date, employment_type, status, lang, is_admin, mobile, pagarguru_code, failed_logins, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?)',
      [id, fields.full_name, fields.email, fields.designation, fields.department_id, fields.sub_team, fields.site_id, fields.functional_role, fields.reporting_manager_id, fields.shift_code, fields.join_date, 'full_time', fields.status, fields.lang, fields.mobile, '', nowIso, nowIso]);
    audit(app.db, { entity: 'employee', entityId: id, action: 'create', actorId: me.id, after: fields });
    const sent = requestPasswordReset(app, email, { hours: 24 });
    return done(ctx, { redirect: `/people/${id}`, toast: { title: `${fields.full_name} added as ${id}`, body: sent.emailed ? `A link to set a password has been emailed to ${email}. It works for 24 hours.` : 'Email is not set up, so no link was sent. Press “Sign-in link” on this page and pass the link on yourself.', kind: sent.emailed ? 'success' : 'warn' } });
  };
  r.post('/people', (ctx) => saveEmployee(ctx, null));
  r.post('/people/:id', (ctx) => { const e = getEmployee(app.db, ctx.params.id); if (!e) return fail(ctx, 404, 'Not found'); return saveEmployee(ctx, e); });

  r.post('/people/:id/reset-password', (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'people.admin');
    const e = getEmployee(app.db, ctx.params.id); if (!e) return fail(ctx, 404, 'Not found');
    if (e.status !== 'active') return fail(ctx, 400, `${e.full_name} is not active, so cannot sign in.`);
    logoutEverywhere(app, e.id);
    const sent = requestPasswordReset(app, e.email);
    audit(app.db, { entity: 'employee', entityId: e.id, action: 'password.reset_by_admin', actorId: me.id });
    // With no mail service nothing can be emailed: say so, and hand the link to the administrator instead of claiming it was sent.
    if (!sent.emailed) return json({ ok: true, link: { url: sent.link, name: e.full_name, mobile: e.mobile || '', valid: '60 minutes', note: 'Email is not set up on this server, so the link was not emailed. Pass it on yourself.' } });
    return done(ctx, { toast: { title: 'Reset link emailed', body: `${e.email} has 60 minutes to use it. If it does not arrive, use “Sign-in link”.`, kind: 'success' } });
  });
  // A link the administrator hands over personally (Teams, WhatsApp): for people with no company mailbox, or when email is not working.
  r.post('/people/:id/sign-in-link', (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'people.admin');
    const e = getEmployee(app.db, ctx.params.id); if (!e) return fail(ctx, 404, 'Not found');
    if (e.status !== 'active') return fail(ctx, 400, `${e.full_name} is not active, so cannot sign in.`);
    const sent = requestPasswordReset(app, e.email, { hours: 24, send: false });
    audit(app.db, { entity: 'employee', entityId: e.id, action: 'password.link_by_admin', actorId: me.id });
    return json({ ok: true, link: { url: sent.link, name: e.full_name, mobile: e.mobile || '', valid: '24 hours', note: `${e.full_name} opens this link, chooses a password, and then signs in with ${e.email}.` } });
  });
}

function nextEmployeeId(app: App): string {
  const max = app.db.get<{ m: string }>("SELECT max(id) AS m FROM employees WHERE id LIKE 'LS%'")?.m || 'LS000';
  const n = parseInt(max.replace(/\D/g, ''), 10) || 0;
  return `LS${String(n + 1).padStart(3, '0')}`;
}
