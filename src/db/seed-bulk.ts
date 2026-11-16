// Bulk test data: enough volume in every module for one person to test the system
// properly without a QA team.
//
// Run with `npm run seed:bulk`. It layers on top of the demo data and is NOT loaded by
// the test suite, which keeps its small deterministic set.
//
// Two things make this useful rather than just big:
//   1. Everything is backdated across ~6 months, so trends, sparklines, SLA clocks,
//      ageing buckets and KPI history all have something real to show.
//   2. Roughly a quarter of the rows are deliberately awkward — breached, reopened,
//      blocked, late, declined, withdrawn — because that is where the bugs live.
import type { App } from '../app.ts';
import { addDays, localDateString } from '../lib/time.ts';
import { dueDates, type Priority } from '../modules/desk/service.ts';
import { getEmployee, listEmployees, type Employee } from '../modules/people/model.ts';
import { createCustomer } from '../modules/sales/service.ts';
import { generateInstances } from '../modules/sops/service.ts';
import { issueForSeed, beginAttempt, saveAttempt, submitAttempt, saveReview } from '../modules/hr/assessment.ts';
import { TEMPLATES } from '../modules/hr/assessment-templates.ts';
import { saveCandidate, addApplication, saveRequisition, openRequisition, pauseRequisition, closeRequisition, draftOffer, startOnboarding, getApplication, getOffer, setOnboardingItem, completeOnboarding, onboardingOf, onboardingItems, holdApplication } from '../modules/hr/recruiting.ts';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ── Domain vocabulary ──────────────────────────────────────────────────────
   LoyalString sells jewellery ERP and RFID hardware, so the test data is the
   work the team actually does. Recognising the rows is half the point.        */

const JEWELLERS: [string, string, string][] = [
  ['Ranka Jewellers', 'Pune', 'Retail chain'], ['PN Gadgil Sons', 'Pune', 'Retail chain'], ['Lagu Bandhu', 'Pune', 'Retail chain'],
  ['Waman Hari Pethe', 'Mumbai', 'Retail chain'], ['Tribhovandas Zaveri', 'Mumbai', 'Retail chain'], ['Shree Ganesh Jewellery', 'Nashik', 'Single store'],
  ['Maheshwari Jewellers', 'Nagpur', 'Single store'], ['Rajmudra Gold', 'Kolhapur', 'Single store'], ['Sonchafa Jewellers', 'Sangli', 'Single store'],
  ['Amrapali Gold House', 'Aurangabad', 'Single store'], ['Vaibhav Jewellers', 'Solapur', 'Single store'], ['Kalpataru Ornaments', 'Thane', 'Single store'],
  ['Suvarna Mandir', 'Satara', 'Single store'], ['Anmol Jewels', 'Ahmednagar', 'Single store'], ['Chintamani Jewellers', 'Latur', 'Single store'],
  ['Gokul Gold Palace', 'Jalgaon', 'Single store'], ['Shubhangi Jewellers', 'Nanded', 'Single store'], ['Dhanlaxmi Gold', 'Akola', 'Single store'],
  ['Saraf Brothers', 'Amravati', 'Single store'], ['Tanmay Jewellers', 'Chandrapur', 'Single store'], ['Kanchan Jewel Arts', 'Nashik', 'Manufacturer'],
  ['Girija Ornaments', 'Mumbai', 'Manufacturer'], ['Swarnakar Udyog', 'Pune', 'Manufacturer'], ['Meenakshi Gold Works', 'Coimbatore', 'Manufacturer'],
  ['Zaveri Karigar House', 'Surat', 'Manufacturer'], ['Padmavati Jewellers', 'Nagpur', 'Single store'], ['Shri Krishna Jewellers', 'Pune', 'Single store'],
  ['Rupali Gold', 'Pune', 'Single store'], ['Arihant Jewellers', 'Jalna', 'Single store'], ['Manikchand Ornaments', 'Beed', 'Single store'],
  ['Vrindavan Jewels', 'Nashik', 'Single store'], ['Kohinoor Gold House', 'Mumbai', 'Retail chain'], ['Sai Krupa Jewellers', 'Pune', 'Single store'],
  ['Samruddhi Ornaments', 'Wardha', 'Single store'], ['Navkar Jewellers', 'Dhule', 'Single store'], ['Hirakani Gold', 'Ratnagiri', 'Single store'],
  ['Tejas Jewel Mart', 'Panvel', 'Single store'], ['Prasanna Jewellers', 'Belgaum', 'Single store'], ['Yash Gold Studio', 'Pune', 'Single store'],
  ['Devkrupa Jewellers', 'Osmanabad', 'Single store'], ['Bhagyalaxmi Gold', 'Parbhani', 'Single store'], ['Shubh Alankar', 'Hingoli', 'Single store'],
  ['Omkar Jewel House', 'Gondia', 'Single store'], ['Nakshatra Jewellers', 'Bhandara', 'Single store'], ['Ratnadeep Gold', 'Hyderabad', 'Retail chain'],
  ['Sri Lakshmi Jewellers', 'Bengaluru', 'Retail chain'], ['Malabar Ornaments', 'Kochi', 'Retail chain'], ['Anjali Jewel Craft', 'Indore', 'Manufacturer'],
  ['Kuber Gold Mart', 'Raipur', 'Single store'], ['Shree Sai Alankar', 'Pimpri', 'Single store'], ['Vighnaharta Jewellers', 'Chinchwad', 'Single store'],
  ['Rukmini Ornaments', 'Baramati', 'Single store'], ['Trimurti Gold', 'Ichalkaranji', 'Single store'], ['Mangalam Jewellers', 'Karad', 'Single store'],
  ['Shivneri Jewel House', 'Junnar', 'Single store'], ['Gurukrupa Gold', 'Shirdi', 'Single store']
];

const SOURCES = ['IndiaMART', 'Reference', 'Website form', 'Exhibition', 'Cold call', 'WhatsApp enquiry'];
const CONTACTS = ['Owner', 'Managing Director', 'Store manager', 'Accounts head', 'Purchase head', 'IT in charge', 'Partner'];
const FIRST = ['Rohit', 'Sneha', 'Amit', 'Priya', 'Nilesh', 'Kavita', 'Sandeep', 'Manisha', 'Ganesh', 'Pallavi', 'Rajesh', 'Swati', 'Vikas', 'Deepa', 'Mahesh', 'Rupali', 'Anil', 'Shilpa', 'Prakash', 'Vaishali'];
const LAST = ['Deshmukh', 'Kulkarni', 'Joshi', 'Patil', 'Shah', 'Jain', 'Agarwal', 'Pawar', 'Sharma', 'Bhosale', 'Gandhi', 'Mehta', 'Shinde', 'Chavan', 'Thakur', 'Rane'];

/** Support tickets a jewellery ERP desk actually receives. */
const TICKETS: [string, string, Priority][] = [
  ['Billing screen freezes when old gold exchange is added', 'Billing', 'P1'],
  ['GST rate showing 3% instead of 5% on making charges', 'Billing', 'P1'],
  ['HUID field not accepting six character code', 'Hallmarking', 'P2'],
  ['Gold rate not updating from the morning feed', 'Rates', 'P1'],
  ['RFID reader missing tags on the top tray', 'Hardware', 'P2'],
  ['Barcode printer prints blank labels', 'Hardware', 'P2'],
  ['Stock count mismatch after physical verification', 'Inventory', 'P2'],
  ['Karigar job work issue slip not generating', 'Job work', 'P2'],
  ['Cannot close day book, cash difference of ₹1,200', 'Accounts', 'P1'],
  ['Tally export missing last three vouchers', 'Tally', 'P2'],
  ['E-way bill number not saving against the invoice', 'Billing', 'P2'],
  ['Scheme instalment receipt shows wrong member name', 'Schemes', 'P3'],
  ['Mobile app not syncing after yesterday evening', 'Mobile app', 'P2'],
  ['Customer ledger shows duplicate entry for one bill', 'Accounts', 'P2'],
  ['Purity 22K defaulting to 18K on new items', 'Masters', 'P2'],
  ['Estimate print cuts off the terms at the bottom', 'Printing', 'P3'],
  ['Silver articles not showing in the stock report', 'Inventory', 'P3'],
  ['Old gold rate calculation ignoring wastage percent', 'Billing', 'P2'],
  ['Login not working for two counter staff', 'Access', 'P2'],
  ['Backup failed last night, no email received', 'System', 'P1'],
  ['Weighing scale reading not coming into the bill', 'Hardware', 'P2'],
  ['Repair job status not visible to the counter', 'Job work', 'P3'],
  ['Diamond certificate number field too short', 'Masters', 'P3'],
  ['Branch transfer not reflecting in receiving branch', 'Inventory', 'P2'],
  ['SMS not going to customers on bill generation', 'Notifications', 'P3'],
  ['Report export to Excel opens with broken columns', 'Reports', 'P3'],
  ['Approval needed twice for the same discount', 'Billing', 'P3'],
  ['Hallmark charges not added to the invoice total', 'Hallmarking', 'P2'],
  ['Cannot cancel a bill made yesterday', 'Billing', 'P2'],
  ['Stock valuation report shows negative for one item', 'Reports', 'P2'],
  ['New counter PC cannot connect to the server', 'System', 'P1'],
  ['Tag weight and item weight differ by 0.2 grams', 'Inventory', 'P2'],
  ['Scheme maturity list not generating for this month', 'Schemes', 'P3'],
  ['Printer takes two minutes for one invoice', 'Printing', 'P3'],
  ['Customer photo not saving in KYC', 'Masters', 'P3'],
  ['Daily sales SMS to owner stopped since Friday', 'Notifications', 'P3'],
  ['Bulk tag printing stops after forty labels', 'Hardware', 'P2'],
  ['Wrong opening balance carried to the new year', 'Accounts', 'P1'],
  ['Making charge slab not applying for 18K range', 'Masters', 'P2'],
  ['Search by phone number returns no result', 'Masters', 'P3']
];

const IMPLEMENTATIONS = [
  'New store go-live: masters, opening stock and counter training',
  'RFID rollout across two floors with reader calibration',
  'Branch two setup with transfer and consolidated reporting',
  'Tally Prime sync setup and first reconciliation',
  'Scheme module configuration and member migration',
  'Data migration from the previous software'
];

const DEV_ISSUES: [string, string][] = [
  ['bug', 'Rounding error in making charge on 18K items'],
  ['bug', 'Stock report times out above 20,000 items'],
  ['bug', 'HUID validation rejects valid codes starting with a zero'],
  ['bug', 'Old gold exchange ignores wastage on silver'],
  ['feature', 'Multi-branch stock transfer approval flow'],
  ['feature', 'Scheme auto-debit reminder on WhatsApp'],
  ['feature', 'Karigar settlement statement with pending weight'],
  ['feature', 'Gold rate history chart on the dashboard'],
  ['bug', 'Barcode label layout breaks on 38mm stock'],
  ['task', 'Upgrade the reporting library to the current version'],
  ['bug', 'Duplicate ledger entry when a bill is edited twice'],
  ['feature', 'Offline billing mode for network drops'],
  ['task', 'Add indexes to the stock movement table'],
  ['bug', 'E-way bill API returns 500 for amounts above ten lakh'],
  ['feature', 'Hallmarking centre dispatch and return tracking'],
  ['bug', 'Mobile app shows yesterday stock after sync'],
  ['task', 'Move invoice PDF generation off the request thread'],
  ['feature', 'Customer-wise outstanding ageing report'],
  ['bug', 'Discount approval email goes to the wrong manager'],
  ['feature', 'Bulk import of karigar job work issues']
];

const PRODUCTS = [
  'LoyalString ERP — 3 counter licence', 'LoyalString ERP — 5 counter licence', 'RFID starter kit (reader + 2,000 tags)',
  'RFID full-store kit (2 readers + 10,000 tags)', 'Barcode printer TSC TE244', 'Handheld RFID scanner',
  'Tag printing station', 'Weighing scale integration kit', 'Counter PC bundle', 'Annual maintenance contract',
  'Scheme module add-on', 'Mobile app licence — 5 users', 'Tally connector licence', 'Branch licence add-on',
  'RFID tags — 5,000 roll', 'Security gate antenna pair'
];

const PROCUREMENT = [
  ['RFID tags 5,000 roll', 'rolls', 'Avery Dennison India'], ['TSC TE244 printer', 'units', 'Barcode Solutions Pune'],
  ['Handheld RFID reader', 'units', 'Zebra partner — Mumbai'], ['Thermal label 38mm', 'rolls', 'Barcode Solutions Pune'],
  ['Counter PC — i3 8GB', 'units', 'Rashi Peripherals'], ['UPS 1KVA', 'units', 'Local vendor Pune'],
  ['Security gate antenna', 'pairs', 'Zebra partner — Mumbai'], ['Weighing scale RS232 cable', 'units', 'Local vendor Pune'],
  ['Tag ribbon wax-resin', 'rolls', 'Barcode Solutions Pune'], ['Network switch 16 port', 'units', 'Rashi Peripherals']
];

const EXPENSES: [string, string, number][] = [
  ['Travel', 'Site visit — customer store', 2400], ['Travel', 'Outstation visit including stay', 8600],
  ['Fuel', 'Local running for the week', 1800], ['Food', 'Team lunch during go-live', 2200],
  ['Courier', 'Hardware dispatch to customer', 650], ['Hardware', 'Replacement cable and connectors', 1450],
  ['Travel', 'Exhibition travel and booth support', 12400], ['Internet', 'Dongle recharge for site work', 999]
];

const LEAVE_REASONS = ['Family function', 'Not keeping well', 'Personal work', 'Child unwell', 'Festival at native place', 'Medical check-up', 'House shifting'];

const TASKS = [
  'Prepare the weekly review pack', 'Call back the three customers who rated us low', 'Update the price list for the new GST slab',
  'Check the RFID tag stock before the Nashik go-live', 'Write the handover note for the Kolhapur account',
  'Reconcile last month collections with Tally', 'Review the open implementation plans',
  'Draft the training deck for counter staff', 'Chase the pending PO from Ranka',
  'Test the new barcode printer before dispatch', 'Clean up duplicate customer records',
  'Plan the UK-hours cover for next week', 'Collect feedback from last month go-lives',
  'Update the SOP for hallmarking dispatch', 'Check pending AMC renewals for this quarter'
];

const ROLES: { title: string; dept: string; positions: number; ctc: number; exp: string; why: string; what: string }[] = [
  { title: '.NET Developer', dept: 'DEV', positions: 2, ctc: 780000, exp: '3-5 years on C# and SQL Server',
    why: 'Two of the four developers are carrying the whole ERP backend. One sprint of sick leave and releases stop.',
    what: 'Build and maintain the LoyalString ERP backend, work on the Tally connector, take releases through QA.' },
  { title: 'QA Engineer', dept: 'QA', positions: 1, ctc: 620000, exp: '2+ years, manual and API testing',
    why: 'Releases are tested by the developers who wrote them, which is how the GST rate bug reached a customer.',
    what: 'Own the release checklist, write and run API tests, sign off every release before it ships.' },
  { title: 'Implementation Engineer', dept: 'SUP', positions: 2, ctc: 520000, exp: '2-4 years, ERP or retail software',
    why: 'Go-lives are slipping past the 21-day plan because the same three people run every one of them.',
    what: 'Run store go-lives end to end: masters, opening stock, counter training and the first month of hand-holding.' },
  { title: 'Business Development Manager — Pune', dept: 'SAL', positions: 2, ctc: 660000, exp: '3+ years selling to retail',
    why: 'Pipeline coverage is at 1.5× against a target of 3×. We cannot close our way out of a thin top of funnel.',
    what: 'Own the Pune and Pimpri territory: jeweller visits, demos, quotes and closures.' },
  { title: 'Pre-sales Executive', dept: 'PRE', positions: 1, ctc: 420000, exp: '1-3 years in inside sales',
    why: 'New leads this week is at 1 against a target of 35. Nobody is working the IndiaMART and website enquiries.',
    what: 'Qualify inbound enquiries, book demos for the BDMs, keep the lead records clean.' },
  { title: 'RFID Production Technician', dept: 'PRD', positions: 3, ctc: 288000, exp: 'ITI or diploma, 1+ year on an assembly line',
    why: 'RFID kit orders have doubled and the line is running overtime every week to keep the promised dates.',
    what: 'Assemble and test reader kits, encode and verify tags, pack and label for dispatch.' },
  { title: 'Accounts Executive', dept: 'ACC', positions: 1, ctc: 400000, exp: '2+ years with Tally and GST',
    why: 'Receivables are ageing because one person is doing invoicing, collections and the GST filings.',
    what: 'Raise invoices on dispatch, chase collections, support the monthly GST and TDS filings in Tally.' },
  { title: 'Digital Marketing Executive', dept: 'DM', positions: 1, ctc: 380000, exp: '2+ years, performance marketing',
    why: 'We have no measured cost per lead, so we cannot tell which channel is worth more money.',
    what: 'Run the campaigns, track cost per lead by channel, keep the website enquiry form feeding the pipeline.' }
];

export interface BulkResult { [table: string]: number }

export function seedBulk(app: App, opts: { force?: boolean } = {}): BulkResult {
  const { db } = app;
  if (!opts.force && db.get("SELECT value FROM settings WHERE key = 'bulkSeeded'")) {
    throw new Error('Bulk data is already loaded. Re-run with --force to add another batch.');
  }
  const rand = rng(20261110);
  const now = new Date();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => Math.floor(a + rand() * (b - a + 1));
  const emp = (id: string): Employee | undefined => getEmployee(db, id);
  const active = listEmployees(db, { status: 'active' });
  const byDept = (code: string) => active.filter((e) => e.department_id === code);
  const support = byDept('SUP').length ? byDept('SUP') : active;
  const devs = byDept('DEV').length ? byDept('DEV') : active;
  const sales = byDept('SAL').length ? byDept('SAL') : active;
  const presales = byDept('PRE').length ? byDept('PRE') : sales;
  const prod = byDept('PRD').length ? byDept('PRD') : active;
  const coo = emp('LS002') || active[0];
  const hr = byDept('HR')[0] || coo;
  const counts: BulkResult = {};
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  db.transaction(() => {
    // ── Customers ──────────────────────────────────────────────────────────
    const customerIds: string[] = [];
    for (const [name, city, segment] of JEWELLERS) {
      const owner = pick(sales);
      const c = createCustomer(app, coo, {
        name, city, segment,
        contact_name: `${pick(FIRST)} ${pick(LAST)}`,
        phone: `9${between(1, 9)}${String(between(10000000, 99999999))}`.slice(0, 10),
        email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
        source: pick(SOURCES), owner_id: owner.id
      });
      db.run('UPDATE customers SET created_at = ? WHERE id = ?', [addDays(now, -between(20, 220)).toISOString(), c.id]);
      customerIds.push(c.id);
      bump('customers');
    }
    const allCustomers = db.all<{ id: string; name: string }>('SELECT id, name FROM customers');

    // ── Tickets ────────────────────────────────────────────────────────────
    // Spread across six months with a realistic mix: most resolved inside SLA,
    // a meaningful tail breached, a few reopened, and some still open and ageing.
    const ticketIds: string[] = [];
    for (let i = 0; i < 180; i++) {
      const [subject, category, basePriority] = TICKETS[i % TICKETS.length];
      const isImpl = i % 15 === 7;
      const priority: Priority = isImpl ? 'P3' : (rand() < 0.08 ? 'P1' : rand() < 0.42 ? 'P2' : rand() < 0.9 ? 'P3' : 'P4');
      const hoursAgo = Math.round(rand() * 24 * 170) + 2;
      const created = new Date(now.getTime() - hoursAgo * 3_600_000);
      const due = dueDates(app, priority, created);
      const assignee = pick(support);
      const customer = pick(allCustomers);
      // A real desk closes its old work. The chance of a ticket being finished rises
      // with age — after two months almost everything is shut — so the open backlog
      // is mostly recent, with a believable tail of stragglers rather than a heap.
      const ageDays = hoursAgo / 24;
      const resolved = hoursAgo > 30 && rand() < Math.min(0.97, 0.45 + ageDays * 0.012);
      const slaHours = (due.resolveDue.getTime() - created.getTime()) / 3_600_000;
      const breached = rand() < 0.16;
      const resolvedAt = resolved
        ? new Date(created.getTime() + (breached ? slaHours * (1.3 + rand()) : slaHours * (0.15 + rand() * 0.7)) * 3_600_000)
        : null;
      const closed = resolved && rand() < 0.8;
      const reopens = resolved && rand() < 0.08 ? 1 : 0;
      const status = !resolved ? pick(['open', 'open', 'in_progress', 'in_progress', 'waiting_customer']) : closed ? 'closed' : 'resolved';
      const responded = rand() > 0.05;
      const id = db.nextId('T');
      const implDays = isImpl ? between(14, 30) : null;
      const resolveDue = isImpl ? new Date(created.getTime() + implDays! * 86_400_000) : due.resolveDue;
      db.run(`INSERT INTO tickets (id, customer_id, subject, description, type, category, priority, status, assignee_id, created_by, channel, created_at,
        first_response_at, response_due_at, resolve_due_at, resolved_at, closed_at, within_sla, rating, reopen_count, impl_plan_days, impl_stage, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customer.id, isImpl ? pick(IMPLEMENTATIONS) : subject,
          isImpl ? 'Implementation agreed at the time of order.' : 'Reported by the store on call. Details in the recording.',
          isImpl ? 'implementation' : 'support', isImpl ? 'Implementation' : category, priority, status, assignee.id, pick(support).id,
          pick(['phone', 'email', 'whatsapp', 'portal']), created.toISOString(),
          responded ? new Date(created.getTime() + between(4, 90) * 60_000).toISOString() : null,
          due.responseDue.toISOString(), resolveDue.toISOString(),
          resolvedAt?.toISOString() || null, closed ? resolvedAt?.toISOString() || null : null,
          resolvedAt ? (resolvedAt <= resolveDue ? 1 : 0) : null,
          closed && rand() < 0.55 ? between(3, 5) : null, reopens,
          implDays, isImpl ? pick(['setup', 'masters', 'training', 'go_live']) : null,
          (resolvedAt || created).toISOString()]);
      db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)',
        [id, 'created', 'Raised by the store', pick(support).id, created.toISOString()]);
      if (responded) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)',
        [id, 'reply', 'Acknowledged and asked for the bill number', assignee.id, new Date(created.getTime() + between(4, 90) * 60_000).toISOString()]);
      if (reopens) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)',
        [id, 'reopened', 'Customer says the problem came back', assignee.id, new Date(resolvedAt!.getTime() + 6 * 3_600_000).toISOString()]);
      if (resolvedAt) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)',
        [id, 'resolved', resolvedAt <= resolveDue ? 'Fixed and confirmed with the store' : 'Fixed, outside the SLA clock', assignee.id, resolvedAt.toISOString()]);
      ticketIds.push(id);
      bump('tickets');
    }

    // ── Development issues ─────────────────────────────────────────────────
    const devStatuses = ['backlog', 'planned', 'in_progress', 'in_review', 'in_qa', 'ready', 'released'];
    for (let i = 0; i < 64; i++) {
      const [type, title] = DEV_ISSUES[i % DEV_ISSUES.length];
      const daysAgo = between(1, 150);
      const status = daysAgo > 60 ? (rand() < 0.85 ? 'released' : 'ready') : pick(devStatuses);
      const assignee = pick(devs);
      const id = db.nextId('D');
      const blocked = rand() < 0.08 && status !== 'released' ? 1 : 0;
      db.run(`INSERT INTO dev_issues (id, title, description, type, status, priority, sprint, assignee_id, created_by, points, blocked, blocked_reason, created_at, released_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, `${title}${i >= DEV_ISSUES.length ? ` (${pick(allCustomers).name})` : ''}`,
          'Raised from the support desk. Steps to reproduce in the ticket.', type, status,
          rand() < 0.15 ? 'P1' : rand() < 0.5 ? 'P2' : 'P3',
          status === 'backlog' ? '' : `Sprint ${40 + Math.floor((150 - daysAgo) / 7)}`,
          assignee.id, pick(devs).id, pick([1, 2, 3, 5, 8]), blocked,
          blocked ? pick(['Waiting on the customer data dump', 'Blocked by the e-way bill API change', 'Needs a decision from the COO']) : '',
          addDays(now, -daysAgo).toISOString(),
          status === 'released' ? addDays(now, -between(1, Math.max(1, daysAgo - 2))).toISOString() : null,
          addDays(now, -between(0, Math.max(1, daysAgo - 1))).toISOString()]);
      bump('dev_issues');
    }

    // ── Deals ──────────────────────────────────────────────────────────────
    const stages = ['new', 'qualified', 'quoted', 'negotiation'];
    for (let i = 0; i < 80; i++) {
      const customer = pick(allCustomers);
      const owner = pick(rand() < 0.65 ? sales : presales);
      const value = between(3, 48) * 25000;
      const daysAgo = between(2, 190);
      const created = addDays(now, -daysAgo);
      const roll = rand();
      const stage = roll < 0.2 ? 'won' : roll < 0.34 ? 'lost' : pick(stages);
      const qualified = stage !== 'new' ? 1 : 0;
      const id = db.nextId('DL');
      const nextDue = addDays(now, between(-18, 21));
      db.run(`INSERT INTO deals (id, customer_id, title, stage, value, currency, owner_id, source, next_step, next_step_due, expected_close,
        stage_since, created_at, updated_at, qualified_need, qualified_budget, qualified_timeline, quote_attached, discount_pct, discount_status, po_received, won_at, lost_at, lost_reason)
        VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customer.id, pick(PRODUCTS), stage, value, owner.id, pick(SOURCES),
          stage === 'won' || stage === 'lost' ? '' : pick(['Send the revised quote', 'Demo at the store', 'Follow up on the PO', 'Share the RFID proposal', 'Call the owner back']),
          stage === 'won' || stage === 'lost' ? null : localDateString(nextDue),
          localDateString(addDays(now, between(-10, 70))),
          addDays(now, -between(0, Math.max(1, daysAgo - 1))).toISOString(), created.toISOString(), now.toISOString(),
          qualified, qualified, qualified,
          ['quoted', 'negotiation', 'won'].includes(stage) ? 1 : 0,
          ['negotiation', 'won'].includes(stage) && rand() < 0.5 ? between(3, 12) : 0,
          ['negotiation', 'won'].includes(stage) && rand() < 0.5 ? pick(['approved', 'pending']) : '',
          stage === 'won' ? 1 : 0,
          stage === 'won' ? addDays(now, -between(0, Math.max(1, daysAgo - 2))).toISOString() : null,
          stage === 'lost' ? addDays(now, -between(0, Math.max(1, daysAgo - 2))).toISOString() : null,
          stage === 'lost' ? pick(['Price too high', 'Went with a competitor', 'Budget postponed', 'No response after three follow-ups', 'Decided to continue with their current software']) : '']);
      bump('deals');

      // Activities: the follow-up history that makes the pipeline believable.
      const acts = between(2, 7);
      for (let a = 0; a < acts; a++) {
        const kind = pick(['call', 'visit', 'email', 'note', 'whatsapp']);
        const at = addDays(created, Math.round((daysAgo * a) / acts));
        const isVisit = kind === 'visit';
        db.run('INSERT INTO activities (deal_id, actor_id, kind, notes, lat, lng, km, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, owner.id, kind,
            pick(['Spoke to the owner, asked for a demo', 'Store visit, saw their current setup', 'Sent the proposal by email',
              'Owner is comparing with another vendor', 'Asked for RFID pricing separately', 'Wants to decide after the season',
              'Shared the AMC terms on WhatsApp', 'Met the accounts head about the Tally sync']),
            isVisit ? 18.5 + rand() * 2 : null, isVisit ? 73.8 + rand() * 2 : null,
            isVisit ? Math.round(rand() * 120) : 0, at.toISOString()]);
        bump('activities');
      }

      if (['quoted', 'negotiation', 'won'].includes(stage)) {
        const disc = ['negotiation', 'won'].includes(stage) && rand() < 0.5 ? between(3, 10) : 0;
        db.run('INSERT INTO quotes (id, deal_id, version, currency, list_total, discount_pct, total, status, approved_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)',
          [db.nextId('Q'), id, 'INR', value, disc, Math.round(value * (1 - disc / 100)),
            stage === 'won' ? 'accepted' : 'sent', disc > 5 ? coo.id : null, addDays(created, 3).toISOString()]);
        bump('quotes');
      }
    }

    // ── Work orders ────────────────────────────────────────────────────────
    const woStages = ['queued', 'in_progress', 'qc', 'packed', 'dispatched'];
    for (let i = 0; i < 64; i++) {
      const customer = pick(allCustomers);
      const daysAgo = between(1, 120);
      const created = addDays(now, -daysAgo);
      const stage = daysAgo > 40 ? 'dispatched' : pick(woStages);
      const promised = addDays(created, between(7, 25));
      const dispatched = stage === 'dispatched' ? addDays(promised, rand() < 0.78 ? -between(0, 5) : between(1, 9)) : null;
      const id = db.nextId('WO');
      db.run(`INSERT INTO work_orders (id, customer_id, deal_id, product, qty, kind, stage, assignee_id, promised_date, notes,
        started_at, qc_result, packed_at, dispatched_at, courier, consignment, invoice_ref, materials_status, created_by, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, 'order', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, customer.id, pick(PRODUCTS), between(1, 6), stage, pick(prod).id, localDateString(promised),
          pick(['Customer wants delivery before the festival', 'Tag quantity confirmed on call', 'Install along with the go-live', '']),
          stage !== 'queued' ? addDays(created, 1).toISOString() : null,
          ['qc', 'packed', 'dispatched'].includes(stage) ? (rand() < 0.9 ? 'pass' : 'rework') : '',
          ['packed', 'dispatched'].includes(stage) ? addDays(created, 5).toISOString() : null,
          dispatched?.toISOString() || null,
          dispatched ? pick(['Blue Dart', 'DTDC', 'Professional Couriers', 'Delhivery']) : '',
          dispatched ? String(between(100000000, 999999999)) : '',
          dispatched ? `INV-${between(2400, 2900)}` : '',
          rand() < 0.15 ? 'short' : 'ready', coo.id, created.toISOString(), now.toISOString()]);
      bump('work_orders');
    }

    // ── Procurement ────────────────────────────────────────────────────────
    for (let i = 0; i < 52; i++) {
      const [item, unit, supplier] = PROCUREMENT[i % PROCUREMENT.length];
      const daysAgo = between(1, 100);
      const status = daysAgo > 45 ? 'received' : pick(['requested', 'ordered', 'received', 'ordered']);
      db.run(`INSERT INTO procurement_items (id, item, qty, unit, needed_by, supplier, est_cost, status, work_order_id, deal_id, notes, created_by, created_at, ordered_at, expected_at, received_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
        [db.nextId('PR'), item, between(1, 40), unit,
          localDateString(addDays(now, between(-20, 40))), supplier, between(2, 90) * 1000, status, '',
          pick(prod).id, addDays(now, -daysAgo).toISOString(),
          status !== 'requested' ? addDays(now, -daysAgo + 2).toISOString() : null,
          localDateString(addDays(now, between(-10, 25))),
          status === 'received' ? addDays(now, -between(0, Math.max(1, daysAgo - 3))).toISOString() : null,
          now.toISOString()]);
      bump('procurement_items');
    }

    // ── Approvals: leave, expenses, purchases, discounts ───────────────────
    // Each kind gets its own 50+, so every approval screen has enough to work with
    // rather than one shared pile split four ways.
    const approvalPlan: string[] = [];
    for (const [kind, n] of [['leave', 54], ['expense', 54], ['purchase', 52], ['discount', 50]] as const) {
      for (let i = 0; i < n; i++) approvalPlan.push(kind);
    }
    for (let i = 0; i < approvalPlan.length; i++) {
      const who = pick(active.filter((e) => e.reporting_manager_id));
      const mgr = who.reporting_manager_id!;
      const daysAgo = between(1, 150);
      const at = addDays(now, -daysAgo);
      const type = approvalPlan[i];
      const decided = daysAgo > 5 ? (rand() < 0.82 ? 'approved' : 'declined') : null;
      let title = '', amount = 0;
      if (type === 'leave') {
        const days = between(1, 3);
        const from = addDays(at, between(2, 20));
        const kind = pick(['CL', 'SL', 'PL']);
        title = `Leave: ${who.full_name}, ${days} day${days > 1 ? 's' : ''} (${kind})`;
        amount = days;
        db.run('INSERT INTO leave_requests (id, employee_id, type, from_date, to_date, days, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [db.nextId('LV'), who.id, kind, localDateString(from), localDateString(addDays(from, days - 1)), days, pick(LEAVE_REASONS), decided || 'pending', at.toISOString()]);
        bump('leave_requests');
      } else if (type === 'expense') {
        const [cat, note, base] = pick(EXPENSES);
        amount = base + between(0, 900);
        title = `Expense: ₹${amount.toLocaleString('en-IN')} ${note}`;
        const linkDeal = cat === 'Travel' && rand() < 0.5 ? db.get<{ id: string }>('SELECT id FROM deals ORDER BY random() LIMIT 1')?.id || null : null;
        db.run('INSERT INTO expenses (id, employee_id, category, amount, description, status, created_at, deal_id, km) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [db.nextId('EX'), who.id, cat, amount, note, decided || 'pending', at.toISOString(), linkDeal, cat === 'Travel' || cat === 'Fuel' ? between(12, 320) : 0]);
        bump('expenses');
      } else if (type === 'purchase') {
        amount = between(4, 70) * 1000;
        title = `Purchase: ${pick(PROCUREMENT)[0]} (₹${amount.toLocaleString('en-IN')})`;
      } else {
        amount = between(4, 15);
        title = `Discount ${amount}% on ${pick(allCustomers).name}`;
      }
      db.run(`INSERT INTO tasks (id, kind, type, title, details, amount, assignee_id, requester_id, created_by, status, decided_by, decided_at, decision_note, link, payload, created_at, updated_at)
        VALUES (?, 'approval', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '/approvals', '{}', ?, ?)`,
        [db.nextId('TK'), type, title, pick(['', 'Needed before the end of the month.', 'Customer is waiting on this.', '']), amount,
          mgr, who.id, who.id, decided || 'open', decided ? mgr : null,
          decided ? addDays(at, 1).toISOString() : null,
          decided === 'declined' ? pick(['Not in this quarter', 'Take it from the existing stock', 'Reduce to 8% and resubmit']) : '',
          at.toISOString(), now.toISOString()]);
      bump('approvals');
    }

    // ── Assigned tasks ─────────────────────────────────────────────────────
    for (let i = 0; i < 60; i++) {
      const who = pick(active);
      const daysAgo = between(0, 60);
      const at = addDays(now, -daysAgo);
      const done = daysAgo > 7 && rand() < 0.7;
      const finishedAt = done ? addDays(at, between(1, 9)).toISOString() : null;
      db.run(`INSERT INTO tasks (id, kind, type, title, details, assignee_id, requester_id, created_by, status, due_at, decided_at, minutes_logged, link, payload, created_at, updated_at)
        VALUES (?, 'task', 'general', ?, '', ?, ?, ?, ?, ?, ?, ?, '', '{}', ?, ?)`,
        [db.nextId('TK'), pick(TASKS), who.id, coo.id, coo.id,
          done ? 'done' : (rand() < 0.3 ? 'in_progress' : 'open'),
          addDays(at, between(1, 14)).toISOString(), finishedAt,
          done ? between(20, 240) : 0, at.toISOString(), finishedAt || now.toISOString()]);
      bump('tasks');
    }

    // ── Man-hours ──────────────────────────────────────────────────────────
    const woIds = db.all<{ id: string }>('SELECT id FROM work_orders ORDER BY created_at DESC LIMIT 60').map((r) => r.id);
    for (let i = 0; i < 240; i++) {
      const who = pick(rand() < 0.6 ? prod : devs);
      const at = addDays(now, -between(0, 90));
      const target = rand() < 0.6 && woIds.length ? { t: 'work_order', id: pick(woIds) } : { t: 'issue', id: `D-${between(320, 380)}` };
      db.run('INSERT INTO time_logs (employee_id, entity_type, entity_id, minutes, note, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [who.id, target.t, target.id, between(30, 480),
          pick(['Assembly and testing', 'Tag encoding', 'Reader calibration', 'Bug fix and unit test', 'Customer call and debugging', 'Packing and labelling']),
          at.toISOString(), new Date(at.getTime() + 2 * 3_600_000).toISOString()]);
      bump('time_logs');
    }

    // ── Hiring ─────────────────────────────────────────────────────────────
    // Requisitions across the company, at every stage of approval, so the hiring
    // board has something to show and candidates are not all chasing one job.
    for (let i = 0; i < ROLES.length; i++) {
      const role = ROLES[i];
      const hod = active.find((e) => e.department_id === role.dept && e.functional_role === 'hod')
        || active.find((e) => e.department_id === role.dept && e.functional_role === 'team_lead')
        || coo;
      const req = saveRequisition(app, hr, {
        title: role.title, departmentId: role.dept, positions: role.positions, budgetCtc: role.ctc,
        experience: role.exp, location: role.dept === 'PRD' ? 'Pune — manufacturing unit' : 'Pune',
        justification: role.why, description: role.what, hiringManagerId: hod.id, recruiterId: hr.id
      });
      db.run('UPDATE requisitions SET created_at = ? WHERE id = ?', [addDays(now, -between(20, 110)).toISOString(), req.id]);
      // Most are open with their approval on record; one is paused and two are still drafts.
      if (i < ROLES.length - 2) openRequisition(app, hr, req.id, pick(['Approved by the COO, email of 14 Oct', 'Approved in the Monday review, minutes of 27 Oct', 'Approved by the CEO and COO, headcount plan FY26-27']));
      if (i === ROLES.length - 3) pauseRequisition(app, hr, req.id, 'Budget review for the quarter is pending');
      bump('requisitions');
    }
    const openReqs = db.all<{ id: string }>("SELECT id FROM requisitions WHERE status = 'open'");
    for (let i = 0; i < 72; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const c = saveCandidate(app, hr, {
        fullName: name,
        email: `${name.toLowerCase().replace(/ /g, '.')}.${between(10, 99)}@example.com`,
        phone: `9${between(100000000, 899999999)}`,
        currentEmployer: pick(['Softlink Systems', 'Vista Retail', 'Ginni Technologies', 'Appify Labs', 'Freelance', 'Infomatics Pune', 'Zenith Solutions', 'Techno Edge']),
        experienceYears: between(1, 9), currentCtc: between(3, 14) * 100000, expectedCtc: between(4, 18) * 100000,
        noticeDays: pick([0, 15, 30, 60, 90]), location: pick(['Pune', 'Mumbai', 'Nashik', 'Nagpur', 'Remote']),
        notes: pick(['Applied through Naukri.', 'Referred by a team member.', 'Walked in at the Pune office.', 'Found us on LinkedIn.'])
      });
      db.run('UPDATE candidates SET created_at = ? WHERE id = ?', [addDays(now, -between(1, 90)).toISOString(), c.id]);
      bump('candidates');
      if (openReqs.length && rand() < 0.85) {
        try {
          const a = addApplication(app, hr, { candidateId: c.id, requisitionId: pick(openReqs).id, source: pick(['naukri', 'referral', 'linkedin', 'walk-in', 'website']) });
          const roll = rand();
          const stage = roll < 0.25 ? 'applied' : roll < 0.5 ? 'screening' : roll < 0.6 ? 'assessment' : roll < 0.9 ? 'interview' : 'decision';
          const closed = rand() < 0.3;
          db.run("UPDATE applications SET stage = ?, stage_since = ?, created_at = ?, received_at = ?, status = ?, outcome = ?, outcome_reason = ?, decision_by = ?, decision_at = ? WHERE id = ?",
            [stage, addDays(now, -between(1, 40)).toISOString(), addDays(now, -between(2, 60)).toISOString(), addDays(now, -between(2, 60)).toISOString(),
              closed ? 'closed' : 'active', closed ? pick(['rejected', 'rejected', 'withdrawn', 'no_show']) : '',
              closed ? pick(['Gap on the ERP side is wider than we can train for.', 'Candidate took another offer before our round.', 'Expected CTC well above the approved band.']) : '',
              closed ? hr.id : null, closed ? addDays(now, -between(1, 20)).toISOString() : null, a.id]);
          bump('applications');
        } catch { /* duplicate on the same role: fine, skip */ }
      }
    }

    // ── Interviews, panels and scorecards ──────────────────────────────────
    // Enough rounds to exercise the part that matters: a panel of two or three,
    // scorecards arriving one at a time, and the others staying hidden until the
    // last one is in. A third are left part-submitted so that state is testable.
    const interviewable = db.all<{ id: string; stage: string }>(
      "SELECT id, stage FROM applications WHERE status = 'active' AND stage IN ('screening','interview','offer') ORDER BY random() LIMIT 60");
    const panelPool = active.filter((e) => ['SUP', 'DEV', 'QA', 'HR', 'SAL', 'PRE', 'PRD', 'ACC', 'DM'].includes(e.department_id));
    // The COO and the HODs take the final round, which is both true to how this
    // company hires and the reason the person testing sees interviews of their own.
    const seniors = active.filter((e) => e.functional_role === 'executive' || e.functional_role === 'hod');
    const EVIDENCE = [
      'Walked through a GST rate-change bug end to end: tax master first, then the cached rate table, then the invoice print.',
      'Could not explain what a 409 means or when to return one. Guessed twice.',
      'Described a real escalation at their current company and what they changed afterwards so it did not repeat.',
      'Wrote the stock reconciliation query on the whiteboard; missed the branch filter until prompted.',
      'Talked about a store go-live where the opening stock did not match, and how they handled the owner.',
      'Strong on Tally concepts, lighter on the hardware side. Would need two weeks on the readers.',
      'Explained karigar job work settlement clearly, including the wastage handling.',
      'Froze on the follow-up about handling an angry customer on a Saturday.'
    ];
    for (let i = 0; i < interviewable.length; i++) {
      const appRow = interviewable[i];
      const rounds = appRow.stage === 'offer' ? 2 : rand() < 0.3 ? 2 : 1;
      for (let r = 1; r <= rounds; r++) {
        const daysOff = between(-45, 12);
        const starts = addDays(now, daysOff);
        starts.setUTCHours(between(4, 11), pick([0, 30]), 0, 0);
        const ends = new Date(starts.getTime() + between(30, 75) * 60_000);
        const past = starts < now;
        const status = past ? (rand() < 0.86 ? 'completed' : rand() < 0.6 ? 'no_show' : 'cancelled') : 'scheduled';
        const id = db.nextId('INT');
        db.run(`INSERT INTO interviews (id, application_id, round, round_type, mode, location, starts_at, ends_at, status, candidate_informed, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, appRow.id, r, r === 1 ? pick(['screening', 'technical']) : pick(['managerial', 'hr', 'practical']),
            pick(['in_person', 'video', 'phone']),
            pick(['Pune office, meeting room 2', 'Pune office, cabin 1', 'Google Meet', 'Phone']),
            starts.toISOString(), ends.toISOString(), status, past || rand() < 0.8 ? 1 : 0,
            hr.id, addDays(starts, -between(2, 8)).toISOString()]);
        bump('interviews');

        const size = rand() < 0.45 ? 3 : 2;
        const panel: Employee[] = [];
        // A final round always has a senior on it.
        if (r > 1 || appRow.stage === 'offer') panel.push(pick(seniors.length ? seniors : panelPool));
        while (panel.length < size) { const c = pick(panelPool); if (!panel.some((x) => x.id === c.id)) panel.push(c); }
        for (const member of panel) db.run('INSERT OR IGNORE INTO interview_panel (interview_id, interviewer_id) VALUES (?, ?)', [id, member.id]);

        if (status !== 'completed') continue;
        // Everyone submits two thirds of the time; otherwise one is still outstanding,
        // which is exactly the state where the others must stay hidden.
        const submitters = rand() < 0.66 ? panel : panel.slice(0, panel.length - 1);
        for (const member of panel) {
          const submitted = submitters.includes(member);
          const base = between(2, 5);
          const ratings = { skill: base, problem: Math.max(1, Math.min(5, base + between(-1, 1))), communication: Math.max(1, Math.min(5, base + between(-1, 1))), ownership: Math.max(1, Math.min(5, base + between(-1, 1))), fit: Math.max(1, Math.min(5, base + between(-1, 1))) };
          const vals = Object.values(ratings);
          const overall = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
          db.run(`INSERT INTO scorecards (interview_id, interviewer_id, ratings, overall, recommendation, notes, evidence, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, member.id, JSON.stringify(ratings), overall,
              overall >= 4.2 ? 'strong_yes' : overall >= 3.3 ? 'yes' : overall >= 2.4 ? 'no' : 'strong_no',
              pick(['', '', 'Would need onboarding support for the first month.', 'Worth a second conversation with the HOD.']),
              pick(EVIDENCE),
              submitted ? new Date(ends.getTime() + between(30, 600) * 60_000).toISOString() : null,
              ends.toISOString()]);
          bump('scorecards');
        }
      }
    }

    // ── Offers at every stage of the flow ──────────────────────────────────
    // Drafted, waiting on the COO, approved but not yet issued, out with the
    // candidate, accepted and declined — so each button on the page has a row
    // to press it against.
    const offerable = db.all<{ id: string; candidate_id: string; requisition_id: string }>(
      "SELECT id, candidate_id, requisition_id FROM applications WHERE status = 'active' AND stage IN ('interview','decision','offer') ORDER BY random() LIMIT 14");
    let acceptedSeen = 0;
    const offerStates = ['draft', 'draft', 'draft', 'issued', 'issued', 'issued', 'issued', 'accepted', 'accepted', 'accepted', 'declined', 'cancelled', 'expired', 'draft'];
    for (let i = 0; i < offerable.length; i++) {
      const appRow = offerable[i];
      const req = db.get<{ title: string; budget_ctc: number | null; department_id: string }>(
        'SELECT title, budget_ctc, department_id FROM requisitions WHERE id = ?', [appRow.requisition_id]);
      if (!req) continue;
      const state = offerStates[i % offerStates.length];
      const ctc = Math.round(((req.budget_ctc || 500000) * (0.86 + rand() * 0.22)) / 1000) * 1000;
      const joining = addDays(now, between(10, 55));
      // An offer follows a recorded decision to hire.
      db.run("UPDATE applications SET stage = 'offer' WHERE id = ?", [appRow.id]);
      db.run('INSERT INTO hiring_decisions (application_id, outcome, rationale, evidence, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?)', [appRow.id, 'hire', pick(['Panel agreed after the final round. Strong on the core skills and clear with customers.', 'Both interviewers recommended. Good fit with the team and available within the notice period.']), '{}', hr.id, addDays(now, -between(6, 32)).toISOString()]);
      let offer;
      try {
        offer = draftOffer(app, hr, {
          applicationId: appRow.id, ctcAnnual: ctc, designation: req.title,
          joiningDate: localDateString(joining), expiryDate: localDateString(addDays(now, between(3, 12))),
          body: pick(['Six months probation. Laptop provided.', 'Six months probation. Travel reimbursed at actuals.', 'Includes the standard retention clause for the first year.'])
        });
      } catch { continue; }
      if (state === 'draft') { bump('offers'); continue; }

      const issuedAt = addDays(now, -between(1, 18));
      db.run('UPDATE offers SET status = ?, issued_by = ?, issued_at = ?, responded_at = ?, response_note = ?, created_at = ? WHERE id = ?',
        [state, ['issued', 'accepted', 'declined', 'expired'].includes(state) ? hr.id : null,
          ['issued', 'accepted', 'declined', 'expired'].includes(state) ? issuedAt.toISOString() : null,
          ['accepted', 'declined', 'expired', 'cancelled'].includes(state) ? addDays(issuedAt, between(1, 6)).toISOString() : null,
          state === 'accepted' ? 'Accepted on call, joining as agreed.'
            : state === 'declined' ? pick(['Took a counter-offer from their current company.', 'Another offer came in ten thousand higher.', 'Family reasons, not relocating to Pune.'])
            : '',
          addDays(now, -between(5, 30)).toISOString(), offer.id]);

      if (state === 'accepted') {
        // Accepted offers are in onboarding. One is finished (hired), one is half way, one has just started.
        db.run("UPDATE applications SET stage = 'onboarding', stage_since = ? WHERE id = ?", [addDays(issuedAt, 3).toISOString(), appRow.id]);
        const ob = startOnboarding(app, hr, getApplication(app, appRow.id)!, getOffer(app, offer.id)!);
        const nth = acceptedSeen++;
        if (nth < 2) {
          const empId = `LS9${String(nth + 1).padStart(2, '0')}`;
          const cand = db.get<{ full_name: string; phone: string }>('SELECT full_name, phone FROM candidates WHERE id = ?', [appRow.candidate_id])!;
          db.run(`INSERT INTO employees (id, full_name, email, designation, department_id, sub_team, site_id, functional_role, reporting_manager_id, shift_code, join_date, employment_type, status, lang, is_admin, mobile, pagarguru_code, must_change_password, failed_logins, created_at, updated_at, hired_from_candidate)
            VALUES (?, ?, ?, ?, ?, '', (SELECT id FROM sites ORDER BY id LIMIT 1), 'ic', ?, 'GEN', ?, 'probation', 'active', 'en', 0, ?, '', 1, 0, ?, ?, ?)`,
            [empId, cand.full_name, `${cand.full_name.toLowerCase().replace(/[^a-z]+/g, '.')}@loyalstring.com`, req.title, req.department_id, coo.id, localDateString(addDays(now, -between(5, 25))), cand.phone, now.toISOString(), now.toISOString(), appRow.candidate_id]);
          db.run('UPDATE onboardings SET employee_id = ? WHERE id = ?', [empId, ob.id]);
          db.run("UPDATE onboarding_items SET done_at = ?, done_by = ? WHERE onboarding_id = ? AND key = 'employee_record'", [now.toISOString(), hr.id, ob.id]);
          for (const it of onboardingItems(app, ob.id)) {
            if (it.key === 'employee_record') continue;
            if (nth === 0 || ['documents', 'it_setup', 'induction'].includes(it.key)) setOnboardingItem(app, hr, it.id, true);
          }
          if (nth === 0) completeOnboarding(app, hr, appRow.id);
        }
        void onboardingOf;
      } else if (state === 'declined') {
        db.run("UPDATE applications SET status = 'closed', outcome = 'offer_declined', outcome_reason = 'Candidate declined the offer', decision_by = ?, decision_at = ? WHERE id = ?",
          [hr.id, addDays(issuedAt, 4).toISOString(), appRow.id]);
      } else if (state === 'expired') {
        db.run("UPDATE applications SET status = 'closed', outcome = 'offer_expired', outcome_reason = 'The offer passed its expiry date without a reply', decision_at = ? WHERE id = ?", [addDays(issuedAt, 8).toISOString(), appRow.id]);
      } else if (state === 'cancelled') {
        db.run("UPDATE applications SET stage = 'decision' WHERE id = ?", [appRow.id]);
      }
      bump('offers');
    }

    // ── Workplace English assessments in every state ───────────────────────
    const assessable = db.all<{ id: string }>("SELECT id FROM applications WHERE status = 'active' AND stage IN ('screening', 'assessment', 'interview') ORDER BY random() LIMIT 14");
    const WRITING = [
      'Dear Sir, I am sorry but I cannot come this Sunday because my sister has her engagement function. I can work on Saturday or next Sunday instead. Please tell me which day is better. Thank you for understanding. Regards.',
      'Dear Madam, Thank you for writing to us and I am very sorry that your order came late and one item was missing. We confirmed the order before checking the stock, which was our mistake. I have sent the missing item today by courier and you will receive it by Thursday. I have also added a note so this does not happen again. Please write to me directly if there is any problem.',
      'sir i not come sunday. family function is there. i come other day ok',
      'Hello, sorry for late. Item we will send soon. Thanks.'
    ];
    assessable.forEach((row, i) => {
      const level = i % 3 === 0 ? 'B1' : 'A2';
      const state = ['invited', 'invited', 'started', 'submitted', 'submitted', 'submitted', 'reviewed', 'reviewed', 'reviewed', 'expired', 'reviewed', 'submitted', 'invited', 'reviewed'][i];
      const created = addDays(now, -between(1, 12));
      const { id, token } = issueForSeed(app, hr, row.id, level, addDays(state === 'expired' ? created : now, state === 'expired' ? 2 : between(2, 9)).toISOString());
      db.run('UPDATE assessment_invitations SET created_at = ? WHERE id = ?', [created.toISOString(), id]);
      bump('assessments');
      if (state === 'invited') return;
      if (state === 'expired') { db.run("UPDATE assessment_invitations SET status = 'expired' WHERE id = ?", [id]); return; }
      const began = state === 'started' ? new Date(now.getTime() - 6 * 60_000) : addDays(created, 1);
      beginAttempt(app, token, began);
      const tpl = TEMPLATES[level];
      const skill = 0.35 + rand() * 0.6;
      const answers: Record<string, number> = {};
      for (const item of tpl.items) answers[item.id] = rand() < skill ? item.answer : (item.answer + 1) % item.options.length;
      const writing = level === 'B1' ? (skill > 0.6 ? WRITING[1] : WRITING[3]) : (skill > 0.6 ? WRITING[0] : WRITING[2]);
      if (state === 'started') { saveAttempt(app, token, { answers: Object.fromEntries(Object.entries(answers).slice(0, 6)), writing: '' }, new Date(began.getTime() + 60_000)); return; }
      submitAttempt(app, token, { answers, writing }, new Date(began.getTime() + between(12, 24) * 60_000));
      if (state === 'reviewed') {
        const base = skill > 0.6 ? 3 : 1;
        saveReview(app, hr, id, { scores: { task: Math.min(4, base + between(0, 1)), organisation: base, grammar: Math.max(0, base - between(0, 1)), vocabulary: base, tone: Math.min(4, base + between(0, 1)) }, outcome: skill > 0.75 ? 'meets' : skill > 0.55 ? 'borderline' : 'below', note: skill > 0.6 ? 'Clear and polite. Small grammar slips only.' : 'Message is understood but too short and informal for a customer.' });
      }
    });

    // ── Miss-punch requests in every state, so the report has something to say ──
    const REASONS: [string, string][] = [['forgot', 'Forgot to punch while coming in'], ['forgot', 'Left in a hurry and forgot the out punch'], ['machine', 'The machine did not read my finger'], ['field', 'Went straight to the customer site'], ['early_late', 'Stayed late after the machine was switched off'], ['other', 'Was in a meeting on another floor']];
    const frequent = active.slice(3, 6).map((e) => e.id);
    for (let i = 0; i < 64; i++) {
      const e = i % 4 === 0 ? emp(pick(frequent))! : pick(active);
      const mgr = emp(e.reporting_manager_id || '') || coo;
      const date = localDateString(addDays(now, -between(1, 85)));
      if (new Date(date + 'T06:00:00Z').getUTCDay() === 0) continue;
      if (db.get('SELECT id FROM attendance_regularisations WHERE employee_id = ? AND date = ?', [e.id, date])) continue;
      const [code, textReason] = pick(REASONS); const kind = pick(['in', 'out', 'both', 'in']);
      const state = pick(['approved', 'approved', 'approved', 'approved', 'declined_tl', 'declined_hr', 'validated', 'pending']);
      const asked = addDays(new Date(date + 'T10:00:00Z'), 1); const v = addDays(asked, 1); const h = addDays(asked, 2);
      const id = db.nextId('RG', 100);
      db.run(`INSERT INTO attendance_regularisations (id, employee_id, date, requested_in, requested_out, reason, status, created_at, kind, reason_code, validated_by, validated_at, validator_note, decided_by, decided_at, hr_note, declined_stage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, e.id, date, '09:35', '18:40', textReason, state === 'declined_tl' || state === 'declined_hr' ? 'declined' : state, asked.toISOString(), kind, code,
          state === 'pending' ? null : mgr.id, state === 'pending' ? null : v.toISOString(), state === 'pending' ? '' : state === 'declined_tl' ? 'Was not in the office that morning' : pick(['Confirmed, was at the desk', 'Seen in the stand-up', 'Customer visit is in the ticket']),
          state === 'approved' || state === 'declined_hr' ? hr.id : null, state === 'approved' || state === 'declined_hr' ? h.toISOString() : null,
          state === 'approved' ? pick(['Matches the gate register', 'Manager confirmed', 'Machine fault logged that day']) : state === 'declined_hr' ? 'Fourth request this month with no supporting record' : '',
          state === 'declined_tl' ? 'team_lead' : state === 'declined_hr' ? 'hr' : '']);
      bump('miss_punch_requests');
    }
    // Machine user IDs for everyone (the number in their employee ID), ready for a punching machine or a punch file.
    for (const e of active) { const n = String(Number(e.id.replace(/\D/g, '')) || 0); if (n !== '0' && !db.get('SELECT id FROM employees WHERE device_pin = ?', [n])) db.run('UPDATE employees SET device_pin = ? WHERE id = ?', [n, e.id]); }

    // A few applications on hold, one of them overdue for follow-up.
    const holdable = db.all<{ id: string }>("SELECT id FROM applications WHERE status = 'active' AND stage IN ('screening', 'interview') ORDER BY random() LIMIT 4");
    holdable.forEach((h, i) => {
      try {
        holdApplication(app, hr, h.id, pick(['Candidate asked for two weeks to finish a project', 'Waiting for the hiring manager to return from leave', 'Budget for this seat is being confirmed']), localDateString(addDays(now, i === 0 ? 1 : between(4, 15))));
        if (i === 0) db.run('UPDATE applications SET hold_until = ? WHERE id = ?', [localDateString(addDays(now, -3)), h.id]);
      } catch { /* skip */ }
    });

    // Whoever is testing should see interviews of their own, not an empty panel.
    // The COO and the HR lead sit on a few of the upcoming final rounds.
    for (const person of [coo, hr]) {
      const upcoming = db.all<{ id: string }>(
        `SELECT i.id FROM interviews i WHERE i.status = 'scheduled' AND i.starts_at > ?
           AND NOT EXISTS (SELECT 1 FROM interview_panel p WHERE p.interview_id = i.id AND p.interviewer_id = ?)
         ORDER BY i.starts_at LIMIT 3`, [now.toISOString(), person.id]);
      for (const iv of upcoming) {
        db.run('INSERT OR IGNORE INTO interview_panel (interview_id, interviewer_id) VALUES (?, ?)', [iv.id, person.id]);
      }
    }

    // A role closes because it was filled, not before anyone applied — so pick one
    // that actually produced a hire.
    const filled = db.get<{ id: string }>(`SELECT r.id FROM requisitions r
      JOIN applications a ON a.requisition_id = r.id AND a.outcome = 'hired'
      WHERE r.status = 'open' LIMIT 1`);
    if (filled) closeRequisition(app, hr, filled.id, 'Position filled — offer accepted');

    // ── Notifications worth looking at ─────────────────────────────────────
    for (let i = 0; i < 60; i++) {
      const who = pick(active);
      const at = addDays(now, -between(0, 20));
      const kind = pick(['info', 'warn', 'critical', 'success']);
      db.run('INSERT INTO notifications (employee_id, title, body, link, kind, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [who.id, pick(['Ticket assigned to you', 'SLA warning at 50%', 'Approval decided', 'Work order dispatched', 'New lead assigned', 'Sprint issue moved to QA']),
          pick(['Check the desk for details.', 'Half the clock has gone.', 'See approvals.', 'Consignment number added.']),
          pick(['/desk', '/approvals', '/production', '/pipeline']), kind,
          rand() < 0.5 ? at.toISOString() : null, at.toISOString()]);
      bump('notifications');
    }

    db.run("INSERT OR REPLACE INTO settings (key, value, updated_by, updated_at) VALUES ('bulkSeeded', ?, ?, ?)",
      [JSON.stringify({ at: now.toISOString() }), coo.id, now.toISOString()]);
  });

  // SOP instances for the recent past, generated the way the scheduler would.
  let sopDays = 0;
  for (let d = 45; d >= 0; d--) { try { sopDays += generateInstances(app, addDays(now, -d)); } catch { /* holiday or no SOP due */ } }
  if (sopDays) bump('sop_instances', sopDays);

  // Work the backlog of checklists the way a team actually would: most days done,
  // most steps on time, a tail of misses and a few left half finished. Without this
  // SOP compliance reads 4% and the whole escalation chain is untestable.
  const openRuns = db.all<{ id: string; date: string; assignee_id: string | null; steps: string }>(
    "SELECT id, date, assignee_id, steps FROM sop_instances WHERE status <> 'complete'");
  let ticked = 0;
  db.transaction(() => {
    for (const run of openRuns) {
      if (run.date >= localDateString(now)) continue; // leave today's for the tester to tick
      let steps: { done?: boolean; doneAt?: string; by?: string; onTime?: boolean; dueAt?: string; evidenceText?: string }[];
      try { steps = JSON.parse(run.steps); } catch { continue; }
      const roll = rand();
      // 74% fully done, 14% partly done, 12% untouched and overdue.
      const share = roll < 0.74 ? 1 : roll < 0.88 ? 0.5 + rand() * 0.3 : 0;
      if (share === 0) continue;
      const upto = Math.max(1, Math.round(steps.length * share));
      for (let i = 0; i < upto; i++) {
        const due = steps[i].dueAt ? new Date(steps[i].dueAt!) : new Date(`${run.date}T06:00:00.000Z`);
        const late = rand() < 0.17;
        const at = new Date(due.getTime() + (late ? between(20, 240) : -between(5, 90)) * 60_000);
        steps[i] = Object.assign({}, steps[i], {
          done: true, doneAt: at.toISOString(), by: run.assignee_id || coo.id,
          onTime: !late, evidenceText: steps[i].evidenceText || ''
        });
        ticked++;
      }
      const all = steps.every((x) => x.done);
      db.run('UPDATE sop_instances SET steps = ?, status = ?, completed_at = ? WHERE id = ?',
        [JSON.stringify(steps), all ? 'complete' : 'open',
          all ? new Date(`${run.date}T12:00:00.000Z`).toISOString() : null, run.id]);
    }
  });
  if (ticked) bump('sop_steps_completed', ticked);

  return counts;
}
