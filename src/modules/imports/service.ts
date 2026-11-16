// Import real data from Excel/CSV: download a template, upload the file, preview with validation, commit.
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { buildXlsx } from '../../lib/xlsx.ts';
import { parseTable, mapRows, excelSerialToDate } from '../../lib/tabular.ts';
import { getEmployeeByEmail, listEmployees, type Employee } from '../people/model.ts';
import { createCustomer, createDeal, listCustomers, STAGES, type Stage } from '../sales/service.ts';
import { createTicket, PRIORITIES, type Priority } from '../desk/service.ts';
import { createWorkOrder } from '../production/service.ts';

export type ImportEntity = 'customers' | 'leads' | 'tickets' | 'work_orders';

export interface ColumnDef { key: string; label: string; aliases: string[]; required?: boolean; kind?: 'text' | 'number' | 'date' | 'email'; example: string; help?: string }

export const ENTITIES: Record<ImportEntity, { title: string; description: string; columns: ColumnDef[] }> = {
  customers: {
    title: 'Customers', description: 'Customer master from Tally ledgers, Zoho or your own list. Existing names are updated, new ones created.',
    columns: [
      { key: 'name', label: 'Customer name', aliases: ['customer', 'company', 'ledger name', 'party name', 'account'], required: true, example: 'Omkar Tech Pvt Ltd' },
      { key: 'city', label: 'City', aliases: ['location', 'town'], example: 'Pune' },
      { key: 'segment', label: 'Segment', aliases: ['industry', 'type'], example: 'Manufacturing' },
      { key: 'contact_name', label: 'Contact person', aliases: ['contact', 'contact name', 'person'], example: 'Asha Kulkarni' },
      { key: 'phone', label: 'Phone', aliases: ['mobile', 'contact number', 'phone number'], example: '9876543210' },
      { key: 'email', label: 'Email', aliases: ['email id', 'mail'], kind: 'email', example: 'asha@omkartech.in' },
      { key: 'source', label: 'Source', aliases: ['lead source', 'channel'], example: 'Referral' },
      { key: 'owner_email', label: 'Owner (work email)', aliases: ['owner', 'bdm', 'account manager'], kind: 'email', example: 'alpesh.boda@loyalstring.com', help: 'The BDM who owns the account; blank = the person importing' }
    ]
  },
  leads: {
    title: 'Leads and open deals', description: 'Pipeline from IndiaMART, Zoho estimates or Excel. One row per deal; the customer is created if it does not exist.',
    columns: [
      { key: 'customer', label: 'Customer name', aliases: ['company', 'customer name', 'account', 'party'], required: true, example: 'Prime Foods' },
      { key: 'title', label: 'What they are buying', aliases: ['product', 'requirement', 'deal', 'subject', 'item'], example: 'Floor tracking kit' },
      { key: 'value', label: 'Value (₹)', aliases: ['amount', 'deal value', 'estimate', 'estimate value'], kind: 'number', required: true, example: '450000' },
      { key: 'stage', label: 'Stage', aliases: ['status', 'pipeline stage'], example: 'contacted', help: 'new, contacted, qualified, demo, proposal, negotiation (default new)' },
      { key: 'owner_email', label: 'Owner (work email)', aliases: ['owner', 'bdm', 'assigned to'], kind: 'email', example: 'alpesh.boda@loyalstring.com' },
      { key: 'city', label: 'City', aliases: ['location'], example: 'Nashik' },
      { key: 'source', label: 'Source', aliases: ['lead source', 'channel'], example: 'IndiaMART' },
      { key: 'next_step', label: 'Next step', aliases: ['next action', 'follow up', 'remarks'], example: 'Demo on Friday' },
      { key: 'next_step_due', label: 'Next step date', aliases: ['follow up date', 'next action date', 'due'], kind: 'date', example: '2026-11-14' },
      { key: 'expected_close', label: 'Expected close', aliases: ['closing date', 'close date'], kind: 'date', example: '2026-12-20' },
      { key: 'contact_name', label: 'Contact person', aliases: ['contact'], example: 'Rahul Patil' },
      { key: 'phone', label: 'Phone', aliases: ['mobile', 'contact number'], example: '9876500000' },
      { key: 'email', label: 'Email', aliases: ['email id'], kind: 'email', example: 'rahul@primefoods.in' }
    ]
  },
  tickets: {
    title: 'Open support tickets', description: 'Tickets open today, so the desk starts with the real queue. SLA clocks start from the import time.',
    columns: [
      { key: 'customer', label: 'Customer name', aliases: ['company', 'account'], required: true, example: 'Kalyani Steel' },
      { key: 'subject', label: 'Subject', aliases: ['issue', 'title', 'problem', 'description'], required: true, example: 'Barcode scanner offline on the floor' },
      { key: 'details', label: 'Details', aliases: ['notes', 'remarks'], example: 'Started after the power cut on Monday' },
      { key: 'priority', label: 'Priority', aliases: ['severity'], example: 'P2', help: 'P1–P4 (default P3)' },
      { key: 'type', label: 'Type', aliases: ['category'], example: 'support', help: 'support, implementation, internal' },
      { key: 'assignee_email', label: 'Assignee (work email)', aliases: ['assignee', 'assigned to', 'engineer'], kind: 'email', example: 'nikita.kakade@loyalstring.com' },
      { key: 'channel', label: 'Channel', aliases: ['source'], example: 'phone' }
    ]
  },
  work_orders: {
    title: 'Open work orders', description: 'Orders in the factory today, with promised dates.',
    columns: [
      { key: 'customer', label: 'Customer name', aliases: ['company', 'account'], required: true, example: 'Vardhman Tools' },
      { key: 'product', label: 'Product', aliases: ['item', 'description'], required: true, example: 'Scanner cradles' },
      { key: 'qty', label: 'Quantity', aliases: ['quantity', 'nos'], kind: 'number', example: '6' },
      { key: 'promised_date', label: 'Promised date', aliases: ['delivery date', 'due date', 'dispatch date'], kind: 'date', example: '2026-11-20' },
      { key: 'stage', label: 'Stage', aliases: ['status'], example: 'in_production', help: 'queued, in_production, packed (default queued)' },
      { key: 'assignee_email', label: 'Assignee (work email)', aliases: ['assignee', 'owner'], kind: 'email', example: 'lukman.nishad@loyalstring.com' },
      { key: 'notes', label: 'Notes', aliases: ['remarks'], example: 'Blue cradles, logo printed' }
    ]
  }
};

export function template(entity: ImportEntity): Buffer {
  const def = ENTITIES[entity];
  return buildXlsx([{ name: def.title.slice(0, 31), columns: def.columns.map((c) => ({ header: c.label, width: Math.max(14, c.label.length + 4) })), rows: [def.columns.map((c) => c.example)] },
    { name: 'How to fill', columns: [{ header: 'Column', width: 26 }, { header: 'Required', width: 10 }, { header: 'Notes', width: 70 }], rows: def.columns.map((c) => [c.label, c.required ? 'Yes' : '', `${c.help || ''}${c.kind === 'date' ? ' Date as YYYY-MM-DD or an Excel date.' : ''}${c.kind === 'email' ? ' Work email as in LoyalFlow.' : ''}`.trim()]) }], { title: `LoyalFlow import: ${def.title}` });
}

export interface PreviewRow { n: number; data: Record<string, string>; errors: string[]; warnings: string[] }
export interface Preview { id: number; entity: ImportEntity; filename: string; matched: Record<string, string>; missing: string[]; rows: PreviewRow[]; valid: number; invalid: number }

function normDate(v: string): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(v)) return excelSerialToDate(Number(v));
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v); // dd/mm/yyyy (Indian convention)
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function preview(app: App, actor: Employee, entity: ImportEntity, filename: string, buf: Buffer): Preview {
  const def = ENTITIES[entity];
  if (!def) throw new HttpError(400, 'Unknown import type');
  if (!buf.length) throw new HttpError(400, 'Choose a file first.');
  const table = parseTable(filename, buf);
  if (!table.headers.length) throw new HttpError(400, 'The file has no header row.');
  const aliases: Record<string, string[]> = {}; for (const c of def.columns) aliases[c.key] = [c.label, ...c.aliases];
  const { objects, missing, matched } = mapRows(table, aliases);
  const requiredMissing = def.columns.filter((c) => c.required && missing.includes(c.key));
  if (requiredMissing.length) throw new HttpError(400, `The file needs a column for: ${requiredMissing.map((c) => c.label).join(', ')}. Found: ${table.headers.join(', ')}.`);
  const emails = new Set(listEmployees(app.db, { status: 'active' }).map((e) => e.email.toLowerCase()));
  const existingCustomers = new Set(listCustomers(app).map((c) => c.name.toLowerCase()));
  const rows: PreviewRow[] = objects.map((data, i) => {
    const errors: string[] = []; const warnings: string[] = [];
    for (const c of def.columns) {
      const v = (data[c.key] || '').trim(); data[c.key] = v;
      if (c.required && !v) errors.push(`${c.label} is empty`);
      if (v && c.kind === 'number' && isNaN(Number(v.replace(/[,₹\s]/g, '')))) errors.push(`${c.label} is not a number`);
      if (v && c.kind === 'number') data[c.key] = v.replace(/[,₹\s]/g, '');
      if (v && c.kind === 'date') { const d = normDate(v); if (!d) errors.push(`${c.label}: cannot read date "${v}"`); else data[c.key] = d; }
      if (v && c.key.endsWith('_email') && !emails.has(v.toLowerCase())) warnings.push(`${c.label} "${v}" is not an employee; it will be left blank`);
    }
    if (entity === 'leads' && data.stage && !STAGES.includes(data.stage.toLowerCase() as Stage)) warnings.push(`Stage "${data.stage}" unknown; will use "new"`);
    if (entity === 'tickets' && data.priority && !PRIORITIES.includes(data.priority.toUpperCase() as Priority)) warnings.push(`Priority "${data.priority}" unknown; will use P3`);
    if (entity === 'work_orders' && data.stage && !['queued', 'in_production', 'packed'].includes(data.stage.toLowerCase().replace(/\s+/g, '_'))) warnings.push(`Stage "${data.stage}" unknown; will use queued`);
    const custKey = entity === 'customers' ? 'name' : 'customer';
    if (data[custKey] && !existingCustomers.has(data[custKey].toLowerCase())) warnings.push(entity === 'customers' ? 'New customer' : 'Customer will be created');
    return { n: i + 2, data, errors, warnings };
  });
  const id = Number(app.db.run('INSERT INTO imports (entity, filename, rows, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', [entity, filename, JSON.stringify(rows), 'preview', actor.id, new Date().toISOString()]).lastInsertRowid);
  return { id, entity, filename, matched, missing, rows, valid: rows.filter((r) => !r.errors.length).length, invalid: rows.filter((r) => r.errors.length).length };
}

export function getPreview(app: App, id: number): Preview | null {
  const row = app.db.get<{ id: number; entity: ImportEntity; filename: string; rows: string; status: string }>('SELECT * FROM imports WHERE id = ?', [id]);
  if (!row) return null;
  const rows = JSON.parse(row.rows) as PreviewRow[];
  return { id: row.id, entity: row.entity, filename: row.filename, matched: {}, missing: [], rows, valid: rows.filter((r) => !r.errors.length).length, invalid: rows.filter((r) => r.errors.length).length };
}

export function commit(app: App, actor: Employee, id: number): { created: number; updated: number; skipped: number } {
  const row = app.db.get<{ id: number; entity: ImportEntity; rows: string; status: string }>('SELECT * FROM imports WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Import not found');
  if (row.status !== 'preview') throw new HttpError(400, 'This import was already committed.');
  const rows = (JSON.parse(row.rows) as PreviewRow[]).filter((r) => !r.errors.length);
  const emp = (email: string) => (email ? getEmployeeByEmail(app.db, email) : undefined);
  let created = 0, updated = 0, skipped = 0;
  app.db.transaction(() => {
    for (const r of rows) {
      const d = r.data;
      try {
        if (row.entity === 'customers') {
          const existing = app.db.get<{ id: string }>('SELECT id FROM customers WHERE lower(name) = lower(?)', [d.name]);
          const owner = emp(d.owner_email)?.id || actor.id;
          if (existing) { app.db.run("UPDATE customers SET city = COALESCE(NULLIF(?, ''), city), segment = COALESCE(NULLIF(?, ''), segment), contact_name = COALESCE(NULLIF(?, ''), contact_name), phone = COALESCE(NULLIF(?, ''), phone), email = COALESCE(NULLIF(?, ''), email), source = COALESCE(NULLIF(?, ''), source) WHERE id = ?", [d.city, d.segment, d.contact_name, d.phone, d.email, d.source, existing.id]); updated++; }
          else { createCustomer(app, actor, { name: d.name, city: d.city, segment: d.segment, contact_name: d.contact_name, phone: d.phone, email: d.email, source: d.source, owner_id: owner }); created++; }
        } else if (row.entity === 'leads') {
          const cust = createCustomer(app, actor, { name: d.customer, city: d.city, contact_name: d.contact_name, phone: d.phone, email: d.email, source: d.source });
          const owner = emp(d.owner_email)?.id || actor.id;
          const deal = createDeal(app, actor, { customerId: cust.id, title: d.title, value: Number(d.value) || 0, source: d.source, nextStep: d.next_step, ownerId: owner, expectedClose: d.expected_close || null });
          const stage = STAGES.includes(d.stage?.toLowerCase() as Stage) ? d.stage.toLowerCase() : 'new';
          app.db.run('UPDATE deals SET stage = ?, next_step_due = ?, updated_at = ? WHERE id = ?', [stage, d.next_step_due || null, new Date().toISOString(), deal.id]);
          created++;
        } else if (row.entity === 'tickets') {
          const cust = createCustomer(app, actor, { name: d.customer });
          const p = (d.priority || 'P3').toUpperCase();
          createTicket(app, actor, { customerId: cust.id, subject: d.subject, description: d.details, priority: PRIORITIES.includes(p as Priority) ? (p as Priority) : 'P3', type: ['support', 'implementation', 'internal'].includes((d.type || '').toLowerCase()) ? d.type.toLowerCase() : 'support', channel: d.channel || 'import', assigneeId: emp(d.assignee_email)?.id || null });
          created++;
        } else if (row.entity === 'work_orders') {
          const cust = createCustomer(app, actor, { name: d.customer });
          const wo = createWorkOrder(app, actor, { customerId: cust.id, product: d.product, qty: Number(d.qty) || 1, promisedDate: d.promised_date || null, assigneeId: emp(d.assignee_email)?.id || null, notes: d.notes });
          const stage = (d.stage || '').toLowerCase().replace(/\s+/g, '_');
          if (['in_production', 'packed'].includes(stage)) app.db.run('UPDATE work_orders SET stage = ?, started_at = ?, updated_at = ? WHERE id = ?', [stage, new Date().toISOString(), new Date().toISOString(), wo.id]);
          created++;
        }
      } catch { skipped++; }
    }
    app.db.run('UPDATE imports SET status = ?, committed_at = ?, result = ? WHERE id = ?', ['committed', new Date().toISOString(), JSON.stringify({ created, updated, skipped }), id]);
  });
  audit(app.db, { entity: 'import', entityId: String(id), action: 'commit', actorId: actor.id, after: { entity: row.entity, created, updated, skipped } });
  return { created, updated, skipped };
}

export function history(app: App) {
  return app.db.all<{ id: number; entity: string; filename: string; status: string; created_at: string; committed_at: string | null; result: string | null; by: string | null; n: number }>(
    "SELECT i.id, i.entity, i.filename, i.status, i.created_at, i.committed_at, i.result, e.full_name AS by, json_array_length(i.rows) AS n FROM imports i LEFT JOIN employees e ON e.id = i.created_by ORDER BY i.id DESC LIMIT 30");
}
