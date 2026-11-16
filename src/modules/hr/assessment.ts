// Workplace English assessment: invitation, candidate attempt, scoring, HR review, reminders.
// Rules this file exists to keep:
//   · The result is advisory. Nothing here moves a stage or closes an application.
//   · The invitation link is a secret. Only its hash and an encrypted copy are stored; no HR-facing function returns either.
//   · The timer starts when the candidate presses Begin, not when the page opens. One submission only.
//   · Objective items are scored by the system; the writing is scored by an HR reviewer.
//   · A send that Microsoft 365 accepted is "accepted", never "delivered". An uncertain send is never retried automatically.
import { number as limit } from '../../lib/lists.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { randomToken, sha256 } from '../../lib/crypto.ts';
import type { Employee } from '../people/model.ts';
import { getApplication, getRequisition, getCandidate, isRecruiter } from './recruiting.ts';
import { TEMPLATES, LEVELS, RUBRIC, RUBRIC_MAX, scoreObjective, type Level } from './assessment-templates.ts';

export const MAX_BATCH = 20;
export const MIN_EXPIRY_DAYS = 1;
export const MAX_EXPIRY_DAYS = 14;
const GRACE_MS = 30_000;
const HOUR = 3_600_000;

/** What HR sees. There is deliberately no token, hash or cipher on this type. */
export interface Invitation {
  id: string; application_id: string; batch_id: string; level: string; template_version: number; status: string; expires_at: string;
  send_state: string; send_detail: string; sent_at: string | null; reminder1_at: string | null; reminder2_at: string | null;
  started_at: string | null; deadline_at: string | null; submitted_at: string | null;
  objective_score: number | null; objective_total: number | null; reading_score: number | null; language_score: number | null;
  review_total: number | null; review_note: string; outcome: string; reviewed_by: string | null; reviewed_at: string | null;
  created_by: string | null; created_at: string;
  candidate_name?: string; candidate_email?: string; requisition_title?: string; requisition_id?: string; reviewed_by_name?: string; stage?: string;
}
const SAFE_COLS = `v.id, v.application_id, v.batch_id, v.level, v.template_version, v.status, v.expires_at, v.send_state, v.send_detail, v.sent_at, v.reminder1_at, v.reminder2_at,
  v.started_at, v.deadline_at, v.submitted_at, v.objective_score, v.objective_total, v.reading_score, v.language_score, v.review_total, v.review_note, v.outcome, v.reviewed_by, v.reviewed_at, v.created_by, v.created_at`;
const SELECT = `SELECT ${SAFE_COLS}, c.full_name AS candidate_name, c.email AS candidate_email, r.title AS requisition_title, r.id AS requisition_id, e.full_name AS reviewed_by_name, a.stage AS stage
  FROM assessment_invitations v JOIN applications a ON a.id = v.application_id JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id LEFT JOIN employees e ON e.id = v.reviewed_by`;

interface Row extends Invitation { token_hash: string; token_cipher: string; answers: string; writing: string; review: string }

const nowIso = () => new Date().toISOString();
export const STATUS_LABEL: Record<string, string> = { invited: 'Invited', started: 'Started', submitted: 'Submitted', expired: 'Expired', replaced: 'Replaced' };
export const SEND_LABEL: Record<string, string> = { not_sent: 'Not sent', accepted: 'Accepted by Microsoft 365', uncertain: 'Uncertain — check Sent Items', failed: 'Failed' };
export const OUTCOMES: { value: string; label: string }[] = [{ value: 'meets', label: 'Meets the level needed for this role' }, { value: 'borderline', label: 'Borderline for this role' }, { value: 'below', label: 'Below the level needed for this role' }];

// ---------- The secret link ----------

function secretKey(app: App): Buffer { return createHash('sha256').update(`assessment-link:${app.cfg.assessmentSecret || app.cfg.sessionSecret}`).digest(); }
function encryptToken(app: App, token: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(app), iv);
  const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
  return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
}
function decryptToken(app: App, cipher: string): string {
  const [iv, tag, ct] = cipher.split('.').map((x) => Buffer.from(x, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', secretKey(app), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}
const linkFor = (app: App, token: string): string => `${app.cfg.baseUrl}/assess/${token}`;

/**
 * How an invitation reaches the candidate. With Microsoft 365 mail configured it is emailed. Without it, HR copies the link
 * and sends it by hand (WhatsApp, their own email). The COO chose manual sharing on 11 Nov 2026 until the app is hosted.
 */
export function canIssue(app: App): { ok: boolean; mode: 'graph' | 'manual' } {
  return { ok: true, mode: app.graph.configured ? 'graph' : 'manual' };
}

/**
 * The candidate's link, for HR to copy and send. It is produced only on request, never placed in a list or a page, and
 * every request is recorded with who asked and when.
 */
export function shareLink(app: App, actor: Employee, id: string): { link: string; name: string; expires: string; level: string } {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR can take an assessment link.');
  const row = app.db.get<{ token_cipher: string; status: string; application_id: string }>('SELECT token_cipher, status, application_id FROM assessment_invitations WHERE id = ?', [id]);
  const inv = getInvitation(app, id);
  if (!row || !inv) throw new HttpError(404, 'Invitation not found.');
  if (!['invited', 'started'].includes(row.status)) throw new HttpError(400, 'This link is no longer active. Reissue the invitation to get a new one.');
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [row.application_id, 'assessment', `Assessment link taken by ${actor.full_name} to send by hand`, actor.id, nowIso()]);
  logMessage(app, { applicationId: row.application_id, kind: 'assessment_link_shared_by_hand', recipient: inv.candidate_email || '', subject: 'Workplace English assessment', state: 'not_sent', detail: `Link taken by ${actor.full_name} to send outside LoyalFlow.`, relatedId: id, actorId: actor.id });
  audit(app.db, { actorId: actor.id, entity: 'assessment', entityId: id, action: 'link_shown' });
  return { link: linkFor(app, decryptToken(app, row.token_cipher)), name: inv.candidate_name || '', expires: inv.expires_at, level: inv.level };
}
/** Kept for the tests and the seed script: the link without the modal. */
export function demoLink(app: App, actor: Employee, id: string): string { return shareLink(app, actor, id).link; }

// ---------- Messages ----------

export interface HireMessage { id: number; application_id: string; kind: string; recipient: string; subject: string; state: string; detail: string; provider_ref: string; related_id: string; actor_id: string | null; at: string; actor_name?: string }
export function messagesOf(app: App, applicationId: string): HireMessage[] {
  return app.db.all<HireMessage>('SELECT m.*, e.full_name AS actor_name FROM hire_messages m LEFT JOIN employees e ON e.id = m.actor_id WHERE m.application_id = ? ORDER BY m.id DESC LIMIT 50', [applicationId]);
}
function logMessage(app: App, m: { applicationId: string; kind: string; recipient: string; subject: string; state: string; detail: string; ref?: string; relatedId?: string; actorId?: string | null }): void {
  app.db.run('INSERT INTO hire_messages (application_id, kind, recipient, subject, state, detail, provider_ref, related_id, actor_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [m.applicationId, m.kind, m.recipient, m.subject, m.state, m.detail, m.ref || '', m.relatedId || '', m.actorId ?? null, nowIso()]);
}
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function inviteEmail(name: string, role: string, link: string, expires: string, reminder: boolean): { subject: string; html: string } {
  const when = new Date(expires).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  return {
    subject: reminder ? `Reminder: your Workplace English assessment for ${role}` : `Your Workplace English assessment for ${role} at Loyal String`,
    html: `<p>Dear ${esc(name)},</p><p>${reminder ? 'This is a reminder that your' : 'As part of your application for'} <b>${esc(role)}</b>${reminder ? ' application includes' : ', please complete'} a short Workplace English assessment.</p>
<p><a href="${esc(link)}">Open the assessment</a></p>
<p>It takes 25 minutes. The timer starts only when you press Begin. Your answers are saved as you go, and you can submit once. The link is personal to you and stops working on ${esc(when)} (India time).</p>
<p>Regards,<br>HR, Loyal String</p>`
  };
}
async function sendInvite(app: App, id: string, token: string, actorId: string | null, reminder: 0 | 1 | 2): Promise<string> {
  const v = app.db.get<Invitation>(`${SELECT} WHERE v.id = ?`, [id])!;
  const kind = reminder ? `assessment_reminder_${reminder}` : 'assessment_invitation';
  if (!app.graph.configured) {
    if (!reminder) logMessage(app, { applicationId: v.application_id, kind, recipient: v.candidate_email || '', subject: 'Workplace English assessment', state: 'not_sent', detail: 'Nothing was emailed. Share the link by hand from the Assessments page.', relatedId: id, actorId });
    return 'not_sent';
  }
  if (!v.candidate_email) {
    logMessage(app, { applicationId: v.application_id, kind, recipient: '', subject: 'Workplace English assessment', state: 'failed', detail: 'The candidate has no email address on record.', relatedId: id, actorId });
    if (!reminder) app.db.run("UPDATE assessment_invitations SET send_state = 'failed', send_detail = ? WHERE id = ?", ['No email address on record', id]);
    return 'failed';
  }
  const mail = inviteEmail(v.candidate_name || 'candidate', v.requisition_title || 'the role', linkFor(app, token), v.expires_at, reminder > 0);
  const res = await app.graph.send({ to: v.candidate_email, subject: mail.subject, html: mail.html });
  logMessage(app, { applicationId: v.application_id, kind, recipient: v.candidate_email, subject: mail.subject, state: res.state, detail: res.detail, ref: res.ref, relatedId: id, actorId });
  if (!reminder) app.db.run('UPDATE assessment_invitations SET send_state = ?, send_detail = ?, sent_at = ? WHERE id = ?', [res.state, res.detail, res.state === 'failed' ? null : nowIso(), id]);
  return res.state;
}

// ---------- Issuing ----------

function createInvitation(app: App, actor: Employee, applicationId: string, level: Level, expiresAt: string, batchId: string): { id: string; token: string } {
  // Reissuing supersedes whatever was still live for this application.
  app.db.run("UPDATE assessment_invitations SET status = 'replaced' WHERE application_id = ? AND status IN ('invited', 'started')", [applicationId]);
  const token = randomToken(32);
  const id = app.db.nextId('ASM');
  app.db.run(`INSERT INTO assessment_invitations (id, application_id, batch_id, level, template_version, token_hash, token_cipher, status, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'invited', ?, ?, ?)`, [id, applicationId, batchId, level, TEMPLATES[level].version, sha256(token), encryptToken(app, token), expiresAt, actor.id, nowIso()]);
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [applicationId, 'assessment', `Workplace English assessment (${level}) issued`, actor.id, nowIso()]);
  audit(app.db, { actorId: actor.id, entity: 'assessment', entityId: id, action: 'issued', after: { level, expiresAt } });
  return { id, token };
}

/** For seeding test data only: creates an invitation without sending anything and hands back the link token. */
export function issueForSeed(app: App, actor: Employee, applicationId: string, level: Level, expiresAt: string): { id: string; token: string } {
  return createInvitation(app, actor, applicationId, level, expiresAt, '');
}

function checkCommon(app: App, actor: Employee, level: string, expiryDays: number): void {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR issues assessments.');
  if (!(LEVELS as readonly string[]).includes(level)) throw new HttpError(400, 'Choose level A2 or B1.');
  if (!Number.isInteger(expiryDays) || expiryDays < MIN_EXPIRY_DAYS || expiryDays > limit('hire.assessExpiryMaxDays')) throw new HttpError(400, `The link can stay open for ${MIN_EXPIRY_DAYS} to ${limit('hire.assessExpiryMaxDays')} days.`);
}

/** One invitation, from a candidate's application. */
export async function inviteOne(app: App, actor: Employee, applicationId: string, level: string, expiryDays: number): Promise<Invitation> {
  checkCommon(app, actor, level, expiryDays);
  const a = getApplication(app, applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  if (a.status === 'closed') throw new HttpError(400, 'This application is closed.');
  const { id, token } = createInvitation(app, actor, applicationId, level as Level, new Date(Date.now() + expiryDays * 24 * HOUR).toISOString(), '');
  await sendInvite(app, id, token, actor.id, 0);
  return getInvitation(app, id)!;
}

/** A batch: up to 20 active applicants of one open vacancy, one level, one expiry. */
export async function inviteBatch(app: App, actor: Employee, requisitionId: string, applicationIds: string[], level: string, expiryDays: number): Promise<{ batchId: string; invitations: Invitation[] }> {
  checkCommon(app, actor, level, expiryDays);
  const req = getRequisition(app, requisitionId);
  if (!req) throw new HttpError(404, 'Vacancy not found.');
  if (req.status !== 'open') throw new HttpError(400, 'Batch invitations can be sent only from an open vacancy.');
  const ids = [...new Set(applicationIds)];
  if (!ids.length) throw new HttpError(400, 'Choose at least one applicant.');
  if (ids.length > limit('hire.assessBatchMax')) throw new HttpError(400, `Choose at most ${limit('hire.assessBatchMax')} applicants in one batch.`);
  for (const id of ids) {
    const a = getApplication(app, id);
    if (!a || a.requisition_id !== requisitionId) throw new HttpError(400, 'Every applicant in a batch must belong to this vacancy.');
    if (a.status !== 'active') throw new HttpError(400, `${a.candidate_name} is not an active applicant.`);
  }
  const batchId = app.db.nextId('ASB');
  const expiresAt = new Date(Date.now() + expiryDays * 24 * HOUR).toISOString();
  const out: Invitation[] = [];
  for (const applicationId of ids) {
    const { id, token } = createInvitation(app, actor, applicationId, level as Level, expiresAt, batchId);
    await sendInvite(app, id, token, actor.id, 0);
    out.push(getInvitation(app, id)!);
  }
  return { batchId, invitations: out };
}

// ---------- HR views ----------

export function getInvitation(app: App, id: string): Invitation | undefined { return app.db.get<Invitation>(`${SELECT} WHERE v.id = ?`, [id]); }
export function invitationsOf(app: App, applicationId: string): Invitation[] { return app.db.all<Invitation>(`${SELECT} WHERE v.application_id = ? ORDER BY v.created_at DESC`, [applicationId]); }
export function listInvitations(app: App, f: { requisitionId?: string; status?: string; q?: string; limit?: number } = {}): Invitation[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.requisitionId) { where.push('r.id = ?'); params.push(f.requisitionId); }
  if (f.status === 'review') where.push("v.status = 'submitted' AND v.reviewed_at IS NULL");
  else if (f.status) { where.push('v.status = ?'); params.push(f.status); }
  if (f.q) { where.push('lower(c.full_name) LIKE ?'); params.push(`%${f.q.toLowerCase()}%`); }
  params.push(f.limit || 300);
  return app.db.all<Invitation>(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY v.created_at DESC LIMIT ?`, params);
}

export interface PilotMetrics { issued: number; started: number; submitted: number; expired: number; completionPct: number | null; avgObjectivePct: number | null; reviewed: number; awaitingReview: number; avgWriting: number | null; avgMinutes: number | null; byLevel: { level: string; issued: number; submitted: number; avgObjectivePct: number | null }[] }
export function pilotMetrics(app: App, requisitionId?: string): PilotMetrics {
  const rows = listInvitations(app, { requisitionId, limit: 5000 }).filter((r) => r.status !== 'replaced');
  const sub = rows.filter((r) => r.status === 'submitted');
  const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const pct = (r: Invitation): number => ((r.objective_score || 0) / (r.objective_total || 1)) * 100;
  return {
    issued: rows.length, started: rows.filter((r) => r.status === 'started').length, submitted: sub.length, expired: rows.filter((r) => r.status === 'expired').length,
    completionPct: rows.length ? Math.round((sub.length / rows.length) * 100) : null,
    avgObjectivePct: avg(sub.map(pct)), reviewed: sub.filter((r) => r.reviewed_at).length, awaitingReview: sub.filter((r) => !r.reviewed_at).length,
    avgWriting: avg(sub.filter((r) => r.review_total != null).map((r) => r.review_total!)),
    avgMinutes: avg(sub.filter((r) => r.started_at && r.submitted_at).map((r) => (new Date(r.submitted_at!).getTime() - new Date(r.started_at!).getTime()) / 60_000)),
    byLevel: LEVELS.map((level) => { const l = rows.filter((r) => r.level === level); const ls = l.filter((r) => r.status === 'submitted'); return { level, issued: l.length, submitted: ls.length, avgObjectivePct: avg(ls.map(pct)) }; })
  };
}

/** The writing response and rubric scores, for the HR reviewer only. */
export function reviewDetail(app: App, actor: Employee, id: string): { inv: Invitation; writing: string; review: Record<string, number>; words: number } {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Assessment writing is reviewed by HR only.');
  const row = app.db.get<{ writing: string; review: string }>('SELECT writing, review FROM assessment_invitations WHERE id = ?', [id]);
  const inv = getInvitation(app, id);
  if (!row || !inv) throw new HttpError(404, 'Assessment not found.');
  let review: Record<string, number> = {}; try { review = JSON.parse(row.review) as Record<string, number>; } catch { /* empty */ }
  return { inv, writing: row.writing, review, words: row.writing.trim() ? row.writing.trim().split(/\s+/).length : 0 };
}

export function saveReview(app: App, actor: Employee, id: string, input: { scores: Record<string, number>; outcome: string; note: string }): Invitation {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Assessment writing is reviewed by HR only.');
  const inv = getInvitation(app, id);
  if (!inv) throw new HttpError(404, 'Assessment not found.');
  if (inv.status !== 'submitted') throw new HttpError(400, 'Only a submitted assessment can be reviewed.');
  const scores: Record<string, number> = {};
  for (const r of RUBRIC) {
    const n = input.scores[r.key];
    if (!Number.isInteger(n) || n < 0 || n > RUBRIC_MAX) throw new HttpError(400, `Give "${r.label}" a score from 0 to ${RUBRIC_MAX}.`);
    scores[r.key] = n;
  }
  if (!OUTCOMES.some((o) => o.value === input.outcome)) throw new HttpError(400, 'Choose the outcome for this role.');
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  app.db.run('UPDATE assessment_invitations SET review = ?, review_total = ?, review_note = ?, outcome = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [JSON.stringify(scores), total, input.note.trim(), input.outcome, actor.id, nowIso(), id]);
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [inv.application_id, 'assessment', `Assessment writing reviewed: ${total}/${RUBRIC.length * RUBRIC_MAX}`, actor.id, nowIso()]);
  audit(app.db, { actorId: actor.id, entity: 'assessment', entityId: id, action: 'reviewed', after: { total, outcome: input.outcome } });
  return getInvitation(app, id)!;
}

// ---------- The candidate's side ----------

export interface Attempt { id: string; level: string; status: string; expires_at: string; started_at: string | null; deadline_at: string | null; submitted_at: string | null; answers: Record<string, number>; writing: string; candidate_name: string; requisition_title: string; secondsLeft: number }

function finalize(app: App, row: Row, at: string): void {
  let answers: Record<string, unknown> = {}; try { answers = JSON.parse(row.answers) as Record<string, unknown>; } catch { /* empty */ }
  const s = scoreObjective(row.level, answers);
  app.db.run("UPDATE assessment_invitations SET status = 'submitted', submitted_at = ?, objective_score = ?, objective_total = ?, reading_score = ?, language_score = ? WHERE id = ? AND status = 'started'", [at, s.score, s.total, s.reading, s.language, row.id]);
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, NULL, ?)', [row.application_id, 'assessment', 'Assessment submitted by the candidate', at]);
}

/** Bring one invitation up to date with the clock: a timed-out attempt is submitted with what was saved; an unused link past its date expires. */
function settle(app: App, row: Row, now: Date): Row {
  if (row.status === 'started' && row.deadline_at && now.getTime() > new Date(row.deadline_at).getTime() + GRACE_MS) finalize(app, row, row.deadline_at);
  else if (row.status === 'invited' && now.getTime() > new Date(row.expires_at).getTime()) app.db.run("UPDATE assessment_invitations SET status = 'expired' WHERE id = ? AND status = 'invited'", [row.id]);
  else return row;
  return app.db.get<Row>('SELECT * FROM assessment_invitations WHERE id = ?', [row.id])!;
}

function rowByToken(app: App, token: string, now = new Date()): Row | undefined {
  if (!token || token.length < 20) return undefined;
  const row = app.db.get<Row>('SELECT * FROM assessment_invitations WHERE token_hash = ?', [sha256(token)]);
  return row ? settle(app, row, now) : undefined;
}

export function attemptByToken(app: App, token: string, now = new Date()): Attempt | undefined {
  const row = rowByToken(app, token, now);
  if (!row) return undefined;
  const a = getApplication(app, row.application_id)!;
  let answers: Record<string, number> = {}; try { answers = JSON.parse(row.answers) as Record<string, number>; } catch { /* empty */ }
  const open = row.status === 'started';
  return {
    id: row.id, level: row.level, status: row.status, expires_at: row.expires_at, started_at: row.started_at, deadline_at: row.deadline_at, submitted_at: row.submitted_at,
    answers: open ? answers : {}, writing: open ? row.writing : '', candidate_name: getCandidate(app, a.candidate_id)?.full_name || '', requisition_title: a.requisition_title || '',
    secondsLeft: open && row.deadline_at ? Math.max(0, Math.round((new Date(row.deadline_at).getTime() - now.getTime()) / 1000)) : 0
  };
}

/** The candidate pressed Begin. This, and only this, starts the 25 minutes. */
export function beginAttempt(app: App, token: string, now = new Date()): Attempt {
  const row = rowByToken(app, token, now);
  if (!row) throw new HttpError(404, 'This link is not valid.');
  if (row.status === 'started') return attemptByToken(app, token, now)!;
  if (row.status !== 'invited') throw new HttpError(400, row.status === 'submitted' ? 'This assessment has already been submitted.' : 'This link is no longer active.');
  const deadline = new Date(now.getTime() + TEMPLATES[row.level].minutes * 60_000).toISOString();
  app.db.run("UPDATE assessment_invitations SET status = 'started', started_at = ?, deadline_at = ? WHERE id = ? AND status = 'invited'", [now.toISOString(), deadline, row.id]);
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, NULL, ?)', [row.application_id, 'assessment', 'Assessment started by the candidate', now.toISOString()]);
  return attemptByToken(app, token, now)!;
}

function cleanAnswers(level: string, raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const item of TEMPLATES[level].items) {
    const v = Number((raw as Record<string, unknown>)[item.id]);
    if (Number.isInteger(v) && v >= 0 && v < item.options.length) out[item.id] = v;
  }
  return out;
}

/** Autosave. Works only while the attempt is running. */
export function saveAttempt(app: App, token: string, input: { answers?: unknown; writing?: unknown }, now = new Date()): { ok: boolean; secondsLeft: number } {
  const row = rowByToken(app, token, now);
  if (!row) throw new HttpError(404, 'This link is not valid.');
  if (row.status !== 'started') throw new HttpError(400, 'This assessment is not open.');
  app.db.run('UPDATE assessment_invitations SET answers = ?, writing = ? WHERE id = ? AND status = ?', [JSON.stringify(cleanAnswers(row.level, input.answers)), String(input.writing ?? '').slice(0, 6000), row.id, 'started']);
  return { ok: true, secondsLeft: Math.max(0, Math.round((new Date(row.deadline_at!).getTime() - now.getTime()) / 1000)) };
}

/** One submission. A second one is refused. */
export function submitAttempt(app: App, token: string, input: { answers?: unknown; writing?: unknown }, now = new Date()): void {
  const row = rowByToken(app, token, now);
  if (!row) throw new HttpError(404, 'This link is not valid.');
  if (row.status === 'submitted') throw new HttpError(400, 'This assessment has already been submitted.');
  if (row.status !== 'started') throw new HttpError(400, 'This assessment is not open.');
  if (input.answers !== undefined || input.writing !== undefined) saveAttempt(app, token, input, now);
  finalize(app, app.db.get<Row>('SELECT * FROM assessment_invitations WHERE id = ?', [row.id])!, now.toISOString());
}

// ---------- Reminders and housekeeping (run by the scheduler; one server instance) ----------

/**
 * Reminder 1: 48 hours after an accepted invitation. Reminder 2: 24 hours before expiry.
 * Only for invitations Microsoft 365 accepted, and only while the candidate has not started. Each reminder is claimed
 * in the database before it is sent, so a crash or a second tick cannot send it twice.
 */
export async function runAssessmentJobs(app: App, now = new Date()): Promise<{ expired: number; finalized: number; reminders: number }> {
  let expired = 0, finalized = 0, reminders = 0;
  for (const row of app.db.all<Row>("SELECT * FROM assessment_invitations WHERE status IN ('invited', 'started')")) {
    const after = settle(app, row, now);
    if (after.status === 'expired' && row.status === 'invited') expired++;
    if (after.status === 'submitted' && row.status === 'started') finalized++;
  }
  if (!app.graph.configured) return { expired, finalized, reminders };
  const due = app.db.all<Row>("SELECT * FROM assessment_invitations WHERE status = 'invited' AND send_state = 'accepted' AND sent_at IS NOT NULL AND (reminder1_at IS NULL OR reminder2_at IS NULL)");
  for (const row of due) {
    const sent = new Date(row.sent_at!).getTime(), exp = new Date(row.expires_at).getTime(), t = now.getTime();
    if (t >= exp) continue;
    let which: 0 | 1 | 2 = 0;
    if (!row.reminder2_at && t >= exp - 24 * HOUR) which = 2;
    else if (!row.reminder1_at && !row.reminder2_at && t >= sent + 48 * HOUR) which = 1;
    if (!which) continue;
    const col = which === 1 ? 'reminder1_at' : 'reminder2_at';
    const claimed = app.db.run(`UPDATE assessment_invitations SET ${col} = ? WHERE id = ? AND ${col} IS NULL AND status = 'invited'`, [now.toISOString(), row.id]);
    if (!claimed.changes) continue;
    await sendInvite(app, row.id, decryptToken(app, row.token_cipher), null, which);
    reminders++;
  }
  return { expired, finalized, reminders };
}
