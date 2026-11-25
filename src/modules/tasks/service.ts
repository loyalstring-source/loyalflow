import type { App } from '../../app.ts';
import { stopItem, startWork, stopWork, openSession } from '../work/service.ts';
import { expenseDecided } from '../money/service.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { getSetting, type ApprovalRule } from '../../lib/settings.ts';
import { getDepartment, getEmployee, type Employee } from '../people/model.ts';

export type TaskKind = 'task' | 'approval';
export type TaskType = 'general' | 'leave' | 'expense' | 'discount' | 'offer' | 'invoice_request' | 'purchase' | 'design';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'approved' | 'declined' | 'cancelled';

export interface Task {
  id: string; kind: TaskKind; type: TaskType; title: string; details: string; amount: number | null; assignee_id: string | null; requester_id: string | null; created_by: string | null;
  status: TaskStatus; due_at: string | null; decided_at: string | null; decided_by: string | null; decision_note: string; payload: string; link: string; minutes_logged: number;
  timer_started_at: string | null; created_at: string; updated_at: string; assignee_name?: string | null; requester_name?: string | null;
}

const SELECT = 'SELECT t.*, a.full_name AS assignee_name, r.full_name AS requester_name FROM tasks t LEFT JOIN employees a ON a.id = t.assignee_id LEFT JOIN employees r ON r.id = t.requester_id';

export function getTask(app: App, id: string): Task | undefined { return app.db.get<Task>(`${SELECT} WHERE t.id = ?`, [id]); }

export function listTasks(app: App, f: { assigneeId?: string; requesterId?: string; status?: TaskStatus[]; kind?: TaskKind; limit?: number } = {}): Task[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.assigneeId) { where.push('t.assignee_id = ?'); params.push(f.assigneeId); }
  if (f.requesterId) { where.push('t.requester_id = ?'); params.push(f.requesterId); }
  if (f.kind) { where.push('t.kind = ?'); params.push(f.kind); }
  if (f.status && f.status.length) { where.push(`t.status IN (${f.status.map(() => '?').join(',')})`); params.push(...f.status); }
  params.push(f.limit || 200);
  return app.db.all<Task>(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, t.created_at DESC LIMIT ?`, params);
}

export function payloadOf<T = Record<string, unknown>>(t: Task): T { try { return JSON.parse(t.payload) as T; } catch { return {} as T; } }

/** Who must approve, by the configured thresholds. Returns the employee id. */
export function routeApproval(app: App, requester: Employee, type: 'expense' | 'discount' | 'leave' | 'purchase', amount: number): { approverId: string; ruleRole: ApprovalRule['role'] } {
  const rules = getSetting(app.db, 'approvals')[type];
  const company = getSetting(app.db, 'company');
  const dept = getDepartment(app.db, requester.department_id);
  const rule = rules.find((r) => (r.maxAmount !== undefined && amount <= r.maxAmount) || (r.maxPct !== undefined && amount <= r.maxPct) || (r.maxDays !== undefined && amount <= r.maxDays))
    || rules[rules.length - 1];
  const manager = requester.reporting_manager_id || company.cooId;
  const hod = dept?.hod_id && dept.hod_id !== requester.id ? dept.hod_id : (requester.reporting_manager_id || company.cooId);
  let approverId: string;
  switch (rule.role) {
    case 'self': approverId = requester.id; break;
    case 'manager': approverId = manager; break;
    case 'team_lead': approverId = requester.functional_role === 'ic' ? manager : hod; break;
    case 'hod': approverId = hod; break;
    case 'sales_head': approverId = company.salesHeadId; break;
    case 'ceo': approverId = company.ceoId; break;
    default: approverId = company.cooId;
  }
  if (approverId === requester.id && rule.role !== 'self') approverId = requester.reporting_manager_id || company.cooId;
  return { approverId, ruleRole: rule.role };
}

export interface NewTask { kind?: TaskKind; type?: TaskType; title: string; details?: string; amount?: number | null; assigneeId?: string | null; requesterId?: string | null; dueAt?: string | null; payload?: Record<string, unknown>; link?: string }

export function createTask(app: App, actor: Employee | null, input: NewTask): Task {
  if (!input.title || input.title.trim().length < 3) throw new HttpError(400, 'Give the task a title.');
  const id = app.db.nextId('A'); const nowIso = new Date().toISOString();
  app.db.run(`INSERT INTO tasks (id, kind, type, title, details, amount, assignee_id, requester_id, created_by, status, due_at, payload, link, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
    [id, input.kind || 'task', input.type || 'general', input.title.trim(), input.details || '', input.amount ?? null, input.assigneeId || null, input.requesterId || actor?.id || null,
      actor?.id || null, input.dueAt || null, JSON.stringify(input.payload || {}), input.link || '', nowIso, nowIso]);
  audit(app.db, { entity: 'task', entityId: id, action: 'create', actorId: actor?.id, after: { kind: input.kind, type: input.type, assignee: input.assigneeId } });
  if (input.assigneeId && input.assigneeId !== actor?.id) {
    app.notify.send({ employeeId: input.assigneeId, title: input.kind === 'approval' ? `Approval needed: ${input.title.trim()}` : `New task: ${input.title.trim()}`, body: input.details || '', link: `/approvals#${id}`, kind: input.kind === 'approval' ? 'warn' : 'info' });
  }
  return getTask(app, id)!;
}

export function requestApproval(app: App, requester: Employee, type: 'expense' | 'discount' | 'leave' | 'purchase', amount: number, title: string, details: string, payload: Record<string, unknown> = {}, link = ''): Task {
  const { approverId, ruleRole } = routeApproval(app, requester, type, amount);
  const task = createTask(app, requester, { kind: 'approval', type, title, details, amount, assigneeId: approverId, requesterId: requester.id, payload: { ...payload, ruleRole }, link });
  if (ruleRole === 'self') decideTask(app, requester, task.id, 'approved', 'Within own limit');
  return getTask(app, task.id)!;
}

/**
 * Leave is approved twice: first by the reporting manager, then finally by HR. It counts against the balance, and shows on the
 * attendance sheet, only after HR approves. A decline at either step needs a reason. When the first approver is HR's own
 * owner, or the person approving is the requester under their own limit, there is nobody else to ask and it is final.
 */
function leaveDecision(app: App, actor: Employee, t: Task, leaveId: string, decision: 'approved' | 'declined', note: string, nowIso: string): void {
  const l = app.db.get<{ id: string; employee_id: string; status: string; type: string; from_date: string; to_date: string; days: number; reason: string }>('SELECT * FROM leave_requests WHERE id = ?', [leaveId]);
  if (!l) return;
  const hrId = getSetting(app.db, 'company').hrOwnerId;
  const atHr = l.status === 'manager_approved';
  if (decision === 'declined') {
    if (atHr) app.db.run("UPDATE leave_requests SET status = 'declined', hr_by = ?, hr_at = ?, hr_note = ? WHERE id = ?", [actor.id, nowIso, note, leaveId]);
    else app.db.run("UPDATE leave_requests SET status = 'declined', manager_by = ?, manager_at = ?, manager_note = ? WHERE id = ?", [actor.id, nowIso, note, leaveId]);
    return;
  }
  if (atHr) { app.db.run("UPDATE leave_requests SET status = 'approved', hr_by = ?, hr_at = ?, hr_note = ? WHERE id = ?", [actor.id, nowIso, note, leaveId]); return; }
  const single = !hrId || actor.id === hrId || actor.id === l.employee_id || l.employee_id === hrId;
  if (single) { app.db.run("UPDATE leave_requests SET status = 'approved', manager_by = ?, manager_at = ?, manager_note = ?, hr_by = ?, hr_at = ?, hr_note = ? WHERE id = ?", [actor.id, nowIso, note, actor.id, nowIso, actor.id === hrId ? note : 'No separate HR step', leaveId]); return; }
  app.db.run("UPDATE leave_requests SET status = 'manager_approved', manager_by = ?, manager_at = ?, manager_note = ? WHERE id = ?", [actor.id, nowIso, note, leaveId]);
  const who = app.db.get<{ full_name: string }>('SELECT full_name FROM employees WHERE id = ?', [l.employee_id])?.full_name || l.employee_id;
  const hrTask = createTask(app, null, { kind: 'approval', type: 'leave', title: `Leave: ${who}, ${l.days} day${l.days > 1 ? 's' : ''} (${l.type}) — HR approval`, details: `${l.from_date} to ${l.to_date}. ${l.reason} — Approved by ${actor.full_name}${note ? `: “${note}”` : ''}. Step 2 of 2: HR approval.`.trim(), amount: l.days, assigneeId: hrId, requesterId: l.employee_id, payload: { leaveId, step: 'hr' }, link: '/approvals' });
  app.db.run('UPDATE leave_requests SET hr_task_id = ? WHERE id = ?', [hrTask.id, leaveId]);
}

export function decideTask(app: App, actor: Employee, id: string, decision: 'approved' | 'declined', note = ''): Task {
  const t = getTask(app, id);
  if (!t) throw new HttpError(404, 'Task not found');
  if (t.kind !== 'approval') throw new HttpError(400, 'Only approvals can be decided');
  if (t.status !== 'open') throw new HttpError(400, 'This request has already been decided');
  const company = getSetting(app.db, 'company');
  if (t.assignee_id !== actor.id && actor.id !== company.cooId && actor.id !== company.ceoId) throw new HttpError(403, 'This approval is assigned to someone else');
  if (t.type === 'leave' && decision === 'declined' && note.trim().length < 5) throw new HttpError(400, 'Give a reason for declining the leave. The person asking will see it.');
  const nowIso = new Date().toISOString();
  app.db.transaction(() => {
    app.db.run('UPDATE tasks SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?, updated_at = ? WHERE id = ?', [decision, nowIso, actor.id, note, nowIso, id]);
    audit(app.db, { entity: 'task', entityId: id, action: decision, actorId: actor.id, after: { note } });
    const p = payloadOf<{ leaveId?: string; expenseId?: string; dealId?: string }>(t);
    if (t.type === 'leave' && p.leaveId) leaveDecision(app, actor, t, p.leaveId, decision, note, nowIso);
    if (t.type === 'expense' && p.expenseId) { app.db.run('UPDATE expenses SET status = ? WHERE id = ?', [decision, p.expenseId]); expenseDecided(app, actor, p.expenseId, decision); }
    if (t.type === 'discount' && p.dealId) app.db.run('UPDATE deals SET discount_status = ?, updated_at = ? WHERE id = ?', [decision, nowIso, p.dealId]);
  });
  if (t.requester_id && t.requester_id !== actor.id) {
    const onward = decision === 'approved' && t.type === 'leave' && !!app.db.get("SELECT id FROM leave_requests WHERE task_id = ? AND status = 'manager_approved'", [t.id]);
    app.notify.send({ employeeId: t.requester_id, title: `${onward ? 'Approved by your manager, now with HR' : decision === 'approved' ? 'Approved' : 'Declined'}: ${t.title}`, body: note || (decision === 'approved' ? 'You can go ahead.' : 'Ask the approver for the reason if it is not in the note.'), link: t.link || `/approvals#${id}`, kind: decision === 'approved' ? 'success' : 'warn' });
  }
  return getTask(app, id)!;
}

export function completeTask(app: App, actor: Employee, id: string): Task {
  if (!getTask(app, id)) throw new HttpError(404, 'Task not found');
  stopItem(app, 'task', id);   // whoever is timing it stops, and that time is added
  const t = getTask(app, id)!; const nowIso = new Date().toISOString();
  app.db.run("UPDATE tasks SET status = 'done', decided_at = ?, decided_by = ?, timer_started_at = NULL, updated_at = ? WHERE id = ?", [nowIso, actor.id, nowIso, id]);
  audit(app.db, { entity: 'task', entityId: id, action: 'done', actorId: actor.id, after: { minutes: t.minutes_logged } });
  if (t.created_by && t.created_by !== actor.id) app.notify.send({ employeeId: t.created_by, title: `Done: ${t.title}`, body: `${actor.full_name} logged ${t.minutes_logged} minutes`, link: '/tasks', kind: 'success' });
  return getTask(app, id)!;
}

/** Start or stop work on a task (kept for callers that toggle; the work module does the recording). */
export function toggleTimer(app: App, actor: Employee, id: string): Task {
  if (!getTask(app, id)) throw new HttpError(404, 'Task not found');
  const cur = openSession(app, actor.id);
  if (cur && cur.entity_type === 'task' && cur.entity_id === id) stopWork(app, actor); else startWork(app, actor, 'task', id);
  return getTask(app, id)!;
}

export function requestLeave(app: App, requester: Employee, input: { type: string; from: string; to: string; reason?: string }): { leaveId: string; task: Task } {
  const from = new Date(input.from), to = new Date(input.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) throw new HttpError(400, 'Check the dates.');
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const leaveId = app.db.nextId('L');
  app.db.run('INSERT INTO leave_requests (id, employee_id, type, from_date, to_date, days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [leaveId, requester.id, input.type, input.from, input.to, days, input.reason || '', 'pending', new Date().toISOString()]);
  const task = requestApproval(app, requester, 'leave', days, `Leave: ${requester.full_name}, ${days} day${days > 1 ? 's' : ''} (${input.type})`, `${input.from} to ${input.to}. ${input.reason || ''}`.trim(), { leaveId }, '/approvals');
  app.db.run('UPDATE leave_requests SET task_id = ? WHERE id = ?', [task.id, leaveId]);
  return { leaveId, task };
}

export function submitExpense(app: App, requester: Employee, input: { category: string; amount: number; description?: string }): { expenseId: string; task: Task } {
  if (!(input.amount > 0)) throw new HttpError(400, 'Enter an amount.');
  const expenseId = app.db.nextId('E');
  app.db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [expenseId, requester.id, input.category, input.amount, input.description || '', 'pending', new Date().toISOString()]);
  const task = requestApproval(app, requester, 'expense', input.amount, `Expense: ₹${Math.round(input.amount).toLocaleString('en-IN')} ${input.category} for ${requester.full_name}`, input.description || '', { expenseId }, '/approvals');
  app.db.run('UPDATE expenses SET task_id = ? WHERE id = ?', [task.id, expenseId]);
  return { expenseId, task };
}

export function overdueTaskCount(app: App, assigneeIds: string[], now = new Date()): number {
  if (!assigneeIds.length) return 0;
  return app.db.get<{ n: number }>(`SELECT count(*) AS n FROM tasks WHERE status IN ('open','in_progress') AND due_at < ? AND assignee_id IN (${assigneeIds.map(() => '?').join(',')})`, [now.toISOString(), ...assigneeIds])?.n || 0;
}

export function employeeName(app: App, id: string | null): string { return id ? getEmployee(app.db, id)?.full_name || id : ''; }
