// Reports: the hub, one screen per report, and the Excel export.
import type { App } from '../app.ts';
import { Router, htmlResponse, file } from '../lib/http.ts';
import { type Employee, listDepartments, listEmployees } from '../modules/people/model.ts';
import { scopeFor } from '../lib/scope.ts';
import { buildXlsx, type Sheet } from '../lib/xlsx.ts';
import { localDateString } from '../lib/time.ts';
import { reportsFor, getReport, runReport, defaultRange, MENU_OF, type Column, type Cell } from '../modules/reports/engine.ts';
import { reportsHubPage, reportPage } from '../ui/pages/reports.ts';
import { fail, view } from './helpers.ts';

function quickRanges(now = new Date()): { label: string; from: string; to: string }[] {
  const today = localDateString(now); const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)); const p2 = (n: number): string => String(n).padStart(2, '0');
  const first = (yy: number, mm: number): string => { while (mm < 1) { mm += 12; yy--; } return `${yy}-${p2(mm)}-01`; };
  const lastDay = (yy: number, mm: number): string => { while (mm < 1) { mm += 12; yy--; } return `${yy}-${p2(mm)}-${p2(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`; };
  const fy = m >= 4 ? y : y - 1;
  return [{ label: 'This month', from: first(y, m), to: today }, { label: 'Last month', from: first(y, m - 1), to: lastDay(y, m - 1) }, { label: 'Last 3 months', ...defaultRange(now) }, { label: 'This financial year', from: `${fy}-04-01`, to: today }, { label: 'Last 12 months', from: first(y, m - 11), to: today }];
}
const xfmt = (c: Column): 'text' | 'number' | 'inr' => (c.fmt === 'money' ? 'inr' : c.fmt === 'int' || c.fmt === 'num' || c.fmt === 'pct' ? 'number' : 'text');
const xcell = (c: Cell): string | number | null => (c && typeof c === 'object' ? c.text : c);

export function register(r: Router<Employee>, app: App): void {
  r.get('/reports', (ctx) => {
    const v = view(ctx); const menu = ctx.query.get('module') || '';
    const all = reportsFor(app, v.user); const shown = menu ? all.filter((x) => MENU_OF[x.module] === menu) : all;
    return htmlResponse(reportsHubPage(v, { reports: shown, menu }));
  });

  const prepare = (ctx: { query: URLSearchParams }, user: Employee, key: string) => {
    const def = getReport(key); if (!def || !def.allowed(app, user)) return null;
    return { def, ...runReport(app, user, def, { from: ctx.query.get('from') || undefined, to: ctx.query.get('to') || undefined, departmentId: ctx.query.get('department') || undefined, personId: ctx.query.get('person') || undefined }) };
  };

  r.get('/reports/:key', (ctx) => {
    const v = view(ctx); let key = ctx.params.key; const xlsx = key.endsWith('.xlsx'); if (xlsx) key = key.slice(0, -5);
    const def0 = getReport(key); if (!def0) return fail(ctx, 404, 'There is no such report.');
    const out = prepare(ctx, v.user, key); if (!out) return fail(ctx, 403, 'Your role does not include this report.');
    const { def, result, ctx: rc } = out;
    if (xlsx) {
      const rows = result.rows.map((row) => row.map(xcell)); if (result.totals) rows.push(result.totals.map(xcell));
      const sheet: Sheet = { name: def.title.slice(0, 28), columns: result.columns.map((c) => ({ header: c.fmt === 'pct' ? `${c.header} (%)` : c.header, width: c.width || (c.fmt === 'link' || !c.fmt ? 26 : 16), format: xfmt(c) })), rows };
      const about: Sheet = { name: 'About', columns: [{ header: 'Item', width: 22 }, { header: 'Value', width: 70 }], rows: [['Report', def.title], ['What it shows', def.about], ...(def.noRange ? [] : [['From', rc.from], ['To', rc.to]] as [string, string][]), ['Department', rc.departmentId || 'All'], ['Person', rc.personId || 'Everyone'], ['Run by', v.user.full_name], ['Run on', localDateString(new Date())], ...(result.note ? [['Note', result.note] as [string, string]] : [])] };
      return file(buildXlsx([sheet, about], { title: def.title }), `loyalflow-${def.key}-${rc.from}-to-${rc.to}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    const scope = scopeFor(app.db, v.user);
    const people = def.filters.includes('person') ? listEmployees(app.db, { status: 'active' }).filter((e) => !rc.people || scope.people.has(e.id)).map((e) => ({ id: e.id, full_name: e.full_name })) : [];
    const q = new URLSearchParams(); for (const k of ['from', 'to', 'department', 'person']) { const x = ctx.query.get(k); if (x) q.set(k, x); }
    return htmlResponse(reportPage(v, { def, result, ctx: rc, siblings: reportsFor(app, v.user).filter((x) => x.module === def.module), departments: def.filters.includes('department') ? listDepartments(app.db).map((d) => ({ id: d.id, name: d.name })) : [], people, ranges: quickRanges(), query: q.toString() ? `?${q.toString()}` : '' }));
  });
}
