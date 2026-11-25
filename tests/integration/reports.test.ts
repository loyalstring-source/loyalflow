// Reports: every module has reports; each runs, exports, and respects the role.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, emp, HR, COO, SUPPORT_IC, SUPPORT_LEAD, BDM, SALES_HEAD } from '../helpers.ts';
import { REPORTS, reportsFor, runReport, getReport, MENU_OF, type ModuleId } from '../../src/modules/reports/engine.ts';

let s: TestServer; let coo: Client;
before(async () => { s = await startServer(); coo = new Client(s.base); await coo.login(COO); });
after(async () => { await s.close(); });
const WIDE = '?from=2026-01-01&to=2026-12-31';

describe('reports', () => {
  test('every module has reports, and keys are unique', () => {
    const mods = new Set(REPORTS.map((r) => r.module));
    for (const m of ['sales', 'support', 'dev', 'production', 'finance', 'attendance', 'hiring', 'appraisals', 'sops', 'approvals', 'admin'] as ModuleId[]) assert.ok(mods.has(m), m);
    assert.equal(new Set(REPORTS.map((r) => r.key)).size, REPORTS.length); assert.ok(REPORTS.length >= 35);
  });

  test('every report runs on the demo data: columns, rows and totals line up', () => {
    const user = emp(s.app, COO);
    for (const def of REPORTS) {
      const { result } = runReport(s.app, user, def, { from: '2026-01-01', to: '2026-12-31' });
      assert.ok(result.columns.length >= 2, def.key);
      for (const row of result.rows) assert.equal(row.length, result.columns.length, `${def.key}: a row has ${row.length} cells for ${result.columns.length} columns`);
      if (result.totals) assert.equal(result.totals.length, result.columns.length, `${def.key}: totals`);
      if (result.chart) assert.equal(result.chart.labels.length, result.chart.values.length, `${def.key}: chart`);
      for (const row of result.rows) for (const c of row) assert.ok(c === null || ['string', 'number'].includes(typeof c) || (typeof c === 'object' && 'href' in c), `${def.key}: odd cell ${JSON.stringify(c)}`);
    }
  });

  test('the figures are right for a few known cases', () => {
    const user = emp(s.app, COO); const db = s.app.db;
    const wl = runReport(s.app, user, getReport('sales-won-lost')!, { from: '2026-01-01', to: '2026-12-31' }).result;
    assert.equal(wl.totals![1], db.get<{ n: number }>("SELECT COUNT(*) AS n FROM deals WHERE stage = 'won'")!.n);
    assert.equal(wl.totals![3], db.get<{ n: number }>("SELECT COUNT(*) AS n FROM deals WHERE stage = 'lost'")!.n);
    const cust = runReport(s.app, user, getReport('support-by-customer')!, { from: '2026-01-01', to: '2026-12-31' }).result;
    assert.equal(cust.totals![1], db.get<{ n: number }>('SELECT COUNT(*) AS n FROM tickets')!.n);
    const funnel = runReport(s.app, user, getReport('sales-funnel')!, { from: '2026-01-01', to: '2026-12-31' }).result;
    assert.equal(funnel.rows[0][1], db.get<{ n: number }>('SELECT COUNT(*) AS n FROM deals')!.n, 'every deal reaches the first stage');
    for (let i = 1; i < funnel.rows.length; i++) assert.ok(Number(funnel.rows[i][1]) <= Number(funnel.rows[i - 1][1]), 'a funnel never widens');
    const none = runReport(s.app, user, getReport('sales-won-lost')!, { from: '2020-01-01', to: '2020-03-31' }).result;
    assert.equal(none.totals![1], 0); assert.equal(none.rows.length, 3);
    const swapped = runReport(s.app, user, getReport('sales-won-lost')!, { from: '2026-12-31', to: '2026-01-01' });
    assert.equal(swapped.ctx.from, '2026-01-01', 'dates the wrong way round are swapped');
  });

  test('the hub and every report page open for the COO; Excel export is a real workbook', async () => {
    const hub = await (await coo.get('/reports?view=list')).text();
    for (const def of REPORTS) assert.ok(hub.includes(`/reports/${def.key}`), def.key);
    for (const def of REPORTS) { const r = await coo.get(`/reports/${def.key}${WIDE}`); assert.equal(r.status, 200, def.key); const h = await r.text(); assert.ok(h.includes(def.title), def.key); assert.ok(h.includes(`/reports/${def.key}.xlsx`), def.key); }
    for (const key of ['sales-by-person', 'att-summary', 'fin-budget', 'admin-audit']) {
      const x = await coo.get(`/reports/${key}.xlsx${WIDE}`); assert.equal(x.status, 200, key); assert.match(x.headers.get('content-type') || '', /spreadsheetml/);
      const buf = Buffer.from(await x.arrayBuffer()); assert.equal(buf.subarray(0, 2).toString('latin1'), 'PK', key); const raw = buf.toString('latin1'); assert.ok(raw.includes('xl/worksheets/sheet1.xml') && raw.includes('xl/worksheets/sheet2.xml'), key);
    }
    assert.equal((await coo.get('/reports/no-such-report')).status, 404);
    for (const m of ['sales', 'support', 'people', 'production']) { const h = await (await coo.get(`/reports?module=${m}`)).text(); assert.ok(h.includes('report-link'), m); }
    const home = await (await coo.get('/pipeline')).text(); assert.ok(home.includes('/reports?module=sales'), 'Sales has a Reports tab');
  });

  test('a person sees only the reports their role allows, and only their own people', async () => {
    const hr = emp(s.app, HR); const hrKeys = reportsFor(s.app, hr).map((r) => r.module);
    assert.ok(hrKeys.includes('hiring') && hrKeys.includes('attendance') && hrKeys.includes('appraisals')); assert.ok(!hrKeys.includes('sales') && !hrKeys.includes('support') && !hrKeys.includes('admin'));
    const h = new Client(s.base); await h.login(HR);
    assert.equal((await h.get('/reports/hire-funnel')).status, 200); assert.equal((await h.get('/reports/sales-won-lost')).status, 403); assert.equal((await h.get('/reports/admin-audit.xlsx')).status, 403);
    const ic = emp(s.app, SUPPORT_IC); const icMods = new Set(reportsFor(s.app, ic).map((r) => r.module));
    assert.ok(icMods.has('support')); assert.ok(!icMods.has('hiring') && !icMods.has('finance') && !icMods.has('attendance') && !icMods.has('admin'));
    const c = new Client(s.base); await c.login(SUPPORT_IC); assert.equal((await c.get('/reports/att-late')).status, 403); assert.equal((await c.get('/reports/fin-expenses-person')).status, 403);
    const hub = await (await c.get('/reports')).text(); assert.ok(!hub.includes('/reports/hire-time') && hub.includes('/reports/support-by-type'));

    const lead = emp(s.app, SUPPORT_LEAD); const team = runReport(s.app, lead, getReport('att-summary')!, { from: '2026-10-01', to: '2026-10-31' });
    assert.ok(team.ctx.people && team.ctx.people.has(lead.id)); assert.ok(team.result.rows.length >= 1 && team.result.rows.length < 44, 'a team lead sees the team, not the company');
    const bdm = emp(s.app, BDM); const own = runReport(s.app, bdm, getReport('sales-by-person')!, { from: '2026-01-01', to: '2026-12-31' });
    assert.ok(own.result.rows.every((r) => (r[0] as { text: string }).text === bdm.full_name), 'a sales person sees only their own line');
    const head = runReport(s.app, emp(s.app, SALES_HEAD), getReport('sales-by-person')!, { from: '2026-01-01', to: '2026-12-31' });
    assert.equal(head.ctx.people, null); assert.ok(head.result.rows.length > 1);
    assert.equal(MENU_OF.hiring, 'people');
  });
});

describe('what each person did', () => {
  test('one line per person, and one person entry by entry, with an Excel download', async () => {
    const all = await (await coo.get('/reports/emp-activity' + WIDE)).text();
    for (const h of ['Days at work', 'Review lines done', 'Tickets closed', 'Deals won', 'Customer contacts']) assert.match(all, new RegExp(h));
    for (const r of ['Today', 'This week', 'Last 6 months', 'Last 12 months']) assert.match(all, new RegExp('>' + r + '<'));
    const id = emp(s.app, BDM).id; assert.match(all, new RegExp('/reports/emp-activity\\?person=' + id));
    const one = await (await coo.get('/reports/emp-activity' + WIDE + '&person=' + id)).text();
    assert.match(one, /Entries by kind/); assert.match(one, /Attendance/); assert.match(one, /entr(y|ies) in the period/);
    const x = await coo.get('/reports/emp-activity.xlsx' + WIDE + '&person=' + id); assert.equal(x.status, 200); assert.match(x.headers.get('content-type') || '', /spreadsheetml/);
  });
  test('a manager sees only their own people; an employee cannot open it', async () => {
    const lead = new Client(s.base); await lead.login(SUPPORT_LEAD); const page = await (await lead.get('/reports/emp-activity' + WIDE)).text();
    assert.ok(!page.includes('person=' + emp(s.app, BDM).id), 'no one from Sales');
    const other = await (await lead.get('/reports/emp-activity' + WIDE + '&person=' + emp(s.app, BDM).id)).text(); assert.match(other, /0 entries in the period/);
    const ic = new Client(s.base); await ic.login(SUPPORT_IC); assert.equal((await ic.get('/reports/emp-activity')).status, 403);
  });
});
