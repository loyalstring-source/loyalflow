import type { App } from '../app.ts';
import { Router, htmlResponse, file, HttpError } from '../lib/http.ts';
import { type Employee, listDepartments, getDepartment, listEmployees } from '../modules/people/model.ts';
import { ENTITIES, template, preview, getPreview, commit, history, type ImportEntity } from '../modules/imports/service.ts';
import { listProcurement, saveProcurement, setProcurementStatus, setMaterials, forecast, budgets, setBudget, travelReport, startTimer, stopTimer, logTime, runningTimer, hoursByPerson, type ProcStatus } from '../modules/ops/service.ts';
import { listWorkOrders, getWorkOrder } from '../modules/production/service.ts';
import { listDeals, listActivities } from '../modules/sales/service.ts';
import { getTask } from '../modules/tasks/service.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { fiscalYear, localDateString, addDays, weekStart } from '../lib/time.ts';
import { buildXlsx } from '../lib/xlsx.ts';
import { importsPage, importPreviewPage, procurementPage, procurementModal, budgetsPage, budgetModal, travelPage, timeLogModal, hoursPage } from '../ui/pages/ops.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  // ----- Imports -----
  r.get('/imports', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'reports.company'); return htmlResponse(importsPage(v, { history: history(app) })); });
  r.get('/imports/:entity/template.xlsx', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'reports.company'); const e = ctx.params.entity as ImportEntity; if (!ENTITIES[e]) throw new HttpError(404, 'Unknown template'); return file(template(e), `loyalflow-import-${e}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
  r.post('/imports/:entity', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'reports.company');
    const e = ctx.params.entity as ImportEntity; if (!ENTITIES[e]) return fail(ctx, 404, 'Unknown import type');
    const b = await ctx.body();
    const b64 = str(b, 'file'); if (!b64) return fail(ctx, 400, 'Choose a file first.');
    try {
      const p = preview(app, me, e, str(b, 'fileName') || 'upload', Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64'));
      return done(ctx, { redirect: `/imports/preview/${p.id}`, toast: { title: `${p.valid} rows ready`, body: p.invalid ? `${p.invalid} rows have errors and will be skipped.` : undefined, kind: p.invalid ? 'warn' : 'success' } });
    } catch (err) { if (err instanceof HttpError) return fail(ctx, err.status, err.message); return fail(ctx, 400, `Could not read the file: ${(err as Error).message}`); }
  });
  r.get('/imports/preview/:id', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'reports.company'); const p = getPreview(app, Number(ctx.params.id)); if (!p) throw new HttpError(404, 'Import not found'); const row = app.db.get<{ status: string; result: string | null }>('SELECT status, result FROM imports WHERE id = ?', [p.id]); return htmlResponse(importPreviewPage(v, { ...p, committed: row?.status === 'committed' && row.result ? JSON.parse(row.result) : null })); });
  r.post('/imports/preview/:id/commit', (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'reports.company');
    try { const r2 = commit(app, me, Number(ctx.params.id)); return done(ctx, { reload: true, confetti: r2.created > 0, toast: { title: 'Import complete', body: `${r2.created} created, ${r2.updated} updated, ${r2.skipped} skipped.`, kind: 'success' } }); }
    catch (err) { if (err instanceof HttpError) return fail(ctx, err.status, err.message); throw err; }
  });

  // ----- Procurement -----
  r.get('/procurement', (ctx) => {
    const v = view(ctx);
    const canWrite = can(app.db, v.user, 'production.write');
    const tab = ['items', 'forecast', 'materials'].includes(ctx.query.get('tab') || '') ? ctx.query.get('tab')! : 'items';
    const shortOrders = listWorkOrders(app, { open: true, limit: 500 }).filter((w) => w.stage === 'queued' && (w as unknown as { materials_status: string }).materials_status !== 'ready');
    return htmlResponse(procurementPage(v, { items: listProcurement(app), forecast: forecast(app), shortOrders, canWrite, tab }));
  });
  const procModal = (ctx: Parameters<typeof view>[0], id?: string) => {
    const v = view(ctx); requireCan(app.db, v.user, 'production.write');
    const item = id ? listProcurement(app).find((i) => i.id === id) || null : null;
    if (id && !item) throw new HttpError(404, 'Item not found');
    return htmlResponse(procurementModal(v, { item, orders: listWorkOrders(app, { open: true, limit: 300 }), deals: listDeals(app, { open: true, limit: 300 }), prefill: { item: ctx.query.get('item') || undefined, qty: ctx.query.get('qty') || undefined, wo: ctx.query.get('wo') || undefined, deal: ctx.query.get('deal') || undefined } }));
  };
  r.get('/procurement/new', (ctx) => procModal(ctx));
  r.get('/procurement/:id/edit', (ctx) => procModal(ctx, ctx.params.id));
  const saveProc = async (ctx: Parameters<typeof user>[0], id?: string) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    try {
      const i = saveProcurement(app, me, { id, item: str(b, 'item'), qty: num(b, 'qty') ?? 1, unit: str(b, 'unit'), neededBy: str(b, 'neededBy') || null, supplier: str(b, 'supplier'), estCost: num(b, 'estCost') ?? 0, workOrderId: str(b, 'workOrderId') || null, dealId: str(b, 'dealId') || null, notes: str(b, 'notes') });
      return done(ctx, { reload: true, toast: { title: `${i.id} saved`, body: i.item, kind: 'success' } });
    } catch (err) { if (err instanceof HttpError) return fail(ctx, err.status, err.message); throw err; }
  };
  r.post('/procurement', (ctx) => saveProc(ctx));
  r.post('/procurement/:id', (ctx) => saveProc(ctx, ctx.params.id));
  r.post('/procurement/:id/status', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    const s = str(b, 'status') as ProcStatus;
    if (!['planned', 'ordered', 'received', 'cancelled'].includes(s)) return fail(ctx, 400, 'Unknown status');
    const i = setProcurementStatus(app, me, ctx.params.id, s, { expectedAt: str(b, 'expectedAt') || null });
    return done(ctx, { reload: true, toast: { title: `${i.item}: ${s}`, kind: 'success' } });
  });
  r.post('/work-orders/:id/materials', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'production.write');
    const b = await ctx.body();
    const w = getWorkOrder(app, ctx.params.id); if (!w) return fail(ctx, 404, 'Work order not found');
    const s = ['unchecked', 'short', 'ready'].includes(str(b, 'status')) ? str(b, 'status') as 'unchecked' | 'short' | 'ready' : 'ready';
    setMaterials(app, me, w.id, s, str(b, 'note'));
    return done(ctx, { reload: true, toast: { title: `Materials ${s}`, body: w.product, kind: s === 'short' ? 'warn' : 'success' } });
  });

  // ----- Budgets -----
  r.get('/budgets', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.company');
    const cur = fiscalYear(new Date());
    const y = 2000 + Number(cur.slice(2, 4));
    const fys = [y - 1, y, y + 1].map((yy) => `FY${String(yy).slice(2)}-${String(yy + 1).slice(2)}`);
    const fy = fys.includes(ctx.query.get('fy') || '') ? ctx.query.get('fy')! : cur;
    return htmlResponse(budgetsPage(v, { lines: budgets(app, fy), fy, fys, canSet: can(app.db, v.user, 'settings.admin'), departments: listDepartments(app.db) }));
  });
  r.get('/budgets/:dept/edit', (ctx) => { const v = view(ctx); requireCan(app.db, v.user, 'settings.admin'); const dept = getDepartment(app.db, ctx.params.dept); if (!dept) throw new HttpError(404, 'Department not found'); const fy = ctx.query.get('fy') || fiscalYear(new Date()); return htmlResponse(budgetModal(v, { dept, fy, line: budgets(app, fy).find((l) => l.department_id === dept.id) })); });
  r.post('/budgets/:dept', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const dept = getDepartment(app.db, ctx.params.dept); if (!dept) return fail(ctx, 404, 'Department not found');
    const amount = num(b, 'amount'); if (amount === null) return fail(ctx, 400, 'Enter the budget amount.');
    setBudget(app, me, dept.id, str(b, 'fy') || fiscalYear(new Date()), amount, str(b, 'notes'));
    return done(ctx, { reload: true, toast: { title: `${dept.name} budget saved`, kind: 'success' } });
  });

  // ----- Travel -----
  r.get('/travel', (ctx) => {
    const v = view(ctx);
    const scope = scopeFor(app.db, v.user);
    const now = new Date();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('from') || '') ? ctx.query.get('from')! : localDateString(addDays(weekStart(now), -28));
    const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('to') || '') ? ctx.query.get('to')! : localDateString(now);
    const until = addDays(new Date(`${to}T00:00:00Z`), 1).toISOString();
    const ids = scope.level === 'company' ? undefined : [...scope.people];
    const rep = travelReport(app, `${from}T00:00:00Z`, until, ids);
    const visits = listActivities(app, { kind: 'visit', since: `${from}T00:00:00Z`, actorIds: ids, limit: 500 }).filter((a) => a.at < until);
    return htmlResponse(travelPage(v, { rows: rep.rows, ratePerKm: rep.ratePerKm, from, to, visits }));
  });
  r.get('/exports/travel.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const from = ctx.query.get('from') || localDateString(addDays(new Date(), -28)), to = ctx.query.get('to') || localDateString(new Date());
    const rep = travelReport(app, `${from}T00:00:00Z`, addDays(new Date(`${to}T00:00:00Z`), 1).toISOString());
    return file(buildXlsx([{ name: 'Travel', columns: [{ header: 'Person', width: 26 }, { header: 'Visits', width: 8, format: 'number' }, { header: 'Km', width: 8, format: 'number' }, { header: 'Est. cost', width: 12, format: 'inr' }, { header: 'Claimed', width: 12, format: 'inr' }, { header: 'Won deals', width: 10, format: 'number' }, { header: 'Won value', width: 14, format: 'inr' }, { header: 'Open pipeline', width: 14, format: 'inr' }], rows: rep.rows.map((r) => [r.name, r.visits, r.km, r.estCost, r.claimed, r.wonDeals, r.wonValue, r.openValue]) }], { title: 'Sales travel' }), `loyalflow-travel-${from}-${to}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  // ----- Time -----
  r.post('/time/start', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const type = str(b, 'entityType'); const id = str(b, 'entityId');
    if (!['work_order', 'task', 'creative', 'issue'].includes(type) || !id) return fail(ctx, 400, 'Nothing to time.');
    startTimer(app, me, type as 'work_order' | 'task' | 'creative' | 'issue', id);
    return done(ctx, { reload: true, toast: { title: 'Timer running', body: `on ${id}`, kind: 'info' } });
  });
  r.post('/time/stop', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const l = stopTimer(app, me, str(b, 'note'));
    return done(ctx, { reload: true, toast: l ? { title: `Logged ${Math.round(l.minutes / 6) / 10} h`, body: `on ${l.entity_id}`, kind: 'success' } : { title: 'No timer was running', kind: 'warn' } });
  });
  r.get('/time/log', (ctx) => {
    const v = view(ctx);
    const type = ctx.query.get('entityType') || 'work_order', id = ctx.query.get('entityId') || '';
    const label = type === 'work_order' ? (getWorkOrder(app, id)?.product || id) : type === 'issue' ? id : (getTask(app, id)?.title || id);
    const people = v.isManager ? listEmployees(app.db, { status: 'active' }).filter((e) => scopeFor(app.db, v.user).people.has(e.id)).map((e) => ({ id: e.id, name: e.full_name })) : [{ id: v.user.id, name: v.user.full_name }];
    return htmlResponse(timeLogModal(v, { entityType: type, entityId: id, label, people }));
  });
  r.post('/time/log', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const hours = num(b, 'hours'); if (!hours || hours <= 0) return fail(ctx, 400, 'Enter the hours.');
    const forId = str(b, 'employeeId') || me.id;
    if (forId !== me.id && !scopeFor(app.db, me).people.has(forId)) return fail(ctx, 403, 'You can only log time for your own team.');
    try { logTime(app, me, str(b, 'entityType') || 'work_order', str(b, 'entityId'), Math.round(hours * 60), str(b, 'note'), forId); } catch (err) { if (err instanceof HttpError) return fail(ctx, err.status, err.message); throw err; }
    return done(ctx, { reload: true, toast: { title: `${hours} h logged`, kind: 'success' } });
  });
  r.get('/hours', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.company');
    const scope = scopeFor(app.db, v.user);
    const now = new Date();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('from') || '') ? ctx.query.get('from')! : localDateString(weekStart(now));
    const to = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.get('to') || '') ? ctx.query.get('to')! : localDateString(now);
    const until = addDays(new Date(`${to}T00:00:00Z`), 1).toISOString();
    const ids = scope.level === 'company' ? undefined : [...scope.people];
    const rows = hoursByPerson(app, `${from}T00:00:00Z`, until, ids);
    const byEntity = app.db.all<{ entity_type: string; entity_id: string; minutes: number }>(`SELECT entity_type, entity_id, SUM(minutes) AS minutes FROM time_logs WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL ${ids ? `AND employee_id IN (${ids.map(() => '?').join(',')})` : ''} GROUP BY entity_type, entity_id ORDER BY minutes DESC`, [`${from}T00:00:00Z`, until, ...(ids || [])])
      .map((e) => ({ ...e, label: e.entity_type === 'work_order' ? `${e.entity_id} · ${getWorkOrder(app, e.entity_id)?.product || ''}` : e.entity_type === 'issue' ? `${e.entity_id} · ${app.db.get<{ title: string }>('SELECT title FROM dev_issues WHERE id = ?', [e.entity_id])?.title || ''}` : `${e.entity_id} · ${getTask(app, e.entity_id)?.title || ''}` }));
    return htmlResponse(hoursPage(v, { rows, from, to, byEntity }));
  });
  r.get('/exports/hours.xlsx', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'reports.export');
    const from = ctx.query.get('from') || localDateString(weekStart(new Date())), to = ctx.query.get('to') || localDateString(new Date());
    const until = addDays(new Date(`${to}T00:00:00Z`), 1).toISOString();
    const logs = app.db.all<{ at: string; name: string; entity_type: string; entity_id: string; minutes: number; note: string }>('SELECT t.started_at AS at, e.full_name AS name, t.entity_type, t.entity_id, t.minutes, t.note FROM time_logs t JOIN employees e ON e.id = t.employee_id WHERE t.started_at >= ? AND t.started_at < ? AND t.ended_at IS NOT NULL ORDER BY t.started_at', [`${from}T00:00:00Z`, until]);
    return file(buildXlsx([{ name: 'Time logs', columns: [{ header: 'When', width: 18, format: 'datetime' }, { header: 'Person', width: 26 }, { header: 'Type', width: 12 }, { header: 'Item', width: 14 }, { header: 'Minutes', width: 10, format: 'number' }, { header: 'Hours', width: 8, format: 'number' }, { header: 'Note', width: 40 }], rows: logs.map((l) => [new Date(l.at), l.name, l.entity_type, l.entity_id, l.minutes, Math.round(l.minutes / 6) / 10, l.note]) }], { title: 'Man-hours' }), `loyalflow-hours-${from}-${to}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
  void runningTimer;
}
