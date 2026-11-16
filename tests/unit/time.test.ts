import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addBusinessMinutes, businessMinutesBetween, DEFAULT_SHIFTS, fromLocal, isoWeek, fiscalYear, inr, localDateString, isWorkingDay, fmtDuration, weekStart } from '../../src/lib/time.ts';

const SUP = DEFAULT_SHIFTS.find((s) => s.code === 'SUP')!; // Mon–Sat 10:00–19:00 IST
const DEV = DEFAULT_SHIFTS.find((s) => s.code === 'DEV')!; // Mon–Fri 09:00–18:00 IST

test('business minutes roll over the end of a shift to the next working day', () => {
  // Monday 2 Nov 2026 18:30 IST + 60 business minutes → Tuesday 10:30 IST
  const start = fromLocal(2026, 11, 2, 18, 30);
  const due = addBusinessMinutes(start, 60, SUP, new Set());
  assert.equal(localDateString(due), '2026-11-03');
  assert.equal(due.getTime(), fromLocal(2026, 11, 3, 10, 30).getTime());
});

test('business minutes skip Sunday for support and the weekend for development', () => {
  const sat = fromLocal(2026, 11, 7, 18, 0); // Saturday
  assert.equal(localDateString(addBusinessMinutes(sat, 120, SUP, new Set())), '2026-11-09'); // Monday
  const fri = fromLocal(2026, 11, 6, 17, 30);
  assert.equal(localDateString(addBusinessMinutes(fri, 60, DEV, new Set())), '2026-11-09');
});

test('holidays are skipped', () => {
  const start = fromLocal(2026, 11, 7, 18, 30); // Saturday evening
  const due = addBusinessMinutes(start, 60, SUP, new Set(['2026-11-09']));
  assert.equal(localDateString(due), '2026-11-10');
});

test('a P1 clock that starts before the shift begins at shift start', () => {
  const start = fromLocal(2026, 11, 3, 7, 0);
  const due = addBusinessMinutes(start, 30, SUP, new Set());
  assert.equal(due.getTime(), fromLocal(2026, 11, 3, 10, 30).getTime());
});

test('businessMinutesBetween counts only shift time', () => {
  const a = fromLocal(2026, 11, 2, 18, 0), b = fromLocal(2026, 11, 3, 11, 0);
  assert.equal(businessMinutesBetween(a, b, SUP, new Set()), 120);
  assert.equal(isWorkingDay(fromLocal(2026, 11, 8, 12, 0), SUP, new Set()), false); // Sunday
});

test('ISO week, fiscal year, week start and formatting helpers', () => {
  assert.equal(isoWeek(fromLocal(2026, 11, 2, 12, 0)), '2026-W45');
  assert.equal(isoWeek(fromLocal(2027, 1, 1, 12, 0)), '2026-W53');
  assert.equal(fiscalYear(fromLocal(2026, 11, 2)), 'FY26-27');
  assert.equal(fiscalYear(fromLocal(2027, 2, 2)), 'FY26-27');
  assert.equal(fiscalYear(fromLocal(2027, 4, 2)), 'FY27-28');
  assert.equal(localDateString(weekStart(fromLocal(2026, 11, 5, 12, 0))), '2026-11-02');
  assert.equal(inr(360000), '₹3.6 L');
  assert.equal(inr(11800000), '₹1.18 Cr');
  assert.equal(inr(2500), '₹2,500');
  assert.equal(fmtDuration(38), '38 min');
  assert.equal(fmtDuration(110), '1:50 h');
  assert.equal(fmtDuration(-30), '-30 min');
});
