// Master lists: every drop-down, label and small number that HR or an admin may want to change without a developer.
// Stored in the settings table under 'lists' and 'numbers'. Modules read the current state through items() / label() / num(),
// or register a hook that copies the list into their own constants.
import type { Db } from '../db/index.ts';
import { audit } from './audit.ts';

export interface ListItem { value: string; label: string; labelHi?: string; n?: number; active: boolean }
export interface ListDef {
  key: string; module: string; title: string; help: string;
  /** open: entries can be added and switched off. fixed: the entries are steps the app depends on; only their names (and number) change. */
  mode: 'open' | 'fixed';
  /** text: the record stores the wording itself. code: the record stores a short code, so renaming also renames old records. */
  stores: 'text' | 'code';
  number?: { label: string; min: number; max: number };
  hindi?: boolean;
  /** Codes that cannot be switched off in an open list. */
  keep?: string[];
  defaults: ListItem[];
}
export interface NumberDef { key: string; module: string; title: string; help: string; min: number; max: number; def: number }

const on = (value: string, label: string, n?: number, labelHi?: string): ListItem => ({ value, label, active: true, ...(n == null ? {} : { n }), ...(labelHi ? { labelHi } : {}) });
const text = (...labels: string[]): ListItem[] => labels.map((l) => on(l, l));

export const MODULES = ['Organisation', 'Sales', 'Support', 'Development', 'Production', 'Finance', 'Attendance and leave', 'Hiring', 'Appraisals'] as const;

export const LIST_DEFS: ListDef[] = [
  // Sales
  { key: 'sales.sources', module: 'Sales', title: 'Lead sources', help: 'Where a new lead came from.', mode: 'open', stores: 'text', defaults: text('Referral', 'Website', 'Campaign', 'Exhibition', 'Cold call', 'Existing customer', 'Other') },
  { key: 'sales.lostReasons', module: 'Sales', title: 'Reasons a deal is lost', help: 'Chosen when a deal is marked lost.', mode: 'open', stores: 'text', defaults: text('Price', 'Timeline', 'Feature gap', 'No budget', 'Chose competitor', 'No response') },
  { key: 'sales.stages', module: 'Sales', title: 'Pipeline stages', help: 'Rename a stage and set its chance of winning, used for the weighted pipeline and the demand forecast. The order and number of stages are fixed.', mode: 'fixed', stores: 'code', number: { label: 'Win chance %', min: 0, max: 100 },
    defaults: [on('new', 'New lead', 10), on('contacted', 'Contacted', 20), on('qualified', 'Qualified', 40), on('demo', 'Demo', 55), on('proposal', 'Proposal', 70), on('negotiation', 'Negotiation', 85), on('won', 'Won', 100), on('lost', 'Lost', 0)] },
  { key: 'sales.currencies', module: 'Sales', title: 'Currencies', help: 'Currencies a deal can be priced in.', mode: 'open', stores: 'text', keep: ['INR'], defaults: text('INR', 'USD', 'AED', 'EUR') },
  { key: 'sales.outcomes', module: 'Sales', title: 'Call and visit outcomes', help: 'How a call, visit or demo went.', mode: 'open', stores: 'code', defaults: [on('positive', 'Positive'), on('neutral', 'Neutral'), on('no_answer', 'No answer'), on('objection', 'Objection')] },
  { key: 'sales.units', module: 'Sales', title: 'Units', help: 'Units a product is sold in, shown on estimates.', mode: 'open', stores: 'text', keep: ['Nos'], defaults: text('Nos', 'Pcs', 'Set', 'Box', 'Roll', 'Licence', 'Year', 'Month') },
  { key: 'sales.gstRates', module: 'Sales', title: 'GST rates (%)', help: 'The GST rates that can be chosen on a product or an estimate line. Numbers only.', mode: 'open', stores: 'text', keep: ['18'], defaults: text('0', '5', '12', '18', '28') },
  // Support
  { key: 'desk.priorities', module: 'Support', title: 'Ticket priorities', help: 'Rename the four priorities. Their response and resolution times are under Settings → SLA.', mode: 'fixed', stores: 'code', defaults: [on('P1', 'P1 Critical'), on('P2', 'P2 High'), on('P3', 'P3 Normal'), on('P4', 'P4 Low')] },
  { key: 'desk.types', module: 'Support', title: 'Ticket types', help: 'Rename the ticket types. Implementation tickets carry a plan and design requests go to the design team, so the set is fixed.', mode: 'fixed', stores: 'code', defaults: [on('support', 'Support'), on('implementation', 'Implementation'), on('internal', 'Internal')] },
  { key: 'desk.channels', module: 'Support', title: 'How a ticket arrived', help: 'The channel a customer used to raise the ticket.', mode: 'open', stores: 'code', keep: ['phone'], defaults: [on('phone', 'Phone'), on('email', 'Email'), on('whatsapp', 'WhatsApp'), on('visit', 'Visit')] },
  // Development
  { key: 'dev.types', module: 'Development', title: 'Issue types', help: 'Rename the issue types.', mode: 'fixed', stores: 'code', defaults: [on('feature', 'Feature'), on('bug', 'Bug'), on('change', 'Change request'), on('tech_debt', 'Tech debt'), on('support', 'Support')] },
  { key: 'dev.statuses', module: 'Development', title: 'Board columns', help: 'Rename the columns of the development board. Releases and QA depend on the order, so it is fixed.', mode: 'fixed', stores: 'code',
    defaults: [on('backlog', 'Backlog'), on('planned', 'Planned'), on('in_progress', 'In progress'), on('in_review', 'In review'), on('in_qa', 'In QA'), on('ready', 'Ready to release'), on('released', 'Released')] },
  { key: 'dev.projectKinds', module: 'Development', title: 'Project kinds', help: 'Rename the kinds of project.', mode: 'fixed', stores: 'code', defaults: [on('product', 'Product'), on('customer', 'Customer implementation'), on('internal', 'Internal')] },
  // Production
  { key: 'production.stages', module: 'Production', title: 'Work-order stages', help: 'Rename the stages in English and Hindi. The QC stage is switched on or off under Settings → SOPs, production.', mode: 'fixed', stores: 'code', hindi: true,
    defaults: [on('queued', 'Queued', undefined, 'कतार में'), on('in_production', 'In production', undefined, 'उत्पादन में'), on('qc', 'QC', undefined, 'क्यूसी'), on('packed', 'Packed', undefined, 'पैक किया'), on('dispatched', 'Dispatched', undefined, 'भेज दिया'), on('delivered', 'Delivered', undefined, 'पहुँच गया')] },
  // Finance
  { key: 'finance.expenseCategories', module: 'Finance', title: 'Expense categories', help: 'Chosen when someone claims an expense.', mode: 'open', stores: 'text', keep: ['Other'], defaults: text('Travel', 'Fuel', 'Food', 'Courier', 'Customer entertainment', 'Office', 'Other') },
  // Attendance and leave
  { key: 'hr.leaveTypes', module: 'Attendance and leave', title: 'Leave types', help: 'Each type and how many days a person gets in a financial year (April to March). All types are paid leave.', mode: 'open', stores: 'code', number: { label: 'Days a year', min: 0, max: 365 },
    defaults: [on('CL', 'Casual', 12), on('SL', 'Sick', 6), on('PL', 'Privilege', 15)] },
  { key: 'hr.missReasons', module: 'Attendance and leave', title: 'Miss-punch reasons', help: 'Chosen when someone asks for a missed punch to be corrected. Shown in the miss-punch report.', mode: 'open', stores: 'code', keep: ['other'],
    defaults: [on('forgot', 'Forgot to punch'), on('machine', 'Machine not working or not reading'), on('field', 'On field duty / client visit'), on('early_late', 'Came before or left after the machine hours'), on('other', 'Other')] },
  // Hiring
  { key: 'hire.sources', module: 'Hiring', title: 'Candidate sources', help: 'Where a candidate came from.', mode: 'open', stores: 'text', defaults: text('Referral', 'Naukri', 'LinkedIn', 'Walk-in', 'Website', 'Consultant', 'Direct') },
  { key: 'hire.stages', module: 'Hiring', title: 'Hiring stages', help: 'Rename the stages. Offers, onboarding and the hired gate depend on them, so the set is fixed.', mode: 'fixed', stores: 'code',
    defaults: [on('applied', 'Applied'), on('screening', 'Screening'), on('assessment', 'Assessment'), on('interview', 'Interview'), on('decision', 'Decision'), on('offer', 'Offer'), on('onboarding', 'Onboarding'), on('hired', 'Hired')] },
  { key: 'hire.roundTypes', module: 'Hiring', title: 'Interview kinds', help: 'The kinds of interview round that can be scheduled.', mode: 'open', stores: 'code', defaults: [on('screening', 'Screening'), on('technical', 'Technical'), on('practical', 'Practical'), on('managerial', 'Managerial'), on('hr', 'HR')] },
  { key: 'hire.scoreAreas', module: 'Hiring', title: 'Interview scorecard areas', help: 'Each interviewer rates the candidate from 1 to 5 on every area that is switched on.', mode: 'open', stores: 'code',
    defaults: [on('skills', 'Skills for the role'), on('problem', 'Problem solving'), on('communication', 'Communication'), on('attitude', 'Attitude and ownership')] },
  { key: 'hire.workModes', module: 'Hiring', title: 'Work modes', help: 'Shown on a job opening.', mode: 'open', stores: 'code', defaults: [on('office', 'Office'), on('hybrid', 'Hybrid'), on('remote', 'Remote'), on('field', 'Field')] },
  { key: 'hire.onboarding', module: 'Hiring', title: 'Onboarding checklist', help: 'The steps created when a candidate accepts an offer, and how many days after joining each is due. The three gate steps cannot be switched off: a person is marked Hired only when they are done.', mode: 'open', stores: 'code', number: { label: 'Due in days', min: 0, max: 180 }, defaults: [] },
  // Appraisals
  { key: 'appraisal.ratings', module: 'Appraisals', title: 'Rating scale', help: 'Rename the five ratings.', mode: 'fixed', stores: 'code', defaults: [] }
];

export const NUMBER_DEFS: NumberDef[] = [
  { key: 'appraisal.probationMonths', module: 'Appraisals', title: 'Probation length (months)', help: 'A probation review is raised this many months after the joining date.', min: 1, max: 24, def: 6 },
  { key: 'hire.cvBulkMax', module: 'Hiring', title: 'CVs in one bulk upload', help: 'The most CVs HR can upload at once.', min: 1, max: 50, def: 20 },
  { key: 'hire.assessBatchMax', module: 'Hiring', title: 'English test invitations in one batch', help: 'The most candidates who can be invited at once.', min: 1, max: 50, def: 20 },
  { key: 'hire.assessExpiryMaxDays', module: 'Hiring', title: 'Longest life of an English test link (days)', help: 'HR chooses how long each link stays open, up to this limit.', min: 1, max: 60, def: 14 }
];

const state = new Map<string, ListItem[]>();
const numbers = new Map<string, number>();
const hooks = new Map<string, ((items: ListItem[]) => void)[]>();

export const listDef = (key: string): ListDef => { const d = LIST_DEFS.find((x) => x.key === key); if (!d) throw new Error(`Unknown list ${key}`); return d; };
/** A module that owns part of a list (for example its defaults) supplies them here, once, when it loads. */
export function setDefaults(key: string, defaults: ListItem[]): void { listDef(key).defaults = defaults.map((d) => ({ ...d })); if (!state.has(key)) state.set(key, listDef(key).defaults.map((d) => ({ ...d }))); }
/** Run fn now and every time the list changes. */
export function onList(key: string, fn: (items: ListItem[]) => void): void { hooks.set(key, [...(hooks.get(key) || []), fn]); fn(allItems(key)); }

export function allItems(key: string): ListItem[] { return state.get(key) || listDef(key).defaults; }
export function items(key: string): ListItem[] { return allItems(key).filter((i) => i.active); }
/** Options for a drop-down: the active entries, plus the current value if it has since been switched off. */
export function options(key: string, current?: string | null): { value: string; label: string; selected?: boolean }[] {
  const all = allItems(key); const out = all.filter((i) => i.active || i.value === current).map((i) => ({ value: i.value, label: i.label, selected: i.value === current }));
  if (current && !all.some((i) => i.value === current)) out.push({ value: current, label: current, selected: true });
  return out;
}
export function label(key: string, value: string | null | undefined): string { if (value == null) return ''; return allItems(key).find((i) => i.value === value)?.label || String(value).replace(/_/g, ' '); }
export function num(key: string, value: string): number { return allItems(key).find((i) => i.value === value)?.n ?? 0; }
export function isActive(key: string, value: string): boolean { return items(key).some((i) => i.value === value); }
export function number(key: string): number { const d = NUMBER_DEFS.find((x) => x.key === key); if (!d) throw new Error(`Unknown number ${key}`); return numbers.get(key) ?? d.def; }

function readJson<T>(db: Db, key: string): T | null { const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]); if (!row) return null; try { return JSON.parse(row.value) as T; } catch { return null; } }
function writeJson(db: Db, key: string, value: unknown, by: string | null): void {
  db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', [key, JSON.stringify(value), new Date().toISOString(), by]);
}

/** Merge what is stored with the defaults: a fixed list always has exactly its default entries; an open list keeps stored entries and gains any new default. */
function merge(def: ListDef, stored: ListItem[] | undefined): ListItem[] {
  if (!stored || !Array.isArray(stored)) return def.defaults.map((d) => ({ ...d }));
  const clean = stored.filter((s) => s && typeof s.value === 'string' && typeof s.label === 'string');
  if (def.mode === 'fixed') return def.defaults.map((d) => { const s = clean.find((x) => x.value === d.value); return s ? { ...d, label: s.label || d.label, ...(s.labelHi ? { labelHi: s.labelHi } : {}), ...(def.number && Number.isFinite(s.n) ? { n: s.n } : {}), active: true } : { ...d }; });
  const out = clean.map((s) => ({ ...s, active: s.active !== false }));
  for (const k of def.keep || []) if (!out.some((o) => o.value === k)) { const d = def.defaults.find((x) => x.value === k); if (d) out.push({ ...d }); }
  return out;
}

/** Load the lists and numbers for this database into memory and tell every module. Called when the app starts and after every save. */
export function applyLists(db: Db): void {
  const stored = readJson<Record<string, ListItem[]>>(db, 'lists') || {};
  for (const def of LIST_DEFS) {
    let s = stored[def.key];
    if (!s && def.key === 'hr.leaveTypes') { const q = readJson<Record<string, number>>(db, 'leave'); if (q) s = def.defaults.map((d) => ({ ...d, n: Number.isFinite(q[d.value]) ? q[d.value] : d.n })); }
    state.set(def.key, merge(def, s));
  }
  const n = readJson<Record<string, number>>(db, 'numbers') || {};
  for (const d of NUMBER_DEFS) numbers.set(d.key, Number.isFinite(n[d.key]) ? Math.min(d.max, Math.max(d.min, n[d.key])) : d.def);
  for (const [key, fns] of hooks) for (const fn of fns) fn(allItems(key));
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'item';

export interface ListInput { value?: string; label: string; labelHi?: string; n?: number | null; active?: boolean }
/** Save a list. Returns a message for anything that was adjusted. Throws an Error with a plain-language message if it cannot be saved. */
export function saveList(db: Db, actorId: string, key: string, input: ListInput[]): ListItem[] {
  const def = listDef(key); const before = allItems(key); const next: ListItem[] = [];
  const cleanN = (n: number | null | undefined, fallback: number | undefined): number | undefined => { if (!def.number) return undefined; const v = Number.isFinite(n as number) ? Number(n) : (fallback ?? def.number.min); return Math.min(def.number.max, Math.max(def.number.min, v)); };
  if (def.mode === 'fixed') {
    for (const cur of before) {
      const i = input.find((x) => x.value === cur.value); const lbl = (i?.label || '').trim().slice(0, 60) || cur.label;
      next.push({ value: cur.value, label: lbl, active: true, ...(def.hindi ? { labelHi: (i?.labelHi || '').trim().slice(0, 60) || cur.labelHi || lbl } : {}), ...(def.number ? { n: cleanN(i?.n, cur.n) } : {}) });
    }
  } else {
    for (const i of input) {
      const lbl = (i.label || '').trim().slice(0, 60); if (!lbl) continue;
      const existing = i.value ? before.find((b) => b.value === i.value) : undefined;
      let value = existing ? existing.value : def.stores === 'text' ? lbl : slug(lbl);
      if (!existing && def.key === 'hr.leaveTypes') value = (lbl.match(/\b[A-Za-z]/g) || ['L']).join('').toUpperCase().slice(0, 4) + (/leave/i.test(lbl) ? '' : 'L');
      if (!existing) { const base = value; let k = 2; while (next.some((x) => x.value.toLowerCase() === value.toLowerCase()) || before.some((x) => x.value.toLowerCase() === value.toLowerCase())) value = `${base}${def.stores === 'text' ? ' ' : '_'}${k++}`; }
      if (next.some((x) => x.label.toLowerCase() === lbl.toLowerCase() && x.active && i.active !== false)) throw new Error(`"${lbl}" is in the list twice.`);
      let active = i.active !== false; if ((def.keep || []).includes(value)) active = true;
      // A text list stores the wording on the record, so a renamed entry becomes a new one and the old wording stays on old records.
      if (existing && def.stores === 'text' && existing.label !== lbl) value = lbl;
      next.push({ value, label: lbl, active, ...(def.number ? { n: cleanN(i.n, existing?.n) } : {}) });
    }
    // Entries left out of the form are kept, switched off, so old records still show their name.
    if (def.stores === 'code') for (const b of before) if (!next.some((x) => x.value === b.value)) next.push({ ...b, active: (def.keep || []).includes(b.value) });
    if (!next.some((x) => x.active)) throw new Error('Keep at least one entry switched on.');
  }
  const all = readJson<Record<string, ListItem[]>>(db, 'lists') || {};
  all[key] = next; writeJson(db, 'lists', all, actorId);
  audit(db, { entity: 'settings', entityId: `list:${key}`, action: 'update', actorId, before, after: next });
  applyLists(db);
  return next;
}

export function resetList(db: Db, actorId: string, key: string): void {
  const all = readJson<Record<string, ListItem[]>>(db, 'lists') || {}; const before = allItems(key);
  delete all[key]; writeJson(db, 'lists', all, actorId);
  audit(db, { entity: 'settings', entityId: `list:${key}`, action: 'reset', actorId, before, after: listDef(key).defaults });
  applyLists(db);
}

export function saveNumbers(db: Db, actorId: string, input: Record<string, number | null>): void {
  const before = Object.fromEntries(NUMBER_DEFS.map((d) => [d.key, number(d.key)])); const next: Record<string, number> = { ...before };
  for (const d of NUMBER_DEFS) { const v = input[d.key]; if (v != null && Number.isFinite(v)) next[d.key] = Math.min(d.max, Math.max(d.min, Math.round(v))); }
  writeJson(db, 'numbers', next, actorId);
  audit(db, { entity: 'settings', entityId: 'numbers', action: 'update', actorId, before, after: next });
  applyLists(db);
}

export function listHistory(db: Db, limit = 30): { at: string; actor: string; entity_id: string; action: string }[] {
  return db.all("SELECT a.at, COALESCE(e.full_name, 'System') AS actor, a.entity_id, a.action FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id WHERE a.entity = 'settings' AND (a.entity_id LIKE 'list:%' OR a.entity_id = 'numbers' OR a.entity_id LIKE 'org:%') ORDER BY a.id DESC LIMIT ?", [limit]);
}
