import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, BDM, COO, SALES_HEAD, SUPPORT_LEAD } from '../helpers.ts';
import { createDeal, moveDeal, updateDeal, createQuote, winDeal, addActivity, listActivities, getDeal } from '../../src/modules/sales/service.ts';
import { decideTask, getTask, listTasks } from '../../src/modules/tasks/service.ts';
import { listWorkOrders } from '../../src/modules/production/service.ts';
import { listTickets } from '../../src/modules/desk/service.ts';
import { unreadNotifications } from '../../src/lib/notify.ts';
import { getSetting } from '../../src/lib/settings.ts';

test('a deal is qualified, quoted, approved and won; winning creates the three hand-offs', () => {
  const app = testApp();
  const bdm = emp(app, BDM), coo = emp(app, COO), head = emp(app, SALES_HEAD);
  const d = createDeal(app, bdm, { customerName: 'Omkar Tech', city: 'Pune', title: 'Floor tracking', value: 500000 });
  assert.equal(d.stage, 'new');
  moveDeal(app, bdm, d.id, 'contacted');
  assert.throws(() => moveDeal(app, bdm, d.id, 'qualified'), /need, budget and timeline/);
  updateDeal(app, bdm, d.id, { qualified_need: 'Track WIP', qualified_budget: '5 L', qualified_timeline: 'Q4' });
  moveDeal(app, bdm, d.id, 'qualified');
  moveDeal(app, bdm, d.id, 'demo');
  assert.throws(() => moveDeal(app, bdm, d.id, 'proposal'), /estimate/);

  const q = createQuote(app, bdm, d.id, { discountPct: 14, listTotal: 500000 });
  assert.ok(q.approvalTaskId, '14% needs an approval');
  const task = getTask(app, q.approvalTaskId!)!;
  assert.equal(task.assignee_id, coo.id, 'above 10% goes to the COO');
  assert.equal(q.deal.discount_status, 'pending');
  moveDeal(app, bdm, d.id, 'proposal');
  moveDeal(app, bdm, d.id, 'negotiation');
  assert.throws(() => winDeal(app, bdm, d.id), /waiting for approval/);

  assert.throws(() => decideTask(app, head, task.id, 'approved'), /assigned to someone else/);
  decideTask(app, coo, task.id, 'approved', 'Strategic account');
  assert.equal(getDeal(app, d.id)!.discount_status, 'approved');
  assert.ok(unreadNotifications(app.db, bdm.id).some((n) => n.title.startsWith('Approved')));
  assert.throws(() => winDeal(app, bdm, d.id), /PO/);
  updateDeal(app, bdm, d.id, { po_received: 1 });

  const won = winDeal(app, bdm, d.id);
  assert.equal(won.stage, 'won');
  const wo = listWorkOrders(app, { limit: 10 }).find((w) => w.deal_id === d.id);
  assert.ok(wo, 'work order created');
  assert.equal(wo!.stage, 'queued');
  const invoice = listTasks(app, { kind: 'task' }).find((t) => t.type === 'invoice_request' && t.title.includes(d.id));
  assert.ok(invoice, 'invoice request created');
  assert.equal(invoice!.assignee_id, getSetting(app.db, 'company').accountsOwnerId);
  const impl = listTickets(app, { type: 'implementation' }).find((t) => t.customer_id === d.customer_id);
  assert.ok(impl, 'implementation ticket created');
  assert.equal(impl!.assignee_id, emp(app, SUPPORT_LEAD).id);
  assert.ok(unreadNotifications(app.db, head.id).some((n) => n.title.includes('Deal won')));
  assert.ok(unreadNotifications(app.db, coo.id).some((n) => n.title.includes('Deal won')));
  assert.ok(listActivities(app, { dealId: d.id }).some((a) => a.kind === 'won'));
});

test('small discounts need no approval and visits record distance', () => {
  const app = testApp();
  const bdm = emp(app, BDM);
  const d = createDeal(app, bdm, { customerName: 'Prime Foods', value: 100000 });
  const q = createQuote(app, bdm, d.id, { discountPct: 4 });
  assert.equal(q.approvalTaskId, null);
  assert.equal(q.deal.discount_status, 'approved');
  const q2 = createQuote(app, bdm, d.id, { discountPct: 8 });
  assert.ok(q2.approvalTaskId);
  assert.equal(getTask(app, q2.approvalTaskId!)!.assignee_id, emp(app, SALES_HEAD).id);

  const a1 = addActivity(app, bdm, { dealId: d.id, kind: 'visit', notes: 'First', lat: 18.5204, lng: 73.8567 });
  assert.equal(a1.km, 0);
  const a2 = addActivity(app, bdm, { dealId: d.id, kind: 'visit', notes: 'Second', lat: 18.5304, lng: 73.8767 });
  assert.ok(a2.km > 1 && a2.km < 4, `distance ${a2.km} km`);
});

test('lost deals keep their reason', () => {
  const app = testApp();
  const bdm = emp(app, BDM);
  const d = createDeal(app, bdm, { customerName: 'Lost Co', value: 10 });
  const lost = moveDeal(app, bdm, d.id, 'lost', { lostReason: 'Price' });
  assert.equal(lost.stage, 'lost');
  assert.equal(lost.lost_reason, 'Price');
});
