// Roles and permissions. A role says, module by module, how much a person can do, and whose records they can open.
// Everyone has exactly one role. Until someone is given a role by hand they have the automatic role for their
// department and level (team member, team lead, head of department, executive), which starts out as the access
// the app has always given that kind of person and can then be edited like any other role.
import type { Db } from '../db/index.ts';
import { audit } from './audit.ts';

export const LEVELS = ['none', 'link', 'view', 'work', 'manage'] as const;
export type Level = typeof LEVELS[number];
export const rank = (l: Level): number => LEVELS.indexOf(l);
export type ModuleKey = 'desk' | 'dev' | 'sales' | 'production' | 'procurement' | 'budgets' | 'analytics' | 'company' | 'sops' | 'tasks' | 'people' | 'attendance' | 'appraisals' | 'hire' | 'payroll' | 'settings';
export type DataScope = 'self' | 'team' | 'company';

export interface ModuleDef { key: ModuleKey; group: string; name: string; levels: Partial<Record<Level, string>> }
/** Each module and what every level it offers means, in plain words. Only the levels listed can be chosen. */
export const MODULE_DEFS: ModuleDef[] = [
  { key: 'desk', group: 'Work', name: 'Service desk', levels: { none: 'No access', link: 'Not in the menu; can open a ticket from a link', view: 'See tickets', work: 'Raise, answer and resolve tickets', manage: 'Also assign tickets and change priority' } },
  { key: 'dev', group: 'Work', name: 'Development', levels: { none: 'No access', link: 'Not in the menu; can open an issue from a link', view: 'See the board, sprints and releases', work: 'Create and move issues, run sprints and releases' } },
  { key: 'sales', group: 'Work', name: 'Sales pipeline', levels: { none: 'No access', link: 'Not in the menu; can open a deal or customer from a link', view: 'See deals and customers', work: 'Create and move own deals, log calls and visits', manage: 'Also work on anyone\'s deals' } },
  { key: 'production', group: 'Work', name: 'Production', levels: { none: 'No access', link: 'Not in the menu; can open a work order from a link', view: 'See the production board', work: 'Create and move work orders' } },
  { key: 'procurement', group: 'Work', name: 'Procurement', levels: { none: 'No access', link: 'Not in the menu', view: 'See forecast, materials and purchases' } },
  { key: 'sops', group: 'Work', name: 'SOPs', levels: { work: 'Do own checklists', manage: 'Also create and change SOPs' } },
  { key: 'tasks', group: 'Work', name: 'Tasks and approvals', levels: { work: 'Own tasks and requests', manage: 'Also give tasks to other people' } },
  { key: 'people', group: 'People', name: 'People directory', levels: { view: 'See the directory', manage: 'Also add and change employee records' } },
  { key: 'attendance', group: 'People', name: 'Attendance', levels: { work: 'Own attendance, leave and miss-punch requests', manage: 'Also rules, punching machines and everyone\'s attendance' } },
  { key: 'appraisals', group: 'People', name: 'Appraisals', levels: { work: 'Own appraisal and own team\'s', manage: 'Run appraisal cycles for the company' } },
  { key: 'hire', group: 'People', name: 'Hiring', levels: { none: 'No access, even as an interviewer', link: 'Not in the menu; interviews they are on reach them by link', view: 'In the menu; sees only hiring they are part of', manage: 'Recruiter: vacancies, candidates, CVs, offers' } },
  { key: 'payroll', group: 'People', name: 'Payroll', levels: { link: 'Own payslips only', manage: 'Run payroll, salary structures, statutory reports' } },
  { key: 'company', group: 'Reports', name: 'Company dashboard and KPIs', levels: { none: 'No access', view: 'See company KPIs', work: 'See and export reports' } },
  { key: 'analytics', group: 'Reports', name: 'Analytics', levels: { none: 'No access', view: 'See analytics' } },
  { key: 'budgets', group: 'Reports', name: 'Budgets', levels: { none: 'No access', view: 'See budgets' } },
  { key: 'settings', group: 'Administration', name: 'Settings, lists and roles', levels: { none: 'No access', manage: 'Change every setting, list and role' } }
];
export const SCOPE_LABEL: Record<DataScope, string> = { self: 'Only their own', team: 'Their own and their team\'s', company: 'Everyone in the company' };
export const LEVEL_NAME: Record<Level, string> = { none: 'No access', link: 'By link', view: 'View', work: 'Work', manage: 'Manage' };
const moduleDef = (k: ModuleKey): ModuleDef => MODULE_DEFS.find((m) => m.key === k)!;

export type Perms = Record<ModuleKey, Level>;
export interface Role { id: string; name: string; description: string; scope: DataScope; perms: Perms; auto: boolean }
type Who = { id: string; department_id: string; functional_role: string; is_admin: number; role_id?: string | null };

const FROLE_NAME: Record<string, string> = { ic: 'Team member', team_lead: 'Team lead', hod: 'Head of department', executive: 'Executive' };
const MENU_BY_DEPT: Record<string, ModuleKey[]> = { DEV: ['dev', 'desk'], QA: ['dev', 'desk'], SUP: ['desk'], SAL: ['sales'], PRE: ['sales'], PRD: ['production', 'procurement'], ACC: ['procurement', 'sales'], HR: [], DM: ['sales'], LEAD: ['desk', 'dev', 'sales', 'production', 'procurement'] };

/** The access the app has always given this kind of person. This is where every automatic role starts. */
export function defaultPerms(code: string, frole: string): { perms: Perms; scope: DataScope } {
  const exec = frole === 'executive'; const wide = exec || frole === 'hod'; const manager = wide || frole === 'team_lead';
  const hr = code === 'HR' && !exec; const menu = MENU_BY_DEPT[code] || [];
  const seen = (k: ModuleKey): Level => (hr ? 'none' : wide || menu.includes(k) ? 'view' : 'link');
  const max = (a: Level, b: Level): Level => (rank(a) >= rank(b) ? a : b);
  const prodWork = exec || ['PRD', 'ACC'].includes(code);
  const perms: Perms = {
    desk: hr ? 'none' : exec || (['SUP', 'DEV'].includes(code) && manager) ? 'manage' : ['SUP', 'DEV', 'QA'].includes(code) ? 'work' : seen('desk'),
    dev: hr ? 'none' : exec || ['DEV', 'QA'].includes(code) ? 'work' : seen('dev'),
    sales: hr ? 'none' : exec || (['SAL', 'PRE'].includes(code) && manager) ? 'manage' : ['SAL', 'PRE'].includes(code) ? 'work' : seen('sales'),
    production: hr ? 'none' : prodWork ? max('work', 'work') : seen('production'),
    procurement: hr ? 'none' : wide || menu.includes('procurement') ? 'view' : 'link',
    sops: manager ? 'manage' : 'work',
    tasks: manager ? 'manage' : 'work',
    people: exec || code === 'HR' ? 'manage' : 'view',
    attendance: exec || code === 'HR' ? 'manage' : 'work',
    appraisals: exec || code === 'HR' ? 'manage' : 'work',
    hire: exec || code === 'HR' ? 'manage' : wide ? 'view' : 'link',
    payroll: exec || ['HR', 'ACC'].includes(code) ? 'manage' : 'link',
    company: manager ? 'work' : code === 'HR' ? 'view' : 'none',
    analytics: hr ? 'none' : 'view',
    budgets: manager && !hr ? 'view' : 'none',
    settings: 'none'
  };
  return { perms, scope: wide ? 'company' : frole === 'team_lead' ? 'team' : 'self' };
}

/** Keep only levels the module offers; anything else falls to the nearest lower level it does offer. */
export function cleanPerms(input: Partial<Record<string, string>>, base: Perms): Perms {
  const out = { ...base };
  for (const m of MODULE_DEFS) {
    const want = input[m.key] as Level | undefined; if (!want || !LEVELS.includes(want)) continue;
    if (m.levels[want] !== undefined) { out[m.key] = want; continue; }
    const offered = LEVELS.filter((l) => m.levels[l] !== undefined); const lower = offered.filter((l) => rank(l) <= rank(want));
    out[m.key] = lower.length ? lower[lower.length - 1] : offered[0];
  }
  return out;
}

const cache = new WeakMap<Db, Map<string, Role>>();
const deptCache = new WeakMap<Db, Map<string, { code: string; name: string }>>();
export function forget(db: Db): void { cache.delete(db); deptCache.delete(db); }
function depts(db: Db): Map<string, { code: string; name: string }> {
  let m = deptCache.get(db);
  if (!m) { m = new Map(db.all<{ id: string; code: string; name: string }>('SELECT id, code, name FROM departments').map((d) => [d.id, { code: d.code, name: d.name }])); deptCache.set(db, m); }
  return m;
}
function load(db: Db): Map<string, Role> {
  let m = cache.get(db);
  if (!m) {
    m = new Map();
    for (const r of db.all<{ id: string; name: string; description: string; scope: string; perms: string; auto: number }>('SELECT * FROM roles')) {
      let p: Partial<Record<string, string>> = {}; try { p = JSON.parse(r.perms); } catch { /* fall back to nothing extra */ }
      m.set(r.id, { id: r.id, name: r.name, description: r.description, scope: (['self', 'team', 'company'].includes(r.scope) ? r.scope : 'self') as DataScope, perms: cleanPerms(p, defaultPerms('', 'ic').perms), auto: r.auto === 1 });
    }
    cache.set(db, m);
  }
  return m;
}

export const autoRoleId = (deptId: string, frole: string): string => (frole === 'executive' ? 'auto:executive' : `auto:${deptId}:${['ic', 'team_lead', 'hod'].includes(frole) ? frole : 'ic'}`);
function autoRole(db: Db, deptId: string, frole: string): Role {
  const d = depts(db).get(deptId); const def = defaultPerms(d?.code || '', frole);
  return { id: autoRoleId(deptId, frole), name: frole === 'executive' ? 'Executive' : `${d?.name || 'No department'} · ${FROLE_NAME[frole] || 'Team member'}`, description: 'Automatic: everyone at this level in this department, unless given another role.', scope: def.scope, perms: def.perms, auto: true };
}

/** The role this person has right now. */
export function roleOf(db: Db, user: Who): Role {
  const roles = load(db);
  if (user.role_id && roles.has(user.role_id)) return roles.get(user.role_id)!;
  const id = autoRoleId(user.department_id, user.functional_role);
  return roles.get(id) || autoRole(db, user.department_id, user.functional_role);
}
/** How much this person can do in a module. Administrators can do everything, so nobody can lock the company out. */
export function levelOf(db: Db, user: Who, module: ModuleKey): Level {
  if (user.is_admin === 1) { const offered = LEVELS.filter((l) => moduleDef(module).levels[l] !== undefined); return offered[offered.length - 1]; }
  return roleOf(db, user).perms[module];
}
export const atLeast = (db: Db, user: Who, module: ModuleKey, level: Level): boolean => rank(levelOf(db, user, module)) >= rank(level);
export function dataScope(db: Db, user: Who): DataScope { return user.is_admin === 1 ? 'company' : roleOf(db, user).scope; }

/** Which module a page belongs to, for the server-side check. Pages everyone needs are not listed. */
const PATH_MODULE: Record<string, ModuleKey> = { desk: 'desk', tickets: 'desk', dev: 'dev', pipeline: 'sales', deals: 'sales', customers: 'sales', sales: 'sales', activities: 'sales', estimates: 'sales', products: 'sales', production: 'production', 'work-orders': 'production', procurement: 'procurement', purchases: 'procurement', budgets: 'budgets', analytics: 'analytics', hours: 'analytics', hire: 'hire', roles: 'settings',
  // Imports bring in tickets, deals and orders, so they follow Analytics: closed to anyone shut out of the work modules.
  imports: 'analytics', dsr: 'tasks' };
const EXPORT_MODULE: Record<string, ModuleKey> = { pipeline: 'sales', production: 'production', analytics: 'analytics', tickets: 'desk' };
const API_MODULE: Record<string, ModuleKey> = { tickets: 'desk', deals: 'sales', customers: 'sales', 'work-orders': 'production' };
export function moduleOfPath(path: string): ModuleKey | null {
  const seg = path.split('/').filter(Boolean); if (!seg.length) return null;
  if (seg[0] === 'api' && seg[1] === 'v1') return API_MODULE[seg[2] || ''] || null;
  if (seg[0] === 'exports') return EXPORT_MODULE[seg[1] || ''] || null;
  return PATH_MODULE[seg[0]] || null;
}
/** The name of the module a person is shut out of, or null if the page is open to them. */
export function blockedModule(db: Db, user: Who, path: string): string | null {
  const m = moduleOfPath(path); if (!m) return null;
  return levelOf(db, user, m) === 'none' ? moduleDef(m).name : null;
}

// ---------- Managing roles ----------

/** Make sure every department-and-level combination that has people has its automatic role stored, so it can be edited. */
export function ensureRoles(db: Db): void {
  const have = new Set(db.all<{ id: string }>('SELECT id FROM roles').map((r) => r.id)); const at = new Date().toISOString(); let added = false;
  const combos = db.all<{ department_id: string; functional_role: string }>("SELECT DISTINCT department_id, functional_role FROM employees WHERE status = 'active'");
  for (const c of combos) {
    const r = autoRole(db, c.department_id, c.functional_role); if (have.has(r.id)) continue; have.add(r.id); added = true;
    db.run('INSERT INTO roles (id, name, description, scope, perms, auto, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)', [r.id, r.name, r.description, r.scope, JSON.stringify(r.perms), at, at]);
  }
  if (added) forget(db);
}

export interface RoleRow extends Role { people: number }
export function listRoles(db: Db): RoleRow[] {
  ensureRoles(db);
  const counts = new Map<string, number>();
  for (const e of db.all<Who>("SELECT id, department_id, functional_role, is_admin, role_id FROM employees WHERE status = 'active'")) { const id = roleOf(db, e).id; counts.set(id, (counts.get(id) || 0) + 1); }
  return [...load(db).values()].map((r) => ({ ...r, people: counts.get(r.id) || 0 })).sort((a, b) => Number(a.auto) - Number(b.auto) || a.name.localeCompare(b.name));
}
export function getRole(db: Db, id: string): Role | undefined { ensureRoles(db); return load(db).get(id); }
/** What an automatic role would be if it had never been edited. */
export function autoDefault(db: Db, id: string): Role | null {
  const m = /^auto:(?:(executive)|(.+):(ic|team_lead|hod))$/.exec(id); if (!m) return null;
  return m[1] ? autoRole(db, '', 'executive') : autoRole(db, m[2], m[3]);
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'role';
export interface RoleInput { name?: string; description?: string; scope?: string; perms?: Partial<Record<string, string>> }
export function saveRole(db: Db, actorId: string, id: string | null, input: RoleInput): Role {
  const roles = load(db); const before = id ? roles.get(id) : undefined; const at = new Date().toISOString();
  if (id && !before) throw new Error('That role no longer exists.');
  const name = (input.name || '').trim().slice(0, 60) || before?.name || '';
  if (!name) throw new Error('Give the role a name.');
  if ([...roles.values()].some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a role called "${name}".`);
  const scope = (['self', 'team', 'company'].includes(input.scope || '') ? input.scope : before?.scope || 'self') as DataScope;
  const perms = cleanPerms(input.perms || {}, before?.perms || defaultPerms('', 'ic').perms);
  const description = (input.description ?? before?.description ?? '').trim().slice(0, 200);
  let rid = id;
  if (!rid) { rid = slug(name); let k = 2; const base = rid; while (roles.has(rid) || rid.startsWith('auto')) rid = `${base}-${k++}`; db.run('INSERT INTO roles (id, name, description, scope, perms, auto, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)', [rid, name, description, scope, JSON.stringify(perms), at, at, actorId]); }
  else db.run('UPDATE roles SET name = ?, description = ?, scope = ?, perms = ?, updated_at = ?, updated_by = ? WHERE id = ?', [name, description, scope, JSON.stringify(perms), at, actorId, rid]);
  audit(db, { entity: 'role', entityId: rid, action: id ? 'update' : 'create', actorId, before: before ? { name: before.name, scope: before.scope, perms: before.perms } : undefined, after: { name, scope, perms } });
  forget(db);
  return load(db).get(rid)!;
}
export function resetRole(db: Db, actorId: string, id: string): Role {
  const def = autoDefault(db, id); const before = load(db).get(id); if (!def || !before) throw new Error('Only an automatic role can be put back to how it came.');
  db.run('UPDATE roles SET name = ?, description = ?, scope = ?, perms = ?, updated_at = ?, updated_by = ? WHERE id = ?', [def.name, def.description, def.scope, JSON.stringify(def.perms), new Date().toISOString(), actorId, id]);
  audit(db, { entity: 'role', entityId: id, action: 'reset', actorId, before: { name: before.name, scope: before.scope, perms: before.perms }, after: { name: def.name, scope: def.scope, perms: def.perms } });
  forget(db); return load(db).get(id)!;
}
export function deleteRole(db: Db, actorId: string, id: string): void {
  const r = load(db).get(id); if (!r) throw new Error('That role no longer exists.');
  if (r.auto) throw new Error('An automatic role cannot be deleted. You can change it, or put it back to how it came.');
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM employees WHERE role_id = ?', [id])!.n;
  db.run('UPDATE employees SET role_id = NULL WHERE role_id = ?', [id]); db.run('DELETE FROM roles WHERE id = ?', [id]);
  audit(db, { entity: 'role', entityId: id, action: 'delete', actorId, before: { name: r.name, scope: r.scope, perms: r.perms, people: n } });
  forget(db);
}
/** Give people a role, or pass null to put them back on the automatic role for their department and level. */
export function assignRole(db: Db, actorId: string, employeeIds: string[], roleId: string | null): number {
  const roles = load(db); let target: string | null = roleId;
  if (target && !roles.has(target)) throw new Error('That role no longer exists.');
  if (target && roles.get(target)!.auto) target = null;   // choosing an automatic role means "follow the department and level"
  let n = 0;
  for (const id of employeeIds) {
    const e = db.get<{ id: string; role_id: string | null }>('SELECT id, role_id FROM employees WHERE id = ?', [id]); if (!e || e.role_id === target) continue;
    db.run('UPDATE employees SET role_id = ? WHERE id = ?', [target, id]); n++;
    audit(db, { entity: 'employee', entityId: id, action: 'role', actorId, before: { role: e.role_id || 'automatic' }, after: { role: target || 'automatic' } });
  }
  return n;
}
export function roleHistory(db: Db, limit = 30): { at: string; actor: string; entity: string; entity_id: string; action: string; who: string | null }[] {
  return db.all("SELECT a.at, COALESCE(e.full_name, 'System') AS actor, a.entity, a.entity_id, a.action, p.full_name AS who FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id LEFT JOIN employees p ON a.entity = 'employee' AND p.id = a.entity_id WHERE a.entity = 'role' OR (a.entity = 'employee' AND a.action = 'role') ORDER BY a.id DESC LIMIT ?", [limit]);
}
