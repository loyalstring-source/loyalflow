import { createRequire } from 'node:module';
import type { App } from '../app.ts';
import { Router, file } from '../lib/http.ts';
import { type Employee, listEmployees, listDepartments, getDepartment, getEmployee } from '../modules/people/model.ts';
import { buildXlsx, type Sheet } from '../lib/xlsx.ts';
import { companyPage, redStreak, tilesFor, series, formatValue, KPI_BY_KEY, weekLabel, type Tile } from '../modules/kpi/engine.ts';
import { deptKpis } from '../modules/kpi/views.ts';
import { listTickets, slaState, OPEN_STATUSES } from '../modules/desk/service.ts';
import { listDeals, STAGE_LABEL, WIN_CHANCE } from '../modules/sales/service.ts';
import { listWorkOrders } from '../modules/production/service.ts';
import { listTasks } from '../modules/tasks/service.ts';
import { requireCan, scopeFor } from '../lib/scope.ts';
import { fiscalYear, localDateString, addDays, toLocal, fmtDateFull } from '../lib/time.ts';
import { view } from './helpers.ts';

const require = createRequire(import.meta.url);

function stamp(): string { return new Date().toISOString().slice(0, 10); }
const ragWord = (r: Tile['rag']) => r === 'good' ? 'On target' : r === 'warn' ? 'Amber' : r === 'crit' ? 'Red' : '—';

export function companyWorkbook(app: App, now = new Date()): Buffer {
  const scope = { type: 'company' as const, id: 'company' };
  const bands = companyPage(app, scope, now);
  const summary: Sheet = { name: 'Company page', columns: [{ header: 'Band', width: 22 }, { header: 'KPI', width: 36 }, { header: 'Value', width: 14 }, { header: 'Target', width: 14 }, { header: 'Status', width: 12 }, { header: 'Change', width: 34 }, { header: 'Red weeks', width: 10, format: 'number' }, { header: 'Owner', width: 10 }, { header: 'Definition', width: 80 }], rows: [] };
  const history: Sheet = { name: '13-week history', columns: [{ header: 'KPI', width: 36 }, ...series(app, 'open_tickets', scope, 13, now).map((p) => ({ header: p.period, width: 11, format: 'number' as const }))], rows: [] };
  for (const b of bands) for (const t of b.tiles) {
    summary.rows.push([b.name, t.name, t.display, t.targetDisplay, ragWord(t.rag), t.delta, redStreak(app, t.key, scope, now), t.ownerDept, t.definition]);
    history.rows.push([t.name, ...t.series.map((p) => p.value === null ? null : Math.round(p.value * 100) / 100)]);
  }
  const approvals = listTasks(app, { kind: 'approval', status: ['open'], limit: 500 });
  const pending: Sheet = { name: 'Approvals waiting', columns: [{ header: 'Id', width: 10 }, { header: 'Request', width: 50 }, { header: 'Requested by', width: 22 }, { header: 'Waiting on', width: 22 }, { header: 'Amount', width: 14, format: 'number' }, { header: 'Since', width: 18, format: 'datetime' }], rows: approvals.map((t) => [t.id, t.title, t.requester_name || '', t.assignee_name || '', t.amount, new Date(t.created_at)]) };
  return buildXlsx([summary, history, pending], { title: `LoyalFlow company page ${weekLabel(now)}` });
}

export async function companyDeck(app: App, author: string, now = new Date()): Promise<Buffer> {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = author; pptx.company = 'Loyal String'; pptx.title = `Company page ${weekLabel(now)}`;
  const scope = { type: 'company' as const, id: 'company' };
  const bands = companyPage(app, scope, now);
  const NAVY = '0F1B2D', INK = '121826', MUTED = '5B6472', LINE = 'E3E7EC', GOOD = '1E8E5A', WARN = 'A45D00', CRIT = 'C8323B', ACCENT = '2F55D4';
  const ragColour = (r: Tile['rag']) => r === 'good' ? GOOD : r === 'warn' ? WARN : r === 'crit' ? CRIT : INK;

  const title = pptx.addSlide();
  title.background = { color: NAVY };
  title.addText('LoyalFlow · Company page', { x: 0.6, y: 0.6, w: 12, h: 0.5, fontFace: 'Calibri', fontSize: 16, color: '9DB4FF' });
  title.addText(`Week ${weekLabel(now).split('-W')[1]} · ${fiscalYear(now)}`, { x: 0.6, y: 1.3, w: 12, h: 1.2, fontFace: 'Calibri', fontSize: 40, bold: true, color: 'FFFFFF' });
  title.addText(`Weekly review, CEO and COO · generated ${fmtDateFull(now)} by ${author}`, { x: 0.6, y: 2.6, w: 12, h: 0.5, fontFace: 'Calibri', fontSize: 14, color: 'B9C6DA' });
  const reds = bands.flatMap((b) => b.tiles).filter((t) => t.rag === 'crit');
  const ambers = bands.flatMap((b) => b.tiles).filter((t) => t.rag === 'warn');
  title.addText(`${reds.length} red · ${ambers.length} amber · ${bands.flatMap((b) => b.tiles).filter((t) => t.rag === 'good').length} on target`, { x: 0.6, y: 3.4, w: 12, h: 0.5, fontFace: 'Calibri', fontSize: 18, color: 'FFFFFF' });

  if (reds.length) {
    const s = pptx.addSlide();
    s.addText('Start here: red this week', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontFace: 'Calibri', fontSize: 26, bold: true, color: INK });
    const rows = reds.map((t) => { const streak = redStreak(app, t.key, scope, now); return [{ text: t.name, options: { bold: true } }, { text: t.display, options: { color: CRIT, bold: true } }, { text: t.targetDisplay }, { text: streak >= 2 ? `${streak} weeks` : 'this week' }, { text: t.ownerDept }]; });
    s.addTable([[{ text: 'KPI', options: { bold: true, fill: { color: 'E8EDFB' } } }, { text: 'Value', options: { bold: true, fill: { color: 'E8EDFB' } } }, { text: 'Target', options: { bold: true, fill: { color: 'E8EDFB' } } }, { text: 'Red for', options: { bold: true, fill: { color: 'E8EDFB' } } }, { text: 'Owner', options: { bold: true, fill: { color: 'E8EDFB' } } }], ...rows],
      { x: 0.5, y: 1.1, w: 12.3, colW: [4.6, 2, 2, 2, 1.7], fontFace: 'Calibri', fontSize: 13, color: INK, border: { type: 'solid', pt: 0.5, color: LINE }, rowH: 0.42 });
  }

  for (const b of bands) {
    const s = pptx.addSlide();
    s.addText(b.name, { x: 0.5, y: 0.35, w: 9, h: 0.6, fontFace: 'Calibri', fontSize: 26, bold: true, color: INK });
    s.addText(`Owners: ${b.owners}`, { x: 0.5, y: 0.9, w: 9, h: 0.35, fontFace: 'Calibri', fontSize: 12, color: MUTED });
    b.tiles.forEach((t, i) => {
      const x = 0.5 + (i % 2) * 3.0, y = 1.45 + Math.floor(i / 2) * 2.5;
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: 2.8, h: 2.3, fill: { color: 'F9FAFB' }, line: { color: LINE, width: 0.75 }, rectRadius: 0.1 });
      s.addText(t.name, { x: x + 0.15, y: y + 0.12, w: 2.5, h: 0.4, fontFace: 'Calibri', fontSize: 11, color: MUTED });
      s.addText(t.display, { x: x + 0.15, y: y + 0.5, w: 2.5, h: 0.8, fontFace: 'Calibri', fontSize: 30, bold: true, color: ragColour(t.rag) });
      s.addShape(pptx.ShapeType.ellipse, { x: x + 0.17, y: y + 1.45, w: 0.14, h: 0.14, fill: { color: ragColour(t.rag) }, line: { color: ragColour(t.rag) } });
      s.addText(`${t.target === null ? 'No target' : 'Target ' + t.targetDisplay}${t.delta ? '\n' + t.delta : ''}`, { x: x + 0.36, y: y + 1.35, w: 2.4, h: 0.8, fontFace: 'Calibri', fontSize: 10, color: MUTED, valign: 'top' });
    });
    const labels = b.tiles[0].series.map((p) => 'W' + p.period.split('-W')[1]);
    const data = b.tiles.map((t) => ({ name: t.name, labels, values: t.series.map((p) => p.value === null ? 0 : (t.unit === 'inr' ? Math.round(p.value / 100000) / 10 : Math.round(p.value * 100) / 100)) }));
    s.addChart(pptx.ChartType.line, data, { x: 6.7, y: 1.4, w: 6.3, h: 5.0, chartColors: [ACCENT, GOOD, WARN, '6B4EE6'], lineSize: 2, lineDataSymbol: 'none', showLegend: true, legendPos: 'b', legendFontSize: 9, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, title: '13-week trend (₹ in lakh for money KPIs)', showTitle: true, titleFontSize: 11, titleColor: MUTED });
  }

  const approvals = listTasks(app, { kind: 'approval', status: ['open'], limit: 200 }).filter((t) => t.created_at < addDays(now, -2).toISOString());
  const last = pptx.addSlide();
  last.addText('Decisions and follow-ups', { x: 0.5, y: 0.35, w: 12, h: 0.6, fontFace: 'Calibri', fontSize: 26, bold: true, color: INK });
  const bullets = [
    `${approvals.length} approval${approvals.length === 1 ? '' : 's'} waiting more than 2 days${approvals.length ? ': ' + approvals.slice(0, 5).map((t) => `${t.title} (${t.assignee_name})`).join('; ') : ''}`,
    ...reds.map((t) => `${t.name}: owner ${t.ownerDept} to bring an action plan`),
    'Targets to confirm for next week (HOD proposes, COO approves)'
  ];
  last.addText(bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.2, w: 12, h: 4.5, fontFace: 'Calibri', fontSize: 15, color: INK, valign: 'top', paraSpaceAfter: 8 });
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return out as Buffer;
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/exports/company.xlsx', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'reports.export'); return file(companyWorkbook(app), `loyalflow-company-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
  r.get('/exports/company.pptx', async (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'reports.export'); return file(await companyDeck(app, v.user.full_name), `loyalflow-company-${stamp()}.pptx`, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'); });

  r.get('/exports/tickets.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const now = new Date();
    const rows = listTickets(app, { limit: 5000 });
    const sheet: Sheet = { name: 'Tickets', columns: [{ header: 'Id', width: 10 }, { header: 'Subject', width: 48 }, { header: 'Customer', width: 26 }, { header: 'Type', width: 14 }, { header: 'Priority', width: 9 }, { header: 'Status', width: 16 }, { header: 'Assignee', width: 22 }, { header: 'Raised', width: 18, format: 'datetime' }, { header: 'First response', width: 18, format: 'datetime' }, { header: 'Resolve due', width: 18, format: 'datetime' }, { header: 'Resolved', width: 18, format: 'datetime' }, { header: 'Within SLA', width: 10 }, { header: 'SLA state', width: 14 }, { header: 'Rating', width: 8, format: 'number' }, { header: 'Reopened', width: 9, format: 'number' }, { header: 'Dev issue', width: 10 }],
      rows: rows.map((t) => [t.id, t.subject, t.customer_name, t.type, t.priority, t.status, t.assignee_name || '', new Date(t.created_at), t.first_response_at ? new Date(t.first_response_at) : null, t.resolve_due_at ? new Date(t.resolve_due_at) : null, t.resolved_at ? new Date(t.resolved_at) : null, t.within_sla === null ? '' : t.within_sla ? 'Yes' : 'No', slaState(t, now).state, t.rating, t.reopen_count, t.dev_issue_id || '']) };
    const open = rows.filter((t) => OPEN_STATUSES.includes(t.status));
    const byAgent = new Map<string, { open: number; breached: number }>();
    for (const t of open) { const k = t.assignee_name || 'Unassigned'; const e = byAgent.get(k) || { open: 0, breached: 0 }; e.open++; if (slaState(t, now).state === 'breach') e.breached++; byAgent.set(k, e); }
    const summary: Sheet = { name: 'By agent', columns: [{ header: 'Agent', width: 26 }, { header: 'Open', width: 10, format: 'number' }, { header: 'Past SLA', width: 10, format: 'number' }], rows: [...byAgent.entries()].map(([k, e]) => [k, e.open, e.breached]) };
    return file(buildXlsx([sheet, summary], { title: 'Tickets' }), `loyalflow-tickets-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  r.get('/exports/pipeline.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const rows = listDeals(app, { limit: 5000 });
    const sheet: Sheet = { name: 'Pipeline', columns: [{ header: 'Id', width: 10 }, { header: 'Customer', width: 28 }, { header: 'Deal', width: 30 }, { header: 'Stage', width: 14 }, { header: 'Win %', width: 8, format: 'number' }, { header: 'Value', width: 14, format: 'inr' }, { header: 'Discount %', width: 10, format: 'number' }, { header: 'Net', width: 14, format: 'inr' }, { header: 'Weighted', width: 14, format: 'inr' }, { header: 'Currency', width: 9 }, { header: 'Owner', width: 22 }, { header: 'Source', width: 14 }, { header: 'Next step', width: 30 }, { header: 'Next step due', width: 14, format: 'date' }, { header: 'Days in stage', width: 10, format: 'number' }, { header: 'Expected close', width: 14, format: 'date' }, { header: 'Created', width: 14, format: 'date' }, { header: 'Won', width: 14, format: 'date' }, { header: 'Lost reason', width: 16 }],
      rows: rows.map((d) => { const net = d.value * (1 - d.discount_pct / 100); return [d.id, d.customer_name || '', d.title, STAGE_LABEL[d.stage], WIN_CHANCE[d.stage], d.value, d.discount_pct, net, net * WIN_CHANCE[d.stage] / 100, d.currency, d.owner_name || '', d.source, d.next_step, d.next_step_due ? new Date(d.next_step_due) : null, d.days_in_stage || 0, d.expected_close ? new Date(d.expected_close) : null, new Date(d.created_at), d.won_at ? new Date(d.won_at) : null, d.lost_reason]; }) };
    return file(buildXlsx([sheet], { title: 'Pipeline' }), `loyalflow-pipeline-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  r.get('/exports/production.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const rows = listWorkOrders(app, { limit: 5000 });
    const sheet: Sheet = { name: 'Work orders', columns: [{ header: 'Id', width: 10 }, { header: 'Kind', width: 14 }, { header: 'Customer', width: 28 }, { header: 'Product', width: 30 }, { header: 'Qty', width: 7, format: 'number' }, { header: 'Stage', width: 14 }, { header: 'Assignee', width: 22 }, { header: 'Promised', width: 12, format: 'date' }, { header: 'Started', width: 16, format: 'datetime' }, { header: 'Packed', width: 16, format: 'datetime' }, { header: 'Dispatched', width: 16, format: 'datetime' }, { header: 'On time', width: 8 }, { header: 'Courier', width: 14 }, { header: 'Consignment', width: 16 }, { header: 'Invoice', width: 14 }, { header: 'QC', width: 8 }],
      rows: rows.map((w) => [w.id, w.kind, w.customer_name || '', w.product, w.qty, w.stage, w.assignee_name || '', w.promised_date ? new Date(w.promised_date) : null, w.started_at ? new Date(w.started_at) : null, w.packed_at ? new Date(w.packed_at) : null, w.dispatched_at ? new Date(w.dispatched_at) : null, w.dispatched_at ? (!w.promised_date || localDateString(new Date(w.dispatched_at)) <= w.promised_date ? 'Yes' : 'No') : '', w.courier, w.consignment, w.invoice_ref, w.qc_result || '']) };
    return file(buildXlsx([sheet], { title: 'Production' }), `loyalflow-production-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  r.get('/exports/analytics.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const now = new Date();
    const scope = scopeFor(app.db, v.user);
    const deptId = ctx.query.get('dept') || v.user.department_id;
    const dept = getDepartment(app.db, deptId);
    const keys = deptKpis(dept?.code || '');
    const tiles = tilesFor(app, keys, { type: 'department', id: deptId }, now);
    const summary: Sheet = { name: `${dept?.name || 'Department'} KPIs`.slice(0, 31), columns: [{ header: 'KPI', width: 36 }, { header: 'Value', width: 14 }, { header: 'Target', width: 14 }, { header: 'Status', width: 12 }, { header: 'Change', width: 34 }], rows: tiles.map((t) => [t.name, t.display, t.targetDisplay, ragWord(t.rag), t.delta]) };
    const perPerson = keys.filter((k) => KPI_BY_KEY[k].perPerson);
    const people = listEmployees(app.db, { status: 'active', departmentId: deptId }).filter((e) => scope.people.has(e.id));
    const byPerson: Sheet = { name: 'By person', columns: [{ header: 'Person', width: 26 }, ...perPerson.map((k) => ({ header: KPI_BY_KEY[k].name, width: 18 }))], rows: people.map((e) => [e.full_name, ...tilesFor(app, perPerson, { type: 'employee', id: e.id }, now).map((t) => t.display)]) };
    const history: Sheet = { name: 'History', columns: [{ header: 'KPI', width: 36 }, ...(tiles[0]?.series || []).map((p) => ({ header: p.period, width: 11 }))], rows: tiles.map((t) => [t.name, ...t.series.map((p) => formatValue(t.unit, p.value))]) };
    return file(buildXlsx([summary, byPerson, history], { title: 'Analytics' }), `loyalflow-analytics-${(dept?.code || 'dept').toLowerCase()}-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  // Attendance and leave for payroll (replaces the PagarGuru import, phase 1).
  r.get('/exports/attendance.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'people.admin');
    const month = /^\d{4}-\d{2}$/.test(ctx.query.get('month') || '') ? ctx.query.get('month')! : localDateString(new Date()).slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const people = listEmployees(app.db, { status: 'active' });
    const att = app.db.all<{ employee_id: string; date: string; check_in: string | null; check_out: string | null }>('SELECT employee_id, date, check_in, check_out FROM attendance WHERE date LIKE ?', [`${month}-%`]);
    const leave = app.db.all<{ employee_id: string; from_date: string; to_date: string; type: string }>("SELECT employee_id, from_date, to_date, type FROM leave_requests WHERE status = 'approved' AND from_date <= ? AND to_date >= ?", [`${month}-${String(days).padStart(2, '0')}`, `${month}-01`]);
    const holidays = new Set(app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'holidays'") ? JSON.parse(app.db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'holidays'")!.value) as string[] : []);
    const sheet: Sheet = { name: `Attendance ${month}`, columns: [{ header: 'Id', width: 8 }, { header: 'Name', width: 26 }, { header: 'Department', width: 10 }, { header: 'PagarGuru code', width: 12 }, ...Array.from({ length: days }, (_, i) => ({ header: String(i + 1), width: 5 })), { header: 'Present', width: 8, format: 'number' }, { header: 'Leave', width: 8, format: 'number' }, { header: 'Absent (working days)', width: 10, format: 'number' }], rows: [] };
    for (const e of people) {
      const row: (string | number)[] = [e.id, e.full_name, e.department_id, e.pagarguru_code];
      let present = 0, onLeave = 0, absent = 0;
      for (let d = 1; d <= days; d++) {
        const date = `${month}-${String(d).padStart(2, '0')}`;
        const dow = toLocal(new Date(`${date}T06:00:00Z`)).dow;
        const a = att.find((x) => x.employee_id === e.id && x.date === date);
        const l = leave.find((x) => x.employee_id === e.id && x.from_date <= date && x.to_date >= date);
        let mark = '';
        if (a?.check_in) { mark = 'P'; present++; } else if (l) { mark = l.type; onLeave++; } else if (dow === 7 || holidays.has(date)) mark = 'H'; else if (date <= localDateString(new Date())) { mark = 'A'; absent++; }
        row.push(mark);
      }
      row.push(present, onLeave, absent);
      sheet.rows.push(row);
    }
    const leaveSheet: Sheet = { name: 'Approved leave', columns: [{ header: 'Id', width: 8 }, { header: 'Name', width: 26 }, { header: 'Type', width: 6 }, { header: 'From', width: 12, format: 'date' }, { header: 'To', width: 12, format: 'date' }], rows: leave.map((l) => [l.employee_id, getEmployee(app.db, l.employee_id)?.full_name || '', l.type, new Date(l.from_date), new Date(l.to_date)]) };
    return file(buildXlsx([sheet, leaveSheet], { title: `Attendance ${month}` }), `loyalflow-attendance-${month}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  r.get('/exports/people.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'people.admin');
    const depts = listDepartments(app.db);
    const rows = listEmployees(app.db);
    const sheet: Sheet = { name: 'Employees', columns: [{ header: 'Id', width: 8 }, { header: 'Name', width: 26 }, { header: 'Email', width: 32 }, { header: 'Designation', width: 30 }, { header: 'Department', width: 20 }, { header: 'Sub-team', width: 18 }, { header: 'Role', width: 12 }, { header: 'Reports to', width: 26 }, { header: 'Shift', width: 7 }, { header: 'Site', width: 8 }, { header: 'Status', width: 9 }, { header: 'Joined', width: 12, format: 'date' }],
      rows: rows.map((e) => [e.id, e.full_name, e.email, e.designation, depts.find((d) => d.id === e.department_id)?.name || e.department_id, e.sub_team, e.functional_role, rows.find((m) => m.id === e.reporting_manager_id)?.full_name || '', e.shift_code, e.site_id, e.status, e.join_date ? new Date(e.join_date) : null]) };
    return file(buildXlsx([sheet], { title: 'Employees' }), `loyalflow-people-${stamp()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
}
