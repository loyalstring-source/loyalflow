// Sample data for the newer screens (daily review, products and estimates, monthly targets), loaded with the demo data only.
// Never runs on a real system: it is called only when LOYALFLOW_DEMO=1 (or `npm run demo`).
import type { App } from '../app.ts';
import { getEmployee, type Employee } from '../modules/people/model.ts';
import { holidaySet } from '../lib/settings.ts';
import { localDateString, addDays, toLocal } from '../lib/time.ts';
import { saveProduct, createEstimate, saveEstimate, finaliseEstimate, sendEstimate } from '../modules/sales/estimates.ts';
import { listDeals } from '../modules/sales/service.ts';
import { measures, saveTargets, workingDays } from '../modules/brief/service.ts';

function rng(seed: number): () => number { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const DEV_TASKS = ['Fix login timeout on mobile', 'Stock report: Excel export', 'RFID reader pairing screen', 'Label print alignment', 'Code review: billing module', 'API for stock transfer', 'Tray scan: duplicate tag warning', 'Sync retries when offline', 'Customer-wise sales report', 'Upgrade database driver', 'Barcode and RFID dual print', 'Dashboard loading time', 'Opening stock import', 'GST rounding on invoices', 'User roles screen', 'Audit report by counter'];
const SUP_TASKS = ['Call back on reader not detected', 'Remote session: stock count mismatch', 'Follow up on pending payment query', 'Train new counter staff', 'Reinstall printer driver', 'Check tag read range at showroom', 'Send monthly usage report', 'Close duplicate tickets', 'Confirm go-live date with owner', 'Collect feedback after implementation'];
const PAYERS = ['Kalyani Jewellers', 'Shree Gold House', 'Omkar Ornaments', 'Tanvi Jewels', 'Royal Diamonds', 'Navkar Gold', 'Laxmi Jewellers', 'Mahalaxmi Alankar', 'Sai Gems', 'Pooja Jewels'];

export function seedDemoExtras(app: App, now = new Date()): void {
  const { db } = app;
  // Automated tests check people in themselves, so today's sample check-ins are left out for them.
  const fillToday = app.cfg.databasePath !== ':memory:' && process.env.LOYALFLOW_DEMO_FILL_TODAY !== '0'; const rand = rng(20261124); const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const coo = getEmployee(db, 'LS002'); if (!coo) return;
  const today = localDateString(now); const off = holidaySet(db);
  const team = (code: string): Employee[] => db.all<Employee>("SELECT e.* FROM employees e JOIN departments d ON d.id = e.department_id WHERE d.code = ? AND e.status = 'active' ORDER BY e.id", [code]);
  const deptId = (code: string): string | undefined => db.get<{ id: string }>('SELECT id FROM departments WHERE code = ?', [code])?.id;

  db.transaction(() => {
    // ---- Products and one estimate out with a customer ----
    if (!db.get('SELECT id FROM products LIMIT 1')) {
      const P: [string, string, string, number, string][] = [
        ['RFID jewellery tag', 'Tamper-evident UHF tag with loop, pack of 1,000', 'pack', 8500, '85235200'], ['Handheld RFID reader', 'Bluetooth UHF reader for counter and stock audit', 'pcs', 38000, '84719000'],
        ['Fixed RFID reader, 4 port', 'For the strong room and billing counter, with antennas', 'pcs', 62000, '84719000'], ['RFID stock tray', 'Smart tray that reads every piece placed on it', 'pcs', 24000, '84719000'],
        ['Sparkle RFID software, yearly licence', 'Stock, billing and audit for one showroom', 'nos', 60000, '997331'], ['Annual maintenance contract', 'On-site and remote support for one year', 'nos', 30000, '998713']];
      const made = P.map(([name, description, unit, price, hsn]) => saveProduct(app, coo, { name, description, unit, price, hsn, gstRate: 18, active: true }));
      try {
        const deal = listDeals(app, { open: true, limit: 60 }).find((d) => ['qualified', 'contacted', 'new'].includes(d.stage) && d.owner_id);
        const owner = deal && getEmployee(db, deal.owner_id);
        if (deal && owner) {
          const e = createEstimate(app, owner, deal.id);
          saveEstimate(app, owner, e.id, { subject: 'RFID stock system for one showroom', items: [{ productId: made[4].id, qty: 1, rate: 60000, gstRate: 18 }, { productId: made[1].id, qty: 2, rate: 38000, gstRate: 18 }, { productId: made[0].id, qty: 5, rate: 8500, discountPct: 5, gstRate: 18 }] });
          finaliseEstimate(app, owner, e.id); sendEstimate(app, owner, e.id);
        }
      } catch { /* the sample estimate is a nicety; the deal rules may not allow it on this data */ }
    }

    // ---- Daily review: the last eight working days for Development, Support and Sales ----
    if (!db.get('SELECT id FROM dsr_items LIMIT 1')) {
      const days: string[] = []; for (let d = now; days.length < 8; d = addDays(d, -1)) { const s = localDateString(d); if (toLocal(d).dow !== 7 && !off.has(s)) days.unshift(s); }
      const add = (dept: string, day: string, emp: string, kind: 'task' | 'collection', title: string, customer: string, hours: number | null, expected: number | null, status: string, pct: number | null, got: number | null, self: string, selfPct: number | null, selfGot: number | null, note: string, carry: number, by: string): void => {
        const at = `${day}T05:00:00.000Z`;
        db.run('INSERT INTO dsr_items (id, department_id, day, employee_id, kind, title, customer, planned_hours, amount_expected, self_status, self_pct, self_amount, self_note, self_at, status, pct, amount_actual, reviewed_by, reviewed_at, carry_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [db.nextId('DS'), dept, day, emp, kind, title, customer, hours, expected, self, selfPct, selfGot, note, self || selfGot != null ? `${day}T11:30:00.000Z` : null, status, pct, got, status === 'planned' ? null : by, status === 'planned' ? null : `${day}T12:30:00.000Z`, carry, by, at, at]);
      };
      const close = (dept: string, day: string, by: string): void => { db.run("INSERT OR IGNORE INTO dsr_days (id, department_id, day, status, notes, closed_at, closed_by, created_at) VALUES (?, ?, ?, 'closed', '', ?, ?, ?)", [db.nextId('DSR'), dept, day, `${day}T12:45:00.000Z`, by, `${day}T04:30:00.000Z`]); };
      const outcome = (): [string, number | null] => { const r = rand(); return r < 0.76 ? ['done', 100] : r < 0.9 ? ['partial', 40 + Math.floor(rand() * 5) * 10] : r < 0.97 ? ['not_done', null] : ['blocked', null]; };
      for (const [code, tasks] of [['DEV', DEV_TASKS], ['SUP', SUP_TASKS]] as const) {
        const id = deptId(code); const people = team(code); if (!id || !people.length) continue;
        const lead = db.get<{ hod_id: string | null }>('SELECT hod_id FROM departments WHERE id = ?', [id])?.hod_id || coo.id;
        for (const day of days) {
          const isToday = day === today;
          for (const p of people.slice(0, 7)) {
            const n = 2 + (rand() < 0.4 ? 1 : 0);
            for (let i = 0; i < n; i++) {
              const title = pick([...tasks]); const hours = [1, 2, 2, 3, 4][Math.floor(rand() * 5)];
              if (!isToday) { const [st, pct] = outcome(); add(id, day, p.id, 'task', title, '', hours, null, st, pct, null, st, pct, null, st === 'blocked' ? 'Waiting for the customer' : '', 0, lead); }
              // Today: Support has started reporting; Development is left untouched so the demo can show it being filled in.
              else if (code === 'SUP' && rand() < 0.5) { const [st, pct] = outcome(); add(id, day, p.id, 'task', title, '', hours, null, 'planned', null, null, st === 'blocked' ? 'partial' : st, st === 'blocked' ? 50 : pct, null, '', rand() < 0.12 ? 3 : 0, lead); }
              else add(id, day, p.id, 'task', title, '', hours, null, 'planned', null, null, '', null, null, '', i === 0 && rand() < 0.1 ? 3 : 0, lead);
            }
          }
          if (!isToday) close(id, day, lead);
        }
      }
      // Accounts keeps an hour-by-hour log.
      const acc = deptId('ACC'); const accountants = team('ACC');
      if (acc && accountants.length) {
        const head = db.get<{ hod_id: string | null }>('SELECT hod_id FROM departments WHERE id = ?', [acc])?.hod_id || coo.id;
        const WORK = ['Bank reconciliation', 'Sales invoices in Zoho Books', 'Vendor payments', 'GST working for the month', 'Follow up on receivables', 'Expense claims checked', 'TDS entries', 'Petty cash and vouchers', 'Purchase bills entered', 'Salary working with HR', 'Ledger scrutiny', 'Replying to the auditor'];
        const SLOTS = [['09:30', '10:30'], ['10:30', '11:30'], ['11:30', '13:00'], ['14:00', '15:00'], ['15:00', '16:30'], ['16:30', '18:00']];
        for (const day of days) {
          const isToday = day === today;
          for (const p of accountants.slice(0, 4)) {
            const upto = isToday ? 3 : SLOTS.length;
            for (let i = 0; i < upto; i++) {
              const [f, t] = SLOTS[i]; const hrs = (Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) - Number(f.slice(0, 2)) * 60 - Number(f.slice(3))) / 60; const at = `${day}T05:00:00.000Z`;
              db.run("INSERT INTO dsr_items (id, department_id, day, employee_id, kind, title, slot_from, slot_to, planned_hours, self_status, self_pct, self_at, status, pct, reviewed_by, reviewed_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'task', ?, ?, ?, ?, 'done', 100, ?, ?, ?, ?, ?, ?, ?, ?)",
                [db.nextId('DS'), acc, day, p.id, pick([...WORK]), f, t, hrs, at, isToday ? 'planned' : 'done', isToday ? null : 100, isToday ? null : head, isToday ? null : `${day}T12:30:00.000Z`, p.id, at, at]);
            }
          }
          if (!isToday) close(acc, day, head);
        }
      }
      const sal = deptId('SAL'); const sellers = team('SAL');
      if (sal && sellers.length) {
        const head = db.get<{ hod_id: string | null }>('SELECT hod_id FROM departments WHERE id = ?', [sal])?.hod_id || coo.id;
        for (const day of days) {
          const isToday = day === today;
          for (const p of sellers.slice(0, 6)) {
            if (rand() < 0.25) continue;
            const expected = (4 + Math.floor(rand() * 22)) * 10000; const r = rand(); const got = r < 0.68 ? expected : r < 0.85 ? Math.round((expected * (0.3 + rand() * 0.5)) / 1000) * 1000 : 0;
            const st = got >= expected ? 'done' : got > 0 ? 'partial' : 'not_done';
            if (!isToday) add(sal, day, p.id, 'collection', pick(['Invoice due', 'Second instalment', 'Advance for new order', 'AMC renewal', '']), pick([...PAYERS]), null, expected, st, null, got, st, null, got, got && got < expected ? 'Balance promised next week' : '', 0, head);
            else add(sal, day, p.id, 'collection', pick(['Invoice due', 'Second instalment', 'AMC renewal']), pick([...PAYERS]), null, expected, 'planned', null, null, '', null, rand() < 0.45 ? got : null, '', rand() < 0.15 ? 3 : 0, head);
          }
          if (!isToday) close(sal, day, head);
        }
      }
    }

    // ---- Attendance up to today, so "people today" is alive whenever the demo is started ----
    // Fills any working day in the last ten that has almost no check-ins. Today gets check-ins only, and leaves out the two executives
    // so that checking in can be shown live.
    for (let i = 9; i >= 0; i--) {
      const d = addDays(now, -i); const date = localDateString(d); if (toLocal(d).dow === 7 || off.has(date)) continue;
      if ((db.get<{ n: number }>('SELECT COUNT(*) AS n FROM attendance WHERE date = ?', [date])?.n || 0) > 5) continue;
      if (i === 0 && (!fillToday || toLocal(now).hh < 10)) continue;
      for (const e of db.all<{ id: string; functional_role: string }>("SELECT id, functional_role FROM employees WHERE status = 'active'")) {
        const roll = rand(); if (roll < 0.05 || (i === 0 && e.functional_role === 'executive')) continue;
        const late = roll < 0.13 ? 16 + Math.floor(rand() * 40) : 0; const inAt = new Date(`${date}T04:00:00.000Z`).getTime() + (late || Math.floor(rand() * 14) - 8) * 60000; // 09:30 IST
        db.run("INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, source, status, minutes_late, day_value) VALUES (?, ?, ?, ?, 'gps', 'present', ?, 1)",
          [e.id, date, new Date(inAt).toISOString(), i === 0 ? null : new Date(new Date(`${date}T13:00:00.000Z`).getTime() + Math.floor(rand() * 40) * 60000).toISOString(), late]);
      }
    }

    // ---- Six months of history, so the month-by-month graphs and reports have a shape ----
    // Each earlier month gets copies of this month's won deals, resolved tickets, dispatched orders and approved expenses, moved back in time.
    if (!db.get("SELECT id FROM deals WHERE stage = 'won' AND won_at < ?", [addDays(now, -45).toISOString()])) {
      const shift = (v: unknown, daysBack: number): unknown => {
        if (typeof v !== 'string') return v;
        if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v)) return new Date(new Date(v).getTime() - daysBack * 86_400_000).toISOString();
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(new Date(`${v}T00:00:00Z`).getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
        return v;
      };
      const clone = (table: string, where: string, monthsBack: number, share: number, change?: (row: Record<string, unknown>) => void): void => {
        for (const row of db.all<Record<string, unknown>>(`SELECT * FROM ${table} WHERE ${where}`)) {
          if (rand() > share) continue;
          const back = monthsBack * 30 + Math.floor(rand() * 9) - 4; const copy: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) copy[k] = shift(v, back);
          copy.id = db.nextId(String(row.id).split('-')[0]); if ('task_id' in copy) copy.task_id = null; if ('rating_token' in copy) copy.rating_token = null; if ('dev_issue_id' in copy) copy.dev_issue_id = null; if ('deal_id' in copy && table !== 'deals') copy.deal_id = null;
          change?.(copy); const cols = Object.keys(copy);
          db.run(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => copy[c] as string | number | null));
        }
      };
      const fresh = new Date(now.getTime() - 40 * 86_400_000).toISOString();
      for (let k = 1; k <= 5; k++) {
        const growth = 1 - k * 0.09; // business a little smaller the further back
        clone('deals', `stage = 'won' AND won_at > '${fresh}'`, k, 1, (r) => { r.value = Math.round((Number(r.value) * growth * (0.75 + rand() * 0.4)) / 5000) * 5000; });
        clone('tickets', `resolved_at IS NOT NULL AND created_at > '${fresh}'`, k, 0.55 * growth + 0.25, (r) => { if (rand() < 0.12) r.within_sla = 0; });
        for (let rep = 0; rep < 2; rep++) clone('work_orders', `kind = 'order' AND dispatched_at IS NOT NULL AND created_at > '${fresh}'`, k, 0.75, (r) => { if (rand() < 0.2 && typeof r.promised_date === 'string') r.promised_date = shift(r.promised_date, 3); });
        for (let rep = 0; rep < 4; rep++) clone('expenses', `status = 'approved' AND created_at > '${fresh}'`, k, 0.8, (r) => { r.category = pick(['Local travel', 'Outstation travel', 'Food', 'Courier', 'Office supplies']); r.amount = Math.round(((1500 + rand() * 60000) * growth) / 100) * 100; r.description = 'Sample expense'; });
        // Collections for that month, a few working days each.
        const sal = deptId('SAL'); const sellers = team('SAL');
        if (sal && sellers.length) for (let i = 0; i < 9; i++) {
          const day = localDateString(addDays(now, -(k * 30 + i * 3))); const expected = (3 + Math.floor(rand() * 11)) * 10000 * growth; const got = rand() < 0.8 ? expected : Math.round(expected * 0.5);
          db.run("INSERT INTO dsr_items (id, department_id, day, employee_id, kind, title, customer, amount_expected, self_amount, status, amount_actual, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'collection', '', ?, ?, ?, ?, ?, ?, ?, ?)",
            [db.nextId('DS'), sal, day, pick(sellers).id, pick([...PAYERS]), Math.round(expected), Math.round(got), got >= expected ? 'done' : 'partial', Math.round(got), coo.id, `${day}T05:00:00.000Z`, `${day}T05:00:00.000Z`]);
          db.run("INSERT OR IGNORE INTO dsr_days (id, department_id, day, status, notes, closed_at, closed_by, created_at) VALUES (?, ?, ?, 'closed', '', ?, ?, ?)", [db.nextId('DSR'), sal, day, `${day}T12:45:00.000Z`, coo.id, `${day}T04:30:00.000Z`]);
        }
      }
    }

    // ---- Monthly targets: set near what the sample data achieves, so the overview shows a mix of outlooks ----
    if (!db.get('SELECT measure FROM team_targets LIMIT 1')) {
      const month = today.slice(0, 7); const from = `${month}-01`; const last = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()).padStart(2, '0')}`;
      const elapsed = Math.max(1, workingDays(app, from, today)); const all = workingDays(app, from, last);
      const mix = [0.92, 1.06, 0.95, 1.25, 0.9, 1.04, 0.97, 0.9, 1.1]; const values: Record<string, number> = {};
      measures(app).forEach((m, i) => {
        const mtd = m.actual(app, from, today); if (mtd == null || mtd <= 0) return;
        const projected = m.kind === 'sum' ? (mtd / elapsed) * all : mtd; let t = projected * (m.direction === 'down' ? 2 - mix[i % mix.length] : mix[i % mix.length]);
        t = m.unit === 'pct' ? Math.min(98, Math.max(50, Math.round(t / 5) * 5)) : m.unit === 'count' ? Math.max(1, Math.round(t)) : Math.max(50000, Math.round(t / 50000) * 50000);
        values[m.key] = t;
      });
      if (Object.keys(values).length) saveTargets(app, coo, month, values);
    }
    // ---- Timed work: sessions and breaks against past daily-review lines, so the time reports have something to show ----
    if (!db.get('SELECT id FROM work_sessions LIMIT 1')) {
      const lines = db.all<{ id: string; employee_id: string; day: string; title: string; planned_hours: number | null }>(`SELECT i.id, i.employee_id, i.day, i.title, i.planned_hours FROM dsr_items i JOIN departments d ON d.id = i.department_id
        WHERE d.code IN ('DEV', 'SUP', 'QA') AND i.kind = 'task' AND COALESCE(i.slot_from, '') = '' AND i.day < ? AND i.day >= date(?, '-12 days') ORDER BY i.employee_id, i.day, i.id`, [today, today]);
      const clock = new Map<string, number>();   // minutes past 09:30 local, per person and day
      for (const l of lines) {
        const key = `${l.employee_id}|${l.day}`; let at = clock.get(key) ?? Math.floor(rand() * 20);
        const iso = (m: number): string => new Date(Date.parse(`${l.day}T04:00:00.000Z`) + m * 60_000).toISOString();
        const total = Math.round((l.planned_hours || 1.5) * 60 * (0.7 + rand() * 0.6)); const first = Math.round(total * (0.4 + rand() * 0.3));
        const add = (kind: string, note: string, from: number, mins: number): void => { db.run('INSERT INTO work_sessions (employee_id, entity_type, entity_id, title, kind, note, started_at, ended_at, minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [l.employee_id, 'dsr', l.id, l.title, kind, note, iso(from), iso(from + mins), mins]); };
        add('work', '', at, first); at += first;
        if (rand() < 0.6) { const b = 10 + Math.floor(rand() * 25); add('break', pick(['Tea', 'Lunch', 'Personal']), at, b); at += b; }
        add('work', '', at, total - first); at += total - first + Math.floor(rand() * 15);
        clock.set(key, at);
      }
    }

    // ---- Expenses on to Accounts: older approved claims are paid, with ledger lines; a few advances in different states ----
    if (!db.get("SELECT id FROM expense_ledger WHERE type <> 'claim_approved' LIMIT 1")) {
      const acc = team('ACC')[0]; const line = (emp: string, exp: string, date: string, type: string, debit: number, credit: number, mode = '', ref = '', note = ''): void => { db.run('INSERT INTO expense_ledger (employee_id, expense_id, entry_date, type, debit, credit, mode, ref, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [emp, exp, date, type, debit, credit, mode, ref, note, acc?.id || null, `${date}T08:00:00.000Z`]); };
      const old = db.all<{ id: string; employee_id: string; amount: number; category: string; created_at: string }>("SELECT id, employee_id, amount, category, created_at FROM expenses WHERE status = 'approved' AND kind = 'reimbursement' ORDER BY created_at");
      for (const x of old) {
        const day = x.created_at.slice(0, 10); if (!db.get("SELECT 1 AS x FROM expense_ledger WHERE expense_id = ? AND type = 'claim_approved'", [x.id])) line(x.employee_id, x.id, day, 'claim_approved', 0, x.amount, '', '', x.category);
        if (day > localDateString(addDays(now, -6))) continue;   // the last few days are still waiting for Accounts
        const paid = localDateString(addDays(new Date(`${day}T06:00:00.000Z`), 2 + Math.floor(rand() * 3))); const mode = pick(['Bank transfer', 'UPI', 'Bank transfer']); const ref = `${mode === 'UPI' ? 'UPI' : 'NEFT'}${Math.floor(100000 + rand() * 899999)}`;
        line(x.employee_id, x.id, paid, 'claim_paid', x.amount, 0, mode, ref);
        db.run("UPDATE expenses SET status = 'paid', paid_at = ?, paid_by = ?, pay_mode = ?, pay_ref = ?, expense_date = ? WHERE id = ?", [`${paid}T06:30:00.000Z`, acc?.id || null, mode, ref, day, x.id]);
      }
      const sales = team('SAL'); const sup = team('SUP');
      const adv = (emp: Employee | undefined, amount: number, category: string, what: string, daysAgo: number, status: string): string | null => {
        if (!emp) return null; const id = db.nextId('E'); const day = localDateString(addDays(now, -daysAgo));
        const ref = `NEFT${Math.floor(100000 + rand() * 899999)}`;
        db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, paid_at, paid_by, pay_mode, pay_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, emp.id, category, amount, what, status, `${day}T05:00:00.000Z`, 'advance', day, status === 'approved' ? null : `${day}T06:30:00.000Z`, status === 'approved' ? null : acc?.id || null, status === 'approved' ? '' : 'Bank transfer', status === 'approved' ? '' : ref]);
        if (status !== 'approved') line(emp.id, id, day, 'advance_paid', amount, 0, 'Bank transfer', ref);
        return id;
      };
      const bills = (emp: Employee | undefined, advId: string | null, amount: number, category: string, what: string, daysAgo: number): void => {
        if (!emp || !advId) return; const id = db.nextId('E'); const day = localDateString(addDays(now, -daysAgo));
        db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, advance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, emp.id, category, amount, what, 'approved', `${day}T05:00:00.000Z`, 'settlement', day, advId]);
        line(emp.id, advId, day, 'settlement_approved', 0, amount, '', '', `${category} · ${id}`);
      };
      const a1 = adv(sales[1], 25000, 'Travel', 'Exhibition visit to Jaipur, three days', 16, 'paid'); bills(sales[1], a1, 18400, 'Travel', 'Train, hotel and local travel', 9);
      adv(sup[2], 8000, 'Travel', 'On-site installation at Solapur', 4, 'paid');
      adv(sales[2], 15000, 'Travel', 'Customer visits in Hyderabad next week', 1, 'approved');
      const a4 = adv(sup[0], 12000, 'Travel', 'Implementation trip to Nashik', 40, 'paid'); bills(sup[0], a4, 10650, 'Travel', 'Bus, lodge and meals', 33);
      if (a4 && sup[0]) { const day = localDateString(addDays(now, -31)); line(sup[0].id, a4, day, 'advance_returned', 0, 1350, 'Cash', ''); db.run("UPDATE expenses SET status = 'settled', settled_at = ? WHERE id = ?", [`${day}T07:00:00.000Z`, a4]); }
      // Petty cash, and vendor bills: one paid, one waiting.
      const pline = (date: string, type: string, debit: number, credit: number, exp: string | null, note: string, mode = ''): void => { db.run('INSERT INTO expense_ledger (employee_id, expense_id, entry_date, type, debit, credit, mode, ref, note, created_by, created_at, party) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [acc?.id || coo.id, exp, date, type, debit, credit, mode, '', note, acc?.id || null, `${date}T08:00:00.000Z`, type.startsWith('vendor') ? 'vendor' : 'petty']); };
      const other = (kind: string, daysAgo: number, vendor: string, gstin: string, category: string, amount: number, gst: number | null, what: string, status: string, dept: string): string => {
        const id = db.nextId('E'); const day = localDateString(addDays(now, -daysAgo)); const paid = status === 'paid';
        db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, kind, expense_date, department_id, vendor_name, vendor_gstin, bill_no, gst_amount, paid_at, paid_by, pay_mode, pay_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, acc?.id || coo.id, category, amount, what, status, `${day}T05:00:00.000Z`, kind, day, deptId(dept) || null, vendor, gstin, `INV-${Math.floor(1000 + rand() * 8999)}`, gst, paid ? `${day}T06:30:00.000Z` : null, paid ? acc?.id || null : null, paid ? (kind === 'petty' ? 'Petty cash' : 'Bank transfer') : '', paid && kind !== 'petty' ? `NEFT${Math.floor(100000 + rand() * 899999)}` : '']);
        if (kind === 'petty') pline(day, 'petty_spend', 0, amount, id, category, 'Petty cash'); else { pline(day, 'vendor_bill', 0, amount, id, category); if (paid) pline(day, 'vendor_paid', amount, 0, id, '', 'Bank transfer'); }
        return id;
      };
      pline(localDateString(addDays(now, -20)), 'petty_topup', 10000, 0, null, '', 'Cash withdrawn from bank');
      other('petty', 14, 'Sai Stationers', '', 'Office supplies', 640, null, 'Printer paper and pens', 'paid', 'ACC');
      other('petty', 8, 'Shree Tea Stall', '', 'Food', 380, null, 'Tea and snacks for visitors', 'paid', 'ACC');
      other('petty', 3, 'Quick Courier', '', 'Courier', 450, null, 'Sample tags to a customer', 'paid', 'SAL');
      other('vendor', 18, 'Zebra Labels India Pvt Ltd', '27AAACZ1234A1Z5', 'Office supplies', 47200, 7200, 'RFID label rolls, 20 boxes', 'paid', 'PRD');
      other('vendor', 2, 'Pune Broadband Services', '27AABCP5678B1Z2', 'Other', 11800, 1800, 'Office internet, November', 'approved', 'ACC');
    }

  });
}
