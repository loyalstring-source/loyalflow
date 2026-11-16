import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, SUPPORT_LEAD, SUPPORT_IC, COO, HR } from '../helpers.ts';
import { generateInstances, listInstances, completeStep, compliance, escalateOverdue, instanceSteps, getSop, startInstance, saveSop } from '../../src/modules/sops/service.ts';
import { fromLocal, localDateString, addDays } from '../../src/lib/time.ts';
import { unreadNotifications } from '../../src/lib/notify.ts';
import { requestLeave, submitExpense, decideTask, completeTask, toggleTimer, createTask } from '../../src/modules/tasks/service.ts';
import { onTimeStreak, leaveBalance } from '../../src/routes/today.ts';
import { validateReportingLine } from '../../src/modules/people/model.ts';

test('daily SOP checklists are generated once per working day and need evidence to complete', () => {
  const app = testApp();
  const monday = fromLocal(2026, 11, 2, 9, 0);
  const created = generateInstances(app, monday);
  assert.ok(created >= 3, `created ${created}`); // huddle, dispatch, Monday pipeline review (+ monthly close on the 1st only)
  assert.equal(generateInstances(app, monday), 0, 'idempotent');
  const sunday = fromLocal(2026, 11, 8, 9, 0);
  assert.equal(generateInstances(app, sunday), 0, 'no checklists on Sunday');

  const lead = emp(app, SUPPORT_LEAD);
  const inst = listInstances(app, { assigneeId: lead.id, date: '2026-11-02' })[0];
  assert.ok(inst, 'support lead owns the huddle');
  const steps = instanceSteps(inst);
  assert.throws(() => completeStep(app, lead, inst.id, 'p1calls', ''), /evidence/);
  const after = completeStep(app, lead, inst.id, 'review');
  assert.equal(instanceSteps(after).find((s) => s.key === 'review')!.done, true);
  for (const s of steps) completeStep(app, lead, inst.id, s.key, 'done, see notes');
  const done = listInstances(app, { assigneeId: lead.id, date: '2026-11-02' })[0];
  assert.equal(done.status, 'complete');
  const c = compliance(app, { assigneeIds: [lead.id], from: '2026-11-01', to: '2026-11-02' });
  assert.equal(c.total, steps.length);
  assert.equal(c.done, steps.length);
});

test('overdue checklists escalate manager → HOD → COO', () => {
  const app = testApp();
  const monday = fromLocal(2026, 11, 2, 9, 0);
  generateInstances(app, monday);
  const lead = emp(app, SUPPORT_LEAD), coo = emp(app, COO);
  const all = listInstances(app, { date: '2026-11-02' });
  const earliest = all.map((i) => new Date(i.due_at).getTime()).sort()[0];
  const latest = all.map((i) => new Date(i.due_at).getTime()).sort().reverse()[0];
  assert.equal(escalateOverdue(app, new Date(earliest - 60_000)), 0, 'nothing before the first due time');
  assert.equal(escalateOverdue(app, new Date(latest + 60_000)), all.length, 'level 1 for every open checklist once due');
  assert.ok(unreadNotifications(app.db, lead.reporting_manager_id!).some((n) => n.title.startsWith('Overdue SOP')), 'the manager is told');
  assert.equal(escalateOverdue(app, new Date(latest + 60_000)), 0, 'not twice at the same level');
  assert.equal(escalateOverdue(app, new Date(latest + 3 * 540 * 60_000)), all.length, 'level 3 after three graces');
  assert.ok(unreadNotifications(app.db, coo.id).some((n) => n.kind === 'critical'), 'the COO is told at level 3');
  assert.equal(listInstances(app, { date: '2026-11-02' }).every((i) => i.escalation_level === 3), true);
});

test('event SOPs start by hand, and editing an SOP creates a new version', () => {
  const app = testApp();
  const hr = emp(app, HR);
  const sop = getSop(app, 'SOP-HR-ONBOARD')!;
  const inst = startInstance(app, sop, new Date(), hr.id, 'GEN');
  assert.ok(inst);
  assert.equal(startInstance(app, sop, new Date(), hr.id, 'GEN'), null, 'one per day per person');
  const v2 = saveSop(app, emp(app, COO), { id: sop.id, name: sop.name, departmentId: 'HR', ownerRole: 'ic', trigger: 'event', steps: [{ key: 'm365', title: 'Account', evidence: 'none', dueOffsetMin: 60 }] });
  assert.equal(v2.version, 2);
  assert.equal(instanceSteps(inst!).length, 5, 'running checklist keeps the old version');
});

test('leave and expenses route, decide and roll up; timers log minutes', () => {
  const app = testApp();
  const ic = emp(app, SUPPORT_IC), lead = emp(app, SUPPORT_LEAD), coo = emp(app, COO);
  const { task } = requestLeave(app, ic, { type: 'CL', from: '2026-11-16', to: '2026-11-17', reason: 'Family' });
  assert.equal(task.assignee_id, lead.id);
  decideTask(app, lead, task.id, 'approved');
  // The manager's approval is the first of two: nothing is used from the balance until HR approves.
  const leave = app.db.get<{ status: string; hr_task_id: string }>('SELECT status, hr_task_id FROM leave_requests WHERE task_id = ?', [task.id])!;
  assert.equal(leave.status, 'manager_approved');
  assert.equal(leaveBalance(app, ic.id, fromLocal(2026, 11, 20)).find((t) => t.code === 'CL')!.used, 0);
  decideTask(app, emp(app, HR), leave.hr_task_id, 'approved');
  const bal = leaveBalance(app, ic.id, fromLocal(2026, 11, 20));
  assert.equal(bal.find((t) => t.code === 'CL')!.used, 2);
  assert.throws(() => requestLeave(app, ic, { type: 'CL', from: '2026-11-20', to: '2026-11-18' }), /dates/);

  const e = submitExpense(app, ic, { category: 'Travel', amount: 62400, description: 'Client visit' });
  assert.equal(e.task.assignee_id, coo.id, 'over 50k goes to the COO');
  decideTask(app, coo, e.task.id, 'declined', 'No receipts');
  assert.equal(app.db.get<{ status: string }>('SELECT status FROM expenses WHERE id = ?', [e.expenseId])!.status, 'declined');

  const t = createTask(app, coo, { kind: 'task', type: 'general', title: 'Prepare board pack', assigneeId: ic.id, requesterId: coo.id });
  const running = toggleTimer(app, ic, t.id);
  assert.ok(running.timer_started_at);
  assert.equal(running.status, 'in_progress');
  const done = completeTask(app, ic, t.id);
  assert.equal(done.status, 'done');
  assert.ok(done.minutes_logged >= 0);
});

test('streaks count consecutive on-time days and reporting lines cannot loop', () => {
  const app = testApp();
  const lead = emp(app, SUPPORT_LEAD);
  for (let i = 1; i <= 3; i++) {
    const day = fromLocal(2026, 11, i + 1, 9, 0); // 2, 3, 4 Nov (Mon–Wed)
    generateInstances(app, day);
    const inst = listInstances(app, { assigneeId: lead.id, date: localDateString(day) })[0];
    for (const s of instanceSteps(inst)) {
      completeStep(app, lead, inst.id, s.key, 'ok');
      app.db.run('UPDATE sop_instances SET steps = ? WHERE id = ?', [JSON.stringify(instanceSteps(listInstances(app, { assigneeId: lead.id, date: localDateString(day) })[0]).map((x) => ({ ...x, onTime: true, done: true }))), inst.id]);
    }
  }
  assert.equal(onTimeStreak(app, lead.id, fromLocal(2026, 11, 4, 20, 0)), 3);
  assert.equal(onTimeStreak(app, lead.id, addDays(fromLocal(2026, 11, 4, 20, 0), 1)), 3, 'a day without checklists does not break it');
  assert.equal(validateReportingLine(app.db, 'LS002', 'LS020'), 'That would create a loop in the reporting line.');
  assert.equal(validateReportingLine(app.db, 'LS024', 'LS024'), 'Nobody can report to themself.');
  assert.equal(validateReportingLine(app.db, 'LS024', 'LS002'), null);
});
