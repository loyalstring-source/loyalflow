// Background jobs: run by the in-process scheduler (server.ts) and on demand from Settings.
import { join } from 'node:path';
import { runAssessmentJobs } from './modules/hr/assessment.ts';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import type { App } from './app.ts';
import { runSlaChecks } from './modules/desk/service.ts';
import { snapshotNow, companyPage, redStreak } from './modules/kpi/engine.ts';
import { generateInstances, escalateOverdue } from './modules/sops/service.ts';
import { getSetting } from './lib/settings.ts';
import { listEmployees } from './modules/people/model.ts';
import { advanceReminders } from './modules/money/service.ts';
import { toLocal, weekLabelShort, isoWeek } from './lib/time.ts';

export interface JobResult { job: string; detail: string; at: string }

const lastRun: Record<string, JobResult> = {};
export function lastRuns(): Record<string, JobResult> { return lastRun; }
function record(job: string, detail: string): JobResult { const r = { job, detail, at: new Date().toISOString() }; lastRun[job] = r; return r; }

export function jobSla(app: App, now = new Date()): JobResult {
  const r = runSlaChecks(app, now);
  return record('sla', `warned ${r.warned}, breached ${r.breached}, auto-closed ${r.closed}`);
}

export function jobSnapshot(app: App, now = new Date()): JobResult {
  return record('snapshot', `${snapshotNow(app, now)} KPI values stored`);
}

export function jobSops(app: App, now = new Date()): JobResult {
  const created = generateInstances(app, now);
  const escalated = escalateOverdue(app, now);
  return record('sops', `${created} checklists created, ${escalated} escalated`);
}

export function jobBackup(app: App, keep = 30): JobResult {
  mkdirSync(app.cfg.backupsDir, { recursive: true });
  const file = join(app.cfg.backupsDir, `loyalflow-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.sqlite`);
  app.db.backupTo(file);
  const files = readdirSync(app.cfg.backupsDir).filter((f) => f.endsWith('.sqlite')).sort();
  while (files.length > keep) { const old = files.shift()!; try { unlinkSync(join(app.cfg.backupsDir, old)); } catch { /* ignore */ } }
  return record('backup', `${file} (${Math.round(statSync(file).size / 1024)} KB), keeping ${keep}`);
}

export function listBackups(app: App): { name: string; size: number; at: string }[] {
  if (!existsSync(app.cfg.backupsDir)) return [];
  return readdirSync(app.cfg.backupsDir).filter((f) => f.endsWith('.sqlite')).sort().reverse().slice(0, 40).map((name) => { const st = statSync(join(app.cfg.backupsDir, name)); return { name, size: st.size, at: new Date(st.mtimeMs).toISOString() }; });
}

/** Monday 08:00 digest: the company page in text, to the CEO, COO and every HOD. */
export function jobDigest(app: App, now = new Date()): JobResult {
  const company = getSetting(app.db, 'company');
  const bands = companyPage(app, { type: 'company', id: 'company' }, now);
  const lines: string[] = [`LoyalFlow weekly digest, ${weekLabelShort(isoWeek(now))}`, ''];
  for (const b of bands) {
    lines.push(b.name.toUpperCase());
    for (const t of b.tiles) {
      const streak = redStreak(app, t.key, { type: 'company', id: 'company' }, now);
      lines.push(`  ${t.rag === 'crit' ? '🔴' : t.rag === 'warn' ? '🟠' : t.rag === 'good' ? '🟢' : '⚪'} ${t.name}: ${t.display}${t.target !== null ? ` (target ${t.targetDisplay})` : ''}${streak >= 2 ? ` — red ${streak} weeks` : ''}`);
    }
    lines.push('');
  }
  const pending = app.db.get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE kind = 'approval' AND status = 'open' AND created_at < ?", [new Date(now.getTime() - 2 * 86_400_000).toISOString()])?.n || 0;
  lines.push(`Approvals waiting over 2 days: ${pending}`, '', `Open the company page: ${app.cfg.baseUrl}/company`);
  const text = lines.join('\n');
  const recipients = new Set<string>([company.ceoId, company.cooId]);
  for (const e of listEmployees(app.db, { status: 'active' })) if (e.functional_role === 'hod' || e.functional_role === 'executive') recipients.add(e.id);
  let sent = 0;
  for (const id of recipients) {
    app.notify.send({ employeeId: id, title: `Weekly digest: ${weekLabelShort(isoWeek(now))}`, body: text, link: '/company', kind: 'info', email: true });
    sent++;
  }
  return record('digest', `sent to ${sent} people`);
}

/** Minute tick: decides which jobs are due. Keeps its own state so nothing runs twice. */
export function createScheduler(app: App, log: (msg: string) => void): { start(): void; stop(): void; tick(now?: Date): void } {
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSnapshot = 0, lastSopDay = '', lastBackupDay = '', lastDigestWeek = '', lastEscalation = 0, lastAssess = 0, assessBusy = false, lastMoneyDay = '';
  const safe = (name: string, fn: () => JobResult) => { try { const r = fn(); if (name !== 'sla') log(`job ${r.job}: ${r.detail}`); } catch (e) { log(`job ${name} failed: ${(e as Error).message}`); } };
  const tick = (now = new Date()) => {
    const local = toLocal(now);
    const day = `${local.y}-${local.m}-${local.d}`;
    safe('sla', () => jobSla(app, now));
    if (now.getTime() - lastSnapshot >= 15 * 60_000) { lastSnapshot = now.getTime(); safe('snapshot', () => jobSnapshot(app, now)); }
    if (lastSopDay !== day && local.hh >= 6) { lastSopDay = day; safe('sops', () => jobSops(app, now)); }
    else if (now.getTime() - lastEscalation >= 10 * 60_000) { lastEscalation = now.getTime(); safe('sops', () => { const n = escalateOverdue(app, now); return { job: 'escalation', detail: `${n} escalated`, at: now.toISOString() }; }); }
    // Assessment reminders and expiry, every ten minutes. Designed for one server instance: the reminder is claimed in the
    // database before it is sent, but two servers on one database would still need a shared lock.
    if (now.getTime() - lastAssess >= 10 * 60_000 && !assessBusy) {
      lastAssess = now.getTime(); assessBusy = true;
      runAssessmentJobs(app, now).then((r) => { if (r.expired || r.finalized || r.reminders) log(`job assessments: ${r.reminders} reminders, ${r.expired} expired, ${r.finalized} timed out`); })
        .catch((e) => log(`job assessments failed: ${(e as Error).message}`)).finally(() => { assessBusy = false; });
    }
    if (lastMoneyDay !== day && local.hh >= 9) { lastMoneyDay = day; safe('advances', () => record('advances', `${advanceReminders(app, now)} advance reminders`)); }
    if (lastBackupDay !== day && local.hh === 2) { lastBackupDay = day; safe('backup', () => jobBackup(app)); }
    const week = isoWeek(now);
    if (local.dow === 1 && local.hh === 8 && lastDigestWeek !== week) { lastDigestWeek = week; safe('digest', () => jobDigest(app, now)); }
  };
  return {
    start() { if (timer) return; tick(); timer = setInterval(() => tick(), 60_000); if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref(); },
    stop() { if (timer) clearInterval(timer); timer = null; },
    tick
  };
}
