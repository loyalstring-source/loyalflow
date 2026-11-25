// Expenses on to Accounts: reimbursements, advances, advance settlements, documents, the ledger and its reports.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SUPPORT_IC } from '../helpers.ts';
import { decideTask } from '../../src/modules/tasks/service.ts';
import { submitClaim, getClaim, markPaid, settleAdvance, advanceState, addDoc, readDoc, listDocs, ledger, balanceOf, accountsDesk, isAccounts, canSee } from '../../src/modules/money/service.ts';
import { measures, today } from '../../src/modules/brief/service.ts';
import type { App } from '../../src/app.ts';
import type { Employee } from '../../src/modules/people/model.ts';

const ACC = 'mahesh.mapari@loyalstring.com';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex').toString('base64');
const approve = (app: App, id: string): void => { const c = getClaim(app, id)!; const t = app.db.get<{ assignee_id: string }>('SELECT assignee_id FROM tasks WHERE id = ?', [c.task_id])!; decideTask(app, app.db.get<Employee>('SELECT * FROM employees WHERE id = ?', [t.assignee_id])!, c.task_id!, 'approved'); };
const pay = { mode: 'Bank transfer', ref: 'NEFT123456' };

describe('expenses go on to Accounts', () => {
  test('a reimbursement: approved, owed in the ledger, paid by Accounts with a bill, and the balance returns to nil', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC); const before = balanceOf(app, bdm.id);
    const c = submitClaim(app, bdm, { category: 'Travel', amount: 3200, description: 'Taxi to the customer' });
    assert.equal(c.kind, 'reimbursement'); assert.equal(c.status, 'pending'); assert.equal(ledger(app, { employeeId: bdm.id }).filter((e) => e.expense_id === c.id).length, 0, 'nothing in the ledger before approval');
    approve(app, c.id); assert.equal(getClaim(app, c.id)!.status, 'approved'); assert.equal(balanceOf(app, bdm.id), before - 3200, 'the company owes the person');
    assert.ok(accountsDesk(app).toPay.some((x) => x.id === c.id));
    assert.ok(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND title LIKE 'To pay:%'", [acc.id])!.n >= 1, 'Accounts is told');
    assert.throws(() => markPaid(app, bdm, c.id, pay), /recorded by Accounts/);
    assert.throws(() => markPaid(app, acc, c.id, pay), /no bill attached/);
    addDoc(app, bdm, c.id, 'bill', PNG, 'taxi bill.png'); assert.equal(listDocs(app, c.id).length, 1);
    assert.throws(() => markPaid(app, acc, c.id, { mode: 'Bank transfer', ref: '' }), /transaction or cheque number/);
    assert.throws(() => markPaid(app, acc, c.id, { mode: 'UPI', ref: 'UPI9', date: '2999-01-01' }), /future/);
    const paid = markPaid(app, acc, c.id, { ...pay, doc: PNG, docName: 'payment.png' });
    assert.deepEqual([paid.status, paid.pay_mode, paid.pay_ref, paid.paid_by], ['paid', 'Bank transfer', 'NEFT123456', acc.id]); assert.equal(balanceOf(app, bdm.id), before);
    assert.deepEqual(listDocs(app, c.id).map((d) => d.kind), ['bill', 'payment']);
    assert.throws(() => markPaid(app, acc, c.id, pay), /already been paid/);
    assert.deepEqual(ledger(app, { employeeId: bdm.id }).filter((e) => e.expense_id === c.id).map((e) => [e.type, e.debit, e.credit]), [['claim_approved', 0, 3200], ['claim_paid', 3200, 0]]);
  });
  test('cash needs no reference; a declined claim never reaches Accounts or the ledger', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC);
    const c = submitClaim(app, bdm, { category: 'Food', amount: 450, description: 'Lunch with customer', doc: PNG, docName: 'bill.png' }); approve(app, c.id);
    assert.equal(markPaid(app, acc, c.id, { mode: 'Cash' }).status, 'paid');
    const d = submitClaim(app, bdm, { category: 'Food', amount: 900, description: 'Dinner' }); const t = app.db.get<{ id: string; assignee_id: string }>('SELECT id, assignee_id FROM tasks WHERE id = ?', [getClaim(app, d.id)!.task_id])!;
    decideTask(app, app.db.get<Employee>('SELECT * FROM employees WHERE id = ?', [t.assignee_id])!, t.id, 'declined', 'Not a business expense');
    assert.equal(getClaim(app, d.id)!.status, 'declined'); assert.ok(!accountsDesk(app).toPay.some((x) => x.id === d.id)); assert.equal(ledger(app).filter((e) => e.expense_id === d.id).length, 0);
  });
  test('an advance: given, bills accepted against it, the unspent part returned, then settled', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC); const before = balanceOf(app, bdm.id);
    const a = submitClaim(app, bdm, { kind: 'advance', category: 'Travel', amount: 10000, description: 'Exhibition in Mumbai' });
    assert.throws(() => submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 100, description: 'Too early' }), /not been given/);
    approve(app, a.id); assert.equal(balanceOf(app, bdm.id), before, 'an approved advance moves nothing until it is given');
    markPaid(app, acc, a.id, pay); assert.equal(getClaim(app, a.id)!.status, 'paid'); assert.equal(balanceOf(app, bdm.id), before + 10000, 'the person holds company money');
    const s = submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 7400, description: 'Train and hotel', doc: PNG, docName: 'hotel.png' });
    assert.equal(s.advance_id, a.id); assert.equal(advanceState(app, a.id).pendingBills, 7400);
    assert.throws(() => settleAdvance(app, acc, a.id, { mode: 'Cash' }), /waiting for approval/);
    approve(app, s.id); assert.deepEqual([advanceState(app, a.id).billed, advanceState(app, a.id).balance], [7400, 2600]); assert.equal(getClaim(app, a.id)!.status, 'paid');
    assert.throws(() => settleAdvance(app, acc, a.id, { mode: 'Cash', amount: 5000 }), /cannot be more than/);
    settleAdvance(app, acc, a.id, { mode: 'Cash', amount: 1000 }); assert.equal(advanceState(app, a.id).balance, 1600); assert.equal(getClaim(app, a.id)!.status, 'paid');
    settleAdvance(app, acc, a.id, { mode: 'UPI', ref: 'UPI55667' }); assert.equal(getClaim(app, a.id)!.status, 'settled'); assert.equal(balanceOf(app, bdm.id), before);
    assert.throws(() => submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 100, description: 'Late bill' }), /already settled/);
  });
  test('spending above the advance: Accounts pays the difference', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC); const before = balanceOf(app, bdm.id);
    const a = submitClaim(app, bdm, { kind: 'advance', category: 'Travel', amount: 5000, description: 'Site visit' }); approve(app, a.id); markPaid(app, acc, a.id, { mode: 'Cash' });
    const s = submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 6200, description: 'Hotel and travel', doc: PNG, docName: 'b.png' }); approve(app, s.id);
    assert.equal(advanceState(app, a.id).balance, -1200); assert.equal(balanceOf(app, bdm.id), before - 1200);
    assert.equal(accountsDesk(app).totals.toPay >= 1200, true);
    settleAdvance(app, acc, a.id, pay); assert.equal(getClaim(app, a.id)!.status, 'settled'); assert.equal(balanceOf(app, bdm.id), before);
  });
  test('an advance is not spend until its bills are accepted; payment does not change the spend figure', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC); const spend = measures(app).find((m) => m.key === 'spend')!; const day = today(); const v = (): number => spend.actual(app, day, day) || 0;
    const base = v(); const a = submitClaim(app, bdm, { kind: 'advance', category: 'Travel', amount: 8000, description: 'Trip money' }); approve(app, a.id); markPaid(app, acc, a.id, { mode: 'Cash' });
    assert.equal(v(), base, 'giving an advance is not an expense');
    const s = submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 3000, description: 'Fuel', doc: PNG, docName: 'f.png' }); approve(app, s.id); assert.equal(v(), base + 3000);
    const c = submitClaim(app, bdm, { category: 'Food', amount: 500, description: 'Team lunch', doc: PNG, docName: 'l.png' }); approve(app, c.id); assert.equal(v(), base + 3500); markPaid(app, acc, c.id, { mode: 'Cash' }); assert.equal(v(), base + 3500);
  });
  test('documents: only PDFs and photos, only for people who may see the claim', () => {
    const app = testApp(); const bdm = emp(app, BDM); const other = emp(app, SUPPORT_IC); const acc = emp(app, ACC); const coo = emp(app, COO);
    const c = submitClaim(app, bdm, { category: 'Travel', amount: 100, description: 'Auto fare' });
    assert.throws(() => addDoc(app, bdm, c.id, 'bill', PNG, 'virus.exe'), /PDF or a photo/); assert.throws(() => addDoc(app, bdm, c.id, 'payment', PNG, 'p.png'), /attached by Accounts/); assert.throws(() => addDoc(app, other, c.id, 'bill', PNG, 'b.png'), /outside your team/);
    const d = addDoc(app, bdm, c.id, 'bill', PNG, 'auto.png'); assert.equal(readDoc(app, bdm, d.id).mime, 'image/png'); assert.ok(readDoc(app, acc, d.id).body.length > 10); assert.throws(() => readDoc(app, other, d.id), /outside your team/);
    assert.ok(isAccounts(app, acc)); assert.ok(isAccounts(app, coo)); assert.ok(!isAccounts(app, bdm)); assert.ok(canSee(app, coo, getClaim(app, c.id)!)); assert.ok(!canSee(app, other, getClaim(app, c.id)!));
  });
});

describe('expenses in the browser', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
  test('claim, approve, pay; pages, documents and reports open for the right people', async () => {
    const bdm = await login(BDM); const acc = await login(ACC); const coo = await login(COO);
    assert.equal((await bdm.postJson('/money', { kind: 'reimbursement', category: 'Travel', amount: 2750, description: 'Cab to Bhosari', doc: PNG, docName: 'cab.png' })).status, 200);
    const id = s.app.db.get<{ id: string }>("SELECT id FROM expenses WHERE description = 'Cab to Bhosari'")!.id;
    let mine = await (await bdm.get('/money')).text(); assert.match(mine, /Expenses and advances/); assert.match(mine, /Waiting for approval/); assert.ok(!mine.includes('Accounts desk'));
    approve(s.app, id);
    const desk = await (await acc.get('/money/accounts')).text(); assert.match(desk, /To pay/); assert.match(desk, new RegExp(id)); assert.match(desk, /Advances not yet settled/);
    assert.equal((await bdm.get('/money/accounts')).status, 403); assert.equal((await bdm.postJson(`/money/${id}/pay`, { mode: 'Cash' })).status, 403);
    assert.match(await (await acc.get(`/money/${id}/pay?partial=1`)).text(), /Record payment/);
    assert.equal((await acc.postJson(`/money/${id}/pay`, { mode: 'UPI', ref: 'UPI998877', date: today() })).status, 200);
    mine = await (await bdm.get('/money')).text(); assert.match(mine, /UPI998877/);
    const page = await (await bdm.get(`/money/${id}`)).text(); assert.match(page, /Ledger lines/); assert.match(page, /Reimbursement paid/); assert.match(page, /cab\.png/);
    const docId = s.app.db.get<{ id: number }>('SELECT id FROM expense_docs WHERE expense_id = ?', [id])!.id;
    const f = await bdm.get(`/money/doc/${docId}`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/png');
    const out = await login(SUPPORT_IC); assert.equal((await out.get(`/money/doc/${docId}`)).status, 403); assert.equal((await out.get(`/money/${id}`)).status, 403);
    assert.match(await (await bdm.get('/money/ledger')).text(), /Reimbursement paid/); assert.match(await (await coo.get('/money/ledger')).text(), /Everyone/);
    for (const r of ['fin-ledger', 'fin-payables', 'fin-advances', 'fin-cash-out']) { assert.equal((await acc.get(`/reports/${r}`)).status, 200, r); assert.equal((await coo.get(`/reports/${r}.xlsx`)).status, 200, r); assert.equal((await out.get(`/reports/${r}`)).status, 403, r); }
    assert.match(await (await coo.get('/reports/fin-ledger?from=2020-01-01')).text(), /UPI998877/);
  });
});
