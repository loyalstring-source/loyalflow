// Settings → Lists: master lists, limits, departments and sites.
import type { App } from '../app.ts';
import { Router, htmlResponse, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { listEmployees, getEmployee } from '../modules/people/model.ts';
import { can } from '../lib/scope.ts';
import { audit } from '../lib/audit.ts';
import { forget as forgetRoles } from '../lib/roles.ts';
import { getSetting } from '../lib/settings.ts';
import { MODULES, LIST_DEFS, NUMBER_DEFS, listDef, saveList, resetList, saveNumbers, listHistory, type ListInput } from '../lib/lists.ts';
import { BAND_META } from '../modules/kpi/engine.ts';
import { listsPage, type OrgData } from '../ui/pages/lists.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

/** HR looks after the people modules; admins and executives look after everything. */
export function listModulesFor(app: App, e: Employee): string[] {
  if (can(app.db, e, 'settings.admin') || e.functional_role === 'executive') return [...MODULES];
  const out: string[] = [];
  if (can(app.db, e, 'attendance.manage')) out.push('Attendance and leave');
  if (can(app.db, e, 'hire.manage')) out.push('Hiring');
  if (can(app.db, e, 'appraisals.manage')) out.push('Appraisals');
  return out;
}

export function register(r: Router<Employee>, app: App): void {
  const allowed = (e: Employee, module: string): void => { if (!listModulesFor(app, e).includes(module)) throw new HttpError(403, 'You cannot change these settings.'); };
  const org = (): OrgData => ({
    departments: app.db.all("SELECT d.*, (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS people FROM departments d ORDER BY d.name"),
    sites: app.db.all("SELECT s.*, (SELECT COUNT(*) FROM employees e WHERE e.site_id = s.id AND e.status = 'active') AS people FROM sites s ORDER BY s.name"),
    employees: listEmployees(app.db, { status: 'active' }).map((e) => ({ id: e.id, full_name: e.full_name })),
    shifts: getSetting(app.db, 'shifts').map((s) => ({ code: s.code, name: s.name })),
    bands: Object.entries(BAND_META).map(([value, m]) => ({ value, label: m.name }))
  });

  r.get('/lists', (ctx) => {
    const v = view(ctx); const modules = listModulesFor(app, v.user);
    if (!modules.length) throw new HttpError(403, 'You cannot change these settings.');
    const module = modules.includes(ctx.query.get('module') || '') ? ctx.query.get('module')! : modules[0];
    return htmlResponse(listsPage(v, { module, modules, org: module === 'Organisation' ? org() : null, history: listHistory(app.db) }));
  });

  r.post('/lists/save', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const key = str(b, 'key');
    if (!LIST_DEFS.some((d) => d.key === key)) return fail(ctx, 400, 'Unknown list.');
    const def = listDef(key); allowed(me, def.module);
    const rows: ListInput[] = []; const count = Math.min(200, num(b, 'count') ?? 0);
    const read = (prefix: string, i: number): ListInput => ({ value: str(b, `${prefix}value_${i}`) || undefined, label: str(b, `${prefix}label_${i}`), labelHi: str(b, `${prefix}labelHi_${i}`), n: num(b, `${prefix}n_${i}`), active: str(b, `${prefix}on_${i}`, '1') !== '0' });
    for (let i = 0; i < count; i++) { const row = read('', i); if (!row.label.trim() && row.value) { row.label = ''; if (def.mode === 'open') return fail(ctx, 400, 'A name cannot be empty. To retire an entry, set "In use" to No.'); } rows.push(row); }
    for (let i = 0; i < 10; i++) { const row = read('new_', i); if (row.label.trim()) rows.push({ ...row, value: undefined }); }
    try { saveList(app.db, me.id, key, rows); } catch (e) { return fail(ctx, 400, (e as Error).message); }
    return done(ctx, { reload: true, toast: { title: `${def.title} saved`, kind: 'success' } });
  });

  r.post('/lists/reset', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const key = str(b, 'key');
    if (!LIST_DEFS.some((d) => d.key === key)) return fail(ctx, 400, 'Unknown list.');
    allowed(me, listDef(key).module); resetList(app.db, me.id, key);
    return done(ctx, { reload: true, toast: { title: 'Put back to how it came', kind: 'success' } });
  });

  r.post('/lists/numbers', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const input: Record<string, number | null> = {};
    for (const d of NUMBER_DEFS) if (b[d.key] !== undefined) { allowed(me, d.module); input[d.key] = num(b, d.key); }
    saveNumbers(app.db, me.id, input);
    return done(ctx, { reload: true, toast: { title: 'Limits saved', kind: 'success' } });
  });

  r.post('/lists/department', async (ctx) => {
    const me = user(ctx); allowed(me, 'Organisation'); const b = await ctx.body();
    const name = str(b, 'name').trim().slice(0, 60); if (!name) return fail(ctx, 400, 'Give the department a name.');
    const hodId = str(b, 'hodId') && getEmployee(app.db, str(b, 'hodId')) ? str(b, 'hodId') : null;
    const shiftCode = getSetting(app.db, 'shifts').some((s) => s.code === str(b, 'shiftCode')) ? str(b, 'shiftCode') : 'GEN';
    const band = str(b, 'band') in BAND_META ? str(b, 'band') : 'people';
    const id = str(b, 'id');
    if (id) {
      const before = app.db.get('SELECT * FROM departments WHERE id = ?', [id]); if (!before) return fail(ctx, 404, 'No such department.');
      app.db.run('UPDATE departments SET name = ?, hod_id = ?, shift_code = ?, band = ? WHERE id = ?', [name, hodId, shiftCode, band, id]); forgetRoles(app.db);
      audit(app.db, { entity: 'settings', entityId: `org:department ${id}`, action: 'update', actorId: me.id, before, after: { name, hodId, shiftCode, band } });
      return done(ctx, { reload: true, toast: { title: `${name} saved`, kind: 'success' } });
    }
    const code = str(b, 'code').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); if (code.length < 2) return fail(ctx, 400, 'Give a short code of 2 to 5 letters, for example LOG.');
    if (app.db.get('SELECT 1 FROM departments WHERE id = ? OR code = ? OR lower(name) = lower(?)', [code, code, name])) return fail(ctx, 400, 'A department with that name or code already exists.');
    app.db.run('INSERT INTO departments (id, name, code, hod_id, shift_code, band) VALUES (?, ?, ?, ?, ?, ?)', [code, name, code, hodId, shiftCode, band]); forgetRoles(app.db);
    audit(app.db, { entity: 'settings', entityId: `org:department ${code}`, action: 'create', actorId: me.id, after: { name, code, hodId, shiftCode, band } });
    return done(ctx, { reload: true, toast: { title: `${name} added`, kind: 'success' } });
  });

  r.post('/lists/site', async (ctx) => {
    const me = user(ctx); allowed(me, 'Organisation'); const b = await ctx.body();
    const name = str(b, 'name').trim().slice(0, 60); const city = str(b, 'city').trim().slice(0, 40); if (!name) return fail(ctx, 400, 'Give the site a name.');
    const id = str(b, 'id');
    if (id) {
      const before = app.db.get('SELECT * FROM sites WHERE id = ?', [id]); if (!before) return fail(ctx, 404, 'No such site.');
      app.db.run('UPDATE sites SET name = ?, city = ? WHERE id = ?', [name, city, id]);
      audit(app.db, { entity: 'settings', entityId: `org:site ${id}`, action: 'update', actorId: me.id, before, after: { name, city } });
      return done(ctx, { reload: true, toast: { title: `${name} saved`, kind: 'success' } });
    }
    const code = str(b, 'code').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); if (code.length < 2) return fail(ctx, 400, 'Give a short code of 2 to 5 letters, for example BLR.');
    if (app.db.get('SELECT 1 FROM sites WHERE id = ? OR lower(name) = lower(?)', [code, name])) return fail(ctx, 400, 'A site with that name or code already exists.');
    app.db.run('INSERT INTO sites (id, name, city) VALUES (?, ?, ?)', [code, name, city]);
    audit(app.db, { entity: 'settings', entityId: `org:site ${code}`, action: 'create', actorId: me.id, after: { name, city, code } });
    return done(ctx, { reload: true, toast: { title: `${name} added`, kind: 'success' } });
  });
}
