import type { App } from '../../app.ts';
import { audit } from '../../lib/audit.ts';
import { HttpError } from '../../lib/http.ts';
import { getSetting } from '../../lib/settings.ts';
import { daysBetween } from '../../lib/time.ts';
import { getEmployee, type Employee } from '../people/model.ts';
import { createTask, requestApproval } from '../tasks/service.ts';
import { createTicket } from '../desk/service.ts';
import { createWorkOrder } from '../production/service.ts';

import { setDefaults, onList } from '../../lib/lists.ts';
export type Stage = 'new' | 'contacted' | 'qualified' | 'demo' | 'proposal' | 'negotiation' | 'won' | 'lost';
export const STAGES: Stage[] = ['new', 'contacted', 'qualified', 'demo', 'proposal', 'negotiation', 'won'];
export const STAGE_LABEL: Record<Stage, string> = { new: 'New lead', contacted: 'Contacted', qualified: 'Qualified', demo: 'Demo', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
export const WIN_CHANCE: Record<Stage, number> = { new: 10, contacted: 20, qualified: 40, demo: 55, proposal: 70, negotiation: 85, won: 100, lost: 0 };
export const LOST_REASONS = ['Price', 'Timeline', 'Feature gap', 'No budget', 'Chose competitor', 'No response'];
// Names, win chances and lost reasons can be changed under Settings → Lists.
setDefaults('sales.stages', ([...STAGES, 'lost'] as Stage[]).map((s) => ({ value: s, label: STAGE_LABEL[s], n: WIN_CHANCE[s], active: true })));
onList('sales.stages', (items) => { for (const i of items) if (i.value in STAGE_LABEL) { STAGE_LABEL[i.value as Stage] = i.label; WIN_CHANCE[i.value as Stage] = i.value === 'won' ? 100 : i.value === 'lost' ? 0 : i.n ?? WIN_CHANCE[i.value as Stage]; } });
onList('sales.lostReasons', (items) => { LOST_REASONS.length = 0; LOST_REASONS.push(...items.filter((i) => i.active).map((i) => i.label)); });

export interface Customer { id: string; name: string; city: string; segment: string; contact_name: string; phone: string; email: string; source: string; owner_id: string | null; created_at: string }
export interface Deal {
  id: string; customer_id: string; title: string; stage: Stage; value: number; currency: string; owner_id: string; source: string; next_step: string; next_step_due: string | null; expected_close: string | null;
  stage_since: string; quote_attached: number; discount_pct: number; discount_status: string; po_received: number; qualified_need: string; qualified_budget: string; qualified_timeline: string;
  won_at: string | null; lost_at: string | null; lost_reason: string; created_at: string; updated_at: string;
  customer_name?: string; owner_name?: string; days_in_stage?: number;
}
export interface Activity { id: number; deal_id: string | null; customer_id: string | null; kind: string; notes: string; outcome: string; actor_id: string; at: string; lat: number | null; lng: number | null; km: number; actor_name?: string }

const SELECT = 'SELECT d.*, c.name AS customer_name, e.full_name AS owner_name FROM deals d JOIN customers c ON c.id = d.customer_id JOIN employees e ON e.id = d.owner_id';

function decorate(d: Deal): Deal { d.days_in_stage = daysBetween(d.stage_since, new Date()); return d; }

export function listCustomers(app: App, q = ''): Customer[] {
  return q ? app.db.all<Customer>('SELECT * FROM customers WHERE name LIKE ? OR city LIKE ? ORDER BY name LIMIT 100', [`%${q}%`, `%${q}%`]) : app.db.all<Customer>('SELECT * FROM customers ORDER BY name');
}
export function getCustomer(app: App, id: string): Customer | undefined { return app.db.get<Customer>('SELECT * FROM customers WHERE id = ?', [id]); }

export function createCustomer(app: App, actor: Employee | null, input: Partial<Customer> & { name: string }): Customer {
  if (!input.name || input.name.trim().length < 2) throw new HttpError(400, 'Customer needs a name.');
  const existing = app.db.get<Customer>('SELECT * FROM customers WHERE lower(name) = lower(?)', [input.name.trim()]);
  if (existing) return existing;
  const id = app.db.nextId('C');
  app.db.run('INSERT INTO customers (id, name, city, segment, contact_name, phone, email, source, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.name.trim(), input.city || '', input.segment || '', input.contact_name || '', input.phone || '', input.email || '', input.source || '', input.owner_id || actor?.id || null, new Date().toISOString()]);
  audit(app.db, { entity: 'customer', entityId: id, action: 'create', actorId: actor?.id });
  return getCustomer(app, id)!;
}

export function getDeal(app: App, id: string): Deal | undefined { const d = app.db.get<Deal>(`${SELECT} WHERE d.id = ?`, [id]); return d ? decorate(d) : undefined; }
export function requireDeal(app: App, id: string): Deal { const d = getDeal(app, id); if (!d) throw new HttpError(404, `Deal ${id} not found`); return d; }

export function listDeals(app: App, f: { ownerIds?: string[]; stages?: Stage[]; open?: boolean; wonSince?: string; limit?: number } = {}): Deal[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.ownerIds && f.ownerIds.length) { where.push(`d.owner_id IN (${f.ownerIds.map(() => '?').join(',')})`); params.push(...f.ownerIds); }
  if (f.stages && f.stages.length) { where.push(`d.stage IN (${f.stages.map(() => '?').join(',')})`); params.push(...f.stages); }
  if (f.open) where.push("d.stage NOT IN ('won','lost')");
  if (f.wonSince) { where.push("d.stage = 'won' AND d.won_at >= ?"); params.push(f.wonSince); }
  params.push(f.limit || 500);
  return app.db.all<Deal>(`${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.value DESC LIMIT ?`, params).map(decorate);
}

export interface NewDeal { customerId?: string; customerName?: string; title?: string; value: number; currency?: string; source?: string; nextStep?: string; ownerId?: string; expectedClose?: string | null; city?: string }

export function createDeal(app: App, actor: Employee, input: NewDeal): Deal {
  let customerId = input.customerId || null;
  if (!customerId && input.customerName) customerId = createCustomer(app, actor, { name: input.customerName, city: input.city || '', source: input.source || '' }).id;
  if (!customerId) throw new HttpError(400, 'Pick or name a customer.');
  if (!(input.value >= 0)) throw new HttpError(400, 'Enter the deal value.');
  const id = app.db.nextId('DL'); const nowIso = new Date().toISOString();
  app.db.run(`INSERT INTO deals (id, customer_id, title, stage, value, currency, owner_id, source, next_step, next_step_due, expected_close, stage_since, created_at, updated_at)
    VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, customerId, input.title || '', input.value, input.currency || 'INR', input.ownerId || actor.id, input.source || '', input.nextStep || 'Qualify: need, budget, timeline', null, input.expectedClose || null, nowIso, nowIso, nowIso]);
  audit(app.db, { entity: 'deal', entityId: id, action: 'create', actorId: actor.id, after: { value: input.value, owner: input.ownerId || actor.id } });
  if (input.ownerId && input.ownerId !== actor.id) app.notify.send({ employeeId: input.ownerId, title: `New lead assigned: ${getCustomer(app, customerId)?.name}`, body: input.nextStep || '', link: `/sales/${id}` });
  return getDeal(app, id)!;
}

export function updateDeal(app: App, actor: Employee, id: string, patch: Partial<Pick<Deal, 'title' | 'value' | 'currency' | 'next_step' | 'next_step_due' | 'expected_close' | 'qualified_need' | 'qualified_budget' | 'qualified_timeline' | 'po_received' | 'owner_id' | 'source'>>): Deal {
  const d = requireDeal(app, id);
  const fields: string[] = []; const params: (string | number | null)[] = [];
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) continue; fields.push(`${k} = ?`); params.push(v as string | number | null); }
  if (!fields.length) return d;
  params.push(new Date().toISOString(), id);
  app.db.run(`UPDATE deals SET ${fields.join(', ')}, updated_at = ? WHERE id = ?`, params);
  audit(app.db, { entity: 'deal', entityId: id, action: 'update', actorId: actor.id, after: patch });
  return getDeal(app, id)!;
}

/** The exit rule that blocks a move, if any (decision E1/E4/E6). */
export function exitRuleProblem(d: Deal, to: Stage): string | null {
  if (to === 'qualified' && !(d.qualified_need && d.qualified_budget && d.qualified_timeline)) return 'Record need, budget and timeline before Qualified.';
  if (to === 'proposal' && !d.quote_attached) return 'Finalise an estimate before Proposal.';
  if (to === 'won' && d.discount_status === 'pending') return 'The discount is waiting for approval.';
  if (to === 'won' && !d.po_received) return 'Record the PO or advance before marking Won.';
  return null;
}

export function moveDeal(app: App, actor: Employee, id: string, to: Stage, opts: { lostReason?: string } = {}): Deal {
  const d = requireDeal(app, id);
  if (!STAGES.includes(to) && to !== 'lost') throw new HttpError(400, 'Unknown stage');
  if (to === 'won') return winDeal(app, actor, id);
  const problem = exitRuleProblem(d, to);
  if (problem) throw new HttpError(400, problem);
  const nowIso = new Date().toISOString();
  app.db.transaction(() => {
    app.db.run('UPDATE deals SET stage = ?, stage_since = ?, lost_at = ?, lost_reason = ?, next_step_due = COALESCE(next_step_due, ?), updated_at = ? WHERE id = ?',
      [to, nowIso, to === 'lost' ? nowIso : null, to === 'lost' ? (opts.lostReason || 'No response') : '', new Date(Date.now() + 86_400_000).toISOString(), nowIso, id]);
    addActivity(app, actor, { dealId: id, kind: 'stage', notes: `${STAGE_LABEL[d.stage]} → ${STAGE_LABEL[to]}${opts.lostReason ? ' (' + opts.lostReason + ')' : ''}` });
    audit(app.db, { entity: 'deal', entityId: id, action: 'stage', actorId: actor.id, before: { stage: d.stage }, after: { stage: to } });
  });
  return getDeal(app, id)!;
}

/** Won: the three hand-offs happen in one transaction (work order, invoice request, implementation ticket). */
export function winDeal(app: App, actor: Employee, id: string): Deal {
  const d = requireDeal(app, id);
  if (d.stage === 'won') return d;
  const problem = exitRuleProblem(d, 'won');
  if (problem) throw new HttpError(400, problem);
  const company = getSetting(app.db, 'company');
  const nowIso = new Date().toISOString();
  app.db.transaction(() => {
    app.db.run("UPDATE deals SET stage = 'won', stage_since = ?, won_at = ?, updated_at = ? WHERE id = ?", [nowIso, nowIso, nowIso, id]);
    addActivity(app, actor, { dealId: id, kind: 'won', notes: `Won at ${d.currency} ${Math.round(d.value * (1 - d.discount_pct / 100)).toLocaleString('en-IN')}` });
    const wo = createWorkOrder(app, actor, { customerId: d.customer_id, dealId: id, product: d.title || `Order for ${d.customer_name}`, qty: 1, kind: 'order' });
    createTask(app, actor, { kind: 'task', type: 'invoice_request', title: `Raise invoice: ${d.customer_name} (${id})`, details: `Deal ${id} won by ${actor.full_name}. Value ${d.currency} ${d.value}, discount ${d.discount_pct}%. Work order ${wo.id}.`, assigneeId: company.accountsOwnerId, requesterId: actor.id, dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), link: `/sales/${id}` });
    const supportLead = app.db.get<{ id: string }>("SELECT id FROM employees WHERE department_id = 'SUP' AND functional_role = 'team_lead' AND status = 'active' LIMIT 1")?.id || company.cooId;
    createTicket(app, actor, { customerId: d.customer_id, subject: `Implementation: ${d.customer_name}`, description: `From deal ${id}. Plan 21 days.`, type: 'implementation', priority: 'P3', channel: 'system', assigneeId: supportLead, implPlanDays: 21 });
    audit(app.db, { entity: 'deal', entityId: id, action: 'won', actorId: actor.id, after: { workOrder: wo.id } });
  });
  app.notify.sendMany([company.salesHeadId, company.cooId].filter((x) => x !== actor.id), { title: `Deal won: ${d.customer_name}`, body: `${actor.full_name} closed ${d.currency} ${Math.round(d.value).toLocaleString('en-IN')}. Work order, invoice request and implementation ticket created.`, link: `/sales/${id}`, kind: 'success' });
  return getDeal(app, id)!;
}

export function createQuote(app: App, actor: Employee, dealId: string, input: { discountPct?: number; currency?: string; listTotal?: number }): { deal: Deal; quoteId: string; approvalTaskId: string | null } {
  const d = requireDeal(app, dealId);
  const discount = Math.max(0, Math.min(50, Number(input.discountPct ?? d.discount_pct) || 0));
  const currency = input.currency || d.currency;
  const listTotal = input.listTotal ?? d.value;
  const version = (app.db.get<{ v: number }>('SELECT count(*) AS v FROM quotes WHERE deal_id = ?', [dealId])?.v || 0) + 1;
  const quoteId = app.db.nextId('Q');
  let approvalTaskId: string | null = null;
  app.db.transaction(() => {
    app.db.run('INSERT INTO quotes (id, deal_id, version, currency, list_total, discount_pct, total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [quoteId, dealId, version, currency, listTotal, discount, listTotal * (1 - discount / 100), 'draft', new Date().toISOString()]);
    const needsApproval = discount > (getSetting(app.db, 'approvals').discount[0].maxPct ?? 5);
    app.db.run('UPDATE deals SET quote_attached = 1, discount_pct = ?, currency = ?, value = ?, discount_status = ?, updated_at = ? WHERE id = ?',
      [discount, currency, listTotal, needsApproval ? 'pending' : discount > 0 ? 'approved' : 'none', new Date().toISOString(), dealId]);
    addActivity(app, actor, { dealId, kind: 'quote', notes: `Quote ${quoteId} v${version}: ${currency} ${Math.round(listTotal * (1 - discount / 100)).toLocaleString('en-IN')} (${discount}% discount)` });
    if (needsApproval) {
      const task = requestApproval(app, actor, 'discount', discount, `Discount ${discount}% on ${d.customer_name} (${dealId})`, `Quote ${quoteId}: list ${currency} ${listTotal.toLocaleString('en-IN')}, discount ${discount}%.`, { dealId, quoteId }, `/sales/${dealId}`);
      approvalTaskId = task.id;
      if (task.status === 'approved') app.db.run("UPDATE deals SET discount_status = 'approved' WHERE id = ?", [dealId]);
    }
  });
  return { deal: getDeal(app, dealId)!, quoteId, approvalTaskId };
}

export function listQuotes(app: App, dealId: string) {
  return app.db.all<{ id: string; version: number; currency: string; list_total: number; discount_pct: number; total: number; status: string; created_at: string }>('SELECT * FROM quotes WHERE deal_id = ? ORDER BY version DESC', [dealId]);
}

export interface NewActivity { dealId?: string | null; customerId?: string | null; kind: 'call' | 'visit' | 'demo' | 'email' | 'note' | 'stage' | 'quote' | 'won'; notes?: string; outcome?: string; lat?: number | null; lng?: number | null; km?: number | null; at?: string }

export function addActivity(app: App, actor: Employee, a: NewActivity): Activity {
  const deal = a.dealId ? getDeal(app, a.dealId) : undefined;
  let km = a.km ?? 0;
  if (a.kind === 'visit' && a.lat != null && a.lng != null && !a.km) {
    const prev = app.db.get<{ lat: number; lng: number }>("SELECT lat, lng FROM activities WHERE actor_id = ? AND kind = 'visit' AND lat IS NOT NULL AND date(at) = date(?) ORDER BY id DESC LIMIT 1", [actor.id, a.at || new Date().toISOString()]);
    if (prev) km = Math.round(haversineKm(prev.lat, prev.lng, a.lat, a.lng) * 10) / 10;
  }
  const r = app.db.run('INSERT INTO activities (deal_id, customer_id, kind, notes, outcome, actor_id, at, lat, lng, km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [a.dealId || null, a.customerId || deal?.customer_id || null, a.kind, a.notes || '', a.outcome || '', actor.id, a.at || new Date().toISOString(), a.lat ?? null, a.lng ?? null, km]);
  if (a.dealId && ['call', 'visit', 'demo', 'email'].includes(a.kind)) app.db.run('UPDATE deals SET updated_at = ? WHERE id = ?', [new Date().toISOString(), a.dealId]);
  return app.db.get<Activity>('SELECT a.*, e.full_name AS actor_name FROM activities a JOIN employees e ON e.id = a.actor_id WHERE a.id = ?', [r.lastInsertRowid])!;
}

export function listActivities(app: App, f: { dealId?: string; actorIds?: string[]; since?: string; kind?: string; limit?: number } = {}): Activity[] {
  const where: string[] = []; const params: (string | number)[] = [];
  if (f.dealId) { where.push('a.deal_id = ?'); params.push(f.dealId); }
  if (f.actorIds && f.actorIds.length) { where.push(`a.actor_id IN (${f.actorIds.map(() => '?').join(',')})`); params.push(...f.actorIds); }
  if (f.since) { where.push('a.at >= ?'); params.push(f.since); }
  if (f.kind) { where.push('a.kind = ?'); params.push(f.kind); }
  params.push(f.limit || 200);
  return app.db.all<Activity>(`SELECT a.*, e.full_name AS actor_name FROM activities a JOIN employees e ON e.id = a.actor_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.at DESC LIMIT ?`, params);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function ownerName(app: App, id: string): string { return getEmployee(app.db, id)?.full_name || id; }
