import type { App } from '../app.ts';
import { Router, htmlResponse, json, text, file, readBody, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listEmployees } from '../modules/people/model.ts';
import { scopeFor, can } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import { localDateString, addDays } from '../lib/time.ts';
import { rules, saveRules, rulesHistory, canEditRules, listDevices, saveDevice, deviceAllowed, ingestPunches, unmatchedPins, setPin, recentPunches, missPunchReport, reasonLabel } from '../modules/hr/attendance-rules.ts';
import { rulesPage, machinePage, missPunchReportPage } from '../ui/pages/attendance-extra.ts';
import { done, fail, view, user, str } from './helpers.ts';

/**
 * What a ZKTeco machine calls (its "push" or ADMS protocol). No sign-in is possible on a machine, so the gate is the serial
 * number: only machines HR has approved are answered. Everything is plain text, as the machine expects.
 */
export function registerPublic(r: Router<Employee>, app: App): void {
  const sn = (ctx: { query: URLSearchParams }): string => ctx.query.get('SN') || ctx.query.get('sn') || '';
  const refused = () => text('UNKNOWN DEVICE', 403);
  const options = (serial: string): string => [`GET OPTION FROM: ${serial}`, 'ATTLOGStamp=0', 'OPERLOGStamp=9999', 'ATTPHOTOStamp=9999', 'ErrorDelay=60', 'Delay=30', 'TransTimes=00:00;14:05', 'TransInterval=1', 'TransFlag=TransData AttLog', `TimeZone=${Math.round(app.cfg.timezoneOffsetMinutes / 60 * 10) / 10}`, 'Realtime=1', 'Encrypt=None', ''].join('\n');

  r.get('/iclock/cdata', (ctx) => { if (!deviceAllowed(app, sn(ctx), ctx.ip, ctx.query.get('pushver') ? `push ${ctx.query.get('pushver')}` : '')) return refused(); return text(options(sn(ctx))); });
  r.post('/iclock/cdata', async (ctx) => {
    if (!deviceAllowed(app, sn(ctx), ctx.ip)) return refused();
    const body = (await readBody(ctx.req)).toString('utf8');
    const table = (ctx.query.get('table') || '').toUpperCase();
    if (table !== 'ATTLOG') return text('OK');
    const res = ingestPunches(app, sn(ctx).trim().toUpperCase(), body, 'push');
    return text(`OK: ${res.received}`);
  });
  r.get('/iclock/getrequest', (ctx) => (deviceAllowed(app, sn(ctx), ctx.ip, ctx.query.get('INFO') || '') ? text('OK') : refused()));
  r.post('/iclock/devicecmd', async (ctx) => { await readBody(ctx.req); return deviceAllowed(app, sn(ctx), ctx.ip) ? text('OK') : refused(); });
  r.get('/iclock/ping', (ctx) => (deviceAllowed(app, sn(ctx), ctx.ip) ? text('OK') : refused()));
  const registry = async (ctx: Parameters<Parameters<typeof r.post>[1]>[0]) => { const info = ctx.method === 'POST' ? (await readBody(ctx.req)).toString('utf8').slice(0, 400) : ''; return deviceAllowed(app, sn(ctx), ctx.ip, info) ? text(`RegistryCode=${sn(ctx).trim().toUpperCase()}`) : refused(); };
  r.get('/iclock/registry', registry); r.post('/iclock/registry', registry);
  r.post('/iclock/push', async (ctx) => { await readBody(ctx.req); return deviceAllowed(app, sn(ctx), ctx.ip) ? text(options(sn(ctx))) : refused(); });
}

export function register(r: Router<Employee>, app: App): void {
  const manage = (e: Employee): void => { if (!canEditRules(app, e)) throw new HttpError(403, 'Only HR and the executives manage attendance rules and machines.'); };
  const guard = async <T>(ctx: Parameters<typeof fail>[0], fn: () => T | Promise<T>): Promise<T | ReturnType<typeof fail>> => { try { return await fn(); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; } };

  r.get('/attendance/rules', (ctx) => { const v = view(ctx); manage(v.user); return htmlResponse(rulesPage(v, { rules: rules(app), history: rulesHistory(app), halfDayAfter: getSetting(app.db, 'payroll').halfDayAfterMinutes })); });
  r.post('/attendance/rules', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body() as Record<string, unknown>;
    const saved = saveRules(app, user(ctx), { lateGraceMinutes: b.lateGraceMinutes, lateAllowedPerMonth: b.lateAllowedPerMonth, latePenalty: b.latePenalty, missPunchWindowDays: b.missPunchWindowDays, missPunchFlagPerMonth: b.missPunchFlagPerMonth, machineIsSource: String(b.machineIsSource) !== '0' });
    return done(ctx, { reload: true, toast: { title: 'Rules saved', body: `On time up to ${saved.lateGraceMinutes} minutes; ${saved.lateAllowedPerMonth} late arrivals allowed a month. This month has been re-read.`, kind: 'success' } });
  }));

  r.get('/attendance/machine', (ctx) => {
    const v = view(ctx); manage(v.user);
    const people = listEmployees(app.db, { status: 'active' }).map((e) => ({ ...e, device_pin: app.db.get<{ device_pin: string }>('SELECT device_pin FROM employees WHERE id = ?', [e.id])?.device_pin || '' }));
    return htmlResponse(machinePage(v, { devices: listDevices(app), unmatched: unmatchedPins(app), people, recent: recentPunches(app), serverUrl: app.cfg.baseUrl, local: /localhost|127\.0\.0\.1/.test(app.cfg.baseUrl) }));
  });
  r.post('/attendance/machine/device', async (ctx) => guard(ctx, async () => { const b = await ctx.body(); const d = saveDevice(app, user(ctx), { sn: str(b, 'sn'), name: str(b, 'name'), active: str(b, 'active') !== '0' }); return done(ctx, { reload: true, toast: { title: d.active ? 'Machine connected' : 'Machine switched off', body: d.sn, kind: 'success' } }); }));
  r.post('/attendance/machine/pin', async (ctx) => guard(ctx, async () => {
    const b = await ctx.body(); if (!str(b, 'employeeId')) throw new HttpError(400, 'Choose the employee.');
    const res = setPin(app, user(ctx), str(b, 'employeeId'), str(b, 'pin'));
    return done(ctx, { reload: true, toast: { title: 'Machine ID saved', body: res.attached ? `${res.attached} day${res.attached > 1 ? 's' : ''} of earlier punches attached.` : '', kind: 'success' } });
  }));
  r.post('/attendance/machine/file', async (ctx) => guard(ctx, async () => {
    manage(user(ctx)); const b = await ctx.body() as Record<string, unknown>;
    const body = String(b.text || ''); if (body.length < 10) throw new HttpError(400, 'The file is empty.');
    const res = ingestPunches(app, 'FILE', body, 'file');
    if (!res.received) throw new HttpError(400, 'No punches could be read from this file. Each line needs a user ID, a date and a time, for example: 12  2026-11-10 09:02:11');
    return json({ ok: true, summary: `${res.received} punches read: ${res.added} new, ${res.duplicates} already here${res.unmatched ? `, ${res.unmatched} from IDs with no person yet` : ''}${res.skipped ? `, ${res.skipped} lines skipped` : ''}. ${res.people} people updated.` });
  }));

  // ---- Miss-punch report: HR and executives see everyone; a manager sees their own team; anyone sees themselves. ----
  const reportFor = (ctx: Parameters<typeof fail>[0] & { query: URLSearchParams }) => {
    const me = user(ctx); const scope = scopeFor(app.db, me);
    const all = canEditRules(app, me) || can(app.db, me, 'people.admin');
    const today = localDateString(new Date());
    const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
    const from = ok(ctx.query.get('from')) || localDateString(addDays(new Date(), -90)); const to = ok(ctx.query.get('to')) || today;
    const people = listEmployees(app.db, { status: 'active' }).filter((e) => all || scope.people.has(e.id));
    const asked = ctx.query.get('employee') || ''; const employeeId = asked && people.some((p) => p.id === asked) ? asked : '';
    const departmentId = all ? ctx.query.get('department') || '' : '';
    const report = missPunchReport(app, { from, to, employeeIds: employeeId ? [employeeId] : all ? undefined : people.map((p) => p.id), departmentId: departmentId || undefined });
    return { me, all, from, to, people, employeeId, departmentId, report, scopeNote: all ? 'whole company' : people.length > 1 ? 'your team' : 'your own requests' };
  };
  r.get('/attendance/miss-punch', (ctx) => {
    const v = view(ctx); const x = reportFor(ctx);
    return htmlResponse(missPunchReportPage(v, { report: x.report, from: x.from, to: x.to, departments: x.all ? app.db.all<{ id: string; name: string }>('SELECT id, name FROM departments ORDER BY name') : [], departmentId: x.departmentId, employeeId: x.employeeId, people: x.people, canManage: canEditRules(app, x.me), scopeNote: x.scopeNote }));
  });
  r.get('/attendance/miss-punch.csv', (ctx) => {
    const x = reportFor(ctx);
    const cell = (s: unknown) => { const t = String(s ?? ''); const safe = /^[=+\-@]/.test(t) ? `'${t}` : t; return `"${safe.replace(/"/g, '""')}"`; };
    const head = ['Request', 'Employee ID', 'Employee', 'Team', 'Date missed', 'Missed', 'In', 'Out', 'Reason', 'What they wrote', 'Asked on', 'Team lead', 'Team lead decided on', 'Team lead comment', 'HR', 'HR decided on', 'HR comment', 'Result'];
    const lines = x.report.rows.map((r) => [r.id, r.employee_id, r.employee_name, r.department, r.date, r.kind, r.requested_in, r.requested_out, reasonLabel(r.reason_code), r.reason, r.created_at.slice(0, 10), r.validated_by_name, (r.validated_at || '').slice(0, 10), r.validator_note,
      r.status === 'approved' || r.declined_stage === 'hr' ? r.decided_by_name : '', r.status === 'approved' || r.declined_stage === 'hr' ? (r.decided_at || '').slice(0, 10) : '', r.hr_note,
      r.status === 'approved' ? 'Approved' : r.status === 'declined' ? (r.declined_stage === 'hr' ? 'Declined by HR' : 'Declined by team lead') : r.status === 'validated' ? 'With HR' : 'With team lead'].map(cell).join(','));
    return file('﻿' + [head.map(cell).join(','), ...lines].join('\r\n'), `miss-punch-${x.from}-to-${x.to}.csv`, 'text/csv; charset=utf-8');
  });
}
