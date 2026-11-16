// CV upload, reading and summary — for one candidate, and in bulk for a vacancy (up to 20 files).
// Reading order: Gemini if a key is saved (handles PDFs, including scans); otherwise rules inside the app
// (reliable for Word files and simple PDFs, and honest when it cannot read a file).
import { number as limit } from '../../lib/lists.ts';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { unzip } from '../../lib/tabular.ts';
import { createGemini, cleanCvData, EMPTY_CV, DEFAULT_GEMINI_MODEL, type CvData, type AiResult, type CvInput } from '../../lib/gemini.ts';
import type { Employee } from '../people/model.ts';
import { getCandidate, getRequisition, isRecruiter, saveCandidate, addApplication, findDuplicates, listApplications, canSeeApplication, type Candidate } from './recruiting.ts';

/** HR, or anyone working on a hire that this candidate is part of. */
export function canSeeCandidate(app: App, user: Employee, candidateId: string): boolean {
  if (isRecruiter(app, user)) return true;
  return listApplications(app, { candidateId, limit: 50 }).some((a) => canSeeApplication(app, user, a));
}

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const MAX_BULK = 20;
const TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.txt': 'text/plain' };
const nowIso = () => new Date().toISOString();

// ---------- Settings (kept in the settings table; the key is encrypted at rest) ----------

const keyOf = (app: App): Buffer => createHash('sha256').update(`hire-ai:${app.cfg.assessmentSecret || app.cfg.sessionSecret}`).digest();
function seal(app: App, plain: string): string { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', keyOf(app), iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return `${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`; }
function unseal(app: App, sealed: string): string { try { const [iv, tag, ct] = sealed.split('.').map((x) => Buffer.from(x, 'base64url')); const d = createDecipheriv('aes-256-gcm', keyOf(app), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString('utf8'); } catch { return ''; } }
const rawSetting = (app: App, key: string): string => { const r = app.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]); if (!r) return ''; try { return String(JSON.parse(r.value)); } catch { return ''; } };
const putSetting = (app: App, key: string, value: string, by: string): void => { app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', [key, JSON.stringify(value), nowIso(), by]); };

export interface AiSettings { enabled: boolean; hasKey: boolean; keyHint: string; model: string }
export function aiSettings(app: App): AiSettings {
  const key = unseal(app, rawSetting(app, 'hire.ai.gemini_key')) || process.env.GEMINI_API_KEY || '';
  return { enabled: rawSetting(app, 'hire.ai.enabled') !== 'off' && !!key, hasKey: !!key, keyHint: key ? `••••${key.slice(-4)}` : '', model: rawSetting(app, 'hire.ai.model') || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL };
}
export function saveAiSettings(app: App, actor: Employee, input: { apiKey?: string; model?: string; enabled?: boolean; clearKey?: boolean }): AiSettings {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR changes hiring settings.');
  if (input.clearKey) putSetting(app, 'hire.ai.gemini_key', '', actor.id);
  else if (input.apiKey && input.apiKey.trim()) {
    const k = input.apiKey.trim();
    if (k.length < 20 || /\s/.test(k)) throw new HttpError(400, 'That does not look like an API key. Paste the whole key from Google AI Studio.');
    putSetting(app, 'hire.ai.gemini_key', seal(app, k), actor.id);
  }
  if (input.model !== undefined) { const m = input.model.trim(); if (m && !/^[A-Za-z0-9._\-/]+$/.test(m)) throw new HttpError(400, 'The model name can only have letters, numbers, dots and dashes.'); putSetting(app, 'hire.ai.model', m, actor.id); }
  if (input.enabled !== undefined) putSetting(app, 'hire.ai.enabled', input.enabled ? 'on' : 'off', actor.id);
  audit(app.db, { actorId: actor.id, entity: 'settings', entityId: 'hire.ai', action: 'updated', after: { keyChanged: !!(input.apiKey || input.clearKey), model: input.model, enabled: input.enabled } });
  return aiSettings(app);
}

/** Tests replace this to avoid the network. */
export const aiHook: { extract: ((app: App, input: CvInput) => Promise<AiResult>) | null } = { extract: null };
async function aiExtract(app: App, input: CvInput): Promise<AiResult> {
  if (aiHook.extract) return aiHook.extract(app, input);
  const s = aiSettings(app);
  if (!s.enabled) return { ok: false, error: 'AI reading is off.' };
  const key = unseal(app, rawSetting(app, 'hire.ai.gemini_key')) || process.env.GEMINI_API_KEY || '';
  const client = createGemini({ apiKey: key, model: s.model });
  let res = await client.extract(input);
  // The free tier allows only a few requests a minute. One patient retry is enough for a bulk upload to get through.
  if (!res.ok && res.retryable) { await new Promise((r) => setTimeout(r, 6000)); res = await client.extract(input); }
  return res;
}
export async function testAi(app: App, actor: Employee): Promise<AiResult> {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR changes hiring settings.');
  return aiExtract(app, { text: 'Asha Verma\nasha.verma@example.com | +91 90000 00000 | Pune\nSupport Engineer, Example Retail Pvt Ltd, 2022 to present. Handles ERP tickets for 40 stores.\nB.Com, Pune University, 2021.' });
}

// ---------- Reading a file without AI ----------

function decodeXml(s: string): string { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))); }
export function docxText(buf: Buffer): string {
  const files = unzip(buf);
  const doc = files.get('word/document.xml');
  if (!doc) return '';
  const xml = doc.toString('utf8');
  return decodeXml(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * A small PDF text reader: unpacks the page streams and collects the strings they draw. It works for ordinary text PDFs
 * with standard fonts. It cannot read scans, and PDFs with custom font encodings come out as nonsense — `looksLikeText`
 * catches that so we say "could not read" instead of saving rubbish.
 */
export function pdfText(buf: Buffer): string {
  const out: string[] = [];
  const bin = buf.toString('latin1');
  const re = /stream\r?\n/g; let m: RegExpExecArray | null;
  while ((m = re.exec(bin))) {
    const start = m.index + m[0].length; const end = bin.indexOf('endstream', start);
    if (end < 0) break;
    const dict = bin.slice(Math.max(0, m.index - 400), m.index);
    let data: Buffer = buf.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) { try { data = inflateSync(data); } catch { continue; } }
    else if (/\/Filter/.test(dict)) continue;
    const s = data.toString('latin1');
    if (!/\bBT\b/.test(s)) continue;
    const lit = (t: string): string => t.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '' : c === 't' ? ' ' : /^[0-7]/.test(c) ? String.fromCharCode(parseInt(c, 8)) : c === 'b' || c === 'f' ? '' : c));
    const hex = (h: string): string => { const clean = h.replace(/\s+/g, ''); let r = ''; if (clean.length % 4 === 0 && /^(00[0-9A-Fa-f]{2})+$/.test(clean)) { for (let i = 0; i < clean.length; i += 4) r += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16)); } else for (let i = 0; i + 1 < clean.length; i += 2) r += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16)); return r; };
    const tok = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")|<([0-9A-Fa-f\s]+)>\s*Tj|(T\*|\bET\b|\bTd\b|\bTD\b|\bTm\b)/g; let t: RegExpExecArray | null; let line = '';
    while ((t = tok.exec(s))) {
      if (t[1] !== undefined) line += t[1].replace(/\(((?:[^()\\]|\\.)*)\)|<([0-9A-Fa-f\s]+)>|(-?\d+(?:\.\d+)?)/g, (_, a?: string, h?: string, n?: string) => (a !== undefined ? lit(a) : h !== undefined ? hex(h) : Number(n) < -180 ? ' ' : ''));
      else if (t[2] !== undefined) line += lit(t[2]);
      else if (t[3] !== undefined) line += hex(t[3]);
      else if (line.trim()) { out.push(line.trim()); line = ''; }
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export function looksLikeText(s: string): boolean {
  if (s.length < 80) return false;
  const letters = (s.match(/[A-Za-z]/g) || []).length; const words = (s.match(/\b[A-Za-z]{3,}\b/g) || []).length;
  return letters / s.length > 0.55 && words > 25;
}

const SKILL_WORDS = ['excel', 'tally', 'sap', 'erp', 'crm', 'sql', 'mysql', 'postgresql', 'mongodb', 'javascript', 'typescript', 'node', 'react', 'angular', 'java', 'python', 'c#', '.net', 'php', 'html', 'css', 'android', 'flutter', 'aws', 'azure', 'docker', 'git', 'rest api', 'testing', 'selenium', 'jira', 'rfid', 'barcode', 'inventory', 'billing', 'gst', 'accounting', 'payroll', 'recruitment', 'customer support', 'technical support', 'sales', 'pre-sales', 'lead generation', 'negotiation', 'marketing', 'seo', 'photoshop', 'autocad', 'soldering', 'pcb', 'embedded', 'iot', 'networking', 'hardware', 'installation', 'training', 'jewellery', 'retail', 'procurement', 'logistics', 'quality control', 'production planning', 'ms office', 'power bi'];
/** Rules, not intelligence: finds what a pattern can find and writes a plain summary from it. */
export function rulesExtract(text: string): CvData {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const email = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0].toLowerCase();
  const phone = ((text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/) || text.match(/\+?\d[\d\s-]{8,14}\d/)) || [''])[0].replace(/\s+/g, ' ').trim();
  const nameLine = lines.slice(0, 6).find((l) => /^[A-Za-z][A-Za-z.' -]{2,48}$/.test(l) && l.split(/\s+/).length <= 5 && !/curriculum|resume|vitae|profile|objective|summary|contact/i.test(l)) || '';
  const fullName = nameLine.replace(/\s+/g, ' ').replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
  const ym = text.match(/(\d{1,2}(?:\.\d)?)\+?\s*(?:years|yrs)(?:\s+(?:of|and))?/i);
  const lower = text.toLowerCase();
  const skills = SKILL_WORDS.filter((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')}([^a-z0-9]|$)`).test(lower)).slice(0, 12);
  const education = lines.filter((l) => /\b(b\.?\s?tech|b\.?e\.?|m\.?\s?tech|mba|b\.?\s?com|m\.?\s?com|b\.?sc|m\.?sc|bca|mca|bba|diploma|iti|h\.?s\.?c|s\.?s\.?c|bachelor|master)\b/i.test(l) && l.length < 160).slice(0, 3);
  const job = lines.find((l) => /\b(present|current|till date|to date)\b/i.test(l) && l.length < 140) || '';
  const years = ym ? Number(ym[1]) : null;
  const bits = [years != null ? `States ${years} years of experience.` : '', job ? `Most recent role line: "${job}".` : '', skills.length ? `Mentions ${skills.slice(0, 8).join(', ')}.` : '', education.length ? `Education: ${education[0]}.` : ''].filter(Boolean);
  return cleanCvData({ fullName, email, phone, location: '', currentEmployer: '', currentRole: '', experienceYears: years, skills, education, summary: bits.length ? `${bits.join(' ')} (Summary built by simple rules, not AI — read the CV before relying on it.)` : '' });
}

// ---------- Reading one file ----------

export interface ReadResult { data: CvData; text: string; source: 'ai' | 'rules' | 'none'; note: string }
export function checkFile(name: string, size: number): { ext: string; mime: string } {
  const ext = extname(name).toLowerCase();
  if (!TYPES[ext]) throw new HttpError(400, `"${name}" is not a PDF, Word (.docx) or text file. Old .doc files need to be saved as .docx or PDF first.`);
  if (size > MAX_CV_BYTES) throw new HttpError(400, `"${name}" is larger than 5 MB.`);
  if (size < 100) throw new HttpError(400, `"${name}" is empty.`);
  return { ext, mime: TYPES[ext] };
}
export async function readCv(app: App, name: string, buf: Buffer): Promise<ReadResult> {
  const { ext, mime } = checkFile(name, buf.length);
  if (ext === '.pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, `"${name}" is not a real PDF file.`);
  if (ext === '.docx' && buf.subarray(0, 2).toString('latin1') !== 'PK') throw new HttpError(400, `"${name}" is not a real Word file.`);
  let text = '';
  try { text = ext === '.docx' ? docxText(buf) : ext === '.txt' ? buf.toString('utf8') : pdfText(buf); } catch { text = ''; }
  const readable = ext === '.pdf' ? looksLikeText(text) : text.trim().length > 40;
  if (!readable && ext === '.pdf') text = '';
  const ai = aiSettings(app);
  if (ai.enabled || aiHook.extract) {
    const res = await aiExtract(app, ext === '.pdf' ? { file: { mime, base64: buf.toString('base64') } } : { text });
    if (res.ok && res.data) return { data: res.data, text, source: 'ai', note: '' };
    if (readable) return { data: rulesExtract(text), text, source: 'rules', note: `AI reading failed (${res.error}). Filled by simple rules instead.` };
    return { data: { ...EMPTY_CV }, text: '', source: 'none', note: `Could not read this file. ${res.error || ''} Fill the details in by hand.`.trim() };
  }
  if (readable) return { data: rulesExtract(text), text, source: 'rules', note: 'Filled by simple rules. Add a Gemini key under Hiring → Settings for a proper summary.' };
  return { data: { ...EMPTY_CV }, text: '', source: 'none', note: 'Could not read this file — it looks like a scan or uses an unusual font. Fill the details in by hand, or add a Gemini key under Hiring → Settings, which can read scans.' };
}

// ---------- Storage ----------

const cvRoot = (app: App): string => join(app.cfg.dataDir, 'cv');
function store(app: App, folder: string, name: string, buf: Buffer): string {
  const rel = join(folder, `${randomBytes(8).toString('hex')}${extname(name).toLowerCase()}`);
  const abs = join(cvRoot(app), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf, { mode: 0o600 });
  return rel;
}
export function cvFile(app: App, actor: Employee, candidateId: string): { buf: Buffer; name: string; mime: string } {
  if (!canSeeCandidate(app, actor, candidateId)) throw new HttpError(403, 'You are not on a hire for this candidate.');
  const c = getCandidate(app, candidateId) as (Candidate & CvColumns) | undefined;
  if (!c || !c.cv_path) throw new HttpError(404, 'No CV has been uploaded for this candidate.');
  const abs = join(cvRoot(app), c.cv_path);
  if (!abs.startsWith(cvRoot(app)) || !existsSync(abs)) throw new HttpError(404, 'The CV file is missing.');
  audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: candidateId, action: 'cv_opened' });
  return { buf: readFileSync(abs), name: c.cv_name || 'cv', mime: c.cv_mime || 'application/octet-stream' };
}
export interface CvColumns { cv_name: string; cv_mime: string; cv_summary: string; cv_data: string; cv_source: string; cv_uploaded_at: string | null }
export function cvOf(app: App, candidateId: string): { name: string; summary: string; source: string; uploadedAt: string | null; data: CvData } | undefined {
  const c = app.db.get<CvColumns & { cv_path: string }>('SELECT cv_path, cv_name, cv_mime, cv_summary, cv_data, cv_source, cv_uploaded_at FROM candidates WHERE id = ?', [candidateId]);
  if (!c || (!c.cv_path && !c.cv_summary)) return undefined;
  let data: CvData = { ...EMPTY_CV }; try { data = cleanCvData(JSON.parse(c.cv_data)); } catch { /* empty */ }
  return { name: c.cv_name, summary: c.cv_summary, source: c.cv_source, uploadedAt: c.cv_uploaded_at, data };
}
function attach(app: App, actor: Employee, candidateId: string, rel: string, name: string, mime: string, r: { data: CvData; text: string; source: string }, summary: string): void {
  app.db.run('UPDATE candidates SET cv_path = ?, cv_name = ?, cv_mime = ?, cv_text = ?, cv_summary = ?, cv_data = ?, cv_source = ?, cv_uploaded_at = ?, updated_at = ? WHERE id = ?',
    [rel, name.slice(0, 160), mime, r.text.slice(0, 60_000), summary.slice(0, 1200), JSON.stringify(r.data), r.source, nowIso(), nowIso(), candidateId]);
  audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: candidateId, action: 'cv_uploaded', after: { name, source: r.source } });
}

/** One CV for an existing candidate. Fills the summary; fills contact and experience fields only where they are empty. */
export async function uploadCv(app: App, actor: Employee, candidateId: string, name: string, buf: Buffer): Promise<ReadResult> {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR uploads a CV.');
  const c = getCandidate(app, candidateId);
  if (!c) throw new HttpError(404, 'Candidate not found.');
  const r = await readCv(app, name, buf);
  const rel = store(app, candidateId, name, buf);
  attach(app, actor, candidateId, rel, name, checkFile(name, buf.length).mime, r, r.data.summary);
  const d = r.data;
  app.db.run(`UPDATE candidates SET phone = CASE WHEN phone = '' THEN ? ELSE phone END, current_employer = CASE WHEN current_employer = '' THEN ? ELSE current_employer END,
    experience_years = COALESCE(experience_years, ?), location = CASE WHEN location = '' THEN ? ELSE location END WHERE id = ?`, [d.phone, d.currentEmployer, d.experienceYears, d.location, candidateId]);
  return r;
}
export function saveSummary(app: App, actor: Employee, candidateId: string, summary: string): void {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR edits the summary.');
  if (!getCandidate(app, candidateId)) throw new HttpError(404, 'Candidate not found.');
  app.db.run("UPDATE candidates SET cv_summary = ?, cv_source = CASE WHEN cv_source = '' THEN 'manual' ELSE cv_source || '+edited' END, updated_at = ? WHERE id = ?", [summary.trim().slice(0, 1200), nowIso(), candidateId]);
  audit(app.db, { actorId: actor.id, entity: 'candidate', entityId: candidateId, action: 'cv_summary_edited' });
}

// ---------- Bulk upload ----------

export interface StagedCv { id: number; batch_id: string; requisition_id: string; file_name: string; data: CvData; source: string; note: string; duplicates: { id: string; full_name: string; why: string }[] }
function stagedRow(app: App, row: { id: number; batch_id: string; requisition_id: string; file_name: string; parsed: string; source: string; note: string }): StagedCv {
  let data: CvData = { ...EMPTY_CV }; try { data = cleanCvData(JSON.parse(row.parsed)); } catch { /* empty */ }
  const dups = data.fullName || data.email || data.phone ? findDuplicates(app, { fullName: data.fullName || '—', email: data.email, phone: data.phone }) : [];
  return { id: row.id, batch_id: row.batch_id, requisition_id: row.requisition_id, file_name: row.file_name, data, source: row.source, note: row.note, duplicates: dups.map((d) => ({ id: d.id, full_name: d.full_name, why: (d as { why?: string }).why || 'same email, phone or name' })) };
}
export function newBatch(app: App, actor: Employee, requisitionId: string): string {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR uploads CVs.');
  const req = getRequisition(app, requisitionId);
  if (!req) throw new HttpError(404, 'Vacancy not found.');
  if (req.status !== 'open') throw new HttpError(400, 'CVs can be added only to an open vacancy.');
  return `${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}
/** One file of a bulk upload: stored aside, read, and handed back for HR to check. Nothing is created yet. */
export async function stageCv(app: App, actor: Employee, requisitionId: string, batchId: string, name: string, buf: Buffer): Promise<StagedCv> {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR uploads CVs.');
  if (!/^[a-z0-9]{10,40}$/.test(batchId)) throw new HttpError(400, 'Unknown batch.');
  const req = getRequisition(app, requisitionId);
  if (!req || req.status !== 'open') throw new HttpError(400, 'CVs can be added only to an open vacancy.');
  const count = app.db.get<{ n: number }>('SELECT count(*) AS n FROM cv_staging WHERE batch_id = ?', [batchId])?.n || 0;
  if (count >= limit('hire.cvBulkMax')) throw new HttpError(400, `A batch can hold at most ${limit('hire.cvBulkMax')} CVs.`);
  const r = await readCv(app, name, buf);
  const rel = store(app, join('_staging', batchId), name, buf);
  const res = app.db.run('INSERT INTO cv_staging (batch_id, requisition_id, file_name, mime, path, text, parsed, source, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [batchId, requisitionId, name.slice(0, 160), checkFile(name, buf.length).mime, rel, r.text.slice(0, 60_000), JSON.stringify(r.data), r.source, r.note, actor.id, nowIso()]);
  return stagedRow(app, app.db.get('SELECT * FROM cv_staging WHERE id = ?', [Number(res.lastInsertRowid)])!);
}
export function stagedBatch(app: App, batchId: string): StagedCv[] {
  return app.db.all<Parameters<typeof stagedRow>[1]>('SELECT * FROM cv_staging WHERE batch_id = ? ORDER BY id', [batchId]).map((r) => stagedRow(app, r));
}
export interface BulkRow { stagingId: number; include: boolean; fullName: string; email?: string; phone?: string; experienceYears?: number | null; currentEmployer?: string; location?: string; summary?: string; allowDuplicate?: boolean }
/** HR has checked the table. Create a candidate and an application for each ticked row; report every row's outcome. */
export function commitBatch(app: App, actor: Employee, requisitionId: string, batchId: string, rows: BulkRow[], source: string): { created: { name: string; applicationId: string }[]; skipped: { name: string; reason: string }[] } {
  if (!isRecruiter(app, actor)) throw new HttpError(403, 'Only HR uploads CVs.');
  const req = getRequisition(app, requisitionId);
  if (!req || req.status !== 'open') throw new HttpError(400, 'CVs can be added only to an open vacancy.');
  const created: { name: string; applicationId: string }[] = []; const skipped: { name: string; reason: string }[] = [];
  const staged = new Map(app.db.all<{ id: number; file_name: string; mime: string; path: string; text: string; parsed: string; source: string }>('SELECT * FROM cv_staging WHERE batch_id = ? AND requisition_id = ?', [batchId, requisitionId]).map((s) => [s.id, s]));
  for (const row of rows.slice(0, limit('hire.cvBulkMax'))) {
    const st = staged.get(Number(row.stagingId));
    if (!st) { skipped.push({ name: row.fullName || '?', reason: 'File not found in this batch' }); continue; }
    const label = (row.fullName || '').trim() || st.file_name;
    if (!row.include) { skipped.push({ name: label, reason: 'Left out by you' }); continue; }
    if ((row.fullName || '').trim().length < 2) { skipped.push({ name: st.file_name, reason: 'No name — type the name and try again' }); continue; }
    const dups = findDuplicates(app, { fullName: row.fullName, email: row.email, phone: row.phone });
    if (dups.length && !row.allowDuplicate) { skipped.push({ name: label, reason: `Looks like ${dups[0].full_name}, who is already a candidate. Tick "add anyway" to create a second record.` }); continue; }
    try {
      const c = saveCandidate(app, actor, { fullName: row.fullName.trim(), email: row.email, phone: row.phone, currentEmployer: row.currentEmployer, experienceYears: row.experienceYears ?? null, location: row.location });
      const a = addApplication(app, actor, { candidateId: c.id, requisitionId, source: source || 'direct' });
      let data: CvData = { ...EMPTY_CV }; try { data = cleanCvData(JSON.parse(st.parsed)); } catch { /* empty */ }
      const rel = join(c.id, st.path.split(/[\\/]/).pop()!);
      const from = join(cvRoot(app), st.path), to = join(cvRoot(app), rel);
      mkdirSync(dirname(to), { recursive: true }); if (existsSync(from)) renameSync(from, to);
      attach(app, actor, c.id, rel, st.file_name, st.mime, { data, text: st.text, source: st.source }, (row.summary ?? data.summary) || '');
      app.db.run('DELETE FROM cv_staging WHERE id = ?', [st.id]);
      created.push({ name: label, applicationId: a.id });
    } catch (e) { skipped.push({ name: label, reason: e instanceof HttpError ? e.message : 'Could not be created' }); }
  }
  // Whatever is left of the batch (rows left out) is removed, files included.
  for (const st of app.db.all<{ id: number; path: string }>('SELECT id, path FROM cv_staging WHERE batch_id = ?', [batchId])) { try { rmSync(join(cvRoot(app), st.path), { force: true }); } catch { /* gone */ } app.db.run('DELETE FROM cv_staging WHERE id = ?', [st.id]); }
  audit(app.db, { actorId: actor.id, entity: 'requisition', entityId: requisitionId, action: 'bulk_cv', after: { created: created.length, skipped: skipped.length } });
  return { created, skipped };
}
