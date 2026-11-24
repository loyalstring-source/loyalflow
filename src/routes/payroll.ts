import type { App } from '../app.ts';
import { lateStanding, canEditRules, rules as attendanceRules } from '../modules/hr/attendance-rules.ts';
import { Router, htmlResponse, file, text, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees, getEmployee } from '../modules/people/model.ts';
import { listRuns, getRun, runForMonth, slipsOf, getPayslip, payslipsFor, buildRun, approveRun, markPaid, reopenRun, statutoryTotals, bankFile, listStructures, currentStructure, structureHistory, saveStructure, declarationFor, ytd, fyOf, parseMoney, sum, type Money } from '../modules/hr/payroll.ts';
import { monthSheet, listRegularisations, requestRegularisation, holidayList, saveHolidays } from '../modules/hr/attendance.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { localDateString, addDays } from '../lib/time.ts';
import { buildXlsx, type Sheet } from '../lib/xlsx.ts';
import { payrollPage, newRunModal, runPage, payslipPage, payslipPrint, salariesPage, salaryModal, salaryHistoryPage, myPayslipsPage, taxDeclarationModal, monthName } from '../ui/pages/payroll.ts';
import { attendancePage, regulariseModal, holidaysPage } from '../ui/pages/attendance.ts';
import { done, fail, view, user, str, num, bool } from './helpers.ts';

/** Payroll is run by HR and Accounts; approval sits with the COO/CEO. */
function canRunPayroll(app: App, e: Employee): boolean { return can(app.db, e, 'payroll.run'); }
function canApprovePayroll(app: App, e: Employee): boolean {
  const c = getSetting(app.db, 'company');
  return e.id === c.cooId || e.id === c.ceoId || e.is_admin === 1;
}
function recentMonths(n = 15): string[] {
  const out: string[] = []; const now = new Date();
  for (let i = 0; i < n; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0)); out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  return out;
}
function missingStructures(app: App): Employee[] {
  return listEmployees(app.db, { status: 'active' }).filter((e) => !currentStructure(app, e.id));
}

export function register(r: Router<Employee>, app: App): void {
  // ---------- Payroll ----------
  r.get('/payroll', (ctx) => {
    const v = view(ctx);
    if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Payroll is limited to HR, Accounts and the executives.');
    const thisMonth = localDateString(new Date()).slice(0, 7);
    return htmlResponse(payrollPage(v, { runs: listRuns(app), months: recentMonths(), canRun: true, verified: getSetting(app.db, 'statutory').verifiedByCa, missingStructures: missingStructures(app), thisMonth }));
  });
  r.get('/payroll/new', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const months = recentMonths().filter((m) => !runForMonth(app, m) || runForMonth(app, m)!.status === 'draft');
    return htmlResponse(newRunModal(v, { months, suggested: months[0] || localDateString(new Date()).slice(0, 7) }));
  });
  r.post('/payroll', async (ctx) => {
    const me = user(ctx); if (!canRunPayroll(app, me)) return fail(ctx, 403, 'Not allowed');
    const b = await ctx.body();
    try { const { run, skipped } = buildRun(app, me, str(b, 'month')); return done(ctx, { redirect: `/payroll/${run.id}`, toast: { title: `Draft for ${monthName(run.month)} ready`, body: `${run.headcount} payslips${skipped.length ? `, ${skipped.length} skipped (no salary set)` : ''}`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/payroll/salaries', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    return htmlResponse(salariesPage(v, { structures: listStructures(app), missing: missingStructures(app), canEdit: canRunPayroll(app, v.user) }));
  });
  r.get('/payroll/salaries/new', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const selected = ctx.query.get('employee') || '';
    return htmlResponse(salaryModal(v, { employees: listEmployees(app.db, { status: 'active' }), selected, current: selected ? currentStructure(app, selected) || null : null }));
  });
  r.post('/payroll/salaries', async (ctx) => {
    const me = user(ctx); if (!canRunPayroll(app, me)) return fail(ctx, 403, 'Not allowed');
    const b = await ctx.body();
    try {
      const s = saveStructure(app, me, { employeeId: str(b, 'employeeId'), effectiveFrom: str(b, 'effectiveFrom'), ctcAnnual: num(b, 'ctcAnnual') ?? undefined, basic: num(b, 'basic') ?? 0, hra: num(b, 'hra') ?? 0, conveyance: num(b, 'conveyance') ?? 0, special: num(b, 'special') ?? 0,
        pfApplicable: str(b, 'pfApplicable') !== '0', pfOnFullBasic: str(b, 'pfOnFullBasic') === '1', esiApplicable: str(b, 'esiApplicable') !== '0', bankAccount: str(b, 'bankAccount'), bankIfsc: str(b, 'bankIfsc'), pan: str(b, 'pan'), uan: str(b, 'uan'), esicNumber: str(b, 'esicNumber') });
      return done(ctx, { reload: true, toast: { title: 'Salary saved', body: `${getEmployee(app.db, s.employee_id)?.full_name} from ${s.effective_from}`, kind: 'success' } });
    } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/payroll/salaries/:id', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const e = getEmployee(app.db, ctx.params.id); if (!e) throw new HttpError(404, 'Employee not found');
    return htmlResponse(salaryHistoryPage(v, { employee: e, rows: structureHistory(app, e.id) }));
  });
  r.get('/payroll/slip/:id', (ctx) => {
    const v = view(ctx);
    const slip = getPayslip(app, ctx.params.id); if (!slip) throw new HttpError(404, 'Payslip not found');
    const self = slip.employee_id === v.user.id;
    if (!self && !canRunPayroll(app, v.user)) throw new HttpError(403, 'Payslips are private to the employee, HR and Accounts.');
    if (self && slip.run_status === 'draft' && !canRunPayroll(app, v.user)) throw new HttpError(403, 'This payslip is not published yet.');
    const e = getEmployee(app.db, slip.employee_id)!;
    const company = getSetting(app.db, 'company').name;
    if (ctx.query.get('print') === '1') return htmlResponse(payslipPrint({ slip, employee: e, company }));
    return htmlResponse(payslipPage(v, { slip, employee: e, self, company, ytd: ytd(app, e.id, fyOf(slip.month)) }));
  });
  r.get('/payroll/:id', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const run = getRun(app, ctx.params.id); if (!run) throw new HttpError(404, 'Run not found');
    return htmlResponse(runPage(v, { run, slips: slipsOf(app, run.id), statutory: statutoryTotals(app, run.id), canRun: canRunPayroll(app, v.user), canApprove: canApprovePayroll(app, v.user), departments: [], skipped: [], verified: getSetting(app.db, 'statutory').verifiedByCa }));
  });
  r.post('/payroll/:id/build', (ctx) => {
    const me = user(ctx); if (!canRunPayroll(app, me)) return fail(ctx, 403, 'Not allowed');
    const run = getRun(app, ctx.params.id); if (!run) return fail(ctx, 404, 'Run not found');
    try { const { run: r2, skipped } = buildRun(app, me, run.month); return done(ctx, { reload: true, toast: { title: 'Recalculated', body: `${r2.headcount} payslips${skipped.length ? `, ${skipped.length} skipped` : ''}`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/payroll/:id/approve', (ctx) => {
    const me = user(ctx); if (!canApprovePayroll(app, me)) return fail(ctx, 403, 'Only the COO or CEO approves payroll.');
    try { const run = approveRun(app, me, ctx.params.id); return done(ctx, { reload: true, confetti: true, toast: { title: `${monthName(run.month)} approved`, body: `${run.headcount} payslips published · net ₹${Math.round(run.net).toLocaleString('en-IN')}`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/payroll/:id/paid', (ctx) => {
    const me = user(ctx); if (!canApprovePayroll(app, me)) return fail(ctx, 403, 'Not allowed');
    try { const run = markPaid(app, me, ctx.params.id); return done(ctx, { reload: true, toast: { title: `${monthName(run.month)} marked paid`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.post('/payroll/:id/reopen', async (ctx) => {
    const me = user(ctx); if (!canApprovePayroll(app, me)) return fail(ctx, 403, 'Not allowed');
    const b = await ctx.body();
    try { reopenRun(app, me, ctx.params.id, str(b, 'reason') || str(b, 'note')); return done(ctx, { reload: true, toast: { title: 'Run reopened as a draft', kind: 'warn' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });
  r.get('/payroll/:id/bank.csv', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const run = getRun(app, ctx.params.id); if (!run) throw new HttpError(404, 'Run not found');
    if (run.status === 'draft') throw new HttpError(400, 'Approve the run before downloading the bank file.');
    return file(bankFile(app, run.id), `loyalflow-bank-${run.month}.csv`, 'text/csv');
  });
  r.get('/exports/payroll-:id.xlsx', (ctx) => {
    const v = view(ctx); if (!canRunPayroll(app, v.user)) throw new HttpError(403, 'Not allowed');
    const run = getRun(app, ctx.params.id); if (!run) throw new HttpError(404, 'Run not found');
    const slips = slipsOf(app, run.id);
    const heads = new Set<string>(); const dheads = new Set<string>();
    for (const s of slips) { for (const k of Object.keys(parseMoney(s.earnings))) heads.add(k); for (const k of Object.keys(parseMoney(s.deductions))) dheads.add(k); }
    const earnCols = [...heads], dedCols = [...dheads];
    const sheet: Sheet = { name: `Register ${run.month}`, columns: [{ header: 'Employee ID', width: 10 }, { header: 'Name', width: 26 }, { header: 'Designation', width: 28 }, { header: 'Department', width: 10 }, { header: 'Working days', width: 11, format: 'number' }, { header: 'Paid days', width: 10, format: 'number' }, { header: 'LOP days', width: 9, format: 'number' },
      ...earnCols.map((h) => ({ header: h, width: 14, format: 'inr' as const })), { header: 'Gross', width: 14, format: 'inr' }, ...dedCols.map((h) => ({ header: h, width: 14, format: 'inr' as const })), { header: 'Total deductions', width: 14, format: 'inr' }, { header: 'Net pay', width: 14, format: 'inr' }],
      rows: slips.map((s) => { const e = parseMoney(s.earnings), d = parseMoney(s.deductions); return [s.employee_id, s.employee_name || '', s.designation || '', s.department_id || '', s.working_days, s.present_days + s.paid_leave_days, s.lop_days, ...earnCols.map((h) => e[h] || 0), s.gross, ...dedCols.map((h) => d[h] || 0), s.total_deductions, s.net]; }) };
    const t = statutoryTotals(app, run.id);
    const stat: Sheet = { name: 'Statutory', columns: [{ header: 'Head', width: 30 }, { header: 'Amount', width: 16, format: 'inr' }], rows: [['PF — employee', t.pfEmployee], ['PF — employer', t.pfEmployer], ['Pension (EPS)', t.eps], ['PF admin', t.pfAdmin], ['EDLI', t.edli], ['Total PF challan', t.totalPf], ['ESI — employee', t.esiEmployee], ['ESI — employer', t.esiEmployer], ['Total ESI challan', t.totalEsi], ['Professional tax', t.pt], ['TDS', t.tds]] };
    return file(buildXlsx([sheet, stat], { title: `Payroll ${run.month}` }), `loyalflow-payroll-${run.month}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });

  // ---------- Self-service ----------
  r.get('/me/payslips', (ctx) => {
    const v = view(ctx);
    const fy = fyOf(localDateString(new Date()).slice(0, 7));
    return htmlResponse(myPayslipsPage(v, { slips: payslipsFor(app, v.user.id), declaration: declarationFor(app, v.user.id, fy), fy, ytd: ytd(app, v.user.id, fy) }));
  });
  r.get('/me/tax-declaration', (ctx) => {
    const v = view(ctx);
    const fy = fyOf(localDateString(new Date()).slice(0, 7));
    return htmlResponse(taxDeclarationModal(v, { declaration: declarationFor(app, v.user.id, fy), fy, limits: getSetting(app.db, 'statutory').tds.old }));
  });
  r.post('/me/tax-declaration', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const fy = fyOf(localDateString(new Date()).slice(0, 7));
    app.db.run(`INSERT INTO tax_declarations (employee_id, fiscal_year, regime, s80c, s80d, s80ccd1b, home_loan_interest, rent_paid_monthly, metro, other_income, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?) ON CONFLICT(employee_id, fiscal_year) DO UPDATE SET regime = excluded.regime, s80c = excluded.s80c, s80d = excluded.s80d, s80ccd1b = excluded.s80ccd1b, home_loan_interest = excluded.home_loan_interest, rent_paid_monthly = excluded.rent_paid_monthly, metro = excluded.metro, other_income = excluded.other_income, status = 'submitted', updated_at = excluded.updated_at`,
      [me.id, fy, str(b, 'regime') === 'old' ? 'old' : 'new', num(b, 's80c') ?? 0, num(b, 's80d') ?? 0, num(b, 's80ccd1b') ?? 0, num(b, 'homeLoanInterest') ?? 0, num(b, 'rentPaidMonthly') ?? 0, str(b, 'metro') === '1' ? 1 : 0, num(b, 'otherIncome') ?? 0, new Date().toISOString()]);
    return done(ctx, { reload: true, toast: { title: 'Declaration saved', body: 'Next month’s TDS uses it.', kind: 'success' } });
  });

  // ---------- Attendance ----------
  r.get('/attendance', (ctx) => {
    const v = view(ctx);
    const scope = scopeFor(app.db, v.user);
    const asked = ctx.query.get('employee') || v.user.id;
    const employee = scope.people.has(asked) || can(app.db, v.user, 'people.admin') ? getEmployee(app.db, asked) : v.user;
    if (!employee) throw new HttpError(404, 'Employee not found');
    const month = /^\d{4}-\d{2}$/.test(ctx.query.get('month') || '') ? ctx.query.get('month')! : localDateString(new Date()).slice(0, 7);
    const canSeeTeam = scope.level !== 'self' || can(app.db, v.user, 'people.admin');
    const people = canSeeTeam ? listEmployees(app.db, { status: 'active' }).filter((e) => scope.people.has(e.id)) : [v.user];
    const team = canSeeTeam ? people.slice(0, 40).map((e) => { const s = monthSheet(app, e, month); return { employee: e, present: s.present, leave: s.leave, absent: s.absent, late: s.late }; }) : [];
    return htmlResponse(attendancePage(v, { month, months: recentMonths(12), employee, self: employee.id === v.user.id, sheet: monthSheet(app, employee, month), regularisations: listRegularisations(app, { employeeId: employee.id, limit: 12 }), team, canSeeTeam, people, standing: lateStanding(app, employee.id, month), canManage: canEditRules(app, v.user), rules: attendanceRules(app) }));
  });
  r.get('/attendance/regularise', (ctx) => htmlResponse(regulariseModal(view(ctx), attendanceRules(app).missPunchWindowDays)));
  r.post('/attendance/regularise', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    try { const { task } = requestRegularisation(app, me, { date: str(b, 'date'), checkIn: str(b, 'checkIn') || undefined, checkOut: str(b, 'checkOut') || undefined, reason: str(b, 'reason'), kind: str(b, 'kind'), reasonCode: str(b, 'reasonCode') });
      return done(ctx, { reload: true, toast: { title: 'Miss-punch request sent', body: `Step 1: ${task.assignee_name} validates. Step 2: HR approves.`, kind: 'success' } }); }
    catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  });

  // ---------- Holiday calendar ----------
  r.get('/settings/holidays', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'people.admin');
    const thisYear = new Date().getUTCFullYear();
    const years = [thisYear - 1, thisYear, thisYear + 1].map(String);
    const year = years.includes(ctx.query.get('year') || '') ? ctx.query.get('year')! : String(thisYear);
    return htmlResponse(holidaysPage(v, { holidays: holidayList(app), year, years }));
  });
  r.post('/settings/holidays', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'people.admin');
    const b = await ctx.body();
    const dates: string[] = Array.isArray(b.date) ? b.date : b.date ? [b.date] : [];
    const names: string[] = Array.isArray(b.name) ? b.name : b.name ? [b.name] : [];
    const year = str(b, 'year');
    const kept = holidayList(app).filter((h) => !h.date.startsWith(year));
    const edited = dates.map((d, i) => ({ date: String(d), name: String(names[i] || '') })).filter((h) => h.date);
    saveHolidays(app, me, [...kept, ...edited]);
    return ctx.wantsJson ? done(ctx, { reload: true, toast: { title: 'Holidays saved', kind: 'success' } }) : done(ctx, { redirect: `/settings/holidays?year=${year}` });
  });
  void bool; void text; void addDays; void sum; void monthName;
}
