// Company overview, monthly targets, who may set them, and administrators.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SALES_HEAD, SUPPORT_IC } from '../helpers.ts';
import { measures, targetFor, saveTargets, canSetTargets, grantSetter, revokeSetter, listSetters, setAdmin, listAdmins, buildBrief, briefSettings, saveBriefSettings, workingDays, addMonths, today, teamsUserSees, fmt } from '../../src/modules/brief/service.ts';
import { addItem, selfUpdate } from '../../src/modules/dsr/service.ts';

const KARAN = 'karan.bhoite@loyalstring.com'; const DEV_IC = 'akash.panbhare@loyalstring.com';
let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const month = today().slice(0, 7);

describe('measures and targets', () => {
  test('every team with a daily review or its own figures has a measure', () => {
    const app = testApp(); const ms = measures(app); const keys = ms.map((m) => m.key);
    for (const k of ['sales_won', 'collections', 'tickets_in_time', 'on_time_dispatch', 'roles_filled', 'attendance', 'spend', 'tasks_done:DEV', 'tasks_done:QA']) assert.ok(keys.includes(k), k);
    assert.ok(!keys.some((k) => k.endsWith(':LEAD') || k.endsWith(':SAL')));
    assert.equal(new Set(keys).size, keys.length);
  });
  test('working days leave out Sundays', () => { assert.equal(workingDays(testApp(), '2026-11-15', '2026-11-15'), 0, 'a Sunday'); assert.equal(workingDays(testApp(), '2026-11-16', '2026-11-21'), 6, 'Monday to Saturday'); assert.equal(workingDays(testApp(), '2026-11-16', '2026-11-15'), 0); });
  test('a target carries on from the last month it was set; managers set their own team only', () => {
    const app = testApp(); const karan = emp(app, KARAN); const head = emp(app, SALES_HEAD); const dev = emp(app, DEV_IC); const coo = emp(app, COO);
    const won = measures(app).find((m) => m.key === 'sales_won')!; const tasks = measures(app).find((m) => m.key === 'tasks_done:DEV')!;
    assert.deepEqual([targetFor(app, won, month).source, targetFor(app, won, month).value], ['default', 6_000_000]);
    assert.equal(saveTargets(app, head, month, { sales_won: 7_500_000, collections: '' }), 1);
    assert.deepEqual([targetFor(app, won, month).source, targetFor(app, won, month).value, targetFor(app, won, month).setBy], ['set', 7_500_000, head.full_name]);
    assert.deepEqual([targetFor(app, won, addMonths(month, 2)).source, targetFor(app, won, addMonths(month, 2)).value], ['carried', 7_500_000]);
    assert.equal(targetFor(app, won, addMonths(month, -1)).source, 'default', 'earlier months are not rewritten');
    assert.equal(saveTargets(app, head, month, { sales_won: 7_500_000 }), 0, 'saving the same figure changes nothing');
    assert.throws(() => saveTargets(app, head, month, { 'tasks_done:DEV': 90 }), /cannot set the target/);
    assert.throws(() => saveTargets(app, karan, month, { 'tasks_done:DEV': 120 }), /more than 100/);
    assert.throws(() => saveTargets(app, karan, month, { 'tasks_done:DEV': -1 }), /above zero/);
    assert.throws(() => saveTargets(app, karan, addMonths(month, -1), { 'tasks_done:DEV': 80 }), /past month/);
    assert.equal(saveTargets(app, coo, addMonths(month, -1), { 'tasks_done:DEV': 80 }), 1);
    assert.equal(saveTargets(app, karan, month, { 'tasks_done:DEV': 88, 'tasks_done:QA': 92 }), 2, 'he heads both teams');
    assert.equal(targetFor(app, tasks, month).value, 88);
    assert.ok(!canSetTargets(app, dev, 'DEV')); assert.throws(() => saveTargets(app, dev, month, { 'tasks_done:DEV': 50 }), /cannot set/);
  });
  test('an administrator can let more people set targets, for one team or all', () => {
    const app = testApp(); const coo = emp(app, COO); const dev = emp(app, DEV_IC); const bdm = emp(app, BDM);
    assert.throws(() => grantSetter(app, emp(app, KARAN), dev.id, 'DEV'), /administrator or an executive/);
    grantSetter(app, coo, dev.id, 'DEV'); grantSetter(app, coo, bdm.id, '*'); grantSetter(app, coo, bdm.id, '*');
    assert.equal(listSetters(app).length, 2);
    assert.ok(canSetTargets(app, dev, 'DEV')); assert.ok(!canSetTargets(app, dev, 'SAL')); assert.ok(canSetTargets(app, bdm, 'SUP'));
    assert.equal(saveTargets(app, dev, month, { 'tasks_done:DEV': 91 }), 1);
    revokeSetter(app, coo, dev.id, 'DEV'); assert.ok(!canSetTargets(app, dev, 'DEV'));
    assert.throws(() => grantSetter(app, coo, 'NOPE', 'DEV'), /active person/); assert.throws(() => grantSetter(app, coo, dev.id, 'NOPE'), /Choose a team/);
  });
});

describe('administrators', () => {
  test('an executive names an administrator, who can then manage everything', () => {
    const app = testApp(); const coo = emp(app, COO); const ic = emp(app, SUPPORT_IC);
    assert.throws(() => setAdmin(app, ic, ic.id, true), /administrator or an executive/);
    setAdmin(app, coo, ic.id, true);
    const admin = emp(app, SUPPORT_IC); assert.equal(admin.is_admin, 1);
    assert.ok(listAdmins(app).some((a) => a.id === ic.id && a.is_admin));
    assert.equal(saveTargets(app, admin, month, { sales_won: 5_000_000 }), 1);
    assert.equal(teamsUserSees(app, admin).length, teamsUserSees(app, coo).length);
    grantSetter(app, admin, emp(app, BDM).id, 'SAL');
    setAdmin(app, admin, ic.id, false); assert.equal(emp(app, SUPPORT_IC).is_admin, 0);
  });
});

describe('the overview', () => {
  test('figures, projection and outlook follow the daily review and the target', () => {
    const app = testApp(); const head = emp(app, SALES_HEAD); const bdm = emp(app, BDM); const coo = emp(app, COO); const day = today();
    const it = addItem(app, head, { deptId: 'SAL', day, employeeId: bdm.id, customer: 'Omkar Tech', amountExpected: 200000 });
    selfUpdate(app, bdm, it.id, { amount: 150000 });
    saveTargets(app, head, month, { collections: 100000 });
    const b = buildBrief(app, coo); const row = b.rows.find((r) => r.m.key === 'collections')!;
    assert.equal(row.mtd, 150000); assert.equal(row.pctOfTarget, 150); assert.equal(row.tone, 'good'); assert.equal(row.outlook, 'Will meet');
    assert.ok(row.projected! >= 150000); assert.equal(row.dsrToday!.text, '₹1.5 L of ₹2 L in'); assert.equal(row.weeks.length, 8); assert.equal(row.days.length, 6);
    assert.equal(b.week.collected[0], 150000); assert.equal(b.monthView.cum.at(-1)!.value, 150000); assert.equal(b.monthView.met.length, 6);
    saveTargets(app, head, month, { collections: 90_000_000 });
    const b2 = buildBrief(app, coo); const r2 = b2.rows.find((r) => r.m.key === 'collections')!;
    assert.equal(r2.tone, 'crit'); assert.match(r2.outlook, /^Short by ₹/); assert.ok(b2.attention.some((a) => a.team === 'Sales' && /Collections: short by/.test(a.title)));
    // A team manager sees only the teams they lead; someone who leads nothing sees no rows.
    const kb = buildBrief(app, emp(app, KARAN)); assert.deepEqual([...new Set(kb.rows.map((r) => r.teamId))].sort(), ['DEV', 'QA']); assert.equal(kb.people, null); assert.equal(kb.money, null);
    assert.equal(buildBrief(app, bdm).rows.length, 0);
    // Graph cards: one per team with figures, in team order; teams with nothing to draw are named instead.
    assert.equal(b.charts[0].teamCode, 'SAL'); assert.equal(b.charts[0].series.length, 2); assert.equal(b.charts[0].labels.length, 6); assert.equal(b.charts[0].series[1][5], 150000);
    assert.ok(b.charts.some((c) => c.teamCode === 'SUP' && c.type === 'lines')); assert.ok(b.noCharts.includes('QA'));
    assert.ok(kb.charts.every((c) => ['DEV', 'QA'].includes(c.teamCode)));
    assert.equal(fmt('inr', 4_850_000), '₹48.5 L'); assert.equal(fmt('pct', 86), '86%'); assert.equal(fmt('inr', null), '—');
  });
  test('how long each view stays can be changed by an administrator or executive only', () => {
    const app = testApp(); assert.deepEqual(briefSettings(app), { seconds: 60, rotate: true });
    assert.throws(() => saveBriefSettings(app, emp(app, KARAN), { seconds: 30 }), /administrator or an executive/);
    assert.throws(() => saveBriefSettings(app, emp(app, COO), { seconds: 5 }), /15 seconds/);
    assert.deepEqual(saveBriefSettings(app, emp(app, COO), { seconds: 90 }), { seconds: 90, rotate: false });
    assert.deepEqual(saveBriefSettings(app, emp(app, COO), { seconds: 45, rotate: 'on' }), { seconds: 45, rotate: true });
  });
});

describe('over HTTP', () => {
  test('executives land on the overview; managers get their team; everyone else keeps their own day', async () => {
    const coo = await login(COO); const home = await (await coo.get('/')).text();
    assert.match(home, /Company overview/); assert.match(home, /What needs your attention/); assert.match(home, /class="card bf-card"/); assert.match(home, /Won and collected by month/); assert.ok(home.indexOf('bf-cards') < home.indexOf('What needs your attention'), 'graphs come first'); assert.match(home, /data-bf-view="week"/); assert.match(home, /data-bf-view="month"/); assert.match(home, /data-seconds="60"/);
    assert.match(home, /href="\/my-day"/); assert.match(await (await coo.get('/my-day')).text(), /Good (morning|afternoon|evening)/);
    assert.match(await (await coo.get('/?view=month')).text(), /data-start="month"/);
    const karan = await login(KARAN); const kHome = await (await karan.get('/')).text();
    assert.ok(!kHome.includes('What needs your attention'), 'a manager still lands on his own day'); assert.match(kHome, /href="\/overview"/);
    const team = await (await karan.get('/overview')).text(); assert.match(team, /Team overview/); assert.match(team, /Software Development/); assert.ok(!team.includes('Money this month'));
    const ic = await login(DEV_IC); assert.equal((await ic.get('/overview')).status, 403); assert.equal((await ic.get('/targets')).status, 403); assert.equal((await ic.get('/admins')).status, 403);
    assert.ok(!(await (await ic.get('/')).text()).includes('href="/targets"'));
  });
  test('targets, access and administrators are managed on their pages', async () => {
    const coo = await login(COO); const karan = await login(KARAN); const devId = emp(s.app, DEV_IC).id;
    const page = await (await karan.get('/targets')).text();
    assert.match(page, /name="tasks_done:DEV"/); assert.ok(!page.includes('name="sales_won"')); assert.ok(!page.includes('Who else can set targets'));
    assert.equal((await karan.postJson('/targets/save', { month, 'tasks_done:DEV': 87 })).json.ok, true);
    assert.equal((await karan.postJson('/targets/save', { month, sales_won: 1 })).status, 403);
    assert.equal((await karan.postJson('/targets/access/grant', { employeeId: devId, team: 'DEV' })).status, 403);
    const all = await (await coo.get('/targets')).text(); assert.match(all, /Who else can set targets/); assert.match(all, /name="sales_won"/); assert.match(all, /Set by Karan/);
    assert.equal((await coo.postJson('/targets/access/grant', { employeeId: devId, team: 'DEV' })).json.ok, true);
    const ic = await login(DEV_IC); assert.equal((await ic.get('/targets')).status, 200); assert.equal((await ic.postJson('/targets/save', { month, 'tasks_done:DEV': 80 })).json.ok, true);
    assert.equal((await coo.postJson('/targets/display', { seconds: 30, rotate: 'on' })).json.ok, true); assert.match(await (await coo.get('/')).text(), /data-seconds="30"/);
    assert.equal((await karan.postJson('/admins/set', { employeeId: devId, on: true })).status, 403);
    assert.equal((await coo.postJson('/admins/set', { employeeId: devId, on: true })).json.ok, true);
    assert.match(await (await coo.get('/admins')).text(), /Akash Panbhare/);
    assert.match(await (await ic.get('/')).text(), /Company overview/, 'the new administrator now lands on the overview');
    assert.equal((await ic.get('/roles')).status, 200); assert.equal((await ic.get('/settings')).status, 200);
  });
});

describe('reports seen from above', () => {
  test('people who lead a team open on the floor; the list is one click away; others keep the list', async () => {
    const coo = await login(COO); const top = await (await coo.get('/reports')).text();
    assert.match(top, /class="floor"/); assert.match(top, /href="#team-SAL"/); assert.match(top, /id="team-SAL"/); assert.match(top, /class="bars3d"/); assert.match(top, /Show as a list/);
    const list = await (await coo.get('/reports?view=list')).text(); assert.ok(!list.includes('class="floor"')); assert.match(list, /report-grid/); assert.match(list, /View from above/);
    const sales = await (await coo.get('/reports?module=sales')).text(); assert.ok(!sales.includes('class="floor"'), 'the reports of one module stay a list');
    const karan = await (await (await login(KARAN)).get('/reports')).text(); assert.match(karan, /class="floor"/); assert.ok(!karan.includes('id="team-SAL"'), 'a manager sees only the teams he leads');
    const ic = await (await (await login(BDM)).get('/reports')).text(); assert.ok(!ic.includes('class="floor"'));
  });
});
