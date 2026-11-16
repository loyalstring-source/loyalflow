// Demo data: realistic sample customers, tickets, deals, work orders, approvals, SOP history and KPI history.
// Only loaded when LOYALFLOW_DEMO=1 (or `npm run seed:demo`). Production starts with the master data only.
import type { App } from '../app.ts';
import { addDays, isoWeek, localDateString, weekStart } from '../lib/time.ts';
import { dueDates, type Priority } from '../modules/desk/service.ts';
import { createCustomer, createDeal, addActivity, createQuote, updateDeal, moveDeal, winDeal } from '../modules/sales/service.ts';
import { createWorkOrder, moveWorkOrder } from '../modules/production/service.ts';
import { createTask, requestLeave, submitExpense, decideTask } from '../modules/tasks/service.ts';
import { generateInstances, listInstances, instanceSteps, listSops, startInstance, isWorkingDayFor } from '../modules/sops/service.ts';
import { KPI_DEFS, recordManual, weekPeriod } from '../modules/kpi/engine.ts';
import { getEmployee, type Employee } from '../modules/people/model.ts';
import { saveProcurement, setProcurementStatus, setBudget, logTime, setMaterials } from '../modules/ops/service.ts';
import { saveProject, ensureSprint, startSprint, saveRelease, addToRelease, addCheck, setCheck, addComment, signRelease } from '../modules/dev/service.ts';
import { createDevIssue, setDevStatus } from '../modules/desk/service.ts';
import { listWorkOrders } from '../modules/production/service.ts';
import { fiscalYear, fromLocal, toLocal } from '../lib/time.ts';
import { saveStructure, suggestSplit, buildRun, approveRun, markPaid } from '../modules/hr/payroll.ts';
import { requestRegularisation, applyRegularisationDecision } from '../modules/hr/attendance.ts';
import { createCycle, openCycle, listAppraisals, submitSelf, submitManager, moderate, generateProbationReviews } from '../modules/hr/appraisal.ts';
import { saveRequisition, openRequisition, recordDecision, saveCandidate, addApplication, moveStage, screeningNotes, scheduleInterview, setInterviewStatus, saveScorecard, closeApplication, draftOffer, issueOffer } from '../modules/hr/recruiting.ts';
import { shiftByCode, holidaySet, setSetting } from '../lib/settings.ts';
import { isWorkingDay } from '../lib/time.ts';

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CUSTOMERS = [
  ['Kalyani Steel', 'Pune', 'Manufacturing', 'Plant head', 'Reference'], ['Omkar Tech', 'Pune', 'Software', 'CFO', 'Reference'], ['Shree Packaging', 'Mumbai', 'Manufacturing', 'MD', 'Website form'],
  ['Nirmal Agro', 'Nashik', 'Agro', 'Owner', 'Reference'], ['Sai Industries', 'Pune', 'Manufacturing', 'Director', 'Exhibition'], ['Vardhman Tools', 'Kolhapur', 'Manufacturing', 'Production head', 'Reference'],
  ['Prakash Fabricators', 'Pune', 'Manufacturing', 'Owner', 'IndiaMART'], ['Prime Foods', 'Nagpur', 'FMCG', 'Owner', 'IndiaMART'], ['Mahalaxmi Castings', 'Pune', 'Manufacturing', 'Purchase head', 'IndiaMART'],
  ['Aarav Plastics', 'Pune', 'Manufacturing', 'Owner', 'Website form'], ['Siddhi Engineering', 'Pune', 'Manufacturing', 'Plant manager', 'Reference'], ['Ganesh Auto Parts', 'Aurangabad', 'Auto', 'Director', 'Cold call'],
  ['Tulsi Agro Tools', 'Nashik', 'Agro', 'Owner', 'Exhibition'], ['Deccan Textiles', 'Solapur', 'Textile', 'GM', 'Reference']
];

export function seedDemo(app: App): void {
  const { db } = app;
  if (db.get('SELECT id FROM customers LIMIT 1')) return; // already seeded
  const rand = rng(20261102);
  const now = new Date();
  const emp = (id: string): Employee => getEmployee(db, id)!;
  const coo = emp('LS002'), prasad = emp('LS020'), aditya = emp('LS021'), ayush = emp('LS022'), chandu = emp('LS023'), nikita = emp('LS024'), deepika = emp('LS025'), nagesh = emp('LS027');
  const sanpreet = emp('LS034'), alpesh = emp('LS029'), murugan = emp('LS028'), madhuri = emp('LS037'), lukman = emp('LS039'), karan = emp('LS007'), rahulPund = emp('LS005');
  const agents = [aditya, ayush, chandu, nikita, deepika, nagesh];
  const bdms = ['LS029', 'LS030', 'LS031', 'LS032', 'LS033', 'LS034', 'LS035'].map(emp);

  db.transaction(() => {
    const customers = CUSTOMERS.map(([name, city, segment, contact, source]) => createCustomer(app, coo, { name, city, segment, contact_name: contact, source, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: '98XXXXXXXX' }));
    const cust = (name: string) => customers.find((c) => c.name === name)!;

    // Tickets: backdated inserts so SLA clocks and history look real.
    const insertTicket = (o: { customer: string; subject: string; priority: Priority; status: string; assignee: Employee | null; hoursAgo: number; type?: string; resolvedHoursAgo?: number; within?: number; rating?: number; reopen?: number; devIssue?: string; responded?: boolean; implDays?: number }) => {
      const created = new Date(now.getTime() - o.hoursAgo * 3_600_000);
      const due = dueDates(app, o.priority, created);
      const responseDue = due.responseDue;
      const resolveDue = o.type === 'implementation' ? new Date(created.getTime() + (o.implDays || 21) * 86_400_000) : due.resolveDue;
      const id = db.nextId('T');
      const resolvedAt = o.resolvedHoursAgo !== undefined ? new Date(now.getTime() - o.resolvedHoursAgo * 3_600_000) : null;
      const within = resolvedAt ? (o.within ?? (resolvedAt <= resolveDue ? 1 : 0)) : null;
      db.run(`INSERT INTO tickets (id, customer_id, subject, description, type, category, priority, status, assignee_id, created_by, channel, created_at, first_response_at, response_due_at, resolve_due_at, resolved_at, closed_at, within_sla, dev_issue_id, rating, reopen_count, impl_plan_days, impl_stage, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, cust(o.customer).id, o.subject, '', o.type || 'support', '', o.priority, o.status, o.assignee?.id || null, prasad.id, 'phone', created.toISOString(),
          o.responded === false ? null : new Date(created.getTime() + 25 * 60_000).toISOString(), responseDue.toISOString(), resolveDue.toISOString(), resolvedAt?.toISOString() || null,
          o.status === 'closed' ? resolvedAt?.toISOString() || null : null, within, o.devIssue || null, o.rating ?? null, o.reopen || 0, o.implDays || null, o.type === 'implementation' ? 'setup' : null, created.toISOString()]);
      db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [id, 'created', 'Ticket raised by phone; Smartflo recording attached', prasad.id, created.toISOString()]);
      if (o.assignee) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [id, 'assigned', `Assigned to ${o.assignee.full_name}`, prasad.id, new Date(created.getTime() + 8 * 60_000).toISOString()]);
      if (o.responded !== false) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [id, 'reply', 'First response sent; asked the customer for details', o.assignee?.id || prasad.id, new Date(created.getTime() + 25 * 60_000).toISOString()]);
      if (resolvedAt) db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [id, 'resolved', within === 1 ? 'Resolved within SLA' : 'Resolved outside SLA', o.assignee?.id || prasad.id, resolvedAt.toISOString()]);
      return id;
    };

    const nowIso = now.toISOString();
    const dev = (id: string, title: string, status: string, priority: Priority, assignee: string, daysAgo: number, releasedDaysAgo?: number) => {
      db.run('INSERT INTO dev_issues (id, title, description, status, priority, sprint, assignee_id, created_by, created_at, released_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, title, '', status, priority, 'Sprint 45', assignee, karan.id, addDays(now, -daysAgo).toISOString(), releasedDaysAgo !== undefined ? addDays(now, -releasedDaysAgo).toISOString() : null, nowIso]);
    };
    dev('D-312', 'Invoice sync shows old GST rate after update', 'in_qa', 'P2', 'LS012', 6);
    dev('D-318', 'Stock count mismatch after CSV import', 'planned', 'P2', 'LS009', 3);
    dev('D-305', 'Report export blank when month has no data', 'in_progress', 'P3', 'LS013', 9);
    dev('D-299', 'SMS alerts not delivered for some carriers', 'released', 'P2', 'LS015', 16, 2);
    dev('D-301', 'Dispatch screen slow with 500+ orders', 'in_review', 'P3', 'LS014', 8);
    db.run("UPDATE counters SET value = 320 WHERE name = 'D'");

    // Projects, sprints, releases (v1.2)
    const floorApp = saveProject(app, karan, { name: 'Floor app v3', description: 'Android floor application: offline dispatch, RFID gate, Hindi UI.', kind: 'product', ownerId: 'LS009', startDate: localDateString(addDays(now, -40)), targetDate: localDateString(addDays(now, 35)), notes: 'Risk: RFID reader firmware from vendor slips.' });
    const kalyaniImpl = saveProject(app, karan, { name: 'Kalyani Steel implementation', kind: 'customer', ownerId: 'LS012', startDate: localDateString(addDays(now, -20)), targetDate: localDateString(addDays(now, 10)), description: 'Go-live of floor tracking at the Chakan plant.' });
    saveProject(app, karan, { name: 'Internal: Tally sync', kind: 'internal', ownerId: 'LS013', startDate: localDateString(addDays(now, -5)), targetDate: localDateString(addDays(now, 60)), description: 'Invoice and receivables sync with Tally Prime.' });
    const lastSprint = ensureSprint(app, addDays(weekStart(now), -7), 'Stabilise dispatch and GST fixes');
    const thisSprint = ensureSprint(app, now, 'Kalyani go-live readiness');
    ensureSprint(app, addDays(weekStart(now), 7));
    db.run("UPDATE sprints SET status = 'closed', closed_at = ?, committed_count = 6, committed_points = 21 WHERE id = ?", [addDays(now, -3).toISOString(), lastSprint.id]);
    db.run("UPDATE dev_issues SET type = 'bug', project_id = ?, sprint_id = ?, points = 3, estimate_hours = 6, component = 'Integrations', started_at = ?, qa_at = ? WHERE id = 'D-312'", [floorApp.id, thisSprint.id, addDays(now, -4).toISOString(), addDays(now, -1).toISOString()]);
    db.run("UPDATE dev_issues SET type = 'bug', project_id = ?, sprint_id = ?, points = 5, estimate_hours = 10, component = 'Imports' WHERE id = 'D-318'", [floorApp.id, thisSprint.id]);
    db.run("UPDATE dev_issues SET type = 'bug', project_id = ?, sprint_id = ?, points = 2, estimate_hours = 4, component = 'Reports', started_at = ? WHERE id = 'D-305'", [floorApp.id, thisSprint.id, addDays(now, -2).toISOString()]);
    db.run("UPDATE dev_issues SET type = 'bug', project_id = ?, sprint_id = ?, points = 3, estimate_hours = 5, component = 'Notifications', started_at = ? WHERE id = 'D-299'", [floorApp.id, lastSprint.id, addDays(now, -12).toISOString()]);
    db.run("UPDATE dev_issues SET type = 'change', project_id = ?, sprint_id = ?, points = 5, estimate_hours = 12, component = 'Floor app', started_at = ? WHERE id = 'D-301'", [floorApp.id, thisSprint.id, addDays(now, -6).toISOString()]);
    const f1 = createDevIssue(app, karan, { title: 'RFID gate read at conveyor speed', description: 'Reads must succeed at 1.2 m/s with 4 antennas.', type: 'feature', priority: 'P2', projectId: floorApp.id, sprintId: thisSprint.id, assigneeId: 'LS009', points: 8, estimateHours: 20, component: 'Floor app', acceptance: '95% read rate on the test rig over 200 passes.' });
    setDevStatus(app, karan, f1.id, 'in_progress');
    const f2 = createDevIssue(app, karan, { title: 'Hindi labels on dispatch screen', type: 'feature', priority: 'P3', projectId: floorApp.id, sprintId: thisSprint.id, assigneeId: 'LS014', points: 2, estimateHours: 4, component: 'Floor app' });
    setDevStatus(app, karan, f2.id, 'in_progress'); setDevStatus(app, karan, f2.id, 'in_review'); setDevStatus(app, karan, f2.id, 'in_qa'); setDevStatus(app, karan, f2.id, 'ready');
    const f3 = createDevIssue(app, karan, { title: 'Kalyani: import opening stock from their ERP export', type: 'support', priority: 'P2', projectId: kalyaniImpl.id, sprintId: thisSprint.id, assigneeId: 'LS012', points: 3, estimateHours: 6, customerId: db.get<{ id: string }>("SELECT id FROM customers WHERE name = 'Kalyani Steel'")?.id || null, dueDate: localDateString(addDays(now, 3)) });
    const f4 = createDevIssue(app, karan, { title: 'Offline queue loses photos when app is killed', type: 'bug', priority: 'P1', projectId: floorApp.id, sprintId: thisSprint.id, assigneeId: 'LS008', points: 5, estimateHours: 8, component: 'Floor app' });
    setDevStatus(app, karan, f4.id, 'in_progress');
    db.run("UPDATE dev_issues SET blocked = 1, blocked_reason = 'Waiting for vendor firmware 2.4' WHERE id = ?", [f1.id]);
    createDevIssue(app, karan, { title: 'Receivables ageing report from Tally', type: 'feature', priority: 'P3', projectId: db.get<{ id: string }>("SELECT id FROM projects WHERE name LIKE 'Internal%'")?.id || null, points: 5, estimateHours: 16, component: 'Integrations' });
    createDevIssue(app, karan, { title: 'Upgrade .NET runtime on the API server', type: 'tech_debt', priority: 'P4', projectId: floorApp.id, points: 3, estimateHours: 6, component: 'API' });
    createDevIssue(app, karan, { title: 'Dark mode for the floor tablet at night', type: 'change', priority: 'P4', projectId: floorApp.id, points: 2 });
    startSprint(app, karan, thisSprint.id);
    addCheck(app, karan, f1.id, 'subtask', 'Bench test with 2 antennas'); const c2 = addCheck(app, karan, f1.id, 'subtask', 'Bench test with 4 antennas'); addCheck(app, karan, f1.id, 'subtask', 'Conveyor test at Chakan'); setCheck(app, emp('LS009'), c2.id, true);
    const t1 = addCheck(app, emp('LS018'), 'D-312', 'test', 'GST 18% invoice syncs with correct rate'); setCheck(app, emp('LS018'), t1.id, true, 'pass');
    const t2 = addCheck(app, emp('LS018'), 'D-312', 'test', 'Credit note after rate change'); void t2;
    addComment(app, emp('LS012'), 'D-312', 'Root cause was a cached tax table; fix is in review on the sync service.');
    addComment(app, karan, f4.id, 'This blocks the Kalyani go-live, please pair with Shubham today.');
    const rel = saveRelease(app, karan, { version: '3.2.0', name: 'Kalyani go-live', projectId: floorApp.id, plannedDate: localDateString(addDays(now, 4)) });
    for (const id of ['D-312', 'D-301', f2.id, f4.id]) addToRelease(app, karan, id, rel.id);
    const prev = saveRelease(app, karan, { version: '3.1.4', name: 'SMS and dispatch fixes', projectId: floorApp.id, plannedDate: localDateString(addDays(now, -2)) });
    addToRelease(app, karan, 'D-299', prev.id);
    signRelease(app, emp('LS018'), prev.id, 'qa'); signRelease(app, karan, prev.id, 'hod');
    db.run("UPDATE releases SET status = 'released', released_at = ? WHERE id = ?", [addDays(now, -2).toISOString(), prev.id]);
    for (const [id, who, mins] of [[f1.id, 'LS009', 540], [f4.id, 'LS008', 300], ['D-305', 'LS013', 180], ['D-312', 'LS012', 420]] as const) logTime(app, emp(who), 'issue', id, mins, 'Development', who);

    // ---- HR: salaries, attendance, payroll (v1.3) ----
    const ctcFor = (e: Employee): number => {
      if (e.functional_role === 'executive') return 4200000;
      if (e.functional_role === 'hod') return 1800000;
      if (e.functional_role === 'team_lead') return 900000;
      const d = e.department_id;
      if (d === 'DEV' || d === 'QA') return 680000;
      if (d === 'SAL' || d === 'PRE') return 540000;
      if (d === 'PRD') return 264000;
      return 420000;
    };
    const everyone = (app.db.all<Employee>("SELECT * FROM employees WHERE status = 'active' ORDER BY id"));
    for (const e of everyone) {
      const ctc = ctcFor(e);
      db.run("UPDATE employees SET gender = ?, date_of_birth = ?, join_date = COALESCE(join_date, ?) WHERE id = ?",
        [/^(nikita|deepika|madhuri|amruta|poonam|priyanka|sneha|pooja|komal|shital|rutuja)/i.test(e.full_name) ? 'female' : 'male', localDateString(addDays(now, -(8000 + Math.floor(rand() * 4000)))), localDateString(addDays(now, -(200 + Math.floor(rand() * 900)))), e.id]);
      saveStructure(app, coo, { employeeId: e.id, effectiveFrom: `${fiscalYear(now).slice(2, 4) ? '20' + fiscalYear(now).slice(2, 4) : '2026'}-04-01`, ctcAnnual: ctc, ...suggestSplit(ctc),
        bankAccount: `5012${String(10000000 + Math.floor(rand() * 89999999))}`, bankIfsc: 'HDFC0001234', pan: `ABCDE${String(1000 + Math.floor(rand() * 8999))}F`, uan: `1012${String(10000000 + Math.floor(rand() * 89999999))}` });
    }
    // Attendance for the last 8 weeks, with a few late marks and absences
    const shiftOf = (e: Employee) => shiftByCode(db, e.shift_code);
    const hol = holidaySet(db);
    for (const e of everyone) {
      // Today is deliberately left blank so whoever logs in gets the check-in prompt.
      for (let back = 56; back >= 1; back--) {
        const day = addDays(now, -back);
        if (!isWorkingDay(day, shiftOf(e), hol)) continue;
        const date = localDateString(day);
        if (date > localDateString(now)) continue;
        const roll = rand();
        if (roll < 0.03) continue; // absent
        const [sh, sm] = shiftOf(e).start.split(':').map(Number);
        const [eh, em] = shiftOf(e).end.split(':').map(Number);
        const p = toLocal(day);
        const late = roll < 0.12 ? 10 + Math.floor(rand() * 50) : Math.floor(rand() * 12) - 6;
        const inAt = fromLocal(p.y, p.m, p.d, sh, sm + Math.max(-10, late));
        const outAt = fromLocal(p.y, p.m, p.d, eh, em + Math.floor(rand() * 45));
        db.run("INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, source, status, minutes_late, day_value) VALUES (?, ?, ?, ?, 'gps', 'present', ?, 1)",
          [e.id, date, inAt.toISOString(), outAt.toISOString(), Math.max(0, late > 15 ? late : 0)]);
      }
    }
    // Two attendance corrections, one already approved
    const workDayBack = (e: Employee, from: number): string => { for (let b = from; b < from + 12; b++) { const d = addDays(now, -b); if (isWorkingDay(d, shiftOf(e), hol)) return localDateString(d); } return localDateString(addDays(now, -from)); };
    const reg1 = requestRegularisation(app, aditya, { date: workDayBack(aditya, 4), reason: 'Went straight to Kalyani Steel site in the morning' });
    decideTask(app, prasad, reg1.task.id, 'approved', 'Confirmed with the customer');
    applyRegularisationDecision(app, prasad, reg1.id, 'approved');
    requestRegularisation(app, nikita, { date: workDayBack(nikita, 2), reason: 'Phone battery died before check-in' });
    // Last month paid, this month a draft
    const thisMonth = localDateString(now).slice(0, 7);
    const lastMonth = (() => { const y = Number(thisMonth.slice(0, 4)), m = Number(thisMonth.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
    const prevRun = buildRun(app, coo, lastMonth); approveRun(app, coo, prevRun.run.id); markPaid(app, coo, prevRun.run.id);
    buildRun(app, coo, thisMonth);
    // Appraisals: an open annual cycle part-way through, plus probation reviews
    const fyStart = Number(thisMonth.slice(0, 4)) - (Number(thisMonth.slice(5, 7)) >= 4 ? 0 : 1);
    const cycle = createCycle(app, coo, { name: `FY${String(fyStart - 1).slice(2)}-${String(fyStart).slice(2)} annual review`, periodFrom: `${fyStart - 1}-04-01`, periodTo: `${fyStart}-03-31`, selfDue: localDateString(addDays(now, 6)), managerDue: localDateString(addDays(now, 20)) });
    openCycle(app, coo, cycle.id);
    const selfText = (e: Employee) => `This year I focused on ${e.department_id === 'SUP' ? 'closing tickets inside SLA and keeping customers informed' : e.department_id === 'DEV' ? 'shipping the floor app releases and cutting rework' : e.department_id === 'SAL' ? 'building the Pune pipeline and holding price' : 'keeping the line moving and reducing scrap'}. What was hard was the stretch where we were short-handed. Next year I would like more ownership and a chance to mentor the newer people in the team.`;
    const pick = (ids: string[]) => ids.map((i) => emp(i));
    for (const e of pick(['LS021', 'LS022', 'LS009', 'LS012', 'LS024', 'LS026', 'LS030'])) {
      const a = listAppraisals(app, { cycleId: cycle.id, employeeId: e.id })[0];
      if (!a) continue;
      submitSelf(app, e, a.id, { review: selfText(e), rating: [4, 3, 4, 3, 3, 4, 3][pick(['LS021', 'LS022', 'LS009', 'LS012', 'LS024', 'LS026', 'LS030']).indexOf(e)] || 3 });
    }
    for (const [who, rating, note] of [['LS021', 4, 'Aditya has been the steadiest hand on the desk. SLA is consistently green and customers ask for him by name. Needs to write up his fixes so the rest of the team can use them.'], ['LS009', 4, 'Strong on the RFID work and good instincts on the hardware. I want him leading the reader integration next year, with less of my review on every change.'], ['LS012', 3, 'Solid delivery and good with the Tally sync. Estimation still slips; we worked on breaking tickets down and it is improving.']] as const) {
      const a = listAppraisals(app, { cycleId: cycle.id, employeeId: emp(who).id })[0];
      if (a && a.status === 'manager' && a.manager_id) submitManager(app, emp(a.manager_id), a.id, { review: note, rating });
    }
    const toModerate = listAppraisals(app, { cycleId: cycle.id, status: ['moderation'], limit: 5 })[0];
    if (toModerate) moderate(app, coo, toModerate.id, { finalRating: toModerate.manager_rating || 4, incrementPct: 9, decision: 'Agreed with the manager. 9% keeps him in line with the band and recognises the RFID work.' });
    // Two recent joiners whose probation is about to end, so the review queue is not empty
    for (const [who, daysAgo] of [['LS031', 170], ['LS039', 176]] as const) { const e = db.get<Employee>('SELECT * FROM employees WHERE id = ?', [who]); if (e) db.run("UPDATE employees SET join_date = ?, employment_type = 'probation' WHERE id = ?", [localDateString(addDays(now, -daysAgo)), who]); }
    generateProbationReviews(app, now);
    // ---- LoyalHire: two open roles with candidates part-way through ----
    const hr = emp('LS003');
    const supportReq = saveRequisition(app, hr, { title: 'Technical Support Engineer', departmentId: 'SUP', positions: 2, experience: '2-4 years on ERP or jewellery software', budgetCtc: 480000, location: 'Pune', hiringManagerId: prasad.id, recruiterId: hr.id,
      justification: 'The desk is carrying 40 open tickets a week with five people. Two more engineers takes first response back inside an hour and lets Prasad stop firefighting.',
      description: 'Answer customer tickets on the LoyalString ERP, reproduce issues, work with Development on fixes, and run onboarding calls for new jewellers.' });
    openRequisition(app, hr, supportReq.id, 'Headcount approved by the COO in the October review, email of 28 Oct');
    const devReq = saveRequisition(app, hr, { title: 'React Native Developer', departmentId: 'DEV', positions: 1, experience: '3+ years, published apps', budgetCtc: 900000, location: 'Pune', hiringManagerId: karan.id, recruiterId: hr.id,
      justification: 'The floor app and the retail app are both on one developer. One more person removes the single point of failure before the Kalyani go-live.',
      description: 'Build and maintain the LoyalString floor and retail apps in React Native, work with the API team, own releases to the stores.' });
    void devReq; // stays a draft until its headcount approval is recorded

    const cand = (name: string, email: string, phone: string, employer: string, yrs: number, cur: number, exp: number, notice: number) =>
      saveCandidate(app, hr, { fullName: name, email, phone, currentEmployer: employer, experienceYears: yrs, currentCtc: cur, expectedCtc: exp, noticeDays: notice, location: 'Pune' });
    const cnd1 = cand('Rohit Deshmukh', 'rohit.deshmukh@example.com', '98500 11223', 'Softlink Systems', 3, 380000, 480000, 30);
    const cnd2 = cand('Snehal Kulkarni', 'snehal.kulkarni@example.com', '98220 44556', 'Vista Retail', 2.5, 340000, 450000, 15);
    const cnd3 = cand('Imran Shaikh', 'imran.shaikh@example.com', '90280 77889', 'Ginni Technologies', 4, 420000, 560000, 60);
    const cnd4 = cand('Pooja Rane', 'pooja.rane@example.com', '77580 33441', 'Freelance', 3.5, 700000, 950000, 0);
    const cnd5 = cand('Vikram Sethi', 'vikram.sethi@example.com', '99201 55667', 'Appify Labs', 5, 1100000, 1400000, 90);

    const a1 = addApplication(app, hr, { candidateId: cnd1.id, requisitionId: supportReq.id, source: 'naukri' });
    const a2 = addApplication(app, hr, { candidateId: cnd2.id, requisitionId: supportReq.id, source: 'referral' });
    const a3 = addApplication(app, hr, { candidateId: cnd3.id, requisitionId: supportReq.id, source: 'linkedin' });
    const a4 = addApplication(app, hr, { candidateId: cnd4.id, requisitionId: supportReq.id, source: 'walk-in' });
    void cnd5;
    screeningNotes(app, hr, a1.id, 'Knows Tally and GST invoicing well. Answers plainly. Wants to move because his current company has no product work. Ask him to walk through a real escalation.');
    moveStage(app, hr, a2.id, 'screening', 'Phone screen booked');
    screeningNotes(app, hr, a2.id, 'Referred by Aditya. Strong on customer handling, lighter on the technical side. Worth a round with Prasad.');
    closeApplication(app, hr, a4.id, 'rejected', 'Looking for a field sales role, not support. Told her directly and kept her on file for the BDM pipeline.');

    const iv1 = scheduleInterview(app, hr, { applicationId: a1.id, roundType: 'technical', mode: 'in_person', location: 'Pune office, meeting room 2', startsAt: addDays(now, -2).toISOString().slice(0, 16), minutes: 45, panel: [prasad.id, aditya.id], force: true });
    setInterviewStatus(app, hr, iv1.id, 'completed');
    saveScorecard(app, prasad, iv1.id, { ratings: { skill: 4, problem: 4, communication: 4, ownership: 3, fit: 4 }, recommendation: 'yes', notes: 'Would need two weeks on our product.', evidence: 'Walked through a GST rate-change bug end to end: checked the tax master first, then the cached rate table, then the invoice print. That is the order we would want.', submit: true });
    const iv2 = scheduleInterview(app, hr, { applicationId: a3.id, roundType: 'technical', startsAt: addDays(now, 2).toISOString().slice(0, 16), minutes: 45, panel: [prasad.id, karan.id], force: true });
    void iv2;

    const offerApp = a1;
    recordDecision(app, hr, offerApp.id, { outcome: 'hire', rationale: 'Panel agreed: strong on GST and invoicing, clear with customers, needs two weeks on our product.' });
    const off = draftOffer(app, hr, { applicationId: offerApp.id, ctcAnnual: 470000, designation: 'Technical Support Engineer', joiningDate: localDateString(addDays(now, 25)), expiryDate: localDateString(addDays(now, 7)), body: 'Six months probation. Laptop provided.' });
    issueOffer(app, hr, off.id);
    setSetting(db, 'statutory', { ...(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'statutory'") ? JSON.parse(db.get<{ value: string }>("SELECT value FROM settings WHERE key = 'statutory'")!.value) : {}), verifiedByCa: false }, coo.id);

    // Open tickets (board)
    insertTicket({ customer: 'Nirmal Agro', subject: 'Cannot print GST invoice from the new build', priority: 'P2', status: 'new', assignee: null, hoursAgo: 0.5, responded: false });
    insertTicket({ customer: 'Sai Industries', subject: 'Request: add two users to the floor app', priority: 'P3', status: 'new', assignee: null, hoursAgo: 1, responded: false });
    const t4187 = insertTicket({ customer: 'Kalyani Steel', subject: 'Barcode scanner offline on the floor', priority: 'P1', status: 'in_progress', assignee: aditya, hoursAgo: 3.4 });
    insertTicket({ customer: 'Omkar Tech', subject: 'Invoice sync shows old GST rate', priority: 'P2', status: 'waiting_dev', assignee: ayush, hoursAgo: 26, devIssue: 'D-312' });
    insertTicket({ customer: 'Shree Packaging', subject: 'New user cannot log in', priority: 'P3', status: 'assigned', assignee: chandu, hoursAgo: 20 });
    insertTicket({ customer: 'Nirmal Agro', subject: 'Report export blank for October', priority: 'P2', status: 'in_progress', assignee: nikita, hoursAgo: 5 });
    insertTicket({ customer: 'Sai Industries', subject: 'Implementation: week 2 training', priority: 'P3', status: 'in_progress', assignee: deepika, hoursAgo: 20 * 24, type: 'implementation', implDays: 21 });
    insertTicket({ customer: 'Vardhman Tools', subject: 'Label printer alignment', priority: 'P4', status: 'assigned', assignee: nagesh, hoursAgo: 30 });
    insertTicket({ customer: 'Prakash Fabricators', subject: 'Dispatch screen slow after update', priority: 'P2', status: 'assigned', assignee: aditya, hoursAgo: 4, devIssue: 'D-301' });
    insertTicket({ customer: 'Vardhman Tools', subject: 'Waiting for customer to share error log', priority: 'P3', status: 'waiting_customer', assignee: chandu, hoursAgo: 26 });
    insertTicket({ customer: 'Shree Packaging', subject: 'Stock count mismatch after import', priority: 'P2', status: 'waiting_dev', assignee: ayush, hoursAgo: 3 * 24, devIssue: 'D-318' });
    insertTicket({ customer: 'Omkar Tech', subject: 'Change company logo on reports', priority: 'P3', status: 'assigned', assignee: nikita, hoursAgo: 2 * 24 });
    insertTicket({ customer: 'Nirmal Agro', subject: 'Implementation: data migration', priority: 'P3', status: 'in_progress', assignee: ayush, hoursAgo: 27 * 24, type: 'implementation', implDays: 21 });
    insertTicket({ customer: 'Shree Packaging', subject: 'Implementation: go-live preparation', priority: 'P3', status: 'in_progress', assignee: aditya, hoursAgo: 34 * 24, type: 'implementation', implDays: 21 });
    insertTicket({ customer: 'Deccan Textiles', subject: 'Scanner app crashes on older Android', priority: 'P3', status: 'in_progress', assignee: deepika, hoursAgo: 2 * 24 });
    insertTicket({ customer: 'Ganesh Auto Parts', subject: 'Reset password for admin user', priority: 'P4', status: 'assigned', assignee: nagesh, hoursAgo: 2 * 24 });
    // Resolved today
    insertTicket({ customer: 'Kalyani Steel', subject: 'SMS alerts not delivered', priority: 'P2', status: 'resolved', assignee: aditya, hoursAgo: 30, resolvedHoursAgo: 2, within: 1, rating: 5 });
    insertTicket({ customer: 'Nirmal Agro', subject: 'Reset password for admin user', priority: 'P3', status: 'resolved', assignee: deepika, hoursAgo: 28, resolvedHoursAgo: 3, within: 1 });
    insertTicket({ customer: 'Sai Industries', subject: 'Training video link expired', priority: 'P4', status: 'resolved', assignee: nagesh, hoursAgo: 50, resolvedHoursAgo: 4, within: 1, rating: 4 });
    insertTicket({ customer: 'Omkar Tech', subject: 'Email notifications going to spam', priority: 'P3', status: 'resolved', assignee: chandu, hoursAgo: 60, resolvedHoursAgo: 1, within: 0, rating: 3 });
    insertTicket({ customer: 'Prime Foods', subject: 'Cannot export dispatch register', priority: 'P2', status: 'resolved', assignee: ayush, hoursAgo: 9, resolvedHoursAgo: 1.5, within: 1, rating: 5 });
    insertTicket({ customer: 'Mahalaxmi Castings', subject: 'Label template missing batch number', priority: 'P3', status: 'resolved', assignee: nikita, hoursAgo: 40, resolvedHoursAgo: 5, within: 1 });
    // History: 60 resolved tickets across the last 8 weeks
    const subjects = ['Login issue after password change', 'Report totals do not match', 'Printer not detected', 'Scanner pairing fails', 'Export to Excel incomplete', 'User role change request', 'Dashboard loads slowly', 'Duplicate stock entry', 'Email template typo', 'Mobile app update prompt'];
    for (let i = 0; i < 60; i++) {
      const hoursAgo = 24 * (2 + Math.floor(rand() * 54));
      const pr: Priority = (['P1', 'P2', 'P2', 'P3', 'P3', 'P3', 'P4'] as Priority[])[Math.floor(rand() * 7)];
      const agent = agents[Math.floor(rand() * agents.length)];
      const within = rand() < 0.92 ? 1 : 0;
      insertTicket({ customer: customers[Math.floor(rand() * customers.length)].name, subject: subjects[i % subjects.length], priority: pr, status: hoursAgo > 24 * 5 ? 'closed' : 'resolved', assignee: agent, hoursAgo, resolvedHoursAgo: hoursAgo - 6 - Math.floor(rand() * 30), within, rating: rand() < 0.7 ? 3 + Math.floor(rand() * 3) : undefined, reopen: rand() < 0.04 ? 1 : 0 });
    }
    db.run('INSERT INTO ticket_events (ticket_id, kind, text, actor_id, at) VALUES (?, ?, ?, ?, ?)', [t4187, 'note', 'Customer asked to restart the scanner; waiting for confirmation', aditya.id, new Date(now.getTime() - 40 * 60_000).toISOString()]);

    // Deals (pipeline)
    const deal = (owner: Employee, customer: string, value: number, stage: string, daysInStage: number, nextStep: string, extras: Record<string, unknown> = {}) => {
      const d = createDeal(app, owner, { customerId: cust(customer).id, value, source: cust(customer).source, nextStep, title: `${customer} floor tracking` });
      const since = addDays(now, -daysInStage).toISOString();
      db.run('UPDATE deals SET stage = ?, stage_since = ?, created_at = ?, next_step_due = ?, qualified_need = ?, qualified_budget = ?, qualified_timeline = ?, quote_attached = ?, discount_pct = ?, discount_status = ?, po_received = ?, won_at = ?, lost_at = ?, lost_reason = ? WHERE id = ?',
        [stage, since, ['new', 'contacted'].includes(stage) ? since : addDays(now, -daysInStage - 7).toISOString(), (extras.overdueDays as number) ? addDays(now, -(extras.overdueDays as number)).toISOString() : addDays(now, 2).toISOString(),
          ['qualified', 'demo', 'proposal', 'negotiation', 'won'].includes(stage) ? 'Floor tracking for two lines' : '', ['qualified', 'demo', 'proposal', 'negotiation', 'won'].includes(stage) ? 'Approved this quarter' : '', ['qualified', 'demo', 'proposal', 'negotiation', 'won'].includes(stage) ? 'Before March' : '',
          (extras.quote as number) || 0, (extras.discount as number) || 0, (extras.discountStatus as string) || 'none', (extras.po as number) || 0, stage === 'won' ? since : null, stage === 'lost' ? since : null, (extras.lostReason as string) || '', d.id]);
      return d.id;
    };
    deal(sanpreet, 'Siddhi Engineering', 580000, 'new', 3, 'Pre-sales booked a call for Wednesday');
    deal(sanpreet, 'Mahalaxmi Castings', 420000, 'new', 1, 'Call back after 4 pm, asked for brochure');
    deal(alpesh, 'Aarav Plastics', 260000, 'new', 0, 'Qualify: need, budget, timeline');
    deal(sanpreet, 'Ganesh Auto Parts', 310000, 'contacted', 5, 'Send case study, fix a demo slot');
    deal(bdms[1], 'Tulsi Agro Tools', 190000, 'contacted', 9, 'Owner travelling; follow up Friday', { overdueDays: 3 });
    deal(sanpreet, 'Vardhman Tools', 720000, 'qualified', 6, 'Demo done; waiting on site visit date', { overdueDays: 2 });
    deal(bdms[2], 'Prakash Fabricators', 340000, 'qualified', 4, 'Confirm demo date with the owner', { overdueDays: 1 });
    const kalyani = deal(sanpreet, 'Kalyani Steel', 1840000, 'demo', 2, 'Demo today 10:30 at Chakan', { quote: 0 });
    deal(bdms[3], 'Shree Packaging', 450000, 'demo', 7, 'Second demo for the dispatch team', { quote: 1, discount: 5, discountStatus: 'approved' });
    const omkar = deal(alpesh, 'Omkar Tech', 690000, 'proposal', 11, 'Revised quote at 2 pm; discount needs approval', { quote: 1, discount: 14, discountStatus: 'pending' });
    deal(bdms[4], 'Nirmal Agro', 530000, 'negotiation', 3, 'PO promised by Thursday', { quote: 1, discount: 4, discountStatus: 'approved', po: 0 });
    deal(bdms[5], 'Sai Industries', 380000, 'won', 1, 'Handover complete', { quote: 1, discount: 5, discountStatus: 'approved', po: 1 });
    deal(bdms[6], 'Prime Foods', 240000, 'won', 2, 'Advance received', { quote: 1, po: 1 });
    deal(alpesh, 'Deccan Textiles', 610000, 'won', 20, 'Delivered', { quote: 1, po: 1 });
    deal(bdms[1], 'Prime Foods', 150000, 'lost', 30, '', { lostReason: 'Price' });
    deal(bdms[3], 'Ganesh Auto Parts', 220000, 'lost', 45, '', { lostReason: 'No budget' });
    const more: [string, string, number, string, number][] = [['LS030', 'Deccan Textiles', 920000, 'qualified', 4], ['LS031', 'Mahalaxmi Castings', 1250000, 'demo', 3], ['LS032', 'Tulsi Agro Tools', 480000, 'proposal', 6], ['LS033', 'Siddhi Engineering', 1480000, 'demo', 5], ['LS035', 'Aarav Plastics', 640000, 'proposal', 2], ['LS030', 'Ganesh Auto Parts', 870000, 'negotiation', 4], ['LS036', 'Deccan Textiles', 2600000, 'qualified', 8], ['LS032', 'Prime Foods', 390000, 'contacted', 2], ['LS035', 'Nirmal Agro', 560000, 'new', 1], ['LS031', 'Sai Industries', 1100000, 'proposal', 9]];
    for (const [owner, customer, value, stage, days] of more) deal(emp(owner), customer, value, stage, days, 'Follow up this week', { quote: ['proposal', 'negotiation'].includes(stage) ? 1 : 0, discount: 0, overdueDays: days > 7 ? 2 : 0 });
    // Pending discount approval for Omkar (routes to COO because 14% > 10%)
    createQuote(app, alpesh, omkar, { discountPct: 14 });
    // Activities: calls and visits over the last 3 weeks
    for (let i = 0; i < 90; i++) {
      const owner = i % 3 === 0 ? madhuri : bdms[Math.floor(rand() * bdms.length)];
      const kind = owner.id === madhuri.id ? 'call' : rand() < 0.5 ? 'call' : rand() < 0.7 ? 'visit' : 'demo';
      addActivity(app, owner, { kind: kind as 'call' | 'visit' | 'demo', notes: kind === 'call' ? 'Follow-up call' : 'Customer visit', customerId: customers[Math.floor(rand() * customers.length)].id, at: addDays(now, -Math.floor(rand() * 21)).toISOString(), lat: kind === 'visit' ? 18.5 + rand() * 0.3 : null, lng: kind === 'visit' ? 73.7 + rand() * 0.3 : null, km: kind === 'visit' ? Math.round(5 + rand() * 30) : 0 });
    }
    addActivity(app, sanpreet, { dealId: kalyani, kind: 'note', notes: 'Bring the Nirmal Agro reference to the demo' });

    // Work orders
    const wo = (customer: string, product: string, stage: string, daysAgo: number, promisedIn: number, extra: Record<string, unknown> = {}) => {
      const w = createWorkOrder(app, lukman, { customerId: cust(customer).id, product, qty: (extra.qty as number) || 1, promisedDate: localDateString(addDays(now, promisedIn)) });
      db.run('UPDATE work_orders SET stage = ?, created_at = ?, started_at = ?, dispatched_at = ?, packed_at = ?, courier = ?, consignment = ?, invoice_ref = ? WHERE id = ?',
        [stage, addDays(now, -daysAgo).toISOString(), ['in_production', 'packed', 'dispatched', 'delivered'].includes(stage) ? addDays(now, -daysAgo + 1).toISOString() : null,
          ['dispatched', 'delivered'].includes(stage) ? addDays(now, -(extra.dispatchedDaysAgo as number ?? 1)).toISOString() : null, ['packed', 'dispatched', 'delivered'].includes(stage) ? addDays(now, -2).toISOString() : null,
          ['dispatched', 'delivered'].includes(stage) ? 'Delhivery' : '', ['dispatched', 'delivered'].includes(stage) ? `DL${Math.floor(rand() * 9e8)}` : '', ['dispatched', 'delivered'].includes(stage) ? `INV-26-${100 + Math.floor(rand() * 900)}` : '', w.id]);
      return w.id;
    };
    wo('Sai Industries', '12 handheld scanners with cradles', 'queued', 1, 6, { qty: 12 });
    wo('Prime Foods', 'Label printer station', 'queued', 2, 5);
    wo('Deccan Textiles', 'Floor display units', 'in_production', 4, 3, { qty: 4 });
    wo('Kalyani Steel', 'RFID gate assembly', 'in_production', 12, -2);
    wo('Vardhman Tools', 'Scanner cradles', 'packed', 5, 1, { qty: 6 });
    wo('Nirmal Agro', 'Weighbridge interface box', 'dispatched', 6, 0, { dispatchedDaysAgo: 0 });
    wo('Shree Packaging', 'Label printers', 'dispatched', 8, 1, { dispatchedDaysAgo: 1, qty: 2 });
    wo('Omkar Tech', 'Tablet mounts', 'dispatched', 9, -1, { dispatchedDaysAgo: 2, qty: 10 });
    wo('Mahalaxmi Castings', 'Barcode station', 'delivered', 15, -5, { dispatchedDaysAgo: 6 });
    createWorkOrder(app, murugan, { customerId: cust('Kalyani Steel').id, product: 'Design request: mounting bracket for RFID gate at Chakan plant', kind: 'design_request' });

    // Tasks and approvals
    createTask(app, coo, { title: 'Brochure for the Pune exhibition (A4, 4 pages)', details: 'Due Friday; use the new floor-tracking screenshots', assigneeId: rahulPund.id, type: 'design', dueAt: addDays(now, 3).toISOString() });
    createTask(app, coo, { title: 'IndiaMART campaign: landing page copy', details: 'Two variants for the floor-tracking campaign', assigneeId: 'LS004', type: 'general', dueAt: addDays(now, -1).toISOString() });
    requestLeave(app, nikita, { type: 'CL', from: localDateString(addDays(now, 3)), to: localDateString(addDays(now, 4)), reason: 'Family function' });
    const exp = submitExpense(app, sanpreet, { category: 'Travel', amount: 62400, description: 'Hyderabad visits: 4 customers, 2 deals in pipeline' });
    void exp;
    const smallExp = submitExpense(app, aditya, { category: 'Local travel', amount: 1800, description: 'Auto fare to Kalyani Steel site' });
    decideTask(app, prasad, smallExp.task.id, 'approved', 'Fine');

    // SOP history: the last 10 working days, mostly on time
    const sops = listSops(app);
    for (let d = 10; d >= 1; d--) {
      const day = addDays(now, -d);
      for (const sop of sops) {
        if (sop.trigger === 'event') continue;
        if (!isWorkingDayFor(app, day, 'SUP')) continue;
        if (sop.trigger === 'weekly' && String(((day.getUTCDay() + 6) % 7) + 1) !== sop.trigger_detail) continue;
        if (sop.trigger === 'monthly') continue;
        const assignee = sop.department_id === 'SUP' ? prasad.id : sop.department_id === 'SAL' ? murugan.id : sop.department_id === 'PRD' ? lukman.id : coo.id;
        const inst = startInstance(app, sop, day, assignee, sop.department_id === 'SUP' ? 'SUP' : 'GEN');
        if (!inst) continue;
        const steps = instanceSteps(inst);
        for (const s of steps) {
          const late = rand() < 0.12;
          s.done = rand() < 0.97; s.by = assignee; s.doneAt = new Date(new Date(s.dueAt).getTime() + (late ? 90 : -45) * 60_000).toISOString(); s.onTime = s.done ? !late : null; s.evidenceText = s.evidence === 'none' ? '' : 'Done, see record';
          if (!s.done) { s.doneAt = null; s.by = null; s.onTime = null; }
        }
        db.run('UPDATE sop_instances SET steps = ?, status = ?, completed_at = ? WHERE id = ?', [JSON.stringify(steps), steps.every((s) => s.done) ? 'complete' : 'open', steps.every((s) => s.done) ? steps[steps.length - 1].doneAt : null, inst.id]);
      }
    }
    generateInstances(app, now);
    const todayHuddle = listInstances(app, { assigneeId: prasad.id, date: localDateString(now) })[0];
    if (todayHuddle) {
      const steps = instanceSteps(todayHuddle);
      for (const s of steps.slice(0, 2)) { s.done = true; s.by = prasad.id; s.doneAt = new Date(now.getTime() - 60 * 60_000).toISOString(); s.onTime = true; s.evidenceText = s.evidence === 'none' ? '' : '23 tickets reviewed'; }
      db.run('UPDATE sop_instances SET steps = ? WHERE id = ?', [JSON.stringify(steps), todayHuddle.id]);
    }

    // Manual KPIs for this week and KPI history for 12 weeks
    const week = weekPeriod(now).label;
    recordManual(app, coo, 'procurement_gap', { type: 'company', id: 'company' }, week, 840000);
    recordManual(app, coo, 'output_vs_plan', { type: 'company', id: 'company' }, week, 96);
    recordManual(app, coo, 'receivables_overdue', { type: 'company', id: 'company' }, week, 11800000);
    recordManual(app, coo, 'collections_mtd', { type: 'company', id: 'company' }, week, 3820000);
    recordManual(app, coo, 'open_positions', { type: 'company', id: 'company' }, week, 3);
    const base: Record<string, [number, number]> = {
      bookings_mtd: [4200000, 900000], pipeline_coverage: [2.7, 0.3], new_leads_week: [30, 6], overdue_followups: [11, 4], win_rate_90d: [31, 4], appointments_week: [38, 6], calls_week: [140, 25], campaign_leads: [12, 4],
      open_tickets: [60, 5], sla_breaches_today: [1, 1], backlog_7d: [6, 2], implementations_avg_days: [23, 3], first_response_median: [45, 10], sla_compliance: [92, 3], reopen_rate: [3.5, 1.5], customer_rating: [4.5, 0.2],
      escalation_closure_days: [6.5, 1.5], sprint_delivery: [88, 6], open_bugs_p1p2: [3, 1], work_orders_queue: [22, 3], wip_over_lead: [2, 1.5], on_time_dispatch: [93, 3], procurement_gap: [600000, 200000], output_vs_plan: [95, 4],
      receivables_overdue: [10200000, 900000], collections_mtd: [3600000, 600000], open_positions: [3, 1], headcount: [43, 0.5], on_leave_today: [2, 1], sop_compliance: [89, 4], overdue_tasks: [4, 2], approvals_pending_2d: [1, 1]
    };
    const scopes: { type: 'company' | 'department'; id: string }[] = [{ type: 'company', id: 'company' }, ...['SUP', 'DEV', 'SAL', 'PRE', 'PRD', 'ACC', 'HR', 'QA', 'DM'].map((id) => ({ type: 'department' as const, id }))];
    for (const def of KPI_DEFS) {
      const [mean, spread] = base[def.key] || [10, 2];
      for (const scope of scopes) {
        if (scope.type === 'department' && !(def.ownerDept === scope.id || (def.band === 'service' && ['SUP', 'DEV', 'QA'].includes(scope.id)) || (def.band === 'revenue' && ['SAL', 'PRE', 'DM'].includes(scope.id)))) continue;
        const factor = scope.type === 'company' ? 1 : def.unit === 'pct' || def.unit === 'ratio' || def.unit === 'rating' || def.unit === 'minutes' || def.unit === 'days' ? 1 : 0.6;
        for (let w = 12; w >= 1; w--) {
          const label = weekPeriod(now, w).label;
          if (label === week) continue;
          const v = (mean + (rand() - 0.5) * 2 * spread) * factor;
          const value = def.unit === 'pct' || def.unit === 'number' || def.unit === 'minutes' ? Math.round(v) : Math.round(v * 10) / 10;
          db.run('INSERT OR IGNORE INTO kpi_snapshots (key, scope_type, scope_id, period, value, target, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [def.key, scope.type, scope.id, label, Math.max(0, value), def.target, addDays(weekStart(addDays(now, -7 * w)), 6).toISOString()]);
        }
      }
    }
    void isoWeek;

    // Phase 2: procurement, budgets, man-hours
    const queued = listWorkOrders(app, { open: true }).filter((w) => w.stage === 'queued' || w.stage === 'in_production');
    const mahesh = getEmployee(db, 'LS006') || coo;
    if (queued[0]) { const a = saveProcurement(app, mahesh, { item: 'RFID readers, UHF, 4-port', qty: 2, unit: 'pcs', neededBy: localDateString(addDays(now, 3)), supplier: 'Impinj via distributor', estCost: 86000, workOrderId: queued[0].id }); setProcurementStatus(app, mahesh, a.id, 'ordered', { expectedAt: localDateString(addDays(now, 2)) }); setMaterials(app, mahesh, queued[0].id, 'short', 'Readers on order, due in 2 days'); }
    if (queued[1]) { saveProcurement(app, mahesh, { item: 'Aluminium enclosure 300x200', qty: 12, unit: 'pcs', neededBy: localDateString(addDays(now, -1)), supplier: 'Local fabricator', estCost: 18000, workOrderId: queued[1].id }); }
    saveProcurement(app, mahesh, { item: 'Barcode labels, 50x25, 10k roll', qty: 20, unit: 'rolls', neededBy: localDateString(addDays(now, 10)), supplier: 'Shree Labels', estCost: 9000 });
    const r = saveProcurement(app, mahesh, { item: 'Android tablets for floor app', qty: 3, unit: 'pcs', neededBy: localDateString(addDays(now, -5)), supplier: 'Amazon Business', estCost: 42000 }); setProcurementStatus(app, mahesh, r.id, 'received');
    const fy = fiscalYear(now);
    for (const [dept, amount] of [['SAL', 2400000], ['PRE', 400000], ['SUP', 600000], ['DEV', 350000], ['PRD', 3000000], ['DM', 900000], ['HR', 500000], ['ACC', 200000], ['QA', 100000]] as const) setBudget(app, coo, dept, fy, amount, 'Approved in the April plan');
    for (const w of queued.slice(0, 3)) { logTime(app, lukman, 'work_order', w.id, 150 + Math.round(rand() * 240), 'Assembly and testing'); logTime(app, mahesh, 'work_order', w.id, 60, 'Inspection', lukman.id); }
  });
}
