// Hiring, second round: a public "Apply" link per vacancy, time limits per stage with an overdue list,
// the interview calendar, message templates with fields filled in for each candidate, and merging duplicate candidates.
import { randomBytes } from 'node:crypto';
import type { App } from '../../app.ts';
import type { Params } from '../../db/index.ts';
import type { Employee } from '../people/model.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { localDateString } from '../../lib/time.ts';
import { attachApplicantCv, checkFile, MAX_CV_BYTES } from './cv.ts';
import { STAGES, STAGE_LABEL, normalizeEmail, isRecruiter, getRequisition, getCandidate, getApplication, getInterview, listApplications, logEvent, canSeeApplication,
  type Requisition, type Candidate, type Application, type Interview } from './recruiting.ts';

const nowIso = (): string => new Date().toISOString();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inr = (n: number): string => '₹' + Math.round(n).toLocaleString('en-IN');
const requireHr = (app: App, actor: Employee): void => { if (!isRecruiter(app, actor)) throw new HttpError(403, 'This is done by HR.'); };

// =====================================================================================================================
// 1. Public "Apply" link
// =====================================================================================================================
export interface ApplyLink { enabled: boolean; token: string | null; intro: string; received: number }
export function applyLink(app: App, requisitionId: string): ApplyLink {
  const r = app.db.get<{ apply_token: string | null; apply_enabled: number; apply_intro: string }>('SELECT apply_token, apply_enabled, apply_intro FROM requisitions WHERE id = ?', [requisitionId]);
  if (!r) throw new HttpError(404, 'Vacancy not found.');
  const received = app.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM applications WHERE requisition_id = ? AND source = 'Apply link'", [requisitionId])!.n;
  return { enabled: !!r.apply_enabled, token: r.apply_token, intro: r.apply_intro, received };
}
/** Turn the link on or off. Turning it on the first time makes the link; making a new link stops the old one working. */
export function setApplyLink(app: App, actor: Employee, requisitionId: string, input: { enabled?: boolean; intro?: string; renew?: boolean }): ApplyLink {
  requireHr(app, actor); const cur = applyLink(app, requisitionId);
  const token = input.renew || (input.enabled && !cur.token) ? randomBytes(18).toString('base64url') : cur.token;
  const enabled = input.enabled ?? cur.enabled; const intro = input.intro === undefined ? cur.intro : String(input.intro).trim().slice(0, 1500);
  app.db.run('UPDATE requisitions SET apply_token = ?, apply_enabled = ?, apply_intro = ?, updated_at = ? WHERE id = ?', [token, enabled ? 1 : 0, intro, nowIso(), requisitionId]);
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: requisitionId, action: input.renew ? 'apply_link_renewed' : enabled ? 'apply_link_on' : 'apply_link_off' });
  return applyLink(app, requisitionId);
}
/** The vacancy a public link belongs to, and whether it is taking applications right now. */
export function vacancyByToken(app: App, token: string): { req: Requisition; open: boolean; intro: string } | undefined {
  if (!/^[\w-]{16,40}$/.test(token)) return undefined;
  const row = app.db.get<{ id: string; apply_enabled: number; apply_intro: string }>('SELECT id, apply_enabled, apply_intro FROM requisitions WHERE apply_token = ?', [token]); if (!row) return undefined;
  const req = getRequisition(app, row.id)!;
  return { req, open: !!row.apply_enabled && req.status === 'open', intro: row.apply_intro };
}
export interface ApplyInput { fullName?: string; email?: string; phone?: string; currentEmployer?: string; experienceYears?: number | null; currentCtc?: number | null; expectedCtc?: number | null; noticeDays?: number | null; location?: string; heardFrom?: string; consent?: unknown; website?: string; cv?: string; cvName?: string }
const recent = new Map<string, number[]>();
/** Five applications an hour from one address is plenty for a person; more looks like a script. */
function throttle(ip: string, max = 5, now = Date.now()): void {
  const hits = (recent.get(ip) || []).filter((t) => now - t < 3_600_000); if (hits.length >= max) throw new HttpError(429, 'Too many applications from this connection. Please try again in an hour.');
  hits.push(now); recent.set(ip, hits); if (recent.size > 5000) recent.clear();
}
export function resetApplyThrottle(): void { recent.clear(); }
/** A person applies through the public link. Someone already on record (same email) is matched, not duplicated. */
export function applyPublic(app: App, token: string, input: ApplyInput, ip: string): { applicationId: string; already: boolean; name: string } {
  const v = vacancyByToken(app, token); if (!v) throw new HttpError(404, 'This link is not valid.');
  if (!v.open) throw new HttpError(410, 'This vacancy is not taking applications at the moment.');
  if (input.website) throw new HttpError(400, 'The form could not be sent.');   // a field people never see; only scripts fill it
  const name = String(input.fullName || '').trim().replace(/\s+/g, ' ').slice(0, 120); const email = String(input.email || '').trim().slice(0, 160); const phone = String(input.phone || '').trim().slice(0, 30);
  if (name.length < 3) throw new HttpError(400, 'Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (phone.replace(/\D/g, '').length < 10) throw new HttpError(400, 'Please enter a phone number with at least 10 digits.');
  if (!input.consent || input.consent === 'false') throw new HttpError(400, 'Please tick the box to agree to your details being kept for hiring.');
  const buf = input.cv ? Buffer.from(input.cv, 'base64') : null;
  if (!buf || !buf.length) throw new HttpError(400, 'Please attach your CV (PDF or Word).');
  if (buf.length > MAX_CV_BYTES) throw new HttpError(413, 'The CV is larger than 5 MB.');
  checkFile(input.cvName || 'cv.pdf', buf.length);
  throttle(ip); throttle(`vacancy:${token}`, 60);   // the address a request claims can be faked, so each vacancy also has its own ceiling
  const num = (x: unknown, max: number): number | null => { const n = Number(x); return x === null || x === undefined || x === '' || !Number.isFinite(n) || n < 0 || n > max ? null : n; };
  const at = nowIso(); const norm = normalizeEmail(email);
  const out = app.db.transaction(() => {
    let cand = app.db.get<Candidate>('SELECT * FROM candidates WHERE email_normalized = ? AND merged_into IS NULL ORDER BY created_at LIMIT 1', [norm]);
    if (cand) {
      const dup = app.db.get<{ id: string }>('SELECT id FROM applications WHERE candidate_id = ? AND requisition_id = ?', [cand.id, v.req.id]);
      if (dup) return { applicationId: dup.id, already: true, candidateId: cand.id };
      // Fill only what we did not have; never overwrite what HR recorded.
      app.db.run(`UPDATE candidates SET phone = CASE WHEN phone = '' THEN ? ELSE phone END, current_employer = CASE WHEN current_employer = '' THEN ? ELSE current_employer END, experience_years = COALESCE(experience_years, ?), current_ctc = COALESCE(current_ctc, ?),
        expected_ctc = COALESCE(expected_ctc, ?), notice_days = COALESCE(notice_days, ?), location = CASE WHEN location = '' THEN ? ELSE location END, updated_at = ? WHERE id = ?`,
        [phone, String(input.currentEmployer || '').slice(0, 120), num(input.experienceYears, 60), num(input.currentCtc, 1e9), num(input.expectedCtc, 1e9), num(input.noticeDays, 365), String(input.location || '').slice(0, 80), at, cand.id]);
    } else {
      const id = app.db.nextId('CAN');
      app.db.run(`INSERT INTO candidates (id, full_name, email, email_normalized, phone, current_employer, experience_years, current_ctc, expected_ctc, notice_days, location, notes, cv_path, cv_text, consent_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, NULL, ?, ?)`, [id, name, email, norm, phone, String(input.currentEmployer || '').slice(0, 120), num(input.experienceYears, 60), num(input.currentCtc, 1e9), num(input.expectedCtc, 1e9), num(input.noticeDays, 365), String(input.location || '').slice(0, 80), input.heardFrom ? `Heard about the role from: ${String(input.heardFrom).slice(0, 60)}` : '', at, at, at]);
      audit(app.db, { actorId: null, entity: 'candidate', entityId: id, action: 'created', after: { name, by: 'applicant' } });
      cand = getCandidate(app, id)!;
    }
    const appId = app.db.nextId('APP');
    app.db.run(`INSERT INTO applications (id, candidate_id, requisition_id, source, received_at, owner_id, stage, stage_since, status, workflow_version, created_at, updated_at) VALUES (?, ?, ?, 'Apply link', ?, ?, 'applied', ?, 'active', ?, ?, ?)`,
      [appId, cand.id, v.req.id, at, v.req.recruiter_id || v.req.hiring_manager_id || null, at, v.req.workflow_version || 2, at, at]);
    logEvent(app, appId, 'created', `Applied to ${v.req.title} through the public link`, null, null, 'applied');
    return { applicationId: appId, already: false, candidateId: cand.id };
  });
  if (!out.already) {
    try { attachApplicantCv(app, out.candidateId, input.cvName || 'cv.pdf', buf); } catch { /* the application stands even if the file could not be read */ }
    const tell = new Set([v.req.recruiter_id, v.req.hiring_manager_id].filter((x): x is string => !!x));
    for (const id of tell) app.notify.send({ employeeId: id, title: `New application: ${name}`, body: `${v.req.title} · through the Apply link`, link: `/hire/app/${out.applicationId}`, kind: 'info' });
  }
  return { applicationId: out.applicationId, already: out.already, name };
}

// =====================================================================================================================
// 2. Time limits per stage, and what is overdue
// =====================================================================================================================
export const DEFAULT_LIMITS: Record<string, number> = { applied: 2, screening: 3, assessment: 5, interview: 7, decision: 3, offer: 7, onboarding: 14 };
export const LIMIT_STAGES = STAGES.filter((s) => s !== 'hired');
export function stageLimits(app: App): Record<string, number> {
  const out = { ...DEFAULT_LIMITS }; for (const r of app.db.all<{ stage: string; days: number }>('SELECT stage, days FROM hire_stage_limits')) if (r.stage in out) out[r.stage] = r.days;
  return out;
}
export function saveStageLimits(app: App, actor: Employee, values: Record<string, unknown>): Record<string, number> {
  requireHr(app, actor);
  app.db.transaction(() => { for (const s of LIMIT_STAGES) { if (values[s] === undefined || values[s] === '') continue; const d = Math.round(Number(values[s])); if (!(d >= 0 && d <= 120)) throw new HttpError(400, `The limit for ${STAGE_LABEL[s]} must be between 0 (no limit) and 120 days.`);
    app.db.run('INSERT INTO hire_stage_limits (stage, days) VALUES (?, ?) ON CONFLICT(stage) DO UPDATE SET days = excluded.days', [s, d]); } });
  audit(app.db, { actorId: actor.id, entity: 'hire_stage_limits', entityId: 'all', action: 'updated', after: values });
  return stageLimits(app);
}
export const daysIn = (since: string, now = new Date()): number => Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000));
export interface Aging extends Application { days: number; limit: number; over: number }
/** Active applications (not on hold) with how long each has been in its stage. `over` is days past the limit, 0 when within it. */
export function aging(app: App, viewer?: Employee, now = new Date()): Aging[] {
  const limits = stageLimits(app);
  return listApplications(app, { status: 'active', limit: 2000 }).filter((a) => a.stage !== 'hired' && (!viewer || canSeeApplication(app, viewer, a)))
    .map((a) => { const days = daysIn(a.stage_since, now); const limit = limits[a.stage] ?? 7; return { ...a, days, limit, over: limit ? Math.max(0, days - limit) : 0 }; });
}
export function overdue(app: App, viewer?: Employee, now = new Date()): Aging[] { return aging(app, viewer, now).filter((a) => a.over > 0).sort((a, b) => b.over - a.over); }
/** Once a day: the owner of each application that has just gone over its limit is told, once per stage. */
export function overdueReminders(app: App, now = new Date()): number {
  let n = 0;
  for (const a of overdue(app, undefined, now)) {
    const row = app.db.get<{ overdue_notified_at: string | null }>('SELECT overdue_notified_at FROM applications WHERE id = ?', [a.id]);
    if (row?.overdue_notified_at && row.overdue_notified_at >= a.stage_since) continue;
    if (a.owner_id) app.notify.send({ employeeId: a.owner_id, title: `Overdue in ${STAGE_LABEL[a.stage]}: ${a.candidate_name}`, body: `${a.requisition_title} · ${a.days} days in this stage, the limit is ${a.limit}.`, link: `/hire/app/${a.id}`, kind: 'warn' });
    app.db.run('UPDATE applications SET overdue_notified_at = ? WHERE id = ?', [now.toISOString(), a.id]); n++;
  }
  return n;
}

// =====================================================================================================================
// 3. Interview calendar
// =====================================================================================================================
export interface CalendarDay { date: string; label: string; dow: string; today: boolean; inMonth: boolean; interviews: Interview[] }
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const addDay = (d: string, n: number): string => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const mondayOf = (d: string): string => { const t = new Date(`${d}T00:00:00Z`); const dow = t.getUTCDay() || 7; return addDay(d, 1 - dow); };
/** Local (IST) date and minute-of-day of a stored time. */
export const localParts = (iso: string): { date: string; minutes: number; hhmm: string } => { const t = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString(); return { date: t.slice(0, 10), minutes: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)), hhmm: t.slice(11, 16) }; };
/** A local date and time (IST) as a stored UTC time. */
export const fromLocal = (date: string, hhmm: string): string => new Date(new Date(`${date}T${hhmm}:00.000Z`).getTime() - 330 * 60_000).toISOString();
export interface Calendar { view: 'week' | 'month'; start: string; end: string; title: string; prev: string; next: string; days: CalendarDay[]; interviews: Interview[]; all: boolean }
export function calendar(app: App, viewer: Employee, o: { view?: string; date?: string; interviewerId?: string; requisitionId?: string }, now = new Date()): Calendar {
  const today = localDateString(now); const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date! : today; const view = o.view === 'month' ? 'month' : 'week';
  const all = isRecruiter(app, viewer);
  let start: string, end: string, title: string, prev: string, next: string;
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (view === 'week') { start = mondayOf(date); end = addDay(start, 6); prev = addDay(start, -7); next = addDay(start, 7); title = `${Number(start.slice(8))} ${MON[Number(start.slice(5, 7)) - 1].slice(0, 3)} to ${Number(end.slice(8))} ${MON[Number(end.slice(5, 7)) - 1].slice(0, 3)} ${end.slice(0, 4)}`; }
  else { const first = `${date.slice(0, 7)}-01`; start = mondayOf(first); const t = new Date(`${first}T00:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); const nextFirst = t.toISOString().slice(0, 10); end = addDay(mondayOf(addDay(nextFirst, -1)), 6);
    const p = new Date(`${first}T00:00:00Z`); p.setUTCMonth(p.getUTCMonth() - 1); prev = p.toISOString().slice(0, 10); next = nextFirst; title = `${MON[Number(first.slice(5, 7)) - 1]} ${first.slice(0, 4)}`; }
  const where = ['i.starts_at >= ?', 'i.starts_at < ?', "i.status <> 'cancelled'"]; const p: Params = [fromLocal(start, '00:00'), fromLocal(addDay(end, 1), '00:00')];
  // HR sees every interview; anyone else sees the ones they sit on.
  const who = all ? o.interviewerId || '' : viewer.id;
  if (who) { where.push('EXISTS (SELECT 1 FROM interview_panel p WHERE p.interview_id = i.id AND p.interviewer_id = ?)'); p.push(who); }
  if (o.requisitionId) { where.push('a.requisition_id = ?'); p.push(o.requisitionId); }
  const rows = app.db.all<Interview>(`SELECT i.*, c.full_name AS candidate_name, r.title AS requisition_title, a.stage AS application_stage FROM interviews i JOIN applications a ON a.id = i.application_id JOIN candidates c ON c.id = a.candidate_id JOIN requisitions r ON r.id = a.requisition_id
    WHERE ${where.join(' AND ')} ORDER BY i.starts_at LIMIT 500`, p);
  for (const i of rows) i.panel = app.db.all<{ id: string; name: string }>('SELECT e.id, e.full_name AS name FROM interview_panel p JOIN employees e ON e.id = p.interviewer_id WHERE p.interview_id = ?', [i.id]);
  const days: CalendarDay[] = []; const month = date.slice(0, 7);
  for (let d = start; d <= end; d = addDay(d, 1)) { const idx = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; days.push({ date: d, label: String(Number(d.slice(8))), dow: DOW[idx], today: d === today, inMonth: view === 'week' || d.slice(0, 7) === month, interviews: rows.filter((i) => localParts(i.starts_at).date === d) }); }
  return { view, start, end, title, prev, next, days, interviews: rows, all };
}
/** Applications that can be given an interview from the calendar. */
export function schedulable(app: App): Application[] { return listApplications(app, { status: 'active', limit: 500 }).filter((a) => ['screening', 'assessment', 'interview', 'decision'].includes(a.stage)); }

// =====================================================================================================================
// 4. Message templates with fields filled in for each candidate
// =====================================================================================================================
export interface Template { key: string; name: string; subject: string; body: string; position: number; builtin: number; updated_at: string; updated_by_name?: string | null }
export const FIELDS: { key: string; label: string; sample: string }[] = [
  { key: 'candidate_name', label: 'Candidate\'s full name', sample: 'Priya Deshmukh' }, { key: 'first_name', label: 'Candidate\'s first name', sample: 'Priya' },
  { key: 'role', label: 'Role applied for', sample: 'Technical Support Executive' }, { key: 'department', label: 'Team', sample: 'Technical Support' }, { key: 'location', label: 'Work location', sample: 'Pune' },
  { key: 'interview_date', label: 'Interview date', sample: 'Monday, 30 November 2026' }, { key: 'interview_time', label: 'Interview time', sample: '11:00 AM' }, { key: 'interview_round', label: 'Interview round', sample: 'HR round' },
  { key: 'interview_mode', label: 'In person or online', sample: 'In person' }, { key: 'interview_place', label: 'Address or meeting link', sample: 'Plot No. 77, Sector 7, PCNTDA, Bhosari, Pune' }, { key: 'interviewers', label: 'Who will take the interview', sample: 'Amruta Junnarkar' },
  { key: 'offer_designation', label: 'Designation offered', sample: 'Technical Support Executive' }, { key: 'offer_ctc', label: 'Annual salary offered', sample: '₹3,60,000' }, { key: 'joining_date', label: 'Joining date', sample: '15 December 2026' }, { key: 'offer_valid_until', label: 'Offer valid until', sample: '5 December 2026' },
  { key: 'hold_until', label: 'On hold until', sample: '10 December 2026' }, { key: 'sender_name', label: 'Your name', sample: 'Amruta Junnarkar' }, { key: 'sender_title', label: 'Your designation', sample: 'Senior HR Specialist' }, { key: 'company', label: 'Company name', sample: 'Loyal String International Pvt. Ltd.' }
];
const SIGN = '\n\nRegards,\n{{sender_name}}\n{{sender_title}}, {{company}}';
const BUILTIN: { key: string; name: string; subject: string; body: string }[] = [
  { key: 'application_received', name: 'Application received', subject: 'We have your application for {{role}}', body: `Dear {{first_name}},\n\nThank you for applying for the {{role}} role at {{company}}. We have received your details and CV.\n\nWe will review them and write to you about the next step.${SIGN}` },
  { key: 'interview_invite', name: 'Interview invitation', subject: 'Interview for {{role}} on {{interview_date}}', body: `Dear {{first_name}},\n\nWe would like to invite you to the {{interview_round}} for the {{role}} role.\n\nDate: {{interview_date}}\nTime: {{interview_time}}\nHow: {{interview_mode}}\nWhere: {{interview_place}}\nWith: {{interviewers}}\n\nPlease reply to confirm that you can attend. If the time does not suit you, tell us and we will find another.${SIGN}` },
  { key: 'interview_reschedule', name: 'Interview moved', subject: 'Your interview for {{role}} has moved to {{interview_date}}', body: `Dear {{first_name}},\n\nYour {{interview_round}} for the {{role}} role has been moved.\n\nNew date: {{interview_date}}\nNew time: {{interview_time}}\nWhere: {{interview_place}}\n\nWe are sorry for the change. Please reply to confirm the new time.${SIGN}` },
  { key: 'on_hold', name: 'Application on hold', subject: 'Update on your application for {{role}}', body: `Dear {{first_name}},\n\nThank you for your time so far. We have paused the {{role}} hiring for a short while and expect to come back to you by {{hold_until}}.\n\nYour application stays with us and you do not need to do anything.${SIGN}` },
  { key: 'offer_letter', name: 'Offer', subject: 'Offer from {{company}}: {{offer_designation}}', body: `Dear {{first_name}},\n\nWe are pleased to offer you the position of {{offer_designation}} at {{company}}.\n\nAnnual salary: {{offer_ctc}}\nJoining date: {{joining_date}}\nLocation: {{location}}\n\nThis offer is valid until {{offer_valid_until}}. Please reply to accept, or call us with any questions.${SIGN}` },
  { key: 'rejection', name: 'Not going ahead', subject: 'Your application for {{role}}', body: `Dear {{first_name}},\n\nThank you for your interest in the {{role}} role and for the time you gave us.\n\nWe will not be taking your application further for this role. We will keep your details and may write to you if a suitable role opens.\n\nWe wish you well.${SIGN}` },
  { key: 'documents', name: 'Documents needed', subject: 'Documents needed before you join {{company}}', body: `Dear {{first_name}},\n\nBefore your joining date of {{joining_date}}, please send us copies of:\n\n1. Aadhaar and PAN\n2. Education certificates\n3. Last three salary slips and the relieving letter\n4. A cancelled cheque or bank passbook page\n5. Two passport-size photographs${SIGN}` }
];
function seedTemplates(app: App): void {
  if (app.db.get('SELECT key FROM hire_templates LIMIT 1')) return;
  BUILTIN.forEach((t, i) => app.db.run('INSERT INTO hire_templates (key, name, subject, body, position, builtin, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)', [t.key, t.name, t.subject, t.body, i, nowIso()]));
}
export function listTemplates(app: App): Template[] { seedTemplates(app); return app.db.all<Template>('SELECT t.*, e.full_name AS updated_by_name FROM hire_templates t LEFT JOIN employees e ON e.id = t.updated_by ORDER BY t.position, t.name'); }
export function getTemplate(app: App, key: string): Template | undefined { seedTemplates(app); return app.db.get<Template>('SELECT * FROM hire_templates WHERE key = ?', [key]); }
/** Fields used in a text that LoyalFlow does not know, so a typing mistake is caught before a candidate sees it. */
export function unknownFields(text: string): string[] { const known = new Set(FIELDS.map((f) => f.key)); return [...new Set([...text.matchAll(/\{\{\s*([\w ]+?)\s*\}\}/g)].map((m) => m[1].trim()).filter((k) => !known.has(k)))]; }
export function saveTemplate(app: App, actor: Employee, input: { key?: string; name?: string; subject?: string; body?: string }): Template {
  requireHr(app, actor); seedTemplates(app);
  const name = String(input.name || '').trim().slice(0, 80); const subject = String(input.subject || '').trim().slice(0, 200); const body = String(input.body || '').replace(/\r\n/g, '\n').trim().slice(0, 6000);
  if (name.length < 3) throw new HttpError(400, 'Give the template a name.'); if (subject.length < 3) throw new HttpError(400, 'Write the subject line.'); if (body.length < 20) throw new HttpError(400, 'Write the message.');
  const bad = unknownFields(`${subject}\n${body}`); if (bad.length) throw new HttpError(400, `LoyalFlow does not know ${bad.map((b) => `{{${b}}}`).join(', ')}. Choose fields from the list beside the message.`);
  let key = input.key || '';
  if (key) { if (!getTemplate(app, key)) throw new HttpError(404, 'That template does not exist.'); app.db.run('UPDATE hire_templates SET name = ?, subject = ?, body = ?, updated_by = ?, updated_at = ? WHERE key = ?', [name, subject, body, actor.id, nowIso(), key]); }
  else { key = `custom-${Date.now().toString(36)}`; const pos = app.db.get<{ n: number }>('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM hire_templates')!.n; app.db.run('INSERT INTO hire_templates (key, name, subject, body, position, builtin, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)', [key, name, subject, body, pos, actor.id, nowIso()]); }
  audit(app.db, { actorId: actor.id, entity: 'hire_template', entityId: key, action: input.key ? 'updated' : 'created', after: { name } });
  return getTemplate(app, key)!;
}
export function deleteTemplate(app: App, actor: Employee, key: string): void {
  requireHr(app, actor); const t = getTemplate(app, key); if (!t) throw new HttpError(404, 'That template does not exist.');
  if (t.builtin) throw new HttpError(400, 'The standard templates cannot be deleted. Edit the wording instead.');
  app.db.run('DELETE FROM hire_templates WHERE key = ?', [key]); audit(app.db, { actorId: actor.id, entity: 'hire_template', entityId: key, action: 'deleted', before: { name: t.name } });
}
export function resetTemplate(app: App, actor: Employee, key: string): Template {
  requireHr(app, actor); const b = BUILTIN.find((x) => x.key === key); if (!b) throw new HttpError(400, 'Only a standard template can be put back.');
  app.db.run('UPDATE hire_templates SET name = ?, subject = ?, body = ?, updated_by = ?, updated_at = ? WHERE key = ?', [b.name, b.subject, b.body, actor.id, nowIso(), key]); return getTemplate(app, key)!;
}
const longDate = (d: string | null | undefined): string => { if (!d) return ''; const t = new Date(`${d.slice(0, 10)}T00:00:00Z`); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };
/** The values for one candidate. The next or latest interview and the latest offer are used unless a particular interview is named. */
export function fieldValues(app: App, actor: Employee, applicationId: string, interviewId?: string): Record<string, string> {
  const a = getApplication(app, applicationId); if (!a) throw new HttpError(404, 'Application not found.');
  const req = getRequisition(app, a.requisition_id)!; const cand = getCandidate(app, a.candidate_id)!;
  // With no interview named: the next one still to come, or failing that the latest one booked.
  const pick = app.db.get<{ id: string }>("SELECT id FROM interviews WHERE application_id = ? AND status = 'scheduled' ORDER BY (starts_at >= ?) DESC, CASE WHEN starts_at >= ? THEN starts_at END ASC, starts_at DESC LIMIT 1", [a.id, nowIso(), nowIso()]);
  const iv = interviewId ? getInterview(app, interviewId) : pick ? getInterview(app, pick.id) : undefined;
  const offer = app.db.get<{ ctc_annual: number; designation: string; joining_date: string | null; expiry_date: string | null }>("SELECT ctc_annual, designation, joining_date, expiry_date FROM offers WHERE application_id = ? AND status NOT IN ('cancelled') ORDER BY created_at DESC LIMIT 1", [a.id]);
  const company = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'company.name'")?.value;
  let companyName = 'Loyal String International Pvt. Ltd.'; try { if (company) companyName = String(JSON.parse(company)) || companyName; } catch { /* keep the default */ }
  const out: Record<string, string> = { candidate_name: cand.full_name, first_name: cand.full_name.split(' ')[0], role: req.title, department: (req as Requisition & { department?: string }).department || '', location: req.location || 'Pune',
    sender_name: actor.full_name, sender_title: actor.designation, company: companyName, hold_until: longDate(a.hold_until),
    interview_date: '', interview_time: '', interview_round: '', interview_mode: '', interview_place: '', interviewers: '', offer_designation: '', offer_ctc: '', joining_date: '', offer_valid_until: '' };
  if (iv && iv.application_id === a.id) { const lp = localParts(iv.starts_at); const t = new Date(`${lp.date}T00:00:00Z`); const h = Math.floor(lp.minutes / 60), m = lp.minutes % 60;
    out.interview_date = t.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); out.interview_time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    out.interview_round = iv.round_name || `${iv.round_type.charAt(0).toUpperCase()}${iv.round_type.slice(1)} round`; out.interview_mode = iv.mode === 'video' ? 'Online' : iv.mode === 'phone' ? 'By phone' : 'In person'; out.interview_place = iv.location || ''; out.interviewers = (iv.panel || []).map((p) => p.name).join(', '); }
  if (offer) { out.offer_designation = offer.designation; out.offer_ctc = offer.ctc_annual ? inr(offer.ctc_annual) : ''; out.joining_date = longDate(offer.joining_date); out.offer_valid_until = longDate(offer.expiry_date); }
  return out;
}
/** Puts the values into a text. A field with no value yet is left visible, in square brackets, so it is not sent blank by mistake. */
export function fill(text: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const out = text.replace(/\{\{\s*([\w ]+?)\s*\}\}/g, (_m, k: string) => { const key = k.trim(); const v = values[key]; if (v) return v; missing.add(key); return `[${FIELDS.find((f) => f.key === key)?.label || key}]`; });
  return { text: out, missing: [...missing] };
}
export function compose(app: App, actor: Employee, applicationId: string, templateKey: string, interviewId?: string): { to: string; subject: string; body: string; missing: string[]; template: Template } {
  const a = getApplication(app, applicationId); if (!a) throw new HttpError(404, 'Application not found.');
  if (!canSeeApplication(app, actor, a)) throw new HttpError(403, 'You are not on this hire.');
  const t = getTemplate(app, templateKey); if (!t) throw new HttpError(404, 'That template does not exist.');
  const vals = fieldValues(app, actor, applicationId, interviewId); const s = fill(t.subject, vals), b = fill(t.body, vals);
  return { to: a.candidate_email || '', subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])], template: t };
}
export interface SentMessage { state: 'accepted' | 'failed' | 'uncertain' | 'manual'; detail: string; mailto: string }
/** HR sends the message as written. With Microsoft 365 mail set up it is emailed; otherwise it is recorded and HR sends it from their own mail. */
export async function sendMessage(app: App, actor: Employee, applicationId: string, input: { templateKey?: string; subject?: string; body?: string; interviewId?: string }): Promise<SentMessage> {
  requireHr(app, actor); const a = getApplication(app, applicationId); if (!a) throw new HttpError(404, 'Application not found.');
  const to = a.candidate_email || ''; if (!to) throw new HttpError(400, 'This candidate has no email address on record.');
  const subject = String(input.subject || '').trim().slice(0, 200); const body = String(input.body || '').replace(/\r\n/g, '\n').trim().slice(0, 8000);
  if (subject.length < 3 || body.length < 10) throw new HttpError(400, 'Write a subject and a message.');
  if (/\[[^\]\n]{3,40}\]/.test(`${subject}\n${body}`) && unresolved(`${subject}\n${body}`).length) throw new HttpError(400, `Fill in ${unresolved(`${subject}\n${body}`).map((x) => `[${x}]`).join(', ')} before sending.`);
  const kind = input.templateKey && getTemplate(app, input.templateKey) ? input.templateKey : 'message';
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  let state: SentMessage['state'] = 'manual', detail = 'Prepared; sent by HR from their own mail', ref = '';
  if (app.graph.configured) { const res = await app.graph.send({ to, subject, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(body).replace(/\n/g, '<br>')}</div>` }); state = res.state; detail = res.detail; ref = res.ref; }
  app.db.run('INSERT INTO hire_messages (application_id, kind, recipient, subject, state, detail, provider_ref, related_id, actor_id, at, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [a.id, kind, to, subject, state, detail, ref, input.interviewId || '', actor.id, nowIso(), body]);
  logEvent(app, a.id, 'message', `${state === 'accepted' ? 'Emailed' : state === 'manual' ? 'Prepared' : 'Tried to email'}: ${subject}`, actor.id);
  if (input.interviewId && (state === 'accepted' || state === 'manual')) app.db.run('UPDATE interviews SET candidate_informed = 1 WHERE id = ? AND application_id = ?', [input.interviewId, a.id]);
  return { state, detail, mailto };
}
/** Bracketed field labels still in a text, i.e. values that were not available when it was filled in. */
function unresolved(text: string): string[] { const labels = new Set(FIELDS.map((f) => f.label)); return [...new Set([...text.matchAll(/\[([^\]\n]{3,40})\]/g)].map((m) => m[1]).filter((l) => labels.has(l)))]; }

// =====================================================================================================================
// 5. Duplicate candidates
// =====================================================================================================================
export interface DupPair { a: Candidate & { apps: number }; b: Candidate & { apps: number }; why: string[]; strong: boolean }
const phoneKey = (p: string): string => { const d = (p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
/** Pairs of records that look like the same person: same email, same phone, or the same name. HR decides; nothing merges by itself. */
export function duplicatePairs(app: App): DupPair[] {
  const all = app.db.all<Candidate & { apps: number }>('SELECT c.*, (SELECT COUNT(*) FROM applications a WHERE a.candidate_id = c.id) AS apps FROM candidates c WHERE c.merged_into IS NULL ORDER BY c.created_at');
  const not = new Set(app.db.all<{ a: string; b: string }>('SELECT a, b FROM candidate_not_duplicates').map((r) => `${r.a}|${r.b}`));
  const pairs = new Map<string, DupPair>();
  const group = (keyOf: (c: Candidate) => string, why: string, strong: boolean): void => {
    const by = new Map<string, (Candidate & { apps: number })[]>(); for (const c of all) { const k = keyOf(c); if (k) by.set(k, [...(by.get(k) || []), c]); }
    for (const list of by.values()) for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [a, b] = list[i].id < list[j].id ? [list[i], list[j]] : [list[j], list[i]]; const key = `${a.id}|${b.id}`; if (not.has(key)) continue;
      const p = pairs.get(key) || { a, b, why: [], strong: false }; p.why.push(why); p.strong = p.strong || strong; pairs.set(key, p);
    }
  };
  group((c) => c.email_normalized, 'Same email', true); group((c) => phoneKey(c.phone), 'Same phone', true); group((c) => (c.full_name.trim().length > 4 ? c.full_name.trim().toLowerCase().replace(/\s+/g, ' ') : ''), 'Same name', false);
  return [...pairs.values()].sort((x, y) => Number(y.strong) - Number(x.strong) || y.why.length - x.why.length);
}
export function notDuplicates(app: App, actor: Employee, idA: string, idB: string): void {
  requireHr(app, actor); const [a, b] = idA < idB ? [idA, idB] : [idB, idA]; if (a === b || !getCandidate(app, a) || !getCandidate(app, b)) throw new HttpError(400, 'Choose two different candidates.');
  app.db.run('INSERT OR IGNORE INTO candidate_not_duplicates (a, b, by, at) VALUES (?, ?, ?, ?)', [a, b, actor.id, nowIso()]);
  audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: a, action: 'not_duplicate_of', after: { other: b } });
}
export const MERGE_FIELDS: { key: keyof Candidate; label: string }[] = [{ key: 'full_name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' }, { key: 'current_employer', label: 'Now at' }, { key: 'experience_years', label: 'Experience (years)' },
  { key: 'current_ctc', label: 'Current salary' }, { key: 'expected_ctc', label: 'Expected salary' }, { key: 'notice_days', label: 'Notice (days)' }, { key: 'location', label: 'Location' }];
export interface MergeResult { keptId: string; moved: number; closed: number }
/**
 * Merge `otherId` into `keepId`. For each field HR says whose value to keep ('keep' or 'other'); a blank side never wins.
 * Applications move to the kept record. Where both applied to the same vacancy, the one that got further stays active on the
 * kept record and the other is closed as a duplicate. The other record is hidden, not deleted, so its history can be traced.
 */
export function mergeCandidates(app: App, actor: Employee, keepId: string, otherId: string, choose: Record<string, string> = {}): MergeResult {
  requireHr(app, actor); if (keepId === otherId) throw new HttpError(400, 'Choose two different candidates.');
  type Row = Candidate & { merged_into: string | null; cv_name: string; cv_mime: string; cv_summary: string; cv_data: string; cv_source: string; cv_uploaded_at: string | null };
  const keep = app.db.get<Row>('SELECT * FROM candidates WHERE id = ?', [keepId]); const other = app.db.get<Row>('SELECT * FROM candidates WHERE id = ?', [otherId]);
  if (!keep || !other) throw new HttpError(404, 'Candidate not found.'); if (keep.merged_into || other.merged_into) throw new HttpError(400, 'One of these records has already been merged.');
  const blank = (v: unknown): boolean => v === null || v === undefined || v === '';
  const val: Record<string, unknown> = {};
  for (const f of MERGE_FIELDS) { const k = keep[f.key], o = other[f.key]; val[f.key] = blank(k) ? o : blank(o) ? k : choose[f.key] === 'other' ? o : k; }
  const cvFromOther = !blank(other.cv_path) && (blank(keep.cv_path) || choose.cv === 'other'); const at = nowIso(); let moved = 0, closed = 0;
  const rank = (s: string): number => (STAGES as readonly string[]).indexOf(s);
  app.db.transaction(() => {
    for (const oa of app.db.all<{ id: string; requisition_id: string; stage: string; status: string }>('SELECT id, requisition_id, stage, status FROM applications WHERE candidate_id = ?', [otherId])) {
      const ka = app.db.get<{ id: string; stage: string; status: string }>('SELECT id, stage, status FROM applications WHERE candidate_id = ? AND requisition_id = ?', [keepId, oa.requisition_id]);
      if (!ka) { app.db.run('UPDATE applications SET candidate_id = ?, updated_at = ? WHERE id = ?', [keepId, at, oa.id]); logEvent(app, oa.id, 'merge', `Record ${otherId} was merged into ${keepId}`, actor.id); moved++; continue; }
      // Both records applied to the same vacancy: the application that got further carries on under the kept record.
      const otherAhead = (oa.status === 'active' && ka.status !== 'active') || (oa.status === ka.status && rank(oa.stage) > rank(ka.stage));
      const [win, lose] = otherAhead ? [oa.id, ka.id] : [ka.id, oa.id];
      // The unique rule allows one application per person per vacancy, so the one that stops goes to the hidden record first.
      if (otherAhead) {   // swap the two through a placeholder: both rows cannot point at the same person for the same vacancy, even for a moment
        app.db.exec('PRAGMA defer_foreign_keys = ON'); app.db.run("UPDATE applications SET candidate_id = '~swap' WHERE id = ?", [lose]);
        app.db.run('UPDATE applications SET candidate_id = ?, updated_at = ? WHERE id = ?', [keepId, at, win]); app.db.run('UPDATE applications SET candidate_id = ? WHERE id = ?', [otherId, lose]);
      }
      app.db.run("UPDATE applications SET status = 'closed', outcome = 'duplicate', outcome_reason = ?, decision_by = ?, decision_at = ?, updated_at = ? WHERE id = ? AND status <> 'closed'", [`Duplicate of ${win}; the two candidate records were merged`, actor.id, at, at, lose]);
      logEvent(app, lose, 'merge', `Closed as a duplicate of ${win}`, actor.id); logEvent(app, win, 'merge', `Records ${keepId} and ${otherId} were merged; ${lose} was the duplicate application`, actor.id); closed++;
    }
    const notes = [keep.notes, other.notes].filter((n) => n && n.trim()).join('\n').slice(0, 4000);
    app.db.run('UPDATE candidates SET full_name = ?, email = ?, email_normalized = ?, phone = ?, current_employer = ?, experience_years = ?, current_ctc = ?, expected_ctc = ?, notice_days = ?, location = ?, notes = ?, consent_at = COALESCE(consent_at, ?), updated_at = ? WHERE id = ?',
      [val.full_name, val.email || '', normalizeEmail(String(val.email || '')), val.phone || '', val.current_employer || '', val.experience_years ?? null, val.current_ctc ?? null, val.expected_ctc ?? null, val.notice_days ?? null, val.location || '', notes, other.consent_at, at, keepId] as Params);
    if (cvFromOther) app.db.run('UPDATE candidates SET cv_path = ?, cv_name = ?, cv_mime = ?, cv_text = ?, cv_summary = ?, cv_data = ?, cv_source = ?, cv_uploaded_at = ? WHERE id = ?', [other.cv_path, other.cv_name, other.cv_mime, other.cv_text, other.cv_summary, other.cv_data, other.cv_source, other.cv_uploaded_at, keepId]);
    // The hidden record keeps no email or phone, so it cannot be matched again.
    app.db.run("UPDATE candidates SET merged_into = ?, merged_at = ?, merged_by = ?, email_normalized = '', updated_at = ? WHERE id = ?", [keepId, at, actor.id, at, otherId]);
    app.db.run('DELETE FROM candidate_not_duplicates WHERE a = ? OR b = ?', [otherId, otherId]);
    audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: keepId, action: 'merged', before: { other: otherId, name: other.full_name, email: other.email, phone: other.phone }, after: { moved, closed, fields: choose } });
  });
  return { keptId: keepId, moved, closed };
}
