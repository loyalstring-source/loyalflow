// Roles and permissions: what each person can do comes from their role, and roles are edited in Settings.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, HR, COO, SUPPORT_IC, SUPPORT_LEAD, BDM, DEV_LEAD, PRODUCTION_LEAD, SALES_HEAD } from '../helpers.ts';
import { can, scopeFor, type Action } from '../../src/lib/scope.ts';
import { roleOf, levelOf, listRoles, saveRole, assignRole, deleteRole, resetRole, defaultPerms, autoRoleId, MODULE_DEFS, LEVELS } from '../../src/lib/roles.ts';
import { getSetting } from '../../src/lib/settings.ts';
import { navFor } from '../../src/ui/layout.ts';

let s: TestServer; let coo: Client; let hr: Client; let ic: Client;
before(async () => { s = await startServer(); coo = new Client(s.base); await coo.login(COO); hr = new Client(s.base); await hr.login(HR); ic = new Client(s.base); await ic.login(SUPPORT_IC); });
after(async () => { await s.close(); });

describe('automatic roles give exactly the access the app gave before roles existed', () => {
  test('every active person: each action matches the old rule', () => {
    const app = testApp(); const db = app.db; const c = getSetting(db, 'company');
    const old = (u: any, code: string, a: Action): boolean => {
      const exec = u.functional_role === 'executive' || u.is_admin === 1; const manager = exec || u.functional_role === 'hod' || u.functional_role === 'team_lead';
      switch (a) {
        case 'desk.view': case 'sales.view': case 'production.view': return !(code === 'HR' && !exec);   // HR was shut out by the page guard
        case 'people.view': return true;
        case 'desk.write': return exec || ['SUP', 'DEV', 'QA'].includes(code);
        case 'desk.manage': return exec || (code === 'SUP' && manager) || (code === 'DEV' && manager);
        case 'dev.write': return exec || ['DEV', 'QA'].includes(code);
        case 'sales.write': return exec || ['SAL', 'PRE'].includes(code);
        case 'sales.manage': return exec || (['SAL', 'PRE'].includes(code) && manager) || u.id === c.salesHeadId;
        case 'production.write': return exec || ['PRD', 'ACC'].includes(code) || u.id === c.productionHodId;
        case 'people.admin': return exec || code === 'HR';
        case 'settings.admin': return u.is_admin === 1;
        case 'reports.company': return manager || code === 'HR';
        case 'reports.export': case 'sops.manage': case 'tasks.assign': return manager;
        case 'hire.manage': case 'attendance.manage': case 'appraisals.manage': return exec || code === 'HR';
        case 'payroll.run': return exec || code === 'HR' || code === 'ACC';
      }
    };
    const actions: Action[] = ['desk.view', 'desk.write', 'desk.manage', 'dev.write', 'sales.view', 'sales.write', 'sales.manage', 'production.view', 'production.write', 'people.view', 'people.admin', 'settings.admin', 'reports.company', 'reports.export', 'sops.manage', 'tasks.assign', 'hire.manage', 'attendance.manage', 'appraisals.manage', 'payroll.run'];
    const people = db.all<any>("SELECT e.*, d.code AS code FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active'");
    assert.ok(people.length > 40);
    for (const u of people) for (const a of actions) {
      // HR in a work department that the old rule let "write" could not reach the page anyway; the new rule says no outright.
      const want = u.code === 'HR' && u.functional_role !== 'executive' && u.is_admin !== 1 && ['desk.write', 'desk.manage', 'dev.write', 'sales.write', 'sales.manage', 'production.write'].includes(a) ? false : old(u, u.code, a);
      assert.equal(can(db, u, a), want, `${u.full_name} (${u.code} ${u.functional_role}) ${a}`);
    }
    for (const u of people) { const want = u.functional_role === 'executive' || u.is_admin === 1 || u.functional_role === 'hod' ? 'company' : u.functional_role === 'team_lead' ? 'team' : 'self'; assert.equal(scopeFor(db, u).level, want, u.full_name); }
  });

  test('the menu is what it was for a support member, a sales member, HR and a head of department', () => {
    const app = testApp(); const keys = (email: string) => { const u = emp(app, email); const code = app.db.get<{ code: string }>('SELECT code FROM departments WHERE id = ?', [u.department_id])!.code; return navFor({ app, user: u, deptCode: code, approvalsPending: 0, unread: 0 } as any).map((n) => n.key); };
    assert.deepEqual(keys(SUPPORT_IC), ['today', 'analytics', 'desk', 'sops', 'approvals', 'tasks', 'people', 'attendance', 'appraisals']);
    assert.deepEqual(keys(BDM), ['today', 'analytics', 'pipeline', 'sops', 'approvals', 'tasks', 'people', 'attendance', 'appraisals']);
    assert.deepEqual(keys(HR), ['today', 'company', 'sops', 'approvals', 'tasks', 'people', 'attendance', 'appraisals', 'hire', 'payroll']);
    const lead = keys(DEV_LEAD); for (const k of ['company', 'dev', 'desk', 'budgets']) assert.ok(lead.includes(k), k); assert.ok(!lead.includes('settings'));
  });
});

describe('changing roles in Settings', () => {
  test('the screens open for an administrator and for nobody else', async () => {
    for (const p of ['/roles', '/roles?tab=people', '/roles/edit', `/roles/edit?id=${encodeURIComponent(autoRoleId('SUP', 'ic'))}`, `/roles/check?id=${emp(s.app, SUPPORT_IC).id}`]) assert.equal((await coo.get(p)).status, 200, p);
    assert.equal((await hr.get('/roles')).status, 403); assert.equal((await ic.get('/roles')).status, 403);
    assert.equal((await ic.postJson('/roles/save', { name: 'Mine', p_settings: 'manage' })).status, 403);
    const h = await (await coo.get('/roles')).text(); assert.ok(h.includes('Technical Support · Team member') && h.includes('Executive'));
  });

  test('a new role, given to one person, changes what that person can do and see', async () => {
    const me = emp(s.app, SUPPORT_IC);
    assert.equal((await ic.get('/pipeline')).status, 200); assert.equal((await ic.get('/analytics')).status, 200);
    assert.ok(!(await (await ic.get('/')).text()).includes('href="/payroll"'));
    const r = await coo.postJson('/roles/save', { name: 'Accounts assistant', scope: 'team', p_desk: 'view', p_sales: 'none', p_payroll: 'manage', p_company: 'view', p_analytics: 'none', p_production: 'manage', p_people: 'none' });
    assert.equal(r.status, 200); const role = listRoles(s.app.db).find((x) => x.name === 'Accounts assistant')!;
    assert.equal(role.perms.production, 'work', 'a level the module does not offer falls to the nearest one below');
    assert.equal(role.perms.people, 'view', 'modules everyone needs cannot be switched off');
    assert.equal((await coo.postJson('/roles/assign', { employeeId: me.id, roleId: role.id })).status, 200);
    assert.equal(roleOf(s.app.db, emp(s.app, SUPPORT_IC)).id, role.id);
    assert.equal((await ic.get('/pipeline')).status, 403); assert.equal((await ic.get('/analytics')).status, 403);
    assert.equal((await ic.get('/payroll')).status, 200); assert.equal((await ic.get('/company')).status, 200);
    const home = await (await ic.get('/')).text(); assert.ok(home.includes('href="/payroll"') && home.includes('href="/company"') && !home.includes('href="/pipeline"'));
    assert.equal((await ic.postJson('/tickets', { subject: 'x' })).status, 403, 'view does not allow raising a ticket');
    assert.equal(scopeFor(s.app.db, emp(s.app, SUPPORT_IC)).level, 'team');
    const check = await (await coo.get(`/roles/check?id=${me.id}`)).text(); assert.ok(check.includes('Accounts assistant') && check.includes('Run payroll'));
  });

  test('editing an automatic role changes everyone at that level; it can be put back', async () => {
    const lead = new Client(s.base); await lead.login(SUPPORT_LEAD); const id = autoRoleId(emp(s.app, SUPPORT_LEAD).department_id, 'team_lead');
    assert.equal((await lead.get('/budgets')).status, 200);
    assert.equal((await coo.postJson('/roles/save', { id, p_budgets: 'none', p_desk: 'work' })).status, 200);
    assert.equal((await lead.get('/budgets')).status, 403); assert.equal(can(s.app.db, emp(s.app, SUPPORT_LEAD), 'desk.manage'), false);
    assert.equal((await coo.postJson('/roles/reset', { id })).status, 200);
    assert.equal((await lead.get('/budgets')).status, 200); assert.equal(can(s.app.db, emp(s.app, SUPPORT_LEAD), 'desk.manage'), true);
  });

  test('deleting a role puts its people back on the automatic one; automatic roles cannot be deleted', async () => {
    const me = emp(s.app, SUPPORT_IC); const role = listRoles(s.app.db).find((x) => x.name === 'Accounts assistant')!;
    assert.equal((await coo.postJson('/roles/delete', { id: autoRoleId('SUP', 'ic') })).status, 400);
    assert.equal((await coo.postJson('/roles/delete', { id: role.id })).status, 200);
    assert.equal(roleOf(s.app.db, emp(s.app, SUPPORT_IC)).auto, true); assert.equal((await ic.get('/pipeline')).status, 200);
    assert.equal(s.app.db.get<{ role_id: string | null }>('SELECT role_id FROM employees WHERE id = ?', [me.id])!.role_id, null);
  });

  test('an administrator cannot be locked out; named Sales Head keeps deal rights; names must be unique', () => {
    const app = testApp(); const db = app.db; const coo = emp(app, COO);
    const none = saveRole(db, coo.id, null, { name: 'Nothing', perms: Object.fromEntries(MODULE_DEFS.map((m) => [m.key, 'none'])) });
    for (const m of MODULE_DEFS) assert.ok(m.levels[none.perms[m.key]] !== undefined, m.key);
    const admin = db.get<any>('SELECT * FROM employees WHERE is_admin = 1 LIMIT 1'); assert.ok(admin);
    assignRole(db, coo.id, [admin.id], none.id);
    const again = db.get<any>('SELECT * FROM employees WHERE id = ?', [admin.id]);
    assert.equal(can(db, again, 'settings.admin'), true); assert.equal(levelOf(db, again, 'desk'), 'manage');
    const head = emp(app, SALES_HEAD); assignRole(db, coo.id, [head.id], none.id);
    assert.equal(can(db, emp(app, SALES_HEAD), 'sales.manage'), true); assert.equal(can(db, emp(app, SALES_HEAD), 'sales.write'), false);
    assert.throws(() => saveRole(db, coo.id, null, { name: 'nothing' }), /already a role/);
    assert.throws(() => resetRole(db, coo.id, none.id), /automatic/);
    deleteRole(db, coo.id, none.id);
    assert.ok(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE entity = 'role' OR action = 'role'")!.n >= 4);
    assert.deepEqual(defaultPerms('NEW', 'ic').perms.desk, 'link', 'a new department starts as a basic team member');
    assert.ok(LEVELS.length === 5); void PRODUCTION_LEAD;
  });
});
