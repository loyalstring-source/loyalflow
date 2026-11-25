// Expenses on to Accounts: reimbursements, advances, advance settlements, documents, the ledger and its reports.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SUPPORT_IC } from '../helpers.ts';
import { decideTask } from '../../src/modules/tasks/service.ts';
import { submitClaim, getClaim, markPaid, settleAdvance, advanceState, addDoc, readDoc, listDocs, ledger, balanceOf, accountsDesk, isAccounts, canSee,
  saveLimits, limitFor, addVendorBill, pettyTopUp, pettySpend, pettyBalance, closeMonth, reopenMonth, isClosed, markPosted, months, booksExport, advanceReminders, saveMoneySettings, moneySettings } from '../../src/modules/money/service.ts';
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

describe('limits, vendor bills, petty cash, GST, reminders and month close', () => {
  test('a limit flags a claim above it and tells the approver; with no limit set nothing is flagged', () => {
    const app = testApp(); const bdm = emp(app, BDM); const acc = emp(app, ACC);
    assert.equal(submitClaim(app, bdm, { category: 'Food', amount: 9000, description: 'Team dinner' }).over_limit, null);
    assert.throws(() => saveLimits(app, bdm, { Food: 1500 }), /Accounts or an executive/); assert.throws(() => saveLimits(app, acc, { Food: -5 }), /above zero/);
    assert.equal(saveLimits(app, acc, { Food: 1500, Travel: '' }), 1); assert.equal(limitFor(app, 'Food'), 1500);
    const over = submitClaim(app, bdm, { category: 'Food', amount: 2400, description: 'Customer dinner' }); assert.equal(over.over_limit, 1500);
    assert.match(app.db.get<{ title: string }>('SELECT title FROM tasks WHERE id = ?', [over.task_id])!.title, /above the ₹1,500 limit for Food/);
    assert.equal(submitClaim(app, bdm, { category: 'Food', amount: 1500, description: 'Lunch' }).over_limit, null);
    assert.equal(submitClaim(app, bdm, { kind: 'advance', category: 'Food', amount: 5000, description: 'Event catering advance' }).over_limit, null, 'limits are for bills, not advances');
    saveLimits(app, acc, { Food: '' }); assert.equal(limitFor(app, 'Food'), null);
  });
  test('GST on a bill needs a valid GSTIN and is less than the bill', () => {
    const app = testApp(); const bdm = emp(app, BDM);
    assert.throws(() => submitClaim(app, bdm, { category: 'Travel', amount: 1180, description: 'Hotel', vendorGstin: 'ABC', gstAmount: 180 }), /does not look right/);
    assert.throws(() => submitClaim(app, bdm, { category: 'Travel', amount: 1180, description: 'Hotel', gstAmount: 180 }), /supplier's GSTIN/);
    assert.throws(() => submitClaim(app, bdm, { category: 'Travel', amount: 1180, description: 'Hotel', vendorGstin: '27AAACH1234A1Z5', gstAmount: 1180 }), /less than the bill/);
    const c = submitClaim(app, bdm, { category: 'Travel', amount: 1180, description: 'Hotel', vendorName: 'Hotel Sai', vendorGstin: '27aaach1234a1z5', billNo: 'H-22', gstAmount: 180 });
    assert.deepEqual([c.vendor_name, c.vendor_gstin, c.bill_no, c.gst_amount], ['Hotel Sai', '27AAACH1234A1Z5', 'H-22', 180]);
  });
  test('a vendor bill is entered by Accounts, approved, paid, and never touches an employee\'s balance', () => {
    const app = testApp(); const acc = emp(app, ACC); const bdm = emp(app, BDM); const before = balanceOf(app, acc.id);
    assert.throws(() => addVendorBill(app, bdm, { vendorName: 'X Ltd', amount: 100, description: 'Paper' }), /entered by Accounts/); assert.throws(() => addVendorBill(app, acc, { amount: 100, description: 'Paper' }), /vendor's name/);
    const v = addVendorBill(app, acc, { vendorName: 'Bhosari Electricals', vendorGstin: '27AAACB1111C1Z9', amount: 5900, gstAmount: 900, description: 'UPS battery', category: 'Office supplies', doc: PNG, docName: 'inv.png' });
    assert.equal(v.kind, 'vendor'); assert.equal(v.status, 'pending'); approve(app, v.id);
    assert.ok(accountsDesk(app).toPay.some((x) => x.id === v.id)); assert.equal(balanceOf(app, acc.id), before);
    const paid = markPaid(app, acc, v.id, pay); assert.equal(paid.status, 'paid'); assert.equal(balanceOf(app, acc.id), before);
    assert.deepEqual(ledger(app, { party: 'vendor' }).filter((e) => e.expense_id === v.id).map((e) => [e.type, e.debit, e.credit, e.employee_name]), [['vendor_bill', 0, 5900, 'Bhosari Electricals'], ['vendor_paid', 5900, 0, 'Bhosari Electricals']]);
    assert.ok(!canSee(app, bdm, getClaim(app, v.id)!), 'a vendor bill is for Accounts and the approver');
  });
  test('petty cash: topped up, paid from within the cap, and never more than is in the box', () => {
    const app = testApp(); const acc = emp(app, ACC); const bdm = emp(app, BDM); const start = pettyBalance(app);
    assert.throws(() => pettyTopUp(app, bdm, { amount: 100 }), /kept by Accounts/);
    assert.equal(pettyTopUp(app, acc, { amount: 3000, mode: 'Cash withdrawn from bank', ref: 'CHQ 1001' }), start + 3000);
    assert.throws(() => pettySpend(app, acc, { amount: 2500, description: 'Too big' }), /at most ₹2,000/);
    const p = pettySpend(app, acc, { amount: 450, description: 'Courier', category: 'Courier', vendorName: 'Quick Courier' }); assert.deepEqual([p.kind, p.status, p.pay_mode], ['petty', 'paid', 'Petty cash']); assert.equal(pettyBalance(app), start + 2550);
    saveMoneySettings(app, acc, { pettyCap: 50000 }); assert.equal(moneySettings(app).pettyCap, 50000);
    assert.throws(() => pettySpend(app, acc, { amount: start + 9000, description: 'More than the box' }), /Add cash first/);
    assert.throws(() => markPaid(app, acc, p.id, pay), /paid when it is entered/);
  });
  test('a closed month takes no more lines; only an executive reopens it', () => {
    const app = testApp(); const acc = emp(app, ACC); const coo = emp(app, COO); const bdm = emp(app, BDM); const now = today(); const cur = now.slice(0, 7);
    const d = new Date(`${cur}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); const last = d.toISOString().slice(0, 7);
    assert.throws(() => closeMonth(app, acc, cur), /after it has ended/); assert.throws(() => closeMonth(app, bdm, last), /closed by Accounts/);
    closeMonth(app, acc, last); assert.ok(isClosed(app, `${last}-15`)); assert.ok(months(app).find((m) => m.month === last)!.closed_at);
    const c = submitClaim(app, bdm, { category: 'Travel', amount: 700, description: 'Bus fare', doc: PNG, docName: 'b.png' }); approve(app, c.id);
    assert.throws(() => markPaid(app, acc, c.id, { mode: 'Cash', date: `${last}-20` }), /books for .* are closed/);
    assert.throws(() => pettyTopUp(app, acc, { amount: 500, date: `${last}-20` }), /are closed/);
    assert.throws(() => reopenMonth(app, acc, last), /executive or an administrator/); reopenMonth(app, coo, last); assert.ok(!isClosed(app, `${last}-15`));
    assert.equal(markPaid(app, acc, c.id, { mode: 'Cash', date: `${last}-20` }).status, 'paid');
    markPosted(app, acc, last, true); assert.ok(months(app).find((m) => m.month === last)!.posted_at); markPosted(app, acc, last, false); assert.equal(months(app).find((m) => m.month === last)!.posted_at, null);
  });
  test('the file for Zoho Books lists expenses booked in the month, not advances', () => {
    const app = testApp(); const acc = emp(app, ACC); const bdm = emp(app, BDM); const month = today().slice(0, 7);
    const c = submitClaim(app, bdm, { category: 'Travel', amount: 1180, description: 'Hotel, one night', vendorName: 'Hotel Sai', vendorGstin: '27AAACH1234A1Z5', billNo: 'H-22', gstAmount: 180 }); approve(app, c.id);
    const a = submitClaim(app, bdm, { kind: 'advance', category: 'Travel', amount: 4000, description: 'Trip' }); approve(app, a.id); markPaid(app, acc, a.id, { mode: 'Cash' });
    const s = submitClaim(app, bdm, { kind: 'settlement', advanceId: a.id, amount: 2500, description: 'Fuel for the trip' }); approve(app, s.id);
    const x = booksExport(app, month); const row = (id: string) => x.rows.find((r) => r[8] === id);
    assert.equal(x.columns[0], 'Expense Date'); assert.deepEqual(row(c.id)!.slice(1, 8), ['Travel', 1180, 180, 'Employee Reimbursements', 'Hotel Sai', '27AAACH1234A1Z5', 'H-22']);
    assert.deepEqual([row(s.id)![2], row(s.id)![4], row(s.id)![9]], [2500, 'Employee Advance', 'Fuel for the trip']); assert.equal(row(a.id), undefined);
  });
  test('an advance open too long reminds the person and their manager, then waits a week', () => {
    const app = testApp(); const acc = emp(app, ACC); const bdm = emp(app, BDM);
    const a = submitClaim(app, bdm, { kind: 'advance', category: 'Travel', amount: 6000, description: 'Exhibition' }); approve(app, a.id); markPaid(app, acc, a.id, { mode: 'Cash' });
    const count = (): number => app.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE title = ?', [`Settle your advance ${a.id}`])!.n;
    advanceReminders(app); assert.equal(count(), 0, 'not yet due');
    app.db.run('UPDATE expenses SET paid_at = ? WHERE id = ?', [new Date(Date.now() - 20 * 86_400_000).toISOString(), a.id]);
    assert.ok(advanceReminders(app) >= 1); assert.equal(count(), 1);
    assert.ok(app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND title LIKE 'Advance not settled:%'", [bdm.reporting_manager_id])!.n >= 1);
    advanceReminders(app); assert.equal(count(), 1, 'not again within a week');
    advanceReminders(app, new Date(Date.now() + 8 * 86_400_000)); assert.equal(count(), 2);
  });
});

describe('the new Accounts screens', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
  test('Accounts opens them and saves; others cannot', async () => {
    const acc = await login(ACC); const bdm = await login(BDM); const month = today().slice(0, 7);
    const desk = await (await acc.get('/money/accounts')).text(); for (const t of ['Month close', 'Vendor bill', 'Petty cash', 'Limits and reminders', 'File for Zoho']) assert.match(desk, new RegExp(t), t);
    for (const u of ['/money/vendor/new', '/money/petty', '/money/settings']) { assert.equal((await acc.get(u + '?partial=1')).status, 200, u); assert.equal((await bdm.get(u)).status, 403, u); }
    assert.equal((await acc.postJson('/money/settings', { 'limit:Food': 1200, advanceDays: 10, pettyCap: 3000 })).status, 200); assert.equal(limitFor(s.app, 'Food'), 1200); assert.deepEqual(moneySettings(s.app), { advanceDays: 10, pettyCap: 3000 });
    assert.equal((await acc.postJson('/money/petty/topup', { amount: 2000, mode: 'Cheque', ref: 'CHQ 77' })).status, 200);
    assert.equal((await acc.postJson('/money/petty/spend', { amount: 300, description: 'Tea for visitors', category: 'Food' })).status, 200);
    assert.equal((await acc.postJson('/money/vendor', { vendorName: 'Pune Broadband', amount: 1180, gstAmount: 180, vendorGstin: '27AABCP5678B1Z2', description: 'Internet for the month' })).status, 200);
    assert.equal((await bdm.postJson('/money/petty/spend', { amount: 10, description: 'No' })).status, 403); assert.equal((await bdm.postJson('/money/months/close', { month: '2026-01' })).status, 403);
    const csv = await acc.get(`/money/books.csv?month=${month}`); assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type') || '', /text\/csv/); assert.match(await csv.text(), /Expense Date,Expense Account/);
    assert.equal((await bdm.get(`/money/books.csv?month=${month}`)).status, 403);
    assert.equal((await acc.get('/reports/fin-gst-input')).status, 200); assert.equal((await acc.get('/reports/fin-gst-input.xlsx')).status, 200);
    assert.match(await (await bdm.get('/money/new?kind=reimbursement&partial=1')).text(), /Supplier GSTIN/);
  });
});
