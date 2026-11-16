// LoyalHire: requisitions, candidates, applications, interviews, scorecards and offers.
//
// Three rules are enforced here rather than left to the interface:
//   1. A candidate record and their CV are visible only to HR and to people put on that application.
//   2. No score rejects anybody. A low scorecard is evidence; a human writes the decision and the reason.
//   3. No offer is ever issued automatically. It is drafted, approved, then issued by a named person.
import { can } from '../../lib/scope.ts';
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { localDateString, fmtDateTime } from '../../lib/time.ts';
import { getEmployee, listEmployees, type Employee } from '../people/model.ts';
import { createTask } from '../tasks/service.ts';
import { getSetting } from '../../lib/settings.ts';

import { setDefaults, onList, listDef } from '../../lib/lists.ts';
export const WORKFLOW_VERSION = 2;
export const STAGES = ['applied', 'screening', 'assessment', 'interview', 'decision', 'offer', 'onboarding', 'hired'] as const;
/** Stages HR can move a card between by hand. Offer, onboarding and hired are reached only through a decision, an accepted offer and a finished onboarding. */
export const MANUAL_STAGES: readonly string[] = ['applied', 'screening', 'assessment', 'interview', 'decision'];
export type Stage = typeof STAGES[number];
export const STAGE_LABEL: Record<string, string> = { applied: 'Applied', screening: 'Screening', assessment: 'Assessment', interview: 'Interview', decision: 'Decision', offer: 'Offer', onboarding: 'Onboarding', hired: 'Hired' };
export const ROUND_TYPES: string[] = ['screening', 'technical', 'practical', 'managerial', 'hr'];
export const SCORE_AREAS: { key: string; label: string }[] = [
  { key: 'skill', label: 'Role skills' }, { key: 'problem', label: 'Problem solving' },
  { key: 'communication', label: 'Communication' }, { key: 'ownership', label: 'Ownership' }, { key: 'fit', label: 'Fit with how we work' }
];
// Stage names, interview kinds and scorecard areas can be changed under Settings → Lists.
setDefaults('hire.stages', STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s], active: true })));
onList('hire.stages', (items) => { for (const i of items) STAGE_LABEL[i.value] = i.label; });
setDefaults('hire.roundTypes', ROUND_TYPES.map((t) => ({ value: t, label: t === 'hr' ? 'HR' : t[0].toUpperCase() + t.slice(1), active: true })));
onList('hire.roundTypes', (items) => { ROUND_TYPES.length = 0; ROUND_TYPES.push(...items.filter((i) => i.active).map((i) => i.value)); });
setDefaults('hire.scoreAreas', SCORE_AREAS.map((a) => ({ value: a.key, label: a.label, active: true })));
onList('hire.scoreAreas', (items) => { SCORE_AREAS.length = 0; SCORE_AREAS.push(...items.filter((i) => i.active).map((i) => ({ key: i.value, label: i.label }))); });
export const RECOMMENDATIONS = ['strong_yes', 'yes', 'no', 'strong_no'] as const;
export const RECOMMENDATION_LABEL: Record<string, string> = { strong_yes: 'Strong yes', yes: 'Yes', no: 'No', strong_no: 'Strong no' };

export interface Requisition {
  id: string; title: string; department_id: string | null; positions: number; employment_type: string; experience: string; budget_ctc: number | null;
  location: string; justification: string; description: string; status: string; workflow_version: number;
  hiring_manager_id: string | null; recruiter_id: string | null; approval_task_id: string | null; approved_by: string | null; approved_at: string | null;
  closed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
  approval_ref: string; work_mode: string; target_date: string | null; paused_at: string | null; interview_plan: string;
  department?: string; hiring_manager?: string; recruiter?: string; active_applications?: number; hired_count?: number;
}
export interface Candidate {
  id: string; full_name: string; email: string; email_normalized: string; phone: string; current_employer: string; experience_years: number | null;
  current_ctc: number | null; expected_ctc: number | null; notice_days: number | null; location: string; cv_path: string; cv_text: string;
  notes: string; consent_at: string | null; created_by: string | null; created_at: string; updated_at: string;
}
export interface Application {
  id: string; candidate_id: string; requisition_id: string; source: string; received_at: string; owner_id: string | null;
  stage: string; stage_since: string; status: string; outcome: string; outcome_reason: string; decision_by: string | null; decision_at: string | null;
  workflow_version: number; screening_notes: string; created_at: string; updated_at: string; hold_reason: string; hold_until: string | null;
  candidate_name?: string; candidate_email?: string; candidate_phone?: string; requisition_title?: string; owner_name?: string; department_id?: string | null;
}
export interface Interview {
  id: string; application_id: string; round: number; round_type: string; round_name: string; mode: string; location: string; starts_at: string; ends_at: string;
  status: string; previous_starts_at: string | null; reschedule_reason: string; candidate_informed: number; calibrated_at: string | null;
  created_by: string | null; created_at: string; panel?: { id: string; name: string }[]; candidate_name?: string; requisition_title?: string; application_stage?: string;
}
export interface Scorecard {
  id: number; interview_id: string; interviewer_id: string; ratings: string; overall: number | null; recommendation: string;
  notes: string; evidence: string; submitted_at: string | null; reopened_by: string | null; reopened_at: string | null; updated_at: string;
  interviewer_name?: string;
}
export interface Offer {
  id: string; application_id: string; ctc_annual: number; designation: string; department_id: string | null; joining_date: string | null; expiry_date: string | null;
  status: string; body: string; issued_by: string | null; issued_at: string | null; responded_at: string | null; response_note: string;
  approval_task_id: string | null; created_by: string | null; created_at: string;
  candidate_name?: string; issued_by_name?: string;
}

export const normalizeEmail = (s: string): string => s.trim().toLowerCase().replace(/\+[^@]*@/, '@');
const nowIso = () => new Date().toISOString();

// ---------- Who may see what ----------

/** HR, the recruiter, the hiring manager, the application owner and anyone on a panel for it. */
export function canSeeApplication(app: App, user: Employee, a: Application): boolean {
  if (isRecruiter(app, user)) return true;
  if (a.owner_id === user.id) return true;
  const req = getRequisition(app, a.requisition_id);
  if (req && (req.hiring_manager_id === user.id || req.recruiter_id === user.id)) return true;
  return !!app.db.get('SELECT 1 FROM interview_panel p JOIN interviews i ON i.id = p.interview_id WHERE i.application_id = ? AND p.interviewer_id = ?', [a.id, user.id]);
}
export function requireSeeApplication(app: App, user: Employee, a: Application): void {
  if (!canSeeApplication(app, user, a)) throw new HttpError(403, 'Candidate records are limited to HR and the people working on this hire.');
}
/** HR, Accounts-side recruiters and executives run hiring. */
export function isRecruiter(app: App, e: Employee): boolean { return can(app.db, e, 'hire.manage'); }

// ---------- Requisitions ----------

const REQ_SELECT = `SELECT r.*, d.name AS department, h.full_name AS hiring_manager, rec.full_name AS recruiter,
  (SELECT count(*) FROM applications a WHERE a.requisition_id = r.id AND a.status IN ('active', 'on_hold')) AS active_applications,
  (SELECT count(*) FROM applications a WHERE a.requisition_id = r.id AND a.outcome = 'hired') AS hired_count
  FROM requisitions r LEFT JOIN departments d ON d.id = r.department_id LEFT JOIN employees h ON h.id = r.hiring_manager_id LEFT JOIN employees rec ON rec.id = r.recruiter_id`;

export function getRequisition(app: App, id: string): Requisition | undefined { return app.db.get<Requisition>(`${REQ_SELECT} WHERE r.id = ?`, [id]); }
export function listRequisitions(app: App, f: { status?: string[]; limit?: number } = {}): Requisition[] {
  const where = f.status && f.status.length ? `WHERE r.status IN (${f.status.map(() => '?').join(',')})` : '';
  return app.db.all<Requisition>(`${REQ_SELECT} ${where} ORDER BY r.created_at DESC LIMIT ?`, [...(f.status || []), f.limit || 100]);
}

export function saveRequisition(app: App, actor: Employee, input: { id?: string; title: string; departmentId: string; positions: number; employmentType?: string; experience?: string; budgetCtc?: number | null; location?: string; justification: string; description?: string; hiringManagerId?: string; recruiterId?: string; approvalRef?: string; workMode?: string; targetDate?: string }): Requisition {
  if (!input.title.trim()) throw new HttpError(400, 'Give the role a title.');
  if (!input.departmentId) throw new HttpError(400, 'Choose the department.');
  if (!Number.isFinite(input.positions) || input.positions < 1) throw new HttpError(400, 'How many people are you hiring?');
  if (input.justification.trim().length < 20) throw new HttpError(400, 'Write a line or two on why this role is needed.');
  const at = nowIso();
  if (input.id) {
    const existing = getRequisition(app, input.id);
    if (!existing) throw new HttpError(404, 'Requisition not found.');
    if (existing.status !== 'draft') throw new HttpError(400, 'Only a draft requisition can be edited. Close this one and raise a new one.');
    app.db.run(`UPDATE requisitions SET title = ?, department_id = ?, positions = ?, employment_type = ?, experience = ?, budget_ctc = ?, location = ?, justification = ?, description = ?, hiring_manager_id = ?, recruiter_id = ?, approval_ref = ?, work_mode = ?, target_date = ?, updated_at = ? WHERE id = ?`,
      [input.title.trim(), input.departmentId, input.positions, input.employmentType || 'full_time', input.experience || '', input.budgetCtc ?? null, input.location || '', input.justification.trim(), input.description || '', input.hiringManagerId || null, input.recruiterId || null, (input.approvalRef || '').trim(), input.workMode || 'office', input.targetDate || null, at, input.id]);
    audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: input.id, action: 'updated' });
    return getRequisition(app, input.id)!;
  }
  const id = app.db.nextId('REQ');
  app.db.run(`INSERT INTO requisitions (id, title, department_id, positions, employment_type, experience, budget_ctc, location, justification, description, status, workflow_version, hiring_manager_id, recruiter_id, created_by, created_at, updated_at, approval_ref, work_mode, target_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.title.trim(), input.departmentId, input.positions, input.employmentType || 'full_time', input.experience || '', input.budgetCtc ?? null, input.location || '', input.justification.trim(), input.description || '', WORKFLOW_VERSION, input.hiringManagerId || actor.id, input.recruiterId || actor.id, actor.id, at, at, (input.approvalRef || '').trim(), input.workMode || 'office', input.targetDate || null]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: id, action: 'created', after: { title: input.title } });
  return getRequisition(app, id)!;
}

/**
 * Headcount is approved outside LoyalFlow (a meeting, an email, a signed note). HR opens the vacancy here and records
 * where that approval can be found. There is no in-app approval gate.
 */
export function openRequisition(app: App, actor: Employee, id: string, approvalRef?: string): Requisition {
  const r = getRequisition(app, id);
  if (!r) throw new HttpError(404, 'Requisition not found.');
  if (r.status !== 'draft') throw new HttpError(400, 'Only a draft vacancy can be opened.');
  const ref = (approvalRef ?? r.approval_ref ?? '').trim();
  if (ref.length < 5) throw new HttpError(400, 'Record who approved this headcount and when (for example "Approved by COO, email of 3 Nov"). The approval itself happens outside LoyalFlow.');
  const at = nowIso();
  app.db.run("UPDATE requisitions SET status = 'open', approval_ref = ?, approved_by = ?, approved_at = ?, paused_at = NULL, updated_at = ? WHERE id = ?", [ref, actor.id, at, at, id]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: id, action: 'opened', after: { approvalRef: ref } });
  return getRequisition(app, id)!;
}

/** Kept so that approval tasks raised before v1.7 can still be decided without an error. They no longer change a vacancy. */
export function applyRequisitionDecision(_app: App, _actor: Employee, _id: string, _decision: 'approved' | 'declined'): void { /* approval moved outside the app */ }

export function pauseRequisition(app: App, actor: Employee, id: string, reason: string): Requisition {
  const r = getRequisition(app, id);
  if (!r) throw new HttpError(404, 'Requisition not found.');
  if (r.status !== 'open') throw new HttpError(400, 'Only an open vacancy can be paused.');
  if (reason.trim().length < 5) throw new HttpError(400, 'Say why the vacancy is being paused.');
  app.db.run("UPDATE requisitions SET status = 'paused', paused_at = ?, updated_at = ? WHERE id = ?", [nowIso(), nowIso(), id]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: id, action: 'paused', after: { reason: reason.trim() } });
  return getRequisition(app, id)!;
}
export function resumeRequisition(app: App, actor: Employee, id: string): Requisition {
  const r = getRequisition(app, id);
  if (!r) throw new HttpError(404, 'Requisition not found.');
  if (r.status !== 'paused') throw new HttpError(400, 'This vacancy is not paused.');
  app.db.run("UPDATE requisitions SET status = 'open', paused_at = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: id, action: 'resumed' });
  return getRequisition(app, id)!;
}

/**
 * Closing a vacancy asks what happens to the people still in play: 'keep' leaves their applications open for HR to finish,
 * 'close' closes each one with the vacancy's reason. People already in offer or onboarding are never closed this way.
 */
export function closeRequisition(app: App, actor: Employee, id: string, reason: string, applicants: 'keep' | 'close' = 'keep'): Requisition {
  const r = getRequisition(app, id);
  if (!r) throw new HttpError(404, 'Requisition not found.');
  const at = nowIso();
  app.db.run("UPDATE requisitions SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?", [at, at, id]);
  let closed = 0;
  if (applicants === 'close') {
    const rows = app.db.all<{ id: string; stage: string }>("SELECT id, stage FROM applications WHERE requisition_id = ? AND status IN ('active', 'on_hold') AND stage NOT IN ('offer', 'onboarding', 'hired')", [id]);
    for (const a of rows) {
      app.db.run("UPDATE applications SET status = 'closed', outcome = 'rejected', outcome_reason = ?, decision_by = ?, decision_at = ?, hold_reason = '', hold_until = NULL, updated_at = ? WHERE id = ?", [`Vacancy closed: ${reason}`, actor.id, at, at, a.id]);
      app.db.run("UPDATE interviews SET status = 'cancelled' WHERE application_id = ? AND status = 'scheduled'", [a.id]);
      logEvent(app, a.id, 'closed', `Vacancy closed: ${reason}`, actor.id, a.stage, null);
      closed++;
    }
  }
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: id, action: 'closed', after: { reason, applicants, closed } });
  return getRequisition(app, id)!;
}

// ---------- Candidates ----------

export function getCandidate(app: App, id: string): Candidate | undefined { return app.db.get<Candidate>('SELECT * FROM candidates WHERE id = ?', [id]); }

/** Candidates are people, not rows per job: the same person applying twice is the same record. */
export function findDuplicates(app: App, input: { email?: string; phone?: string; fullName?: string }): Candidate[] {
  const out = new Map<string, Candidate>();
  if (input.email) for (const c of app.db.all<Candidate>('SELECT * FROM candidates WHERE email_normalized = ?', [normalizeEmail(input.email)])) out.set(c.id, c);
  if (input.phone) { const digits = input.phone.replace(/\D/g, '').slice(-10); if (digits.length === 10) for (const c of app.db.all<Candidate>("SELECT * FROM candidates WHERE replace(replace(replace(phone, ' ', ''), '-', ''), '+', '') LIKE ?", [`%${digits}`])) out.set(c.id, c); }
  if (input.fullName && input.fullName.trim().length > 4) for (const c of app.db.all<Candidate>('SELECT * FROM candidates WHERE lower(full_name) = ?', [input.fullName.trim().toLowerCase()])) out.set(c.id, c);
  return [...out.values()];
}

export function saveCandidate(app: App, actor: Employee, input: { id?: string; fullName: string; email?: string; phone?: string; currentEmployer?: string; experienceYears?: number | null; currentCtc?: number | null; expectedCtc?: number | null; noticeDays?: number | null; location?: string; cvPath?: string; cvText?: string; notes?: string }): Candidate {
  if (!input.fullName.trim()) throw new HttpError(400, 'The candidate needs a name.');
  if (!input.email && !input.phone) throw new HttpError(400, 'Record at least an email or a phone number.');
  const at = nowIso();
  const fields = [input.fullName.trim(), input.email || '', normalizeEmail(input.email || ''), input.phone || '', input.currentEmployer || '',
    input.experienceYears ?? null, input.currentCtc ?? null, input.expectedCtc ?? null, input.noticeDays ?? null, input.location || '', input.notes || ''];
  if (input.id) {
    if (!getCandidate(app, input.id)) throw new HttpError(404, 'Candidate not found.');
    app.db.run('UPDATE candidates SET full_name = ?, email = ?, email_normalized = ?, phone = ?, current_employer = ?, experience_years = ?, current_ctc = ?, expected_ctc = ?, notice_days = ?, location = ?, notes = ?, updated_at = ? WHERE id = ?', [...fields, at, input.id]);
    if (input.cvPath) app.db.run('UPDATE candidates SET cv_path = ?, cv_text = ? WHERE id = ?', [input.cvPath, input.cvText || '', input.id]);
    audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: input.id, action: 'updated' });
    return getCandidate(app, input.id)!;
  }
  const id = app.db.nextId('CAN');
  app.db.run(`INSERT INTO candidates (id, full_name, email, email_normalized, phone, current_employer, experience_years, current_ctc, expected_ctc, notice_days, location, notes, cv_path, cv_text, consent_at, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, ...fields, input.cvPath || '', input.cvText || '', at, actor.id, at, at]);
  audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: id, action: 'created', after: { name: input.fullName } });
  return getCandidate(app, id)!;
}

// ---------- Applications ----------

const APP_SELECT = `SELECT a.*, c.full_name AS candidate_name, c.email AS candidate_email, c.phone AS candidate_phone,
  r.title AS requisition_title, r.department_id, o.full_name AS owner_name
  FROM applications a JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id LEFT JOIN employees o ON o.id = a.owner_id`;

export function getApplication(app: App, id: string): Application | undefined { return app.db.get<Application>(`${APP_SELECT} WHERE a.id = ?`, [id]); }
export function listApplications(app: App, f: { requisitionId?: string; candidateId?: string; stage?: string[]; status?: string; ownerId?: string; limit?: number } = {}): Application[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.requisitionId) { where.push('a.requisition_id = ?'); params.push(f.requisitionId); }
  if (f.candidateId) { where.push('a.candidate_id = ?'); params.push(f.candidateId); }
  if (f.ownerId) { where.push('a.owner_id = ?'); params.push(f.ownerId); }
  if (f.status) { where.push('a.status = ?'); params.push(f.status); }
  if (f.stage && f.stage.length) { where.push(`a.stage IN (${f.stage.map(() => '?').join(',')})`); params.push(...f.stage); }
  params.push(f.limit || 300);
  return app.db.all<Application>(`${APP_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.stage_since DESC LIMIT ?`, params);
}
export function applicationEvents(app: App, id: string) {
  return app.db.all<{ id: number; kind: string; text: string; from_stage: string | null; to_stage: string | null; actor_id: string | null; at: string; actor_name: string | null }>(
    'SELECT e.*, emp.full_name AS actor_name FROM application_events e LEFT JOIN employees emp ON emp.id = e.actor_id WHERE e.application_id = ? ORDER BY e.id DESC LIMIT 100', [id]);
}
function logEvent(app: App, id: string, kind: string, text: string, actorId: string | null, from?: string | null, to?: string | null): void {
  app.db.run('INSERT INTO application_events (application_id, kind, text, from_stage, to_stage, actor_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, kind, text, from ?? null, to ?? null, actorId, nowIso()]);
}

export function addApplication(app: App, actor: Employee, input: { candidateId: string; requisitionId: string; source?: string; ownerId?: string }): Application {
  const req = getRequisition(app, input.requisitionId);
  if (!req) throw new HttpError(404, 'Requisition not found.');
  if (req.status !== 'open') throw new HttpError(400, req.status === 'paused' ? 'That vacancy is paused. Resume it before adding people.' : req.status === 'draft' ? 'That vacancy is still a draft. Open it first.' : 'That vacancy is not open.');
  if (!getCandidate(app, input.candidateId)) throw new HttpError(404, 'Candidate not found.');
  if (app.db.get('SELECT id FROM applications WHERE candidate_id = ? AND requisition_id = ?', [input.candidateId, input.requisitionId])) throw new HttpError(400, 'This person is already on this role. Open the existing application instead of starting a second one.');
  const id = app.db.nextId('APP'); const at = nowIso();
  app.db.run(`INSERT INTO applications (id, candidate_id, requisition_id, source, received_at, owner_id, stage, stage_since, status, workflow_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, 'active', ?, ?, ?)`,
    [id, input.candidateId, input.requisitionId, input.source || 'direct', at, input.ownerId || req.recruiter_id || actor.id, at, req.workflow_version || WORKFLOW_VERSION, at, at]);
  logEvent(app, id, 'created', `Added to ${req.title} from ${input.source || 'direct'}`, actor.id, null, 'applied');
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'created' });
  return getApplication(app, id)!;
}

/** Move a stage forward or back. The workflow version the application started on is what governs it. */
export function moveStage(app: App, actor: Employee, id: string, to: Stage, note = ''): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (a.status === 'on_hold') throw new HttpError(400, 'This application is on hold. Resume it first.');
  if (a.status !== 'active') throw new HttpError(400, 'This application is closed.');
  if (!STAGES.includes(to)) throw new HttpError(400, 'Unknown stage.');
  if (to === 'hired') throw new HttpError(400, 'Someone becomes hired when their onboarding is completed, not by moving a card.');
  if (to === 'onboarding') throw new HttpError(400, 'Onboarding starts when an offer is accepted.');
  if (to === 'offer') throw new HttpError(400, 'Record the hiring decision first. A decision to hire moves the application to offer.');
  if (!MANUAL_STAGES.includes(a.stage)) throw new HttpError(400, `An application in ${STAGE_LABEL[a.stage]} cannot be moved by hand.`);
  if (a.stage === to) return a;
  const at = nowIso();
  app.db.run('UPDATE applications SET stage = ?, stage_since = ?, updated_at = ? WHERE id = ?', [to, at, at, id]);
  logEvent(app, id, 'stage', note || `${STAGE_LABEL[a.stage]} → ${STAGE_LABEL[to]}`, actor.id, a.stage, to);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'stage', before: { stage: a.stage }, after: { stage: to } });
  return getApplication(app, id)!;
}

function setStage(app: App, actorId: string | null, a: Application, to: Stage, text: string): void {
  const at = nowIso();
  app.db.run('UPDATE applications SET stage = ?, stage_since = ?, updated_at = ? WHERE id = ?', [to, at, at, a.id]);
  logEvent(app, a.id, 'stage', text, actorId, a.stage, to);
}

export function screeningNotes(app: App, actor: Employee, id: string, notes: string): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  app.db.run('UPDATE applications SET screening_notes = ?, updated_at = ? WHERE id = ?', [notes, nowIso(), id]);
  logEvent(app, id, 'note', notes.slice(0, 300), actor.id);
  return getApplication(app, id)!;
}

/** Closing an application always takes a named person and a reason. No score does it by itself. */
export const CLOSE_OUTCOMES = ['rejected', 'withdrawn', 'no_show'] as const;
export type CloseOutcome = typeof CLOSE_OUTCOMES[number];
export const OUTCOME_LABEL: Record<string, string> = { hired: 'Hired', rejected: 'Rejected', withdrawn: 'Withdrawn', no_show: 'No show', offer_declined: 'Offer declined', offer_expired: 'Offer expired', declined_offer: 'Offer declined' };

export function closeApplication(app: App, actor: Employee, id: string, outcome: CloseOutcome, reason: string): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (!CLOSE_OUTCOMES.includes(outcome)) throw new HttpError(400, 'Choose rejected, withdrawn or no show. To pause an application, put it on hold instead.');
  if (a.status === 'closed') throw new HttpError(400, 'This application is already closed.');
  if (reason.trim().length < 10) throw new HttpError(400, 'Write the reason. It is what the candidate is owed and what we learn from.');
  const at = nowIso();
  app.db.run("UPDATE applications SET status = 'closed', outcome = ?, outcome_reason = ?, decision_by = ?, decision_at = ?, hold_reason = '', hold_until = NULL, updated_at = ? WHERE id = ?", [outcome, reason.trim(), actor.id, at, at, id]);
  app.db.run("UPDATE interviews SET status = 'cancelled' WHERE application_id = ? AND status = 'scheduled'", [id]);
  app.db.run("UPDATE offers SET status = 'cancelled' WHERE application_id = ? AND status IN ('draft', 'issued', 'pending', 'approved')", [id]);
  logEvent(app, id, 'closed', `${OUTCOME_LABEL[outcome]}: ${reason.trim()}`, actor.id, a.stage, null);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'closed', after: { outcome, reason } });
  return getApplication(app, id)!;
}

/** A hold keeps the application open. It needs a reason and a date to look at it again, and shows in the HR follow-up list. */
export function holdApplication(app: App, actor: Employee, id: string, reason: string, until: string): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (a.status !== 'active') throw new HttpError(400, a.status === 'on_hold' ? 'This application is already on hold.' : 'This application is closed.');
  if (reason.trim().length < 5) throw new HttpError(400, 'Say why this is on hold.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new HttpError(400, 'Pick the date to look at this again.');
  app.db.run("UPDATE applications SET status = 'on_hold', hold_reason = ?, hold_until = ?, updated_at = ? WHERE id = ?", [reason.trim(), until, nowIso(), id]);
  logEvent(app, id, 'hold', `On hold until ${until}: ${reason.trim()}`, actor.id, a.stage, a.stage);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'hold', after: { reason, until } });
  return getApplication(app, id)!;
}
export function resumeApplication(app: App, actor: Employee, id: string): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (a.status !== 'on_hold') return a;
  app.db.run("UPDATE applications SET status = 'active', hold_reason = '', hold_until = NULL, updated_at = ? WHERE id = ?", [nowIso(), id]);
  logEvent(app, id, 'resumed', 'Taken off hold', actor.id, a.stage, a.stage);
  return getApplication(app, id)!;
}
/** Applications on hold, soonest follow-up first. `overdue` is true once the follow-up date has passed. */
export function holdQueue(app: App): (Application & { overdue: boolean })[] {
  const today = localDateString(new Date());
  return app.db.all<Application>(`${APP_SELECT} WHERE a.status = 'on_hold' ORDER BY a.hold_until ASC LIMIT 100`).map((a) => ({ ...a, overdue: !!a.hold_until && a.hold_until < today }));
}

/** Reopening is an HR action with a reason. Earlier history stays exactly as it was. */
export function reopenApplication(app: App, actor: Employee, id: string, reason: string): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR reopens an application.');
  if (a.status !== 'closed') return a;
  if (a.outcome === 'hired') throw new HttpError(400, 'A hired application cannot be reopened.');
  if (reason.trim().length < 5) throw new HttpError(400, 'Say why this is being reopened.');
  const back: Stage = MANUAL_STAGES.includes(a.stage) ? a.stage as Stage : 'decision';
  const at = nowIso();
  app.db.run("UPDATE applications SET status = 'active', outcome = '', outcome_reason = '', stage = ?, stage_since = ?, updated_at = ? WHERE id = ?", [back, at, at, id]);
  logEvent(app, id, 'reopened', `Reopened: ${reason.trim()}`, actor.id, a.stage, back);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'reopened', after: { reason } });
  return getApplication(app, id)!;
}

// ---------- Hiring decision ----------

export interface HiringDecision { id: number; application_id: string; outcome: string; rationale: string; evidence: string; decided_by: string | null; decided_at: string; decided_by_name?: string }
export function decisionsOf(app: App, applicationId: string): HiringDecision[] {
  return app.db.all<HiringDecision>('SELECT d.*, e.full_name AS decided_by_name FROM hiring_decisions d LEFT JOIN employees e ON e.id = d.decided_by WHERE d.application_id = ? ORDER BY d.id DESC', [applicationId]);
}
/**
 * The hiring decision is its own record: outcome, who decided, when, why, and which scorecards it rests on.
 * Hire moves the application to offer. Hold puts it on hold with a follow-up date. Reject closes it.
 */
export function recordDecision(app: App, actor: Employee, id: string, input: { outcome: 'hire' | 'hold' | 'reject'; rationale: string; holdUntil?: string }): Application {
  const a = getApplication(app, id);
  if (!a) throw new HttpError(404, 'Application not found.');
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'HR records the hiring decision.');
  if (a.status !== 'active') throw new HttpError(400, a.status === 'on_hold' ? 'This application is on hold. Resume it first.' : 'This application is closed.');
  if (!MANUAL_STAGES.includes(a.stage)) throw new HttpError(400, 'A decision has already been taken on this application.');
  if (!['hire', 'hold', 'reject'].includes(input.outcome)) throw new HttpError(400, 'Choose hire, hold or reject.');
  if (input.rationale.trim().length < 10) throw new HttpError(400, 'Write the reasons for the decision.');
  const cards = app.db.all<{ id: number; interviewer: string; recommendation: string; overall: number | null }>(
    `SELECT s.id, e.full_name AS interviewer, s.recommendation, s.overall FROM scorecards s JOIN interviews i ON i.id = s.interview_id LEFT JOIN employees e ON e.id = s.interviewer_id
     WHERE i.application_id = ? AND s.submitted_at IS NOT NULL`, [id]);
  if (input.outcome === 'hire' && !cards.length) throw new HttpError(400, 'Nobody has submitted a scorecard yet. Record the interview feedback before deciding to hire.');
  if (input.outcome === 'hold' && !/^\d{4}-\d{2}-\d{2}$/.test(input.holdUntil || '')) throw new HttpError(400, 'Pick the date to look at this again.');
  const at = nowIso();
  app.db.run('INSERT INTO hiring_decisions (application_id, outcome, rationale, evidence, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, input.outcome, input.rationale.trim(), JSON.stringify({ scorecards: cards }), actor.id, at]);
  logEvent(app, id, 'decision', `Decision: ${input.outcome} — ${input.rationale.trim().slice(0, 240)}`, actor.id, a.stage, a.stage);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: id, action: 'decision', after: { outcome: input.outcome } });
  if (input.outcome === 'hire') { setStage(app, actor.id, a, 'offer', 'Decision to hire — moved to offer'); app.db.run('UPDATE applications SET decision_by = ?, decision_at = ? WHERE id = ?', [actor.id, at, id]); }
  else if (input.outcome === 'hold') { if (a.stage !== 'decision') setStage(app, actor.id, a, 'decision', 'Moved to decision'); holdApplication(app, actor, id, input.rationale, input.holdUntil!); }
  else closeApplication(app, actor, id, 'rejected', input.rationale);
  return getApplication(app, id)!;
}

// ---------- Interviews ----------

export function getInterview(app: App, id: string): Interview | undefined {
  const i = app.db.get<Interview>(`SELECT i.*, c.full_name AS candidate_name, r.title AS requisition_title, a.stage AS application_stage
    FROM interviews i JOIN applications a ON a.id = i.application_id JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id WHERE i.id = ?`, [id]);
  if (i) i.panel = app.db.all<{ id: string; name: string }>('SELECT e.id, e.full_name AS name FROM interview_panel p JOIN employees e ON e.id = p.interviewer_id WHERE p.interview_id = ?', [id]);
  return i;
}
export function listInterviews(app: App, f: { applicationId?: string; interviewerId?: string; from?: string; to?: string; limit?: number } = {}): Interview[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.applicationId) { where.push('i.application_id = ?'); params.push(f.applicationId); }
  if (f.interviewerId) { where.push('EXISTS (SELECT 1 FROM interview_panel p WHERE p.interview_id = i.id AND p.interviewer_id = ?)'); params.push(f.interviewerId); }
  if (f.from) { where.push('i.starts_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('i.starts_at <= ?'); params.push(f.to); }
  params.push(f.limit || 100);
  const rows = app.db.all<Interview>(`SELECT i.*, c.full_name AS candidate_name, r.title AS requisition_title, a.stage AS application_stage
    FROM interviews i JOIN applications a ON a.id = i.application_id JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.starts_at LIMIT ?`, params);
  for (const i of rows) i.panel = app.db.all<{ id: string; name: string }>('SELECT e.id, e.full_name AS name FROM interview_panel p JOIN employees e ON e.id = p.interviewer_id WHERE p.interview_id = ?', [i.id]);
  return rows;
}

/** Interviewers already booked at that time, so nobody is double-booked by accident. */
export function panelConflicts(app: App, panel: string[], startsAt: string, endsAt: string, ignoreInterviewId?: string): { id: string; name: string; clashWith: string }[] {
  if (!panel.length) return [];
  const out: { id: string; name: string; clashWith: string }[] = [];
  for (const who of panel) {
    const clash = app.db.get<{ id: string; starts_at: string; candidate_name: string }>(
      `SELECT i.id, i.starts_at, c.full_name AS candidate_name FROM interviews i
       JOIN interview_panel p ON p.interview_id = i.id JOIN applications a ON a.id = i.application_id JOIN candidates c ON c.id = a.candidate_id
       WHERE p.interviewer_id = ? AND i.status = 'scheduled' AND i.id <> ? AND i.starts_at < ? AND i.ends_at > ?`,
      [who, ignoreInterviewId || '', endsAt, startsAt]);
    if (clash) out.push({ id: who, name: getEmployee(app.db, who)?.full_name || who, clashWith: `${clash.candidate_name} at ${fmtDateTime(clash.starts_at)}` });
  }
  return out;
}

export function scheduleInterview(app: App, actor: Employee, input: { applicationId: string; roundType: string; mode?: string; location?: string; startsAt: string; minutes: number; panel: string[]; force?: boolean }): Interview {
  const a = getApplication(app, input.applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (a.status !== 'active') throw new HttpError(400, 'This application is closed.');
  if (!input.panel.length) throw new HttpError(400, 'Put at least one interviewer on the panel.');
  const starts = new Date(input.startsAt);
  if (Number.isNaN(starts.getTime())) throw new HttpError(400, 'Pick a date and time.');
  // A past time is usually a typo, but HR sometimes records an interview that already happened: 'schedule anyway' covers both.
  if (starts.getTime() < Date.now() - 86_400_000 && !input.force) throw new HttpError(400, 'That time is in the past. Tick “schedule anyway” if you are recording an interview that already happened.');
  const ends = new Date(starts.getTime() + Math.max(15, input.minutes || 45) * 60_000);
  const conflicts = panelConflicts(app, input.panel, starts.toISOString(), ends.toISOString());
  if (conflicts.length && !input.force) throw new HttpError(409, `${conflicts.map((c) => `${c.name} is already with ${c.clashWith}`).join('; ')}. Pick another time, or schedule anyway.`);
  const round = (app.db.get<{ n: number }>('SELECT count(*) AS n FROM interviews WHERE application_id = ?', [input.applicationId])?.n || 0) + 1;
  const id = app.db.nextId('INT');
  app.db.transaction(() => {
    app.db.run(`INSERT INTO interviews (id, application_id, round, round_type, round_name, mode, location, starts_at, ends_at, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      [id, input.applicationId, round, input.roundType, (input.roundName || '').trim().slice(0, 60), input.mode || 'in_person', input.location || '', starts.toISOString(), ends.toISOString(), actor.id, nowIso()]);
    for (const who of input.panel) app.db.run('INSERT OR IGNORE INTO interview_panel (interview_id, interviewer_id) VALUES (?, ?)', [id, who]);
  });
  if (a.stage === 'applied' || a.stage === 'screening' || a.stage === 'assessment') moveStage(app, actor, a.id, 'interview', `Round ${round} scheduled`);
  logEvent(app, a.id, 'interview', `Round ${round} (${(input.roundName || '').trim() || input.roundType}) on ${fmtDateTime(starts)}`, actor.id);
  for (const who of input.panel) app.notify.send({ employeeId: who, title: `Interview: ${a.candidate_name} for ${a.requisition_title}`, body: `${fmtDateTime(starts)}${input.location ? ` · ${input.location}` : ''}. Your scorecard opens after the interview.`, link: `/hire/interview/${id}`, kind: 'info' });
  audit(app.db, { actorId: actor.id, entity: 'interview', entityId: id, action: 'scheduled', after: { startsAt: starts.toISOString(), panel: input.panel } });
  return getInterview(app, id)!;
}

export function rescheduleInterview(app: App, actor: Employee, id: string, startsAt: string, minutes: number, reason: string, force = false): Interview {
  const i = getInterview(app, id);
  if (!i) throw new HttpError(404, 'Interview not found.');
  if (i.status !== 'scheduled') throw new HttpError(400, 'That interview is not open.');
  if (reason.trim().length < 5) throw new HttpError(400, 'Say why it is moving — the candidate will be told.');
  const starts = new Date(startsAt);
  if (Number.isNaN(starts.getTime())) throw new HttpError(400, 'Pick a date and time.');
  const ends = new Date(starts.getTime() + Math.max(15, minutes || 45) * 60_000);
  const panel = (i.panel || []).map((p) => p.id);
  const conflicts = panelConflicts(app, panel, starts.toISOString(), ends.toISOString(), id);
  if (conflicts.length && !force) throw new HttpError(409, `${conflicts.map((c) => `${c.name} is already with ${c.clashWith}`).join('; ')}. Pick another time, or schedule anyway.`);
  app.db.run('UPDATE interviews SET previous_starts_at = starts_at, starts_at = ?, ends_at = ?, reschedule_reason = ?, candidate_informed = 0 WHERE id = ?', [starts.toISOString(), ends.toISOString(), reason.trim(), id]);
  logEvent(app, i.application_id, 'interview', `Round ${i.round} moved to ${fmtDateTime(starts)}: ${reason.trim()}`, actor.id);
  for (const who of panel) app.notify.send({ employeeId: who, title: `Interview moved: ${i.candidate_name}`, body: `Now ${fmtDateTime(starts)}. ${reason.trim()}`, link: `/hire/interview/${id}`, kind: 'warn' });
  return getInterview(app, id)!;
}

export function setInterviewStatus(app: App, actor: Employee, id: string, status: 'completed' | 'cancelled' | 'no_show', note = ''): Interview {
  const i = getInterview(app, id);
  if (!i) throw new HttpError(404, 'Interview not found.');
  app.db.run('UPDATE interviews SET status = ? WHERE id = ?', [status, id]);
  logEvent(app, i.application_id, 'interview', `Round ${i.round} ${status.replace('_', ' ')}${note ? `: ${note}` : ''}`, actor.id);
  if (status === 'completed') for (const p of i.panel || []) app.notify.send({ employeeId: p.id, title: `Scorecard due: ${i.candidate_name}`, body: 'Write it before you read anyone else’s.', link: `/hire/interview/${id}`, kind: 'warn' });
  return getInterview(app, id)!;
}

export function markCandidateInformed(app: App, actor: Employee, id: string): void {
  app.db.run('UPDATE interviews SET candidate_informed = 1 WHERE id = ?', [id]);
  const i = getInterview(app, id);
  if (i) logEvent(app, i.application_id, 'note', `Candidate confirmed for round ${i.round}`, actor.id);
}

// ---------- Scorecards ----------

export function scorecardsOf(app: App, interviewId: string): Scorecard[] {
  return app.db.all<Scorecard>('SELECT s.*, e.full_name AS interviewer_name FROM scorecards s JOIN employees e ON e.id = s.interviewer_id WHERE s.interview_id = ? ORDER BY e.full_name', [interviewId]);
}
export function myScorecard(app: App, interviewId: string, interviewerId: string): Scorecard | undefined {
  return app.db.get<Scorecard>('SELECT s.*, e.full_name AS interviewer_name FROM scorecards s JOIN employees e ON e.id = s.interviewer_id WHERE s.interview_id = ? AND s.interviewer_id = ?', [interviewId, interviewerId]);
}
export function onPanel(app: App, interviewId: string, employeeId: string): boolean {
  return !!app.db.get('SELECT 1 FROM interview_panel WHERE interview_id = ? AND interviewer_id = ?', [interviewId, employeeId]);
}
/**
 * Other people's scorecards stay hidden until everyone has submitted (or HR calibrates),
 * so the first opinion in the room does not become everybody's opinion.
 */
export function calibrated(app: App, interviewId: string): boolean {
  const i = getInterview(app, interviewId);
  if (i?.calibrated_at) return true;
  const panel = app.db.get<{ n: number }>('SELECT count(*) AS n FROM interview_panel WHERE interview_id = ?', [interviewId])?.n || 0;
  const submitted = app.db.get<{ n: number }>('SELECT count(*) AS n FROM scorecards WHERE interview_id = ? AND submitted_at IS NOT NULL', [interviewId])?.n || 0;
  return panel > 0 && submitted >= panel;
}
export function visibleScorecards(app: App, user: Employee, interviewId: string): { cards: Scorecard[]; hidden: number; calibrated: boolean } {
  const all = scorecardsOf(app, interviewId).filter((s) => s.submitted_at);
  if (calibrated(app, interviewId)) return { cards: all, hidden: 0, calibrated: true };
  const own = all.filter((s) => s.interviewer_id === user.id);
  return { cards: own, hidden: all.length - own.length, calibrated: false };
}

export function saveScorecard(app: App, actor: Employee, interviewId: string, input: { ratings: Record<string, number>; recommendation: string; notes: string; evidence: string; submit: boolean }): Scorecard {
  const i = getInterview(app, interviewId);
  if (!i) throw new HttpError(404, 'Interview not found.');
  if (!onPanel(app, interviewId, actor.id)) throw new HttpError(403, 'Only the panel writes scorecards for this interview.');
  const existing = myScorecard(app, interviewId, actor.id);
  if (existing?.submitted_at && !existing.reopened_at) throw new HttpError(400, 'Your scorecard is submitted. Ask HR to reopen it if you need to change it.');
  const values = SCORE_AREAS.map((a) => Number(input.ratings[a.key])).filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  if (input.submit) {
    if (values.length !== SCORE_AREAS.length) throw new HttpError(400, 'Rate every area from 1 to 5 before you submit.');
    if (!RECOMMENDATIONS.includes(input.recommendation as typeof RECOMMENDATIONS[number])) throw new HttpError(400, 'Say whether you would hire this person.');
    if (input.evidence.trim().length < 30) throw new HttpError(400, 'Write what they actually said or did. A rating without evidence is not useful to anyone.');
  }
  const overall = values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
  const at = nowIso();
  if (existing) {
    app.db.run('UPDATE scorecards SET ratings = ?, overall = ?, recommendation = ?, notes = ?, evidence = ?, submitted_at = ?, reopened_at = NULL, updated_at = ? WHERE id = ?',
      [JSON.stringify(input.ratings), overall, input.recommendation, input.notes, input.evidence, input.submit ? at : null, at, existing.id]);
  } else {
    app.db.run('INSERT INTO scorecards (interview_id, interviewer_id, ratings, overall, recommendation, notes, evidence, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [interviewId, actor.id, JSON.stringify(input.ratings), overall, input.recommendation, input.notes, input.evidence, input.submit ? at : null, at]);
  }
  if (input.submit) {
    logEvent(app, i.application_id, 'scorecard', `${actor.full_name}: ${RECOMMENDATION_LABEL[input.recommendation] || input.recommendation}${overall ? ` (${overall}/5)` : ''}`, actor.id);
    audit(app.db, { actorId: actor.id, entity: 'interview', entityId: interviewId, action: 'scorecard_submitted', after: { overall, recommendation: input.recommendation } });
  }
  return myScorecard(app, interviewId, actor.id)!;
}

export function reopenScorecard(app: App, actor: Employee, scorecardId: number, reason: string): void {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR can reopen a submitted scorecard.');
  app.db.run('UPDATE scorecards SET reopened_by = ?, reopened_at = ? WHERE id = ?', [actor.id, nowIso(), scorecardId]);
  audit(app.db, { actorId: actor.id, entity: 'scorecard', entityId: String(scorecardId), action: 'reopened', after: { reason } });
}

export function calibrate(app: App, actor: Employee, interviewId: string): void {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR can open the scorecards early.');
  app.db.run('UPDATE interviews SET calibrated_at = ? WHERE id = ?', [nowIso(), interviewId]);
  const i = getInterview(app, interviewId);
  if (i) logEvent(app, i.application_id, 'note', 'Scorecards opened for calibration', actor.id);
}

export function parseRatings(s: Scorecard | undefined): Record<string, number> { if (!s) return {}; try { return JSON.parse(s.ratings) as Record<string, number>; } catch { return {}; } }

// ---------- Offers ----------

export function getOffer(app: App, id: string): Offer | undefined {
  return app.db.get<Offer>(`SELECT o.*, c.full_name AS candidate_name, e.full_name AS issued_by_name FROM offers o
    JOIN applications a ON a.id = o.application_id JOIN candidates c ON c.id = a.candidate_id LEFT JOIN employees e ON e.id = o.issued_by WHERE o.id = ?`, [id]);
}
export function offersOf(app: App, applicationId: string): Offer[] {
  return app.db.all<Offer>('SELECT * FROM offers WHERE application_id = ? ORDER BY created_at DESC', [applicationId]);
}

export function draftOffer(app: App, actor: Employee, input: { applicationId: string; ctcAnnual: number; designation: string; joiningDate: string; expiryDate?: string; body?: string }): Offer {
  const a = getApplication(app, input.applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR drafts offers.');
  if (a.status !== 'active') throw new HttpError(400, 'This application is not active.');
  if (a.stage !== 'offer') throw new HttpError(400, 'Record the decision to hire first. An offer is drafted once the application is in the offer stage.');
  if (!(input.ctcAnnual > 0)) throw new HttpError(400, 'Enter the CTC.');
  if (!input.designation.trim()) throw new HttpError(400, 'Enter the designation.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.joiningDate)) throw new HttpError(400, 'Pick the joining date.');
  const req = getRequisition(app, a.requisition_id)!;
  if (req.budget_ctc && input.ctcAnnual > req.budget_ctc * 1.0001) {
    // Over budget is allowed, but it is recorded and the COO sees it on the approval.
    logEvent(app, a.id, 'note', `Offer drafted above the approved budget of ₹${Math.round(req.budget_ctc).toLocaleString('en-IN')}`, actor.id);
  }
  const id = app.db.nextId('OFF');
  app.db.run(`INSERT INTO offers (id, application_id, ctc_annual, designation, department_id, joining_date, expiry_date, status, body, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    [id, input.applicationId, input.ctcAnnual, input.designation.trim(), req.department_id, input.joiningDate, input.expiryDate || null, input.body || '', actor.id, nowIso()]);
  logEvent(app, a.id, 'offer', `Offer drafted: ${input.designation.trim()} at ₹${Math.round(input.ctcAnnual).toLocaleString('en-IN')}`, actor.id);
  audit(app.db, { actorId: actor.id, entity: 'offer', entityId: id, action: 'drafted' });
  return getOffer(app, id)!;
}

/** Kept so that approval tasks raised before v1.7 can still be decided without an error. They no longer change an offer. */
export function applyOfferDecision(_app: App, _actor: Employee, _offerId: string, _decision: 'approved' | 'declined'): void { /* approval moved outside the app */ }

/** Issuing is a deliberate act by a named HR person. Nothing is ever issued automatically. */
export function issueOffer(app: App, actor: Employee, id: string): Offer {
  const o = getOffer(app, id);
  if (!o) throw new HttpError(404, 'Offer not found.');
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR issues an offer.');
  if (!['draft', 'approved'].includes(o.status)) throw new HttpError(400, 'Only a draft offer can be issued.');
  const a = getApplication(app, o.application_id)!;
  if (a.status !== 'active') throw new HttpError(400, 'This application is not active.');
  if (a.stage !== 'offer') throw new HttpError(400, 'Record the decision to hire before issuing an offer.');
  if (app.db.get("SELECT id FROM offers WHERE application_id = ? AND status = 'issued' AND id <> ?", [o.application_id, id])) throw new HttpError(400, 'Another offer is already out for this application. Cancel it first.');
  app.db.run("UPDATE offers SET status = 'issued', issued_by = ?, issued_at = ? WHERE id = ?", [actor.id, nowIso(), id]);
  logEvent(app, o.application_id, 'offer', `Offer issued by ${actor.full_name}`, actor.id);
  audit(app.db, { actorId: actor.id, entity: 'offer', entityId: id, action: 'issued' });
  return getOffer(app, id)!;
}

export function cancelOffer(app: App, actor: Employee, id: string, reason: string): Offer {
  const o = getOffer(app, id);
  if (!o) throw new HttpError(404, 'Offer not found.');
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR cancels an offer.');
  if (!['draft', 'issued', 'pending', 'approved'].includes(o.status)) throw new HttpError(400, 'That offer is already final.');
  app.db.run("UPDATE offers SET status = 'cancelled', responded_at = ?, response_note = ? WHERE id = ?", [nowIso(), reason || 'Cancelled', id]);
  logEvent(app, o.application_id, 'offer', `Offer cancelled: ${reason || 'no reason given'}`, actor.id);
  audit(app.db, { actorId: actor.id, entity: 'offer', entityId: id, action: 'cancelled' });
  return getOffer(app, id)!;
}

/** Mark issued offers whose expiry date has passed. The application closes as "offer expired"; HR can reopen it. */
export function expireOffers(app: App): number {
  const today = localDateString(new Date());
  const rows = app.db.all<{ id: string; application_id: string }>("SELECT id, application_id FROM offers WHERE status = 'issued' AND expiry_date IS NOT NULL AND expiry_date <> '' AND expiry_date < ?", [today]);
  for (const o of rows) {
    const at = nowIso();
    app.db.run("UPDATE offers SET status = 'expired', responded_at = ? WHERE id = ?", [at, o.id]);
    const a = getApplication(app, o.application_id);
    if (a && a.status !== 'closed') {
      app.db.run("UPDATE applications SET status = 'closed', outcome = 'offer_expired', outcome_reason = 'The offer passed its expiry date without a reply', decision_at = ?, updated_at = ? WHERE id = ?", [at, at, a.id]);
      logEvent(app, a.id, 'offer', 'Offer expired without a reply', null, a.stage, null);
    }
  }
  return rows.length;
}

export function recordOfferResponse(app: App, actor: Employee, id: string, response: 'accepted' | 'declined', note: string): { offer: Offer; employeeId?: string } {
  const o = getOffer(app, id);
  if (!o) throw new HttpError(404, 'Offer not found.');
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR records an offer response.');
  if (o.status !== 'issued') throw new HttpError(400, 'That offer has not been issued.');
  const at = nowIso();
  app.db.run('UPDATE offers SET status = ?, responded_at = ?, response_note = ? WHERE id = ?', [response, at, note, id]);
  const a = getApplication(app, o.application_id)!;
  if (response === 'accepted') {
    setStage(app, actor.id, a, 'onboarding', 'Offer accepted — onboarding started');
    startOnboarding(app, actor, a, o);
    const req = getRequisition(app, a.requisition_id)!;
    const filled = app.db.get<{ n: number }>("SELECT count(*) AS n FROM applications WHERE requisition_id = ? AND stage IN ('onboarding', 'hired') AND (status = 'active' OR outcome = 'hired')", [req.id])?.n || 0;
    if (filled >= req.positions && req.status !== 'closed') closeRequisition(app, actor, req.id, 'All positions filled', 'keep');
  } else {
    app.db.run("UPDATE applications SET status = 'closed', outcome = 'offer_declined', outcome_reason = ?, decision_by = ?, decision_at = ?, updated_at = ? WHERE id = ?", [note || 'Candidate declined', actor.id, at, at, o.application_id]);
    logEvent(app, o.application_id, 'offer', `Offer declined: ${note}`, actor.id, a.stage, null);
  }
  audit(app.db, { actorId: actor.id, entity: 'offer', entityId: id, action: response });
  return { offer: getOffer(app, id)! };
}

// ---------- Onboarding handover ----------

/** Turn an accepted offer into an employee record and start the HR onboarding SOP. */
export function onboardFromOffer(app: App, actor: Employee, offerId: string, input: { employeeId: string; email: string; reportingManagerId: string; shiftCode?: string; siteId?: string }): { employeeId: string } {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR can create the employee record.');
  const o = getOffer(app, offerId);
  if (!o || o.status !== 'accepted') throw new HttpError(400, 'Only an accepted offer can be onboarded.');
  if (app.db.get('SELECT id FROM onboardings WHERE offer_id = ? AND employee_id IS NOT NULL', [offerId])) throw new HttpError(400, 'The employee record for this offer already exists.');
  const a = getApplication(app, o.application_id)!;
  const cand = getCandidate(app, a.candidate_id)!;
  if (!input.employeeId.trim()) throw new HttpError(400, 'Give the new joiner an employee ID.');
  if (app.db.get('SELECT id FROM employees WHERE id = ?', [input.employeeId.trim()])) throw new HttpError(400, 'That employee ID is already taken.');
  if (!/^[^@\s]+@[^@\s]+$/.test(input.email)) throw new HttpError(400, 'Enter the work email.');
  if (app.db.get('SELECT id FROM employees WHERE lower(email) = ?', [input.email.trim().toLowerCase()])) throw new HttpError(400, 'That work email is already in use.');
  const site = input.siteId || app.db.get<{ id: string }>('SELECT id FROM sites ORDER BY id LIMIT 1')?.id || null;
  if (site && !app.db.get('SELECT id FROM sites WHERE id = ?', [site])) throw new HttpError(400, `There is no site called "${site}". Check Settings → Sites.`);
  if (!input.reportingManagerId || !app.db.get('SELECT id FROM employees WHERE id = ?', [input.reportingManagerId])) throw new HttpError(400, 'Choose the reporting manager.');
  const shift = input.shiftCode || getSetting(app.db, 'shifts')[0]?.code || 'GEN';
  const at = nowIso();
  app.db.run(`INSERT INTO employees (id, full_name, email, designation, department_id, sub_team, site_id, functional_role, reporting_manager_id, shift_code, join_date, employment_type, status, lang, is_admin, mobile, pagarguru_code, must_change_password, failed_logins, created_at, updated_at, hired_from_candidate)
    VALUES (?, ?, ?, ?, ?, '', ?, 'ic', ?, ?, ?, 'probation', 'active', 'en', 0, ?, '', 1, 0, ?, ?, ?)`,
    [input.employeeId.trim(), cand.full_name, input.email.trim().toLowerCase(), o.designation, o.department_id, site, input.reportingManagerId, shift, o.joining_date || localDateString(new Date()), cand.phone, at, at, cand.id]);
  logEvent(app, o.application_id, 'note', `Employee record ${input.employeeId.trim()} created`, actor.id);
  const ob = onboardingOf(app, o.application_id) || startOnboarding(app, actor, a, o);
  app.db.run('UPDATE onboardings SET employee_id = ? WHERE id = ?', [input.employeeId.trim(), ob.id]);
  app.db.run("UPDATE onboarding_items SET done_at = ?, done_by = ? WHERE onboarding_id = ? AND key = 'employee_record' AND done_at IS NULL", [at, actor.id, ob.id]);
  refreshOnboardingStatus(app, ob.id);
  audit(app.db, { actorId: actor.id, entity: 'employee', entityId: input.employeeId.trim(), action: 'onboarded', after: { fromCandidate: cand.id, offer: offerId } });
  const sop = app.db.get<{ id: string }>("SELECT id FROM sop_definitions WHERE id = 'SOP-HR-ONBOARD' OR lower(name) LIKE '%onboard%' LIMIT 1");
  createTask(app, actor, {
    kind: 'task', type: 'general', title: `Onboard ${cand.full_name} (${input.employeeId.trim()})`,
    details: `Joining ${o.joining_date}. ${sop ? `Run ${sop.id}.` : 'Laptop, email, PF and ESI enrolment, induction.'} Set the salary structure in Payroll before the first payroll run.`,
    assigneeId: actor.id, requesterId: actor.id, link: '/people', dueAt: o.joining_date ? `${o.joining_date}T03:30:00.000Z` : null
  });
  return { employeeId: input.employeeId.trim() };
}

// ---------- Onboarding checklist ----------

export interface Onboarding { id: number; application_id: string; offer_id: string | null; employee_id: string | null; status: string; created_at: string; completed_at: string | null; completed_by: string | null }
export interface OnboardingItem { id: number; onboarding_id: number; key: string; label: string; gate: number; position: number; owner_id: string | null; due_date: string | null; done_at: string | null; done_by: string | null; owner_name?: string; done_by_name?: string }

/** The checklist every new joiner gets. The three `gate` items must be done before onboarding can be completed. */
export const ONBOARDING_TEMPLATE: { key: string; label: string; gate: boolean; dueDays: number }[] = [
  { key: 'documents', label: 'Joining documents collected (ID, address, bank, education)', gate: false, dueDays: 0 },
  { key: 'employee_record', label: 'Employee record created in LoyalFlow', gate: true, dueDays: 0 },
  { key: 'it_setup', label: 'Laptop, email and system access ready', gate: false, dueDays: 1 },
  { key: 'statutory', label: 'PF and ESI enrolment, salary structure set in Payroll', gate: false, dueDays: 7 },
  { key: 'induction', label: 'Induction done: team, manager, SOPs, house rules', gate: false, dueDays: 3 },
  { key: 'training_done', label: 'Training completed', gate: true, dueDays: 21 },
  { key: 'training_assessment', label: 'Training assessment started', gate: true, dueDays: 21 }
];

const ONBOARDING_GATES = ONBOARDING_TEMPLATE.filter((t) => t.gate).map((t) => t.key);
listDef('hire.onboarding').keep = ONBOARDING_GATES;
setDefaults('hire.onboarding', ONBOARDING_TEMPLATE.map((t) => ({ value: t.key, label: t.label, n: t.dueDays, active: true })));
onList('hire.onboarding', (items) => { ONBOARDING_TEMPLATE.length = 0; ONBOARDING_TEMPLATE.push(...items.filter((i) => i.active).map((i) => ({ key: i.value, label: i.label, gate: ONBOARDING_GATES.includes(i.value), dueDays: i.n ?? 0 }))); });

export function onboardingOf(app: App, applicationId: string): Onboarding | undefined {
  return app.db.get<Onboarding>('SELECT * FROM onboardings WHERE application_id = ? ORDER BY id DESC LIMIT 1', [applicationId]);
}
export function onboardingItems(app: App, onboardingId: number): OnboardingItem[] {
  return app.db.all<OnboardingItem>(`SELECT i.*, o.full_name AS owner_name, d.full_name AS done_by_name FROM onboarding_items i
    LEFT JOIN employees o ON o.id = i.owner_id LEFT JOIN employees d ON d.id = i.done_by WHERE i.onboarding_id = ? ORDER BY i.position`, [onboardingId]);
}
export function startOnboarding(app: App, actor: Employee, a: Application, o: Offer): Onboarding {
  const existing = onboardingOf(app, a.id);
  if (existing) return existing;
  const at = nowIso();
  const res = app.db.run("INSERT INTO onboardings (application_id, offer_id, status, created_at) VALUES (?, ?, 'not_started', ?)", [a.id, o.id, at]);
  const id = Number(res.lastInsertRowid);
  const base = o.joining_date && /^\d{4}-\d{2}-\d{2}$/.test(o.joining_date) ? new Date(`${o.joining_date}T00:00:00Z`) : new Date();
  ONBOARDING_TEMPLATE.forEach((t, i) => {
    const due = new Date(base.getTime() + t.dueDays * 86_400_000).toISOString().slice(0, 10);
    app.db.run('INSERT INTO onboarding_items (onboarding_id, key, label, gate, position, owner_id, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, t.key, t.label, t.gate ? 1 : 0, i, actor.id, due]);
  });
  logEvent(app, a.id, 'onboarding', 'Onboarding checklist created', actor.id);
  return onboardingOf(app, a.id)!;
}
function refreshOnboardingStatus(app: App, onboardingId: number): void {
  const ob = app.db.get<Onboarding>('SELECT * FROM onboardings WHERE id = ?', [onboardingId]);
  if (!ob || ob.status === 'complete') return;
  const done = app.db.get<{ n: number }>('SELECT count(*) AS n FROM onboarding_items WHERE onboarding_id = ? AND done_at IS NOT NULL', [onboardingId])?.n || 0;
  app.db.run('UPDATE onboardings SET status = ? WHERE id = ?', [done ? 'in_progress' : 'not_started', onboardingId]);
}
export function setOnboardingItem(app: App, actor: Employee, itemId: number, done: boolean): OnboardingItem {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'HR owns the onboarding checklist.');
  const it = app.db.get<OnboardingItem>('SELECT * FROM onboarding_items WHERE id = ?', [itemId]);
  if (!it) throw new HttpError(404, 'Checklist item not found.');
  const ob = app.db.get<Onboarding>('SELECT * FROM onboardings WHERE id = ?', [it.onboarding_id])!;
  if (ob.status === 'complete') throw new HttpError(400, 'This onboarding is complete.');
  if (it.key === 'employee_record') throw new HttpError(400, 'This item is ticked when you create the employee record.');
  app.db.run('UPDATE onboarding_items SET done_at = ?, done_by = ? WHERE id = ?', [done ? nowIso() : null, done ? actor.id : null, itemId]);
  logEvent(app, ob.application_id, 'onboarding', `${done ? 'Done' : 'Reopened'}: ${it.label}`, actor.id);
  refreshOnboardingStatus(app, ob.id);
  return app.db.get<OnboardingItem>('SELECT * FROM onboarding_items WHERE id = ?', [itemId])!;
}
/**
 * Onboarding completes, and the application becomes Hired, only when the employee record exists, training is completed
 * and the training assessment has been started.
 */
export function completeOnboarding(app: App, actor: Employee, applicationId: string): Application {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'HR completes onboarding.');
  const a = getApplication(app, applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  const ob = onboardingOf(app, applicationId);
  if (!ob) throw new HttpError(400, 'There is no onboarding for this application.');
  if (ob.status === 'complete') return a;
  const missing = onboardingItems(app, ob.id).filter((i) => i.gate === 1 && !i.done_at);
  if (missing.length) throw new HttpError(400, `Onboarding cannot be completed yet. Still open: ${missing.map((m) => m.label).join('; ')}.`);
  const at = nowIso();
  app.db.run("UPDATE onboardings SET status = 'complete', completed_at = ?, completed_by = ? WHERE id = ?", [at, actor.id, ob.id]);
  app.db.run("UPDATE applications SET stage = 'hired', stage_since = ?, status = 'closed', outcome = 'hired', outcome_reason = 'Onboarding completed', decision_at = ?, updated_at = ? WHERE id = ?", [at, at, at, applicationId]);
  logEvent(app, applicationId, 'onboarding', 'Onboarding completed — hired', actor.id, a.stage, 'hired');
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: applicationId, action: 'hired' });
  return getApplication(app, applicationId)!;
}
/** Applications currently in onboarding, with how far the checklist has got. */
export function onboardingQueue(app: App): (Application & { done: number; total: number; gatesOpen: number })[] {
  return app.db.all<Application>(`${APP_SELECT} WHERE a.stage = 'onboarding' AND a.status = 'active' ORDER BY a.stage_since ASC LIMIT 100`).map((a) => {
    const ob = onboardingOf(app, a.id); const items = ob ? onboardingItems(app, ob.id) : [];
    return { ...a, done: items.filter((i) => i.done_at).length, total: items.length, gatesOpen: items.filter((i) => i.gate === 1 && !i.done_at).length };
  });
}

// ---------- Dashboard ----------

export interface PipelineCounts { stage: string; label: string; n: number }
export function pipelineCounts(app: App, requisitionId?: string): PipelineCounts[] {
  const rows = app.db.all<{ stage: string; n: number }>(
    `SELECT stage, count(*) AS n FROM applications WHERE status = 'active' ${requisitionId ? 'AND requisition_id = ?' : ''} GROUP BY stage`, requisitionId ? [requisitionId] : []);
  return STAGES.filter((s) => s !== 'hired').map((s) => ({ stage: s, label: STAGE_LABEL[s], n: rows.find((r) => r.stage === s)?.n || 0 }));
}
export function hiringStats(app: App): { openRoles: number; positions: number; activeCandidates: number; interviewsThisWeek: number; offersOut: number; hiredThisQuarter: number } {
  const week = new Date(Date.now() + 7 * 86_400_000).toISOString();
  return {
    openRoles: app.db.get<{ n: number }>("SELECT count(*) AS n FROM requisitions WHERE status = 'open'")?.n || 0,
    positions: app.db.get<{ n: number }>("SELECT COALESCE(sum(positions), 0) AS n FROM requisitions WHERE status = 'open'")?.n || 0,
    activeCandidates: app.db.get<{ n: number }>("SELECT count(*) AS n FROM applications WHERE status IN ('active', 'on_hold')")?.n || 0,
    interviewsThisWeek: app.db.get<{ n: number }>("SELECT count(*) AS n FROM interviews WHERE status = 'scheduled' AND starts_at <= ?", [week])?.n || 0,
    offersOut: app.db.get<{ n: number }>("SELECT count(*) AS n FROM offers WHERE status = 'issued'")?.n || 0,
    hiredThisQuarter: app.db.get<{ n: number }>("SELECT count(*) AS n FROM applications WHERE outcome = 'hired' AND decision_at >= ?", [new Date(Date.now() - 90 * 86_400_000).toISOString()])?.n || 0
  };
}
void listEmployees;
