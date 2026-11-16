import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { testApp, emp, startServer, Client, COO, DEV_LEAD, SUPPORT_LEAD, type TestServer } from '../helpers.ts';
import { createDevIssue, setDevStatus, getDevIssue, createTicket, escalateToDev, getTicket } from '../../src/modules/desk/service.ts';
import { saveProject, projectHealth, ensureSprint, startSprint, closeSprint, planIssue, burndown, saveRelease, addToRelease, signRelease, shipRelease, releaseNotes, addComment, comments, addCheck, setCheck, checks, updateIssue, devMetrics, getSprint, listProjects } from '../../src/modules/dev/service.ts';
import { unreadNotifications } from '../../src/lib/notify.ts';
import { localDateString, addDays } from '../../src/lib/time.ts';

const KARAN = 'karan.bhoite@loyalstring.com', QA = 'mayur.avhad@loyalstring.com', DEV = 'pratik.sawant@loyalstring.com';

test('projects group issues and report health from progress against the target date', () => {
  const app = testApp();
  const karan = emp(app, KARAN);
  const p = saveProject(app, karan, { name: 'Floor app v3', kind: 'product', startDate: localDateString(addDays(new Date(), -30)), targetDate: localDateString(addDays(new Date(), 10)) });
  assert.match(p.id, /^PJ-\d+$/);
  const a = createDevIssue(app, karan, { title: 'Feature A', projectId: p.id, points: 5, type: 'feature' });
  createDevIssue(app, karan, { title: 'Bug B', projectId: p.id, points: 3, type: 'bug' });
  const fresh = listProjects(app).find((x) => x.id === p.id)!;
  assert.equal(fresh.total, 2); assert.equal(fresh.open_bugs, 1); assert.equal(fresh.points_total, 8);
  assert.equal(projectHealth(fresh).state, 'at_risk', '75% of time gone, 0% done');
  setDevStatus(app, karan, a.id, 'in_progress'); setDevStatus(app, karan, a.id, 'released');
  const later = listProjects(app).find((x) => x.id === p.id)!;
  assert.equal(later.done, 1); assert.equal(later.points_done, 5);
  assert.throws(() => saveProject(app, karan, { name: 'x' }), /name/);
});

test('sprints: plan, start (commitment), close with carry-over, burndown', () => {
  const app = testApp();
  const karan = emp(app, KARAN);
  const s = ensureSprint(app, new Date(), 'Ship it');
  assert.equal(ensureSprint(app, new Date()).id, s.id, 'one sprint per week');
  const a = createDevIssue(app, karan, { title: 'Issue A', points: 3 }), b = createDevIssue(app, karan, { title: 'Issue B', points: 5 }), c = createDevIssue(app, karan, { title: 'Issue C' });
  assert.equal(a.status, 'backlog');
  planIssue(app, karan, a.id, s.id); planIssue(app, karan, b.id, s.id);
  assert.equal(getDevIssue(app, a.id)!.status, 'planned');
  planIssue(app, karan, c.id, s.id); planIssue(app, karan, c.id, null);
  assert.equal(getDevIssue(app, c.id)!.status, 'backlog');
  const started = startSprint(app, karan, s.id);
  assert.equal(started.status, 'active'); assert.equal(started.committed_count, 2); assert.equal(started.committed_points, 8);
  setDevStatus(app, karan, a.id, 'in_progress'); setDevStatus(app, karan, a.id, 'ready');
  const bd = burndown(app, getSprint(app, s.id)!);
  assert.equal(bd[0].ideal, 8);
  assert.ok(bd.some((d) => d.remaining === 5), 'remaining drops to 5 once A is ready');
  const { closed, carried } = closeSprint(app, karan, s.id);
  assert.equal(closed.status, 'closed'); assert.equal(carried, 1);
  const bNow = getDevIssue(app, b.id)!;
  assert.notEqual(bNow.sprint_id, s.id, 'B moved to the next sprint');
  assert.ok(comments(app, b.id).some((x) => /Carried over/.test(x.text)));
});

test('releases need QA sign-off then HOD approval; shipping releases issues and returns tickets to support', () => {
  const app = testApp();
  const karan = emp(app, KARAN), qa = emp(app, QA), dev = emp(app, DEV), lead = emp(app, SUPPORT_LEAD);
  const t = createTicket(app, lead, { subject: 'Printer dies', priority: 'P2', assigneeId: lead.id });
  const { issueId } = escalateToDev(app, lead, t.id);
  const other = createDevIssue(app, dev, { title: 'Dark mode', type: 'change' });
  const r = saveRelease(app, karan, { version: '3.2.0', name: 'Diwali' });
  addToRelease(app, karan, issueId, r.id); addToRelease(app, karan, other.id, r.id);
  assert.throws(() => signRelease(app, dev, r.id, 'qa'), /Only QA/);
  assert.throws(() => signRelease(app, karan, r.id, 'hod'), /QA must sign off/);
  assert.throws(() => shipRelease(app, karan, r.id), /QA sign-off and HOD approval/);
  signRelease(app, qa, r.id, 'qa');
  assert.throws(() => signRelease(app, dev, r.id, 'hod'), /Development HOD/);
  const approved = signRelease(app, karan, r.id, 'hod');
  assert.equal(approved.status, 'approved');
  const { release, notes } = shipRelease(app, karan, r.id);
  assert.equal(release.status, 'released');
  assert.equal(getDevIssue(app, issueId)!.status, 'released');
  assert.equal(getTicket(app, t.id)!.status, 'in_progress', 'ticket back with support');
  assert.match(notes, /3\.2\.0 — Diwali/); assert.match(notes, /Changed\n- D-\d+ Dark mode/); assert.match(notes, /Fixed|New|Support requests/);
  assert.equal(releaseNotes(app, r.id), notes);
  assert.ok(unreadNotifications(app.db, emp(app, COO).id).some((n) => /Released 3\.2\.0/.test(n.title)));
});

test('comments notify, sub-tasks track progress, a failed QA test sends the issue back and reopen is counted', () => {
  const app = testApp();
  const karan = emp(app, KARAN), qa = emp(app, QA), dev = emp(app, DEV);
  const i = createDevIssue(app, karan, { title: 'Export CSV', assigneeId: dev.id, estimateHours: 4 });
  addComment(app, karan, i.id, 'Please add a header row');
  assert.ok(unreadNotifications(app.db, dev.id).some((n) => /commented on/.test(n.title)));
  assert.throws(() => addComment(app, karan, i.id, '  '), /Write something/);
  const s1 = addCheck(app, dev, i.id, 'subtask', 'Write exporter'); addCheck(app, dev, i.id, 'subtask', 'Add header');
  setCheck(app, dev, s1.id, true);
  assert.equal(getDevIssue(app, i.id)!.checks_done, 1); assert.equal(getDevIssue(app, i.id)!.checks_total, 2);
  setDevStatus(app, dev, i.id, 'in_progress'); setDevStatus(app, dev, i.id, 'in_review'); setDevStatus(app, dev, i.id, 'in_qa');
  const t1 = addCheck(app, qa, i.id, 'test', 'Header row present');
  setCheck(app, qa, t1.id, true, 'fail');
  const after = getDevIssue(app, i.id)!;
  assert.equal(after.status, 'in_progress', 'failed test sends it back');
  assert.equal(after.reopen_count, 1);
  assert.ok(checks(app, i.id).some((c) => c.result === 'fail'));
  assert.ok(unreadNotifications(app.db, dev.id).some((n) => /failed QA/.test(n.title)));
  updateIssue(app, karan, i.id, { blocked: 1, blocked_reason: 'Waiting for sample file' });
  assert.equal(getDevIssue(app, i.id)!.blocked, 1);
  assert.ok(comments(app, i.id).some((c) => /Blocked: Waiting/.test(c.text)));
});

test('development metrics: velocity, cycle time, escaped defects, per-developer rows', () => {
  const app = testApp();
  const karan = emp(app, KARAN), dev = emp(app, DEV), lead = emp(app, SUPPORT_LEAD);
  const a = createDevIssue(app, karan, { title: 'Issue A', assigneeId: dev.id, points: 5 });
  setDevStatus(app, dev, a.id, 'in_progress'); setDevStatus(app, dev, a.id, 'released');
  const t = createTicket(app, lead, { subject: 'Crash', priority: 'P1' });
  const { issueId } = escalateToDev(app, lead, t.id);
  app.db.run("UPDATE dev_issues SET type = 'bug' WHERE id = ?", [issueId]);
  const from = localDateString(addDays(new Date(), -7)), to = localDateString(new Date());
  const m = devMetrics(app, from, to);
  assert.equal(m.velocity, 5); assert.equal(m.released, 1); assert.equal(m.escaped, 1); assert.equal(m.openBugs, 1);
  assert.equal(m.byPerson[0].id, dev.id); assert.equal(m.byPerson[0].points, 5);
  assert.equal(m.cycleMedianDays, 0);
  assert.equal(m.velocitySeries.length, 8);
  const mine = devMetrics(app, from, to, [karan.id]);
  assert.equal(mine.released, 0, 'scoped to a person');
});

let srv: TestServer;
before(async () => { srv = await startServer({ demo: true }); });
after(async () => { await srv.close(); });

test('dev pages render; navigation is scoped by department', async () => {
  const k = new Client(srv.base); await k.login(KARAN);
  for (const p of ['/dev', '/dev?mine=1&type=bug', '/dev/planning', '/dev/projects', '/dev/projects?all=1', '/dev/releases', '/dev/metrics', '/dev/new', '/dev/projects/new', '/dev/releases/new', '/dev/D-312', '/dev/D-312?partial=1']) {
    const r = await k.get(p); assert.equal(r.status, 200, `${p} → ${r.status}`);
  }
  const projects = listProjects(srv.app);
  assert.ok(projects.length >= 3, 'demo projects seeded');
  assert.equal((await k.get(`/dev/projects/${projects[0].id}`)).status, 200);
  const sprintPage = await k.get('/dev/sprints/' + srv.app.db.get<{ id: string }>("SELECT id FROM sprints WHERE status = 'active'")!.id);
  assert.equal(sprintPage.status, 200);
  const rel = srv.app.db.get<{ id: string }>('SELECT id FROM releases ORDER BY id LIMIT 1')!;
  assert.equal((await k.get(`/dev/releases/${rel.id}`)).status, 200);
  const created = await k.postJson('/dev', { title: 'HTTP issue', type: 'bug', priority: 'P2', points: 2 });
  assert.equal(created.json.ok, true);

  const d = new Client(srv.base); await d.login(DEV);
  const home = await (await d.get('/')).text();
  assert.ok(home.includes('My sprint work') || home.includes('New issue'), 'developer Today shows dev work');
  const nav = [...home.matchAll(/class="launcher-menu"[\s\S]*?<\/details>/g)][0][0];
  assert.ok(nav.includes('/dev') && nav.includes('/desk') && nav.includes('/tasks'), 'developer sees dev, desk and tasks');
  assert.ok(!nav.includes('"/pipeline"') && !nav.includes('"/production"') && !nav.includes('"/company"'), 'developer does not see sales, production or company');
  const desk = await (await d.get('/desk')).text();
  assert.ok(!desk.includes('Cannot print GST invoice'), 'developer desk shows only tickets linked to dev issues');
  assert.ok(desk.includes('Invoice sync shows old GST rate'), 'escalated ticket is visible');
  const s = new Client(srv.base); await s.login('nikita.kakade@loyalstring.com');
  const snav = [...(await (await s.get('/')).text()).matchAll(/class="launcher-menu"[\s\S]*?<\/details>/g)][0][0];
  assert.ok(snav.includes('"/desk"') && !snav.includes('"/dev"') && !snav.includes('"/pipeline"'), 'support IC sees the desk only');
  const c = new Client(srv.base); await c.login(COO);
  const cnav = [...(await (await c.get('/')).text()).matchAll(/class="launcher-menu"[\s\S]*?<\/details>/g)][0][0];
  assert.ok(cnav.includes('"/pipeline"') && cnav.includes('"/production"') && cnav.includes('"/dev"') && cnav.includes('"/budgets"'), 'executives see everything');
});
