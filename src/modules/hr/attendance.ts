// Attendance beyond check-in: late marks, half days, regularisation requests and the holiday calendar.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { getSetting, setSetting, shiftByCode, holidaySet } from '../../lib/settings.ts';
import { fromLocal, isWorkingDay, localDateString, toLocal, addDays } from '../../lib/time.ts';
import { getEmployee, type Employee } from '../people/model.ts';
import { createTask, decideTask, type Task } from '../tasks/service.ts';
import { rules, recomputeMonth, MISS_REASONS, reasonLabel } from './attendance-rules.ts';

export interface Regularisation { id: string; employee_id: string; date: string; requested_in: string | null; requested_out: string | null; reason: string; status: string; task_id: string | null; decided_by: string | null; decided_at: string | null; created_at: string; employee_name?: string;
  kind: string; reason_code: string; validated_by: string | null; validated_at: string | null; validator_note: string; hr_note: string; hr_task_id: string | null; declined_stage: string; validated_by_name?: string; decided_by_name?: string }

/** Minutes after the shift start, for a late mark. */
export function lateMinutes(app: App, employee: Employee, checkIn: Date): number {
  const shift = shiftByCode(app.db, employee.shift_code);
  const p = toLocal(checkIn);
  const [sh, sm] = shift.start.split(':').map(Number);
  return Math.max(0, p.minuteOfDay - (sh * 60 + sm));
}

/** Day value for payroll: 1 full day, 0.5 half day when very late or a short day. */
export function dayValue(app: App, employee: Employee, checkIn: Date, checkOut?: Date | null): { value: number; late: number } {
  const cfg = { ...getSetting(app.db, 'payroll'), lateGraceMinutes: rules(app).lateGraceMinutes };
  const late = lateMinutes(app, employee, checkIn);
  let value = 1;
  if (late > cfg.halfDayAfterMinutes) value = 0.5;
  if (checkOut) {
    const shift = shiftByCode(app.db, employee.shift_code);
    const [eh, em] = shift.end.split(':').map(Number);
    const out = toLocal(checkOut);
    const earlyBy = (eh * 60 + em) - out.minuteOfDay;
    if (earlyBy > cfg.halfDayAfterMinutes) value = Math.min(value, 0.5);
  }
  return { value, late: late > cfg.lateGraceMinutes ? late : 0 };
}

export function listRegularisations(app: App, f: { employeeId?: string; status?: string; employeeIds?: string[]; limit?: number } = {}): Regularisation[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.employeeId) { where.push('r.employee_id = ?'); params.push(f.employeeId); }
  if (f.employeeIds && f.employeeIds.length) { where.push(`r.employee_id IN (${f.employeeIds.map(() => '?').join(',')})`); params.push(...f.employeeIds); }
  if (f.status) { where.push('r.status = ?'); params.push(f.status); }
  params.push(f.limit || 100);
  return app.db.all<Regularisation>(`SELECT r.*, e.full_name AS employee_name, v.full_name AS validated_by_name, h.full_name AS decided_by_name FROM attendance_regularisations r JOIN employees e ON e.id = r.employee_id LEFT JOIN employees v ON v.id = r.validated_by LEFT JOIN employees h ON h.id = r.decided_by ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.date DESC, r.id DESC LIMIT ?`, params);
}

/**
 * A miss-punch request. Step 1: the reporting manager (team lead) validates. Step 2: HR approves. Attendance changes only
 * after HR approves, and each step carries a written comment. There is no cap on requests; the report shows who asks often.
 */
export function requestRegularisation(app: App, requester: Employee, input: { date: string; checkIn?: string; checkOut?: string; reason: string; kind?: string; reasonCode?: string }): { id: string; task: Task } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new HttpError(400, 'Pick the date of the missed punch.');
  const today = localDateString(new Date());
  if (input.date > today) throw new HttpError(400, 'You cannot raise a miss-punch for a day in the future.');
  const window = rules(app).missPunchWindowDays;
  if (input.date < localDateString(addDays(new Date(), -window))) throw new HttpError(400, `A miss-punch can be raised only for the last ${window} days. Speak to HR about anything older.`);
  if (input.reason.trim().length < 5) throw new HttpError(400, 'Write what happened, so your team lead and HR can decide.');
  const kind = ['in', 'out', 'both'].includes(input.kind || '') ? input.kind! : 'both';
  const reasonCode = MISS_REASONS.some((r) => r.value === input.reasonCode) ? input.reasonCode! : 'other';
  const shift = shiftByCode(app.db, requester.shift_code);
  if (!isWorkingDay(fromLocal(Number(input.date.slice(0, 4)), Number(input.date.slice(5, 7)), Number(input.date.slice(8, 10)), 12, 0), shift, holidaySet(app.db))) throw new HttpError(400, 'That is not a working day for your shift.');
  const open = app.db.get<{ id: string }>("SELECT id FROM attendance_regularisations WHERE employee_id = ? AND date = ? AND status IN ('pending', 'validated')", [requester.id, input.date]);
  if (open) throw new HttpError(400, 'A request for that day is already waiting.');
  // Keep what the machine already recorded for the half that was not missed.
  const have = app.db.get<{ check_in: string | null; check_out: string | null }>('SELECT check_in, check_out FROM attendance WHERE employee_id = ? AND date = ?', [requester.id, input.date]);
  const hhmm = (iso: string | null | undefined): string | null => { if (!iso) return null; const l = toLocal(new Date(iso)); return `${String(l.hh).padStart(2, '0')}:${String(l.mm).padStart(2, '0')}`; };
  const reqIn = kind === 'out' ? (hhmm(have?.check_in) || input.checkIn || shift.start) : (input.checkIn || shift.start);
  const reqOut = kind === 'in' ? (hhmm(have?.check_out) || input.checkOut || shift.end) : (input.checkOut || shift.end);
  const id = app.db.nextId('RG', 100);
  const company = getSetting(app.db, 'company');
  const approver = requester.reporting_manager_id || company.hrOwnerId || company.cooId;
  const what = kind === 'in' ? `in at ${reqIn}` : kind === 'out' ? `out at ${reqOut}` : `in ${reqIn}, out ${reqOut}`;
  const task = createTask(app, requester, { kind: 'approval', type: 'general', title: `Miss punch: ${requester.full_name}, ${input.date}`, details: `Missed ${what}. ${reasonLabel(reasonCode)}. ${input.reason.trim()} — Step 1 of 2: validate as team lead.`, assigneeId: approver, requesterId: requester.id, payload: { kind: 'regularisation', regularisationId: id }, link: '/attendance' });
  app.db.run('INSERT INTO attendance_regularisations (id, employee_id, date, requested_in, requested_out, reason, status, task_id, created_at, kind, reason_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, requester.id, input.date, reqIn, reqOut, input.reason.trim(), 'pending', task.id, new Date().toISOString(), kind, reasonCode]);
  audit(app.db, { entity: 'regularisation', entityId: id, action: 'request', actorId: requester.id, after: { date: input.date, kind, reasonCode } });
  return { id, task };
}

/** A decision on a miss-punch needs a written comment, whichever way it goes. Checked before the approval task is closed. */
export function requireMissPunchComment(note: string): void {
  if (note.trim().length < 5) throw new HttpError(400, 'Write a short comment with your decision. It is kept with the request and shown in the miss-punch report.');
}

/** Applied when an approval task for a miss-punch is decided. The stage is read from the request itself. */
export function applyRegularisationDecision(app: App, actor: Employee, regularisationId: string, decision: 'approved' | 'declined', note = ''): void {
  const r = app.db.get<Regularisation>('SELECT * FROM attendance_regularisations WHERE id = ?', [regularisationId]);
  if (!r || (r.status !== 'pending' && r.status !== 'validated')) return;
  const nowIso = new Date().toISOString();
  const requester = getEmployee(app.db, r.employee_id);
  const company = getSetting(app.db, 'company');
  const hrId = company.hrOwnerId || company.cooId;

  if (r.status === 'pending') {
    if (decision === 'declined') {
      app.db.run("UPDATE attendance_regularisations SET status = 'declined', declined_stage = 'team_lead', validated_by = ?, validated_at = ?, validator_note = ? WHERE id = ?", [actor.id, nowIso, note.trim(), regularisationId]);
      audit(app.db, { entity: 'regularisation', entityId: regularisationId, action: 'declined_by_team_lead', actorId: actor.id, after: { note } });
      return;
    }
    app.db.run("UPDATE attendance_regularisations SET status = 'validated', validated_by = ?, validated_at = ?, validator_note = ? WHERE id = ?", [actor.id, nowIso, note.trim(), regularisationId]);
    audit(app.db, { entity: 'regularisation', entityId: regularisationId, action: 'validated', actorId: actor.id, after: { note } });
    const hrTask = createTask(app, requester || actor, { kind: 'approval', type: 'general', title: `Miss punch: ${requester?.full_name || r.employee_id}, ${r.date}`, details: `In ${r.requested_in || '—'}, out ${r.requested_out || '—'}. ${reasonLabel(r.reason_code)}. ${r.reason} — Validated by ${actor.full_name}: “${note.trim()}”. Step 2 of 2: HR approval.`, assigneeId: hrId, requesterId: r.employee_id, payload: { kind: 'regularisation', regularisationId }, link: '/attendance' });
    app.db.run('UPDATE attendance_regularisations SET hr_task_id = ? WHERE id = ?', [hrTask.id, regularisationId]);
    return;
  }

  // HR step
  app.db.run('UPDATE attendance_regularisations SET status = ?, declined_stage = ?, decided_by = ?, decided_at = ?, hr_note = ? WHERE id = ?', [decision, decision === 'declined' ? 'hr' : '', actor.id, nowIso, note.trim(), regularisationId]);
  if (decision === 'approved') {
    const [y, m, d] = r.date.split('-').map(Number);
    const mk = (hhmm: string | null) => { if (!hhmm) return null; const [hh, mi] = hhmm.split(':').map(Number); return fromLocal(y, m, d, hh, mi).toISOString(); };
    const text = `Miss punch approved: ${r.reason}`;
    const existing = app.db.get<{ id: number }>('SELECT id FROM attendance WHERE employee_id = ? AND date = ?', [r.employee_id, r.date]);
    if (existing) app.db.run("UPDATE attendance SET check_in = ?, check_out = ?, source = 'regularised', status = 'present', note = ? WHERE id = ?", [mk(r.requested_in), mk(r.requested_out), text, existing.id]);
    else app.db.run("INSERT INTO attendance (employee_id, date, check_in, check_out, source, status, day_value, note) VALUES (?, ?, ?, ?, 'regularised', 'present', 1, ?)", [r.employee_id, r.date, mk(r.requested_in), mk(r.requested_out), text]);
    // The corrected time is judged like any other arrival: a late correction is still a late arrival.
    recomputeMonth(app, r.employee_id, r.date.slice(0, 7));
  }
  audit(app.db, { entity: 'regularisation', entityId: regularisationId, action: decision === 'approved' ? 'approved_by_hr' : 'declined_by_hr', actorId: actor.id, after: { note } });
}

export interface DayRow { date: string; working: boolean; holiday: boolean; checkIn: string | null; checkOut: string | null; status: string; dayValue: number; late: number; onLeave: string | null; note: string; penalty: string; source: string }

/** One month of attendance for a person, day by day. */
export function monthSheet(app: App, employee: Employee, month: string): { rows: DayRow[]; present: number; leave: number; absent: number; late: number; workingDays: number } {
  const [y, m] = month.split('-').map(Number);
  const shift = shiftByCode(app.db, employee.shift_code);
  const holidays = holidaySet(app.db);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const att = app.db.all<{ date: string; check_in: string | null; check_out: string | null; status: string; day_value: number; minutes_late: number; note: string; penalty: string; source: string }>('SELECT date, check_in, check_out, status, day_value, minutes_late, note, penalty, source FROM attendance WHERE employee_id = ? AND date LIKE ?', [employee.id, `${month}-%`]);
  const byDate = new Map(att.map((a) => [a.date, a]));
  const leaves = app.db.all<{ from_date: string; to_date: string; type: string }>("SELECT from_date, to_date, type FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND from_date <= ? AND to_date >= ?", [employee.id, `${month}-${String(daysInMonth).padStart(2, '0')}`, `${month}-01`]);
  const today = localDateString(new Date());
  const rows: DayRow[] = [];
  let present = 0, leave = 0, absent = 0, late = 0, workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const isHoliday = holidays.has(date);
    const working = isWorkingDay(fromLocal(y, m, d, 12, 0), shift, holidays);
    if (working) workingDays++;
    const a = byDate.get(date);
    const onLeave = leaves.find((l) => l.from_date <= date && l.to_date >= date)?.type || null;
    let status = !working ? (isHoliday ? 'holiday' : 'week off') : a?.check_in ? 'present' : onLeave ? 'leave' : date <= today ? 'absent' : '';
    if (working && a?.check_in) { present += a.day_value ?? 1; if ((a.minutes_late || 0) > 0) late++; }
    else if (working && onLeave) leave++;
    else if (working && status === 'absent') absent++;
    rows.push({ date, working, holiday: isHoliday, checkIn: a?.check_in || null, checkOut: a?.check_out || null, status, dayValue: a?.day_value ?? (working ? 0 : 0), late: a?.minutes_late || 0, onLeave, note: a?.note || '', penalty: a?.penalty || '', source: a?.source || '' });
  }
  return { rows, present, leave, absent, late, workingDays };
}

// ---------- Holiday calendar ----------
export interface Holiday { date: string; name: string }
export function holidayList(app: App): Holiday[] {
  const raw = getSetting(app.db, 'holidays');
  const names = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'holidayNames'");
  let map: Record<string, string> = {};
  try { map = names ? JSON.parse(names.value) : {}; } catch { map = {}; }
  return [...raw].sort().map((date) => ({ date, name: map[date] || '' }));
}
export function saveHolidays(app: App, actor: Employee, rows: Holiday[]): void {
  const valid = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  const dates = [...new Set(valid.map((r) => r.date))].sort();
  const names: Record<string, string> = {};
  for (const r of valid) if (r.name.trim()) names[r.date] = r.name.trim();
  setSetting(app.db, 'holidays', dates, actor.id);
  app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', ['holidayNames', JSON.stringify(names), new Date().toISOString(), actor.id]);
  audit(app.db, { entity: 'settings', entityId: 'holidays', action: 'update', actorId: actor.id, after: { count: dates.length } });
}

export { getEmployee, decideTask };
