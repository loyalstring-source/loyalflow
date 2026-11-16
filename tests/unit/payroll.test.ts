// Every statutory figure here was worked out by hand from the slabs in Settings → Statutory
// before it was written down. If a rate changes, these numbers are what must be re-checked with the CA.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, COO } from '../helpers.ts';
import { getSetting } from '../../src/lib/settings.ts';
import { pfWage, pfAmounts, esiAmounts, ptAmount, taxFromSlabs, annualTax, suggestSplit, saveStructure, currentStructure, structureHistory, computeSlip, fyOf } from '../../src/modules/hr/payroll.ts';
import { lateMinutes, dayValue } from '../../src/modules/hr/attendance.ts';
import { probationDue, ratingLabel } from '../../src/modules/hr/appraisal.ts';

const app = testApp();
const st = getSetting(app.db, 'statutory');

describe('provident fund', () => {
  test('is capped at the statutory wage ceiling', () => {
    assert.equal(pfWage(40_000, st, false), 15_000);
    assert.equal(pfWage(12_000, st, false), 12_000);
    assert.equal(pfWage(40_000, st, true), 40_000, 'on full basic when the employee has opted in');
  });
  test('splits the employer share into pension and PF', () => {
    const a = pfAmounts(15_000, st);
    assert.equal(a.employee, 1800, '12% of 15,000');
    assert.equal(a.eps, 1250, '8.33% of 15,000');
    assert.equal(a.employer, 550, 'the rest of the 12%');
    assert.equal(a.employee, a.eps + a.employer, 'both halves are 12%');
    assert.equal(a.admin, 75, '0.5% admin charge');
    assert.equal(a.edli, 75, '0.5% EDLI');
  });
  test('scales down when basic is below the ceiling', () => {
    const a = pfAmounts(10_000, st);
    assert.equal(a.employee, 1200);
    assert.equal(a.eps, 833);
  });
});

describe('employee state insurance', () => {
  test('applies below the gross ceiling', () => {
    const a = esiAmounts(18_000, st);
    assert.ok(a.eligible);
    assert.equal(a.employee, 135, '0.75% of 18,000');
    assert.equal(a.employer, 585, '3.25% of 18,000');
  });
  test('does not apply above the ceiling', () => {
    const a = esiAmounts(25_000, st);
    assert.equal(a.eligible, false);
    assert.equal(a.employee, 0);
    assert.equal(a.employer, 0);
  });
});

describe('Maharashtra professional tax', () => {
  test('follows the slabs for men', () => {
    assert.equal(ptAmount(7_000, st, 'male', '2026-06'), 0);
    assert.equal(ptAmount(9_000, st, 'male', '2026-06'), 175);
    assert.equal(ptAmount(30_000, st, 'male', '2026-06'), 200);
  });
  test('exempts women up to the higher threshold', () => {
    assert.equal(ptAmount(20_000, st, 'female', '2026-06'), 0);
    assert.equal(ptAmount(30_000, st, 'female', '2026-06'), 200);
  });
  test('adds the February top-up', () => {
    assert.equal(ptAmount(30_000, st, 'male', '2026-02'), 300, '200 plus the 100 February extra');
  });
});

describe('income tax', () => {
  test('adds up slab by slab', () => {
    // New regime: nothing to 4L, 5% to 8L, 10% to 12L.
    assert.equal(taxFromSlabs(400_000, st.tds.new.slabs), 0);
    assert.equal(taxFromSlabs(800_000, st.tds.new.slabs), 20_000, '5% of the 4L above the exempt slab');
    assert.equal(taxFromSlabs(1_000_000, st.tds.new.slabs), 40_000, '20,000 plus 10% of 2L');
  });
  test('rebate wipes out the tax for a small salary', () => {
    const r = annualTax(app, { annualGross: 600_000, annualBasic: 300_000, annualHra: 120_000 });
    assert.equal(r.regime, 'new');
    assert.equal(r.tax, 0, 'under 12L after the standard deduction, so section 87A clears it');
  });
  test('charges cess on a larger salary', () => {
    const r = annualTax(app, { annualGross: 2_000_000, annualBasic: 1_000_000, annualHra: 400_000 });
    // 20,00,000 - 75,000 standard deduction = 19,25,000 taxable.
    assert.equal(r.taxable, 1_925_000);
    const base = taxFromSlabs(1_925_000, st.tds.new.slabs);
    assert.equal(r.tax, Math.round(base * 1.04), '4% health and education cess on top');
  });
  test('the old regime counts declared deductions', () => {
    const plain = annualTax(app, { annualGross: 1_200_000, annualBasic: 600_000, annualHra: 240_000, declaration: { regime: 'old', s80c: 0, s80d: 0, s80ccd1b: 0, home_loan_interest: 0, rent_paid_monthly: 0, metro: 0, other_income: 0 } });
    const withDeductions = annualTax(app, { annualGross: 1_200_000, annualBasic: 600_000, annualHra: 240_000, declaration: { regime: 'old', s80c: 150_000, s80d: 25_000, s80ccd1b: 50_000, home_loan_interest: 0, rent_paid_monthly: 0, metro: 0, other_income: 0 } });
    assert.equal(plain.regime, 'old');
    assert.ok(withDeductions.tax < plain.tax, 'deductions must reduce the tax');
    assert.equal(plain.taxable - withDeductions.taxable, 225_000, '80C + 80D + 80CCD(1B)');
  });
});

describe('salary structures', () => {
  test('the suggested split adds up to the CTC', () => {
    const s = suggestSplit(600_000);
    assert.equal(s.basic + s.hra + s.conveyance + s.special, 50_000, 'monthly gross is a twelfth of the CTC');
    assert.equal(s.basic, 25_000, 'half of gross');
    assert.equal(s.hra, 10_000, '40% of basic');
    assert.ok(s.conveyance <= 1600);
  });
  test('a new structure supersedes the old one without erasing it', () => {
    const coo = emp(app, COO); const e = emp(app, 'nikita.kakade@loyalstring.com');
    saveStructure(app, coo, { employeeId: e.id, effectiveFrom: '2026-04-01', ctcAnnual: 420_000, ...suggestSplit(420_000) });
    saveStructure(app, coo, { employeeId: e.id, effectiveFrom: '2026-10-01', ctcAnnual: 462_000, ...suggestSplit(462_000) });
    assert.equal(currentStructure(app, e.id, '2026-05-15')?.ctc_annual, 420_000, 'the old one still applies to an old month');
    assert.equal(currentStructure(app, e.id, '2026-11-15')?.ctc_annual, 462_000);
    assert.equal(structureHistory(app, e.id).length, 2, 'history is kept');
  });
  test('a payslip nets out to gross minus deductions', () => {
    const e = emp(app, 'nikita.kakade@loyalstring.com');
    const slip = computeSlip(app, e, '2026-10');
    assert.ok(slip, 'a structure exists, so there must be a slip');
    assert.equal(Math.round(slip!.net), Math.round(slip!.gross - slip!.totalDeductions));
    assert.ok(slip!.gross > 0);
  });
  test('the financial year runs April to March', () => {
    assert.equal(fyOf('2026-04'), 'FY26-27');
    assert.equal(fyOf('2026-03'), 'FY25-26');
  });
});

describe('attendance arithmetic', () => {
  const who = () => emp(app, 'nikita.kakade@loyalstring.com');
  // 2026-11-02 was a Monday. IST is UTC+5:30, so 09:30 IST is 04:00 UTC.
  const ist = (h: number, m: number) => new Date(Date.UTC(2026, 10, 2, 0, h * 60 + m - 330));
  test('counts minutes late against the shift start', () => {
    const e = who();
    const shiftStart = getSetting(app.db, 'shifts').find((s) => s.code === e.shift_code)!.start;
    const [sh, sm] = shiftStart.split(':').map(Number);
    assert.equal(lateMinutes(app, e, ist(sh, sm)), 0, 'on time');
    assert.equal(lateMinutes(app, e, ist(sh, sm + 25)), 25);
    assert.equal(lateMinutes(app, e, ist(sh - 1, sm)), 0, 'early is not negative');
  });
  test('a very late arrival costs half a day', () => {
    const e = who();
    const shift = getSetting(app.db, 'shifts').find((s) => s.code === e.shift_code)!;
    const [sh, sm] = shift.start.split(':').map(Number);
    const [eh, em] = shift.end.split(':').map(Number);
    assert.equal(dayValue(app, e, ist(sh, sm + 20), ist(eh, em)).value, 1, 'late but a full day worked');
    assert.equal(dayValue(app, e, ist(sh + 5, sm), ist(eh, em)).value, 0.5, 'arrived after the half-day mark');
    assert.equal(dayValue(app, e, ist(sh, sm), ist(eh - 5, em)).value, 0.5, 'left far too early');
    assert.equal(dayValue(app, e, ist(sh, sm + 20), ist(eh, em)).late, 20, 'the late mark is still recorded');
  });
});

describe('probation', () => {
  test('falls due six months after joining', () => {
    assert.equal(probationDue('2026-01-15'), '2026-07-15');
    assert.equal(probationDue('2026-09-10'), '2027-03-10');
  });
  test('ratings read as words', () => {
    assert.equal(ratingLabel(5), 'Outstanding');
    assert.equal(ratingLabel(3), 'Meets');
    assert.equal(ratingLabel(null), '—');
  });
});
