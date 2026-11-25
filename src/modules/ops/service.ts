// Phase 2 operations: man-hour time logs, procurement items and forecast, departmental budgets, travel costs.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { getSetting } from '../../lib/settings.ts';
import { fiscalYear, addDays } from '../../lib/time.ts';
import { getEmployee, listDepartments, type Employee } from '../people/model.ts';
import { listDeals, WIN_CHANCE } from '../sales/service.ts';
import { listWorkOrders } from '../production/service.ts';

// ---------- Time logs (man-hours) ----------
export interface TimeLog { id: number; entity_type: string; entity_id: string; employee_id: string; started_at: string; ended_at: string | null; minutes: number; note: string; employee_name?: string }

export function runningTimer(app: App, employeeId: string): TimeLog | undefined {
  return app.db.get<TimeLog>('SELECT * FROM time_logs WHERE employee_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1', [employeeId]);
}

export function startTimer(app: App, actor: Employee, entityType: 'work_order' | 'task' | 'creative' | 'issue', entityId: string): TimeLog {
  const open = runningTimer(app, actor.id);
  if (open) stopTimer(app, actor, 'Stopped automatically when another timer started');
  const r = app.db.run('INSERT INTO time_logs (entity_type, entity_id, employee_id, started_at, minutes) VALUES (?, ?, ?, ?, 0)', [entityType, entityId, actor.id, new Date().toISOString()]);
  return app.db.get<TimeLog>('SELECT * FROM time_logs WHERE id = ?', [r.lastInsertRowid])!;
}

export function stopTimer(app: App, actor: Employee, note = ''): TimeLog | null {
  const open = runningTimer(app, actor.id);
  if (!open) return null;
  const ended = new Date();
  const minutes = Math.max(1, Math.round((ended.getTime() - new Date(open.started_at).getTime()) / 60_000));
  app.db.run('UPDATE time_logs SET ended_at = ?, minutes = ?, note = ? WHERE id = ?', [ended.toISOString(), minutes, note || open.note, open.id]);
  return app.db.get<TimeLog>('SELECT * FROM time_logs WHERE id = ?', [open.id])!;
}

export function logTime(app: App, actor: Employee, entityType: string, entityId: string, minutes: number, note: string, employeeId?: string): TimeLog {
  if (!(minutes > 0)) throw new HttpError(400, 'Enter the time in minutes or hours.');
  const who = employeeId || actor.id;
  const now = new Date();
  const r = app.db.run('INSERT INTO time_logs (entity_type, entity_id, employee_id, started_at, ended_at, minutes, note) VALUES (?, ?, ?, ?, ?, ?, ?)', [entityType, entityId, who, new Date(now.getTime() - minutes * 60_000).toISOString(), now.toISOString(), Math.round(minutes), note]);
  audit(app.db, { entity: entityType, entityId, action: 'time.log', actorId: actor.id, after: { minutes, employee: who } });
  return app.db.get<TimeLog>('SELECT * FROM time_logs WHERE id = ?', [r.lastInsertRowid])!;
}

export function timeFor(app: App, entityType: string, entityId: string): { logs: TimeLog[]; minutes: number } {
  const logs = app.db.all<TimeLog>('SELECT t.*, e.full_name AS employee_name FROM time_logs t JOIN employees e ON e.id = t.employee_id WHERE t.entity_type = ? AND t.entity_id = ? ORDER BY t.id DESC', [entityType, entityId]);
  return { logs, minutes: logs.reduce((n, l) => n + l.minutes, 0) };
}

export function hoursByPerson(app: App, since: string, until: string, employeeIds?: string[]): { employee_id: string; name: string; minutes: number; entries: number }[] {
  const where = employeeIds && employeeIds.length ? `AND t.employee_id IN (${employeeIds.map(() => '?').join(',')})` : '';
  return app.db.all('SELECT t.employee_id, e.full_name AS name, SUM(t.minutes) AS minutes, count(*) AS entries FROM time_logs t JOIN employees e ON e.id = t.employee_id WHERE t.started_at >= ? AND t.started_at < ? AND t.ended_at IS NOT NULL ' + where + ' GROUP BY t.employee_id ORDER BY minutes DESC', [since, until, ...(employeeIds || [])]);
}

// ---------- Procurement ----------
export type ProcStatus = 'planned' | 'ordered' | 'received' | 'cancelled';
export interface ProcItem { id: string; item: string; qty: number; unit: string; needed_by: string | null; supplier: string; est_cost: number; status: ProcStatus; work_order_id: string | null; deal_id: string | null; ordered_at: string | null; expected_at: string | null; received_at: string | null; notes: string; created_by: string | null; created_at: string; updated_at: string; wo_product?: string | null; deal_customer?: string | null }

const PSELECT = 'SELECT p.*, w.product AS wo_product, c.name AS deal_customer FROM procurement_items p LEFT JOIN work_orders w ON w.id = p.work_order_id LEFT JOIN deals d ON d.id = p.deal_id LEFT JOIN customers c ON c.id = d.customer_id';

export function listProcurement(app: App, f: { open?: boolean; workOrderId?: string } = {}): ProcItem[] {
  const where: string[] = []; const params: string[] = [];
  if (f.open) where.push("p.status IN ('planned','ordered')");
  if (f.workOrderId) { where.push('p.work_order_id = ?'); params.push(f.workOrderId); }
  return app.db.all<ProcItem>(`${PSELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE p.status WHEN 'planned' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END, p.needed_by, p.id`, params);
}

export function saveProcurement(app: App, actor: Employee, input: { id?: string; item: string; qty?: number; unit?: string; neededBy?: string | null; supplier?: string; estCost?: number; workOrderId?: string | null; dealId?: string | null; notes?: string }): ProcItem {
  if (!input.item || input.item.trim().length < 2) throw new HttpError(400, 'Name the item.');
  const nowIso = new Date().toISOString();
  if (input.id) {
    app.db.run('UPDATE procurement_items SET item = ?, qty = ?, unit = ?, needed_by = ?, supplier = ?, est_cost = ?, work_order_id = ?, deal_id = ?, notes = ?, updated_at = ? WHERE id = ?',
      [input.item.trim(), input.qty ?? 1, input.unit || 'pcs', input.neededBy || null, input.supplier || '', input.estCost ?? 0, input.workOrderId || null, input.dealId || null, input.notes || '', nowIso, input.id]);
    return app.db.get<ProcItem>(`${PSELECT} WHERE p.id = ?`, [input.id])!;
  }
  const id = app.db.nextId('PR', 500);
  app.db.run('INSERT INTO procurement_items (id, item, qty, unit, needed_by, supplier, est_cost, status, work_order_id, deal_id, notes, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.item.trim(), input.qty ?? 1, input.unit || 'pcs', input.neededBy || null, input.supplier || '', input.estCost ?? 0, 'planned', input.workOrderId || null, input.dealId || null, input.notes || '', actor.id, nowIso, nowIso]);
  audit(app.db, { entity: 'procurement', entityId: id, action: 'create', actorId: actor.id, after: input });
  return app.db.get<ProcItem>(`${PSELECT} WHERE p.id = ?`, [id])!;
}

export function setProcurementStatus(app: App, actor: Employee, id: string, status: ProcStatus, opts: { expectedAt?: string | null } = {}): ProcItem {
  const cur = app.db.get<ProcItem>('SELECT * FROM procurement_items WHERE id = ?', [id]);
  if (!cur) throw new HttpError(404, 'Item not found');
  const nowIso = new Date().toISOString();
  app.db.run('UPDATE procurement_items SET status = ?, ordered_at = CASE WHEN ? = \'ordered\' THEN ? ELSE ordered_at END, expected_at = COALESCE(?, expected_at), received_at = CASE WHEN ? = \'received\' THEN ? ELSE received_at END, updated_at = ? WHERE id = ?',
    [status, status, nowIso, opts.expectedAt || null, status, nowIso, nowIso, id]);
  audit(app.db, { entity: 'procurement', entityId: id, action: 'status', actorId: actor.id, before: { status: cur.status }, after: { status } });
  if (status === 'received' && cur.work_order_id) {
    const pending = app.db.get<{ n: number }>("SELECT count(*) AS n FROM procurement_items WHERE work_order_id = ? AND status IN ('planned','ordered')", [cur.work_order_id])?.n || 0;
    if (!pending) app.db.run("UPDATE work_orders SET materials_status = 'ready', updated_at = ? WHERE id = ? AND materials_status != 'ready'", [nowIso, cur.work_order_id]);
  }
  return app.db.get<ProcItem>(`${PSELECT} WHERE p.id = ?`, [id])!;
}

export function setMaterials(app: App, actor: Employee, workOrderId: string, status: 'unchecked' | 'short' | 'ready', note: string): void {
  app.db.run('UPDATE work_orders SET materials_status = ?, materials_note = ?, updated_at = ? WHERE id = ?', [status, note, new Date().toISOString(), workOrderId]);
  audit(app.db, { entity: 'work_order', entityId: workOrderId, action: 'materials', actorId: actor.id, after: { status, note } });
}

/** Demand forecast: open deals weighted by stage win chance + won orders not yet started. */
export interface ForecastLine { kind: 'deal' | 'order'; id: string; customer: string; product: string; qty: number; stage: string; chance: number; value: number; weighted: number; expected: string | null; owner: string }
export function forecast(app: App, horizonDays = 90): { lines: ForecastLine[]; weightedValue: number; firmValue: number; byMonth: { month: string; firm: number; weighted: number }[] } {
  const now = new Date(); const until = addDays(now, horizonDays).toISOString().slice(0, 10);
  const lines: ForecastLine[] = [];
  for (const d of listDeals(app, { open: true, limit: 2000 })) {
    if (d.stage === 'new' || d.stage === 'contacted') continue;
    if (d.expected_close && d.expected_close > until) continue;
    const net = d.value * (1 - d.discount_pct / 100);
    lines.push({ kind: 'deal', id: d.id, customer: d.customer_name || '', product: d.title || 'Not specified', qty: 1, stage: d.stage, chance: WIN_CHANCE[d.stage], value: net, weighted: net * WIN_CHANCE[d.stage] / 100, expected: d.expected_close, owner: d.owner_name || '' });
  }
  for (const w of listWorkOrders(app, { open: true, limit: 2000 })) {
    if (w.stage !== 'queued' || w.kind !== 'order') continue;
    const deal = w.deal_id ? app.db.get<{ value: number; discount_pct: number }>('SELECT value, discount_pct FROM deals WHERE id = ?', [w.deal_id]) : null;
    const value = deal ? deal.value * (1 - deal.discount_pct / 100) : 0;
    lines.push({ kind: 'order', id: w.id, customer: w.customer_name || '', product: w.product, qty: w.qty, stage: 'won · queued', chance: 100, value, weighted: value, expected: w.promised_date, owner: w.assignee_name || '' });
  }
  lines.sort((a, b) => (a.expected || '9').localeCompare(b.expected || '9'));
  const byMonthMap = new Map<string, { firm: number; weighted: number }>();
  for (const l of lines) { const m = (l.expected || until).slice(0, 7); const e = byMonthMap.get(m) || { firm: 0, weighted: 0 }; if (l.kind === 'order') e.firm += l.value; else e.weighted += l.weighted; byMonthMap.set(m, e); }
  return { lines, weightedValue: lines.filter((l) => l.kind === 'deal').reduce((n, l) => n + l.weighted, 0), firmValue: lines.filter((l) => l.kind === 'order').reduce((n, l) => n + l.value, 0), byMonth: [...byMonthMap.entries()].sort().map(([month, v]) => ({ month, ...v })) };
}

// ---------- Budgets ----------
export interface BudgetLine { department_id: string; department: string; fiscal_year: string; amount: number; spent: number; committed: number; remaining: number; pct: number | null; notes: string }

export function fyBounds(fy: string): { start: string; end: string } {
  const y = 2000 + Number(fy.slice(2, 4));
  return { start: `${y}-04-01`, end: `${y + 1}-04-01` };
}

export function budgets(app: App, fy = fiscalYear(new Date())): BudgetLine[] {
  const { start, end } = fyBounds(fy);
  return listDepartments(app.db).filter((d) => d.code !== 'LEAD').map((d) => {
    const row = app.db.get<{ amount: number; notes: string }>('SELECT amount, notes FROM budgets WHERE department_id = ? AND fiscal_year = ?', [d.id, fy]);
    const spent = app.db.get<{ n: number }>("SELECT COALESCE(SUM(x.amount),0) AS n FROM expenses x JOIN employees e ON e.id = x.employee_id WHERE COALESCE(x.department_id, e.department_id) = ? AND x.status IN ('approved', 'paid') AND x.kind <> 'advance' AND x.created_at >= ? AND x.created_at < ?", [d.id, start, end])?.n || 0;
    const purchases = app.db.get<{ n: number }>("SELECT COALESCE(SUM(t.amount),0) AS n FROM tasks t JOIN employees e ON e.id = t.requester_id WHERE t.type = 'purchase' AND e.department_id = ? AND t.status = 'approved' AND t.created_at >= ? AND t.created_at < ?", [d.id, start, end])?.n || 0;
    const committed = app.db.get<{ n: number }>("SELECT COALESCE(SUM(t.amount),0) AS n FROM tasks t JOIN employees e ON e.id = t.requester_id WHERE t.type IN ('purchase','expense') AND e.department_id = ? AND t.status = 'open' AND t.created_at >= ? AND t.created_at < ?", [d.id, start, end])?.n || 0;
    const amount = row?.amount || 0; const used = spent + purchases;
    return { department_id: d.id, department: d.name, fiscal_year: fy, amount, spent: used, committed, remaining: amount - used - committed, pct: amount ? Math.round((used / amount) * 100) : null, notes: row?.notes || '' };
  });
}

export function setBudget(app: App, actor: Employee, departmentId: string, fy: string, amount: number, notes: string): void {
  if (!(amount >= 0)) throw new HttpError(400, 'Enter the budget amount.');
  const before = app.db.get<{ amount: number }>('SELECT amount FROM budgets WHERE department_id = ? AND fiscal_year = ?', [departmentId, fy])?.amount ?? null;
  app.db.run('INSERT INTO budgets (department_id, fiscal_year, amount, notes, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(department_id, fiscal_year) DO UPDATE SET amount = excluded.amount, notes = excluded.notes, set_by = excluded.set_by, set_at = excluded.set_at', [departmentId, fy, amount, notes, actor.id, new Date().toISOString()]);
  audit(app.db, { entity: 'budget', entityId: `${departmentId}:${fy}`, action: 'set', actorId: actor.id, before: { amount: before }, after: { amount, notes } });
}

export function budgetFor(app: App, employeeId: string): BudgetLine | null {
  const e = getEmployee(app.db, employeeId); if (!e) return null;
  return budgets(app).find((b) => b.department_id === e.department_id) || null;
}

// ---------- Travel ----------
export interface TravelRow { employee_id: string; name: string; visits: number; km: number; estCost: number; claimed: number; wonValue: number; wonDeals: number; openValue: number }

export function travelReport(app: App, since: string, until: string, employeeIds?: string[]): { rows: TravelRow[]; ratePerKm: number } {
  const rate = getSetting(app.db, 'travel').ratePerKm;
  const where = employeeIds && employeeIds.length ? `AND a.actor_id IN (${employeeIds.map(() => '?').join(',')})` : '';
  const visits = app.db.all<{ employee_id: string; name: string; visits: number; km: number }>(`SELECT a.actor_id AS employee_id, e.full_name AS name, count(*) AS visits, COALESCE(SUM(a.km),0) AS km FROM activities a JOIN employees e ON e.id = a.actor_id WHERE a.kind = 'visit' AND a.at >= ? AND a.at < ? ${where} GROUP BY a.actor_id`, [since, until, ...(employeeIds || [])]);
  const rows: TravelRow[] = visits.map((v) => {
    const claimed = app.db.get<{ n: number }>("SELECT COALESCE(SUM(amount),0) AS n FROM expenses WHERE employee_id = ? AND status != 'declined' AND kind <> 'advance' AND lower(category) LIKE '%travel%' AND created_at >= ? AND created_at < ?", [v.employee_id, since, until])?.n || 0;
    const won = app.db.get<{ n: number; v: number }>('SELECT count(*) AS n, COALESCE(SUM(value * (1 - discount_pct / 100.0)),0) AS v FROM deals WHERE owner_id = ? AND won_at >= ? AND won_at < ?', [v.employee_id, since, until]) || { n: 0, v: 0 };
    const open = app.db.get<{ v: number }>("SELECT COALESCE(SUM(value * (1 - discount_pct / 100.0)),0) AS v FROM deals WHERE owner_id = ? AND stage NOT IN ('won','lost')", [v.employee_id])?.v || 0;
    return { employee_id: v.employee_id, name: v.name, visits: v.visits, km: Math.round(v.km * 10) / 10, estCost: Math.round(v.km * rate), claimed, wonValue: won.v, wonDeals: won.n, openValue: open };
  });
  rows.sort((a, b) => b.visits - a.visits);
  return { rows, ratePerKm: rate };
}
