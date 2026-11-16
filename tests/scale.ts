// Scale check: 1,000 employees with a year of attendance and machine punches. Run: node tests/scale.ts
import { startServer, Client, COO, HR, SUPPORT_IC } from './helpers.ts';
import { saveStructure, buildRun } from '../src/modules/hr/payroll.ts';
import { getEmployeeByEmail } from '../src/modules/people/model.ts';
import { ingestPunches, saveDevice, missPunchReport } from '../src/modules/hr/attendance-rules.ts';
import { localDateString, addDays } from '../src/lib/time.ts';

const N = Number(process.argv[2] || 1000);
const s = await startServer(); const app = s.app; const db = app.db;
const coo = getEmployeeByEmail(db, COO)!;
const base = db.all<any>("SELECT * FROM employees WHERE status = 'active'");
const now = new Date().toISOString();
let t = Date.now();
db.exec('BEGIN');
const cols = Object.keys(base[0]);
for (let i = 0; i < N - base.length; i++) {
  const b = { ...base[i % base.length] }; const id = 'X' + String(i).padStart(5, '0');
  b.id = id; b.full_name = b.full_name + ' ' + i; b.email = `x${i}@loyalstring.com`; b.reporting_manager_id = base[i % base.length].id; b.is_admin = 0; if ('device_pin' in b) b.device_pin = String(5000 + i);
  db.run(`INSERT INTO employees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, cols.map((c) => b[c]));
}
const all = db.all<{ id: string }>("SELECT id FROM employees WHERE status = 'active'");
let att = 0, pun = 0;
for (let d = 1; d <= 365; d++) {
  const day = addDays(new Date(), -d); if (day.getUTCDay() === 0) continue; const date = localDateString(day);
  for (const e of all) {
    const late = (d * 7 + e.id.length + att) % 11 === 0 ? 25 : 0;
    const ci = new Date(Date.parse(date + 'T04:00:00Z') + late * 60000).toISOString(); const co = date + 'T13:00:00.000Z';
    db.run("INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, source, status) VALUES (?, ?, ?, ?, 'machine', 'present')", [e.id, date, ci, co]); att++;
    db.run("INSERT OR IGNORE INTO punches (device_sn, pin, employee_id, at, local_date, local_time, source, created_at) VALUES ('SCALE1', ?, ?, ?, ?, '09:30:00', 'push', ?)", [e.id, e.id, ci, date, now]);
    db.run("INSERT OR IGNORE INTO punches (device_sn, pin, employee_id, at, local_date, local_time, source, created_at) VALUES ('SCALE1', ?, ?, ?, ?, '18:30:00', 'push', ?)", [e.id, e.id, co, date, now]); pun += 2;
  }
}
db.exec('COMMIT');
console.log(`seeded ${all.length} employees, ${att} attendance days, ${pun} punches in ${Date.now() - t} ms`);
for (const e of all) { try { saveStructure(app, coo, { employeeId: e.id, effectiveFrom: '2025-01-01', basic: 20000, hra: 8000 } as any); } catch {} }

const time = async (label: string, fn: () => unknown) => { const t0 = performance.now(); let note = ''; try { const r = await fn(); if (r && typeof r === 'object' && 'status' in (r as any)) { const res = r as Response; const body = await res.text(); note = `${res.status} ${(body.length / 1024).toFixed(0)} KB`; } } catch (e) { note = 'ERROR ' + (e as Error).message; } console.log(`${String(Math.round(performance.now() - t0)).padStart(6)} ms  ${label}  ${note}`); };
const c = new Client(s.base); await c.login(COO); const h = new Client(s.base); await h.login(HR); const ic = new Client(s.base); await ic.login(SUPPORT_IC);
for (const p of ['/', '/company', '/analytics', '/people', '/attendance', '/attendance/miss-punch', '/attendance/machine', '/approvals', '/tasks', '/payroll', '/appraisals', '/hire', '/desk', '/pipeline', '/sops', '/settings', '/search?q=prasad']) await time('COO ' + p, () => c.get(p));
for (const p of ['/', '/people', '/attendance', '/payroll', '/attendance/miss-punch']) await time('HR  ' + p, () => h.get(p));
for (const p of ['/', '/attendance']) await time('IC  ' + p, () => ic.get(p));
const month = localDateString(addDays(new Date(), -200)).slice(0, 7);
await time(`payroll run for ${month} (${all.length} people)`, () => { const r = buildRun(app, coo, month); console.log('   slips', app.db.get<{n:number}>('SELECT COUNT(*) AS n FROM payslips WHERE run_id = ?', [r.run.id])!.n, 'skipped', r.skipped.length, r.skipped[0]); });
await time('miss-punch report, 12 months', () => { missPunchReport(app, { from: localDateString(addDays(new Date(), -365)), to: localDateString(new Date()) }); });
saveDevice(app, coo, { sn: 'SCALE2', name: 'scale', active: true } as any);
const today = localDateString(new Date());
const body = all.map((e, i) => `${5000 + i}\t${today} 09:${String(i % 60).padStart(2, '0')}:00\t0\t1`).join('\n');
await time(`machine push of ${all.length} punches`, () => { ingestPunches(app, 'SCALE2', body, 'push'); });
const sz = db.get<{ s: number }>('SELECT page_count * page_size AS s FROM pragma_page_count(), pragma_page_size()')!;
console.log(`database size ${(sz.s / 1048576).toFixed(0)} MB`);
await s.close(); process.exit(0);
