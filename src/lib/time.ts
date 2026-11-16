// Time helpers. All business logic runs in IST (UTC+05:30); storage is ISO 8601 UTC strings.

export const IST_OFFSET_MIN = 330;
const MIN = 60_000;

export interface Shift {
  code: string;
  name: string;
  days: number[];      // 1 = Monday ... 7 = Sunday (ISO)
  start: string;       // 'HH:MM' local
  end: string;         // 'HH:MM' local
  overtime?: boolean;
}

export const DEFAULT_SHIFTS: Shift[] = [
  { code: 'GEN', name: 'General', days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' },
  { code: 'DEV', name: 'Development and QA', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' },
  { code: 'SUP', name: 'Technical Support', days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00' },
  { code: 'SAL', name: 'Sales and Pre-sales', days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '18:00' },
  { code: 'PRD', name: 'Production', days: [1, 2, 3, 4, 5, 6], start: '10:00', end: '19:00', overtime: true }
];

export interface LocalParts { y: number; m: number; d: number; hh: number; mm: number; dow: number; minuteOfDay: number }

export function toLocal(date: Date): LocalParts {
  const t = new Date(date.getTime() + IST_OFFSET_MIN * MIN);
  const dow = ((t.getUTCDay() + 6) % 7) + 1; // ISO: Monday = 1
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes(), dow, minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

export function fromLocal(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * MIN);
}

export function localDateString(date: Date): string {
  const p = toLocal(date);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return fromLocal(y, m, d);
}

export function addDays(date: Date, days: number): Date { return new Date(date.getTime() + days * 86_400_000); }

export function startOfLocalDay(date: Date): Date { const p = toLocal(date); return fromLocal(p.y, p.m, p.d); }

/** Monday 00:00 IST of the week containing the date. */
export function weekStart(date: Date): Date {
  const p = toLocal(date);
  const monday = fromLocal(p.y, p.m, p.d);
  return addDays(monday, -(p.dow - 1));
}

/** ISO-8601 week label, e.g. 2026-W45. */
export function isoWeek(date: Date): string {
  const p = toLocal(date);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weekLabelShort(label: string): string { return 'W' + label.split('-W')[1]; }

/** Financial year April to March, e.g. FY26-27 for a date in Nov 2026. */
export function fiscalYear(date: Date): string {
  const p = toLocal(date);
  const start = p.m >= 4 ? p.y : p.y - 1;
  return `FY${String(start).slice(2)}-${String(start + 1).slice(2)}`;
}

export function monthStart(date: Date): Date { const p = toLocal(date); return fromLocal(p.y, p.m, 1); }

function hm(s: string): number { const [h, m] = s.split(':').map(Number); return h * 60 + m; }

export function isWorkingDay(date: Date, shift: Shift, holidays: Set<string>): boolean {
  const p = toLocal(date);
  return shift.days.includes(p.dow) && !holidays.has(localDateString(date));
}

/** Move a timestamp forward by business minutes within the shift's working hours. */
export function addBusinessMinutes(start: Date, minutes: number, shift: Shift, holidays: Set<string> = new Set()): Date {
  const open = hm(shift.start), close = hm(shift.end);
  let remaining = minutes;
  let cursor = new Date(start.getTime());
  for (let guard = 0; guard < 400; guard++) {
    const p = toLocal(cursor);
    const dayStart = fromLocal(p.y, p.m, p.d);
    const working = isWorkingDay(cursor, shift, holidays);
    if (!working || p.minuteOfDay >= close) { cursor = new Date(dayStart.getTime() + 86_400_000 + open * MIN); continue; }
    if (p.minuteOfDay < open) { cursor = new Date(dayStart.getTime() + open * MIN); continue; }
    const available = close - p.minuteOfDay;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * MIN);
    remaining -= available;
    cursor = new Date(dayStart.getTime() + 86_400_000 + open * MIN);
  }
  return cursor;
}

/** Business minutes elapsed between two timestamps under a shift calendar. */
export function businessMinutesBetween(a: Date, b: Date, shift: Shift, holidays: Set<string> = new Set()): number {
  if (b <= a) return 0;
  const open = hm(shift.start), close = hm(shift.end);
  let total = 0;
  let cursor = new Date(a.getTime());
  for (let guard = 0; guard < 400 && cursor < b; guard++) {
    const p = toLocal(cursor);
    const dayStart = fromLocal(p.y, p.m, p.d);
    const next = new Date(dayStart.getTime() + 86_400_000 + open * MIN);
    if (!isWorkingDay(cursor, shift, holidays)) { cursor = next; continue; }
    const from = Math.max(p.minuteOfDay, open);
    const windowEnd = new Date(dayStart.getTime() + close * MIN);
    const until = b < windowEnd ? toLocal(b).minuteOfDay : close;
    if (until > from && b > new Date(dayStart.getTime() + from * MIN)) total += until - from;
    cursor = next;
  }
  return total;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const p = toLocal(typeof iso === 'string' ? new Date(iso) : iso);
  return `${p.d} ${MONTHS[p.m - 1]}`;
}

export function fmtDateFull(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const p = toLocal(typeof iso === 'string' ? new Date(iso) : iso);
  return `${DAYS[p.dow - 1]} ${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const p = toLocal(typeof iso === 'string' ? new Date(iso) : iso);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

/** Human duration from minutes: 38 min, 1:50 h, 2 d. Negative values are prefixed with a minus sign. */
export function fmtDuration(minutes: number): string {
  const neg = minutes < 0; const m = Math.abs(Math.round(minutes));
  const s = m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h` : `${Math.round(m / 1440 * 10) / 10} d`;
  return neg ? `-${s}` : s;
}

export function minutesUntil(iso: string | null | undefined, from: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - from.getTime()) / MIN);
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const da = typeof a === 'string' ? new Date(a) : a, db = typeof b === 'string' ? new Date(b) : b;
  return Math.floor((db.getTime() - da.getTime()) / 86_400_000);
}

export function relativeAge(iso: string, now: Date = new Date()): string {
  const mins = Math.round((now.getTime() - new Date(iso).getTime()) / MIN);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} h ago`;
  const d = Math.floor(mins / 1440);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function inr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)} L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function money(value: number, currency: string): string {
  if (currency === 'INR') return inr(value);
  const sym = currency === 'USD' ? '$' : currency === 'AED' ? 'AED ' : currency + ' ';
  return `${sym}${Math.round(value).toLocaleString('en-US')}`;
}
