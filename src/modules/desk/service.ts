import { label as listLabel } from '../../lib/lists.ts';
import type { App } from '../../app.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { getSetting, holidaySet, shiftByCode, type SlaRule } from '../../lib/settings.ts';
import { addBusinessMinutes, businessMinutesBetween, localDateString, minutesUntil } from '../../lib/time.ts';
import { randomToken } from '../../lib/crypto.ts';
import { getEmployee, type Employee } from '../people/model.ts';

export type TicketStatus = 'new' | 'assigned' | 'in_progress' | 'waiting_customer' | 'waiting_dev' | 'resolved' | 'closed';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
export const OPEN_STATUSES: TicketStatus[] = ['new', 'assigned', 'in_progress', 'waiting_customer', 'waiting_dev'];
export const TICKET_TYPES = ['support', 'implementation', 'internal', 'design_request'] as const;

export interface Ticket {
  id: string; customer_id: string | null; subject: string; description: string; type: string; category: string; priority: Priority; status: TicketStatus;
  assignee_id: string | null; created_by: string | null; channel: string; created_at: string; first_response_at: string | null; response_due_at: string | null;
  resolve_due_at: string | null; resolved_at: string | null; closed_at: string | null; within_sla: number | null; dev_issue_id: string | null; rating: number | null;
  rating_token: string | null; reopen_count: number; impl_plan_days: number | null; impl_stage: string | null; escalation_level: number; updated_at: string;
}
export interface TicketView extends Ticket { customer_name: string; assignee_name: string | null; assignee_initials: string | null; dev_status: string | null }
export interface TicketEvent { id: number; ticket_id: string; kind: string; text: string; actor_id: string | null; at: string; meta: string | null; actor_name: string | null }

export interface SlaState { minutesLeft: number | null; pctElapsed: number; state: 'ok' | 'warn' | 'breach' | 'met' | 'missed' | 'none'; label: string }

const SELECT = `SELECT t.*, COALESCE(c.name, CASE WHEN t.type = 'internal' THEN 'Internal' ELSE '' END) AS customer_name, e.full_name AS assignee_name, d.status AS dev_status
  FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN employees e ON e.id = t.assignee_id LEFT JOIN dev_issues d ON d.id = t.dev_issue_id`;

function withInitials(t: TicketView): TicketView {
  t.assignee_initials = t.assignee_name ? t.assignee_name.split(/\s+/).map((p) => p[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase() : null;
  return t;
}

export function getTicket(app: App, id: string): TicketView | undefined {
  const t = app.db.get<TicketView>(`${SELECT} WHERE t.id = ?`, [id]);
  return t ? withInitials(t) : undefined;
}

export function requireTicket(app: App, id: string): TicketView {
  const t = getTicket(app, id);
  if (!t) throw new HttpError(404, `Ticket ${id} not found`);
  return t;
}

export interface TicketFilter { status?: TicketStatus[] | 'open'; assigneeId?: string; assigneeIds?: string[]; customerId?: string; type?: string; q?: string; limit?: number; resolvedSince?: string }

export function listTickets(app: App, f: TicketFilter = {}): TicketView[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.status === 'open') { where.push(`t.status IN (${OPEN_STATUSES.map(() => '?').join(',')})`); params.push(...OPEN_STATUSES); }
  else if (f.status && f.status.length) { where.push(`t.status IN (${f.status.map(() => '?').join(',')})`); params.push(...f.status); }
  if (f.assigneeId) { where.push('t.assignee_id = ?'); params.push(f.assigneeId); }
  if (f.assigneeIds && f.assigneeIds.length) { where.push(`t.assignee_id IN (${f.assigneeIds.map(() => '?').join(',')})`); params.push(...f.assigneeIds); }
  if (f.customerId) { where.push('t.customer_id = ?'); params.push(f.customerId); }
  if (f.type) { where.push('t.type = ?'); params.push(f.type); }
  if (f.resolvedSince) { where.push('t.resolved_at >= ?'); params.push(f.resolvedSince); }
  if (f.q) { where.push('(t.subject LIKE ? OR t.id LIKE ? OR c.name LIKE ?)'); const like = `%${f.q}%`; params.push(like, like, like); }
  const sql = `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN t.resolve_due_at IS NULL THEN 1 ELSE 0 END, t.resolve_due_at ASC, t.created_at DESC LIMIT ?`;
  params.push(f.limit || 500);
  return app.db.all<TicketView>(sql, params).map(withInitials);
}

export function ticketEvents(app: App, id: string): TicketEvent[] {
  return app.db.all<TicketEvent>('SELECT ev.*, e.full_name AS actor_name FROM ticket_events ev LEFT JOIN employees e ON e.id = ev.actor_id WHERE ev.ticket_id = ? ORDER BY ev.id ASC', [id]);
}

function addEvent(app: App, ticketId: string, kind: string, text: string, actorId: string | null, meta?: unknown): void {
  app.db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at, meta) VALUES (?, ?, ?, ?, ?, ?)', [ticketId, kind, text, actorId, new Date().toISOString(), meta === undefined ? null : JSON.stringify(meta)]);
}

/** Due timestamps for a priority, from a start time, on the support calendar (P1 runs around the clock). */
export function dueDates(app: App, priority: Priority, from: Date, shiftCode = 'SUP'): { responseDue: Date; resolveDue: Date; rule: SlaRule } {
  const rule = getSetting(app.db, 'sla')[priority];
  if (rule.calendar === 'always') {
    return { responseDue: new Date(from.getTime() + rule.response * 60_000), resolveDue: new Date(from.getTime() + rule.resolve * 60_000), rule };
  }
  const shift = shiftByCode(app.db, shiftCode); const holidays = holidaySet(app.db);
  return { responseDue: addBusinessMinutes(from, rule.response, shift, holidays), resolveDue: addBusinessMinutes(from, rule.resolve, shift, holidays), rule };
}

export function slaState(t: Pick<Ticket, 'status' | 'resolve_due_at' | 'resolved_at' | 'within_sla' | 'created_at'>, now = new Date()): SlaState {
  if (t.status === 'resolved' || t.status === 'closed') {
    if (t.within_sla === 1) return { minutesLeft: 0, pctElapsed: 100, state: 'met', label: 'within SLA' };
    if (t.within_sla === 0) return { minutesLeft: 0, pctElapsed: 100, state: 'missed', label: 'outside SLA' };
    return { minutesLeft: null, pctElapsed: 0, state: 'none', label: 'resolved' };
  }
  if (!t.resolve_due_at) return { minutesLeft: null, pctElapsed: 0, state: 'none', label: 'no SLA' };
  const left = minutesUntil(t.resolve_due_at, now) ?? 0;
  const total = Math.max(1, (new Date(t.resolve_due_at).getTime() - new Date(t.created_at).getTime()) / 60_000);
  const pct = Math.min(100, Math.max(0, Math.round(100 - (left / total) * 100)));
  if (left < 0) return { minutesLeft: left, pctElapsed: 100, state: 'breach', label: 'breached' };
  if (pct >= 50 || left <= 60) return { minutesLeft: left, pctElapsed: pct, state: 'warn', label: 'at risk' };
  return { minutesLeft: left, pctElapsed: pct, state: 'ok', label: 'on track' };
}

export interface NewTicket { customerId?: string | null; subject: string; description?: string; type?: string; category?: string; priority?: Priority; channel?: string; assigneeId?: string | null; implPlanDays?: number | null }

export function createTicket(app: App, actor: Employee | null, input: NewTicket): TicketView {
  const { db } = app;
  if (!input.subject || input.subject.trim().length < 3) throw new HttpError(400, 'Give the ticket a subject.');
  const priority: Priority = PRIORITIES.includes(input.priority as Priority) ? (input.priority as Priority) : 'P3';
  const type = (TICKET_TYPES as readonly string[]).includes(input.type || '') ? input.type! : 'support';
  const created = new Date();
  const due = dueDates(app, priority, created);
  const planDays = type === 'implementation' ? (input.implPlanDays || 21) : null;
  const responseDue = due.responseDue;
  const resolveDue = planDays ? new Date(created.getTime() + planDays * 86_400_000) : due.resolveDue;
  const id = db.nextId('T');
  const assignee = input.assigneeId || null;
  db.transaction(() => {
    db.run(`INSERT INTO tickets (id, customer_id, subject, description, type, category, priority, status, assignee_id, created_by, channel, created_at, response_due_at, resolve_due_at, impl_plan_days, impl_stage, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, input.customerId || null, input.subject.trim(), input.description || '', type, input.category || '', priority, assignee ? 'assigned' : 'new', assignee, actor?.id || null,
        input.channel || 'phone', created.toISOString(), responseDue.toISOString(), resolveDue.toISOString(), type === 'implementation' ? (input.implPlanDays || 21) : null, type === 'implementation' ? 'setup' : null, created.toISOString()]);
    addEvent(app, id, 'created', `Ticket raised by ${listLabel('desk.channels', input.channel || 'phone').toLowerCase()}`, actor?.id || null);
    if (assignee) addEvent(app, id, 'assigned', `Assigned to ${getEmployee(db, assignee)?.full_name || assignee}`, actor?.id || null);
    audit(db, { entity: 'ticket', entityId: id, action: 'create', actorId: actor?.id, after: { priority, type, assignee } });
  });
  if (assignee && assignee !== actor?.id) app.notify.send({ employeeId: assignee, title: `${id} assigned to you`, body: input.subject, link: `/desk/${id}`, kind: priority === 'P1' ? 'critical' : 'info' });
  return getTicket(app, id)!;
}

export function assignTicket(app: App, actor: Employee, id: string, assigneeId: string | null): TicketView {
  const t = requireTicket(app, id);
  const who = assigneeId ? getEmployee(app.db, assigneeId) : null;
  if (assigneeId && !who) throw new HttpError(400, 'Unknown assignee');
  app.db.transaction(() => {
    const status: TicketStatus = t.status === 'new' && assigneeId ? 'assigned' : t.status;
    app.db.run('UPDATE tickets SET assignee_id = ?, status = ?, updated_at = ? WHERE id = ?', [assigneeId, status, new Date().toISOString(), id]);
    addEvent(app, id, 'assigned', who ? `Assigned to ${who.full_name}` : 'Unassigned', actor.id);
    audit(app.db, { entity: 'ticket', entityId: id, action: 'assign', actorId: actor.id, before: { assignee: t.assignee_id }, after: { assignee: assigneeId } });
  });
  if (who && who.id !== actor.id) app.notify.send({ employeeId: who.id, title: `${id} assigned to you`, body: t.subject, link: `/desk/${id}` });
  return getTicket(app, id)!;
}

export function setPriority(app: App, actor: Employee, id: string, priority: Priority): TicketView {
  if (!PRIORITIES.includes(priority)) throw new HttpError(400, 'Unknown priority');
  const t = requireTicket(app, id);
  if (t.priority === priority) return t;
  const { responseDue, resolveDue } = dueDates(app, priority, new Date(t.created_at));
  app.db.transaction(() => {
    app.db.run('UPDATE tickets SET priority = ?, response_due_at = ?, resolve_due_at = ?, escalation_level = 0, updated_at = ? WHERE id = ?', [priority, responseDue.toISOString(), resolveDue.toISOString(), new Date().toISOString(), id]);
    addEvent(app, id, 'priority', `Priority changed ${t.priority} → ${priority}; clock recalculated`, actor.id);
    audit(app.db, { entity: 'ticket', entityId: id, action: 'priority', actorId: actor.id, before: { priority: t.priority }, after: { priority } });
  });
  return getTicket(app, id)!;
}

export function setStatus(app: App, actor: Employee, id: string, status: TicketStatus, note = ''): TicketView {
  const t = requireTicket(app, id);
  const allowed: TicketStatus[] = ['new', 'assigned', 'in_progress', 'waiting_customer', 'waiting_dev', 'resolved', 'closed'];
  if (!allowed.includes(status)) throw new HttpError(400, 'Unknown status');
  if (status === 'resolved') return resolveTicket(app, actor, id, note);
  if (t.status === 'closed' && status !== 'closed') return reopenTicket(app, actor, id, note || 'Reopened');
  app.db.transaction(() => {
    app.db.run('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', [status, new Date().toISOString(), id]);
    addEvent(app, id, 'status', `${labelStatus(t.status)} → ${labelStatus(status)}${note ? ': ' + note : ''}`, actor.id);
    audit(app.db, { entity: 'ticket', entityId: id, action: 'status', actorId: actor.id, before: { status: t.status }, after: { status } });
  });
  return getTicket(app, id)!;
}

export function labelStatus(s: string): string {
  return ({ new: 'New', assigned: 'Assigned', in_progress: 'In progress', waiting_customer: 'Waiting on customer', waiting_dev: 'Waiting on development', resolved: 'Resolved', closed: 'Closed' } as Record<string, string>)[s] || s;
}

export function replyToCustomer(app: App, actor: Employee, id: string, text: string, channel: 'email' | 'call' | 'note' = 'email'): TicketView {
  const t = requireTicket(app, id);
  if (!text || !text.trim()) throw new HttpError(400, 'Write something first.');
  const nowIso = new Date().toISOString();
  app.db.transaction(() => {
    const first = t.first_response_at ? null : nowIso;
    app.db.run('UPDATE tickets SET first_response_at = COALESCE(first_response_at, ?), status = CASE WHEN status IN (\'new\',\'assigned\') THEN \'in_progress\' ELSE status END, updated_at = ? WHERE id = ?', [first, nowIso, id]);
    addEvent(app, id, channel === 'note' ? 'note' : channel === 'call' ? 'call' : 'reply', text.trim(), actor.id);
  });
  if (channel === 'email' && t.customer_id) {
    const cust = app.db.get<{ email: string; name: string }>('SELECT email, name FROM customers WHERE id = ?', [t.customer_id]);
    if (cust?.email) void app.mailer.send({ to: cust.email, subject: `[${id}] ${t.subject}`, text: `${text.trim()}\n\n${actor.full_name}\nLoyal String support` });
  }
  return getTicket(app, id)!;
}

export function escalateToDev(app: App, actor: Employee, id: string, title?: string): { ticket: TicketView; issueId: string } {
  const t = requireTicket(app, id);
  if (t.dev_issue_id) throw new HttpError(400, `${id} is already linked to ${t.dev_issue_id}`);
  const issueId = app.db.nextId('D');
  const nowIso = new Date().toISOString();
  const devHod = app.db.get<{ hod_id: string }>("SELECT hod_id FROM departments WHERE id = 'DEV'")?.hod_id || null;
  app.db.transaction(() => {
    app.db.run('INSERT INTO dev_issues (id, title, description, status, priority, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [issueId, title || t.subject, `Escalated from ${id} (${t.customer_name}).\n\n${t.description}`, 'backlog', t.priority, actor.id, nowIso, nowIso]);
    app.db.run("UPDATE tickets SET dev_issue_id = ?, status = 'waiting_dev', updated_at = ? WHERE id = ?", [issueId, nowIso, id]);
    addEvent(app, id, 'escalated', `Escalated to development as ${issueId}; customer status follows the issue`, actor.id, { issueId });
    audit(app.db, { entity: 'ticket', entityId: id, action: 'escalate', actorId: actor.id, after: { issueId } });
  });
  if (devHod) app.notify.send({ employeeId: devHod, title: `${issueId} escalated from ${id}`, body: t.subject, link: `/desk/dev#${issueId}`, kind: t.priority === 'P1' ? 'critical' : 'warn' });
  return { ticket: getTicket(app, id)!, issueId };
}

export function resolveTicket(app: App, actor: Employee, id: string, note = ''): TicketView {
  const t = requireTicket(app, id);
  if (t.status === 'resolved' || t.status === 'closed') return t;
  const resolvedAt = new Date();
  const within = t.resolve_due_at ? (resolvedAt <= new Date(t.resolve_due_at) ? 1 : 0) : null;
  const token = randomToken(16);
  app.db.transaction(() => {
    app.db.run("UPDATE tickets SET status = 'resolved', resolved_at = ?, within_sla = ?, rating_token = ?, updated_at = ? WHERE id = ?", [resolvedAt.toISOString(), within, token, resolvedAt.toISOString(), id]);
    addEvent(app, id, 'resolved', `Resolved${within === 0 ? ' outside SLA' : within === 1 ? ' within SLA' : ''}${note ? ': ' + note : ''}`, actor.id, { within });
    audit(app.db, { entity: 'ticket', entityId: id, action: 'resolve', actorId: actor.id, after: { within } });
  });
  if (t.customer_id) {
    const cust = app.db.get<{ email: string }>('SELECT email FROM customers WHERE id = ?', [t.customer_id]);
    if (cust?.email) void app.mailer.send({ to: cust.email, subject: `[${id}] Resolved: ${t.subject}`, text: `Your ticket ${id} has been resolved.${note ? '\n\n' + note : ''}\n\nHow did we do? Rate it in one click:\n${app.cfg.baseUrl}/rate/${token}?r=5 (great)   ${app.cfg.baseUrl}/rate/${token}?r=3 (ok)   ${app.cfg.baseUrl}/rate/${token}?r=1 (poor)\n\nLoyal String support` });
  }
  return getTicket(app, id)!;
}

export function reopenTicket(app: App, actor: Employee, id: string, reason: string): TicketView {
  const t = requireTicket(app, id);
  const { responseDue, resolveDue } = dueDates(app, t.priority, new Date());
  app.db.transaction(() => {
    app.db.run("UPDATE tickets SET status = 'in_progress', resolved_at = NULL, closed_at = NULL, within_sla = NULL, reopen_count = reopen_count + 1, response_due_at = ?, resolve_due_at = ?, escalation_level = 0, updated_at = ? WHERE id = ?",
      [responseDue.toISOString(), resolveDue.toISOString(), new Date().toISOString(), id]);
    addEvent(app, id, 'reopened', `Reopened: ${reason}`, actor.id);
    audit(app.db, { entity: 'ticket', entityId: id, action: 'reopen', actorId: actor.id });
  });
  return getTicket(app, id)!;
}

export function rateTicket(app: App, token: string, rating: number): TicketView | null {
  const t = app.db.get<Ticket>('SELECT * FROM tickets WHERE rating_token = ?', [token]);
  if (!t) return null;
  const r = Math.min(5, Math.max(1, Math.round(rating)));
  app.db.run('UPDATE tickets SET rating = ?, updated_at = ? WHERE id = ?', [r, new Date().toISOString(), t.id]);
  addEvent(app, t.id, 'rated', `Customer rated ${r} of 5`, null);
  return getTicket(app, t.id)!;
}

/** Scheduler: warn at the configured percentage of the clock, escalate on breach, auto-close resolved tickets after 3 days. */
export function runSlaChecks(app: App, now = new Date()): { warned: number; breached: number; closed: number } {
  const { db } = app;
  const warnPct = getSetting(db, 'escalation').slaWarnPct;
  const company = getSetting(db, 'company');
  let warned = 0, breached = 0, closed = 0;
  const open = db.all<TicketView>(`${SELECT} WHERE t.status IN ('new','assigned','in_progress','waiting_customer','waiting_dev') AND t.resolve_due_at IS NOT NULL AND t.type != 'implementation'`);
  for (const t of open) {
    const s = slaState(t, now);
    const lead = t.assignee_id ? getEmployee(db, t.assignee_id)?.reporting_manager_id : db.get<{ hod_id: string }>("SELECT hod_id FROM departments WHERE id = 'SUP'")?.hod_id;
    if (s.state === 'breach' && t.escalation_level < 2) {
      db.run('UPDATE tickets SET escalation_level = 2, updated_at = ? WHERE id = ?', [now.toISOString(), t.id]);
      addEvent(app, t.id, 'breach', 'Resolution SLA breached; escalated to the COO', null);
      app.notify.sendMany([company.cooId, lead || '', t.assignee_id || ''].filter(Boolean), { title: `${t.id} breached its SLA`, body: `${t.customer_name}: ${t.subject}`, link: `/desk/${t.id}`, kind: 'critical' });
      breached++;
    } else if (s.state === 'warn' && s.pctElapsed >= warnPct && t.escalation_level < 1) {
      db.run('UPDATE tickets SET escalation_level = 1, updated_at = ? WHERE id = ?', [now.toISOString(), t.id]);
      addEvent(app, t.id, 'warning', `${s.pctElapsed}% of the resolution clock used; team lead notified`, null);
      app.notify.sendMany([lead || '', t.assignee_id || ''].filter(Boolean), { title: `${t.id} is at risk`, body: `${s.label}: ${t.subject}`, link: `/desk/${t.id}`, kind: 'warn' });
      warned++;
    }
  }
  const cutoff = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const stale = db.all<{ id: string }>("SELECT id FROM tickets WHERE status = 'resolved' AND resolved_at < ?", [cutoff]);
  for (const r of stale) {
    db.run("UPDATE tickets SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?", [now.toISOString(), now.toISOString(), r.id]);
    addEvent(app, r.id, 'closed', 'Closed automatically three days after resolution', null);
    closed++;
  }
  return { warned, breached, closed };
}

/** Business minutes from creation to first response, for the first-response KPI. */
export function firstResponseMinutes(app: App, t: Ticket): number | null {
  if (!t.first_response_at) return null;
  const shift = shiftByCode(app.db, 'SUP');
  return businessMinutesBetween(new Date(t.created_at), new Date(t.first_response_at), shift, holidaySet(app.db));
}

export function todayKey(now = new Date()): string { return localDateString(now); }

// Development issues ------------------------------------------------------------------------------

export type DevStatus = 'backlog' | 'planned' | 'in_progress' | 'in_review' | 'in_qa' | 'ready' | 'released';
export const DEV_STATUSES: DevStatus[] = ['backlog', 'planned', 'in_progress', 'in_review', 'in_qa', 'ready', 'released'];
export type IssueType = 'feature' | 'bug' | 'change' | 'tech_debt' | 'support';
export const ISSUE_TYPES: IssueType[] = ['feature', 'bug', 'change', 'tech_debt', 'support'];
export interface DevIssue {
  id: string; title: string; description: string; status: DevStatus; priority: Priority; sprint: string; assignee_id: string | null; created_by: string | null; created_at: string; released_at: string | null; updated_at: string;
  project_id: string | null; sprint_id: string | null; release_id: string | null; type: IssueType; points: number | null; estimate_hours: number | null; component: string; acceptance: string; blocked: number; blocked_reason: string;
  started_at: string | null; qa_at: string | null; reporter_id: string | null; customer_id: string | null; reopen_count: number; due_date: string | null;
  assignee_name?: string | null; linked_tickets?: number; project_name?: string | null; sprint_name?: string | null; customer_name?: string | null; checks_total?: number; checks_done?: number; minutes?: number;
}
export const ISSUE_SELECT = `SELECT d.*, e.full_name AS assignee_name, p.name AS project_name, s.name AS sprint_name, c.name AS customer_name,
  (SELECT count(*) FROM tickets t WHERE t.dev_issue_id = d.id) AS linked_tickets,
  (SELECT count(*) FROM issue_checks k WHERE k.issue_id = d.id AND k.kind = 'subtask') AS checks_total,
  (SELECT count(*) FROM issue_checks k WHERE k.issue_id = d.id AND k.kind = 'subtask' AND k.done = 1) AS checks_done,
  (SELECT COALESCE(SUM(minutes),0) FROM time_logs tl WHERE tl.entity_type = 'issue' AND tl.entity_id = d.id AND tl.ended_at IS NOT NULL) AS minutes
  FROM dev_issues d LEFT JOIN employees e ON e.id = d.assignee_id LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN sprints s ON s.id = d.sprint_id LEFT JOIN customers c ON c.id = d.customer_id`;

export function listDevIssues(app: App, opts: { includeReleased?: boolean; projectId?: string; sprintId?: string | null; assigneeId?: string; releaseId?: string; type?: string; q?: string } = {}): DevIssue[] {
  const where: string[] = []; const params: string[] = [];
  if (!opts.includeReleased) where.push("(d.status != 'released' OR d.released_at >= date('now', '-14 days'))");
  if (opts.projectId) { where.push('d.project_id = ?'); params.push(opts.projectId); }
  if (opts.sprintId) { where.push('d.sprint_id = ?'); params.push(opts.sprintId); }
  if (opts.sprintId === null) where.push('d.sprint_id IS NULL');
  if (opts.assigneeId) { where.push('d.assignee_id = ?'); params.push(opts.assigneeId); }
  if (opts.releaseId) { where.push('d.release_id = ?'); params.push(opts.releaseId); }
  if (opts.type) { where.push('d.type = ?'); params.push(opts.type); }
  if (opts.q) { where.push('(d.title LIKE ? OR d.id LIKE ?)'); params.push(`%${opts.q}%`, `%${opts.q}%`); }
  return app.db.all<DevIssue>(`${ISSUE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.blocked DESC, CASE d.priority WHEN 'P1' THEN 0 WHEN 'P2' THEN 1 WHEN 'P3' THEN 2 ELSE 3 END, d.created_at`, params);
}
export function getDevIssue(app: App, id: string): DevIssue | undefined { return app.db.get<DevIssue>(`${ISSUE_SELECT} WHERE d.id = ?`, [id]); }

export function createDevIssue(app: App, actor: Employee, input: { title: string; description?: string; priority?: Priority; sprint?: string; assigneeId?: string | null; type?: string; projectId?: string | null; sprintId?: string | null; points?: number | null; estimateHours?: number | null; component?: string; acceptance?: string; customerId?: string | null; dueDate?: string | null }): DevIssue {
  if (!input.title || input.title.trim().length < 3) throw new HttpError(400, 'Give the issue a title.');
  const id = app.db.nextId('D'); const nowIso = new Date().toISOString();
  const type = ISSUE_TYPES.includes(input.type as IssueType) ? input.type! : 'feature';
  app.db.run('INSERT INTO dev_issues (id, title, description, status, priority, sprint, assignee_id, created_by, created_at, updated_at, type, project_id, sprint_id, points, estimate_hours, component, acceptance, reporter_id, customer_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.title.trim(), input.description || '', input.sprintId ? 'planned' : 'backlog', PRIORITIES.includes(input.priority as Priority) ? input.priority! : 'P3', input.sprint || '', input.assigneeId || null, actor.id, nowIso, nowIso, type, input.projectId || null, input.sprintId || null, input.points ?? null, input.estimateHours ?? null, input.component || '', input.acceptance || '', actor.id, input.customerId || null, input.dueDate || null]);
  audit(app.db, { entity: 'dev_issue', entityId: id, action: 'create', actorId: actor.id, after: { type, project: input.projectId } });
  if (input.assigneeId && input.assigneeId !== actor.id) app.notify.send({ employeeId: input.assigneeId, title: `${id} assigned to you`, body: input.title.trim(), link: `/dev/${id}`, kind: 'info' });
  return getDevIssue(app, id)!;
}

export function setDevStatus(app: App, actor: Employee, id: string, status: DevStatus, opts: { sprint?: string; assigneeId?: string | null } = {}): DevIssue {
  if (!DEV_STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  const issue = app.db.get<DevIssue>('SELECT * FROM dev_issues WHERE id = ?', [id]);
  if (!issue) throw new HttpError(404, 'Issue not found');
  const nowIso = new Date().toISOString();
  const order = DEV_STATUSES.indexOf(status), prev = DEV_STATUSES.indexOf(issue.status);
  const reopened = (issue.status === 'released' || issue.status === 'ready' || issue.status === 'in_qa') && order < prev && status !== 'in_qa';
  app.db.transaction(() => {
    app.db.run('UPDATE dev_issues SET status = ?, sprint = COALESCE(?, sprint), assignee_id = COALESCE(?, assignee_id), released_at = CASE WHEN ? = \'released\' THEN ? ELSE released_at END, started_at = CASE WHEN started_at IS NULL AND ? IN (\'in_progress\',\'in_review\',\'in_qa\',\'ready\',\'released\') THEN ? ELSE started_at END, qa_at = CASE WHEN ? = \'in_qa\' THEN ? ELSE qa_at END, reopen_count = reopen_count + ?, blocked = CASE WHEN ? = \'released\' THEN 0 ELSE blocked END, updated_at = ? WHERE id = ?',
      [status, opts.sprint ?? null, opts.assigneeId ?? null, status, nowIso, status, nowIso, status, nowIso, reopened ? 1 : 0, status, nowIso, id]);
    app.db.run('INSERT INTO issue_comments (issue_id, author_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [id, actor.id, 'status', `${issue.status.replace('_', ' ')} → ${status.replace('_', ' ')}${reopened ? ' (reopened)' : ''}`, nowIso]);
    audit(app.db, { entity: 'dev_issue', entityId: id, action: 'status', actorId: actor.id, before: { status: issue.status }, after: { status } });
    const linked = app.db.all<TicketView>(`${SELECT} WHERE t.dev_issue_id = ?`, [id]);
    for (const t of linked) {
      addEvent(app, t.id, 'dev', `${id} moved to ${status.replace('_', ' ')}`, actor.id);
      if (status === 'released' && t.status === 'waiting_dev') {
        app.db.run("UPDATE tickets SET status = 'in_progress', updated_at = ? WHERE id = ?", [nowIso, t.id]);
        if (t.assignee_id) app.notify.send({ employeeId: t.assignee_id, title: `${id} released: ${t.id} can be resolved`, body: t.subject, link: `/desk/${t.id}`, kind: 'success' });
      }
    }
  });
  return getDevIssue(app, id)!;
}
