// Attendance: the late rule, two-step miss-punch and leave, the miss-punch report, and the ZKTeco punching machine.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, HR, COO, SUPPORT_LEAD, SUPPORT_IC, DEV_LEAD } from '../helpers.ts';
import { rules, saveRules, recomputeMonth, lateStanding, parsePunches, ingestPunches, setPin, saveDevice, listDevices, missPunchReport, unmatchedPins } from '../../src/modules/hr/attendance-rules.ts';
import { requestRegularisation, applyRegularisationDecision } from '../../src/modules/hr/attendance.ts';
import { requestLeave, decideTask, getTask } from '../../src/modules/tasks/service.ts';
import { fromLocal, localDateString, addDays, isWorkingDay } from '../../src/lib/time.ts';
import { shiftByCode, holidaySet } from '../../src/lib/settings.ts';

let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };

/** Put someone in at a number of minutes after their shift start on a date. */
function arrive(app: ReturnType<typeof testApp>, employeeId: string, date: string, minutesAfterStart: number): void {
  const e = app.db.get<{ shift_code: string }>('SELECT shift_code FROM employees WHERE id = ?', [employeeId])!;
  const [sh, sm] = shiftByCode(app.db, e.shift_code).start.split(':').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  const at = new Date(fromLocal(y, m, d, sh, sm).getTime() + minutesAfterStart * 60_000).toISOString();
  app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]);
  app.db.run("INSERT INTO attendance (employee_id, date, check_in, source, status) VALUES (?, ?, ?, 'self', 'present')", [employeeId, date, at]);
}
const day = (app: ReturnType<typeof testApp>, id: string, date: string) => ({ ...app.db.get<{ minutes_late: number; day_value: number; penalty: string }>('SELECT minutes_late, day_value, penalty FROM attendance WHERE employee_id = ? AND date = ?', [id, date])! });
/** Working days for a person, most recent first, starting `back` days ago. */
function workdays(app: ReturnType<typeof testApp>, employeeId: string, back: number, count: number): string[] {
  const e = app.db.get<{ shift_code: string }>('SELECT shift_code FROM employees WHERE id = ?', [employeeId])!; const shift = shiftByCode(app.db, e.shift_code); const hol = holidaySet(app.db); const out: string[] = [];
  for (let i = back; out.length < count && i < back + 14; i++) { const d = addDays(new Date(), -i); if (isWorkingDay(d, shift, hol)) out.push(localDateString(d)); }
  return out;
}

describe('the late rule', () => {
  test('within 15 minutes is on time; three late arrivals a month are tolerated; the fourth is a half day', () => {
    const app = testApp(); const ic = emp(app, SUPPORT_IC);
    assert.deepEqual([rules(app).lateGraceMinutes, rules(app).lateAllowedPerMonth, rules(app).latePenalty], [15, 3, 'half_day']);
    app.db.run('DELETE FROM attendance WHERE employee_id = ?', [ic.id]);
    arrive(app, ic.id, '2026-09-01', 0); arrive(app, ic.id, '2026-09-02', 15);   // on time, and exactly at the limit
    arrive(app, ic.id, '2026-09-03', 16); arrive(app, ic.id, '2026-09-04', 40); arrive(app, ic.id, '2026-09-07', 20);   // late 1, 2, 3
    arrive(app, ic.id, '2026-09-08', 10);                                         // on time again
    arrive(app, ic.id, '2026-09-09', 17); arrive(app, ic.id, '2026-09-10', 25);   // late 4 and 5
    const res = recomputeMonth(app, ic.id, '2026-09');
    assert.deepEqual(res, { late: 5, penalised: 2 });
    assert.deepEqual(day(app, ic.id, '2026-09-02'), { minutes_late: 0, day_value: 1, penalty: '' }, '15 minutes is still on time');
    for (const d of ['2026-09-03', '2026-09-04', '2026-09-07']) { assert.equal(day(app, ic.id, d).day_value, 1, `${d} is tolerated`); assert.ok(day(app, ic.id, d).minutes_late > 15); }
    assert.equal(day(app, ic.id, '2026-09-08').day_value, 1, 'an on-time day after the allowance is used is a full day');
    assert.deepEqual(day(app, ic.id, '2026-09-09'), { minutes_late: 17, day_value: 0.5, penalty: 'late_over_allowance' });
    assert.equal(day(app, ic.id, '2026-09-10').day_value, 0.5);
    assert.deepEqual({ ...lateStanding(app, ic.id, '2026-09') }, { late: 5, allowed: 3, penalised: 2, penalty: 'half_day', grace: 15 });

    // The count starts again each calendar month.
    arrive(app, ic.id, '2026-10-01', 30); recomputeMonth(app, ic.id, '2026-10');
    assert.equal(day(app, ic.id, '2026-10-01').day_value, 1);
  });

  test('HR or an executive can change the numbers, the change is recorded, and others cannot', async () => {
    const app = testApp(); const ic = emp(app, SUPPORT_IC), hr = emp(app, HR), coo = emp(app, COO);
    app.db.run('DELETE FROM attendance WHERE employee_id = ?', [ic.id]);
    const month = localDateString(new Date()).slice(0, 7);
    for (const d of ['01', '02', '03', '04']) arrive(app, ic.id, `${month}-${d}`, 20);
    recomputeMonth(app, ic.id, month);
    assert.equal(lateStanding(app, ic.id, month).penalised, 1);
    saveRules(app, hr, { lateAllowedPerMonth: 5 });
    assert.equal(lateStanding(app, ic.id, month).penalised, 0, 'this month is re-read under the new rule');
    saveRules(app, coo, { lateGraceMinutes: 30 });
    assert.equal(lateStanding(app, ic.id, month).late, 0, '20 minutes is now inside the grace period');
    saveRules(app, hr, { lateGraceMinutes: 10, lateAllowedPerMonth: 1, latePenalty: 'none' });
    assert.deepEqual([lateStanding(app, ic.id, month).late, lateStanding(app, ic.id, month).penalised], [4, 0], 'recorded only');
    assert.throws(() => saveRules(app, emp(app, SUPPORT_LEAD), { lateGraceMinutes: 60 }), /Only HR/);
    assert.throws(() => saveRules(app, hr, { lateGraceMinutes: -5 }), /whole number/);
    assert.equal(app.db.get<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE entity_id = 'attendanceRules'")!.n, 3, 'each change is on record');

    const hrC = await login(HR);
    assert.equal((await hrC.get('/attendance/rules')).status, 200);
    assert.equal((await hrC.postJson('/attendance/rules', { lateGraceMinutes: 15, lateAllowedPerMonth: 3, latePenalty: 'half_day', missPunchWindowDays: 10, missPunchFlagPerMonth: 2, machineIsSource: '1' })).status, 200);
    assert.equal(rules(s.app).missPunchWindowDays, 10);
    assert.equal((await (await login(SUPPORT_LEAD)).get('/attendance/rules')).status, 403);
    assert.match(await (await (await login(SUPPORT_IC)).get('/attendance')).text(), /Late arrivals this month: \d+ of 3 allowed/);
  });
});

describe('miss-punch requests', () => {

  test('team lead validates, HR approves, both must write a comment, and attendance changes only at the end', () => {
    const app = testApp(); const ic = emp(app, SUPPORT_IC), lead = emp(app, SUPPORT_LEAD), hr = emp(app, HR);
    const date = workdays(app, ic.id, 1, 1)[0];
    app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, date]);
    assert.throws(() => requestRegularisation(app, ic, { date: localDateString(addDays(new Date(), -30)), reason: 'Long ago, forgot' }), /last 7 days/);
    assert.throws(() => requestRegularisation(app, ic, { date, reason: 'x' }), /what happened/);
    const { id, task } = requestRegularisation(app, ic, { date, kind: 'in', checkIn: '11:55', reasonCode: 'machine', reason: 'The machine did not read my finger in the morning' });
    assert.equal(task.assignee_id, lead.id, 'step 1 goes to the reporting manager');
    assert.throws(() => requestRegularisation(app, ic, { date, reason: 'Asking again for the same day' }), /already waiting/);

    decideTask(app, lead, task.id, 'approved', 'Saw her at her desk at 9:50');
    applyRegularisationDecision(app, lead, id, 'approved', 'Saw her at her desk at 9:50');
    const mid = app.db.get<{ status: string; validated_by: string; validator_note: string; hr_task_id: string }>('SELECT * FROM attendance_regularisations WHERE id = ?', [id])!;
    assert.deepEqual([mid.status, mid.validated_by, mid.validator_note], ['validated', lead.id, 'Saw her at her desk at 9:50']);
    assert.equal(getTask(app, mid.hr_task_id)!.assignee_id, hr.id, 'step 2 goes to HR');
    assert.equal(app.db.get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, date]), undefined);

    decideTask(app, hr, mid.hr_task_id, 'approved', 'Machine log shows a failed read at 9:49');
    applyRegularisationDecision(app, hr, id, 'approved', 'Machine log shows a failed read at 9:49');
    const done = app.db.get<{ status: string; decided_by: string; hr_note: string }>('SELECT * FROM attendance_regularisations WHERE id = ?', [id])!;
    assert.deepEqual([done.status, done.decided_by, done.hr_note], ['approved', hr.id, 'Machine log shows a failed read at 9:49']);
    const att = app.db.get<{ source: string; minutes_late: number }>('SELECT source, minutes_late FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, date])!;
    assert.equal(att.source, 'regularised');
    assert.ok(att.minutes_late > 0, 'a corrected arrival that was late still counts as a late arrival');
  });

  test('over HTTP: no comment, no decision; a decline at either step is recorded with its stage', async () => {
    const ic = await login(SUPPORT_IC), lead = await login(SUPPORT_LEAD), hr = await login(HR);
    const icId = emp(s.app, SUPPORT_IC).id;
    s.app.db.run("DELETE FROM attendance_regularisations WHERE employee_id = ? AND status IN ('pending','validated')", [icId]);
    const dates = workdays(s.app, icId, 1, 2);
    const ids: string[] = [];
    for (const date of dates) {
      s.app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', [icId, date]);
      const r = await ic.postJson('/attendance/regularise', { date, kind: 'both', checkIn: '09:30', checkOut: '18:30', reasonCode: 'forgot', reason: 'Forgot to punch on the way in and out' });
      assert.equal(r.status, 200, JSON.stringify(r.json));
      ids.push(s.app.db.get<{ id: string }>('SELECT id FROM attendance_regularisations WHERE employee_id = ? AND date = ?', [icId, date])!.id);
    }
    const row = (id: string) => s.app.db.get<{ status: string; task_id: string; hr_task_id: string; declined_stage: string }>('SELECT * FROM attendance_regularisations WHERE id = ?', [id])!;
    assert.equal((await lead.postJson(`/tasks/${row(ids[0]).task_id}/decide`, { decision: 'approved' })).status, 400, 'a comment is required');
    assert.equal(row(ids[0]).status, 'pending', 'and nothing moved');
    assert.equal((await lead.postJson(`/tasks/${row(ids[0]).task_id}/decide`, { decision: 'declined', note: 'She was on leave that day, not at work' })).status, 200);
    assert.deepEqual([row(ids[0]).status, row(ids[0]).declined_stage], ['declined', 'team_lead']);
    assert.equal((await lead.postJson(`/tasks/${row(ids[1]).task_id}/decide`, { decision: 'approved', note: 'Was in the stand-up at 9:30' })).status, 200);
    assert.equal((await hr.postJson(`/tasks/${row(ids[1]).hr_task_id}/decide`, { decision: 'declined', note: 'Third time this month without a reason' })).status, 200);
    assert.deepEqual([row(ids[1]).status, row(ids[1]).declined_stage], ['declined', 'hr']);
    assert.equal(s.app.db.get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [icId, dates[1]]), undefined, 'a declined request changes nothing');
  });

  test('the report shows who asked, how often, who decided and why, and who may see it', async () => {
    const hr = await login(HR);
    const from = localDateString(addDays(new Date(), -40)), to = localDateString(new Date());
    const rep = missPunchReport(s.app, { from, to });
    const icId = emp(s.app, SUPPORT_IC).id;
    const mine = rep.byPerson.find((p) => p.employee_id === icId)!;
    assert.ok(mine.requested >= 2); assert.ok(mine.declined >= 2);
    assert.equal(mine.topReason, 'Forgot to punch');
    assert.equal(mine.flagged, true, 'two in a month reaches the flag level of 2 set earlier');
    assert.ok(rep.byApprover.some((a) => a.role === 'Team lead' && a.declined >= 1)); assert.ok(rep.byApprover.some((a) => a.role === 'HR' && a.declined >= 1));
    const page = await (await hr.get(`/attendance/miss-punch?from=${from}&to=${to}`)).text();
    for (const t of ['Miss-punch report', 'Declined by HR', 'Declined by team lead', 'Third time this month without a reason', 'Flagged']) assert.ok(page.includes(t), t);
    const csv = await hr.get(`/attendance/miss-punch.csv?from=${from}&to=${to}`);
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type') || '', /text\/csv/);
    const body = await csv.text();
    assert.match(body, /"Team lead comment"/); assert.match(body, /She was on leave that day, not at work/);

    const lead = await login(SUPPORT_LEAD);
    const teamPage = await (await lead.get(`/attendance/miss-punch?from=${from}&to=${to}`)).text();
    assert.match(teamPage, /your team/);
    const dev = await login(DEV_LEAD);
    const devPage = await (await dev.get(`/attendance/miss-punch?from=${from}&to=${to}&employee=${icId}`)).text();
    assert.ok(!devPage.includes('Third time this month without a reason'), 'another team’s lead does not see these requests');
  });
});

describe('leave', () => {
  test('manager first, HR final; a decline needs a reason; the balance moves only after HR', () => {
    const app = testApp(); const ic = emp(app, SUPPORT_IC), lead = emp(app, SUPPORT_LEAD), hr = emp(app, HR);
    const a = requestLeave(app, ic, { type: 'CL', from: '2026-11-23', to: '2026-11-23', reason: 'Bank work' });
    assert.equal(a.task.assignee_id, lead.id);
    assert.throws(() => decideTask(app, lead, a.task.id, 'declined', ''), /reason for declining/);
    decideTask(app, lead, a.task.id, 'approved', 'Team is covered');
    const row = () => app.db.get<{ status: string; manager_by: string; manager_note: string; hr_by: string | null; hr_note: string; hr_task_id: string }>('SELECT * FROM leave_requests WHERE id = ?', [a.leaveId])!;
    assert.deepEqual([row().status, row().manager_by, row().manager_note, row().hr_by], ['manager_approved', lead.id, 'Team is covered', null]);
    const hrTask = getTask(app, row().hr_task_id)!;
    assert.equal(hrTask.assignee_id, hr.id); assert.match(hrTask.title, /HR approval/);
    assert.throws(() => decideTask(app, lead, hrTask.id, 'approved'), /assigned to someone else/);
    decideTask(app, hr, hrTask.id, 'approved', 'Balance available');
    assert.deepEqual([row().status, row().hr_by, row().hr_note], ['approved', hr.id, 'Balance available']);

    const b = requestLeave(app, ic, { type: 'CL', from: '2026-11-24', to: '2026-11-24', reason: 'Personal' });
    decideTask(app, lead, b.task.id, 'approved');
    const b2 = app.db.get<{ hr_task_id: string }>('SELECT hr_task_id FROM leave_requests WHERE id = ?', [b.leaveId])!;
    decideTask(app, hr, b2.hr_task_id, 'declined', 'Month-end closing, please pick another day');
    const declined = app.db.get<{ status: string; hr_note: string }>('SELECT status, hr_note FROM leave_requests WHERE id = ?', [b.leaveId])!;
    assert.deepEqual([declined.status, declined.hr_note], ['declined', 'Month-end closing, please pick another day']);
  });
});

describe('the punching machine', () => {
  test('punch lines are read from a machine push and from export files in the usual shapes', () => {
    const push = '12\t2026-11-10 09:02:11\t0\t1\t0\t0\n12\t2026-11-10 18:31:40\t1\t1\t0\t0\n007\t2026-11-10 09:40:00\t0\t15\n';
    const p = parsePunches(push);
    assert.equal(p.punches.length, 3); assert.equal(p.skipped, 0);
    assert.deepEqual(p.punches[0], { pin: '12', date: '2026-11-10', time: '09:02:11', status: 0, verify: 1 });
    assert.equal(p.punches[2].pin, '7', 'leading zeros are dropped so 007 and 7 are one person');
    const csv = 'User ID,Date Time,State\n"45","10/11/2026 09:15",0\n45,10-11-2026 18:05:09,1\nnot a punch line\n';
    const c = parsePunches(csv);
    assert.equal(c.punches.length, 2); assert.equal(c.skipped, 2, 'the header and the junk line are skipped, not guessed');
    assert.deepEqual([c.punches[0].date, c.punches[0].time], ['2026-11-10', '09:15:00'], 'day-first dates are understood');
    assert.equal(parsePunches('9  2026-13-45 09:00:00').punches.length, 0);
  });

  test('first punch is in, last is out; unknown IDs wait for a person; resending adds nothing', () => {
    const app = testApp(); const hr = emp(app, HR), ic = emp(app, SUPPORT_IC), lead = emp(app, SUPPORT_LEAD);
    app.db.run('DELETE FROM attendance WHERE employee_id IN (?, ?)', [ic.id, lead.id]);
    setPin(app, hr, ic.id, '12');
    assert.throws(() => setPin(app, hr, lead.id, '12'), /already belongs/);
    assert.throws(() => setPin(app, lead, lead.id, '13'), /Only HR/);
    const body = '12\t2026-11-10 09:05:00\t0\t1\n12\t2026-11-10 13:10:00\t0\t1\n12\t2026-11-10 18:32:00\t1\t1\n77\t2026-11-10 09:45:00\t0\t1\n77\t2026-11-10 18:00:00\t1\t1\n12\t2026-11-11 09:31:00\t0\t1\n';
    const r1 = ingestPunches(app, 'ABC123', body, 'push');
    assert.deepEqual(r1, { received: 6, added: 6, duplicates: 0, unmatched: 2, skipped: 0, people: 1 });
    const d1 = app.db.get<{ check_in: string; check_out: string; source: string; minutes_late: number }>('SELECT check_in, check_out, source, minutes_late FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, '2026-11-10'])!;
    assert.equal(d1.source, 'machine');
    assert.equal(d1.check_in, fromLocal(2026, 11, 10, 9, 5).toISOString(), 'machine time is office time'); assert.equal(d1.check_out, fromLocal(2026, 11, 10, 18, 32).toISOString());
    const d2 = app.db.get<{ check_out: string | null }>('SELECT check_out FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, '2026-11-11'])!;
    assert.equal(d2.check_out, null, 'a single punch is an in with no out');
    assert.deepEqual(ingestPunches(app, 'ABC123', body, 'push'), { received: 6, added: 0, duplicates: 6, unmatched: 0, skipped: 0, people: 0 });

    assert.deepEqual(unmatchedPins(app).map((u) => [u.pin, u.punches]), [['77', 2]]);
    assert.deepEqual(setPin(app, hr, lead.id, '77'), { attached: 1 });
    assert.ok(app.db.get('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [lead.id, '2026-11-10']), 'earlier punches are attached once the ID has a person');
    assert.equal(unmatchedPins(app).length, 0);

    // An approved miss-punch correction is not overwritten by a later resend from the machine.
    app.db.run("UPDATE attendance SET source = 'regularised', check_in = ? WHERE employee_id = ? AND date = ?", [fromLocal(2026, 11, 11, 9, 0).toISOString(), ic.id, '2026-11-11']);
    ingestPunches(app, 'ABC123', '12\t2026-11-11 19:00:00\t1\t1\n', 'push');
    assert.equal(app.db.get<{ check_in: string }>('SELECT check_in FROM attendance WHERE employee_id = ? AND date = ?', [ic.id, '2026-11-11'])!.check_in, fromLocal(2026, 11, 11, 9, 0).toISOString());
  });

  test('a ZKTeco machine is answered only after HR approves its serial number', async () => {
    const raw = (path: string, init?: RequestInit) => fetch(s.base + path, init);
    const hello = await raw('/iclock/cdata?SN=CKJF201260123&options=all&pushver=2.4.1');
    assert.equal(hello.status, 403, 'an unknown machine is refused');
    const refused = await raw('/iclock/cdata?SN=CKJF201260123&table=ATTLOG&Stamp=0', { method: 'POST', body: '5\t2026-11-10 09:00:00\t0\t1\n' });
    assert.equal(refused.status, 403);
    assert.equal(s.app.db.get<{ n: number }>("SELECT count(*) AS n FROM punches WHERE device_sn = 'CKJF201260123'")!.n, 0, 'and nothing it sends is kept');
    const waiting = listDevices(s.app).find((d) => d.sn === 'CKJF201260123')!;
    assert.equal(waiting.active, 0, 'but HR can see that it knocked');

    const hr = await login(HR);
    assert.match(await (await hr.get('/attendance/machine')).text(), /waiting for you/);
    assert.equal((await hr.postJson('/attendance/machine/device', { sn: 'CKJF201260123', name: 'Main gate', active: '1' })).status, 200);
    const icId = emp(s.app, SUPPORT_IC).id;
    assert.equal((await hr.postJson('/attendance/machine/pin', { employeeId: icId, pin: '5' })).status, 200);

    const ok = await raw('/iclock/cdata?SN=CKJF201260123&options=all&pushver=2.4.1');
    assert.equal(ok.status, 200);
    const opts = await ok.text();
    assert.match(opts, /^GET OPTION FROM: CKJF201260123\n/); assert.match(opts, /Realtime=1/); assert.match(opts, /TimeZone=5\.5/);
    const date = '2026-10-06';
    s.app.db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?', [icId, date]);
    const sent = await raw('/iclock/cdata?SN=CKJF201260123&table=ATTLOG&Stamp=9999', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: `5\t${date} 09:10:00\t0\t1\t0\n5\t${date} 18:40:00\t1\t1\t0\n` });
    assert.equal(sent.status, 200); assert.equal(await sent.text(), 'OK: 2');
    const att = s.app.db.get<{ source: string; check_out: string | null }>('SELECT source, check_out FROM attendance WHERE employee_id = ? AND date = ?', [icId, date])!;
    assert.equal(att.source, 'machine'); assert.ok(att.check_out);
    assert.equal(await (await raw('/iclock/getrequest?SN=CKJF201260123')).text(), 'OK');
    assert.equal(await (await raw('/iclock/cdata?SN=CKJF201260123&table=OPERLOG&Stamp=1', { method: 'POST', body: 'OPLOG 4\t0\t2026-11-10 09:00:00\t0\t0\t0\t0\n' })).text(), 'OK');

    assert.equal((await hr.postJson('/attendance/machine/device', { sn: 'CKJF201260123', name: 'Main gate', active: '0' })).status, 200);
    assert.equal((await raw('/iclock/getrequest?SN=CKJF201260123')).status, 403, 'a machine that is switched off is refused again');

    const file = await hr.postJson('/attendance/machine/file', { name: 'attlog.dat', text: `5\t2026-10-07 09:00:00\t0\t1\n5\t2026-10-07 18:00:00\t1\t1\n` });
    assert.equal(file.status, 200, JSON.stringify(file.json)); assert.match(String(file.json.summary), /2 punches read: 2 new/);
    assert.equal((await hr.postJson('/attendance/machine/file', { name: 'x.txt', text: 'hello there, nothing useful here' })).status, 400);
    const lead = await login(SUPPORT_LEAD);
    assert.equal((await lead.get('/attendance/machine')).status, 403);
    assert.equal((await lead.postJson('/attendance/machine/file', { name: 'a.dat', text: '5\t2026-10-08 09:00:00\n' })).status, 403);
    void saveDevice;
  });
});
