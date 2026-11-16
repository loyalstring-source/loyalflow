import type { App } from '../app.ts';
import { Router, htmlResponse, json } from '../lib/http.ts';
import { statSync, existsSync } from 'node:fs';
import { type Employee, listEmployees, getEmployee } from '../modules/people/model.ts';
import { getAllSettings, getSetting, setSetting, DEFAULT_SETTINGS, type Settings } from '../lib/settings.ts';
import { requireCan } from '../lib/scope.ts';
import { audit } from '../lib/audit.ts';
import { createSession, logoutEverywhere } from '../lib/auth.ts';
import { jobSla, jobSnapshot, jobSops, jobBackup, jobDigest, listBackups, lastRuns } from '../jobs.ts';
import { settingsPage, mePage, type SettingsData } from '../ui/pages/settings.ts';
import { fmtDateTime } from '../lib/time.ts';
import { done, fail, view, user, str, num, bool } from './helpers.ts';
import { html } from '../lib/html.ts';

export const VERSION = '1.2.0';

export function register(r: Router<Employee>, app: App): void {
  r.get('/settings', (ctx) => {
    const v = view(ctx); requireCan(app.db, v.user, 'settings.admin');
    const section = ['company', 'sla', 'shifts', 'approvals', 'ops', 'statutory', 'system'].includes(ctx.query.get('section') || '') ? ctx.query.get('section')! : 'company';
    const d: SettingsData = {
      s: getAllSettings(app.db), employees: listEmployees(app.db, { status: 'active' }), backups: listBackups(app), section,
      system: { version: VERSION, mail: app.mailer.transport, baseUrl: app.cfg.baseUrl, demo: app.cfg.demo, dbBytes: app.cfg.databasePath !== ':memory:' && existsSync(app.cfg.databasePath) ? statSync(app.cfg.databasePath).size : 0, uptime: fmtDateTime(app.startedAt), lastSnapshot: lastRuns().snapshot ? fmtDateTime(lastRuns().snapshot.at) : null, lastSla: lastRuns().sla ? fmtDateTime(lastRuns().sla.at) : null, node: process.version }
    };
    return htmlResponse(settingsPage(v, d));
  });

  const save = <K extends keyof Settings>(ctx: Parameters<typeof user>[0], key: K, value: Settings[K], label: string) => {
    const me = user(ctx);
    const before = getSetting(app.db, key);
    setSetting(app.db, key, value, me.id);
    audit(app.db, { entity: 'settings', entityId: key, action: 'update', actorId: me.id, before, after: value });
    return done(ctx, { reload: true, toast: { title: `${label} saved`, kind: 'success' } });
  };

  r.post('/settings/company', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const cur = getSetting(app.db, 'company');
    const pick = (k: string, fallback: string) => (str(b, k) && getEmployee(app.db, str(b, k)) ? str(b, k) : fallback);
    return save(ctx, 'company', { ...cur, name: str(b, 'name') || cur.name, currency: str(b, 'currency') || cur.currency, ceoId: pick('ceoId', cur.ceoId), cooId: pick('cooId', cur.cooId), salesHeadId: pick('salesHeadId', cur.salesHeadId), hrOwnerId: pick('hrOwnerId', cur.hrOwnerId), accountsOwnerId: pick('accountsOwnerId', cur.accountsOwnerId), productionHodId: pick('productionHodId', cur.productionHodId) }, 'Roles');
  });

  r.post('/settings/sla', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const cur = getSetting(app.db, 'sla');
    const sla = { ...cur };
    for (const p of ['P1', 'P2', 'P3', 'P4'] as const) sla[p] = { response: Math.max(1, num(b, `${p}_response`) ?? cur[p].response), resolve: Math.max(1, num(b, `${p}_resolve`) ?? cur[p].resolve), calendar: str(b, `${p}_calendar`) === 'always' ? 'always' : 'business' };
    setSetting(app.db, 'escalation', { slaWarnPct: Math.min(95, Math.max(10, num(b, 'slaWarnPct') ?? 50)) }, me.id);
    return save(ctx, 'sla', sla, 'SLA matrix');
  });

  r.post('/settings/shifts', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const cur = getSetting(app.db, 'shifts');
    const shifts = cur.map((s, i) => {
      const raw = b[`days_${i}`];
      const days = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(Number).filter((n) => n >= 1 && n <= 7);
      return { ...s, name: str(b, `name_${i}`) || s.name, days: days.length ? days : s.days, start: /^\d{2}:\d{2}$/.test(str(b, `start_${i}`)) ? str(b, `start_${i}`) : s.start, end: /^\d{2}:\d{2}$/.test(str(b, `end_${i}`)) ? str(b, `end_${i}`) : s.end, overtime: bool(b, `ot_${i}`) };
    });
    const holidays = str(b, 'holidays').split(/\r?\n/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
    setSetting(app.db, 'holidays', holidays, me.id);
    return save(ctx, 'shifts', shifts, 'Shifts and holidays');
  });

  r.post('/settings/approvals', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const d = DEFAULT_SETTINGS.approvals;
    const approvals: Settings['approvals'] = {
      expense: [{ maxAmount: num(b, 'expense_tl') ?? 10000, role: 'team_lead' }, { maxAmount: num(b, 'expense_hod') ?? 50000, role: 'hod' }, { role: 'coo' }],
      purchase: [{ maxAmount: num(b, 'purchase_tl') ?? 10000, role: 'team_lead' }, { maxAmount: num(b, 'purchase_hod') ?? 50000, role: 'hod' }, { role: 'coo' }],
      discount: [{ maxPct: num(b, 'discount_self') ?? 5, role: 'self' }, { maxPct: num(b, 'discount_head') ?? 10, role: 'sales_head' }, { role: 'coo' }],
      leave: [{ maxDays: num(b, 'leave_mgr') ?? 3, role: 'manager' }, { role: 'hod' }]
    };
    void d;
    return save(ctx, 'approvals', approvals, 'Approval thresholds');
  });

  r.post('/settings/ops', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    setSetting(app.db, 'sop', { graceBusinessMinutes: Math.max(30, num(b, 'graceBusinessMinutes') ?? 540) }, me.id);
    setSetting(app.db, 'production', { qcEnabled: str(b, 'qcEnabled') === '1', defaultLeadTimeDays: Math.max(1, num(b, 'defaultLeadTimeDays') ?? 7) }, me.id);
    setSetting(app.db, 'travel', { ratePerKm: Math.max(0, num(b, 'ratePerKm') ?? 12) }, me.id);
    audit(app.db, { entity: 'settings', entityId: 'ops', action: 'update', actorId: me.id });
    return done(ctx, { reload: true, toast: { title: 'Operational settings saved', kind: 'success' } });
  });

  r.post('/settings/statutory', async (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const b = await ctx.body();
    const cur = getSetting(app.db, 'statutory');
    const arr = (k: string): string[] => (Array.isArray(b[k]) ? b[k] : b[k] !== undefined ? [b[k]] : []).map(String);
    const slabs = (uptoKey: string, amountKey: string, fallback: { upTo: number | null; amount: number }[]) => {
      const ups = arr(uptoKey), amts = arr(amountKey);
      const out = ups.map((u, i) => ({ upTo: u === '' ? null : Number(u), amount: Number(amts[i]) || 0 })).filter((x) => x.upTo === null || Number.isFinite(x.upTo));
      return out.length ? out : fallback;
    };
    const taxSlabs = (uptoKey: string, rateKey: string, fallback: { upTo: number | null; rate: number }[]) => {
      const ups = arr(uptoKey), rates = arr(rateKey);
      const out = ups.map((u, i) => ({ upTo: u === '' ? null : Number(u), rate: Number(rates[i]) || 0 })).filter((x) => x.upTo === null || Number.isFinite(x.upTo));
      return out.length ? out : fallback;
    };
    const value: typeof cur = {
      verifiedByCa: bool(b, 'verifiedByCa'),
      verifiedNote: str(b, 'verifiedNote'),
      pf: { enabled: str(b, 'pf_enabled') !== '0', employeeRate: num(b, 'pf_employeeRate') ?? cur.pf.employeeRate, employerRate: num(b, 'pf_employerRate') ?? cur.pf.employerRate, epsRate: num(b, 'pf_epsRate') ?? cur.pf.epsRate, wageCeiling: num(b, 'pf_wageCeiling') ?? cur.pf.wageCeiling, restrictToCeiling: str(b, 'pf_restrictToCeiling') !== '0', adminRate: num(b, 'pf_adminRate') ?? cur.pf.adminRate, edliRate: num(b, 'pf_edliRate') ?? cur.pf.edliRate },
      esi: { enabled: str(b, 'esi_enabled') !== '0', employeeRate: num(b, 'esi_employeeRate') ?? cur.esi.employeeRate, employerRate: num(b, 'esi_employerRate') ?? cur.esi.employerRate, grossCeiling: num(b, 'esi_grossCeiling') ?? cur.esi.grossCeiling },
      pt: { enabled: str(b, 'pt_enabled') !== '0', state: cur.pt.state, male: slabs('pt_male_upto', 'pt_male_amount', cur.pt.male), female: slabs('pt_female_upto', 'pt_female_amount', cur.pt.female), februaryExtra: num(b, 'pt_februaryExtra') ?? cur.pt.februaryExtra },
      tds: { enabled: str(b, 'tds_enabled') !== '0', cessRate: num(b, 'tds_cessRate') ?? cur.tds.cessRate,
        new: { standardDeduction: num(b, 'tds_new_standardDeduction') ?? cur.tds.new.standardDeduction, slabs: taxSlabs('tds_new_upto', 'tds_new_rate', cur.tds.new.slabs), rebateUpTo: num(b, 'tds_new_rebateUpTo') ?? cur.tds.new.rebateUpTo, rebateMax: num(b, 'tds_new_rebateMax') ?? cur.tds.new.rebateMax },
        old: { standardDeduction: num(b, 'tds_old_standardDeduction') ?? cur.tds.old.standardDeduction, slabs: taxSlabs('tds_old_upto', 'tds_old_rate', cur.tds.old.slabs), rebateUpTo: num(b, 'tds_old_rebateUpTo') ?? cur.tds.old.rebateUpTo, rebateMax: num(b, 'tds_old_rebateMax') ?? cur.tds.old.rebateMax, limit80c: num(b, 'tds_old_limit80c') ?? cur.tds.old.limit80c, limit80d: num(b, 'tds_old_limit80d') ?? cur.tds.old.limit80d, limit80ccd1b: num(b, 'tds_old_limit80ccd1b') ?? cur.tds.old.limit80ccd1b } }
    };
    setSetting(app.db, 'payroll', { treatMissingAsPresent: str(b, 'payroll_treatMissingAsPresent') !== '0', lateGraceMinutes: num(b, 'payroll_lateGraceMinutes') ?? 15, halfDayAfterMinutes: num(b, 'payroll_halfDayAfterMinutes') ?? 240, payDay: num(b, 'payroll_payDay') ?? 7 }, me.id);
    return save(ctx, 'statutory', value, 'Statutory settings');
  });

  r.post('/settings/run/:job', (ctx) => {
    const me = user(ctx); requireCan(app.db, me, 'settings.admin');
    const job = ctx.params.job;
    const r = job === 'snapshot' ? jobSnapshot(app) : job === 'sla' ? jobSla(app) : job === 'sops' ? jobSops(app) : job === 'backup' ? jobBackup(app) : job === 'digest' ? jobDigest(app) : null;
    if (!r) return fail(ctx, 404, 'Unknown job');
    audit(app.db, { entity: 'job', entityId: job, action: 'run', actorId: me.id, after: { detail: r.detail } });
    return done(ctx, { reload: job === 'backup', toast: { title: `${job} done`, body: r.detail, kind: 'success' } });
  });

  // Account page
  r.get('/me', (ctx) => {
    const v = view(ctx);
    const sessions = app.db.all<{ kind: string; created_at: string; last_seen_at: string; user_agent: string }>('SELECT kind, created_at, last_seen_at, user_agent FROM sessions WHERE employee_id = ? ORDER BY last_seen_at DESC LIMIT 10', [v.user.id]);
    return htmlResponse(mePage(v, { sessions, manager: v.user.reporting_manager_id ? getEmployee(app.db, v.user.reporting_manager_id) || null : null }));
  });
  r.post('/me/logout-everywhere', (ctx) => { const me = user(ctx); logoutEverywhere(app, me.id); return done(ctx, { redirect: '/login?out=1' }); });
  r.post('/me/api-token', (ctx) => {
    const me = user(ctx);
    const token = createSession(app, me.id, 'api', 'api-token');
    audit(app.db, { entity: 'employee', entityId: me.id, action: 'api_token.create', actorId: me.id });
    const frag = html`<div class="notice notice-good" style="flex-direction:column;align-items:flex-start"><b>Your token (copy it now, it is not shown again)</b><code class="mono" style="word-break:break-all;background:var(--surface);padding:8px;border-radius:8px;display:block;width:100%">${token}</code><span class="small">Use it as <code>Authorization: Bearer &lt;token&gt;</code> on /api/v1/… requests.</span></div>`;
    return ctx.wantsJson ? json({ ok: true, html: frag.toString(), target: '#api-token', toast: { title: 'Token created', kind: 'success' } }) : done(ctx, { redirect: '/me' });
  });
}
