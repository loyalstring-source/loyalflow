import type { App } from '../../app.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { getSetting, holidaySet, shiftByCode } from '../../lib/settings.ts';
import { addBusinessMinutes, fromLocal, isWorkingDay, localDateString, parseLocalDate, toLocal } from '../../lib/time.ts';
import { getDepartment, getEmployee, type Employee } from '../people/model.ts';
import type { SopStep } from '../../db/seed-master.ts';

export interface SopDefinition { id: string; name: string; department_id: string | null; owner_role: string; trigger: string; trigger_detail: string; steps: string; version: number; active: number; created_by: string | null; created_at: string; updated_at: string; department_name?: string }
export interface InstanceStep extends SopStep { done: boolean; doneAt: string | null; by: string | null; evidenceText: string; dueAt: string; onTime: boolean | null }
export interface SopInstance { id: string; sop_id: string; sop_version: number; date: string; assignee_id: string | null; department_id: string | null; steps: string; status: string; due_at: string; escalation_level: number; created_at: string; completed_at: string | null; sop_name?: string; assignee_name?: string | null; department_name?: string | null }

export function listSops(app: App, activeOnly = true): SopDefinition[] {
  return app.db.all<SopDefinition>(`SELECT s.*, d.name AS department_name FROM sop_definitions s LEFT JOIN departments d ON d.id = s.department_id ${activeOnly ? 'WHERE s.active = 1' : ''} ORDER BY s.name`);
}
export function getSop(app: App, id: string): SopDefinition | undefined { return app.db.get<SopDefinition>('SELECT * FROM sop_definitions WHERE id = ?', [id]); }
export function stepsOf(s: { steps: string }): SopStep[] { try { return JSON.parse(s.steps); } catch { return []; } }
export function instanceSteps(i: { steps: string }): InstanceStep[] { try { return JSON.parse(i.steps); } catch { return []; } }

export function saveSop(app: App, actor: Employee, input: { id?: string; name: string; departmentId: string; ownerRole: string; trigger: string; triggerDetail?: string; steps: SopStep[] }): SopDefinition {
  if (!input.name || input.steps.length === 0) throw new HttpError(400, 'An SOP needs a name and at least one step.');
  const nowIso = new Date().toISOString();
  const id = input.id || `SOP-${input.departmentId}-${Date.now().toString(36).toUpperCase()}`;
  const existing = getSop(app, id);
  if (existing) {
    app.db.run('UPDATE sop_definitions SET name = ?, department_id = ?, owner_role = ?, trigger = ?, trigger_detail = ?, steps = ?, version = version + 1, updated_at = ? WHERE id = ?',
      [input.name, input.departmentId, input.ownerRole, input.trigger, input.triggerDetail || '', JSON.stringify(input.steps), nowIso, id]);
  } else {
    app.db.run('INSERT INTO sop_definitions (id, name, department_id, owner_role, trigger, trigger_detail, steps, version, active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)',
      [id, input.name, input.departmentId, input.ownerRole, input.trigger, input.triggerDetail || '', JSON.stringify(input.steps), actor.id, nowIso, nowIso]);
  }
  audit(app.db, { entity: 'sop', entityId: id, action: existing ? 'update' : 'create', actorId: actor.id, after: { version: (existing?.version || 0) + 1 } });
  return getSop(app, id)!;
}

/** Who owns an SOP instance in a department, by the SOP's owner role. */
export function assigneeFor(app: App, sop: SopDefinition): string | null {
  if (!sop.department_id) return null;
  const dept = getDepartment(app.db, sop.department_id);
  if (sop.owner_role === 'hod') return dept?.hod_id || null;
  const lead = app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = ? AND functional_role = 'team_lead' AND status = 'active' ORDER BY id LIMIT 1", [sop.department_id]);
  if (sop.owner_role === 'team_lead') return lead?.id || dept?.hod_id || null;
  const ic = app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = ? AND status = 'active' ORDER BY CASE functional_role WHEN 'ic' THEN 0 ELSE 1 END, id LIMIT 1", [sop.department_id]);
  return ic?.id || lead?.id || dept?.hod_id || null;
}

function dueToday(sop: SopDefinition, date: Date, holidays: Set<string>, shiftDays: number[]): boolean {
  const p = toLocal(date);
  if (!shiftDays.includes(p.dow) || holidays.has(localDateString(date))) return false;
  if (sop.trigger === 'daily') return true;
  if (sop.trigger === 'weekly') return String(p.dow) === (sop.trigger_detail || '1');
  if (sop.trigger === 'monthly') return String(p.d) === (sop.trigger_detail || '1');
  return false;
}

/** Create today's checklist instances (idempotent). Event-triggered SOPs are started with startInstance(). */
export function generateInstances(app: App, date = new Date()): number {
  const holidays = holidaySet(app.db);
  let created = 0;
  for (const sop of listSops(app)) {
    const dept = sop.department_id ? getDepartment(app.db, sop.department_id) : undefined;
    const shift = shiftByCode(app.db, dept?.shift_code || 'GEN');
    if (!dueToday(sop, date, holidays, shift.days)) continue;
    const assignee = assigneeFor(app, sop);
    if (startInstance(app, sop, date, assignee, shift.code)) created++;
  }
  return created;
}

export function startInstance(app: App, sop: SopDefinition, date: Date, assigneeId: string | null, shiftCode = 'GEN'): SopInstance | null {
  const day = localDateString(date);
  if (app.db.get('SELECT id FROM sop_instances WHERE sop_id = ? AND date = ? AND assignee_id IS ?', [sop.id, day, assigneeId])) return null;
  const shift = shiftByCode(app.db, shiftCode);
  const holidays = holidaySet(app.db);
  const p = toLocal(parseLocalDate(day));
  const [sh, sm] = shift.start.split(':').map(Number);
  const start = fromLocal(p.y, p.m, p.d, sh, sm);
  const steps: InstanceStep[] = stepsOf(sop).map((s) => ({ ...s, done: false, doneAt: null, by: null, evidenceText: '', dueAt: addBusinessMinutes(start, s.dueOffsetMin, shift, holidays).toISOString(), onTime: null }));
  const dueAt = steps.reduce((m, s) => (s.dueAt > m ? s.dueAt : m), start.toISOString());
  const id = app.db.nextId('S');
  app.db.run('INSERT INTO sop_instances (id, sop_id, sop_version, date, assignee_id, department_id, steps, status, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, sop.id, sop.version, day, assigneeId, sop.department_id, JSON.stringify(steps), 'open', dueAt, new Date().toISOString()]);
  return getInstance(app, id)!;
}

const ISELECT = 'SELECT i.*, s.name AS sop_name, e.full_name AS assignee_name, d.name AS department_name FROM sop_instances i JOIN sop_definitions s ON s.id = i.sop_id LEFT JOIN employees e ON e.id = i.assignee_id LEFT JOIN departments d ON d.id = i.department_id';

export function getInstance(app: App, id: string): SopInstance | undefined { return app.db.get<SopInstance>(`${ISELECT} WHERE i.id = ?`, [id]); }

export function listInstances(app: App, f: { assigneeId?: string; assigneeIds?: string[]; date?: string; from?: string; to?: string; status?: string; departmentId?: string; limit?: number } = {}): SopInstance[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.assigneeId) { where.push('i.assignee_id = ?'); params.push(f.assigneeId); }
  if (f.assigneeIds && f.assigneeIds.length) { where.push(`i.assignee_id IN (${f.assigneeIds.map(() => '?').join(',')})`); params.push(...f.assigneeIds); }
  if (f.date) { where.push('i.date = ?'); params.push(f.date); }
  if (f.from) { where.push('i.date >= ?'); params.push(f.from); }
  if (f.to) { where.push('i.date <= ?'); params.push(f.to); }
  if (f.status) { where.push('i.status = ?'); params.push(f.status); }
  if (f.departmentId) { where.push('i.department_id = ?'); params.push(f.departmentId); }
  params.push(f.limit || 300);
  return app.db.all<SopInstance>(`${ISELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.date DESC, i.due_at LIMIT ?`, params);
}

export function completeStep(app: App, actor: Employee, instanceId: string, stepKey: string, evidenceText = '', done = true): SopInstance {
  const inst = getInstance(app, instanceId);
  if (!inst) throw new HttpError(404, 'Checklist not found');
  const steps = instanceSteps(inst);
  const step = steps.find((s) => s.key === stepKey);
  if (!step) throw new HttpError(404, 'Step not found');
  if (done && step.evidence !== 'none' && !evidenceText.trim() && !(step.evidence === 'record')) throw new HttpError(400, `This step needs evidence (${step.evidence}).`);
  const nowIso = new Date().toISOString();
  step.done = done; step.doneAt = done ? nowIso : null; step.by = done ? actor.id : null; step.evidenceText = done ? evidenceText.trim() : ''; step.onTime = done ? nowIso <= step.dueAt : null;
  const all = steps.every((s) => s.done);
  app.db.run('UPDATE sop_instances SET steps = ?, status = ?, completed_at = ? WHERE id = ?', [JSON.stringify(steps), all ? 'complete' : 'open', all ? nowIso : null, instanceId]);
  audit(app.db, { entity: 'sop_instance', entityId: instanceId, action: done ? 'step.done' : 'step.undone', actorId: actor.id, after: { stepKey, onTime: step.onTime } });
  return getInstance(app, instanceId)!;
}

/** Scheduler: overdue checklists escalate manager → HOD → COO after the grace period (decision J3). */
export function escalateOverdue(app: App, now = new Date()): number {
  const grace = getSetting(app.db, 'sop').graceBusinessMinutes;
  const company = getSetting(app.db, 'company');
  let escalated = 0;
  const open = app.db.all<SopInstance>(`${ISELECT} WHERE i.status = 'open' AND i.due_at < ?`, [now.toISOString()]);
  for (const inst of open) {
    const overdueMin = (now.getTime() - new Date(inst.due_at).getTime()) / 60_000;
    const level = overdueMin > grace * 2 ? 3 : overdueMin > grace ? 2 : 1;
    if (level <= inst.escalation_level) continue;
    const assignee = inst.assignee_id ? getEmployee(app.db, inst.assignee_id) : undefined;
    const dept = inst.department_id ? getDepartment(app.db, inst.department_id) : undefined;
    const target = level === 1 ? (assignee?.reporting_manager_id || dept?.hod_id) : level === 2 ? dept?.hod_id : company.cooId;
    app.db.run('UPDATE sop_instances SET escalation_level = ? WHERE id = ?', [level, inst.id]);
    const pending = instanceSteps(inst).filter((s) => !s.done).length;
    if (target) app.notify.send({ employeeId: target, title: `Overdue SOP: ${inst.sop_name} (${inst.date})`, body: `${assignee?.full_name || 'Unassigned'} has ${pending} step${pending === 1 ? '' : 's'} open past the due time.`, link: `/sop-runs/${inst.id}`, kind: level === 3 ? 'critical' : 'warn' });
    if (inst.assignee_id) app.notify.send({ employeeId: inst.assignee_id, title: `Overdue: ${inst.sop_name}`, body: `${pending} step${pending === 1 ? '' : 's'} open. ${level === 1 ? 'Your manager has been told.' : level === 2 ? 'Your HOD has been told.' : 'The COO has been told.'}`, link: `/sop-runs/${inst.id}`, kind: 'warn', email: false });
    escalated++;
  }
  return escalated;
}

/** Share of steps completed on time, for the given assignees and date range (inclusive, YYYY-MM-DD). */
export function compliance(app: App, f: { assigneeIds?: string[]; departmentId?: string; from: string; to: string }): { done: number; onTime: number; total: number; pct: number | null } {
  const rows = listInstances(app, { assigneeIds: f.assigneeIds, departmentId: f.departmentId, from: f.from, to: f.to, limit: 5000 });
  let done = 0, onTime = 0, total = 0;
  const now = new Date().toISOString();
  for (const inst of rows) for (const s of instanceSteps(inst)) {
    if (!s.done && s.dueAt > now) continue; // not yet due: not counted
    total++;
    if (s.done) { done++; if (s.onTime) onTime++; }
  }
  return { done, onTime, total, pct: total ? Math.round((onTime / total) * 100) : null };
}

export function isWorkingDayFor(app: App, date: Date, shiftCode: string): boolean {
  return isWorkingDay(date, shiftByCode(app.db, shiftCode), holidaySet(app.db));
}
