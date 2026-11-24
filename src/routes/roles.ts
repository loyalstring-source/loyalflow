// Settings → Roles and permissions.
import type { Params } from '../db/index.ts';
import type { App } from '../app.ts';
import { Router, htmlResponse } from '../lib/http.ts';
import { type Employee, getEmployee } from '../modules/people/model.ts';
import { requireCan } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { MODULE_DEFS, LEVELS, listRoles, getRole, roleOf, levelOf, dataScope, autoDefault, defaultPerms, saveRole, resetRole, deleteRole, assignRole, roleHistory, type Role, type Level } from '../lib/roles.ts';
import { rolesPage, roleEditPage, roleCheckPage, type PersonRow } from '../ui/pages/roles.ts';
import { done, fail, view, user, str } from './helpers.ts';

const PAGE = 50;
const FROLE: Record<string, string> = { ic: 'Team member', team_lead: 'Team lead', hod: 'Head of department', executive: 'Executive' };

export function register(r: Router<Employee>, app: App): void {
  const db = app.db;
  r.get('/roles', (ctx) => {
    const v = view(ctx); requireCan(db, v.user, 'settings.admin');
    const tab = ctx.query.get('tab') === 'people' ? 'people' : 'roles'; const roles = listRoles(db);
    const q = (ctx.query.get('q') || '').trim(); const dept = ctx.query.get('dept') || '';
    let people: PersonRow[] = []; let total = 0; let pageNo = 1; let pages = 1;
    if (tab === 'people') {
      const where = ["e.status = 'active'"]; const args: Params = [];
      if (q) { where.push('lower(e.full_name) LIKE ?'); args.push(`%${q.toLowerCase()}%`); }
      if (dept) { where.push('e.department_id = ?'); args.push(dept); }
      total = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM employees e WHERE ${where.join(' AND ')}`, args)!.n;
      pages = Math.max(1, Math.ceil(total / PAGE)); pageNo = Math.min(pages, Math.max(1, Number(ctx.query.get('page')) || 1));
      const rows = db.all<Employee & { department: string; role_id: string | null }>(`SELECT e.*, d.name AS department FROM employees e JOIN departments d ON d.id = e.department_id WHERE ${where.join(' AND ')} ORDER BY e.full_name LIMIT ? OFFSET ?`, [...args, PAGE, (pageNo - 1) * PAGE]);
      people = rows.map((e) => ({ id: e.id, full_name: e.full_name, designation: e.designation, department: e.department, level: FROLE[e.functional_role] || 'Team member', role_id: e.role_id && roles.some((x) => x.id === e.role_id) ? e.role_id : null, roleName: roleOf(db, e).name, autoName: roleOf(db, { ...e, role_id: null }).name, is_admin: e.is_admin }));
    }
    return htmlResponse(rolesPage(v, { tab, roles, people, total, pageNo, pages, q, dept, departments: db.all('SELECT id, name FROM departments ORDER BY name'), history: tab === 'roles' ? roleHistory(db) : [] }));
  });

  r.get('/roles/edit', (ctx) => {
    const v = view(ctx); requireCan(db, v.user, 'settings.admin');
    const id = ctx.query.get('id') || ''; const roles = listRoles(db); const role = id ? getRole(db, id) || null : null;
    if (id && !role) return fail(ctx, 404, 'That role no longer exists.');
    const copyOf = ctx.query.get('copy') || ''; const copy = copyOf ? getRole(db, copyOf) : undefined;
    const blank: Role = { id: '', name: '', description: '', auto: false, ...defaultPerms('', 'ic') };
    const all = db.all<Employee & { role_id: string | null }>("SELECT * FROM employees WHERE status = 'active' ORDER BY full_name");
    const members = role ? all.filter((e) => roleOf(db, e).id === role.id) : [];
    const def = role?.auto ? autoDefault(db, role.id) : null;
    return htmlResponse(roleEditPage(v, {
      role, base: copy || blank, copyOf, people: members.map((e) => ({ id: e.id, full_name: e.full_name, designation: e.designation })),
      candidates: role && !role.auto ? all.filter((e) => e.role_id !== role.id).map((e) => ({ id: e.id, full_name: e.full_name })) : [],
      copies: [{ id: '', name: 'A basic team member' }, ...roles.map((x) => ({ id: x.id, name: x.name }))],
      edited: !!def && (JSON.stringify(def.perms) !== JSON.stringify(role!.perms) || def.scope !== role!.scope || def.name !== role!.name)
    }));
  });

  r.get('/roles/check', (ctx) => {
    const v = view(ctx); requireCan(db, v.user, 'settings.admin');
    const e = getEmployee(db, ctx.query.get('id') || ''); if (!e) return fail(ctx, 404, 'No such person.');
    const c = getSetting(db, 'company'); const extras: string[] = [];
    if (e.id === c.salesHeadId) extras.push('Named as Sales Head in Settings, so can always work on anyone\'s deals.');
    if (e.id === c.productionHodId) extras.push('Named as Production HOD in Settings, so can always create and move work orders.');
    return htmlResponse(roleCheckPage(v, { person: e, role: roleOf(db, e), scope: dataScope(db, e), extras, rows: MODULE_DEFS.map((m) => { const level = levelOf(db, e, m.key); return { group: m.group, name: m.name, level, meaning: m.levels[level] || '' }; }) }));
  });

  r.post('/roles/save', async (ctx) => {
    const me = user(ctx); requireCan(db, me, 'settings.admin'); const b = await ctx.body();
    const perms: Record<string, string> = {};
    for (const m of MODULE_DEFS) { const x = str(b, `p_${m.key}`); if ((LEVELS as readonly string[]).includes(x)) perms[m.key] = x as Level; }
    const id = str(b, 'id') || null;
    try {
      const role = saveRole(db, me.id, id, { name: str(b, 'name'), description: str(b, 'description'), scope: str(b, 'scope'), perms });
      return done(ctx, id ? { reload: true, toast: { title: `${role.name} saved`, body: 'It applies from the next page each person opens.', kind: 'success' } } : { redirect: `/roles/edit?id=${encodeURIComponent(role.id)}`, toast: { title: `${role.name} created`, body: 'Now add the people who should have it.', kind: 'success' } });
    } catch (e) { return fail(ctx, 400, (e as Error).message); }
  });
  r.post('/roles/reset', async (ctx) => {
    const me = user(ctx); requireCan(db, me, 'settings.admin'); const b = await ctx.body();
    try { resetRole(db, me.id, str(b, 'id')); } catch (e) { return fail(ctx, 400, (e as Error).message); }
    return done(ctx, { reload: true, toast: { title: 'Put back to how it came', kind: 'success' } });
  });
  r.post('/roles/delete', async (ctx) => {
    const me = user(ctx); requireCan(db, me, 'settings.admin'); const b = await ctx.body();
    try { deleteRole(db, me.id, str(b, 'id')); } catch (e) { return fail(ctx, 400, (e as Error).message); }
    return done(ctx, { redirect: '/roles', toast: { title: 'Role deleted', kind: 'success' } });
  });
  r.post('/roles/assign', async (ctx) => {
    const me = user(ctx); requireCan(db, me, 'settings.admin'); const b = await ctx.body();
    const e = getEmployee(db, str(b, 'employeeId')); if (!e) return fail(ctx, 400, 'Choose a person.');
    try { assignRole(db, me.id, [e.id], str(b, 'roleId') || null); } catch (err) { return fail(ctx, 400, (err as Error).message); }
    return done(ctx, { reload: true, toast: { title: `${e.full_name}: role saved`, kind: 'success' } });
  });
}
