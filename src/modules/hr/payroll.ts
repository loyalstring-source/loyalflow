// Payroll: salary structures, monthly runs, statutory PF/ESI/PT/TDS and payslips.
// Every rate and slab is configurable in Settings → Statutory. Nothing here is tax advice:
// the figures must be checked by the company's CA before the first live payroll (see `verifiedByCa`).
import type { App } from '../../app.ts';
import { HttpError } from '../../lib/http.ts';
import { audit } from '../../lib/audit.ts';
import { getSetting, shiftByCode, holidaySet, type Statutory, type PtSlab, type TaxSlab } from '../../lib/settings.ts';
import { addDays, fromLocal, isWorkingDay, localDateString, toLocal } from '../../lib/time.ts';
import { getEmployee, listEmployees, type Employee } from '../people/model.ts';

export interface SalaryStructure {
  id: number; employee_id: string; effective_from: string; ctc_annual: number; basic: number; hra: number; conveyance: number; special: number; other_earnings: string;
  pf_applicable: number; pf_on_full_basic: number; esi_applicable: number; pt_applicable: number; bank_account: string; bank_ifsc: string; pan: string; uan: string; esic_number: string;
  notes: string; created_by: string | null; created_at: string; employee_name?: string;
}
export interface PayrollRun { id: string; month: string; status: string; gross: number; deductions: number; net: number; employer_cost: number; headcount: number; notes: string; created_by: string | null; created_at: string; approved_by: string | null; approved_at: string | null; paid_at: string | null; approver_name?: string | null }
export interface Payslip {
  id: string; run_id: string; employee_id: string; month: string; working_days: number; present_days: number; paid_leave_days: number; lop_days: number;
  earnings: string; deductions: string; employer: string; gross: number; total_deductions: number; net: number; note: string; created_at: string;
  employee_name?: string; designation?: string; department_id?: string; department?: string; run_status?: string;
}
export type Money = Record<string, number>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

export function parseMoney(s: string): Money { try { return JSON.parse(s) as Money; } catch { return {}; } }
export function sum(m: Money): number { return r2(Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0)); }

// ---------- Salary structures ----------
export function currentStructure(app: App, employeeId: string, onDate = localDateString(new Date())): SalaryStructure | undefined {
  return app.db.get<SalaryStructure>('SELECT * FROM salary_structures WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1', [employeeId, onDate]);
}
export function structureHistory(app: App, employeeId: string): SalaryStructure[] {
  return app.db.all<SalaryStructure>('SELECT * FROM salary_structures WHERE employee_id = ? ORDER BY effective_from DESC, id DESC', [employeeId]);
}
export function listStructures(app: App): SalaryStructure[] {
  return app.db.all<SalaryStructure>(`SELECT s.*, e.full_name AS employee_name FROM salary_structures s JOIN employees e ON e.id = s.employee_id
    WHERE s.id = (SELECT id FROM salary_structures x WHERE x.employee_id = s.employee_id ORDER BY x.effective_from DESC, x.id DESC LIMIT 1) ORDER BY e.full_name`);
}

/** Suggest a split from a CTC: 50% basic, 40% of basic as HRA, statutory conveyance, the rest as special allowance. */
export function suggestSplit(ctcAnnual: number): { basic: number; hra: number; conveyance: number; special: number } {
  const monthly = ctcAnnual / 12;
  const basic = r0(monthly * 0.5);
  const hra = r0(basic * 0.4);
  const conveyance = Math.min(1600, r0(monthly * 0.05));
  const special = Math.max(0, r0(monthly - basic - hra - conveyance));
  return { basic, hra, conveyance, special };
}

export function saveStructure(app: App, actor: Employee, input: { employeeId: string; effectiveFrom: string; ctcAnnual?: number; basic: number; hra?: number; conveyance?: number; special?: number; otherEarnings?: Money; pfApplicable?: boolean; pfOnFullBasic?: boolean; esiApplicable?: boolean; ptApplicable?: boolean; bankAccount?: string; bankIfsc?: string; pan?: string; uan?: string; esicNumber?: string; notes?: string }): SalaryStructure {
  if (!getEmployee(app.db, input.employeeId)) throw new HttpError(404, 'Unknown employee');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) throw new HttpError(400, 'Give the date the salary takes effect.');
  if (!(input.basic > 0)) throw new HttpError(400, 'Basic pay must be more than zero.');
  const monthly = input.basic + (input.hra || 0) + (input.conveyance || 0) + (input.special || 0) + sum(input.otherEarnings || {});
  app.db.run(`INSERT INTO salary_structures (employee_id, effective_from, ctc_annual, basic, hra, conveyance, special, other_earnings, pf_applicable, pf_on_full_basic, esi_applicable, pt_applicable, bank_account, bank_ifsc, pan, uan, esic_number, notes, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.employeeId, input.effectiveFrom, input.ctcAnnual ?? r0(monthly * 12), input.basic, input.hra || 0, input.conveyance || 0, input.special || 0, JSON.stringify(input.otherEarnings || {}),
      input.pfApplicable === false ? 0 : 1, input.pfOnFullBasic ? 1 : 0, input.esiApplicable === false ? 0 : 1, input.ptApplicable === false ? 0 : 1,
      input.bankAccount || '', input.bankIfsc || '', (input.pan || '').toUpperCase(), input.uan || '', input.esicNumber || '', input.notes || '', actor.id, new Date().toISOString()]);
  audit(app.db, { entity: 'salary', entityId: input.employeeId, action: 'set', actorId: actor.id, after: { effectiveFrom: input.effectiveFrom, ctc: input.ctcAnnual, basic: input.basic } });
  return currentStructure(app, input.employeeId, input.effectiveFrom)!;
}

// ---------- Statutory calculations ----------
export function pfWage(basicForMonth: number, st: Statutory, onFullBasic: boolean): number {
  if (!st.pf.enabled) return 0;
  return onFullBasic || !st.pf.restrictToCeiling ? basicForMonth : Math.min(basicForMonth, st.pf.wageCeiling);
}

export function pfAmounts(basicForMonth: number, st: Statutory, onFullBasic = false): { employee: number; employer: number; eps: number; admin: number; edli: number } {
  const wage = pfWage(basicForMonth, st, onFullBasic);
  if (!wage) return { employee: 0, employer: 0, eps: 0, admin: 0, edli: 0 };
  const employee = r0((wage * st.pf.employeeRate) / 100);
  const epsWage = Math.min(wage, st.pf.wageCeiling);
  const eps = r0((epsWage * st.pf.epsRate) / 100);
  const employerTotal = r0((wage * st.pf.employerRate) / 100);
  return { employee, employer: Math.max(0, employerTotal - eps), eps, admin: r0((wage * st.pf.adminRate) / 100), edli: r0((wage * st.pf.edliRate) / 100) };
}

export function esiAmounts(gross: number, st: Statutory): { employee: number; employer: number; eligible: boolean } {
  if (!st.esi.enabled || gross > st.esi.grossCeiling) return { employee: 0, employer: 0, eligible: false };
  return { employee: Math.ceil((gross * st.esi.employeeRate) / 100), employer: Math.ceil((gross * st.esi.employerRate) / 100), eligible: true };
}

export function ptAmount(gross: number, st: Statutory, gender: string, month: string): number {
  if (!st.pt.enabled) return 0;
  const slabs: PtSlab[] = (gender || '').toLowerCase().startsWith('f') ? st.pt.female : st.pt.male;
  let amount = 0;
  for (const slab of slabs) { if (slab.upTo === null || gross <= slab.upTo) { amount = slab.amount; break; } }
  if (amount > 0 && month.endsWith('-02')) amount += st.pt.februaryExtra;
  return amount;
}

/** Tax on a taxable income using progressive slabs. */
export function taxFromSlabs(taxable: number, slabs: TaxSlab[]): number {
  let tax = 0, lower = 0;
  for (const slab of slabs) {
    const upper = slab.upTo === null ? Infinity : slab.upTo;
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * slab.rate) / 100;
    lower = upper;
    if (taxable <= lower) break;
  }
  return tax;
}

export interface Declaration { regime: string; s80c: number; s80d: number; s80ccd1b: number; home_loan_interest: number; rent_paid_monthly: number; metro: number; other_income: number }

/** Annual income tax including cess, for the chosen regime. HRA exemption applies in the old regime only. */
export function annualTax(app: App, opts: { annualGross: number; annualBasic: number; annualHra: number; declaration?: Declaration | null; ptPaid?: number }): { regime: string; taxable: number; tax: number; breakdown: Money } {
  const st = getSetting(app.db, 'statutory');
  const d = opts.declaration;
  const regime = d?.regime === 'old' ? 'old' : 'new';
  const cfg = regime === 'old' ? st.tds.old : st.tds.new;
  const breakdown: Money = { gross: r0(opts.annualGross), standardDeduction: cfg.standardDeduction };
  let taxable = opts.annualGross + (d?.other_income || 0) - cfg.standardDeduction;
  if (regime === 'old') {
    const old = st.tds.old;
    const rent = (d?.rent_paid_monthly || 0) * 12;
    if (rent > 0 && opts.annualHra > 0) {
      const hraExempt = Math.max(0, Math.min(opts.annualHra, rent - 0.1 * opts.annualBasic, (d?.metro ? 0.5 : 0.4) * opts.annualBasic));
      taxable -= hraExempt; breakdown.hraExemption = r0(hraExempt);
    }
    const c80 = Math.min(d?.s80c || 0, old.limit80c); if (c80) { taxable -= c80; breakdown.s80c = c80; }
    const d80 = Math.min(d?.s80d || 0, old.limit80d); if (d80) { taxable -= d80; breakdown.s80d = d80; }
    const nps = Math.min(d?.s80ccd1b || 0, old.limit80ccd1b); if (nps) { taxable -= nps; breakdown.s80ccd1b = nps; }
    const loan = Math.min(d?.home_loan_interest || 0, 200000); if (loan) { taxable -= loan; breakdown.homeLoanInterest = loan; }
    if (opts.ptPaid) { taxable -= opts.ptPaid; breakdown.professionalTax = r0(opts.ptPaid); }
  }
  taxable = Math.max(0, r0(taxable));
  let tax = taxFromSlabs(taxable, cfg.slabs);
  if (taxable <= cfg.rebateUpTo) tax = Math.max(0, tax - cfg.rebateMax);
  const cess = (tax * st.tds.cessRate) / 100;
  breakdown.taxable = taxable; breakdown.taxBeforeCess = r0(tax); breakdown.cess = r0(cess);
  return { regime, taxable, tax: st.tds.enabled ? r0(tax + cess) : 0, breakdown };
}

export function declarationFor(app: App, employeeId: string, fy: string): Declaration | null {
  return app.db.get<Declaration>('SELECT regime, s80c, s80d, s80ccd1b, home_loan_interest, rent_paid_monthly, metro, other_income FROM tax_declarations WHERE employee_id = ? AND fiscal_year = ?', [employeeId, fy]) || null;
}

// ---------- Attendance for a month ----------
export interface MonthAttendance { workingDays: number; presentDays: number; paidLeaveDays: number; lopDays: number; noRecordDays: number }

export function monthAttendance(app: App, employee: Employee, month: string): MonthAttendance {
  const [y, m] = month.split('-').map(Number);
  const shift = shiftByCode(app.db, employee.shift_code);
  const holidays = holidaySet(app.db);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = localDateString(new Date());
  let workingDays = 0;
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (!isWorkingDay(fromLocal(y, m, d, 12, 0), shift, holidays)) continue;
    workingDays++; dates.push(date);
  }
  const present = app.db.all<{ date: string; day_value: number }>('SELECT date, day_value FROM attendance WHERE employee_id = ? AND date LIKE ? AND check_in IS NOT NULL', [employee.id, `${month}-%`]);
  const presentMap = new Map(present.map((p) => [p.date, p.day_value ?? 1]));
  const leaves = app.db.all<{ from_date: string; to_date: string }>("SELECT from_date, to_date FROM leave_requests WHERE employee_id = ? AND status = 'approved' AND from_date <= ? AND to_date >= ?", [employee.id, `${month}-${String(daysInMonth).padStart(2, '0')}`, `${month}-01`]);
  const onLeave = (date: string) => leaves.some((l) => l.from_date <= date && l.to_date >= date);
  // During roll-out many days simply have no record. The policy decides whether those are paid (default) or loss of pay.
  const missingIsPresent = getSetting(app.db, 'payroll').treatMissingAsPresent;
  let presentDays = 0, paidLeaveDays = 0, lopDays = 0, noRecordDays = 0;
  for (const date of dates) {
    if (presentMap.has(date)) { presentDays += presentMap.get(date)!; continue; }
    if (onLeave(date)) { paidLeaveDays++; continue; }
    if (date > today) continue; // future days in an open month are neither present nor absent
    noRecordDays++;
    if (missingIsPresent) presentDays++; else lopDays++;
  }
  return { workingDays, presentDays: r2(presentDays), paidLeaveDays, lopDays, noRecordDays };
}

// ---------- Payslip computation ----------
export interface ComputedSlip { employee: Employee; structure: SalaryStructure; attendance: MonthAttendance; earnings: Money; deductions: Money; employer: Money; gross: number; totalDeductions: number; net: number; note: string }

export function computeSlip(app: App, employee: Employee, month: string, opts: { structure?: SalaryStructure; attendance?: MonthAttendance } = {}): ComputedSlip | null {
  const structure = opts.structure || currentStructure(app, employee.id, `${month}-28`);
  if (!structure) return null;
  const st = getSetting(app.db, 'statutory');
  const att = opts.attendance || monthAttendance(app, employee, month);
  const payableDays = Math.max(0, att.workingDays - att.lopDays);
  const factor = att.workingDays ? payableDays / att.workingDays : 1;
  const base: Money = { Basic: structure.basic, HRA: structure.hra, Conveyance: structure.conveyance, 'Special allowance': structure.special, ...parseMoney(structure.other_earnings) };
  const earnings: Money = {};
  for (const [k, v] of Object.entries(base)) if (v) earnings[k] = r0(v * factor);
  const gross = sum(earnings);
  const basicForMonth = earnings.Basic || 0;

  const deductions: Money = {}; const employer: Money = {};
  const pf = structure.pf_applicable ? pfAmounts(basicForMonth, st, structure.pf_on_full_basic === 1) : { employee: 0, employer: 0, eps: 0, admin: 0, edli: 0 };
  if (pf.employee) { deductions['Provident fund'] = pf.employee; employer['PF (employer)'] = pf.employer; employer['Pension (EPS)'] = pf.eps; employer['PF admin'] = pf.admin; employer['EDLI'] = pf.edli; }
  const esi = structure.esi_applicable ? esiAmounts(gross, st) : { employee: 0, employer: 0, eligible: false };
  if (esi.employee) { deductions['ESI'] = esi.employee; employer['ESI (employer)'] = esi.employer; }
  const pt = structure.pt_applicable ? ptAmount(gross, st, employee.gender || '', month) : 0;
  if (pt) deductions['Professional tax'] = pt;

  if (st.tds.enabled) {
    const fy = `FY${month.slice(2, 4)}-${String(Number(month.slice(2, 4)) + 1).padStart(2, '0')}`;
    const fyStart = Number(month.slice(5, 7)) >= 4 ? month.slice(0, 4) : String(Number(month.slice(0, 4)) - 1);
    const fyLabel = `FY${fyStart.slice(2)}-${String(Number(fyStart.slice(2)) + 1).padStart(2, '0')}`;
    const dec = declarationFor(app, employee.id, fyLabel) || declarationFor(app, employee.id, fy);
    const annualGross = sum(base) * 12;
    const tax = annualTax(app, { annualGross, annualBasic: structure.basic * 12, annualHra: structure.hra * 12, declaration: dec, ptPaid: pt * 12 });
    const monthly = r0(tax.tax / 12);
    if (monthly > 0) deductions['Income tax (TDS)'] = monthly;
  }

  const totalDeductions = sum(deductions);
  const note = !st.verifiedByCa ? 'Statutory rates not yet confirmed by the CA (Settings → Statutory).' : '';
  return { employee, structure, attendance: att, earnings, deductions, employer, gross, totalDeductions, net: r2(gross - totalDeductions), note };
}

// ---------- Runs ----------
export function listRuns(app: App, limit = 24): PayrollRun[] {
  return app.db.all<PayrollRun>('SELECT r.*, e.full_name AS approver_name FROM payroll_runs r LEFT JOIN employees e ON e.id = r.approved_by ORDER BY r.month DESC LIMIT ?', [limit]);
}
export function getRun(app: App, id: string): PayrollRun | undefined { return app.db.get<PayrollRun>('SELECT r.*, e.full_name AS approver_name FROM payroll_runs r LEFT JOIN employees e ON e.id = r.approved_by WHERE r.id = ?', [id]); }
export function runForMonth(app: App, month: string): PayrollRun | undefined { return app.db.get<PayrollRun>('SELECT * FROM payroll_runs WHERE month = ?', [month]); }
export function slipsOf(app: App, runId: string): Payslip[] {
  return app.db.all<Payslip>('SELECT p.*, e.full_name AS employee_name, e.designation, e.department_id, d.name AS department FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id WHERE p.run_id = ? ORDER BY e.department_id, e.full_name', [runId]);
}
export function payslipsFor(app: App, employeeId: string, limit = 24): Payslip[] {
  return app.db.all<Payslip>("SELECT p.*, r.status AS run_status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('approved','paid') ORDER BY p.month DESC LIMIT ?", [employeeId, limit]);
}
export function getPayslip(app: App, id: string): Payslip | undefined {
  return app.db.get<Payslip>('SELECT p.*, e.full_name AS employee_name, e.designation, e.department_id, d.name AS department, r.status AS run_status FROM payslips p JOIN employees e ON e.id = p.employee_id LEFT JOIN departments d ON d.id = e.department_id JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', [id]);
}

/** Create or recalculate a draft run for a month. Approved or paid runs are never touched. */
export function buildRun(app: App, actor: Employee, month: string): { run: PayrollRun; skipped: { name: string; reason: string }[] } {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, 'Pick a month, e.g. 2026-11.');
  const existing = runForMonth(app, month);
  if (existing && existing.status !== 'draft') throw new HttpError(400, `Payroll for ${month} is already ${existing.status} and cannot be recalculated.`);
  const nowIso = new Date().toISOString();
  const id = existing?.id || app.db.nextId('PAY', 100);
  const skipped: { name: string; reason: string }[] = [];
  let gross = 0, deductions = 0, net = 0, employerCost = 0, headcount = 0;
  app.db.transaction(() => {
    if (!existing) app.db.run('INSERT INTO payroll_runs (id, month, status, created_by, created_at) VALUES (?, ?, ?, ?, ?)', [id, month, 'draft', actor.id, nowIso]);
    app.db.run('DELETE FROM payslips WHERE run_id = ?', [id]);
    for (const e of listEmployees(app.db, { status: 'active' })) {
      const slip = computeSlip(app, e, month);
      if (!slip) { skipped.push({ name: e.full_name, reason: 'No salary structure' }); continue; }
      const slipId = `${id}-${e.id}`;
      app.db.run(`INSERT INTO payslips (id, run_id, employee_id, month, working_days, present_days, paid_leave_days, lop_days, earnings, deductions, employer, gross, total_deductions, net, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [slipId, id, e.id, month, slip.attendance.workingDays, slip.attendance.presentDays, slip.attendance.paidLeaveDays, slip.attendance.lopDays,
          JSON.stringify(slip.earnings), JSON.stringify(slip.deductions), JSON.stringify(slip.employer), slip.gross, slip.totalDeductions, slip.net, slip.note, nowIso]);
      gross += slip.gross; deductions += slip.totalDeductions; net += slip.net; employerCost += slip.gross + sum(slip.employer); headcount++;
    }
    app.db.run('UPDATE payroll_runs SET gross = ?, deductions = ?, net = ?, employer_cost = ?, headcount = ?, created_at = ? WHERE id = ?', [r2(gross), r2(deductions), r2(net), r2(employerCost), headcount, nowIso, id]);
  });
  audit(app.db, { entity: 'payroll', entityId: id, action: existing ? 'recalculate' : 'create', actorId: actor.id, after: { month, headcount, net: r2(net) } });
  return { run: getRun(app, id)!, skipped };
}

export function approveRun(app: App, actor: Employee, id: string): PayrollRun {
  const run = getRun(app, id); if (!run) throw new HttpError(404, 'Payroll run not found');
  if (run.status !== 'draft') throw new HttpError(400, 'Only a draft run can be approved.');
  if (!run.headcount) throw new HttpError(400, 'This run has no payslips.');
  app.db.run("UPDATE payroll_runs SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ?", [actor.id, new Date().toISOString(), id]);
  audit(app.db, { entity: 'payroll', entityId: id, action: 'approve', actorId: actor.id, after: { net: run.net } });
  for (const s of slipsOf(app, id)) app.notify.send({ employeeId: s.employee_id, title: `Payslip for ${run.month} is ready`, body: `Net pay ₹${Math.round(s.net).toLocaleString('en-IN')}`, link: `/me/payslips`, kind: 'success' });
  return getRun(app, id)!;
}

export function markPaid(app: App, actor: Employee, id: string): PayrollRun {
  const run = getRun(app, id); if (!run) throw new HttpError(404, 'Payroll run not found');
  if (run.status !== 'approved') throw new HttpError(400, 'Approve the run before marking it paid.');
  app.db.run("UPDATE payroll_runs SET status = 'paid', paid_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  audit(app.db, { entity: 'payroll', entityId: id, action: 'paid', actorId: actor.id });
  return getRun(app, id)!;
}

export function reopenRun(app: App, actor: Employee, id: string, reason: string): PayrollRun {
  const run = getRun(app, id); if (!run) throw new HttpError(404, 'Payroll run not found');
  if (run.status === 'paid') throw new HttpError(400, 'A paid run cannot be reopened; make the correction in the next month.');
  if (!reason.trim()) throw new HttpError(400, 'Give a reason for reopening the run.');
  app.db.run("UPDATE payroll_runs SET status = 'draft', approved_by = NULL, approved_at = NULL, notes = ? WHERE id = ?", [`Reopened by ${actor.full_name}: ${reason.trim()}`, id]);
  audit(app.db, { entity: 'payroll', entityId: id, action: 'reopen', actorId: actor.id, after: { reason } });
  return getRun(app, id)!;
}

/** Statutory totals for the month: what has to be filed and paid. */
export function statutoryTotals(app: App, runId: string): { pfEmployee: number; pfEmployer: number; eps: number; pfAdmin: number; edli: number; esiEmployee: number; esiEmployer: number; pt: number; tds: number; totalPf: number; totalEsi: number } {
  const slips = slipsOf(app, runId);
  const t = { pfEmployee: 0, pfEmployer: 0, eps: 0, pfAdmin: 0, edli: 0, esiEmployee: 0, esiEmployer: 0, pt: 0, tds: 0, totalPf: 0, totalEsi: 0 };
  for (const s of slips) {
    const d = parseMoney(s.deductions), e = parseMoney(s.employer);
    t.pfEmployee += d['Provident fund'] || 0; t.esiEmployee += d['ESI'] || 0; t.pt += d['Professional tax'] || 0; t.tds += d['Income tax (TDS)'] || 0;
    t.pfEmployer += e['PF (employer)'] || 0; t.eps += e['Pension (EPS)'] || 0; t.pfAdmin += e['PF admin'] || 0; t.edli += e['EDLI'] || 0; t.esiEmployer += e['ESI (employer)'] || 0;
  }
  t.totalPf = r2(t.pfEmployee + t.pfEmployer + t.eps + t.pfAdmin + t.edli);
  t.totalEsi = r2(t.esiEmployee + t.esiEmployer);
  for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = r2(t[k]);
  return t;
}

/** Bank transfer file (NEFT style CSV) for an approved run. */
export function bankFile(app: App, runId: string): string {
  const run = getRun(app, runId); if (!run) throw new HttpError(404, 'Run not found');
  const rows = [['Beneficiary name', 'Account number', 'IFSC', 'Amount', 'Narration']];
  for (const s of slipsOf(app, runId)) {
    const st = currentStructure(app, s.employee_id, `${s.month}-28`);
    rows.push([s.employee_name || s.employee_id, st?.bank_account || '', st?.bank_ifsc || '', String(Math.round(s.net)), `Salary ${s.month}`]);
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
}

export function fyOf(month: string): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `FY${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

/** Year-to-date totals per employee, for Form 16 part B preparation. */
export function ytd(app: App, employeeId: string, fy: string): { months: number; gross: number; pf: number; pt: number; tds: number; esi: number; net: number } {
  const startYear = 2000 + Number(fy.slice(2, 4));
  const rows = app.db.all<Payslip>("SELECT p.* FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('approved','paid') AND p.month >= ? AND p.month <= ?", [employeeId, `${startYear}-04`, `${startYear + 1}-03`]);
  const t = { months: rows.length, gross: 0, pf: 0, pt: 0, tds: 0, esi: 0, net: 0 };
  for (const s of rows) { const d = parseMoney(s.deductions); t.gross += s.gross; t.net += s.net; t.pf += d['Provident fund'] || 0; t.pt += d['Professional tax'] || 0; t.tds += d['Income tax (TDS)'] || 0; t.esi += d['ESI'] || 0; }
  for (const k of ['gross', 'pf', 'pt', 'tds', 'esi', 'net'] as const) t[k] = r2(t[k]);
  return t;
}

export { r0, r2, addDays, toLocal };
