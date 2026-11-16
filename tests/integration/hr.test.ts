// End to end over HTTP: a payroll run from draft to paid, an attendance correction through
// approval, and an appraisal from self review to an approved increment written into payroll.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, COO, SUPPORT_LEAD, SUPPORT_IC, HR } from '../helpers.ts';
import { listAppraisals, getAppraisal, listCycles } from '../../src/modules/hr/appraisal.ts';
import { currentStructure, runForMonth, slipsOf, statutoryTotals } from '../../src/modules/hr/payroll.ts';
import { localDateString, addDays } from '../../src/lib/time.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });

const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };
const thisMonth = () => localDateString(new Date()).slice(0, 7);

describe('payroll run', () => {
  test('the COO can build, approve and pay a month', async () => {
    const coo = await login(COO);
    const month = thisMonth();
    const existing = runForMonth(s.app, month);
    assert.ok(existing, 'demo data leaves this month as a draft');
    assert.equal(existing!.status, 'draft');

    const approve = await coo.postJson(`/payroll/${existing!.id}/approve`, {});
    assert.equal(approve.status, 200, JSON.stringify(approve.json));
    assert.equal(runForMonth(s.app, month)!.status, 'approved');

    // An approved run can still be pulled back and rebuilt.
    const reopen = await coo.postJson(`/payroll/${existing!.id}/reopen`, { reason: 'One salary was wrong' });
    assert.equal(reopen.status, 200, JSON.stringify(reopen.json));
    assert.equal(runForMonth(s.app, month)!.status, 'draft');
    assert.equal((await coo.postJson(`/payroll/${existing!.id}/build`, {})).status, 200, 'and rebuilt');
    await coo.postJson(`/payroll/${existing!.id}/approve`, {});

    const paid = await coo.postJson(`/payroll/${existing!.id}/paid`, {});
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.ok(runForMonth(s.app, month)!.paid_at, 'the payment date is stamped');
  });

  test('a paid month is locked for good: corrections go in the next month', async () => {
    const coo = await login(COO);
    const run = runForMonth(s.app, thisMonth())!;
    assert.equal((await coo.postJson(`/payroll/${run.id}/build`, {})).status, 400, 'a paid run cannot be recalculated');
    const reopen = await coo.postJson(`/payroll/${run.id}/reopen`, { reason: 'Changed my mind' });
    assert.equal(reopen.status, 400, 'nor reopened — money has already left the bank');
  });

  test('every payslip nets out and the statutory totals agree with the slips', () => {
    const run = runForMonth(s.app, thisMonth())!;
    const slips = slipsOf(s.app, run.id);
    assert.ok(slips.length >= 40, 'the whole company is on the run');
    for (const p of slips) assert.equal(Math.round(p.net), Math.round(p.gross - p.total_deductions), `${p.employee_name} nets out`);
    const totals = statutoryTotals(s.app, run.id);
    assert.ok(totals.pfEmployee > 0 && totals.pt > 0, 'PF and PT are being deducted');
    assert.equal(Math.round(totals.totalPf), Math.round(totals.pfEmployee + totals.pfEmployer + totals.eps + totals.pfAdmin + totals.edli));
  });

  test('a payslip is private to its owner', async () => {
    const run = runForMonth(s.app, thisMonth())!;
    const someoneElse = slipsOf(s.app, run.id).find((p) => p.employee_id !== 'LS024')!;
    const ic = await login(SUPPORT_IC);
    const res = await ic.get(`/payroll/slip/${someoneElse.id}`);
    assert.ok([403, 404].includes(res.status), `an IC cannot read another payslip (got ${res.status})`);
    const hr = await login(HR);
    assert.equal((await hr.get(`/payroll/slip/${someoneElse.id}`)).status, 200, 'HR can');
  });

  test('the bank file lists one line per payslip', async () => {
    const coo = await login(COO);
    const run = runForMonth(s.app, thisMonth())!;
    const res = await coo.get(`/payroll/${run.id}/bank.csv`);
    assert.equal(res.status, 200);
    const lines = (await res.text()).trim().split('\n');
    assert.equal(lines.length, slipsOf(s.app, run.id).length + 1, 'a header plus every employee');
    assert.ok(lines[0].toLowerCase().includes('ifsc'), 'the header names the IFSC column');
  });
});

describe('attendance correction', () => {
  test('goes to the reporting manager and writes the day once approved', async () => {
    const ic = await login(SUPPORT_IC);
    // A working day with no record: pick a day well inside the window.
    const date = localDateString(addDays(new Date(), -3));
    s.app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', ['LS024', date]);
    s.app.db.run("DELETE FROM attendance_regularisations WHERE employee_id = ? AND status = 'pending'", ['LS024']);
    const req = await ic.postJson('/attendance/regularise', { date, checkIn: '09:35', checkOut: '18:40', reason: 'Was at the Chakan site from the morning' });
    if (req.status !== 200) { assert.match(String(req.json.error || ''), /working day|pending/i); return; }

    const row = s.app.db.get<{ id: string; task_id: string; status: string }>("SELECT id, task_id, status FROM attendance_regularisations WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1", ['LS024'])!;
    assert.equal(row.status, 'pending');
    const lead = await login(SUPPORT_LEAD);
    const decide = await lead.postJson(`/tasks/${row.task_id}/decide`, { decision: 'approved', note: 'Confirmed' });
    assert.equal(decide.status, 200, JSON.stringify(decide.json));
    const mid = s.app.db.get<{ status: string; hr_task_id: string }>('SELECT status, hr_task_id FROM attendance_regularisations WHERE id = ?', [row.id])!;
    assert.equal(mid.status, 'validated', 'the team lead validates; HR still has to approve');
    assert.equal(s.app.db.get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', ['LS024', date]), undefined, 'nothing is written before HR approves');
    const hr = await login(HR);
    const final = await hr.postJson(`/tasks/${mid.hr_task_id}/decide`, { decision: 'approved', note: 'Site visit confirmed with the customer log' });
    assert.equal(final.status, 200, JSON.stringify(final.json));
    assert.equal(s.app.db.get<{ status: string }>('SELECT status FROM attendance_regularisations WHERE id = ?', [row.id])!.status, 'approved');
    const att = s.app.db.get<{ source: string }>('SELECT source FROM attendance WHERE employee_id = ? AND date = ?', ['LS024', date]);
    assert.ok(att, 'the attendance row now exists');
  });

  test('somebody else cannot approve it', async () => {
    const ic = await login(SUPPORT_IC);
    const date = localDateString(addDays(new Date(), -5));
    s.app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', ['LS024', date]);
    s.app.db.run("DELETE FROM attendance_regularisations WHERE employee_id = ? AND status = 'pending'", ['LS024']);
    const req = await ic.postJson('/attendance/regularise', { date, checkIn: '09:35', reason: 'Phone was dead and I forgot to mark' });
    if (req.status !== 200) return;
    const row = s.app.db.get<{ task_id: string }>("SELECT task_id FROM attendance_regularisations WHERE employee_id = ? ORDER BY created_at DESC LIMIT 1", ['LS024'])!;
    const other = await login(HR);
    const res = await other.postJson(`/tasks/${row.task_id}/decide`, { decision: 'approved', note: 'Looks fine to me' });
    assert.equal(res.status, 403, 'only the assigned approver decides');
  });
});

describe('appraisal', () => {
  test('runs self review → manager → HOD → COO and then writes the new salary', async () => {
    const cycle = listCycles(s.app).find((c) => c.status === 'open')!;
    assert.ok(cycle, 'demo data has an open cycle');
    const mine = listAppraisals(s.app, { cycleId: cycle.id, status: ['self'], limit: 200 }).find((a) => a.manager_id && a.department_id === 'SUP')
      || listAppraisals(s.app, { cycleId: cycle.id, status: ['self'], limit: 200 }).find((a) => a.manager_id)!;
    assert.ok(mine, 'somebody still owes a self review');
    const subject = s.app.db.get<{ email: string }>('SELECT email FROM employees WHERE id = ?', [mine.employee_id])!;
    const subjectManager = s.app.db.get<{ email: string }>('SELECT email FROM employees WHERE id = ?', [mine.manager_id])!;

    const ic = await login(subject.email);
    const tooShort = await ic.postJson(`/appraisals/${mine.id}/self`, { review: 'Good year.', rating: 4 });
    assert.equal(tooShort.status, 400, 'a one-liner is not a review');

    const self = await ic.postJson(`/appraisals/${mine.id}/self`, { review: 'I closed the Nirmal Agro escalations and kept my SLA green all year. The hard part was covering the desk alone in August. Next year I want to own the onboarding calls.', rating: 4 });
    assert.equal(self.status, 200, JSON.stringify(self.json));
    assert.equal(getAppraisal(s.app, mine.id)!.status, 'manager');

    const notMyReview = await ic.postJson(`/appraisals/${mine.id}/manager`, { review: 'I did very well this year and deserve a strong rating, if I may say so myself.', rating: 5 });
    assert.equal(notMyReview.status, 403, 'you cannot write your own manager review');

    const lead = await login(subjectManager.email);
    const mgr = await lead.postJson(`/appraisals/${mine.id}/manager`, { review: 'They held the desk together through August and their tone with customers is the best on the team. They need to delegate more of the routine tickets.', rating: 4 });
    assert.equal(mgr.status, 200, JSON.stringify(mgr.json));
    assert.equal(getAppraisal(s.app, mine.id)!.status, 'moderation');

    const coo = await login(COO);
    const mod = await coo.postJson(`/appraisals/${mine.id}/moderate`, { finalRating: 4, incrementPct: 8, decision: 'Agreed. 8% keeps them inside the band.' });
    assert.equal(mod.status, 200, JSON.stringify(mod.json));
    const afterMod = getAppraisal(s.app, mine.id)!;
    assert.equal(afterMod.status, 'approval');
    assert.ok(afterMod.approval_task_id, 'an approval task went to the COO');
    assert.equal(afterMod.increment_pct, 8);

    const decide = await coo.postJson(`/tasks/${afterMod.approval_task_id}/decide`, { decision: 'approved', note: 'Approved' });
    assert.equal(decide.status, 200, JSON.stringify(decide.json));
    assert.equal(getAppraisal(s.app, mine.id)!.status, 'approved');

    const before = currentStructure(s.app, mine.employee_id)!;
    const hr = await login(HR);
    const effectiveFrom = `${localDateString(addDays(new Date(), 60)).slice(0, 7)}-01`;
    const apply = await hr.postJson(`/appraisals/${mine.id}/apply`, { effectiveFrom });
    assert.equal(apply.status, 200, JSON.stringify(apply.json));
    const after = currentStructure(s.app, mine.employee_id, effectiveFrom)!;
    assert.equal(after.ctc_annual, Math.round(before.ctc_annual * 1.08), 'the increment is in the new structure');
    assert.equal(getAppraisal(s.app, mine.id)!.status, 'closed');
  });

  test('an IC cannot moderate and cannot open a cycle', async () => {
    const ic = await login(SUPPORT_IC);
    const other = listAppraisals(s.app, { limit: 50 }).find((a) => a.employee_id !== 'LS024' && a.status === 'moderation');
    if (other) assert.equal((await ic.postJson(`/appraisals/${other.id}/moderate`, { finalRating: 5, incrementPct: 50, decision: 'x' })).status, 403);
    const cycle = listCycles(s.app)[0];
    assert.equal((await ic.postJson(`/appraisals/cycles/${cycle.id}/open`, {})).status, 403);
    assert.equal((await ic.postJson('/appraisals/probation-scan', {})).status, 403);
  });

  test('a probation review is decided by the manager and confirms the employee', async () => {
    const probation = listAppraisals(s.app, { kind: 'probation', status: ['manager'], limit: 10 })[0];
    assert.ok(probation, 'demo data has a probation review due');
    const manager = s.app.db.get<{ email: string }>('SELECT email FROM employees WHERE id = ?', [probation.manager_id])!;
    const mgr = await login(manager.email);
    const res = await mgr.postJson(`/appraisals/${probation.id}/probation`, { outcome: 'confirm', review: 'Picked the work up quickly and fits the team well. Happy to confirm.', rating: 4 });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const after = getAppraisal(s.app, probation.id)!;
    assert.equal(after.status, 'closed');
    assert.equal(after.decision, 'confirm');
    const e = s.app.db.get<{ probation_until: string | null; employment_type: string }>('SELECT probation_until, employment_type FROM employees WHERE id = ?', [probation.employee_id])!;
    assert.equal(e.probation_until, null, 'probation is cleared');
    assert.equal(e.employment_type, 'permanent');
  });

  test('an appraisal is not readable by an unrelated colleague', async () => {
    const other = listAppraisals(s.app, { limit: 100 }).find((a) => a.employee_id !== 'LS024' && a.manager_id !== 'LS024');
    assert.ok(other);
    const ic = await login(SUPPORT_IC);
    assert.equal((await ic.get(`/appraisals/${other!.id}`)).status, 403);
  });
});
