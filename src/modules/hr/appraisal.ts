// Appraisals: annual cycles (self review → manager review → HOD moderation → COO approval)
// and six-month probation reviews generated from the join date.
// Ratings are recorded, never computed: the KPI snapshot is evidence placed next to the
// reviewer's judgement, so nobody is rated by a formula they cannot argue with.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { addDays, localDateString } from '../../lib/time.ts';
import { getEmployee, listEmployees, type Employee } from '../people/model.ts';
import { personKpis } from '../kpi/views.ts';
import { tilesFor } from '../kpi/engine.ts';
import { createTask, decideTask } from '../tasks/service.ts';
import { currentStructure, saveStructure } from './payroll.ts';

export interface AppraisalCycle {
  id: string; name: string; period_from: string; period_to: string; self_due: string | null; manager_due: string | null;
  status: string; created_by: string | null; created_at: string; count?: number; done?: number;
}
export interface Appraisal {
  id: string; cycle_id: string | null; kind: string; employee_id: string; manager_id: string | null; status: string;
  self_review: string; self_rating: number | null; self_at: string | null;
  manager_review: string; manager_rating: number | null; manager_at: string | null;
  kpi_snapshot: string; final_rating: number | null; increment_pct: number | null; increment_amount: number | null;
  decision: string; approval_task_id: string | null; approved_by: string | null; approved_at: string | null;
  due_date: string | null; created_at: string; updated_at: string;
  employee_name?: string; designation?: string; department_id?: string; manager_name?: string; cycle_name?: string;
}
export interface KpiEvidence { key: string; name: string; value: string; target: string; rag: string }

import { setDefaults, onList, number } from '../../lib/lists.ts';
export const RATINGS: { value: number; label: string; hint: string }[] = [
  { value: 5, label: 'Outstanding', hint: 'Set a new bar for the role' },
  { value: 4, label: 'Exceeds', hint: 'Consistently above what the role asks' },
  { value: 3, label: 'Meets', hint: 'Does the job well and reliably' },
  { value: 2, label: 'Partly meets', hint: 'Gaps that need a plan' },
  { value: 1, label: 'Below', hint: 'Not performing; formal plan required' }
];
export const ratingLabel = (n: number | null): string => (n == null ? '—' : RATINGS.find((r) => r.value === Math.round(n))?.label || String(n));
setDefaults('appraisal.ratings', RATINGS.map((r) => ({ value: String(r.value), label: r.label, active: true })));
onList('appraisal.ratings', (items) => { for (const i of items) { const r = RATINGS.find((x) => String(x.value) === i.value); if (r) r.label = i.label; } });
const PROBATION_OUTCOMES = ['confirm', 'extend', 'exit'];

const SELECT = `SELECT a.*, e.full_name AS employee_name, e.designation, e.department_id, m.full_name AS manager_name, c.name AS cycle_name
  FROM appraisals a JOIN employees e ON e.id = a.employee_id LEFT JOIN employees m ON m.id = a.manager_id LEFT JOIN appraisal_cycles c ON c.id = a.cycle_id`;

export function getAppraisal(app: App, id: string): Appraisal | undefined { return app.db.get<Appraisal>(`${SELECT} WHERE a.id = ?`, [id]); }

export function listAppraisals(app: App, f: { cycleId?: string; employeeId?: string; managerId?: string; kind?: string; status?: string[]; limit?: number } = {}): Appraisal[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.cycleId) { where.push('a.cycle_id = ?'); params.push(f.cycleId); }
  if (f.employeeId) { where.push('a.employee_id = ?'); params.push(f.employeeId); }
  if (f.managerId) { where.push('a.manager_id = ?'); params.push(f.managerId); }
  if (f.kind) { where.push('a.kind = ?'); params.push(f.kind); }
  if (f.status && f.status.length) { where.push(`a.status IN (${f.status.map(() => '?').join(',')})`); params.push(...f.status); }
  params.push(f.limit || 200);
  return app.db.all<Appraisal>(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.due_date, e.full_name LIMIT ?`, params);
}

export function listCycles(app: App): AppraisalCycle[] {
  return app.db.all<AppraisalCycle>(`SELECT c.*, (SELECT count(*) FROM appraisals a WHERE a.cycle_id = c.id) AS count,
    (SELECT count(*) FROM appraisals a WHERE a.cycle_id = c.id AND a.status IN ('approved', 'closed')) AS done
    FROM appraisal_cycles c ORDER BY c.period_to DESC, c.created_at DESC`);
}
export function getCycle(app: App, id: string): AppraisalCycle | undefined { return app.db.get<AppraisalCycle>('SELECT * FROM appraisal_cycles WHERE id = ?', [id]); }

export function createCycle(app: App, actor: Employee, input: { name: string; periodFrom: string; periodTo: string; selfDue?: string; managerDue?: string }): AppraisalCycle {
  if (!input.name.trim()) throw new HttpError(400, 'Give the cycle a name.');
  for (const [label, d] of [['start', input.periodFrom], ['end', input.periodTo]] as const) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new HttpError(400, `Pick the period ${label} date.`);
  if (input.periodTo <= input.periodFrom) throw new HttpError(400, 'The period must end after it starts.');
  const id = app.db.nextId('AP');
  app.db.run('INSERT INTO appraisal_cycles (id, name, period_from, period_to, self_due, manager_due, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.name.trim(), input.periodFrom, input.periodTo, input.selfDue || null, input.managerDue || null, 'draft', actor.id, new Date().toISOString()]);
  audit(app.db, { actorId: actor.id, entity: 'appraisal_cycle', entityId: id, action: 'created', after: { name: input.name } });
  return getCycle(app, id)!;
}

/** The KPIs that will sit next to the review, captured as they stood when the cycle opened. */
export function kpiSnapshot(app: App, employee: Employee, now = new Date()): KpiEvidence[] {
  const keys = personKpis(employee.department_id);
  if (!keys.length) return [];
  return tilesFor(app, keys, { type: 'employee', id: employee.id }, now)
    .map((t) => ({ key: t.key, name: t.name, value: t.display, target: t.targetDisplay, rag: t.rag }));
}

/** Open a cycle: one appraisal per active employee who has a manager, routed to self review. */
export function openCycle(app: App, actor: Employee, cycleId: string): { created: number; skipped: { name: string; reason: string }[] } {
  const cycle = getCycle(app, cycleId);
  if (!cycle) throw new HttpError(404, 'Cycle not found.');
  if (cycle.status !== 'draft') throw new HttpError(400, 'That cycle is already open.');
  const now = new Date(); const nowIso = now.toISOString();
  const skipped: { name: string; reason: string }[] = [];
  let created = 0;
  app.db.transaction(() => {
    for (const e of listEmployees(app.db, { status: 'active' })) {
      if (app.db.get('SELECT id FROM appraisals WHERE cycle_id = ? AND employee_id = ?', [cycleId, e.id])) continue;
      if (e.join_date && e.join_date > cycle.period_from && daysBetween(e.join_date, cycle.period_to) < 90) { skipped.push({ name: e.full_name, reason: 'Joined less than 90 days before the period ended' }); continue; }
      const manager = e.reporting_manager_id && e.reporting_manager_id !== e.id ? e.reporting_manager_id : null;
      const id = app.db.nextId('AR');
      app.db.run(`INSERT INTO appraisals (id, cycle_id, kind, employee_id, manager_id, status, kpi_snapshot, due_date, created_at, updated_at)
        VALUES (?, ?, 'annual', ?, ?, 'self', ?, ?, ?, ?)`,
        [id, cycleId, e.id, manager, JSON.stringify(kpiSnapshot(app, e, now)), cycle.self_due, nowIso, nowIso]);
      created++;
      app.notify.send({ employeeId: e.id, title: `${cycle.name}: your self review is open`, body: cycle.self_due ? `Please complete it by ${cycle.self_due}.` : 'Please complete it this week.', link: `/appraisals/${id}`, kind: 'info' });
    }
    app.db.run("UPDATE appraisal_cycles SET status = 'open' WHERE id = ?", [cycleId]);
  });
  audit(app.db, { actorId: actor.id, entity: 'appraisal_cycle', entityId: cycleId, action: 'opened', after: { created } });
  return { created, skipped };
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

export function parseKpis(a: Appraisal): KpiEvidence[] { try { return JSON.parse(a.kpi_snapshot) as KpiEvidence[]; } catch { return []; } }

const checkRating = (n: number): number => { if (!RATINGS.some((r) => r.value === Math.round(n))) throw new HttpError(400, 'Pick a rating from 1 to 5.'); return Math.round(n); };

export function submitSelf(app: App, actor: Employee, id: string, input: { review: string; rating: number }): Appraisal {
  const a = getAppraisal(app, id);
  if (!a) throw new HttpError(404, 'Appraisal not found.');
  if (a.employee_id !== actor.id) throw new HttpError(403, 'Only the employee can write their own review.');
  if (a.status !== 'self') throw new HttpError(400, 'Your self review has already been submitted.');
  if (input.review.trim().length < 40) throw new HttpError(400, 'Please write a little more — at least a few sentences.');
  const rating = checkRating(input.rating);
  const nowIso = new Date().toISOString();
  app.db.run("UPDATE appraisals SET self_review = ?, self_rating = ?, self_at = ?, status = 'manager', due_date = COALESCE((SELECT manager_due FROM appraisal_cycles WHERE id = appraisals.cycle_id), due_date), updated_at = ? WHERE id = ?",
    [input.review.trim(), rating, nowIso, nowIso, id]);
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: id, action: 'self_submitted', after: { rating } });
  if (a.manager_id) app.notify.send({ employeeId: a.manager_id, title: `${a.employee_name} submitted their self review`, body: `Rated themselves ${rating}/5 (${ratingLabel(rating)}). Your review is next.`, link: `/appraisals/${id}`, kind: 'info' });
  return getAppraisal(app, id)!;
}

export function submitManager(app: App, actor: Employee, id: string, input: { review: string; rating: number }): Appraisal {
  const a = getAppraisal(app, id);
  if (!a) throw new HttpError(404, 'Appraisal not found.');
  if (a.manager_id !== actor.id && !actor.is_admin && actor.functional_role !== 'executive') throw new HttpError(403, 'Only the reporting manager can write this review.');
  if (a.status !== 'manager') throw new HttpError(400, a.status === 'self' ? 'Waiting for the self review first.' : 'This review has already been submitted.');
  if (input.review.trim().length < 40) throw new HttpError(400, 'Please write a little more — at least a few sentences.');
  const rating = checkRating(input.rating);
  const nowIso = new Date().toISOString();
  app.db.run("UPDATE appraisals SET manager_review = ?, manager_rating = ?, manager_at = ?, status = 'moderation', updated_at = ? WHERE id = ?", [input.review.trim(), rating, nowIso, nowIso, id]);
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: id, action: 'manager_submitted', after: { rating } });
  const hod = hodFor(app, a.employee_id);
  if (hod) app.notify.send({ employeeId: hod, title: `Moderation pending: ${a.employee_name}`, body: `${actor.full_name} rated ${rating}/5. Set the final rating and increment.`, link: `/appraisals/${id}`, kind: 'info' });
  return getAppraisal(app, id)!;
}

/** The head of the employee's department, else the first executive. */
function hodFor(app: App, employeeId: string): string | null {
  const e = getEmployee(app.db, employeeId);
  if (!e) return null;
  const hod = app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = ? AND functional_role = 'hod' AND status = 'active' AND id <> ? LIMIT 1", [e.department_id, employeeId]);
  if (hod) return hod.id;
  return app.db.get<{ id: string }>("SELECT id FROM employees WHERE functional_role = 'executive' AND status = 'active' LIMIT 1")?.id || null;
}

/** HOD moderation: final rating plus a recommended increment, routed to the COO for approval. */
export function moderate(app: App, actor: Employee, id: string, input: { finalRating: number; incrementPct: number; decision: string }): Appraisal {
  const a = getAppraisal(app, id);
  if (!a) throw new HttpError(404, 'Appraisal not found.');
  if (a.kind !== 'annual') throw new HttpError(400, 'Probation reviews are decided by the manager, not moderated.');
  if (!['moderation', 'approval'].includes(a.status)) throw new HttpError(400, 'This appraisal is not ready for moderation.');
  if (a.employee_id === actor.id) throw new HttpError(403, 'You cannot moderate your own appraisal.');
  if (!['hod', 'executive'].includes(actor.functional_role) && !actor.is_admin) throw new HttpError(403, 'Only a department head or an executive can moderate an appraisal.');
  const rating = checkRating(input.finalRating);
  const pct = Number(input.incrementPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'Enter an increment between 0 and 100 percent.');
  const st = currentStructure(app, a.employee_id);
  const amount = st && st.ctc_annual ? Math.round(st.ctc_annual * pct / 100) : null;
  const nowIso = new Date().toISOString();
  let taskId = a.approval_task_id;
  app.db.transaction(() => {
    app.db.run("UPDATE appraisals SET final_rating = ?, increment_pct = ?, increment_amount = ?, decision = ?, status = 'approval', updated_at = ? WHERE id = ?",
      [rating, pct, amount, input.decision.trim(), nowIso, id]);
    if (!taskId) {
      const approver = app.db.get<{ id: string }>("SELECT id FROM employees WHERE functional_role = 'executive' AND status = 'active' ORDER BY CASE WHEN designation LIKE '%Operating%' THEN 0 ELSE 1 END LIMIT 1")?.id || null;
      const t = createTask(app, actor, {
        kind: 'approval', type: 'purchase', title: `Appraisal: ${a.employee_name} · ${ratingLabel(rating)} · ${pct}% increment`,
        details: `${a.designation}. Manager rated ${a.manager_rating ?? '—'}/5, final ${rating}/5.${amount ? ` New CTC would rise by ₹${amount.toLocaleString('en-IN')} a year.` : ''} ${input.decision.trim()}`.trim(),
        amount: amount || 0, assigneeId: approver, requesterId: actor.id, payload: { kind: 'appraisal', appraisalId: id }, link: `/appraisals/${id}`
      });
      taskId = t.id;
      app.db.run('UPDATE appraisals SET approval_task_id = ? WHERE id = ?', [t.id, id]);
      if (approver) app.notify.send({ employeeId: approver, title: `Appraisal approval: ${a.employee_name}`, body: t.title, link: `/appraisals/${id}`, kind: 'info' });
    }
  });
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: id, action: 'moderated', after: { rating, pct, amount } });
  return getAppraisal(app, id)!;
}

/** Called when the COO decides the approval task. Never changes pay by itself. */
export function applyAppraisalDecision(app: App, actor: Employee, appraisalId: string, decision: 'approved' | 'declined'): void {
  const a = getAppraisal(app, appraisalId);
  if (!a || a.status !== 'approval') return;
  const nowIso = new Date().toISOString();
  app.db.run('UPDATE appraisals SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?',
    [decision === 'approved' ? 'approved' : 'moderation', actor.id, decision === 'approved' ? nowIso : null, nowIso, appraisalId]);
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: appraisalId, action: decision });
  app.notify.send({ employeeId: a.employee_id, title: decision === 'approved' ? 'Your appraisal is complete' : 'Your appraisal is back with your HOD', body: decision === 'approved' ? `Final rating ${ratingLabel(a.final_rating)}. HR will share the letter.` : 'No action needed from you.', link: `/appraisals/${appraisalId}`, kind: decision === 'approved' ? 'success' : 'info' });
  if (a.manager_id) app.notify.send({ employeeId: a.manager_id, title: `Appraisal ${decision}: ${a.employee_name}`, body: `Final rating ${ratingLabel(a.final_rating)}.`, link: `/appraisals/${appraisalId}`, kind: 'info' });
}

/** Write the approved increment into a new effective-dated salary structure. Explicit, never automatic. */
export function applyIncrement(app: App, actor: Employee, id: string, effectiveFrom: string): { oldCtc: number; newCtc: number } {
  const a = getAppraisal(app, id);
  if (!a) throw new HttpError(404, 'Appraisal not found.');
  if (a.status !== 'approved') throw new HttpError(400, 'The increment has not been approved yet.');
  if (!a.increment_pct) throw new HttpError(400, 'This appraisal carries no increment.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new HttpError(400, 'Pick the date the new salary starts.');
  const st = currentStructure(app, a.employee_id);
  if (!st) throw new HttpError(400, 'This employee has no salary structure yet.');
  if (app.db.get('SELECT id FROM salary_structures WHERE employee_id = ? AND effective_from = ?', [a.employee_id, effectiveFrom])) throw new HttpError(400, 'A salary already starts on that date. Change the date or edit that structure.');
  const factor = 1 + a.increment_pct / 100;
  const r = (n: number) => Math.round(n * factor);
  saveStructure(app, actor, {
    employeeId: a.employee_id, effectiveFrom, ctcAnnual: Math.round(st.ctc_annual * factor),
    basic: r(st.basic), hra: r(st.hra), conveyance: st.conveyance, special: r(st.special),
    pfApplicable: !!st.pf_applicable, pfOnFullBasic: !!st.pf_on_full_basic, esiApplicable: !!st.esi_applicable, ptApplicable: !!st.pt_applicable,
    bankAccount: st.bank_account, bankIfsc: st.bank_ifsc, pan: st.pan, uan: st.uan, esicNumber: st.esic_number,
    notes: `${a.increment_pct}% increment from appraisal ${a.id}`
  });
  app.db.run("UPDATE appraisals SET status = 'closed', updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: id, action: 'increment_applied', after: { effectiveFrom, pct: a.increment_pct } });
  app.notify.send({ employeeId: a.employee_id, title: 'Your revised salary is in the system', body: `Effective ${effectiveFrom}.`, link: '/me/payslips', kind: 'success' });
  return { oldCtc: st.ctc_annual, newCtc: Math.round(st.ctc_annual * factor) };
}

// ---------- Probation ----------

export function probationDue(joinDate: string): string {
  const [y, m, d] = joinDate.split('-').map(Number);
  const mm = m - 1 + number('appraisal.probationMonths');
  return `${y + Math.floor(mm / 12)}-${String((mm % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Create a probation review 21 days before it falls due, and record the date on the employee. */
export function generateProbationReviews(app: App, now = new Date()): number {
  const horizon = localDateString(addDays(now, 21));
  const today = localDateString(now);
  let made = 0;
  for (const e of listEmployees(app.db, { status: 'active' })) {
    if (!e.join_date) continue;
    const due = probationDue(e.join_date);
    // Anyone whose six months ended before today is already past probation: nothing to schedule.
    if (due < today) { if (e.probation_until) app.db.run('UPDATE employees SET probation_until = NULL WHERE id = ?', [e.id]); continue; }
    if (e.probation_until !== due) app.db.run('UPDATE employees SET probation_until = ? WHERE id = ?', [due, e.id]);
    if (due > horizon) continue;
    if (app.db.get("SELECT id FROM appraisals WHERE employee_id = ? AND kind = 'probation'", [e.id])) continue;
    const nowIso = now.toISOString();
    const id = app.db.nextId('AR');
    app.db.run(`INSERT INTO appraisals (id, cycle_id, kind, employee_id, manager_id, status, kpi_snapshot, due_date, created_at, updated_at)
      VALUES (?, NULL, 'probation', ?, ?, 'manager', ?, ?, ?, ?)`,
      [id, e.id, e.reporting_manager_id, JSON.stringify(kpiSnapshot(app, e, now)), due, nowIso, nowIso]);
    made++;
    if (e.reporting_manager_id) app.notify.send({ employeeId: e.reporting_manager_id, title: `Probation review due: ${e.full_name}`, body: `Six months end on ${due}. Confirm, extend or exit.`, link: `/appraisals/${id}`, kind: 'warn' });
  }
  return made;
}

/** Manager decides a probation review outright; HR sees the outcome on the appraisals page. */
export function decideProbation(app: App, actor: Employee, id: string, input: { outcome: string; review: string; rating: number; extendTo?: string }): Appraisal {
  const a = getAppraisal(app, id);
  if (!a) throw new HttpError(404, 'Review not found.');
  if (a.kind !== 'probation') throw new HttpError(400, 'That is not a probation review.');
  if (a.status !== 'manager') throw new HttpError(400, 'This review has already been decided.');
  if (a.manager_id !== actor.id && !actor.is_admin && actor.functional_role !== 'executive') throw new HttpError(403, 'Only the reporting manager can decide this.');
  if (!PROBATION_OUTCOMES.includes(input.outcome)) throw new HttpError(400, 'Choose confirm, extend or exit.');
  if (input.review.trim().length < 30) throw new HttpError(400, 'Please write a short note on how the six months went.');
  if (input.outcome === 'extend' && !/^\d{4}-\d{2}-\d{2}$/.test(input.extendTo || '')) throw new HttpError(400, 'Pick the date the extended probation ends.');
  const rating = checkRating(input.rating);
  const nowIso = new Date().toISOString();
  app.db.transaction(() => {
    app.db.run("UPDATE appraisals SET manager_review = ?, manager_rating = ?, manager_at = ?, final_rating = ?, decision = ?, status = 'closed', updated_at = ? WHERE id = ?",
      [input.review.trim(), rating, nowIso, rating, input.outcome, nowIso, id]);
    if (input.outcome === 'extend') app.db.run('UPDATE employees SET probation_until = ? WHERE id = ?', [input.extendTo || null, a.employee_id]);
    if (input.outcome === 'confirm') app.db.run("UPDATE employees SET probation_until = NULL, employment_type = CASE WHEN employment_type = 'probation' THEN 'permanent' ELSE employment_type END WHERE id = ?", [a.employee_id]);
  });
  audit(app.db, { actorId: actor.id, entity: 'appraisal', entityId: id, action: `probation_${input.outcome}`, after: { rating } });
  const hr = app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = 'HR' AND status = 'active' LIMIT 1")?.id;
  if (hr) app.notify.send({ employeeId: hr, title: `Probation ${input.outcome}: ${a.employee_name}`, body: input.review.trim().slice(0, 140), link: `/appraisals/${id}`, kind: input.outcome === 'exit' ? 'warn' : 'info' });
  if (input.outcome !== 'exit') app.notify.send({ employeeId: a.employee_id, title: input.outcome === 'confirm' ? 'Your probation is complete' : 'Your probation has been extended', body: input.review.trim().slice(0, 140), link: `/appraisals/${id}`, kind: input.outcome === 'confirm' ? 'success' : 'info' });
  return getAppraisal(app, id)!;
}

export function myAppraisals(app: App, employeeId: string): Appraisal[] { return listAppraisals(app, { employeeId, limit: 20 }); }
export function pendingForManager(app: App, managerId: string): Appraisal[] { return listAppraisals(app, { managerId, status: ['manager'], limit: 100 }); }
void decideTask;
