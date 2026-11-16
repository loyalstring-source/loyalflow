// Daily review (DSR): one sheet per team per day.
import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, HttpError } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import {
  teamsFor, teamMembers, getDay, listItems, addItem, deleteItem, selfUpdate, reviewItem, acceptSelfUpdates, closeDay, reopenDay, summarise, refOptions, customerNames, supportPanels,
  today, nextWorkingDay, prevWorkingDay, dsrStyles, saveStyles, canConfigure, getItem
} from '../modules/dsr/service.ts';
import { dsrPage, dsrEmptyPage, dsrSettingsPage } from '../ui/pages/dsr.ts';
import { done, fail, view, user, str } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  const attempt = async (ctx: Parameters<typeof done>[0], fn: (b: Record<string, unknown>) => Parameters<typeof done>[1]) => {
    const b = await ctx.body();
    try { return done(ctx, fn(b)); } catch (e) { if (e instanceof HttpError) return fail(ctx, e.status, e.message); throw e; }
  };

  r.get('/dsr', (ctx) => {
    const v = view(ctx); const teams = teamsFor(app, v.user);
    if (!teams.length) return htmlResponse(dsrEmptyPage(v, canConfigure(v.user)));
    const team = teams.find((t) => t.id === ctx.query.get('team')) || teams[0];
    const q = ctx.query.get('day') || ''; const day = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : today();
    const items = listItems(app, team.id, day);
    return htmlResponse(dsrPage(v, {
      teams, team, day, today: today(), prev: prevWorkingDay(app, day), next: nextWorkingDay(app, day), record: getDay(app, team.id, day), items, summary: summarise(items),
      members: teamMembers(app, team.id), refs: refOptions(app, team), customers: team.style === 'collections' ? customerNames(app) : [],
      support: team.style === 'support' ? supportPanels(app, day) : null, canConfigure: canConfigure(v.user), app
    }));
  });

  r.post('/dsr/items', (ctx) => attempt(ctx, (b) => {
    const it = addItem(app, user(ctx), { deptId: str(b, 'team'), day: str(b, 'day'), employeeId: str(b, 'employeeId'), title: b.title, customer: b.customer, ref: b.ref, plannedHours: b.plannedHours, amountExpected: b.amountExpected });
    return { reload: true, toast: { title: 'Added', body: it.kind === 'collection' ? it.customer : it.title, kind: 'success' } };
  }));
  r.post('/dsr/items/:id/self', (ctx) => attempt(ctx, (b) => { selfUpdate(app, user(ctx), ctx.params.id, { status: b.status, pct: b.pct, amount: b.amount, note: b.note }); return {}; }));
  r.post('/dsr/items/:id/review', (ctx) => attempt(ctx, (b) => { reviewItem(app, user(ctx), ctx.params.id, { status: b.status, pct: b.pct, amount: b.amount, remark: b.remark, carry: b.carry }); return {}; }));
  r.post('/dsr/items/:id/delete', (ctx) => attempt(ctx, () => { const it = getItem(app, ctx.params.id); deleteItem(app, user(ctx), ctx.params.id); return { reload: true, toast: { title: 'Removed', body: it?.title || it?.customer || '', kind: 'info' } }; }));
  r.post('/dsr/accept', (ctx) => attempt(ctx, (b) => {
    const n = acceptSelfUpdates(app, user(ctx), str(b, 'team'), str(b, 'day'));
    return { reload: true, toast: n ? { title: `${n} line${n === 1 ? '' : 's'} confirmed`, body: "Taken from each person's own update. Change any that differ.", kind: 'success' } : { title: 'Nothing to confirm', body: 'No one has updated a line that is still waiting for review.', kind: 'info' } };
  }));
  r.post('/dsr/close', (ctx) => attempt(ctx, (b) => {
    const res = closeDay(app, user(ctx), str(b, 'team'), str(b, 'day'), str(b, 'notes'));
    return { reload: true, toast: { title: 'Day closed', body: `${res.counts.done} done${res.carried ? `, ${res.carried} moved to ${res.to}` : ''}.`, kind: 'success' } };
  }));
  r.post('/dsr/reopen', (ctx) => attempt(ctx, (b) => { reopenDay(app, user(ctx), str(b, 'team'), str(b, 'day')); return { reload: true, toast: { title: 'Day reopened', kind: 'info' } }; }));

  r.get('/dsr/settings', (ctx) => {
    const v = view(ctx); if (!canConfigure(v.user)) throw new HttpError(403, 'Only an administrator or an executive sets how each team runs its daily review.');
    return htmlResponse(dsrSettingsPage(v, { styles: dsrStyles(app), teams: app.db.all<{ id: string; name: string }>('SELECT id, name FROM departments ORDER BY name') }));
  });
  r.post('/dsr/settings', (ctx) => attempt(ctx, (b) => { saveStyles(app, user(ctx), b); return { redirect: '/dsr/settings', toast: { title: 'Saved', kind: 'success' } }; }));
  r.get('/daily-review', () => redirect('/dsr'));
}
