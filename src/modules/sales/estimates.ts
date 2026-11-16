// Product catalogue and estimates with line items and GST on each line.
//
// An estimate belongs to a deal. It is edited as a draft, then finalised (which fixes the figures, sets the deal value and
// asks for discount approval if the discount is above the limit in Settings → Approvals), then sent to the customer by a link.
// A change after that is a new version; the old one is kept and marked superseded.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { can } from '../../lib/scope.ts';
import * as lists from '../../lib/lists.ts';
import { localDateString, addDays } from '../../lib/time.ts';
import type { Employee } from '../people/model.ts';
import { requireDeal, getCustomer, createQuote, addActivity, type Deal } from './service.ts';

const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;
const nowIso = (): string => new Date().toISOString();

// ---------- Settings: what is printed on every estimate ----------

export interface EstimateSettings { sellerName: string; address: string; gstin: string; phone: string; email: string; validityDays: number; terms: string; bank: string; footer: string }
export const DEFAULT_ESTIMATE_SETTINGS: EstimateSettings = {
  sellerName: 'Loyal String', address: '', gstin: '', phone: '', email: '', validityDays: 15,
  terms: 'Prices are in Indian rupees. GST is charged as shown.\nDelivery, installation and training are as agreed in writing.\nThis estimate is valid until the date shown above.', bank: '', footer: ''
};
export function estimateSettings(app: App): EstimateSettings {
  const row = app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'estimateSettings'");
  if (!row) return { ...DEFAULT_ESTIMATE_SETTINGS };
  try { return { ...DEFAULT_ESTIMATE_SETTINGS, ...(JSON.parse(row.value) as Partial<EstimateSettings>) }; } catch { return { ...DEFAULT_ESTIMATE_SETTINGS }; }
}
export function saveEstimateSettings(app: App, actor: Employee, input: Partial<Record<keyof EstimateSettings, unknown>>): EstimateSettings {
  if (!canManageCatalogue(app, actor)) throw new HttpError(403, 'Only sales managers change estimate settings.');
  const before = estimateSettings(app); const s = (k: keyof EstimateSettings, max: number): string => (input[k] === undefined ? String(before[k]) : String(input[k]).trim().slice(0, max));
  const days = Number(input.validityDays ?? before.validityDays);
  if (!Number.isInteger(days) || days < 1 || days > 180) throw new HttpError(400, 'Validity must be a whole number of days from 1 to 180.');
  const gstin = s('gstin', 15).toUpperCase();
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new HttpError(400, 'A GSTIN has 15 letters and digits.');
  const next: EstimateSettings = { sellerName: s('sellerName', 100) || before.sellerName, address: s('address', 400), gstin, phone: s('phone', 40), email: s('email', 100), validityDays: days, terms: s('terms', 2000), bank: s('bank', 600), footer: s('footer', 200) };
  app.db.run('INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by', ['estimateSettings', JSON.stringify(next), nowIso(), actor.id]);
  audit(app.db, { entity: 'settings', entityId: 'estimateSettings', action: 'update', actorId: actor.id, before, after: next });
  return next;
}

// ---------- Products ----------

export interface Product { id: string; name: string; description: string; unit: string; price: number; hsn: string; gst_rate: number; image_path: string; active: number; zoho_item_id: string; created_at: string; updated_at: string }
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
export const imageRoot = (app: App): string => join(app.cfg.dataDir, 'products');
export const imageMime = (path: string): string => IMAGE_TYPES[path.slice(path.lastIndexOf('.')).toLowerCase()] || 'application/octet-stream';

export function canManageCatalogue(app: App, e: Employee): boolean { return can(app.db, e, 'sales.manage') || can(app.db, e, 'settings.admin'); }
export function listProducts(app: App, opts: { activeOnly?: boolean } = {}): Product[] { return app.db.all<Product>(`SELECT * FROM products ${opts.activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`); }
export function getProduct(app: App, id: string): Product | undefined { return app.db.get<Product>('SELECT * FROM products WHERE id = ?', [id]); }

function gstRate(v: unknown, fallback = 18): number {
  const n = Number(v); if (!Number.isFinite(n)) return fallback;
  if (n < 0 || n > 40) throw new HttpError(400, 'GST rate must be between 0 and 40.');
  return r2(n);
}
export function saveProduct(app: App, actor: Employee, input: { id?: string; name: string; description?: string; unit?: string; price: number | null; hsn?: string; gstRate?: number | null; active?: boolean }): Product {
  if (!canManageCatalogue(app, actor)) throw new HttpError(403, 'Only sales managers change the product list.');
  const name = (input.name || '').trim().slice(0, 120); if (name.length < 2) throw new HttpError(400, 'Give the product a name.');
  const price = Number(input.price); if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Enter the price (before GST).');
  const unit = (input.unit || '').trim().slice(0, 20) || 'Nos'; const hsn = (input.hsn || '').trim().slice(0, 12);
  if (hsn && !/^[0-9]{4,8}$/.test(hsn)) throw new HttpError(400, 'HSN / SAC is 4 to 8 digits.');
  const gst = gstRate(input.gstRate); const description = (input.description || '').trim().slice(0, 1000); const at = nowIso();
  if (app.db.get('SELECT 1 FROM products WHERE lower(name) = lower(?) AND id != ?', [name, input.id || ''])) throw new HttpError(400, `There is already a product called "${name}".`);
  if (input.id) {
    const before = getProduct(app, input.id); if (!before) throw new HttpError(404, 'No such product.');
    app.db.run('UPDATE products SET name = ?, description = ?, unit = ?, price = ?, hsn = ?, gst_rate = ?, active = ?, updated_at = ? WHERE id = ?', [name, description, unit, r2(price), hsn, gst, input.active === false ? 0 : 1, at, input.id]);
    audit(app.db, { entity: 'product', entityId: input.id, action: 'update', actorId: actor.id, before: { name: before.name, price: before.price, gst_rate: before.gst_rate, active: before.active }, after: { name, price: r2(price), gst_rate: gst, active: input.active === false ? 0 : 1 } });
    return getProduct(app, input.id)!;
  }
  const id = app.db.nextId('PRD');
  app.db.run('INSERT INTO products (id, name, description, unit, price, hsn, gst_rate, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [id, name, description, unit, r2(price), hsn, gst, at, at]);
  audit(app.db, { entity: 'product', entityId: id, action: 'create', actorId: actor.id, after: { name, price: r2(price), gst_rate: gst } });
  return getProduct(app, id)!;
}
/** Store a product photo. Old photos are kept on disk because estimates already sent still show them. */
export function setProductImage(app: App, actor: Employee, id: string, fileName: string, base64: string): Product {
  if (!canManageCatalogue(app, actor)) throw new HttpError(403, 'Only sales managers change the product list.');
  const p = getProduct(app, id); if (!p) throw new HttpError(404, 'No such product.');
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  if (!IMAGE_TYPES[ext]) throw new HttpError(400, 'Use a PNG, JPG or WebP picture.');
  const buf = Buffer.from(String(base64 || '').replace(/^data:[^,]*,/, ''), 'base64');
  if (!buf.length) throw new HttpError(400, 'The picture is empty.');
  if (buf.length > MAX_IMAGE_BYTES) throw new HttpError(400, 'The picture is larger than 2 MB. Use a smaller one.');
  const png = buf[0] === 0x89 && buf[1] === 0x50, jpg = buf[0] === 0xff && buf[1] === 0xd8, webp = buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!(png || jpg || webp)) throw new HttpError(400, 'That file is not a PNG, JPG or WebP picture.');
  const rel = `${id}-${randomBytes(6).toString('hex')}${png ? '.png' : jpg ? '.jpg' : '.webp'}`; const abs = join(imageRoot(app), rel);
  mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, buf);
  app.db.run('UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?', [rel, nowIso(), id]);
  audit(app.db, { entity: 'product', entityId: id, action: 'image', actorId: actor.id });
  return getProduct(app, id)!;
}

// ---------- Estimates ----------

export type EstimateStatus = 'draft' | 'final' | 'sent' | 'accepted' | 'declined' | 'superseded';
export interface Estimate {
  id: string; number: string; version: number; deal_id: string; customer_id: string; status: EstimateStatus; currency: string; estimate_date: string; valid_until: string; tax_mode: 'intra' | 'inter';
  bill_name: string; bill_address: string; bill_gstin: string; bill_contact: string; subject: string; terms: string; notes: string;
  gross: number; discount_total: number; taxable: number; tax_total: number; total: number; share_token: string | null; sent_at: string | null; decided_at: string | null; decided_by: string; decision_note: string;
  zoho_estimate_id: string; created_by: string | null; created_at: string; updated_at: string; customer_name?: string; owner_id?: string; owner_name?: string; deal_title?: string;
}
export interface EstimateItem { id: number; estimate_id: string; position: number; product_id: string | null; name: string; description: string; hsn: string; unit: string; qty: number; rate: number; discount_pct: number; gst_rate: number; image_path: string; taxable: number; tax: number; amount: number }
export const STATUS_LABEL: Record<string, string> = { draft: 'Draft', final: 'Ready to send', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', superseded: 'Replaced by a newer version', expired: 'Expired' };

const SELECT = `SELECT e.*, c.name AS customer_name, d.owner_id AS owner_id, o.full_name AS owner_name, d.title AS deal_title FROM estimates e JOIN customers c ON c.id = e.customer_id JOIN deals d ON d.id = e.deal_id LEFT JOIN employees o ON o.id = d.owner_id`;
export function getEstimate(app: App, id: string): Estimate | undefined { return app.db.get<Estimate>(`${SELECT} WHERE e.id = ?`, [id]); }
export function requireEstimate(app: App, id: string): Estimate { const e = getEstimate(app, id); if (!e) throw new HttpError(404, 'No such estimate.'); return e; }
export function estimateByToken(app: App, token: string): Estimate | undefined { return /^[a-f0-9]{32}$/.test(token) ? app.db.get<Estimate>(`${SELECT} WHERE e.share_token = ?`, [token]) : undefined; }
export function estimateItems(app: App, id: string): EstimateItem[] { return app.db.all<EstimateItem>('SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY position', [id]); }
export function estimatesOfDeal(app: App, dealId: string): Estimate[] { return app.db.all<Estimate>(`${SELECT} WHERE e.deal_id = ? ORDER BY e.version DESC`, [dealId]); }
export function listEstimates(app: App, f: { ownerIds?: string[]; status?: string; q?: string; limit?: number; offset?: number } = {}): { rows: Estimate[]; total: number } {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.ownerIds) { if (!f.ownerIds.length) return { rows: [], total: 0 }; where.push(`d.owner_id IN (${f.ownerIds.map(() => '?').join(',')})`); params.push(...f.ownerIds); }
  if (f.status === 'expired') { where.push("e.status = 'sent' AND e.valid_until < ?"); params.push(localDateString(new Date())); }
  else if (f.status) { where.push('e.status = ?'); params.push(f.status); } else where.push("e.status != 'superseded'");
  if (f.q) { where.push('(lower(c.name) LIKE ? OR lower(e.number) LIKE ?)'); params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = app.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM estimates e JOIN customers c ON c.id = e.customer_id JOIN deals d ON d.id = e.deal_id ${w}`, params)!.n;
  return { rows: app.db.all<Estimate>(`${SELECT} ${w} ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`, [...params, f.limit ?? 50, f.offset ?? 0]), total };
}
/** What to show as the status: a sent estimate past its validity date reads as expired. */
export function shownStatus(e: Estimate, today = localDateString(new Date())): string { return e.status === 'sent' && e.valid_until < today ? 'expired' : e.status; }

export function canEditEstimate(app: App, actor: Employee, e: { owner_id?: string }): boolean {
  return can(app.db, actor, 'sales.manage') || (can(app.db, actor, 'sales.write') && e.owner_id === actor.id);
}
function requireEdit(app: App, actor: Employee, e: { owner_id?: string }): void { if (!canEditEstimate(app, actor, e)) throw new HttpError(403, 'Only the deal owner or a sales manager works on this estimate.'); }

export interface LineInput { productId?: string | null; name?: string; description?: string; hsn?: string; unit?: string; qty?: number | string | null; rate?: number | string | null; discountPct?: number | string | null; gstRate?: number | string | null }
export interface Totals { gross: number; discount: number; taxable: number; tax: number; total: number; byRate: { rate: number; taxable: number; tax: number }[] }
/** Line: amount before discount = qty × rate; taxable = that less the discount; GST = taxable × rate; line total = taxable + GST. */
export function computeLine(l: { qty: number; rate: number; discount_pct: number; gst_rate: number }): { gross: number; discount: number; taxable: number; tax: number; amount: number } {
  const gross = r2(l.qty * l.rate); const discount = r2(gross * l.discount_pct / 100); const taxable = r2(gross - discount); const tax = r2(taxable * l.gst_rate / 100);
  return { gross, discount, taxable, tax, amount: r2(taxable + tax) };
}
export function computeTotals(items: { qty: number; rate: number; discount_pct: number; gst_rate: number }[]): Totals {
  const t: Totals = { gross: 0, discount: 0, taxable: 0, tax: 0, total: 0, byRate: [] };
  for (const i of items) {
    const l = computeLine(i); t.gross += l.gross; t.discount += l.discount; t.taxable += l.taxable; t.tax += l.tax;
    const b = t.byRate.find((x) => x.rate === i.gst_rate); if (b) { b.taxable = r2(b.taxable + l.taxable); b.tax = r2(b.tax + l.tax); } else t.byRate.push({ rate: i.gst_rate, taxable: l.taxable, tax: l.tax });
  }
  t.gross = r2(t.gross); t.discount = r2(t.discount); t.taxable = r2(t.taxable); t.tax = r2(t.tax); t.total = r2(t.taxable + t.tax); t.byRate.sort((a, b) => a.rate - b.rate);
  return t;
}

/** Start an estimate on a deal. If the deal already has one, this is the next version, copied from the latest. */
export function createEstimate(app: App, actor: Employee, dealId: string): Estimate {
  const d = requireDeal(app, dealId); requireEdit(app, actor, d);
  if (d.stage === 'won' || d.stage === 'lost') throw new HttpError(400, 'This deal is closed. Estimates are made on open deals.');
  const prev = estimatesOfDeal(app, dealId)[0];
  if (prev && prev.status === 'draft') return prev;
  const cust = getCustomer(app, d.customer_id)! as ReturnType<typeof getCustomer> & { address?: string; gstin?: string };
  const s = estimateSettings(app); const today = localDateString(new Date()); const at = nowIso();
  const id = app.db.nextId('EST'); const number = prev ? prev.number : id; const version = prev ? prev.version + 1 : 1;
  app.db.transaction(() => {
    app.db.run(`INSERT INTO estimates (id, number, version, deal_id, customer_id, status, currency, estimate_date, valid_until, tax_mode, bill_name, bill_address, bill_gstin, bill_contact, subject, terms, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, number, version, dealId, d.customer_id, d.currency, today, localDateString(addDays(new Date(), s.validityDays)), prev?.tax_mode || 'intra', prev?.bill_name || cust!.name, prev?.bill_address || cust!.address || cust!.city || '', prev?.bill_gstin || cust!.gstin || '',
        prev?.bill_contact || [cust!.contact_name, cust!.phone].filter(Boolean).join(' · '), prev?.subject || d.title || '', prev ? prev.terms : s.terms, prev?.notes || '', actor.id, at, at]);
    if (prev) {
      for (const i of estimateItems(app, prev.id)) app.db.run('INSERT INTO estimate_items (estimate_id, position, product_id, name, description, hsn, unit, qty, rate, discount_pct, gst_rate, image_path, taxable, tax, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, i.position, i.product_id, i.name, i.description, i.hsn, i.unit, i.qty, i.rate, i.discount_pct, i.gst_rate, i.image_path, i.taxable, i.tax, i.amount]);
      app.db.run('UPDATE estimates SET gross = ?, discount_total = ?, taxable = ?, tax_total = ?, total = ? WHERE id = ?', [prev.gross, prev.discount_total, prev.taxable, prev.tax_total, prev.total, id]);
    }
    audit(app.db, { entity: 'estimate', entityId: id, action: prev ? 'revise' : 'create', actorId: actor.id, after: { number, version, dealId } });
  });
  return getEstimate(app, id)!;
}

export interface EstimateInput { validUntil?: string; estimateDate?: string; taxMode?: string; billName?: string; billAddress?: string; billGstin?: string; billContact?: string; subject?: string; terms?: string; notes?: string; items?: LineInput[] }
export function saveEstimate(app: App, actor: Employee, id: string, input: EstimateInput): Estimate {
  const e = requireEstimate(app, id); requireEdit(app, actor, e);
  if (e.status !== 'draft') throw new HttpError(400, 'This estimate is no longer a draft. Make a new version to change it.');
  const date = (v: string | undefined, fallback: string): string => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
  const estimateDate = date(input.estimateDate, e.estimate_date); const validUntil = date(input.validUntil, e.valid_until);
  if (validUntil < estimateDate) throw new HttpError(400, 'The valid-until date is before the estimate date.');
  const gstin = (input.billGstin ?? e.bill_gstin).trim().toUpperCase();
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) throw new HttpError(400, 'The customer GSTIN has 15 letters and digits. Leave it empty if they have none.');
  const num = (v: unknown, label: string, min: number, max: number, row: number): number => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Line ${row}: ${label} must be from ${min} to ${max.toLocaleString('en-IN')}.`); return n; };
  const lines = (input.items || []).filter((l) => (l.name || '').trim() || l.productId).slice(0, 100).map((l, idx) => {
    const p = l.productId ? getProduct(app, l.productId) : undefined; const row = idx + 1;
    const name = (l.name || p?.name || '').trim().slice(0, 120); if (!name) throw new HttpError(400, `Line ${row} needs a name.`);
    const line = { product_id: p?.id || null, name, description: (l.description ?? p?.description ?? '').trim().slice(0, 1000), hsn: (l.hsn ?? p?.hsn ?? '').trim().slice(0, 12), unit: (l.unit || p?.unit || 'Nos').trim().slice(0, 20),
      qty: num(l.qty ?? 1, 'quantity', 0.001, 1_000_000, row), rate: r2(num(l.rate ?? p?.price ?? 0, 'rate', 0, 1_000_000_000, row)), discount_pct: r2(num(l.discountPct ?? 0, 'discount %', 0, 100, row)), gst_rate: gstRate(l.gstRate ?? p?.gst_rate ?? 18), image_path: p?.image_path || '' };
    return { ...line, ...computeLine(line) };
  });
  const t = computeTotals(lines); const at = nowIso();
  app.db.transaction(() => {
    app.db.run('UPDATE estimates SET estimate_date = ?, valid_until = ?, tax_mode = ?, bill_name = ?, bill_address = ?, bill_gstin = ?, bill_contact = ?, subject = ?, terms = ?, notes = ?, gross = ?, discount_total = ?, taxable = ?, tax_total = ?, total = ?, updated_at = ? WHERE id = ?',
      [estimateDate, validUntil, input.taxMode === 'inter' ? 'inter' : input.taxMode === 'intra' ? 'intra' : e.tax_mode, (input.billName ?? e.bill_name).trim().slice(0, 120) || e.bill_name, (input.billAddress ?? e.bill_address).trim().slice(0, 400), gstin, (input.billContact ?? e.bill_contact).trim().slice(0, 120),
        (input.subject ?? e.subject).trim().slice(0, 160), (input.terms ?? e.terms).trim().slice(0, 2000), (input.notes ?? e.notes).trim().slice(0, 1000), t.gross, t.discount, t.taxable, t.tax, t.total, at, id]);
    if (input.items) {
      app.db.run('DELETE FROM estimate_items WHERE estimate_id = ?', [id]);
      lines.forEach((l, i) => app.db.run('INSERT INTO estimate_items (estimate_id, position, product_id, name, description, hsn, unit, qty, rate, discount_pct, gst_rate, image_path, taxable, tax, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, i, l.product_id, l.name, l.description, l.hsn, l.unit, l.qty, l.rate, l.discount_pct, l.gst_rate, l.image_path, l.taxable, l.tax, l.amount]));
    }
    // Keep the customer's address and GSTIN for next time.
    app.db.run("UPDATE customers SET address = CASE WHEN ? != '' THEN ? ELSE address END, gstin = CASE WHEN ? != '' THEN ? ELSE gstin END WHERE id = ?", [(input.billAddress ?? '').trim(), (input.billAddress ?? '').trim().slice(0, 400), gstin, gstin, e.customer_id]);
  });
  return getEstimate(app, id)!;
}

/** Fix the figures. The deal takes the estimate's value and discount; a discount above the limit goes for approval. */
export function finaliseEstimate(app: App, actor: Employee, id: string): { estimate: Estimate; deal: Deal; approvalTaskId: string | null } {
  const e = requireEstimate(app, id); requireEdit(app, actor, e);
  if (e.status !== 'draft') throw new HttpError(400, 'This estimate is already finalised.');
  const items = estimateItems(app, id);
  if (!items.length) throw new HttpError(400, 'Add at least one line before you finalise.');
  if (e.total <= 0) throw new HttpError(400, 'The estimate total is zero. Check the quantities and rates.');
  const pct = e.gross > 0 ? r2(e.discount_total / e.gross * 100) : 0;
  if (pct > 50) throw new HttpError(400, `The overall discount is ${pct}%. The most a deal can carry is 50%.`);
  let out!: ReturnType<typeof createQuote>;
  app.db.transaction(() => {
    app.db.run("UPDATE estimates SET status = 'superseded', updated_at = ? WHERE deal_id = ? AND id != ? AND status IN ('final', 'sent')", [nowIso(), e.deal_id, id]);
    app.db.run("UPDATE estimates SET status = 'final', updated_at = ? WHERE id = ?", [nowIso(), id]);
    out = createQuote(app, actor, e.deal_id, { discountPct: pct, currency: e.currency, listTotal: e.gross });
    audit(app.db, { entity: 'estimate', entityId: id, action: 'finalise', actorId: actor.id, after: { total: e.total, discountPct: pct } });
  });
  return { estimate: getEstimate(app, id)!, deal: out.deal, approvalTaskId: out.approvalTaskId };
}

/** Whether the estimate may go to the customer yet, and if not, why. */
export function sendBlock(app: App, e: Estimate): string | null {
  if (e.status === 'draft') return 'Finalise the estimate first.';
  if (e.status === 'superseded') return 'A newer version has replaced this one.';
  const d = requireDeal(app, e.deal_id);
  if (d.discount_status === 'pending') return 'The discount is waiting for approval.';
  if (d.discount_status === 'declined') return 'The discount was declined. Make a new version with a lower discount.';
  return null;
}
/** Mark the estimate as sent and give the link the customer opens. The link needs no sign-in. */
export function sendEstimate(app: App, actor: Employee, id: string): { estimate: Estimate; token: string } {
  const e = requireEstimate(app, id); requireEdit(app, actor, e);
  const block = sendBlock(app, e); if (block) throw new HttpError(400, block);
  const token = e.share_token || randomBytes(16).toString('hex');
  if (e.status === 'final') {
    app.db.run("UPDATE estimates SET status = 'sent', share_token = ?, sent_at = ?, updated_at = ? WHERE id = ?", [token, nowIso(), nowIso(), id]);
    addActivity(app, actor, { dealId: e.deal_id, kind: 'quote', notes: `Estimate ${e.number} v${e.version} sent: ${e.currency} ${Math.round(e.total).toLocaleString('en-IN')} including GST` });
    audit(app.db, { entity: 'estimate', entityId: id, action: 'send', actorId: actor.id });
  } else if (!e.share_token) app.db.run('UPDATE estimates SET share_token = ? WHERE id = ?', [token, id]);
  return { estimate: getEstimate(app, id)!, token };
}
/** Record the customer's answer: by the customer on the shared page (actor null) or by the sales person. */
export function decideEstimate(app: App, actor: Employee | null, e: Estimate, decision: 'accepted' | 'declined', by: string, note: string): Estimate {
  if (actor) requireEdit(app, actor, e);
  if (e.status !== 'sent') throw new HttpError(400, e.status === 'accepted' || e.status === 'declined' ? 'This estimate has already been answered.' : 'Only an estimate that has been sent can be accepted or declined.');
  if (!actor && e.valid_until < localDateString(new Date())) throw new HttpError(400, 'This estimate has passed its validity date. Please ask for a fresh one.');
  const who = by.trim().slice(0, 80); if (who.length < 2) throw new HttpError(400, 'Please give your name.');
  app.db.run('UPDATE estimates SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?, updated_at = ? WHERE id = ?', [decision, nowIso(), actor ? `${who} (recorded by ${actor.full_name})` : who, note.trim().slice(0, 500), nowIso(), e.id]);
  audit(app.db, { entity: 'estimate', entityId: e.id, action: decision, actorId: actor?.id ?? null, after: { by: who, note: note.trim().slice(0, 500), via: actor ? 'staff' : 'customer link' } });
  const owner = app.db.get<Employee>('SELECT * FROM employees WHERE id = ?', [e.owner_id || '']);
  if (owner) {
    addActivity(app, actor || owner, { dealId: e.deal_id, kind: 'quote', notes: `Estimate ${e.number} v${e.version} ${decision} by ${who}${note.trim() ? ': ' + note.trim().slice(0, 200) : ''}` });
    if (!actor || actor.id !== owner.id) app.notify.send({ employeeId: owner.id, title: `Estimate ${decision}: ${e.customer_name}`, body: `${who} ${decision} ${e.number} v${e.version} (${e.currency} ${Math.round(e.total).toLocaleString('en-IN')}).`, link: `/estimates/${e.id}` });
  }
  return getEstimate(app, e.id)!;
}
export { lists };
