// Work in hand: what each person has pending, what they are working on now, and the breaks they take.
// A person starts work on one item at a time. Starting, taking a break, resuming and stopping are each recorded
// as a session, so the team lead and the executives can see the day as it happened.
import type { App } from '../../app.ts';
import type { Params } from '../../db/index.ts';
import type { Employee } from '../people/model.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { scopeFor } from '../../lib/scope.ts';
import { localDateString } from '../../lib/time.ts';

export type WorkType = 'task' | 'dsr' | 'ticket' | 'issue';
export const WORK_TYPE_LABEL: Record<WorkType, string> = { task: 'Task', dsr: 'Daily review', ticket: 'Ticket', issue: 'Development' };
export const BREAK_REASONS = ['Lunch', 'Tea', 'Personal', 'Meeting', 'Other'];
/** A session left running is counted up to these limits, so a forgotten timer cannot claim a whole night. */
const MAX_WORK_MIN = 600; const MAX_BREAK_MIN = 180;

export interface Session { id: number; employee_id: string; entity_type: WorkType; entity_id: string; title: string; kind: 'work' | 'break'; note: string; started_at: string; ended_at: string | null; minutes: number }
export interface PendingItem { type: WorkType; id: string; title: string; sub: string; href: string; due: string | null; from: string | null; minutes: number; overdue: boolean }

const TZ = "'+330 minutes'";
const isWorkType = (t: string): t is WorkType => t === 'task' || t === 'dsr' || t === 'ticket' || t === 'issue';
const minutesBetween = (from: string, to: number, cap: number): number => Math.max(0, Math.min(cap, Math.round((to - new Date(from).getTime()) / 60_000)));

export function openSession(app: App, employeeId: string): Session | undefined {
  return app.db.get<Session>('SELECT * FROM work_sessions WHERE employee_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [employeeId]);
}

/** The item a person may work on: it must be theirs and still open. */
function ownItem(app: App, actor: Employee, type: WorkType, id: string): { title: string } {
  if (type === 'task') {
    const t = app.db.get<{ title: string; assignee_id: string | null; status: string; kind: string }>('SELECT title, assignee_id, status, kind FROM tasks WHERE id = ?', [id]);
    if (!t || t.kind !== 'task') throw new HttpError(404, 'Task not found.');
    if (t.assignee_id !== actor.id) throw new HttpError(403, 'This task is not assigned to you.');
    if (!['open', 'in_progress'].includes(t.status)) throw new HttpError(400, 'This task is already finished.');
    return { title: t.title };
  }
  if (type === 'dsr') {
    const i = app.db.get<{ title: string; customer: string; employee_id: string; kind: string }>('SELECT title, customer, employee_id, kind FROM dsr_items WHERE id = ?', [id]);
    if (!i) throw new HttpError(404, 'That daily-review line no longer exists.');
    if (i.employee_id !== actor.id) throw new HttpError(403, 'This line is not yours.');
    return { title: i.kind === 'collection' ? `Collection: ${i.customer || i.title}` : i.title };
  }
  if (type === 'ticket') {
    const t = app.db.get<{ subject: string; assignee_id: string | null; status: string }>('SELECT subject, assignee_id, status FROM tickets WHERE id = ?', [id]);
    if (!t) throw new HttpError(404, 'Ticket not found.');
    if (t.assignee_id !== actor.id) throw new HttpError(403, 'This ticket is not assigned to you.');
    if (['resolved', 'closed'].includes(t.status)) throw new HttpError(400, 'This ticket is already closed.');
    return { title: `${id} · ${t.subject}` };
  }
  const x = app.db.get<{ title: string; assignee_id: string | null; status: string }>('SELECT title, assignee_id, status FROM dev_issues WHERE id = ?', [id]);
  if (!x) throw new HttpError(404, 'Board item not found.');
  if (x.assignee_id !== actor.id) throw new HttpError(403, 'This board item is not assigned to you.');
  if (x.status === 'released') throw new HttpError(400, 'This item is already released.');
  return { title: `${id} · ${x.title}` };
}

/** Ends the running session, if any, and adds its time to the task it belongs to. */
function closeOpen(app: App, employeeId: string, now = new Date()): Session | undefined {
  const s = openSession(app, employeeId); if (!s) return undefined;
  const minutes = minutesBetween(s.started_at, now.getTime(), s.kind === 'work' ? MAX_WORK_MIN : MAX_BREAK_MIN);
  // A session that hit the limit ends at the limit, not now.
  const hitCap = minutes === (s.kind === 'work' ? MAX_WORK_MIN : MAX_BREAK_MIN);
  const ended = hitCap ? new Date(new Date(s.started_at).getTime() + minutes * 60_000).toISOString() : now.toISOString();
  app.db.run('UPDATE work_sessions SET ended_at = ?, minutes = ? WHERE id = ?', [ended, minutes, s.id]);
  if (s.entity_type === 'task') app.db.run(`UPDATE tasks SET minutes_logged = minutes_logged + ?, timer_started_at = NULL, updated_at = ? WHERE id = ?`, [s.kind === 'work' ? minutes : 0, now.toISOString(), s.entity_id]);
  return { ...s, ended_at: ended, minutes };
}
function open(app: App, employeeId: string, type: WorkType, id: string, title: string, kind: 'work' | 'break', note: string, now: Date): Session {
  app.db.run('INSERT INTO work_sessions (employee_id, entity_type, entity_id, title, kind, note, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [employeeId, type, id, title, kind, note, now.toISOString()]);
  if (type === 'task') app.db.run(`UPDATE tasks SET timer_started_at = ?, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = ? WHERE id = ?`, [kind === 'work' ? now.toISOString() : null, now.toISOString(), id]);
  return openSession(app, employeeId)!;
}

/** Start (or switch to) an item. Whatever was running stops first: one thing at a time. */
export function startWork(app: App, actor: Employee, type: string, id: string, now = new Date()): Session {
  if (!isWorkType(type) || !id) throw new HttpError(400, 'Choose what to start.');
  const item = ownItem(app, actor, type, id);
  const cur = openSession(app, actor.id);
  if (cur && cur.kind === 'work' && cur.entity_type === type && cur.entity_id === id) return cur;
  return app.db.transaction(() => { closeOpen(app, actor.id, now); return open(app, actor.id, type, id, item.title, 'work', '', now); });
}
export function takeBreak(app: App, actor: Employee, reason: unknown, now = new Date()): Session {
  const cur = openSession(app, actor.id);
  if (!cur) throw new HttpError(400, 'Start a task first, then mark the break.');
  if (cur.kind === 'break') return cur;
  const note = BREAK_REASONS.includes(String(reason)) ? String(reason) : String(reason || '').trim().slice(0, 80) || 'Break';
  return app.db.transaction(() => { closeOpen(app, actor.id, now); return open(app, actor.id, cur.entity_type, cur.entity_id, cur.title, 'break', note, now); });
}
/** Back from a break, onto the same item. */
export function resumeWork(app: App, actor: Employee, now = new Date()): Session {
  const cur = openSession(app, actor.id);
  if (!cur || cur.kind !== 'break') throw new HttpError(400, 'You are not on a break.');
  return app.db.transaction(() => {
    closeOpen(app, actor.id, now);
    try { ownItem(app, actor, cur.entity_type, cur.entity_id); } catch { throw new HttpError(400, 'That item has been finished or passed on. Choose another to start.'); }
    return open(app, actor.id, cur.entity_type, cur.entity_id, cur.title, 'work', '', now);
  });
}
export function stopWork(app: App, actor: Employee, now = new Date()): Session | undefined { return closeOpen(app, actor.id, now); }
/** When an item is finished or passed on, whoever is timing it stops. */
export function stopItem(app: App, type: WorkType, id: string, now = new Date()): void {
  for (const s of app.db.all<{ employee_id: string }>('SELECT employee_id FROM work_sessions WHERE entity_type = ? AND entity_id = ? AND ended_at IS NULL', [type, id])) closeOpen(app, s.employee_id, now);
}

/** Minutes of work already recorded against each item, by "type:id". */
function workedOn(app: App, employeeId: string): Map<string, number> {
  return new Map(app.db.all<{ k: string; m: number }>(`SELECT entity_type || ':' || entity_id AS k, COALESCE(SUM(minutes), 0) AS m FROM work_sessions WHERE employee_id = ? AND kind = 'work' GROUP BY entity_type, entity_id`, [employeeId]).map((r) => [r.k, r.m]));
}

/** Everything waiting for one person: tasks, today's daily-review lines, tickets and board items. */
export function pendingFor(app: App, employeeId: string, day: string, now = new Date()): PendingItem[] {
  const done = workedOn(app, employeeId); const nowIso = now.toISOString(); const out: PendingItem[] = [];
  const m = (type: WorkType, id: string): number => done.get(`${type}:${id}`) || 0;
  for (const t of app.db.all<{ id: string; title: string; details: string; due_at: string | null; from_name: string | null; requester_id: string | null }>(`SELECT t.id, t.title, t.details, t.due_at, r.full_name AS from_name, t.requester_id FROM tasks t LEFT JOIN employees r ON r.id = COALESCE(t.requester_id, t.created_by)
    WHERE t.kind = 'task' AND t.assignee_id = ? AND t.status IN ('open', 'in_progress') ORDER BY (t.due_at IS NULL), t.due_at, t.created_at`, [employeeId]))
    out.push({ type: 'task', id: t.id, title: t.title, sub: t.details, href: '', due: t.due_at, from: t.requester_id === employeeId ? null : t.from_name, minutes: m('task', t.id), overdue: !!t.due_at && t.due_at < nowIso });
  for (const i of app.db.all<{ id: string; title: string; customer: string; kind: string; department_id: string; planned_hours: number | null; status: string; self_status: string; by_name: string | null; created_by: string | null }>(`SELECT i.id, i.title, i.customer, i.kind, i.department_id, i.planned_hours, i.status, i.self_status, c.full_name AS by_name, i.created_by FROM dsr_items i LEFT JOIN employees c ON c.id = i.created_by
    WHERE i.employee_id = ? AND i.day = ? AND COALESCE(i.slot_from, '') = '' AND i.status = 'planned' AND COALESCE(i.self_status, '') NOT IN ('done') ORDER BY i.created_at, i.id`, [employeeId, day]))
    out.push({ type: 'dsr', id: i.id, title: i.kind === 'collection' ? `Collection: ${i.customer || i.title}` : i.title, sub: i.planned_hours ? `${i.planned_hours} h planned today` : 'Planned for today', href: `/dsr?team=${i.department_id}&day=${day}`, due: null, from: i.created_by === employeeId ? null : i.by_name, minutes: m('dsr', i.id), overdue: false });
  for (const t of app.db.all<{ id: string; subject: string; priority: string; status: string; resolve_due_at: string | null; customer: string | null }>(`SELECT t.id, t.subject, t.priority, t.status, t.resolve_due_at, c.name AS customer FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id
    WHERE t.assignee_id = ? AND t.status NOT IN ('resolved', 'closed') ORDER BY (t.resolve_due_at IS NULL), t.resolve_due_at`, [employeeId]))
    out.push({ type: 'ticket', id: t.id, title: `${t.id} · ${t.subject}`, sub: [t.customer, t.priority, t.status.replace(/_/g, ' ')].filter(Boolean).join(' · '), href: `/tickets/${t.id}`, due: t.resolve_due_at, from: null, minutes: m('ticket', t.id), overdue: !!t.resolve_due_at && t.resolve_due_at < nowIso });
  for (const x of app.db.all<{ id: string; title: string; status: string; priority: string; due_date: string | null; type: string }>(`SELECT id, title, status, priority, due_date, type FROM dev_issues WHERE assignee_id = ? AND status NOT IN ('released', 'backlog') ORDER BY (due_date IS NULL), due_date, id`, [employeeId]))
    out.push({ type: 'issue', id: x.id, title: `${x.id} · ${x.title}`, sub: [x.type, x.priority, x.status.replace(/_/g, ' ')].filter(Boolean).join(' · '), href: `/dev/${x.id}`, due: x.due_date, from: null, minutes: m('issue', x.id), overdue: !!x.due_date && x.due_date < day });
  return out;
}

export interface DayOfPerson {
  id: string; name: string; designation: string; team: string;
  state: 'working' | 'break' | 'idle'; current: Session | null; sessions: Session[];
  workedMin: number; breakMin: number; breaks: number; firstStart: string | null; pending: PendingItem[];
}
/** Sessions that touch a local day, with a running one counted up to now (or its limit). */
function sessionsOn(app: App, ids: string[], day: string, now: Date): Session[] {
  if (!ids.length) return [];
  const p: Params = [...ids, day];
  return app.db.all<Session>(`SELECT * FROM work_sessions WHERE employee_id IN (${ids.map(() => '?').join(',')}) AND date(started_at, ${TZ}) = ? ORDER BY started_at, id`, p)
    .map((s) => (s.ended_at ? s : { ...s, minutes: minutesBetween(s.started_at, now.getTime(), s.kind === 'work' ? MAX_WORK_MIN : MAX_BREAK_MIN) }));
}
export function dayOf(app: App, people: { id: string; full_name: string; designation: string; team: string }[], day: string, now = new Date()): DayOfPerson[] {
  const all = sessionsOn(app, people.map((x) => x.id), day, now); const today = localDateString(now) === day;
  return people.map((e) => {
    const sessions = all.filter((s) => s.employee_id === e.id); const cur = today ? openSession(app, e.id) || null : null;
    const live = cur && minutesBetween(cur.started_at, now.getTime(), 100_000) < (cur.kind === 'work' ? MAX_WORK_MIN : MAX_BREAK_MIN) ? cur : null;
    return { id: e.id, name: e.full_name, designation: e.designation, team: e.team, state: live ? (live.kind === 'work' ? 'working' : 'break') : 'idle', current: live, sessions,
      workedMin: sessions.filter((s) => s.kind === 'work').reduce((n, s) => n + s.minutes, 0), breakMin: sessions.filter((s) => s.kind === 'break').reduce((n, s) => n + s.minutes, 0),
      breaks: sessions.filter((s) => s.kind === 'break').length, firstStart: sessions[0]?.started_at || null, pending: today ? pendingFor(app, e.id, day, now) : [] };
  });
}

/** Team leads see their people; executives and administrators see everyone. */
export function canWatch(app: App, viewer: Employee): boolean { return !!viewer.is_admin || viewer.functional_role === 'executive' || scopeFor(app.db, viewer).level !== 'self'; }
export function watchable(app: App, viewer: Employee, departmentId = ''): { id: string; full_name: string; designation: string; team: string; department_id: string }[] {
  const scope = scopeFor(app.db, viewer); const everyone = !!viewer.is_admin || viewer.functional_role === 'executive' || scope.level === 'company';
  return app.db.all<{ id: string; full_name: string; designation: string; team: string; department_id: string; functional_role: string }>(`SELECT e.id, e.full_name, e.designation, d.name AS team, e.department_id, e.functional_role FROM employees e JOIN departments d ON d.id = e.department_id WHERE e.status = 'active' ORDER BY d.name, e.full_name`)
    .filter((e) => (everyone || scope.people.has(e.id)) && e.id !== viewer.id && e.functional_role !== 'executive' && (!departmentId || e.department_id === departmentId));
}

/** Who a person may hand a task to: their own team, and for managers everyone who reports to them. */
export function colleagues(app: App, actor: Employee): { id: string; full_name: string; designation: string }[] {
  const scope = scopeFor(app.db, actor);
  return app.db.all<{ id: string; full_name: string; designation: string; department_id: string }>("SELECT id, full_name, designation, department_id FROM employees WHERE status = 'active' ORDER BY full_name")
    .filter((e) => e.id !== actor.id && (e.department_id === actor.department_id || scope.people.has(e.id)));
}
/** Hand a task of your own to a colleague. The person who gave it to you is told. */
export function passTask(app: App, actor: Employee, id: string, toId: string, note: unknown): { title: string; to: string } {
  const t = app.db.get<{ title: string; assignee_id: string | null; status: string; kind: string; created_by: string | null; details: string }>('SELECT title, assignee_id, status, kind, created_by, details FROM tasks WHERE id = ?', [id]);
  if (!t || t.kind !== 'task') throw new HttpError(404, 'Task not found.');
  if (t.assignee_id !== actor.id) throw new HttpError(403, 'You can pass on only a task that is assigned to you.');
  if (!['open', 'in_progress'].includes(t.status)) throw new HttpError(400, 'This task is already finished.');
  const to = colleagues(app, actor).find((e) => e.id === toId);
  if (!to) throw new HttpError(400, 'Choose someone in your team.');
  const why = String(note || '').trim().slice(0, 300); const now = new Date();
  app.db.transaction(() => {
    stopItem(app, 'task', id, now);
    const line = `Passed on by ${actor.full_name} on ${localDateString(now)}${why ? `: ${why}` : ''}`;
    app.db.run("UPDATE tasks SET assignee_id = ?, status = 'open', details = ?, updated_at = ? WHERE id = ?", [to.id, t.details ? `${t.details}\n${line}` : line, now.toISOString(), id]);
    audit(app.db, { entity: 'task', entityId: id, action: 'pass', actorId: actor.id, before: { assignee: actor.id }, after: { assignee: to.id, note: why } });
  });
  app.notify.send({ employeeId: to.id, title: `Task from ${actor.full_name}: ${t.title}`, body: why || 'Passed on to you.', link: '/tasks', kind: 'info' });
  if (t.created_by && t.created_by !== actor.id && t.created_by !== to.id) app.notify.send({ employeeId: t.created_by, title: `${actor.full_name} passed "${t.title}" to ${to.full_name}`, body: why, link: '/tasks/team', kind: 'info' });
  return { title: t.title, to: to.full_name };
}
