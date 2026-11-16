import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, SUPPORT_LEAD, SUPPORT_IC, DEV_LEAD, COO } from '../helpers.ts';
import { createTicket, assignTicket, replyToCustomer, escalateToDev, setDevStatus, resolveTicket, rateTicket, reopenTicket, runSlaChecks, getTicket, ticketEvents, setPriority } from '../../src/modules/desk/service.ts';
import { createCustomer } from '../../src/modules/sales/service.ts';
import { sentMails } from '../../src/lib/mailer.ts';
import { unreadNotifications } from '../../src/lib/notify.ts';

test('a ticket moves through its whole life with the right side effects', async () => {
  const app = testApp();
  const lead = emp(app, SUPPORT_LEAD), ic = emp(app, SUPPORT_IC), dev = emp(app, DEV_LEAD);
  const cust = createCustomer(app, lead, { name: 'Test Customer', email: 'cust@example.com', contact_name: 'Asha' });

  const t = createTicket(app, lead, { customerId: cust.id, subject: 'Barcode scanner offline', priority: 'P2', channel: 'phone' });
  assert.match(t.id, /^T-\d+$/);
  assert.equal(t.status, 'new');
  assert.ok(t.response_due_at && t.resolve_due_at);

  const a = assignTicket(app, lead, t.id, ic.id);
  assert.equal(a.status, 'assigned');
  assert.ok(unreadNotifications(app.db, ic.id).some((n) => n.title.includes(t.id)));

  const mailsBefore = sentMails.length;
  const r = replyToCustomer(app, ic, t.id, 'We are looking into it', 'email');
  assert.ok(r.first_response_at);
  assert.equal(r.status, 'in_progress');
  await new Promise((res) => setTimeout(res, 5));
  assert.ok(sentMails.length > mailsBefore, 'customer was emailed');

  const { issueId, ticket } = escalateToDev(app, ic, t.id);
  assert.match(issueId, /^D-\d+$/);
  assert.equal(ticket.status, 'waiting_dev');
  assert.equal(ticket.dev_issue_id, issueId);
  assert.throws(() => escalateToDev(app, ic, t.id), /already linked/);

  setDevStatus(app, dev, issueId, 'in_progress');
  setDevStatus(app, dev, issueId, 'released');
  assert.equal(getTicket(app, t.id)!.status, 'in_progress', 'release moves the ticket back to support');
  assert.ok(unreadNotifications(app.db, ic.id).some((n) => n.title.includes('released')));

  const res = resolveTicket(app, ic, t.id, 'Replaced the cable');
  assert.equal(res.status, 'resolved');
  assert.equal(res.within_sla, 1);
  assert.ok(res.rating_token);
  const rated = rateTicket(app, res.rating_token!, 5);
  assert.equal(rated!.rating, 5);
  assert.equal(rateTicket(app, 'bogus', 3), null);

  const re = reopenTicket(app, lead, t.id, 'Happened again');
  assert.equal(re.status, 'in_progress');
  assert.equal(re.reopen_count, 1);
  assert.equal(re.within_sla, null);
  const kinds = ticketEvents(app, t.id).map((e) => e.kind);
  assert.deepEqual(kinds.slice(0, 4), ['created', 'assigned', 'reply', 'escalated']);
  assert.ok(kinds.includes('reopened') && kinds.includes('rated'));
});

test('SLA checks warn at half time, escalate on breach to the COO and auto-close old resolved tickets', () => {
  const app = testApp();
  const lead = emp(app, SUPPORT_LEAD), ic = emp(app, SUPPORT_IC), coo = emp(app, COO);
  const t = createTicket(app, lead, { subject: 'P1 outage', priority: 'P1', assigneeId: ic.id, channel: 'phone' }); // 4 h resolve, always-on
  const created = new Date(t.created_at);
  let r = runSlaChecks(app, new Date(created.getTime() + 10 * 60_000));
  assert.deepEqual(r, { warned: 0, breached: 0, closed: 0 });
  r = runSlaChecks(app, new Date(created.getTime() + 150 * 60_000));
  assert.equal(r.warned, 1);
  assert.ok(unreadNotifications(app.db, lead.id).some((n) => /at risk/.test(n.title)));
  r = runSlaChecks(app, new Date(created.getTime() + 300 * 60_000));
  assert.equal(r.breached, 1);
  assert.ok(unreadNotifications(app.db, coo.id).some((n) => /breached/.test(n.title)), 'COO is told on breach');
  assert.equal(getTicket(app, t.id)!.escalation_level, 2);
  assert.equal(runSlaChecks(app, new Date(created.getTime() + 400 * 60_000)).breached, 0, 'no duplicate escalation');

  resolveTicket(app, ic, t.id);
  const closed = runSlaChecks(app, new Date(created.getTime() + 5 * 86_400_000));
  assert.equal(closed.closed, 1);
  assert.equal(getTicket(app, t.id)!.status, 'closed');
});

test('implementation tickets run on a plan, and priority changes restart the clock', () => {
  const app = testApp();
  const lead = emp(app, SUPPORT_LEAD);
  const impl = createTicket(app, lead, { subject: 'Implementation: X', type: 'implementation', implPlanDays: 10, channel: 'system' });
  assert.equal(impl.impl_plan_days, 10);
  assert.equal(Math.round((new Date(impl.resolve_due_at!).getTime() - new Date(impl.created_at).getTime()) / 86_400_000), 10);
  const t = createTicket(app, lead, { subject: 'Printer', priority: 'P4', channel: 'email' });
  const before = t.resolve_due_at!;
  const after = setPriority(app, lead, t.id, 'P1');
  assert.equal(after.priority, 'P1');
  assert.ok(after.resolve_due_at! < before, 'P1 resolves sooner than P4');
});
