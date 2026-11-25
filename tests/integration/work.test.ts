// My work and Team at work: pending items, starting, breaks, passing a task on, and who can watch.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SUPPORT_IC, SUPPORT_LEAD } from '../helpers.ts';
import { createTask, getTask, completeTask } from '../../src/modules/tasks/service.ts';
import { startWork, takeBreak, resumeWork, stopWork, openSession, pendingFor, dayOf, canWatch, watchable, colleagues, passTask } from '../../src/modules/work/service.ts';
import { localDateString } from '../../src/lib/time.ts';

const KARAN = 'karan.bhoite@loyalstring.com'; const DEV = 'akash.panbhare@loyalstring.com'; const DEV2 = 'anant.sahu@loyalstring.com';
const at = (h: number, m = 0): Date => { const d = new Date(); d.setUTCHours(h, m, 0, 0); return d; };

describe('work in hand', () => {
  test('a task from the lead shows in the member\'s pending work; start, break, resume and stop are timed', () => {
    const app = testApp(); const karan = emp(app, KARAN); const dev = emp(app, DEV); const day = localDateString(at(4));
    const t = createTask(app, karan, { title: 'Fix label printing', assigneeId: dev.id, requesterId: karan.id });
    const mine = pendingFor(app, dev.id, day, at(4)); const p = mine.find((x) => x.type === 'task' && x.id === t.id)!;
    assert.ok(p); assert.equal(p.from, karan.full_name); assert.equal(p.minutes, 0);
    assert.throws(() => startWork(app, karan, 'task', t.id, at(4)), /not assigned to you/);
    assert.throws(() => takeBreak(app, dev, 'Tea', at(4)), /Start a task first/);
    startWork(app, dev, 'task', t.id, at(4, 0)); assert.equal(getTask(app, t.id)!.status, 'in_progress'); assert.equal(openSession(app, dev.id)!.kind, 'work');
    const b = takeBreak(app, dev, 'Tea', at(4, 40)); assert.equal(b.kind, 'break'); assert.equal(b.note, 'Tea'); assert.equal(getTask(app, t.id)!.minutes_logged, 40);
    resumeWork(app, dev, at(4, 55)); const s = stopWork(app, dev, at(5, 25))!; assert.equal(s.minutes, 30);
    assert.equal(getTask(app, t.id)!.minutes_logged, 70); assert.equal(openSession(app, dev.id), undefined);
    const d = dayOf(app, [{ id: dev.id, full_name: dev.full_name, designation: '', team: '' }], day, at(6))[0];
    assert.deepEqual([d.workedMin, d.breakMin, d.breaks, d.sessions.length, d.state], [70, 15, 1, 3, 'idle']);
    assert.equal(pendingFor(app, dev.id, day, at(6)).find((x) => x.id === t.id)!.minutes, 70);
  });
  test('one thing at a time: starting another item stops the first; finishing a task stops its timer', () => {
    const app = testApp(); const dev = emp(app, DEV); const a = createTask(app, dev, { title: 'First thing', assigneeId: dev.id }); const b = createTask(app, dev, { title: 'Second thing', assigneeId: dev.id });
    startWork(app, dev, 'task', a.id, at(4)); startWork(app, dev, 'task', b.id, at(4, 20));
    assert.equal(getTask(app, a.id)!.minutes_logged, 20); assert.equal(openSession(app, dev.id)!.entity_id, b.id);
    completeTask(app, dev, b.id); assert.equal(openSession(app, dev.id), undefined); assert.equal(getTask(app, b.id)!.status, 'done');
    assert.throws(() => startWork(app, dev, 'task', b.id), /already finished/);
  });
  test('a timer left running overnight counts for at most 10 hours', () => {
    const app = testApp(); const dev = emp(app, DEV); const a = createTask(app, dev, { title: 'Forgotten timer', assigneeId: dev.id });
    const start = new Date(Date.now() - 30 * 3600_000); startWork(app, dev, 'task', a.id, start); const s = stopWork(app, dev)!; assert.equal(s.minutes, 600);
  });
  test('a member passes a task to a team-mate, not to another team; the giver is told', () => {
    const app = testApp(); const karan = emp(app, KARAN); const dev = emp(app, DEV); const dev2 = emp(app, DEV2); const sales = emp(app, BDM);
    const t = createTask(app, karan, { title: 'Printer driver fault', assigneeId: dev.id, requesterId: karan.id }); startWork(app, dev, 'task', t.id);
    assert.ok(colleagues(app, dev).some((e) => e.id === dev2.id)); assert.ok(!colleagues(app, dev).some((e) => e.id === sales.id));
    assert.throws(() => passTask(app, dev, t.id, sales.id, ''), /someone in your team/); assert.throws(() => passTask(app, dev2, t.id, dev.id, ''), /assigned to you/);
    passTask(app, dev, t.id, dev2.id, 'Hardware, better with you');
    const after = getTask(app, t.id)!; assert.equal(after.assignee_id, dev2.id); assert.equal(after.status, 'open'); assert.match(after.details, /Passed on by .* Hardware, better with you/); assert.equal(openSession(app, dev.id), undefined);
    assert.ok(pendingFor(app, dev2.id, localDateString(new Date())).some((x) => x.id === t.id));
    assert.ok(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND title LIKE '%passed%'", [karan.id])!.n >= 1);
  });
  test('leads see their people, executives see everyone, others see only themselves', () => {
    const app = testApp(); const karan = emp(app, KARAN); const coo = emp(app, COO); const ic = emp(app, SUPPORT_IC);
    assert.ok(canWatch(app, karan)); assert.ok(canWatch(app, coo)); assert.ok(!canWatch(app, ic));
    assert.ok(watchable(app, coo).length > 30); assert.ok(watchable(app, karan, karan.department_id).every((e) => e.department_id === karan.department_id));
  });
});

describe('work in hand, in the browser', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
  test('the member starts and takes a break; the lead and the COO see it; an ordinary member cannot open the team page', async () => {
    const karan = await login(KARAN); const dev = await login(DEV); const devId = emp(s.app, DEV).id;
    assert.equal((await karan.postJson('/tasks', { title: 'Check barcode scanner build', assigneeId: devId })).status, 200);
    const id = s.app.db.get<{ id: string }>("SELECT id FROM tasks WHERE title = 'Check barcode scanner build'")!.id;
    let page = await (await dev.get('/tasks')).text(); assert.match(page, /Pending for me/); assert.match(page, /Check barcode scanner build/); assert.match(page, /from Karan/); assert.match(page, /not working on anything/);
    assert.equal((await dev.postJson('/work/start', { type: 'task', id })).status, 200);
    page = await (await dev.get('/tasks')).text(); assert.match(page, /Working since/); assert.match(page, /Take a break/);
    assert.equal((await dev.postJson('/work/break', { reason: 'Lunch' })).status, 200);
    page = await (await dev.get('/tasks')).text(); assert.match(page, /On a break · Lunch/); assert.match(page, /Back to work/);
    const team = await (await karan.get('/tasks/team')).text(); assert.match(team, /Team at work/); assert.match(team, /On a break: Lunch/); assert.match(team, /Check barcode scanner build/);
    const all = await (await (await login(COO)).get('/tasks/team')).text(); assert.match(all, /On a break: Lunch/); assert.match(all, /All teams/);
    assert.equal((await dev.postJson('/work/resume', {})).status, 200); assert.equal((await dev.postJson('/work/stop', {})).status, 200);
    assert.equal((await (await login(SUPPORT_IC)).get('/tasks/team')).status, 403);
    assert.equal((await dev.postJson('/work/start', { type: 'ticket', id: 'NOPE' })).status, 404);
  });
});

describe('boards: drag a tile, or remark on it', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
  test('a ticket moves between columns with a remark; a remark alone is kept; it cannot go back to New', async () => {
    const lead = await login(SUPPORT_LEAD); const board = await (await lead.get('/desk')).text();
    assert.match(board, /data-board="\/tickets\/"/); assert.match(board, /data-drop="in_progress"/); assert.match(board, /data-card-remark/); assert.ok(!board.includes('data-drop="new"'));
    const t = s.app.db.get<{ id: string }>("SELECT id FROM tickets WHERE status = 'assigned' LIMIT 1")!; const st = (): string => s.app.db.get<{ status: string }>('SELECT status FROM tickets WHERE id = ?', [t.id])!.status;
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { to: 'in_progress', note: 'Called the customer' })).status, 200); assert.equal(st(), 'in_progress');
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { to: 'waiting' })).status, 200); assert.equal(st(), 'waiting_customer');
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { note: 'Firmware file awaited' })).status, 200); assert.equal(st(), 'waiting_customer');
    const page = await (await lead.get(`/tickets/${t.id}`)).text(); assert.match(page, /Called the customer/); assert.match(page, /Firmware file awaited/);
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { to: 'resolved', note: 'Fixed' })).status, 200); assert.equal(st(), 'resolved');
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { to: 'in_progress', note: 'Came back' })).status, 200); assert.notEqual(st(), 'resolved');
    assert.equal((await lead.postJson(`/tickets/${t.id}/move`, { to: 'new' })).status, 400); assert.equal((await lead.postJson(`/tickets/${t.id}/move`, {})).status, 400);
    assert.equal((await (await login(BDM)).postJson(`/tickets/${t.id}/move`, { to: 'assigned' })).status, 403);
  });
  test('a board item moves between columns and takes a remark', async () => {
    const karan = await login(KARAN); const board = await (await karan.get('/dev')).text(); assert.match(board, /data-board="\/dev\/"/); assert.match(board, /data-drop="in_review"/);
    const i = s.app.db.get<{ id: string }>("SELECT id FROM dev_issues WHERE status = 'planned' LIMIT 1") || s.app.db.get<{ id: string }>("SELECT id FROM dev_issues WHERE status = 'backlog' LIMIT 1")!;
    assert.equal((await karan.postJson(`/dev/${i.id}/move`, { to: 'in_progress', note: 'Picked up today' })).status, 200);
    assert.equal(s.app.db.get<{ status: string }>('SELECT status FROM dev_issues WHERE id = ?', [i.id])!.status, 'in_progress');
    assert.ok(s.app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM issue_comments WHERE issue_id = ? AND text LIKE '%Picked up today%'", [i.id])!.n >= 1);
    assert.equal((await karan.postJson(`/dev/${i.id}/move`, { to: 'nowhere' })).status, 400);
  });
  test('the home page lists what is assigned to the person; the COO signs in with the new address', async () => {
    const karan = await login(KARAN); const devId = emp(s.app, DEV).id; await karan.postJson('/tasks', { title: 'Review the tag import screen', assigneeId: devId });
    const home = await (await (await login(DEV)).get('/')).text(); assert.match(home, /Assigned to you/); assert.match(home, /Review the tag import screen/); assert.match(home, /data-post="\/work\/start"/);
    assert.equal(COO, 'sridhar.ngowda@loyalstring.com'); assert.equal(emp(s.app, COO).id, 'LS002');
  });
});

describe('the app menu', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  test('every page has an icon and a pin; a person\'s order and pins are kept for them alone', async () => {
    const coo = new Client(s.base); await coo.login(COO); const bdm = new Client(s.base); await bdm.login(BDM);
    const order = (h: string): string[] => [...h.matchAll(/class="lm-card" data-mod="([\w:]+)"/g)].map((m) => m[1]);
    let page = await (await coo.get('/my-day')).text(); assert.match(page, /data-launcher/); assert.match(page, /data-lm-search/); assert.match(page, /class="lm-grip" draggable="true"/); assert.match(page, /data-lm-star/);
    assert.deepEqual(order(page).slice(0, 2), ['home', 'sales']); assert.ok(order(page).includes('admin'));
    assert.equal((await coo.postJson('/me/menu', { order: ['people', 'company', 'home'], pins: ['hire', 'desk', 'hire', '<bad>'] })).status, 200);
    page = await (await coo.get('/my-day')).text(); assert.deepEqual(order(page).slice(0, 3), ['people', 'company', 'home']); assert.ok(order(page).includes('sales'), 'cards not named keep their place after the named ones');
    assert.match(page, /class="lm-pin" href="\/hire" data-pin="hire"/); assert.match(page, /data-pin="desk"/); assert.equal((page.match(/class="lm-pin"/g) || []).length, 2);
    assert.deepEqual(order(await (await bdm.get('/')).text()).slice(0, 2), ['home', 'sales'], 'another person is not affected');
    await coo.postJson('/me/menu', { order: [], pins: [] }); assert.deepEqual(order(await (await coo.get('/my-day')).text()).slice(0, 2), ['home', 'sales']);
  });
});
