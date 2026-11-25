// My work and Team at work: pending items, starting, breaks, passing a task on, and who can watch.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SUPPORT_IC } from '../helpers.ts';
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
