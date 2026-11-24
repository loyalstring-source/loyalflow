import { html, when, type Raw, type HtmlValue } from '../../lib/html.ts';
import { page, modal, publicPage, type View } from '../layout.ts';
import { icon, pill, empty, statCard, field, input, textarea, select, button, table, notice, bar, avatar } from '../components.ts';
import type { PayrollRun, Payslip, SalaryStructure, Money, Declaration } from '../../modules/hr/payroll.ts';
import { parseMoney, sum, fyOf } from '../../modules/hr/payroll.ts';
import type { Employee, Department } from '../../modules/people/model.ts';
import { fmtDate, fmtDateTime, inr } from '../../lib/time.ts';
import { can } from '../../lib/scope.ts';

const money = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const RUN_LABEL: Record<string, string> = { draft: 'Draft', approved: 'Approved', paid: 'Paid' };
const runPill = (st: string) => pill(RUN_LABEL[st] || st, st === 'paid' ? 'good' : st === 'approved' ? 'accent' : 'warn');

export function monthName(m: string): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

export interface PayrollData { runs: PayrollRun[]; months: string[]; canRun: boolean; verified: boolean; missingStructures: Employee[]; thisMonth: string }

export function payrollPage(v: View, d: PayrollData): Raw {
  return page(v, { title: 'Payroll', subtitle: 'Monthly salary runs with PF, ESI, professional tax and TDS. Attendance and approved leave decide the payable days.',
    actions: html`${button('Salary structures', { href: '/payroll/salaries', kind: 'ghost', icon: 'people' })}${when(d.canRun, () => button('New run', { modal: '/payroll/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`
      ${when(!d.verified, () => notice('warn', html`<b>Statutory rates are not confirmed yet.</b> PF, ESI, professional tax and income-tax slabs come with sensible defaults, but your CA must confirm them in ${!can(v.app.db, v.user, 'settings.admin') ? 'Settings → Statutory (an administrator opens it)' : html`<a href="/settings?section=statutory">Settings → Statutory</a>`} before the first live payroll. Until then every payslip carries a note.`))}
      ${when(d.missingStructures.length, () => notice('accent', html`<b>${d.missingStructures.length} active ${d.missingStructures.length === 1 ? 'employee has' : 'employees have'} no salary structure</b> and will be skipped: ${d.missingStructures.slice(0, 6).map((e) => e.full_name).join(', ')}${when(d.missingStructures.length > 6, '…')}. <a href="/payroll/salaries">Add them</a>.`))}
      <section class="card">${table(['Month', 'Status', 'People', 'Gross', 'Deductions', 'Net pay', 'Employer cost', ''], d.runs.map((r) => [html`<a href="/payroll/${r.id}"><b>${monthName(r.month)}</b></a>`,
        runPill(r.status), r.headcount, money(r.gross), money(r.deductions), html`<b class="num">${money(r.net)}</b>`, money(r.employer_cost),
        html`<a class="btn btn-sm" href="/payroll/${r.id}">Open</a>`]), { emptyText: 'No payroll runs yet. Create one for this month to see what it would pay.' })}</section>
      <p class="xs faint">A run is a draft until approved: recalculate it as often as you like. Approving it publishes payslips to each person's self-service page. Marking it paid locks it.</p>` });
}

export function newRunModal(v: View, o: { months: string[]; suggested: string }): Raw {
  return modal({ title: 'New payroll run', body: html`<form class="form" data-ajax action="/payroll">
    ${field('Month', select('month', o.months.map((m) => ({ value: m, label: monthName(m), selected: m === o.suggested }))), 'Attendance up to today is used; a part-month can be recalculated later.')}
    <div class="row between"><span class="small muted">Creates a draft. Nothing is paid or published until you approve it.</span><button class="btn btn-primary" type="submit">Build draft</button></div></form>` });
}

export interface RunDetail { run: PayrollRun; slips: Payslip[]; statutory: ReturnType<typeof import('../../modules/hr/payroll.ts').statutoryTotals>; canRun: boolean; canApprove: boolean; departments: Department[]; skipped: { name: string; reason: string }[]; verified: boolean }

export function runPage(v: View, d: RunDetail): Raw {
  const r = d.run;
  const lop = d.slips.filter((s) => s.lop_days > 0);
  return page(v, { title: `Payroll · ${monthName(r.month)}`, docTitle: `Payroll ${r.month}`,
    subtitle: html`${runPill(r.status)} ${r.headcount} people · net <b class="num">${money(r.net)}</b> · employer cost ${money(r.employer_cost)}${when(r.approved_at, () => html` · approved by ${r.approver_name} ${fmtDateTime(r.approved_at)}`)}`,
    actions: html`${button('All runs', { href: '/payroll', kind: 'ghost' })}${button('Register', { href: `/exports/payroll-${r.id}.xlsx`, icon: 'download' })}
      ${when(r.status !== 'draft', () => button('Bank file', { href: `/payroll/${r.id}/bank.csv`, icon: 'download', title: 'NEFT transfer file' }))}
      ${when(d.canRun && r.status === 'draft', () => button('Recalculate', { post: `/payroll/${r.id}/build`, icon: 'bolt' }))}
      ${when(d.canApprove && r.status === 'draft', () => button('Approve', { post: `/payroll/${r.id}/approve`, kind: 'good', icon: 'check', confirm: `Approve payroll for ${monthName(r.month)}? Payslips become visible to all ${r.headcount} employees.` }))}
      ${when(d.canApprove && r.status === 'approved', () => html`${button('Mark paid', { post: `/payroll/${r.id}/paid`, kind: 'primary', confirm: 'Mark this run as paid? It can no longer be changed.' })}${button('Reopen', { post: `/payroll/${r.id}/reopen`, prompt: 'Why is the run being reopened?', promptKey: 'reason' })}`)}`,
    body: html`
      ${when(!d.verified, () => notice('warn', html`Statutory rates still need the CA's confirmation — see ${!can(v.app.db, v.user, 'settings.admin') ? 'Settings → Statutory (an administrator can open it)' : html`<a href="/settings?section=statutory">Settings → Statutory</a>`}.`))}
      <div class="grid grid-4">${statCard({ value: money(r.gross), label: 'Gross earnings', tone: 'neutral' })}${statCard({ value: money(r.deductions), label: 'Deductions', tone: 'neutral', sub: 'PF, ESI, PT, TDS' })}${statCard({ value: money(r.net), label: 'Net pay', tone: 'accent', sub: `${r.headcount} people` })}${statCard({ value: money(r.employer_cost), label: 'Total employer cost', tone: 'neutral', sub: 'gross + employer contributions' })}</div>
      <div class="cols"><section class="card col-main"><div class="card-head"><h2>Payslips</h2><span class="small muted">${lop.length ? `${lop.length} with loss of pay` : 'no loss of pay this month'}</span></div>
        ${table(['Employee', 'Days', 'Gross', 'PF', 'ESI', 'PT', 'TDS', 'Net'], d.slips.map((s) => { const ded = parseMoney(s.deductions); return [
          html`<a href="/payroll/slip/${s.id}"><b>${s.employee_name}</b></a><br><span class="xs muted">${s.designation}</span>`,
          html`${s.present_days + s.paid_leave_days}/${s.working_days}${when(s.lop_days, () => html` <span class="c-crit">· ${s.lop_days} LOP</span>`)}`,
          money(s.gross), ded['Provident fund'] ? money(ded['Provident fund']) : '—', ded['ESI'] ? money(ded['ESI']) : '—', ded['Professional tax'] ? money(ded['Professional tax']) : '—', ded['Income tax (TDS)'] ? money(ded['Income tax (TDS)']) : '—',
          html`<b class="num">${money(s.net)}</b>`]; }), { emptyText: 'No payslips. Recalculate the run.' })}</section>
        <section class="card col-side"><h2>Statutory for ${monthName(r.month)}</h2><p class="small muted" style="margin:4px 0 10px">What has to be deposited and filed.</p>
          ${table(['Head', 'Amount'], [
            ['PF — employee (12%)', money(d.statutory.pfEmployee)], ['PF — employer', money(d.statutory.pfEmployer)], ['Pension (EPS)', money(d.statutory.eps)], ['PF admin + EDLI', money(d.statutory.pfAdmin + d.statutory.edli)],
            [html`<b>Total PF challan</b>`, html`<b class="num">${money(d.statutory.totalPf)}</b>`],
            ['ESI — employee', money(d.statutory.esiEmployee)], ['ESI — employer', money(d.statutory.esiEmployer)], [html`<b>Total ESI challan</b>`, html`<b class="num">${money(d.statutory.totalEsi)}</b>`],
            ['Professional tax', money(d.statutory.pt)], ['TDS (section 192)', money(d.statutory.tds)]])}
          <p class="xs faint" style="margin-top:8px">Due dates: PF and ESI by the 15th of next month, PT per the state schedule, TDS by the 7th. LoyalFlow does not file returns; it gives you the figures.</p></section></div>` });
}

export function payslipPage(v: View, o: { slip: Payslip; employee: Employee; self: boolean; company: string; ytd?: { months: number; gross: number; pf: number; pt: number; tds: number; esi: number; net: number } }): Raw {
  const s = o.slip, earnings = parseMoney(s.earnings), deductions = parseMoney(s.deductions), employer = parseMoney(s.employer);
  const earnRows: HtmlValue[][] = Object.entries(earnings).map(([k, val]) => [k, money(val)]);
  earnRows.push([html`<b>Gross</b>`, html`<b class="num">${money(s.gross)}</b>`]);
  const dedRows: HtmlValue[][] = Object.entries(deductions).map(([k, val]) => [k, money(val)]);
  dedRows.push([html`<b>Total</b>`, html`<b class="num">${money(s.total_deductions)}</b>`]);
  const body = html`<div class="payslip card" style="max-width:800px;margin:0 auto">
    <div class="row between" style="align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:14px">
      <div><h2 style="font-size:20px">${o.company}</h2><span class="small muted">Payslip for ${monthName(s.month)}</span></div>
      <div style="text-align:right"><b style="font-size:22px">${money(s.net)}</b><br><span class="small muted">net pay</span>${when(s.run_status !== 'paid', () => html`<br>${pill(s.run_status === 'approved' ? 'Approved, not yet paid' : 'Draft', s.run_status === 'approved' ? 'accent' : 'warn')}`)}</div>
    </div>
    <div class="kv" style="margin-top:16px"><div><span>Employee</span><b>${o.employee.full_name}</b><span class="small">${o.employee.id}</span></div><div><span>Designation</span><b>${o.employee.designation}</b></div><div><span>Department</span><b>${o.slip.department || o.employee.department_id}</b></div>
      <div><span>Working days</span><b>${s.working_days}</b></div><div><span>Paid days</span><b>${s.present_days + s.paid_leave_days}</b><span class="small">${s.paid_leave_days} on leave</span></div><div><span>Loss of pay</span><b class="${s.lop_days ? 'c-crit' : ''}">${s.lop_days}</b></div></div>
    <div class="grid grid-2" style="margin-top:18px;align-items:start">
      <div><h3>Earnings</h3>${table(['Head', 'Amount'], earnRows)}</div>
      <div><h3>Deductions</h3>${Object.keys(deductions).length ? table(['Head', 'Amount'], dedRows) : empty('No deductions', '·')}</div>
    </div>
    <div class="notice notice-good" style="margin-top:16px"><div><b>Net pay ${money(s.net)}</b><br><span class="small">${inr(s.net)} — ${numberToWords(Math.round(s.net))} rupees only</span></div></div>
    ${when(Object.keys(employer).length, () => html`<details style="margin-top:14px"><summary class="small muted" style="cursor:pointer">Employer contributions (not deducted from you)</summary>${table(['Head', 'Amount'], Object.entries(employer).map(([k, val]) => [k, money(val)]))}</details>`)}
    ${when(o.ytd, () => html`<details style="margin-top:8px"><summary class="small muted" style="cursor:pointer">Year to date (${fyOf(s.month)})</summary>${table(['Head', 'Amount'], [['Months paid', String(o.ytd!.months)], ['Gross', money(o.ytd!.gross)], ['PF', money(o.ytd!.pf)], ['Professional tax', money(o.ytd!.pt)], ['TDS', money(o.ytd!.tds)], ['Net', money(o.ytd!.net)]])}</details>`)}
    ${when(s.note, () => html`<p class="xs faint" style="margin-top:12px">${s.note}</p>`)}
    <p class="xs faint" style="margin-top:12px">This payslip is generated by LoyalFlow and is valid without a signature.</p>
  </div>`;
  return page(v, { title: `Payslip · ${monthName(s.month)}`, docTitle: `Payslip ${s.month}`, subtitle: o.self ? 'Your payslip' : o.employee.full_name,
    actions: html`${button(o.self ? 'My payslips' : 'Back to run', { href: o.self ? '/me/payslips' : `/payroll/${s.run_id}`, kind: 'ghost' })}${button('Print / save as PDF', { href: `/payroll/slip/${s.id}?print=1`, icon: 'download' })}`, body });
}

export function payslipPrint(o: { slip: Payslip; employee: Employee; company: string }): Raw {
  const s = o.slip, earnings = parseMoney(s.earnings), deductions = parseMoney(s.deductions);
  const row = (k: string, val: number) => `<tr><td>${k}</td><td style="text-align:right">${money(val)}</td></tr>`;
  return publicPage({ title: `Payslip ${s.month}`, body: html`<div style="max-width:720px;margin:24px auto;padding:28px;background:#fff">
    <div style="display:flex;justify-content:space-between;border-bottom:2px solid #1D1D1F;padding-bottom:12px">
      <div><h2 style="margin:0">${o.company}</h2><span style="color:#6E6E73;font-size:13px">Payslip for ${monthName(s.month)}</span></div>
      <div style="text-align:right"><b style="font-size:20px">${money(s.net)}</b><br><span style="color:#6E6E73;font-size:12px">net pay</span></div></div>
    <table style="width:100%;margin-top:16px;font-size:13px"><tr><td>Employee</td><td><b>${o.employee.full_name}</b> (${o.employee.id})</td><td>Designation</td><td>${o.employee.designation}</td></tr>
      <tr><td>Working days</td><td>${s.working_days}</td><td>Paid days</td><td>${s.present_days + s.paid_leave_days}${s.lop_days ? ` (LOP ${s.lop_days})` : ''}</td></tr></table>
    <div style="display:flex;gap:24px;margin-top:18px"><div style="flex:1"><h3>Earnings</h3><table style="width:100%;font-size:13px">${o.slip && Object.entries(earnings).map(([k, val]) => row(k, val)).join('')}<tr><td><b>Gross</b></td><td style="text-align:right"><b>${money(s.gross)}</b></td></tr></table></div>
      <div style="flex:1"><h3>Deductions</h3><table style="width:100%;font-size:13px">${Object.entries(deductions).map(([k, val]) => row(k, val)).join('')}<tr><td><b>Total</b></td><td style="text-align:right"><b>${money(s.total_deductions)}</b></td></tr></table></div></div>
    <p style="margin-top:18px;padding:12px;background:#E3F3EA;border-radius:8px"><b>Net pay ${money(s.net)}</b> — ${numberToWords(Math.round(s.net))} rupees only</p>
    <p style="color:#86868B;font-size:11px">Generated by LoyalFlow. Valid without a signature.</p>
    <script>window.onload = function(){ window.print(); };</script></div>` });
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function twoDigits(n: number): string { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? '-' + ONES[n % 10] : ''}`; }
export function numberToWords(n: number): string {
  if (n === 0) return 'zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = Math.floor(n / 100); n %= 100;
  if (crore) parts.push(`${twoDigits(crore)} crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`);
  if (hundred) parts.push(`${ONES[hundred]} hundred`);
  if (n) parts.push(twoDigits(n));
  return parts.join(' ');
}

export function salariesPage(v: View, o: { structures: SalaryStructure[]; missing: Employee[]; canEdit: boolean }): Raw {
  return page(v, { title: 'Salary structures', subtitle: 'One structure per employee, effective from a date. Changing a salary adds a new row; history is kept.',
    actions: html`${button('Payroll', { href: '/payroll', kind: 'ghost' })}${when(o.canEdit, () => button('Set a salary', { modal: '/payroll/salaries/new', kind: 'primary', icon: 'plus' }))}`,
    body: html`${when(o.missing.length, () => notice('warn', html`<b>No salary set for ${o.missing.length}:</b> ${o.missing.map((e) => html`<a href="/payroll/salaries/new?employee=${e.id}">${e.full_name}</a>`).reduce((a: Raw[], b, i) => (i ? [...a, html`, `, b] : [b]), [] as Raw[])}`))}
      <section class="card">${table(['Employee', 'Effective', 'Monthly gross', 'Basic', 'HRA', 'CTC (annual)', 'PF', 'ESI', ''], o.structures.map((s) => { const monthly = s.basic + s.hra + s.conveyance + s.special + sum(parseMoney(s.other_earnings)); return [
        html`<b>${s.employee_name}</b>`, fmtDate(s.effective_from), html`<b class="num">${money(monthly)}</b>`, money(s.basic), money(s.hra), money(s.ctc_annual),
        s.pf_applicable ? pill('Yes', 'good') : pill('No', 'ink'), s.esi_applicable ? pill('Auto', 'accent') : pill('No', 'ink'),
        when(o.canEdit, () => html`<span class="row" style="gap:4px">${button('Revise', { modal: `/payroll/salaries/new?employee=${s.employee_id}`, size: 'sm' })}${button('History', { href: `/payroll/salaries/${s.employee_id}`, size: 'sm', kind: 'ghost' })}</span>`)]; }), { emptyText: 'No salary structures yet.' })}</section>` });
}

export function salaryModal(v: View, o: { employees: Employee[]; selected?: string; current?: SalaryStructure | null }): Raw {
  const c = o.current;
  return modal({ title: c ? `Revise salary · ${o.employees.find((e) => e.id === o.selected)?.full_name || ''}` : 'Set a salary', body: html`<form class="form" data-ajax action="/payroll/salaries">
    <div class="grid grid-2">${field('Employee', select('employeeId', o.employees.map((e) => ({ value: e.id, label: `${e.full_name} · ${e.designation}`, selected: e.id === o.selected }))))}${field('Effective from', input('effectiveFrom', { type: 'date', required: true, value: new Date().toISOString().slice(0, 8) + '01' }))}</div>
    ${field('Annual CTC (₹)', input('ctcAnnual', { type: 'number', min: 0, step: 1000, value: c?.ctc_annual || '', id: 'ctc-field' }), 'Fill this and the split below is suggested: 50% basic, 40% of basic as HRA, the rest special allowance. Adjust as you like.')}
    <div class="grid grid-4">${field('Basic (monthly)', input('basic', { type: 'number', min: 0, required: true, value: c?.basic || '' }))}${field('HRA', input('hra', { type: 'number', min: 0, value: c?.hra || '' }))}${field('Conveyance', input('conveyance', { type: 'number', min: 0, value: c?.conveyance ?? 1600 }))}${field('Special allowance', input('special', { type: 'number', min: 0, value: c?.special || '' }))}</div>
    <div class="grid grid-3">${field('Provident fund', select('pfApplicable', [{ value: '1', label: 'Applicable', selected: c ? !!c.pf_applicable : true }, { value: '0', label: 'Not applicable', selected: c ? !c.pf_applicable : false }]))}${field('PF on', select('pfOnFullBasic', [{ value: '0', label: `Up to the ceiling (₹15,000)`, selected: c ? !c.pf_on_full_basic : true }, { value: '1', label: 'Full basic', selected: !!c?.pf_on_full_basic }]))}${field('ESI', select('esiApplicable', [{ value: '1', label: 'Automatic (gross ≤ ceiling)', selected: c ? !!c.esi_applicable : true }, { value: '0', label: 'Not applicable', selected: c ? !c.esi_applicable : false }]))}</div>
    <div class="grid grid-3">${field('Bank account', input('bankAccount', { value: c?.bank_account || '' }))}${field('IFSC', input('bankIfsc', { value: c?.bank_ifsc || '' }))}${field('PAN', input('pan', { value: c?.pan || '', placeholder: 'ABCDE1234F' }))}</div>
    <div class="grid grid-2">${field('UAN (PF)', input('uan', { value: c?.uan || '' }))}${field('ESIC number', input('esicNumber', { value: c?.esic_number || '' }))}</div>
    <div class="row between"><span class="small muted">Saved as a new effective-dated row; earlier payslips are unaffected.</span><button class="btn btn-primary" type="submit">Save salary</button></div></form>
    <script>(function(){var c=document.getElementById('ctc-field');if(!c)return;c.addEventListener('change',function(){var a=Number(c.value)||0;if(!a)return;var m=a/12,b=Math.round(m*0.5),h=Math.round(b*0.4),cv=Math.min(1600,Math.round(m*0.05));var f=c.closest('form');f.querySelector('[name=basic]').value=b;f.querySelector('[name=hra]').value=h;f.querySelector('[name=conveyance]').value=cv;f.querySelector('[name=special]').value=Math.max(0,Math.round(m-b-h-cv));});})();</script>` });
}

export function salaryHistoryPage(v: View, o: { employee: Employee; rows: SalaryStructure[] }): Raw {
  return page(v, { title: `Salary history · ${o.employee.full_name}`, subtitle: o.employee.designation, actions: button('Salary structures', { href: '/payroll/salaries', kind: 'ghost' }),
    body: html`<section class="card">${table(['Effective from', 'Monthly gross', 'Basic', 'HRA', 'Conveyance', 'Special', 'CTC', 'Set on'], o.rows.map((s) => { const m = s.basic + s.hra + s.conveyance + s.special + sum(parseMoney(s.other_earnings)); return [fmtDate(s.effective_from), html`<b class="num">${money(m)}</b>`, money(s.basic), money(s.hra), money(s.conveyance), money(s.special), money(s.ctc_annual), fmtDate(s.created_at)]; }))}</section>` });
}

export function myPayslipsPage(v: View, o: { slips: Payslip[]; declaration: Declaration | null; fy: string; ytd: { months: number; gross: number; pf: number; pt: number; tds: number; esi: number; net: number } }): Raw {
  return page(v, { title: 'My payslips', subtitle: `${o.fy} · ${o.ytd.months} month${o.ytd.months === 1 ? '' : 's'} paid · gross ${money(o.ytd.gross)} · TDS ${money(o.ytd.tds)}`,
    actions: button('Tax declaration', { modal: '/me/tax-declaration', icon: 'file' }),
    body: html`<div class="cols"><section class="card col-main"><h2>Payslips</h2>
      ${table(['Month', 'Paid days', 'Gross', 'Deductions', 'Net', ''], o.slips.map((s) => [monthName(s.month), `${s.present_days + s.paid_leave_days}/${s.working_days}`, money(s.gross), money(s.total_deductions), html`<b class="num">${money(s.net)}</b>`, html`<a class="btn btn-sm" href="/payroll/slip/${s.id}">Open</a>`]), { emptyText: 'No payslips yet. They appear here once HR approves the monthly run.' })}</section>
      <section class="card col-side"><h2>Year to date · ${o.fy}</h2>${table(['Head', 'Amount'], [['Gross earnings', money(o.ytd.gross)], ['Provident fund', money(o.ytd.pf)], ['Professional tax', money(o.ytd.pt)], ['ESI', money(o.ytd.esi)], ['Income tax (TDS)', money(o.ytd.tds)], [html`<b>Net received</b>`, html`<b class="num">${money(o.ytd.net)}</b>`]])}
        <h3 style="margin-top:14px">Tax declaration</h3><p class="small muted">${o.declaration ? html`Regime: <b>${o.declaration.regime === 'old' ? 'Old' : 'New'}</b>${when(o.declaration.regime === 'old', () => html`<br>80C ${money(o.declaration!.s80c)} · 80D ${money(o.declaration!.s80d)}${when(o.declaration!.rent_paid_monthly, () => html` · rent ${money(o.declaration!.rent_paid_monthly)}/month`)}`)}` : 'Not submitted — the new regime is used by default.'}</p>
        ${button('Update declaration', { modal: '/me/tax-declaration', size: 'sm' })}</section></div>` });
}

export function taxDeclarationModal(v: View, o: { declaration: Declaration | null; fy: string; limits: { limit80c: number; limit80d: number; limit80ccd1b: number } }): Raw {
  const d = o.declaration;
  return modal({ title: `Tax declaration · ${o.fy}`, body: html`<form class="form" data-ajax action="/me/tax-declaration">
    ${field('Tax regime', select('regime', [{ value: 'new', label: 'New regime (lower rates, no deductions)', selected: (d?.regime || 'new') === 'new' }, { value: 'old', label: 'Old regime (with 80C, HRA and other deductions)', selected: d?.regime === 'old' }]), 'Only the old regime uses the figures below.')}
    <div class="grid grid-3">${field(`80C (max ${money(o.limits.limit80c)})`, input('s80c', { type: 'number', min: 0, value: d?.s80c || '' }), 'PF, LIC, ELSS, school fees, home-loan principal')}${field(`80D (max ${money(o.limits.limit80d)})`, input('s80d', { type: 'number', min: 0, value: d?.s80d || '' }), 'Health insurance')}${field(`80CCD(1B) (max ${money(o.limits.limit80ccd1b)})`, input('s80ccd1b', { type: 'number', min: 0, value: d?.s80ccd1b || '' }), 'NPS')}</div>
    <div class="grid grid-3">${field('Rent paid per month', input('rentPaidMonthly', { type: 'number', min: 0, value: d?.rent_paid_monthly || '' }), 'For HRA exemption')}${field('City', select('metro', [{ value: '0', label: 'Non-metro (40%)', selected: !d?.metro }, { value: '1', label: 'Metro (50%)', selected: !!d?.metro }]))}${field('Home-loan interest', input('homeLoanInterest', { type: 'number', min: 0, value: d?.home_loan_interest || '' }))}</div>
    ${field('Other income to declare', input('otherIncome', { type: 'number', min: 0, value: d?.other_income || '' }), 'Interest, rent received and so on')}
    <div class="row between"><span class="small muted">Used to work out monthly TDS. Keep your proofs; HR will ask for them before the year ends.</span><button class="btn btn-primary" type="submit">Save declaration</button></div></form>` });
}

export { icon, avatar, bar, textarea };
