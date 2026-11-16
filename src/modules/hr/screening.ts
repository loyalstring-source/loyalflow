// Screening questions with point-wise review, and the interview plan for a vacancy.
// Both are aids to HR. A screening total never rejects anybody, and the interview plan never blocks a different route.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import type { Employee } from '../people/model.ts';
import { getApplication, getRequisition, isRecruiter, requireSeeApplication, listInterviews, type Requisition, type Interview } from './recruiting.ts';

const nowIso = () => new Date().toISOString();

// ---------- Screening questions ----------

export interface ScreeningQuestion { id: string; text: string; guidance: string; maxPoints: number; mustHave: boolean }
export interface ScreeningSet { id: number; requisition_id: string | null; version: number; questions: ScreeningQuestion[]; created_at: string; created_by: string | null }
export interface ScreeningAnswer { points: number; note: string }
export interface ScreeningReview { id: number; application_id: string; set_id: number; answers: Record<string, ScreeningAnswer>; total: number; max_total: number; must_missed: number; reviewed_by: string | null; reviewed_at: string; reviewed_by_name?: string }

/** The starting set, written for Loyal String. HR edits it under Hiring → Screening questions. */
export const DEFAULT_QUESTIONS: ScreeningQuestion[] = [
  { id: 'q1', text: 'Tell me about your current role. What do you do in a normal week?', guidance: 'Full points if the work clearly matches this vacancy. Half if it is related. None if it is a different kind of work.', maxPoints: 5, mustHave: true },
  { id: 'q2', text: 'Which of the must-have skills for this role have you used in the last year, and where?', guidance: 'Look for a real example with their own part in it, not a list of words from the job description.', maxPoints: 5, mustHave: true },
  { id: 'q3', text: 'Why are you looking for a change, and why this role?', guidance: 'A clear, honest reason and some knowledge of what we do. Be careful with people who only talk about salary or blame every past employer.', maxPoints: 3, mustHave: false },
  { id: 'q4', text: 'What is your current salary and what are you expecting?', guidance: 'Full points if the expectation is inside the approved budget. One point if it is up to 10% above. None beyond that.', maxPoints: 3, mustHave: true },
  { id: 'q5', text: 'What is your notice period? When could you join?', guidance: 'Full points for 30 days or less, or a buy-out they have confirmed. One point for 31 to 60 days.', maxPoints: 3, mustHave: false },
  { id: 'q6', text: 'This role is based at our office with the stated timings (and travel, if the role has it). Does that work for you?', guidance: 'A plain yes. Any hesitation about location, timings or travel is worth writing down.', maxPoints: 3, mustHave: true },
  { id: 'q7', text: 'How long were you in each of your last two jobs, and why did you leave?', guidance: 'Full points for steady tenure with sensible reasons. Fewer for several moves of under a year without a good reason.', maxPoints: 3, mustHave: false },
  { id: 'q8', text: 'What do you know about jewellery retail, RFID, or ERP software for retailers?', guidance: 'Domain knowledge is a bonus, not a must. Give credit for curiosity and for having looked us up.', maxPoints: 3, mustHave: false },
  { id: 'q9', text: 'How clearly did the candidate speak and listen during this call?', guidance: 'Your own rating of the conversation: clear answers, listened to the question, polite. This is not an English test.', maxPoints: 5, mustHave: false }
];

function parseSet(row: { id: number; requisition_id: string | null; version: number; questions: string; created_at: string; created_by: string | null }): ScreeningSet {
  let questions: ScreeningQuestion[] = []; try { questions = JSON.parse(row.questions) as ScreeningQuestion[]; } catch { /* empty */ }
  return { ...row, questions };
}

/** The company default set, created from DEFAULT_QUESTIONS the first time it is needed. */
export function defaultSet(app: App): ScreeningSet {
  const row = app.db.get<Parameters<typeof parseSet>[0]>('SELECT * FROM screening_sets WHERE requisition_id IS NULL AND active = 1 ORDER BY version DESC LIMIT 1');
  if (row) return parseSet(row);
  app.db.run('INSERT INTO screening_sets (requisition_id, version, questions, active, created_at) VALUES (NULL, 1, ?, 1, ?)', [JSON.stringify(DEFAULT_QUESTIONS), nowIso()]);
  return defaultSet(app);
}
/** The set in force for a vacancy: its own if it has one, otherwise the company default. */
export function setFor(app: App, requisitionId: string): ScreeningSet & { own: boolean } {
  const row = app.db.get<Parameters<typeof parseSet>[0]>('SELECT * FROM screening_sets WHERE requisition_id = ? AND active = 1 ORDER BY version DESC LIMIT 1', [requisitionId]);
  return row ? { ...parseSet(row), own: true } : { ...defaultSet(app), own: false };
}
export function getSet(app: App, id: number): ScreeningSet | undefined {
  const row = app.db.get<Parameters<typeof parseSet>[0]>('SELECT * FROM screening_sets WHERE id = ?', [id]);
  return row ? parseSet(row) : undefined;
}

/**
 * Saving questions always makes a new version and retires the old one. Applications already screened keep pointing at
 * the version they were scored on, so their points still mean what they meant.
 */
export function saveSet(app: App, actor: Employee, requisitionId: string | null, input: { id?: string; text: string; guidance?: string; maxPoints: number; mustHave?: boolean }[]): ScreeningSet {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR edits screening questions.');
  if (requisitionId && !getRequisition(app, requisitionId)) throw new HttpError(404, 'Vacancy not found.');
  const questions: ScreeningQuestion[] = [];
  const used = new Set<string>();
  // An id is never given to a different question later, even after the original is removed.
  let highest = 0;
  for (const row of app.db.all<{ questions: string }>(`SELECT questions FROM screening_sets WHERE requisition_id ${requisitionId ? '= ?' : 'IS NULL'}`, requisitionId ? [requisitionId] : []))
    try { for (const q of JSON.parse(row.questions) as ScreeningQuestion[]) highest = Math.max(highest, Number(q.id.slice(1)) || 0); } catch { /* skip */ }
  for (const q of input) highest = Math.max(highest, Number((q.id || '').slice(1)) || 0);
  for (const q of input) {
    const text = (q.text || '').trim();
    if (!text) continue;
    const max = Math.round(Number(q.maxPoints));
    if (!(max >= 1 && max <= 10)) throw new HttpError(400, `Give "${text.slice(0, 40)}" between 1 and 10 points.`);
    let id = q.id && /^q\d+$/.test(q.id) && !used.has(q.id) ? q.id : '';
    if (!id) { highest++; id = `q${highest}`; }
    used.add(id);
    questions.push({ id, text: text.slice(0, 400), guidance: (q.guidance || '').trim().slice(0, 600), maxPoints: max, mustHave: !!q.mustHave });
  }
  if (!questions.length) throw new HttpError(400, 'Keep at least one question.');
  if (questions.length > 25) throw new HttpError(400, 'Keep the set to 25 questions or fewer. A screening call should take about fifteen minutes.');
  const prev = app.db.get<{ v: number }>(`SELECT max(version) AS v FROM screening_sets WHERE requisition_id ${requisitionId ? '= ?' : 'IS NULL'}`, requisitionId ? [requisitionId] : [])?.v || 0;
  app.db.run(`UPDATE screening_sets SET active = 0 WHERE requisition_id ${requisitionId ? '= ?' : 'IS NULL'}`, requisitionId ? [requisitionId] : []);
  const res = app.db.run('INSERT INTO screening_sets (requisition_id, version, questions, active, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?)', [requisitionId, prev + 1, JSON.stringify(questions), actor.id, nowIso()]);
  audit(app.db, { actorId: actor.id, entity: 'screening_set', entityId: String(res.lastInsertRowid), action: 'saved', after: { requisitionId, version: prev + 1, questions: questions.length } });
  return getSet(app, Number(res.lastInsertRowid))!;
}
/** A vacancy goes back to using the company default. */
export function dropOwnSet(app: App, actor: Employee, requisitionId: string): void {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR edits screening questions.');
  app.db.run('UPDATE screening_sets SET active = 0 WHERE requisition_id = ?', [requisitionId]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: requisitionId, action: 'screening_default' });
}

export function reviewOf(app: App, applicationId: string): (ScreeningReview & { set: ScreeningSet }) | undefined {
  const row = app.db.get<Omit<ScreeningReview, 'answers'> & { answers: string }>('SELECT r.*, e.full_name AS reviewed_by_name FROM screening_reviews r LEFT JOIN employees e ON e.id = r.reviewed_by WHERE r.application_id = ?', [applicationId]);
  if (!row) return undefined;
  let answers: Record<string, ScreeningAnswer> = {}; try { answers = JSON.parse(row.answers) as Record<string, ScreeningAnswer>; } catch { /* empty */ }
  return { ...row, answers, set: getSet(app, row.set_id)! };
}

/** What the screening form should show: the saved review on the version it was scored with, or the set now in force. */
export function screeningFor(app: App, applicationId: string): { set: ScreeningSet; review: ScreeningReview | undefined; newerSetAvailable: boolean } {
  const a = getApplication(app, applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  const current = setFor(app, a.requisition_id);
  const review = reviewOf(app, applicationId);
  return review ? { set: review.set, review, newerSetAvailable: review.set_id !== current.id } : { set: current, review: undefined, newerSetAvailable: false };
}

export function saveScreening(app: App, actor: Employee, applicationId: string, input: Record<string, { points: unknown; note?: unknown }>, opts: { useLatest?: boolean } = {}): ScreeningReview {
  const a = getApplication(app, applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  requireSeeApplication(app, actor, a);
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'HR records the screening.');
  if (a.status === 'closed') throw new HttpError(400, 'This application is closed.');
  const existing = reviewOf(app, applicationId);
  const set = existing && !opts.useLatest ? existing.set : setFor(app, a.requisition_id);
  const answers: Record<string, ScreeningAnswer> = {};
  let total = 0, max = 0, missed = 0;
  for (const q of set.questions) {
    const raw = input[q.id];
    if (!raw || raw.points === '' || raw.points == null) throw new HttpError(400, `Give points for: ${q.text.slice(0, 60)}`);
    const points = Number(raw.points);
    if (!Number.isInteger(points) || points < 0 || points > q.maxPoints) throw new HttpError(400, `Points for "${q.text.slice(0, 40)}" must be from 0 to ${q.maxPoints}.`);
    answers[q.id] = { points, note: String(raw.note ?? '').trim().slice(0, 600) };
    total += points; max += q.maxPoints;
    // A must-have counts as missed when it scores less than half its points. It is shown, never acted on automatically.
    if (q.mustHave && points * 2 < q.maxPoints) missed++;
  }
  const at = nowIso();
  app.db.run(`INSERT INTO screening_reviews (application_id, set_id, answers, total, max_total, must_missed, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(application_id) DO UPDATE SET set_id = excluded.set_id, answers = excluded.answers, total = excluded.total, max_total = excluded.max_total, must_missed = excluded.must_missed, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`,
    [applicationId, set.id, JSON.stringify(answers), total, max, missed, actor.id, at]);
  app.db.run('INSERT INTO application_events (application_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [applicationId, 'screening', `Screening scored ${total} of ${max}${missed ? ` · ${missed} must-have${missed > 1 ? 's' : ''} missed` : ''}`, actor.id, at]);
  audit(app.db, { actorId: actor.id, entity: 'application', entityId: applicationId, action: 'screened', after: { total, max, missed } });
  return reviewOf(app, applicationId)!;
}

/** Screening totals for every application of a vacancy, for the pipeline view. */
export function screeningTotals(app: App, requisitionId: string): Map<string, { total: number; max: number; missed: number }> {
  const out = new Map<string, { total: number; max: number; missed: number }>();
  for (const r of app.db.all<{ application_id: string; total: number; max_total: number; must_missed: number }>('SELECT r.application_id, r.total, r.max_total, r.must_missed FROM screening_reviews r JOIN applications a ON a.id = r.application_id WHERE a.requisition_id = ?', [requisitionId]))
    out.set(r.application_id, { total: r.total, max: r.max_total, missed: r.must_missed });
  return out;
}

// ---------- Interview plan ----------

export interface PlanStep { name: string; interviewerId: string; interviewerName?: string }
export interface PlanTrackStep extends PlanStep { round: number; state: 'done' | 'scheduled' | 'next' | 'later'; interview?: Interview; proceed?: boolean | null }

const findBy = (app: App, like: string[]): string => {
  for (const l of like) { const e = app.db.get<{ id: string }>("SELECT id FROM employees WHERE status = 'active' AND lower(designation) LIKE ? ORDER BY id LIMIT 1", [l]); if (e) return e.id; }
  return '';
};
/** HR, the team's manager, the COO, the CEO — the usual order at Loyal String. Every vacancy can change it freely. */
export function defaultPlan(app: App, req: Requisition): PlanStep[] {
  const steps: PlanStep[] = [
    { name: 'HR round', interviewerId: req.recruiter_id || '' },
    { name: 'Team manager round', interviewerId: req.hiring_manager_id || '' },
    { name: 'COO round', interviewerId: findBy(app, ['%chief operating%', 'coo%', '% coo%']) },
    { name: 'CEO round', interviewerId: findBy(app, ['%chief executive%', 'ceo%', '% ceo%']) }
  ];
  return steps;
}
export function planOf(app: App, requisitionId: string): { steps: PlanStep[]; own: boolean } {
  const req = getRequisition(app, requisitionId);
  if (!req) throw new HttpError(404, 'Vacancy not found.');
  let steps: PlanStep[] = []; try { steps = JSON.parse(req.interview_plan || '[]') as PlanStep[]; } catch { /* empty */ }
  const own = steps.length > 0;
  if (!own) steps = defaultPlan(app, req);
  const names = new Map(app.db.all<{ id: string; full_name: string }>('SELECT id, full_name FROM employees').map((e) => [e.id, e.full_name]));
  return { steps: steps.map((s) => ({ ...s, interviewerName: names.get(s.interviewerId) || '' })), own };
}
export function savePlan(app: App, actor: Employee, requisitionId: string, input: { name: string; interviewerId?: string; order?: number }[]): PlanStep[] {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR edits the interview plan.');
  if (!getRequisition(app, requisitionId)) throw new HttpError(404, 'Vacancy not found.');
  const steps = input.map((s, i) => ({ name: (s.name || '').trim().slice(0, 60), interviewerId: s.interviewerId || '', order: Number.isFinite(Number(s.order)) && s.order !== undefined && String(s.order) !== '' ? Number(s.order) : i + 1, i }))
    .filter((s) => s.name).sort((a, b) => a.order - b.order || a.i - b.i).map((s) => ({ name: s.name, interviewerId: s.interviewerId }));
  if (steps.length > 8) throw new HttpError(400, 'Keep the plan to eight rounds or fewer.');
  for (const s of steps) if (s.interviewerId && !app.db.get('SELECT id FROM employees WHERE id = ?', [s.interviewerId])) throw new HttpError(400, `Interviewer for "${s.name}" was not found.`);
  app.db.run('UPDATE requisitions SET interview_plan = ?, updated_at = ? WHERE id = ?', [JSON.stringify(steps), nowIso(), requisitionId]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: requisitionId, action: 'interview_plan', after: { rounds: steps.map((s) => s.name) } });
  return steps;
}

/**
 * Where one application stands against its vacancy's plan. Round n of the plan is matched to the application's nth interview.
 * `next` marks the round to arrange now. Nothing here schedules, moves or closes anything: HR presses the button.
 */
export function planTrack(app: App, applicationId: string): { steps: PlanTrackStep[]; extra: Interview[]; next: PlanTrackStep | undefined } {
  const a = getApplication(app, applicationId);
  if (!a) throw new HttpError(404, 'Application not found.');
  const { steps } = planOf(app, a.requisition_id);
  // The nth interview that was not cancelled is the nth round of the plan, so a cancelled and re-arranged round keeps its place.
  const interviews = listInterviews(app, { applicationId }).filter((i) => i.status !== 'cancelled').sort((x, y) => x.round - y.round);
  let nextGiven = false;
  const out: PlanTrackStep[] = steps.map((s, idx) => {
    const round = idx + 1; const iv = interviews[idx];
    if (iv && (iv.status === 'completed' || iv.status === 'no_show')) {
      const recs = app.db.all<{ recommendation: string }>('SELECT recommendation FROM scorecards WHERE interview_id = ? AND submitted_at IS NOT NULL', [iv.id]).map((r) => r.recommendation);
      const proceed = recs.length ? !recs.some((r) => r === 'no' || r === 'strong_no') : null;
      return { ...s, round, state: 'done', interview: iv, proceed };
    }
    if (iv) return { ...s, round, state: 'scheduled', interview: iv };
    if (!nextGiven) { nextGiven = true; return { ...s, round, state: 'next' }; }
    return { ...s, round, state: 'later' };
  });
  // A round is only offered as "next" when nothing before it is still waiting to happen.
  const firstOpen = out.findIndex((s) => s.state === 'scheduled');
  const next = out.find((s) => s.state === 'next');
  const usable = next && (firstOpen === -1 || firstOpen > out.indexOf(next)) && a.status === 'active' && ['applied', 'screening', 'assessment', 'interview'].includes(a.stage) ? next : undefined;
  return { steps: out, extra: interviews.slice(steps.length), next: usable };
}
