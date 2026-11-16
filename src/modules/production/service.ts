import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { App } from '../../app.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { getSetting } from '../../lib/settings.ts';
import { addDays, localDateString } from '../../lib/time.ts';
import type { Employee } from '../people/model.ts';

import { setDefaults, onList } from '../../lib/lists.ts';
export type WoStage = 'queued' | 'in_production' | 'qc' | 'packed' | 'dispatched' | 'delivered';
export const WO_STAGES: WoStage[] = ['queued', 'in_production', 'qc', 'packed', 'dispatched', 'delivered'];
export const WO_LABEL: Record<WoStage, { en: string; hi: string }> = {
  queued: { en: 'Queued', hi: 'कतार में' }, in_production: { en: 'In production', hi: 'उत्पादन में' }, qc: { en: 'QC', hi: 'जाँच' },
  packed: { en: 'Packed', hi: 'पैक हो गया' }, dispatched: { en: 'Dispatched', hi: 'भेज दिया' }, delivered: { en: 'Delivered', hi: 'पहुँच गया' }
};
// Stage names (English and Hindi) can be changed under Settings → Lists.
setDefaults('production.stages', WO_STAGES.map((st) => ({ value: st, label: WO_LABEL[st].en, labelHi: WO_LABEL[st].hi, active: true })));
onList('production.stages', (items) => { for (const i of items) if (i.value in WO_LABEL) WO_LABEL[i.value as WoStage] = { en: i.label, hi: i.labelHi || i.label }; });

export interface WorkOrder {
  id: string; kind: string; customer_id: string | null; deal_id: string | null; product: string; qty: number; stage: WoStage; assignee_id: string | null; promised_date: string | null; lead_time_days: number;
  started_at: string | null; qc_result: string | null; packed_at: string | null; dispatched_at: string | null; delivered_at: string | null; courier: string; consignment: string; invoice_ref: string; photo_path: string; notes: string;
  created_by: string | null; created_at: string; updated_at: string; materials_status: string; materials_note: string; planned_hours: number | null; customer_name?: string; assignee_name?: string | null;
}

const SELECT = 'SELECT w.*, c.name AS customer_name, e.full_name AS assignee_name FROM work_orders w LEFT JOIN customers c ON c.id = w.customer_id LEFT JOIN employees e ON e.id = w.assignee_id';

export function stagesInUse(app: App): WoStage[] {
  return getSetting(app.db, 'production').qcEnabled ? WO_STAGES : WO_STAGES.filter((s) => s !== 'qc');
}

export function getWorkOrder(app: App, id: string): WorkOrder | undefined { return app.db.get<WorkOrder>(`${SELECT} WHERE w.id = ?`, [id]); }
export function requireWorkOrder(app: App, id: string): WorkOrder { const w = getWorkOrder(app, id); if (!w) throw new HttpError(404, `Work order ${id} not found`); return w; }

export function listWorkOrders(app: App, f: { open?: boolean; stages?: WoStage[]; since?: string; limit?: number } = {}): WorkOrder[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.open) where.push("w.stage NOT IN ('delivered')");
  if (f.stages && f.stages.length) { where.push(`w.stage IN (${f.stages.map(() => '?').join(',')})`); params.push(...f.stages); }
  if (f.since) { where.push('w.created_at >= ?'); params.push(f.since); }
  params.push(f.limit || 500);
  return app.db.all<WorkOrder>(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE WHEN w.promised_date IS NULL THEN 1 ELSE 0 END, w.promised_date, w.created_at LIMIT ?`, params);
}

export interface NewWorkOrder { customerId?: string | null; dealId?: string | null; product: string; qty?: number; kind?: 'order' | 'design_request'; promisedDate?: string | null; notes?: string; assigneeId?: string | null; leadTimeDays?: number }

export function createWorkOrder(app: App, actor: Employee | null, input: NewWorkOrder): WorkOrder {
  if (!input.product || input.product.trim().length < 2) throw new HttpError(400, 'Describe the product or request.');
  const settings = getSetting(app.db, 'production');
  const lead = input.leadTimeDays || settings.defaultLeadTimeDays;
  const promised = input.promisedDate || localDateString(addDays(new Date(), lead));
  const id = app.db.nextId('WO'); const nowIso = new Date().toISOString();
  const assignee = input.assigneeId || (input.kind === 'design_request' ? app.db.get<{ id: string }>("SELECT id FROM employees WHERE designation LIKE '%Mechanical%' AND status = 'active' LIMIT 1")?.id || null : app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = 'PRD' AND functional_role = 'team_lead' AND status = 'active' LIMIT 1")?.id || null);
  app.db.run(`INSERT INTO work_orders (id, kind, customer_id, deal_id, product, qty, stage, assignee_id, promised_date, lead_time_days, notes, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind || 'order', input.customerId || null, input.dealId || null, input.product.trim(), input.qty || 1, assignee, promised, lead, input.notes || '', actor?.id || null, nowIso, nowIso]);
  audit(app.db, { entity: 'work_order', entityId: id, action: 'create', actorId: actor?.id, after: { product: input.product, promised } });
  if (assignee && assignee !== actor?.id) app.notify.send({ employeeId: assignee, title: input.kind === 'design_request' ? `Design request ${id}` : `New work order ${id}`, body: `${input.product.trim()} · promised ${promised}`, link: `/production/${id}` });
  return getWorkOrder(app, id)!;
}

export interface StageInput { courier?: string; consignment?: string; invoiceRef?: string; photoBase64?: string; photoName?: string; qcResult?: 'pass' | 'rework' | 'reject'; notes?: string }

export function moveWorkOrder(app: App, actor: Employee, id: string, to: WoStage, input: StageInput = {}): WorkOrder {
  const w = requireWorkOrder(app, id);
  const stages = stagesInUse(app);
  if (!stages.includes(to)) throw new HttpError(400, 'Unknown stage');
  const nowIso = new Date().toISOString();
  const sets: string[] = ['stage = ?', 'updated_at = ?']; const params: (string | number | null)[] = [to, nowIso];
  if (to === 'in_production' && !w.started_at) { sets.push('started_at = ?'); params.push(nowIso); }
  if (to === 'qc') { sets.push('qc_result = ?'); params.push(input.qcResult || null); if (input.qcResult === 'rework') { sets[0] = 'stage = ?'; params[0] = 'in_production'; } }
  if (to === 'packed') { sets.push('packed_at = ?'); params.push(nowIso); }
  if (to === 'dispatched') {
    if (!(input.invoiceRef || w.invoice_ref)) throw new HttpError(400, 'Enter the invoice reference before dispatch.');
    if (!(input.consignment || w.consignment)) throw new HttpError(400, 'Enter the courier and consignment number.');
    sets.push('dispatched_at = ?', 'courier = ?', 'consignment = ?', 'invoice_ref = ?');
    params.push(nowIso, input.courier || w.courier, input.consignment || w.consignment, input.invoiceRef || w.invoice_ref);
    if (input.photoBase64) { const p = savePhoto(app, id, input.photoBase64, input.photoName || 'photo.jpg'); sets.push('photo_path = ?'); params.push(p); }
  }
  if (to === 'delivered') { sets.push('delivered_at = ?'); params.push(nowIso); }
  if (input.notes) { sets.push('notes = ?'); params.push((w.notes ? w.notes + '\n' : '') + input.notes); }
  params.push(id);
  app.db.run(`UPDATE work_orders SET ${sets.join(', ')} WHERE id = ?`, params);
  audit(app.db, { entity: 'work_order', entityId: id, action: 'stage', actorId: actor.id, before: { stage: w.stage }, after: { stage: to, qc: input.qcResult } });
  if (to === 'dispatched' && w.customer_id) {
    const cust = app.db.get<{ email: string; name: string }>('SELECT email, name FROM customers WHERE id = ?', [w.customer_id]);
    if (cust?.email) void app.mailer.send({ to: cust.email, subject: `Your order ${id} has been dispatched`, text: `Dear ${cust.name},\n\n${w.product} (qty ${w.qty}) was dispatched today via ${input.courier || w.courier}, consignment ${input.consignment || w.consignment}.\n\nLoyal String` });
  }
  return getWorkOrder(app, id)!;
}

function savePhoto(app: App, id: string, base64: string, name: string): string {
  const data = base64.replace(/^data:[^;]+;base64,/, '');
  const buf = Buffer.from(data, 'base64');
  if (buf.length > 5 * 1024 * 1024) throw new HttpError(413, 'Photo is larger than 5 MB.');
  const ext = (name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const dir = join(app.cfg.uploadsDir, 'dispatch');
  mkdirSync(dir, { recursive: true });
  const file = `${id}-${Date.now()}.${ext}`;
  writeFileSync(join(dir, file), buf);
  return `dispatch/${file}`;
}

export function onTimeDispatchRate(app: App, since: string): { onTime: number; total: number } {
  const rows = app.db.all<{ promised_date: string | null; dispatched_at: string }>("SELECT promised_date, dispatched_at FROM work_orders WHERE kind = 'order' AND dispatched_at >= ?", [since]);
  const total = rows.length;
  const onTime = rows.filter((r) => !r.promised_date || localDateString(new Date(r.dispatched_at)) <= r.promised_date).length;
  return { onTime, total };
}
