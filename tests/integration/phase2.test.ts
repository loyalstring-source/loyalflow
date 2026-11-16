import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, startServer, Client, COO, BDM, PRODUCTION_LEAD, SUPPORT_IC, type TestServer } from '../helpers.ts';
import { buildXlsx } from '../../src/lib/xlsx.ts';
import { parseXlsx, parseCsv, mapRows } from '../../src/lib/tabular.ts';
import { preview, commit, template } from '../../src/modules/imports/service.ts';
import { listCustomers, listDeals, addActivity, createDeal, updateDeal, winDeal, createQuote } from '../../src/modules/sales/service.ts';
import { listTickets } from '../../src/modules/desk/service.ts';
import { listWorkOrders, createWorkOrder } from '../../src/modules/production/service.ts';
import { saveProcurement, setProcurementStatus, forecast, budgets, setBudget, startTimer, stopTimer, logTime, timeFor, travelReport, hoursByPerson } from '../../src/modules/ops/service.ts';
import { submitExpense, decideTask } from '../../src/modules/tasks/service.ts';
import { fiscalYear } from '../../src/lib/time.ts';

test('xlsx and csv readers round-trip the writer and tolerate messy headers', () => {
  const buf = buildXlsx([{ name: 'S', columns: [{ header: 'Customer Name' }, { header: 'Value' }], rows: [['Omkar & Co', 12345], ['Prime', null]] }]);
  const t = parseXlsx(buf);
  assert.deepEqual(t.headers, ['Customer Name', 'Value']);
  assert.deepEqual(t.rows, [['Omkar & Co', '12345'], ['Prime']]);
  const m = mapRows(t, { customer: ['company', 'customer name'], value: ['amount'], phone: ['mobile'] });
  assert.equal(m.objects[0].customer, 'Omkar & Co');
  assert.deepEqual(m.missing, ['phone']);
  const c = parseCsv('Company,Amount\n"Deccan, Ltd","2,60,000"\n');
  assert.equal(c.rows[0][0], 'Deccan, Ltd');
  assert.ok(template('leads').length > 2000);
});

test('imports: preview validates, commit creates customers and deals, reuses existing names', () => {
  const app = testApp();
  const head = emp(app, 'muruganandam.k@loyalstring.com');
  const file = buildXlsx([{ name: 'Leads', columns: [{ header: 'Company' }, { header: 'Requirement' }, { header: 'Amount' }, { header: 'Stage' }, { header: 'BDM' }, { header: 'Follow up date' }], rows: [
    ['Omkar Tech', 'Floor tracking', '4,50,000', 'contacted', BDM, '15/11/2026'],
    ['Omkar Tech', 'Second line', 'abc', '', '', ''],
    ['Prime Foods', 'Scanners', 90000, 'moon', 'nobody@loyalstring.com', '2026-12-01']
  ] }]);
  const p = preview(app, head, 'leads', 'leads.xlsx', file);
  assert.equal(p.rows.length, 3);
  assert.equal(p.valid, 2); assert.equal(p.invalid, 1);
  assert.match(p.rows[1].errors[0], /not a number/);
  assert.equal(p.rows[0].data.next_step_due, '2026-11-15');
  assert.ok(p.rows[2].warnings.some((w) => /Stage "moon"/.test(w)));
  assert.ok(p.rows[2].warnings.some((w) => /not an employee/.test(w)));
  const r = commit(app, head, p.id);
  assert.deepEqual(r, { created: 2, updated: 0, skipped: 0 });
  assert.throws(() => commit(app, head, p.id), /already committed/);
  const deals = listDeals(app, { limit: 10 });
  const omkar = deals.find((d) => d.customer_name === 'Omkar Tech')!;
  assert.equal(omkar.stage, 'contacted'); assert.equal(omkar.value, 450000); assert.equal(omkar.owner_id, emp(app, BDM).id); assert.equal(omkar.next_step_due, '2026-11-15');
  const prime = deals.find((d) => d.customer_name === 'Prime Foods')!;
  assert.equal(prime.stage, 'new'); assert.equal(prime.owner_id, head.id);
  assert.equal(listCustomers(app).length, 2);

  const cust = preview(app, head, 'customers', 'c.csv', Buffer.from('Customer,City,Phone\nOmkar Tech,Pune,98765\nNew Co,Nashik,\n'));
  assert.deepEqual(commit(app, head, cust.id), { created: 1, updated: 1, skipped: 0 });
  assert.equal(listCustomers(app).find((c) => c.name === 'Omkar Tech')!.city, 'Pune');
  assert.throws(() => preview(app, head, 'tickets', 't.csv', Buffer.from('Foo,Bar\n1,2\n')), /needs a column/);
  const tk = preview(app, head, 'tickets', 't.csv', Buffer.from(`Customer,Subject,Priority,Assignee\nKalyani,Printer dead,P1,${SUPPORT_IC}\n`));
  commit(app, head, tk.id);
  const t = listTickets(app, { limit: 5 })[0];
  assert.equal(t.priority, 'P1'); assert.equal(t.assignee_id, emp(app, SUPPORT_IC).id); assert.equal(t.customer_name, 'Kalyani');
  const wo = preview(app, head, 'work_orders', 'w.csv', Buffer.from('Customer,Product,Quantity,Promised date,Stage\nVardhman,Cradles,6,2026-11-20,In production\n'));
  commit(app, head, wo.id);
  const w = listWorkOrders(app, { limit: 5 })[0];
  assert.equal(w.stage, 'in_production'); assert.equal(w.qty, 6); assert.equal(w.promised_date, '2026-11-20');
});

test('procurement items, material readiness and the pipeline forecast', () => {
  const app = testApp();
  const prd = emp(app, PRODUCTION_LEAD), bdm = emp(app, BDM);
  const wo = createWorkOrder(app, prd, { product: 'RFID gate', qty: 1 });
  const a = saveProcurement(app, prd, { item: 'Reader', qty: 2, workOrderId: wo.id, estCost: 80000, neededBy: '2026-11-10' });
  const b = saveProcurement(app, prd, { item: 'Antenna', qty: 4, workOrderId: wo.id });
  assert.match(a.id, /^PR-\d+$/);
  setProcurementStatus(app, prd, a.id, 'ordered', { expectedAt: '2026-11-08' });
  setProcurementStatus(app, prd, a.id, 'received');
  assert.equal(listWorkOrders(app, { limit: 5 })[0].materials_status, 'unchecked', 'one item still open');
  setProcurementStatus(app, prd, b.id, 'received');
  assert.equal(listWorkOrders(app, { limit: 5 })[0].materials_status, 'ready', 'all items received marks the order ready');
  assert.throws(() => saveProcurement(app, prd, { item: 'x' }), /Name the item/);

  const d = createDeal(app, bdm, { customerName: 'Forecast Co', title: 'Kit', value: 1000000 });
  updateDeal(app, bdm, d.id, { qualified_need: 'y', qualified_budget: 'y', qualified_timeline: 'y', expected_close: '2026-12-01' });
  app.db.run("UPDATE deals SET stage = 'demo' WHERE id = ?", [d.id]);
  const f = forecast(app);
  const line = f.lines.find((l) => l.id === d.id)!;
  assert.equal(line.chance, 55); assert.equal(line.weighted, 550000);
  assert.ok(f.lines.some((l) => l.kind === 'order' && l.id === wo.id));
  assert.equal(f.weightedValue, 550000);
});

test('budgets track approved spend and timers log man-hours', async () => {
  const app = testApp();
  const coo = emp(app, COO), ic = emp(app, SUPPORT_IC), prd = emp(app, PRODUCTION_LEAD);
  const fy = fiscalYear(new Date());
  setBudget(app, coo, 'SUP', fy, 100000, 'test');
  const e = submitExpense(app, ic, { category: 'Travel', amount: 8000, description: 'x' });
  let line = budgets(app, fy).find((b) => b.department_id === 'SUP')!;
  assert.equal(line.amount, 100000); assert.equal(line.committed, 8000); assert.equal(line.spent, 0);
  decideTask(app, emp(app, 'prasad.panchal@loyalstring.com'), e.task.id, 'approved');
  line = budgets(app, fy).find((b) => b.department_id === 'SUP')!;
  assert.equal(line.spent, 8000); assert.equal(line.remaining, 92000); assert.equal(line.pct, 8);

  const wo = createWorkOrder(app, prd, { product: 'Cradles', qty: 6 });
  startTimer(app, prd, 'work_order', wo.id);
  await new Promise((r) => setTimeout(r, 10));
  const stopped = stopTimer(app, prd, 'assembly');
  assert.ok(stopped && stopped.minutes >= 1);
  logTime(app, prd, 'work_order', wo.id, 90, 'testing');
  const t = timeFor(app, 'work_order', wo.id);
  assert.equal(t.logs.length, 2); assert.equal(t.minutes, stopped!.minutes + 90);
  const rows = hoursByPerson(app, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  assert.equal(rows[0].employee_id, prd.id);
  assert.throws(() => logTime(app, prd, 'work_order', wo.id, 0, ''), /minutes or hours/);
});

test('travel report joins visits, km, claims and wins per person', () => {
  const app = testApp();
  const bdm = emp(app, BDM);
  const d = createDeal(app, bdm, { customerName: 'Travel Co', title: 'Kit', value: 200000 });
  addActivity(app, bdm, { dealId: d.id, kind: 'visit', notes: 'a', lat: 18.52, lng: 73.85 });
  addActivity(app, bdm, { dealId: d.id, kind: 'visit', notes: 'b', lat: 18.62, lng: 73.95 });
  submitExpense(app, bdm, { category: 'Travel', amount: 1500, description: 'fuel' });
  updateDeal(app, bdm, d.id, { qualified_need: 'y', qualified_budget: 'y', qualified_timeline: 'y', po_received: 1 });
  createQuote(app, bdm, d.id, { discountPct: 0 });
  winDeal(app, bdm, d.id);
  const rep = travelReport(app, new Date(Date.now() - 86_400_000).toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  const row = rep.rows.find((r) => r.employee_id === bdm.id)!;
  assert.equal(row.visits, 2); assert.ok(row.km > 10 && row.km < 20); assert.equal(row.claimed, 1500); assert.equal(row.wonDeals, 1); assert.equal(row.wonValue, 200000);
  assert.equal(row.estCost, Math.round(row.km * rep.ratePerKm));
});

let srv: TestServer;
before(async () => { srv = await startServer({ demo: true }); });
after(async () => { await srv.close(); });

test('phase 2 pages render and the upload flow works over HTTP', async () => {
  const c = new Client(srv.base);
  await c.login(COO);
  for (const p of ['/procurement', '/procurement?tab=forecast', '/procurement?tab=materials', '/procurement/new', '/budgets', '/travel', '/hours', '/imports', '/imports/leads/template.xlsx', '/exports/travel.xlsx', '/exports/hours.xlsx', '/approvals/expense/new']) {
    const r = await c.get(p); assert.equal(r.status, 200, `${p} → ${r.status}`);
  }
  const file = buildXlsx([{ name: 'C', columns: [{ header: 'Customer' }, { header: 'City' }], rows: [['HTTP Import Ltd', 'Pune']] }]);
  const up = await c.postJson('/imports/customers', { file: file.toString('base64'), fileName: 'c.xlsx' });
  assert.equal(up.json.ok, true);
  const id = Number(String(up.json.redirect).split('/').pop());
  assert.equal((await c.get(`/imports/preview/${id}`)).status, 200);
  const done = await c.postJson(`/imports/preview/${id}/commit`, {});
  assert.equal(done.json.ok, true);
  assert.ok(listCustomers(srv.app).some((x) => x.name === 'HTTP Import Ltd'));
  const ic = new Client(srv.base); await ic.login(SUPPORT_IC);
  assert.equal((await ic.get('/imports')).status, 403);
  assert.equal((await ic.get('/budgets')).status, 403);
  const wo = listWorkOrders(srv.app, { open: true })[0];
  const t = await ic.postJson('/time/start', { entityType: 'work_order', entityId: wo.id });
  assert.equal(t.json.ok, true);
  const s = await ic.postJson('/time/stop', {});
  assert.equal(s.json.ok, true);
});
