// Development project management: projects, one-week sprints, releases with QA sign-off, comments, sub-tasks, QA tests, metrics.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { getSetting } from '../../lib/settings.ts';
import { addDays, localDateString, weekStart, isoWeek } from '../../lib/time.ts';
import { getDepartment, type Employee } from '../people/model.ts';
import { getDevIssue, listDevIssues, setDevStatus, DEV_STATUSES, type DevIssue, type DevStatus } from '../desk/service.ts';

export interface Project { id: string; name: string; description: string; kind: string; status: string; owner_id: string | null; customer_id: string | null; start_date: string | null; target_date: string | null; notes: string; created_by: string | null; created_at: string; updated_at: string; owner_name?: string | null; customer_name?: string | null; total?: number; done?: number; points_total?: number; points_done?: number; open_bugs?: number; blocked?: number }
export interface Sprint { id: string; name: string; start_date: string; end_date: string; goal: string; status: string; committed_points: number; committed_count: number; created_at: string; closed_at: string | null; total?: number; done?: number; points_total?: number; points_done?: number }
export interface Release { id: string; version: string; name: string; project_id: string | null; planned_date: string | null; released_at: string | null; notes: string; qa_signed_by: string | null; qa_signed_at: string | null; hod_approved_by: string | null; hod_approved_at: string | null; status: string; created_by: string | null; created_at: string; project_name?: string | null; qa_name?: string | null; hod_name?: string | null; issues?: number }
export interface Comment { id: number; issue_id: string; author_id: string | null; kind: string; text: string; created_at: string; author_name?: string | null }
export interface Check { id: number; issue_id: string; kind: 'subtask' | 'test'; title: string; done: number; result: string | null; done_by: string | null; done_at: string | null; position: number; done_by_name?: string | null }

const PSEL = `SELECT p.*, e.full_name AS owner_name, c.name AS customer_name,
  (SELECT count(*) FROM dev_issues i WHERE i.project_id = p.id) AS total,
  (SELECT count(*) FROM dev_issues i WHERE i.project_id = p.id AND i.status = 'released') AS done,
  (SELECT COALESCE(SUM(points),0) FROM dev_issues i WHERE i.project_id = p.id) AS points_total,
  (SELECT COALESCE(SUM(points),0) FROM dev_issues i WHERE i.project_id = p.id AND i.status = 'released') AS points_done,
  (SELECT count(*) FROM dev_issues i WHERE i.project_id = p.id AND i.type = 'bug' AND i.status != 'released') AS open_bugs,
  (SELECT count(*) FROM dev_issues i WHERE i.project_id = p.id AND i.blocked = 1 AND i.status != 'released') AS blocked
  FROM projects p LEFT JOIN employees e ON e.id = p.owner_id LEFT JOIN customers c ON c.id = p.customer_id`;

export function listProjects(app: App, opts: { all?: boolean } = {}): Project[] { return app.db.all<Project>(`${PSEL} ${opts.all ? '' : "WHERE p.status = 'active'"} ORDER BY p.target_date IS NULL, p.target_date, p.name`); }
export function getProject(app: App, id: string): Project | undefined { return app.db.get<Project>(`${PSEL} WHERE p.id = ?`, [id]); }

export function saveProject(app: App, actor: Employee, input: { id?: string; name: string; description?: string; kind?: string; status?: string; ownerId?: string | null; customerId?: string | null; startDate?: string | null; targetDate?: string | null; notes?: string }): Project {
  if (!input.name || input.name.trim().length < 2) throw new HttpError(400, 'Give the project a name.');
  const nowIso = new Date().toISOString();
  const kind = ['product', 'customer', 'internal'].includes(input.kind || '') ? input.kind! : 'product';
  const status = ['active', 'on_hold', 'done', 'cancelled'].includes(input.status || '') ? input.status! : 'active';
  if (input.id) {
    app.db.run('UPDATE projects SET name = ?, description = ?, kind = ?, status = ?, owner_id = ?, customer_id = ?, start_date = ?, target_date = ?, notes = ?, updated_at = ? WHERE id = ?',
      [input.name.trim(), input.description || '', kind, status, input.ownerId || null, input.customerId || null, input.startDate || null, input.targetDate || null, input.notes || '', nowIso, input.id]);
    audit(app.db, { entity: 'project', entityId: input.id, action: 'update', actorId: actor.id, after: input });
    return getProject(app, input.id)!;
  }
  const id = app.db.nextId('PJ', 100);
  app.db.run('INSERT INTO projects (id, name, description, kind, status, owner_id, customer_id, start_date, target_date, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.name.trim(), input.description || '', kind, status, input.ownerId || actor.id, input.customerId || null, input.startDate || localDateString(new Date()), input.targetDate || null, input.notes || '', actor.id, nowIso, nowIso]);
  audit(app.db, { entity: 'project', entityId: id, action: 'create', actorId: actor.id });
  return getProject(app, id)!;
}

export function projectHealth(p: Project, now = new Date()): { state: 'on_track' | 'at_risk' | 'late' | 'done' | 'no_date'; label: string } {
  if (p.status === 'done') return { state: 'done', label: 'Done' };
  if (!p.target_date) return { state: 'no_date', label: 'No target date' };
  const today = localDateString(now);
  const pct = p.total ? (p.done || 0) / p.total : 0;
  if (p.target_date < today && pct < 1) return { state: 'late', label: 'Late' };
  const start = p.start_date || p.created_at.slice(0, 10);
  const span = Math.max(1, (new Date(p.target_date).getTime() - new Date(start).getTime()) / 86_400_000);
  const elapsed = Math.max(0, (now.getTime() - new Date(start).getTime()) / 86_400_000) / span;
  if (elapsed > 0.5 && pct < elapsed - 0.25) return { state: 'at_risk', label: 'At risk' };
  return { state: 'on_track', label: 'On track' };
}

// ---------- Sprints ----------
const SSEL = `SELECT s.*, (SELECT count(*) FROM dev_issues i WHERE i.sprint_id = s.id) AS total, (SELECT count(*) FROM dev_issues i WHERE i.sprint_id = s.id AND i.status IN ('ready','released')) AS done,
  (SELECT COALESCE(SUM(points),0) FROM dev_issues i WHERE i.sprint_id = s.id) AS points_total, (SELECT COALESCE(SUM(points),0) FROM dev_issues i WHERE i.sprint_id = s.id AND i.status IN ('ready','released')) AS points_done FROM sprints s`;
export function listSprints(app: App, limit = 20): Sprint[] { return app.db.all<Sprint>(`${SSEL} ORDER BY s.start_date DESC LIMIT ?`, [limit]); }
export function getSprint(app: App, id: string): Sprint | undefined { return app.db.get<Sprint>(`${SSEL} WHERE s.id = ?`, [id]); }
export function currentSprint(app: App, now = new Date()): Sprint | undefined {
  const today = localDateString(now);
  return app.db.get<Sprint>(`${SSEL} WHERE s.start_date <= ? AND s.end_date >= ? ORDER BY s.start_date DESC LIMIT 1`, [today, today]) || app.db.get<Sprint>(`${SSEL} WHERE s.status = 'active' ORDER BY s.start_date DESC LIMIT 1`);
}

/** Create the sprint for a week (Mon–Fri). Idempotent per week. */
export function ensureSprint(app: App, weekOf: Date, goal = ''): Sprint {
  const start = weekStart(weekOf);
  const id = `SP-${isoWeek(start)}`;
  const existing = getSprint(app, id);
  if (existing) return existing;
  app.db.run('INSERT INTO sprints (id, name, start_date, end_date, goal, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, `Sprint ${isoWeek(start).replace('-W', ' W')}`, localDateString(start), localDateString(addDays(start, 4)), goal, 'planned', new Date().toISOString()]);
  return getSprint(app, id)!;
}

export function startSprint(app: App, actor: Employee, id: string, goal?: string): Sprint {
  const s = getSprint(app, id); if (!s) throw new HttpError(404, 'Sprint not found');
  const issues = listDevIssues(app, { sprintId: id, includeReleased: true });
  app.db.run("UPDATE sprints SET status = 'active', goal = COALESCE(?, goal), committed_count = ?, committed_points = ? WHERE id = ?", [goal ?? null, issues.length, issues.reduce((n, i) => n + (i.points || 0), 0), id]);
  app.db.run("UPDATE sprints SET status = 'closed', closed_at = COALESCE(closed_at, ?) WHERE status = 'active' AND id != ?", [new Date().toISOString(), id]);
  audit(app.db, { entity: 'sprint', entityId: id, action: 'start', actorId: actor.id, after: { committed: issues.length } });
  return getSprint(app, id)!;
}

export function closeSprint(app: App, actor: Employee, id: string, carryTo?: string): { closed: Sprint; carried: number } {
  const s = getSprint(app, id); if (!s) throw new HttpError(404, 'Sprint not found');
  const open = listDevIssues(app, { sprintId: id, includeReleased: true }).filter((i) => !['ready', 'released'].includes(i.status));
  const next = carryTo || ensureSprint(app, addDays(new Date(s.start_date), 7)).id;
  app.db.transaction(() => {
    for (const i of open) { app.db.run('UPDATE dev_issues SET sprint_id = ?, updated_at = ? WHERE id = ?', [next, new Date().toISOString(), i.id]); app.db.run('INSERT INTO issue_comments (issue_id, author_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [i.id, actor.id, 'status', `Carried over from ${s.name}`, new Date().toISOString()]); }
    app.db.run("UPDATE sprints SET status = 'closed', closed_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  });
  audit(app.db, { entity: 'sprint', entityId: id, action: 'close', actorId: actor.id, after: { carried: open.length, to: next } });
  return { closed: getSprint(app, id)!, carried: open.length };
}

export function planIssue(app: App, actor: Employee, issueId: string, sprintId: string | null): DevIssue {
  const i = getDevIssue(app, issueId); if (!i) throw new HttpError(404, 'Issue not found');
  app.db.run('UPDATE dev_issues SET sprint_id = ?, status = CASE WHEN ? IS NOT NULL AND status = \'backlog\' THEN \'planned\' WHEN ? IS NULL AND status = \'planned\' THEN \'backlog\' ELSE status END, updated_at = ? WHERE id = ?', [sprintId, sprintId, sprintId, new Date().toISOString(), issueId]);
  audit(app.db, { entity: 'dev_issue', entityId: issueId, action: 'plan', actorId: actor.id, after: { sprintId } });
  return getDevIssue(app, issueId)!;
}

/** Burndown: remaining points (or count) per working day of the sprint, from status history in comments. */
export function burndown(app: App, sprint: Sprint): { day: string; remaining: number; ideal: number }[] {
  const issues = listDevIssues(app, { sprintId: sprint.id, includeReleased: true });
  const weight = (i: DevIssue) => i.points || 1;
  const total = issues.reduce((n, i) => n + weight(i), 0);
  const days: string[] = []; for (let d = new Date(sprint.start_date); localDateString(d) <= sprint.end_date; d = addDays(d, 1)) days.push(localDateString(d));
  const doneAt = new Map<string, string>();
  for (const i of issues) {
    const c = app.db.get<{ created_at: string }>("SELECT created_at FROM issue_comments WHERE issue_id = ? AND kind = 'status' AND (text LIKE '%→ ready%' OR text LIKE '%→ released%') ORDER BY id DESC LIMIT 1", [i.id]);
    if (['ready', 'released'].includes(i.status)) doneAt.set(i.id, (c?.created_at || i.released_at || i.updated_at).slice(0, 10));
  }
  const today = localDateString(new Date());
  return days.map((day, idx) => ({ day, remaining: day > today ? NaN : total - issues.filter((i) => (doneAt.get(i.id) || '9') <= day).reduce((n, i) => n + weight(i), 0), ideal: Math.round((total * (1 - idx / Math.max(1, days.length - 1))) * 10) / 10 }));
}

// ---------- Releases ----------
const RSEL = 'SELECT r.*, p.name AS project_name, q.full_name AS qa_name, h.full_name AS hod_name, (SELECT count(*) FROM dev_issues i WHERE i.release_id = r.id) AS issues FROM releases r LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN employees q ON q.id = r.qa_signed_by LEFT JOIN employees h ON h.id = r.hod_approved_by';
export function listReleases(app: App): Release[] { return app.db.all<Release>(`${RSEL} ORDER BY r.released_at IS NOT NULL, r.planned_date DESC, r.created_at DESC`); }
export function getRelease(app: App, id: string): Release | undefined { return app.db.get<Release>(`${RSEL} WHERE r.id = ?`, [id]); }

export function saveRelease(app: App, actor: Employee, input: { id?: string; version: string; name?: string; projectId?: string | null; plannedDate?: string | null; notes?: string }): Release {
  if (!input.version || !input.version.trim()) throw new HttpError(400, 'Give the release a version, e.g. 3.2.0.');
  if (input.id) { app.db.run('UPDATE releases SET version = ?, name = ?, project_id = ?, planned_date = ?, notes = ? WHERE id = ?', [input.version.trim(), input.name || '', input.projectId || null, input.plannedDate || null, input.notes || '', input.id]); return getRelease(app, input.id)!; }
  const id = app.db.nextId('REL', 10);
  app.db.run('INSERT INTO releases (id, version, name, project_id, planned_date, notes, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, input.version.trim(), input.name || '', input.projectId || null, input.plannedDate || null, input.notes || '', 'planned', actor.id, new Date().toISOString()]);
  audit(app.db, { entity: 'release', entityId: id, action: 'create', actorId: actor.id });
  return getRelease(app, id)!;
}

export function addToRelease(app: App, actor: Employee, issueId: string, releaseId: string | null): void {
  app.db.run('UPDATE dev_issues SET release_id = ?, updated_at = ? WHERE id = ?', [releaseId, new Date().toISOString(), issueId]);
  audit(app.db, { entity: 'dev_issue', entityId: issueId, action: 'release', actorId: actor.id, after: { releaseId } });
}

export function signRelease(app: App, actor: Employee, id: string, role: 'qa' | 'hod'): Release {
  const r = getRelease(app, id); if (!r) throw new HttpError(404, 'Release not found');
  const code = getDepartment(app.db, actor.department_id)?.code;
  if (role === 'qa' && !(code === 'QA' || actor.functional_role === 'executive')) throw new HttpError(403, 'Only QA can sign off testing.');
  const devHod = getDepartment(app.db, 'DEV')?.hod_id;
  if (role === 'hod' && !(actor.id === devHod || actor.functional_role === 'executive')) throw new HttpError(403, 'Only the Development HOD can approve a release.');
  if (role === 'hod' && !r.qa_signed_at) throw new HttpError(400, 'QA must sign off before the HOD approves.');
  const nowIso = new Date().toISOString();
  if (role === 'qa') app.db.run("UPDATE releases SET qa_signed_by = ?, qa_signed_at = ?, status = 'qa_signed' WHERE id = ?", [actor.id, nowIso, id]);
  else app.db.run("UPDATE releases SET hod_approved_by = ?, hod_approved_at = ?, status = 'approved' WHERE id = ?", [actor.id, nowIso, id]);
  audit(app.db, { entity: 'release', entityId: id, action: role === 'qa' ? 'qa_signoff' : 'hod_approve', actorId: actor.id });
  return getRelease(app, id)!;
}

/** Ship a release: every issue in it becomes released (tickets return to support), notes are generated. */
export function shipRelease(app: App, actor: Employee, id: string): { release: Release; notes: string } {
  const r = getRelease(app, id); if (!r) throw new HttpError(404, 'Release not found');
  if (!r.hod_approved_at) throw new HttpError(400, 'The release needs QA sign-off and HOD approval first (decision D6).');
  const issues = listDevIssues(app, { releaseId: id, includeReleased: true });
  app.db.transaction(() => {
    for (const i of issues) if (i.status !== 'released') setDevStatus(app, actor, i.id, 'released');
    const notes = releaseNotes(app, id);
    app.db.run("UPDATE releases SET status = 'released', released_at = ?, notes = CASE WHEN notes = '' THEN ? ELSE notes END WHERE id = ?", [new Date().toISOString(), notes, id]);
  });
  audit(app.db, { entity: 'release', entityId: id, action: 'ship', actorId: actor.id, after: { issues: issues.length } });
  const company = getSetting(app.db, 'company');
  app.notify.sendMany([company.cooId, company.ceoId], { title: `Released ${r.version}${r.name ? ' · ' + r.name : ''}`, body: `${issues.length} issue${issues.length === 1 ? '' : 's'} shipped by ${actor.full_name}.`, link: `/dev/releases/${id}`, kind: 'success' });
  return { release: getRelease(app, id)!, notes: releaseNotes(app, id) };
}

export function releaseNotes(app: App, id: string): string {
  const r = getRelease(app, id); if (!r) return '';
  const issues = listDevIssues(app, { releaseId: id, includeReleased: true });
  const group = (t: string) => issues.filter((i) => i.type === t).map((i) => `- ${i.id} ${i.title}${i.customer_name ? ` (${i.customer_name})` : ''}`).join('\n');
  const parts = [`${r.version}${r.name ? ' — ' + r.name : ''}`, r.project_name ? `Project: ${r.project_name}` : '', ''];
  for (const [t, label] of [['feature', 'New'], ['change', 'Changed'], ['bug', 'Fixed'], ['tech_debt', 'Under the hood'], ['support', 'Support requests']] as const) { const g = group(t); if (g) parts.push(label, g, ''); }
  return parts.join('\n').trim();
}

// ---------- Comments, sub-tasks, QA tests ----------
export function comments(app: App, issueId: string): Comment[] { return app.db.all<Comment>('SELECT c.*, e.full_name AS author_name FROM issue_comments c LEFT JOIN employees e ON e.id = c.author_id WHERE c.issue_id = ? ORDER BY c.id', [issueId]); }
export function addComment(app: App, actor: Employee, issueId: string, text: string, kind = 'comment'): Comment {
  if (!text.trim()) throw new HttpError(400, 'Write something first.');
  const r = app.db.run('INSERT INTO issue_comments (issue_id, author_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [issueId, actor.id, kind, text.trim(), new Date().toISOString()]);
  const i = getDevIssue(app, issueId);
  const mentions = new Set<string>([i?.assignee_id || '', i?.reporter_id || '', i?.created_by || ''].filter((x) => x && x !== actor.id));
  for (const m of mentions) app.notify.send({ employeeId: m, title: `${actor.full_name} commented on ${issueId}`, body: text.trim().slice(0, 140), link: `/dev/${issueId}`, kind: 'info', email: false });
  return app.db.get<Comment>('SELECT * FROM issue_comments WHERE id = ?', [r.lastInsertRowid])!;
}
export function checks(app: App, issueId: string): Check[] { return app.db.all<Check>('SELECT k.*, e.full_name AS done_by_name FROM issue_checks k LEFT JOIN employees e ON e.id = k.done_by WHERE k.issue_id = ? ORDER BY k.kind, k.position, k.id', [issueId]); }
export function addCheck(app: App, actor: Employee, issueId: string, kind: 'subtask' | 'test', title: string): Check {
  if (!title.trim()) throw new HttpError(400, 'Write the item first.');
  const pos = (app.db.get<{ m: number }>('SELECT COALESCE(MAX(position),0) AS m FROM issue_checks WHERE issue_id = ? AND kind = ?', [issueId, kind])?.m || 0) + 1;
  const r = app.db.run('INSERT INTO issue_checks (issue_id, kind, title, position) VALUES (?, ?, ?, ?)', [issueId, kind, title.trim(), pos]);
  return app.db.get<Check>('SELECT * FROM issue_checks WHERE id = ?', [r.lastInsertRowid])!;
}
export function setCheck(app: App, actor: Employee, checkId: number, done: boolean, result?: 'pass' | 'fail'): Check {
  const c = app.db.get<Check>('SELECT * FROM issue_checks WHERE id = ?', [checkId]); if (!c) throw new HttpError(404, 'Item not found');
  const nowIso = new Date().toISOString();
  app.db.run('UPDATE issue_checks SET done = ?, result = ?, done_by = ?, done_at = ? WHERE id = ?', [done ? 1 : 0, c.kind === 'test' ? (done ? result || 'pass' : null) : null, done ? actor.id : null, done ? nowIso : null, checkId]);
  if (c.kind === 'test' && done && result === 'fail') {
    const issue = getDevIssue(app, c.issue_id);
    app.db.run('INSERT INTO issue_comments (issue_id, author_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [c.issue_id, actor.id, 'qa', `QA failed: ${c.title}`, nowIso]);
    if (issue && ['in_qa', 'ready'].includes(issue.status)) setDevStatus(app, actor, c.issue_id, 'in_progress');
    if (issue?.assignee_id && issue.assignee_id !== actor.id) app.notify.send({ employeeId: issue.assignee_id, title: `${c.issue_id} failed QA`, body: c.title, link: `/dev/${c.issue_id}`, kind: 'warn' });
  }
  return app.db.get<Check>('SELECT * FROM issue_checks WHERE id = ?', [checkId])!;
}
export function deleteCheck(app: App, checkId: number): void { app.db.run('DELETE FROM issue_checks WHERE id = ?', [checkId]); }

export function updateIssue(app: App, actor: Employee, id: string, patch: Partial<Pick<DevIssue, 'title' | 'description' | 'type' | 'priority' | 'points' | 'estimate_hours' | 'component' | 'acceptance' | 'project_id' | 'assignee_id' | 'customer_id' | 'due_date' | 'blocked' | 'blocked_reason'>>): DevIssue {
  const cur = getDevIssue(app, id); if (!cur) throw new HttpError(404, 'Issue not found');
  const fields: string[] = []; const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; fields.push(`${k} = ?`); params.push(v as string | number | null); }
  if (!fields.length) return cur;
  params.push(new Date().toISOString(), id);
  app.db.run(`UPDATE dev_issues SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, params);
  if (patch.assignee_id && patch.assignee_id !== cur.assignee_id && patch.assignee_id !== actor.id) app.notify.send({ employeeId: patch.assignee_id, title: `${id} assigned to you`, body: cur.title, link: `/dev/${id}`, kind: 'info' });
  if (patch.blocked !== undefined && patch.blocked !== cur.blocked) app.db.run('INSERT INTO issue_comments (issue_id, author_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)', [id, actor.id, 'status', patch.blocked ? `Blocked: ${patch.blocked_reason || ''}` : 'Unblocked', new Date().toISOString()]);
  audit(app.db, { entity: 'dev_issue', entityId: id, action: 'update', actorId: actor.id, after: patch });
  return getDevIssue(app, id)!;
}

// ---------- Metrics ----------
export interface DevMetrics { period: { from: string; to: string }; velocity: number; released: number; cycleMedianDays: number | null; leadMedianDays: number | null; openBugs: number; bugAgeMedian: number | null; escaped: number; firstPassQa: number | null; carryOver: number; estimateAccuracy: number | null; blocked: number; byPerson: { id: string; name: string; released: number; points: number; cycle: number | null; bugsReopened: number; hours: number; estimated: number }[]; byType: { type: string; open: number; released: number }[]; velocitySeries: { week: string; points: number; count: number }[] }

function median(xs: number[]): number | null { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; }
const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;

export function devMetrics(app: App, from: string, to: string, people?: string[]): DevMetrics {
  const until = addDays(new Date(`${to}T00:00:00Z`), 1).toISOString();
  const pf = people && people.length ? `AND d.assignee_id IN (${people.map(() => '?').join(',')})` : '';
  const pp = people || [];
  const released = app.db.all<DevIssue>(`SELECT d.* FROM dev_issues d WHERE d.released_at >= ? AND d.released_at < ? ${pf}`, [`${from}T00:00:00Z`, until, ...pp]);
  const open = app.db.all<DevIssue>(`SELECT d.* FROM dev_issues d WHERE d.status != 'released' ${pf}`, pp);
  const bugs = open.filter((i) => i.type === 'bug');
  const escaped = app.db.get<{ n: number }>(`SELECT count(*) AS n FROM dev_issues d WHERE d.type = 'bug' AND d.created_at >= ? AND d.created_at < ? AND EXISTS (SELECT 1 FROM tickets t WHERE t.dev_issue_id = d.id) ${pf}`, [`${from}T00:00:00Z`, until, ...pp])?.n || 0;
  const qaTests = app.db.get<{ total: number; passed: number }>(`SELECT count(*) AS total, SUM(CASE WHEN k.result = 'pass' THEN 1 ELSE 0 END) AS passed FROM issue_checks k JOIN dev_issues d ON d.id = k.issue_id WHERE k.kind = 'test' AND k.done = 1 AND k.done_at >= ? AND k.done_at < ? ${pf}`, [`${from}T00:00:00Z`, until, ...pp]);
  const carry = app.db.get<{ n: number }>(`SELECT count(*) AS n FROM issue_comments c JOIN dev_issues d ON d.id = c.issue_id WHERE c.text LIKE 'Carried over%' AND c.created_at >= ? AND c.created_at < ? ${pf}`, [`${from}T00:00:00Z`, until, ...pp])?.n || 0;
  const est = released.filter((i) => i.estimate_hours && i.estimate_hours > 0).map((i) => { const m = app.db.get<{ m: number }>("SELECT COALESCE(SUM(minutes),0) AS m FROM time_logs WHERE entity_type = 'issue' AND entity_id = ? AND ended_at IS NOT NULL", [i.id])?.m || 0; return m ? Math.min(2, (m / 60) / i.estimate_hours!) : null; }).filter((x): x is number => x !== null);
  const byPersonMap = new Map<string, DevMetrics['byPerson'][number]>();
  const nameOf = (id: string) => app.db.get<{ full_name: string }>('SELECT full_name FROM employees WHERE id = ?', [id])?.full_name || id;
  for (const i of released) {
    if (!i.assignee_id) continue;
    const e = byPersonMap.get(i.assignee_id) || { id: i.assignee_id, name: nameOf(i.assignee_id), released: 0, points: 0, cycle: null, bugsReopened: 0, hours: 0, estimated: 0 };
    e.released++; e.points += i.points || 0; e.bugsReopened += i.reopen_count; e.estimated += i.estimate_hours || 0;
    e.hours += (app.db.get<{ m: number }>("SELECT COALESCE(SUM(minutes),0) AS m FROM time_logs WHERE entity_type = 'issue' AND entity_id = ? AND ended_at IS NOT NULL", [i.id])?.m || 0) / 60;
    byPersonMap.set(i.assignee_id, e);
  }
  for (const e of byPersonMap.values()) e.cycle = median(released.filter((i) => i.assignee_id === e.id && i.started_at && i.released_at).map((i) => days(i.started_at!, i.released_at!)));
  const weeks: DevMetrics['velocitySeries'] = [];
  for (let w = 7; w >= 0; w--) { const ws = weekStart(addDays(new Date(), -7 * w)); const we = addDays(ws, 7); const rs = app.db.all<{ points: number | null }>(`SELECT d.points FROM dev_issues d WHERE d.released_at >= ? AND d.released_at < ? ${pf}`, [ws.toISOString(), we.toISOString(), ...pp]); weeks.push({ week: 'W' + isoWeek(ws).split('-W')[1], points: rs.reduce((n, r) => n + (r.points || 0), 0), count: rs.length }); }
  const types = ['feature', 'bug', 'change', 'tech_debt', 'support'];
  return {
    period: { from, to }, velocity: released.reduce((n, i) => n + (i.points || 0), 0), released: released.length,
    cycleMedianDays: median(released.filter((i) => i.started_at && i.released_at).map((i) => days(i.started_at!, i.released_at!))),
    leadMedianDays: median(released.filter((i) => i.released_at).map((i) => days(i.created_at, i.released_at!))),
    openBugs: bugs.length, bugAgeMedian: median(bugs.map((i) => days(i.created_at, new Date().toISOString()))), escaped,
    firstPassQa: qaTests && qaTests.total ? Math.round(((qaTests.passed || 0) / qaTests.total) * 100) : null, carryOver: carry,
    estimateAccuracy: est.length ? Math.round(100 - Math.abs(1 - est.reduce((a, b) => a + b, 0) / est.length) * 100) : null, blocked: open.filter((i) => i.blocked).length,
    byPerson: [...byPersonMap.values()].sort((a, b) => b.points - a.points || b.released - a.released),
    byType: types.map((t) => ({ type: t, open: open.filter((i) => i.type === t).length, released: released.filter((i) => i.type === t).length })),
    velocitySeries: weeks
  };
}

export { DEV_STATUSES };
export type { DevStatus };
