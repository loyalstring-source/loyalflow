// Daily review (DSR): morning plan, own updates, evening review, close and carry forward.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SALES_HEAD, SUPPORT_IC, SUPPORT_LEAD, DEV_LEAD } from '../helpers.ts';
import { addItem, selfUpdate, reviewItem, acceptSelfUpdates, closeDay, reopenDay, listItems, getItem, getDay, summarise, teamsFor, canLead, styleOf, saveStyles, nextWorkingDay, today, deleteItem, myItems, supportPanels } from '../../src/modules/dsr/service.ts';

const KARAN = 'karan.bhoite@loyalstring.com'; const DEV_IC = 'akash.panbhare@loyalstring.com';
let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };

describe('who runs it and how', () => {
  test('each team has a style; sales collects, support follows tickets, the rest work by task', () => {
    const app = testApp();
    assert.equal(styleOf(app, 'DEV'), 'tasks'); assert.equal(styleOf(app, 'SAL'), 'collections'); assert.equal(styleOf(app, 'SUP'), 'support');
    assert.throws(() => saveStyles(app, emp(app, KARAN), { DEV: 'off' }), /administrator or an executive/);
    saveStyles(app, emp(app, COO), { HR: 'off', DEV: 'nonsense' });
    assert.equal(styleOf(app, 'HR'), 'off'); assert.equal(styleOf(app, 'DEV'), 'tasks');
    assert.ok(!teamsFor(app, emp(app, COO)).some((t) => t.id === 'HR'));
  });
  test('the head and leads of a team run it; others see only their own team', () => {
    const app = testApp(); const karan = emp(app, KARAN); const dev = emp(app, DEV_IC);
    assert.ok(canLead(app, karan, 'DEV')); assert.ok(canLead(app, karan, 'QA'), 'he heads QA too'); assert.ok(canLead(app, emp(app, DEV_LEAD), 'DEV'));
    assert.ok(!canLead(app, dev, 'DEV')); assert.ok(!canLead(app, karan, 'SAL')); assert.ok(canLead(app, emp(app, COO), 'SAL'));
    assert.deepEqual(teamsFor(app, dev).map((t) => t.id), ['DEV']);
    assert.deepEqual(teamsFor(app, karan).map((t) => t.id).sort(), ['DEV', 'QA']);
    assert.ok(teamsFor(app, emp(app, COO)).length >= 8);
  });
});

describe('a development day', () => {
  test('plan, own update, review, close: unfinished work moves to the next working day', () => {
    const app = testApp(); const karan = emp(app, KARAN); const dev = emp(app, DEV_IC); const day = today();
    const a = addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: 'Fix login timeout', plannedHours: 3 });
    const b = addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: 'Stock report export', plannedHours: 4 });
    const c = addItem(app, dev, { deptId: 'DEV', day, employeeId: dev.id, title: 'Review pull request' });
    const d = addItem(app, karan, { deptId: 'DEV', day, employeeId: karan.id, title: 'Plan next sprint' });
    assert.equal(a.kind, 'task'); assert.equal(myItems(app, dev.id, day).length, 3);
    assert.throws(() => addItem(app, dev, { deptId: 'DEV', day, employeeId: karan.id, title: 'x' }), /your own day/);
    assert.throws(() => addItem(app, karan, { deptId: 'DEV', day, employeeId: emp(app, BDM).id, title: 'x' }), /not in Software Development/);
    assert.throws(() => addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: '' }), /Describe the task/);
    assert.throws(() => addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: 'x', ref: 'NOPE-1' }), /no board item/);
    assert.throws(() => addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: 'x', plannedHours: 30 }), /24/);

    // The developer reports first.
    selfUpdate(app, dev, a.id, { status: 'done' });
    selfUpdate(app, dev, b.id, { status: 'partial', pct: 60, note: 'Excel part left' });
    assert.throws(() => selfUpdate(app, dev, c.id, { status: 'blocked' }), /what is blocking/);
    assert.throws(() => selfUpdate(app, dev, d.id, { status: 'done' }), /your own lines/);
    assert.throws(() => reviewItem(app, dev, a.id, { status: 'done' }), /team lead reviews/);
    let sum = summarise(listItems(app, 'DEV', day));
    assert.deepEqual([sum.lines, sum.done, sum.partial, sum.waiting, sum.hours], [4, 1, 1, 2, 7]);

    // The lead confirms what was reported, then overrides one.
    assert.equal(acceptSelfUpdates(app, karan, 'DEV', day), 2);
    assert.equal(getItem(app, a.id)!.status, 'done'); assert.equal(getItem(app, b.id)!.pct, 60);
    reviewItem(app, karan, a.id, { status: 'partial', pct: 80, remark: 'Works on web, not on phone' });
    reviewItem(app, karan, d.id, { status: 'not_done', carry: 'drop' });

    const res = closeDay(app, karan, 'DEV', day, 'Good day');
    assert.equal(res.to, nextWorkingDay(app, day));
    assert.deepEqual(res.counts, { planned: 0, done: 0, partial: 2, not_done: 2, blocked: 0 });
    assert.equal(res.carried, 3, 'two partly done and the one never updated; the dropped one stays');
    assert.equal(getDay(app, 'DEV', day)!.status, 'closed');
    const next = listItems(app, 'DEV', res.to);
    assert.deepEqual(next.map((i) => i.title).sort(), ['Fix login timeout', 'Review pull request', 'Stock report export']);
    assert.ok(next.every((i) => i.carry_count === 1 && i.status === 'planned' && i.carried_from));
    assert.equal(getItem(app, c.id)!.status, 'not_done', 'no update at all counts as not done');

    // Closed means closed.
    assert.throws(() => selfUpdate(app, dev, a.id, { status: 'done' }), /closed/);
    assert.throws(() => addItem(app, karan, { deptId: 'DEV', day, employeeId: dev.id, title: 'late' }), /closed/);
    assert.throws(() => closeDay(app, karan, 'DEV', day), /already closed/);
    assert.throws(() => reopenDay(app, dev, 'DEV', day), /team lead/);

    // Reopening takes back the untouched copies; closing again does not double them.
    selfUpdate(app, dev, next.find((i) => i.title === 'Stock report export')!.id, { status: 'done' });
    assert.equal(reopenDay(app, karan, 'DEV', day), 2);
    assert.equal(listItems(app, 'DEV', res.to).length, 1);
    assert.equal(closeDay(app, karan, 'DEV', day).carried, 2);
    assert.equal(listItems(app, 'DEV', res.to).length, 3);
    // A line carried twice shows it.
    assert.throws(() => closeDay(app, karan, 'DEV', res.to), /before it arrives/);
  });
  test('a task can point at a board item and take its title', () => {
    const app = s.app; const karan = emp(app, KARAN);
    const issue = app.db.get<{ id: string; title: string; assignee_id: string }>("SELECT d.id, d.title, d.assignee_id FROM dev_issues d JOIN employees e ON e.id = d.assignee_id WHERE e.department_id = 'DEV' AND e.status = 'active' LIMIT 1")!;
    const it = addItem(app, karan, { deptId: 'DEV', day: today(), employeeId: issue.assignee_id, ref: issue.id });
    assert.equal(it.title, issue.title); assert.equal(it.ref, issue.id);
    deleteItem(app, karan, it.id); assert.equal(getItem(app, it.id), undefined);
  });
});

describe('working days', () => {
  test('unfinished work never lands on a Sunday or a holiday', () => {
    const app = testApp();
    assert.equal(nextWorkingDay(app, '2026-11-14'), '2026-11-16', 'Saturday carries to Monday');
    assert.equal(nextWorkingDay(app, '2026-11-13'), '2026-11-14', 'Friday carries to Saturday');
  });
});

describe('a sales day', () => {
  test('expected collections in the morning, amounts in the evening, the balance carries', () => {
    const app = testApp(); const head = emp(app, SALES_HEAD); const bdm = emp(app, BDM); const day = today();
    assert.throws(() => addItem(app, bdm, { deptId: 'SAL', day, employeeId: bdm.id, customer: '', amountExpected: 5000 }), /customer/);
    assert.throws(() => addItem(app, bdm, { deptId: 'SAL', day, employeeId: bdm.id, customer: 'Omkar Tech' }), /amount expected/);
    const a = addItem(app, bdm, { deptId: 'SAL', day, employeeId: bdm.id, customer: 'Omkar Tech', amountExpected: 100000, title: 'Invoice 114' });
    const b = addItem(app, head, { deptId: 'SAL', day, employeeId: bdm.id, customer: 'Shree Jewels', amountExpected: 40000 });
    const c = addItem(app, head, { deptId: 'SAL', day, employeeId: head.id, customer: 'Kalyan Gold', amountExpected: 25000 });
    assert.equal(a.kind, 'collection');
    selfUpdate(app, bdm, a.id, { amount: 60000, note: 'Balance on Friday' });
    selfUpdate(app, bdm, b.id, { amount: 40000 });
    let sum = summarise(listItems(app, 'SAL', day));
    assert.deepEqual([sum.expected, sum.collected, sum.done, sum.partial, sum.waiting], [165000, 100000, 1, 1, 1]);
    reviewItem(app, head, a.id, { amount: 50000, remark: 'Bank shows 50,000' });
    assert.equal(getItem(app, a.id)!.status, 'partial');
    const res = closeDay(app, head, 'SAL', day);
    assert.deepEqual(res.counts, { planned: 0, done: 1, partial: 1, not_done: 1, blocked: 0 });
    const next = listItems(app, 'SAL', res.to).sort((x, y) => x.customer.localeCompare(y.customer));
    assert.deepEqual(next.map((i) => [i.customer, i.amount_expected]), [['Kalyan Gold', 25000], ['Omkar Tech', 50000]]);
    assert.equal(getItem(app, b.id)!.amount_actual, 40000, 'the own figure stands when the lead did not change it');
    assert.equal(getItem(app, c.id)!.status, 'not_done');
  });
});

describe('a support day', () => {
  test("shows yesterday's tickets, what is pending and implementations, with follow-up tasks", () => {
    const app = s.app; const lead = emp(app, SUPPORT_LEAD); const ic = emp(app, SUPPORT_IC); const day = today();
    const p = supportPanels(app, day);
    assert.ok(p.pendingTotal >= p.pending.length); assert.ok(p.pending.every((t) => t.days >= 0)); assert.ok(Array.isArray(p.impl)); assert.ok(p.yesterday < day);
    const ticket = app.db.get<{ id: string; subject: string }>("SELECT id, subject FROM tickets WHERE status NOT IN ('resolved', 'closed') LIMIT 1")!;
    const it = addItem(app, lead, { deptId: 'SUP', day, employeeId: ic.id, ref: ticket.id });
    assert.equal(it.title, ticket.subject); assert.equal(it.kind, 'task');
  });
});

describe('over HTTP', () => {
  test('the lead plans and closes on the page; a team member updates only their own line', async () => {
    const day = today(); const karan = await login(KARAN); const dev = await login(DEV_IC); const devId = emp(s.app, DEV_IC).id;
    const page = await (await karan.get('/dsr')).text();
    assert.match(page, /Daily review · Software Development/); assert.match(page, /action="\/dsr\/items"/);
    const add = await karan.postJson('/dsr/items', { team: 'DEV', day, employeeId: devId, title: 'Barcode label fix', plannedHours: 2 });
    assert.equal(add.status, 200); assert.equal(add.json.ok, true);
    const id = listItems(s.app, 'DEV', day).find((i) => i.title === 'Barcode label fix')!.id;
    assert.equal((await dev.postJson(`/dsr/items/${id}/review`, { status: 'done' })).status, 403);
    assert.equal((await dev.postJson(`/dsr/items/${id}/self`, { status: 'partial', pct: 40, note: 'Printer driver' })).json.ok, true);
    const mine = await (await dev.get('/dsr')).text();
    assert.match(mine, /Barcode label fix/); assert.ok(!mine.includes('Close the day'));
    assert.match(await (await karan.get('/dsr')).text(), /Confirm 1 from own updates/);
    assert.equal((await dev.postJson('/dsr/close', { team: 'DEV', day })).status, 403);
    assert.equal((await karan.postJson('/dsr/accept', { team: 'DEV', day })).json.ok, true);
    assert.equal((await karan.postJson('/dsr/close', { team: 'DEV', day })).json.ok, true);
    const closed = await (await karan.get(`/dsr?team=DEV&day=${day}`)).text();
    assert.match(closed, /This day is closed/); assert.match(closed, /Partly done 40%/); assert.match(closed, /Reopen/);
    assert.equal((await dev.postJson(`/dsr/items/${id}/self`, { status: 'done' })).status, 409);
    // Sales and support pages draw, and the style page is for executives only.
    const sales = await login(SALES_HEAD); assert.match(await (await sales.get('/dsr')).text(), /Collections expected today/);
    const sup = await login(SUPPORT_LEAD); assert.match(await (await sup.get('/dsr')).text(), /Pending, oldest first/);
    assert.equal((await karan.get('/dsr/settings')).status, 403);
    const coo = await login(COO); assert.equal((await coo.get('/dsr/settings')).status, 200);
    assert.match(await (await coo.get('/dsr?team=SAL')).text(), /Daily review · Sales/);
  });
});
