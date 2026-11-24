import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { getDepartment, getEmployee, listDepartments, listEmployees } from '../modules/people/model.ts';
import { companyPage, tile, tilesFor, redStreak, series, compute, livePeriod, rag, targetFor, setTarget, recordManual, KPI_BY_KEY, KPI_DEFS, formatValue, weekLabel, proratedTarget, type KpiScope, type Tile } from '../modules/kpi/engine.ts';
import { deptKpis, personKpis } from '../modules/kpi/views.ts';
import { can, requireCan, scopeFor, isExecutive } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { monthStart, isoWeek } from '../lib/time.ts';
import { createTask } from '../modules/tasks/service.ts';
import { companyPageView, kpiDetailPage, analyticsPage, type CompanyData, type KpiDetailData, type AnalyticsData } from '../ui/pages/company.ts';
import { done, fail, view, user, str, num } from './helpers.ts';
import { page } from '../ui/layout.ts';
import { html } from '../lib/html.ts';
import { table } from '../ui/components.ts';

function scopeFromQuery(ctx: { query: URLSearchParams }, me: Employee, app: App): KpiScope {
  const type = ctx.query.get('scope');
  const id = ctx.query.get('id') || '';
  if (type === 'department' && id && getDepartment(app.db, id)) return { type: 'department', id };
  if (type === 'employee' && id && getEmployee(app.db, id)) return { type: 'employee', id };
  if (type === 'company' || !type) {
    if (scopeFor(app.db, me).level === 'company' || can(app.db, me, 'reports.company')) return { type: 'company', id: 'company' };
    return me.functional_role === 'team_lead' ? { type: 'department', id: me.department_id } : { type: 'employee', id: me.id };
  }
  return { type: 'employee', id: me.id };
}

function allowedScope(app: App, me: Employee, scope: KpiScope): boolean {
  const s = scopeFor(app.db, me);
  if (scope.type === 'company') return s.level === 'company' || can(app.db, me, 'reports.company');
  if (scope.type === 'department') return s.level === 'company' || (s.level === 'team' && scope.id === me.department_id);
  // HR already sees a person's KPI tiles on their profile, so the detail behind a tile opens for them too.
  return s.people.has(scope.id) || can(app.db, me, 'people.admin');
}

export function buildCompany(app: App, me: Employee, now = new Date()): CompanyData {
  const scope: KpiScope = { type: 'company', id: 'company' };
  const bands = companyPage(app, scope, now);
  const streaks: CompanyData['streaks'] = [];
  for (const b of bands) for (const t of b.tiles) { const weeks = redStreak(app, t.key, scope, now); if (weeks >= 2) streaks.push({ tile: t, weeks }); }
  streaks.sort((a, b) => b.weeks - a.weeks);
  const approvalsOld = app.db.get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE kind = 'approval' AND status = 'open' AND created_at < ?", [new Date(now.getTime() - 2 * 86_400_000).toISOString()])?.n || 0;
  const last = app.db.get<{ at: string }>('SELECT max(computed_at) AS at FROM kpi_snapshots')?.at || null;
  return { now, week: weekLabel(now), bands, streaks, approvalsOld, canExport: can(app.db, me, 'reports.export'), isExec: isExecutive(me), lastSnapshot: last ? last.slice(11, 16) + ' UTC' : null };
}

export function register(r: Router<Employee>, app: App): void {
  r.get('/company', (ctx) => {
    const v = view(ctx);
    requireCan(app.db, v.user, 'reports.company');
    return htmlResponse(companyPageView(v, buildCompany(app, v.user)));
  });

  r.get('/kpi/:key', (ctx) => {
    const v = view(ctx);
    const def = KPI_BY_KEY[ctx.params.key];
    if (!def) throw new HttpError(404, 'Unknown KPI');
    const scope = scopeFromQuery(ctx, v.user, app);
    if (!allowedScope(app, v.user, scope)) throw new HttpError(403, 'You can only see your own numbers and those of people who report to you.');
    const now = new Date();
    const t = tile(app, def.key, scope, now);
    const scopeName = scope.type === 'company' ? 'Whole company' : scope.type === 'department' ? getDepartment(app.db, scope.id)?.name || scope.id : getEmployee(app.db, scope.id)?.full_name || scope.id;
    const people: KpiDetailData['people'] = [];
    if (def.perPerson && scope.type !== 'employee') {
      const emps = listEmployees(app.db, { status: 'active', departmentId: scope.type === 'department' ? scope.id : undefined });
      const visible = scopeFor(app.db, v.user).people;
      const period = def.periodKind === 'month' ? { start: monthStart(now), end: now, label: isoWeek(now) } : livePeriod(now);
      for (const e of emps) {
        if (!visible.has(e.id)) continue;
        if (scope.type === 'company' && def.ownerDept !== 'LEAD' && getDepartment(app.db, e.department_id)?.code !== def.ownerDept && !(def.ownerDept === 'SAL' && getDepartment(app.db, e.department_id)?.code === 'PRE')) continue;
        const value = compute(app, def.key, { type: 'employee', id: e.id }, period, now);
        if (value === null || (value === 0 && def.direction === 'up' && def.periodKind !== 'now')) { if (def.ownerDept !== getDepartment(app.db, e.department_id)?.code) continue; }
        const tgt = proratedTarget(def, targetFor(app, def.key, { type: 'employee', id: e.id }), now);
        people.push({ id: e.id, name: e.full_name, dept: getDepartment(app.db, e.department_id)?.name || '', value, display: formatValue(def.unit, value), rag: rag(def, value, tgt) });
      }
      people.sort((a, b) => (def.direction === 'down' ? (b.value ?? -1) - (a.value ?? -1) : (b.value ?? -1) - (a.value ?? -1)));
    }
    const exec = isExecutive(v.user);
    const ownerDeptMatch = v.deptCode === def.ownerDept || (def.ownerDept === 'LEAD' && v.isManager);
    const history = app.db.all<{ set_at: string; set_by_name: string; target: number; reason: string }>(`SELECT a.at AS set_at, COALESCE(e.full_name, 'system') AS set_by_name, json_extract(a.after, '$.target') AS target, json_extract(a.after, '$.reason') AS reason FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id WHERE a.entity = 'kpi_target' AND a.entity_id = ? ORDER BY a.id DESC LIMIT 8`, [`${def.key}:${scope.type}:${scope.id}`]);
    const data: KpiDetailData = {
      def, tile: t, scope, scopeName, series: series(app, def.key, scope, 13, now), fullTarget: targetFor(app, def.key, scope), people,
      canSetTarget: exec, canPropose: !exec && v.user.functional_role === 'hod', canEnter: def.source === 'manual' && (exec || ownerDeptMatch),
      targetHistory: history, departments: listDepartments(app.db).filter((d) => allowedScope(app, v.user, { type: 'department', id: d.id })).map((d) => ({ id: d.id, name: d.name, code: d.code })), streak: redStreak(app, def.key, scope, now)
    };
    return htmlResponse(kpiDetailPage(v, data));
  });

  r.post('/kpi/:key/target', async (ctx) => {
    const me = user(ctx);
    const body = await ctx.body();
    const def = KPI_BY_KEY[ctx.params.key];
    if (!def) return fail(ctx, 404, 'Unknown KPI');
    const scope: KpiScope = { type: (str(body, 'scopeType') as KpiScope['type']) || 'company', id: str(body, 'scopeId') || 'company' };
    const target = num(body, 'target');
    const reason = str(body, 'reason');
    if (target === null) return fail(ctx, 400, 'Enter a number for the target.');
    if (!reason) return fail(ctx, 400, 'A target change needs a reason.');
    if (isExecutive(me)) {
      setTarget(app, me, def.key, scope, target, reason);
      return done(ctx, { reload: true, toast: { title: 'Target saved', body: `${def.name}: ${formatValue(def.unit, target)}`, kind: 'success' } });
    }
    if (me.functional_role !== 'hod') return fail(ctx, 403, 'Only HODs can propose targets and only the COO can set them.');
    const coo = getSetting(app.db, 'company').cooId;
    createTask(app, me, { kind: 'approval', type: 'general', title: `Target proposal: ${def.name} → ${formatValue(def.unit, target)}`, details: reason, assigneeId: coo, requesterId: me.id, payload: { kind: 'kpi_target', key: def.key, scope, target }, link: `/kpi/${def.key}?scope=${scope.type}&id=${scope.id}` });
    app.notify.send({ employeeId: coo, title: `Target proposal from ${me.full_name}`, body: `${def.name} → ${formatValue(def.unit, target)}. ${reason}`, link: '/approvals', kind: 'info' });
    return done(ctx, { toast: { title: 'Proposal sent to the COO', body: 'You will be told when it is decided.', kind: 'success' } });
  });

  r.post('/kpi/:key/manual', async (ctx) => {
    const me = user(ctx);
    const body = await ctx.body();
    const def = KPI_BY_KEY[ctx.params.key];
    if (!def) return fail(ctx, 404, 'Unknown KPI');
    const code = view(ctx).deptCode;
    if (!(isExecutive(me) || code === def.ownerDept)) return fail(ctx, 403, `Only ${def.ownerDept} or the executives can enter this KPI.`);
    const scope: KpiScope = { type: (str(body, 'scopeType') as KpiScope['type']) || 'company', id: str(body, 'scopeId') || 'company' };
    const value = num(body, 'value');
    if (value === null) return fail(ctx, 400, 'Enter a number.');
    recordManual(app, me, def.key, scope, weekLabel(new Date()), value);
    return done(ctx, { reload: true, toast: { title: 'Value recorded', body: `${def.name} for this week: ${formatValue(def.unit, value)}`, kind: 'success' } });
  });

  r.get('/analytics', (ctx) => {
    const v = view(ctx);
    const now = new Date();
    const s = scopeFor(app.db, v.user);
    const selfOnly = s.level === 'self' || ctx.query.get('me') === '1';
    const departments = listDepartments(app.db).filter((d) => d.code !== 'LEAD');
    let dept = ctx.query.get('dept') ? getDepartment(app.db, ctx.query.get('dept')!) || null : null;
    if (!selfOnly && s.level === 'team') dept = getDepartment(app.db, v.user.department_id) || null;
    if (!selfOnly && !dept) dept = getDepartment(app.db, v.user.department_id) || departments[0];
    const code = selfOnly ? v.deptCode : dept?.code || v.deptCode;
    const keys = selfOnly ? personKpis(v.deptCode) : deptKpis(code);
    const scope: KpiScope = selfOnly ? { type: 'employee', id: v.user.id } : { type: 'department', id: dept!.id };
    const tiles: Tile[] = tilesFor(app, keys, scope, now);
    const selected = keys.includes(ctx.query.get('kpi') || '') ? ctx.query.get('kpi')! : keys[0];
    const def = KPI_BY_KEY[selected];
    const chart = { def, series: series(app, selected, scope, 13, now), target: targetFor(app, selected, scope) };
    const people: AnalyticsData['people'] = [];
    if (!selfOnly && dept) {
      const perPerson = keys.filter((k) => KPI_BY_KEY[k].perPerson);
      for (const e of listEmployees(app.db, { status: 'active', departmentId: dept.id })) {
        if (!s.people.has(e.id)) continue;
        const values = perPerson.map((k) => {
          const d = KPI_BY_KEY[k];
          const period = d.periodKind === 'month' ? { start: monthStart(now), end: now, label: isoWeek(now) } : livePeriod(now);
          const value = compute(app, k, { type: 'employee', id: e.id }, period, now);
          return { key: k, display: formatValue(d.unit, value), rag: rag(d, value, proratedTarget(d, targetFor(app, k, { type: 'employee', id: e.id }), now)) };
        });
        people.push({ emp: e, values });
      }
    }
    const data: AnalyticsData = { departments, dept, scopeLabel: dept?.name || 'Company', tiles, keys, people, selfOnly, selected, chart };
    return htmlResponse(analyticsPage(v, data));
  });

  r.get('/settings/targets', (ctx) => {
    const v = view(ctx);
    requireCan(app.db, v.user, 'reports.company');
    const rows = KPI_DEFS.map((d) => ({ key: d.key, name: d.name, band: d.band, owner: d.ownerDept, target: formatValue(d.unit, targetFor(app, d.key, { type: 'company', id: 'company' })) }));
    return htmlResponse(page(v, { title: 'Targets', subtitle: 'Company-level targets for every KPI. Open a KPI to change its target with a reason; HODs propose, the COO approves.', body: html`<section class="card">${table(['KPI', 'Band', 'Owner', 'Company target'], rows.map((k) => [html`<a href="/kpi/${k.key}">${k.name}</a>`, k.band, k.owner, html`<b class="num">${k.target}</b>`]))}</section>` }));
  });
}
