// Attendance rules HR can change, the punching machine (ZKTeco push), and the miss-punch report.
//
// The late rule, as the COO set it on 11 Nov 2026:
//   · Arriving within the grace period (15 minutes) is on time.
//   · Arriving later than that is a late arrival. Three are tolerated in a calendar month.
//   · From the fourth late arrival in the month, each one makes that day a half day.
// All three numbers are settings. Nothing here is hard-coded policy.
import { can } from '../../lib/scope.ts';
import type { App } from '../../app.ts';
import { setDefaults, onList } from '../../lib/lists.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { getSetting, shiftByCode } from '../../lib/settings.ts';
import { fromLocal, toLocal, localDateString } from '../../lib/time.ts';
import { getEmployee, type Employee } from '../people/model.ts';

const nowIso = () => new Date().toISOString();

// ---------- Rules ----------

export interface AttendanceRules {
  /** Minutes after shift start that still count as on time. */
  lateGraceMinutes: number;
  /** Late arrivals tolerated in a calendar month before the penalty applies. */
  lateAllowedPerMonth: number;
  /** What a late arrival beyond the allowance costs. */
  latePenalty: 'half_day' | 'none';
  /** How many days back a miss-punch request may be raised. */
  missPunchWindowDays: number;
  /** Requests in one month at which a person is flagged in the report. 0 switches the flag off. There is no cap. */
  missPunchFlagPerMonth: number;
  /** Take the first and last punch of the day from the machine as in and out. */
  machineIsSource: boolean;
}
export const DEFAULT_RULES: AttendanceRules = { lateGraceMinutes: 15, lateAllowedPerMonth: 3, latePenalty: 'half_day', missPunchWindowDays: 7, missPunchFlagPerMonth: 3, machineIsSource: true };

export function rules(app: App): AttendanceRules {
  const row = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'attendanceRules'");
  let saved: Partial<AttendanceRules> = {};
  if (row) { try { saved = JSON.parse(row.value) as Partial<AttendanceRules>; } catch { saved = {}; } }
  // Before these rules existed the grace period lived in the payroll settings; keep honouring it until HR saves the new ones.
  const legacy = row ? {} : { lateGraceMinutes: getSetting(app.db, 'payroll').lateGraceMinutes };
  return { ...DEFAULT_RULES, ...legacy, ...saved };
}
export function canEditRules(app: App, e: Employee): boolean { return can(app.db, e, 'attendance.manage'); }
export function saveRules(app: App, actor: Employee, input: Partial<Record<keyof AttendanceRules, unknown>>): AttendanceRules {
  if (!canEditRules(app, actor)) throw new HttpError(403, 'Only HR and the executives change attendance rules.');
  const before = rules(app);
  const int = (v: unknown, min: number, max: number, label: string): number => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`); return n; };
  const next: AttendanceRules = {
    lateGraceMinutes: input.lateGraceMinutes === undefined ? before.lateGraceMinutes : int(input.lateGraceMinutes, 0, 120, 'Grace minutes'),
    lateAllowedPerMonth: input.lateAllowedPerMonth === undefined ? before.lateAllowedPerMonth : int(input.lateAllowedPerMonth, 0, 31, 'Late arrivals allowed'),
    latePenalty: input.latePenalty === undefined ? before.latePenalty : input.latePenalty === 'none' ? 'none' : 'half_day',
    missPunchWindowDays: input.missPunchWindowDays === undefined ? before.missPunchWindowDays : int(input.missPunchWindowDays, 1, 90, 'Days back'),
    missPunchFlagPerMonth: input.missPunchFlagPerMonth === undefined ? before.missPunchFlagPerMonth : int(input.missPunchFlagPerMonth, 0, 31, 'Flag level'),
    machineIsSource: input.machineIsSource === undefined ? before.machineIsSource : !!input.machineIsSource
  };
  app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', ['attendanceRules', JSON.stringify(next), nowIso(), actor.id]);
  audit(app.db, { entity: 'settings', entityId: 'attendanceRules', action: 'update', actorId: actor.id, before, after: next });
  // A change of rule re-reads the current month for everyone, so what people see matches the rule in force. Earlier months are left as they were paid.
  const month = localDateString(new Date()).slice(0, 7);
  for (const e of app.db.all<{ employee_id: string }>('SELECT DISTINCT employee_id FROM attendance WHERE date LIKE ?', [`${month}-%`])) recomputeMonth(app, e.employee_id, month);
  return next;
}
export function rulesHistory(app: App): { at: string; actor: string; before: string; after: string }[] {
  return app.db.all<{ at: string; actor: string; before: string; after: string }>("SELECT a.at, COALESCE(e.full_name, 'System') AS actor, a.before, a.after FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id WHERE a.entity = 'settings' AND a.entity_id = 'attendanceRules' ORDER BY a.id DESC LIMIT 20");
}

/**
 * Re-read one person's month against the rules: minutes late, the running count of late arrivals, and the day value
 * (1, or 0.5 when very late, leaving very early, or late beyond the month's allowance). Safe to run any number of times.
 */
export function recomputeMonth(app: App, employeeId: string, month: string): { late: number; penalised: number } {
  const employee = getEmployee(app.db, employeeId);
  if (!employee) return { late: 0, penalised: 0 };
  const r = rules(app);
  const pay = getSetting(app.db, 'payroll');
  const shift = shiftByCode(app.db, employee.shift_code);
  const [sh, sm] = shift.start.split(':').map(Number); const [eh, em] = shift.end.split(':').map(Number);
  const rows = app.db.all<{ id: number; check_in: string | null; check_out: string | null }>("SELECT id, check_in, check_out FROM attendance WHERE employee_id = ? AND date LIKE ? ORDER BY date", [employeeId, `${month}-%`]);
  let late = 0, penalised = 0;
  for (const row of rows) {
    if (!row.check_in) continue;
    const minutesLate = Math.max(0, toLocal(new Date(row.check_in)).minuteOfDay - (sh * 60 + sm));
    const isLate = minutesLate > r.lateGraceMinutes;
    let value = 1; let penalty = '';
    if (minutesLate > pay.halfDayAfterMinutes) { value = 0.5; penalty = 'very_late'; }
    if (row.check_out) { const earlyBy = (eh * 60 + em) - toLocal(new Date(row.check_out)).minuteOfDay; if (earlyBy > pay.halfDayAfterMinutes) { value = 0.5; penalty = penalty || 'left_early'; } }
    if (isLate) {
      late++;
      if (r.latePenalty === 'half_day' && late > r.lateAllowedPerMonth) { value = 0.5; penalty = 'late_over_allowance'; penalised++; }
    }
    app.db.run('UPDATE attendance SET minutes_late = ?, day_value = ?, penalty = ? WHERE id = ?', [isLate ? minutesLate : 0, value, penalty, row.id]);
  }
  return { late, penalised };
}
/** Where someone stands this month: how many late arrivals, how many are allowed, how many cost a half day. */
export function lateStanding(app: App, employeeId: string, month: string): { late: number; allowed: number; penalised: number; penalty: string; grace: number } {
  const r = rules(app);
  const c = app.db.get<{ late: number; pen: number }>("SELECT sum(CASE WHEN minutes_late > 0 THEN 1 ELSE 0 END) AS late, sum(CASE WHEN penalty = 'late_over_allowance' THEN 1 ELSE 0 END) AS pen FROM attendance WHERE employee_id = ? AND date LIKE ?", [employeeId, `${month}-%`]);
  return { late: c?.late || 0, allowed: r.lateAllowedPerMonth, penalised: c?.pen || 0, penalty: r.latePenalty, grace: r.lateGraceMinutes };
}

// ---------- Punching machines ----------

export interface PunchDevice { sn: string; name: string; active: number; last_seen_at: string | null; last_ip: string; info: string; created_at: string; punches?: number }
export function listDevices(app: App): PunchDevice[] {
  return app.db.all<PunchDevice>('SELECT d.*, (SELECT count(*) FROM punches p WHERE p.device_sn = d.sn) AS punches FROM punch_devices d ORDER BY d.active DESC, d.created_at');
}
const cleanSn = (sn: string): string => sn.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
export function saveDevice(app: App, actor: Employee, input: { sn: string; name?: string; active?: boolean }): PunchDevice {
  if (!canEditRules(app, actor)) throw new HttpError(403, 'Only HR and the executives manage punching machines.');
  const sn = cleanSn(input.sn);
  if (sn.length < 4) throw new HttpError(400, 'Type the serial number printed on the machine (also shown in its System Info menu).');
  app.db.run(`INSERT INTO punch_devices (sn, name, active, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(sn) DO UPDATE SET name = CASE WHEN excluded.name = '' THEN punch_devices.name ELSE excluded.name END, active = excluded.active`, [sn, (input.name || '').trim().slice(0, 60), input.active === false ? 0 : 1, actor.id, nowIso()]);
  audit(app.db, { entity: 'punch_device', entityId: sn, action: input.active === false ? 'disabled' : 'enabled', actorId: actor.id });
  return app.db.get<PunchDevice>('SELECT * FROM punch_devices WHERE sn = ?', [sn])!;
}
/**
 * Every call from a machine passes through here. A machine HR has approved is allowed; any other serial number is noted
 * (so HR can see it knocked and approve it) and refused. At most 20 unknown machines are remembered.
 */
export function deviceAllowed(app: App, rawSn: string, ip: string, info = ''): boolean {
  const sn = cleanSn(rawSn || '');
  if (sn.length < 4) return false;
  const d = app.db.get<PunchDevice>('SELECT * FROM punch_devices WHERE sn = ?', [sn]);
  if (d) { app.db.run("UPDATE punch_devices SET last_seen_at = ?, last_ip = ?, info = CASE WHEN ? = '' THEN info ELSE ? END WHERE sn = ?", [nowIso(), ip.slice(0, 60), info, info.slice(0, 400), sn]); return d.active === 1; }
  const waiting = app.db.get<{ n: number }>('SELECT count(*) AS n FROM punch_devices WHERE active = 0')?.n || 0;
  if (waiting < 20) app.db.run('INSERT INTO punch_devices (sn, name, active, last_seen_at, last_ip, info, created_at) VALUES (?, ?, 0, ?, ?, ?, ?)', [sn, '', nowIso(), ip.slice(0, 60), info.slice(0, 400), nowIso()]);
  return false;
}

export interface ParsedPunch { pin: string; date: string; time: string; status: number | null; verify: number | null }
/**
 * Reads punch lines from a machine push (ATTLOG) or from an export file. A line needs a user ID followed by a date and a time;
 * separators can be tabs, commas or spaces, and the date can be 2026-11-10 or 10/11/2026 (day first, as machines sold in India print it).
 */
export function parsePunches(body: string): { punches: ParsedPunch[]; skipped: number } {
  const punches: ParsedPunch[] = []; let skipped = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^["']?([A-Za-z0-9_-]{1,24})["']?[\s,;]+["']?(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}))[ T,;]+(\d{1,2}):(\d{2})(?::(\d{2}))?["']?(?:[\s,;]+["']?(\d{1,3})["']?)?(?:[\s,;]+["']?(\d{1,3})["']?)?/);
    if (!m) { skipped++; continue; }
    const y = Number(m[2] || m[7]), mo = Number(m[3] || m[6]), d = Number(m[4] || m[5]), hh = Number(m[8]), mi = Number(m[9]), ss = Number(m[10] || 0);
    if (!(y >= 2000 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && hh < 24 && mi < 60 && ss < 60)) { skipped++; continue; }
    const p2 = (n: number) => String(n).padStart(2, '0');
    punches.push({ pin: m[1].replace(/^0+(?=\d)/, ''), date: `${y}-${p2(mo)}-${p2(d)}`, time: `${p2(hh)}:${p2(mi)}:${p2(ss)}`, status: m[11] !== undefined ? Number(m[11]) : null, verify: m[12] !== undefined ? Number(m[12]) : null });
  }
  return { punches, skipped };
}

/** First punch of the day is IN, last is OUT (when they are at least five minutes apart). An approved miss-punch correction is never overwritten. */
export function rebuildDay(app: App, employeeId: string, date: string): void {
  const ps = app.db.all<{ at: string }>('SELECT at FROM punches WHERE employee_id = ? AND local_date = ? ORDER BY at', [employeeId, date]);
  if (!ps.length) return;
  const first = ps[0].at; const last = ps[ps.length - 1].at;
  const out = new Date(last).getTime() - new Date(first).getTime() >= 5 * 60_000 ? last : null;
  const existing = app.db.get<{ id: number; source: string }>('SELECT id, source FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]);
  if (existing?.source === 'regularised') return;
  if (existing) app.db.run("UPDATE attendance SET check_in = ?, check_out = ?, source = 'machine', status = 'present' WHERE id = ?", [first, out, existing.id]);
  else app.db.run("INSERT INTO attendance (employee_id, date, check_in, check_out, source, status) VALUES (?, ?, ?, ?, 'machine', 'present')", [employeeId, date, first, out]);
}

export interface IngestResult { received: number; added: number; duplicates: number; unmatched: number; skipped: number; people: number }
/** Store punches, attach each to an employee by machine user ID, and rebuild the days they touch. Duplicates are ignored, so a machine can resend safely. */
export function ingestPunches(app: App, deviceSn: string, body: string, source: 'push' | 'file'): IngestResult {
  const { punches, skipped } = parsePunches(body);
  const pinMap = new Map(app.db.all<{ id: string; device_pin: string }>("SELECT id, device_pin FROM employees WHERE device_pin <> ''").map((e) => [e.device_pin, e.id]));
  const touched = new Map<string, Set<string>>();
  let added = 0, duplicates = 0, unmatched = 0;
  app.db.transaction(() => {
    for (const p of punches) {
      const [y, mo, d] = p.date.split('-').map(Number); const [hh, mi, ss] = p.time.split(':').map(Number);
      const at = new Date(fromLocal(y, mo, d, hh, mi).getTime() + ss * 1000).toISOString();
      const employeeId = pinMap.get(p.pin) || null;
      const res = app.db.run('INSERT OR IGNORE INTO punches (device_sn, pin, employee_id, at, local_date, local_time, status_code, verify, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [deviceSn, p.pin, employeeId, at, p.date, p.time, p.status, p.verify, source, nowIso()]);
      if (!res.changes) { duplicates++; continue; }
      added++;
      if (!employeeId) { unmatched++; continue; }
      if (!touched.has(employeeId)) touched.set(employeeId, new Set()); touched.get(employeeId)!.add(p.date);
    }
  });
  if (rules(app).machineIsSource) for (const [employeeId, dates] of touched) {
    for (const date of dates) rebuildDay(app, employeeId, date);
    for (const month of new Set([...dates].map((d) => d.slice(0, 7)))) recomputeMonth(app, employeeId, month);
  }
  return { received: punches.length, added, duplicates, unmatched, skipped, people: touched.size };
}

export function unmatchedPins(app: App): { pin: string; punches: number; first: string; last: string }[] {
  return app.db.all<{ pin: string; punches: number; first: string; last: string }>('SELECT pin, count(*) AS punches, min(local_date) AS first, max(local_date) AS last FROM punches WHERE employee_id IS NULL GROUP BY pin ORDER BY punches DESC LIMIT 200');
}
/** Give an employee their machine user ID. Punches already received under that ID are attached to them and their days rebuilt. */
export function setPin(app: App, actor: Employee, employeeId: string, pin: string): { attached: number } {
  if (!canEditRules(app, actor)) throw new HttpError(403, 'Only HR and the executives map machine IDs.');
  const e = getEmployee(app.db, employeeId);
  if (!e) throw new HttpError(404, 'Employee not found.');
  const clean = pin.trim().replace(/^0+(?=\d)/, '');
  if (clean && !/^[A-Za-z0-9_-]{1,24}$/.test(clean)) throw new HttpError(400, 'A machine user ID is letters and numbers only.');
  if (clean) { const other = app.db.get<{ full_name: string }>('SELECT full_name FROM employees WHERE device_pin = ? AND id <> ?', [clean, employeeId]); if (other) throw new HttpError(400, `Machine ID ${clean} already belongs to ${other.full_name}.`); }
  app.db.run('UPDATE employees SET device_pin = ?, updated_at = ? WHERE id = ?', [clean, nowIso(), employeeId]);
  audit(app.db, { entity: 'employee', entityId: employeeId, action: 'device_pin', actorId: actor.id, after: { pin: clean } });
  if (!clean) return { attached: 0 };
  const rows = app.db.all<{ local_date: string }>('SELECT DISTINCT local_date FROM punches WHERE pin = ? AND employee_id IS NULL', [clean]);
  app.db.run('UPDATE punches SET employee_id = ? WHERE pin = ? AND employee_id IS NULL', [employeeId, clean]);
  if (rules(app).machineIsSource) { for (const r of rows) rebuildDay(app, employeeId, r.local_date); for (const m of new Set(rows.map((r) => r.local_date.slice(0, 7)))) recomputeMonth(app, employeeId, m); }
  return { attached: rows.length };
}
export function punchesOf(app: App, employeeId: string, date: string): { local_time: string; device_sn: string; source: string }[] {
  return app.db.all('SELECT local_time, device_sn, source FROM punches WHERE employee_id = ? AND local_date = ? ORDER BY at', [employeeId, date]);
}
export function recentPunches(app: App, limit = 40): { local_date: string; local_time: string; pin: string; device_sn: string; source: string; employee_name: string | null }[] {
  return app.db.all('SELECT p.local_date, p.local_time, p.pin, p.device_sn, p.source, e.full_name AS employee_name FROM punches p LEFT JOIN employees e ON e.id = p.employee_id ORDER BY p.at DESC LIMIT ?', [limit]);
}

// ---------- Miss-punch report ----------

export const MISS_REASONS: { value: string; label: string }[] = [
  { value: 'forgot', label: 'Forgot to punch' }, { value: 'machine', label: 'Machine not working or not reading' }, { value: 'field', label: 'On field duty / client visit' },
  { value: 'early_late', label: 'Came before or left after the machine hours' }, { value: 'other', label: 'Other' }
];
setDefaults('hr.missReasons', MISS_REASONS.map((r) => ({ ...r, active: true })));
const ALL_MISS_REASONS = new Map<string, string>();
onList('hr.missReasons', (items) => { MISS_REASONS.length = 0; MISS_REASONS.push(...items.filter((i) => i.active).map((i) => ({ value: i.value, label: i.label }))); ALL_MISS_REASONS.clear(); for (const i of items) ALL_MISS_REASONS.set(i.value, i.label); });
export const reasonLabel = (code: string): string => ALL_MISS_REASONS.get(code) || code;

export interface MissPunchRow {
  id: string; employee_id: string; employee_name: string; department: string; date: string; kind: string; requested_in: string | null; requested_out: string | null;
  reason_code: string; reason: string; status: string; declined_stage: string; created_at: string;
  validated_by_name: string | null; validated_at: string | null; validator_note: string; decided_by_name: string | null; decided_at: string | null; hr_note: string;
}
export interface MissPunchReport {
  from: string; to: string; rows: MissPunchRow[];
  totals: { requested: number; approved: number; declined: number; waiting: number };
  byPerson: { employee_id: string; name: string; department: string; requested: number; approved: number; declined: number; waiting: number; topReason: string; worstMonth: number; flagged: boolean }[];
  byReason: { reason: string; count: number }[];
  byApprover: { name: string; role: string; decided: number; approved: number; declined: number }[];
  flagLevel: number;
}
/** Every miss-punch request in a period, with who asked, who validated, who approved and why — the basis for a disciplinary conversation. */
export function missPunchReport(app: App, f: { from: string; to: string; employeeIds?: string[]; departmentId?: string }): MissPunchReport {
  const where = ['r.date >= ?', 'r.date <= ?']; const params: (string | number)[] = [f.from, f.to];
  if (f.employeeIds) { if (!f.employeeIds.length) where.push('1 = 0'); else { where.push(`r.employee_id IN (${f.employeeIds.map(() => '?').join(',')})`); params.push(...f.employeeIds); } }
  if (f.departmentId) { where.push('e.department_id = ?'); params.push(f.departmentId); }
  const rows = app.db.all<MissPunchRow>(`SELECT r.id, r.employee_id, e.full_name AS employee_name, COALESCE(d.name, '') AS department, r.date, r.kind, r.requested_in, r.requested_out, r.reason_code, r.reason, r.status, r.declined_stage, r.created_at,
      v.full_name AS validated_by_name, r.validated_at, r.validator_note, h.full_name AS decided_by_name, r.decided_at, r.hr_note
    FROM attendance_regularisations r JOIN employees e ON e.id = r.employee_id LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees v ON v.id = r.validated_by LEFT JOIN employees h ON h.id = r.decided_by
    WHERE ${where.join(' AND ')} ORDER BY r.date DESC, r.id DESC LIMIT 5000`, params);
  const flagLevel = rules(app).missPunchFlagPerMonth;
  const waiting = (s: string) => s === 'pending' || s === 'validated';
  const people = new Map<string, MissPunchReport['byPerson'][number] & { reasons: Map<string, number>; months: Map<string, number> }>();
  const reasons = new Map<string, number>(); const approvers = new Map<string, MissPunchReport['byApprover'][number]>();
  const bump = (name: string | null, role: string, approved: boolean) => { if (!name) return; const k = `${role}:${name}`; const a = approvers.get(k) || { name, role, decided: 0, approved: 0, declined: 0 }; a.decided++; if (approved) a.approved++; else a.declined++; approvers.set(k, a); };
  for (const r of rows) {
    const p = people.get(r.employee_id) || { employee_id: r.employee_id, name: r.employee_name, department: r.department, requested: 0, approved: 0, declined: 0, waiting: 0, topReason: '', worstMonth: 0, flagged: false, reasons: new Map(), months: new Map() };
    p.requested++; if (r.status === 'approved') p.approved++; else if (r.status === 'declined') p.declined++; else if (waiting(r.status)) p.waiting++;
    p.reasons.set(r.reason_code, (p.reasons.get(r.reason_code) || 0) + 1); p.months.set(r.date.slice(0, 7), (p.months.get(r.date.slice(0, 7)) || 0) + 1);
    people.set(r.employee_id, p);
    reasons.set(r.reason_code, (reasons.get(r.reason_code) || 0) + 1);
    if (r.validated_by_name) bump(r.validated_by_name, 'Team lead', !(r.status === 'declined' && r.declined_stage === 'team_lead'));
    if (r.decided_by_name && (r.status === 'approved' || r.declined_stage === 'hr')) bump(r.decided_by_name, 'HR', r.status === 'approved');
  }
  const byPerson = [...people.values()].map((p) => { const worst = Math.max(0, ...p.months.values()); const top = [...p.reasons.entries()].sort((a, b) => b[1] - a[1])[0]; return { employee_id: p.employee_id, name: p.name, department: p.department, requested: p.requested, approved: p.approved, declined: p.declined, waiting: p.waiting, topReason: top ? reasonLabel(top[0]) : '', worstMonth: worst, flagged: flagLevel > 0 && worst >= flagLevel }; })
    .sort((a, b) => b.requested - a.requested || a.name.localeCompare(b.name));
  return {
    from: f.from, to: f.to, rows, flagLevel,
    totals: { requested: rows.length, approved: rows.filter((r) => r.status === 'approved').length, declined: rows.filter((r) => r.status === 'declined').length, waiting: rows.filter((r) => waiting(r.status)).length },
    byPerson, byReason: [...reasons.entries()].map(([k, n]) => ({ reason: reasonLabel(k), count: n })).sort((a, b) => b.count - a.count),
    byApprover: [...approvers.values()].sort((a, b) => b.decided - a.decided)
  };
}
