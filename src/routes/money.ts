// Expenses and advances: claiming, the Accounts desk, documents, payments and the ledger.
import type { App } from '../app.ts';
import { Router, htmlResponse, file, HttpError } from '../lib/http.ts';
import { type Employee, listEmployees } from '../modules/people/model.ts';
import { scopeFor } from '../lib/scope.ts';
import { localDateString } from '../lib/time.ts';
import { submitClaim, requireClaim, getClaim, listDocs, addDoc, readDoc, markPaid, settleAdvance, advanceState, openAdvances, myClaims, settlementsOf, entriesOf, accountsDesk, ledger, balanceOf, balances, isAccounts, type Kind,
  addVendorBill, pettyBalance, pettyTopUp, pettySpend, pettyRecent, months, closeMonth, reopenMonth, markPosted, booksExport, limits, saveLimits, moneySettings, saveMoneySettings } from '../modules/money/service.ts';
import { budgetFor } from '../modules/ops/service.ts';
import { getReport } from '../modules/reports/engine.ts';
import { listDeals } from '../modules/sales/service.ts';
import { myMoneyPage, newClaimModal, claimPage, payModal, accountsPage, ledgerPage, vendorModal, pettyModal, moneySettingsModal } from '../ui/pages/money.ts';
import { listDepartments } from '../modules/people/model.ts';
import * as lists from '../lib/lists.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

export function register(r: Router<Employee>, app: App): void {
  r.get('/money', (ctx) => { const v = view(ctx); const me = v.user; return htmlResponse(myMoneyPage(v, { claims: myClaims(app, me.id), balance: balanceOf(app, me.id), advances: openAdvances(app, me.id), accounts: isAccounts(app, me) })); });
  r.get('/money/new', (ctx) => {
    const v = view(ctx); const q = ctx.query.get('kind'); const kind: Kind = q === 'advance' || q === 'settlement' ? q : 'reimbursement';
    const deals = kind === 'reimbursement' && (['SAL', 'PRE'].includes(v.deptCode) || v.isManager) ? listDeals(app, { ownerIds: v.isManager ? undefined : [v.user.id], open: true }).slice(0, 100).map((d) => ({ id: d.id, label: `${d.id} · ${d.customer_name || d.title}` })) : [];
    const b = budgetFor(app, v.user.id);
    return htmlResponse(newClaimModal(v, { kind, advances: openAdvances(app, v.user.id), advanceId: ctx.query.get('advance') || '', deals, budget: b ? { remaining: b.remaining, amount: b.amount } : null }));
  });
  r.post('/money', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const c = submitClaim(app, me, { kind: str(b, 'kind'), category: str(b, 'category'), amount: num(b, 'amount'), description: str(b, 'description'), expenseDate: str(b, 'expenseDate'), advanceId: str(b, 'advanceId'), dealId: str(b, 'dealId'), km: num(b, 'km'), doc: str(b, 'doc') || undefined, docName: str(b, 'docName'), vendorName: str(b, 'vendorName'), vendorGstin: str(b, 'vendorGstin'), billNo: str(b, 'billNo'), gstAmount: num(b, 'gstAmount') });
    return done(ctx, { reload: true, toast: { title: c.kind === 'advance' ? 'Advance requested' : c.kind === 'settlement' ? 'Bills sent for approval' : 'Expense sent for approval', body: `With ${c.approver_name || 'your approver'}.${c.over_limit != null ? ' It is above the limit for this category; the approver has been told.' : ''}${c.kind !== 'advance' && !c.docs ? ' Remember to attach the bill.' : ''}`, kind: 'success' } });
  });
  r.get('/money/accounts', (ctx) => { const v = view(ctx); if (!isAccounts(app, v.user)) return fail(ctx, 403, 'The Accounts desk is for the Accounts team.'); return htmlResponse(accountsPage(v, accountsDesk(app), { petty: pettyBalance(app), pettyRecent: pettyRecent(app), months: months(app), limits: limits(app).size, settings: moneySettings(app), canReopen: !!v.user.is_admin || v.user.functional_role === 'executive' })); });
  r.get('/money/ledger', (ctx) => {
    const v = view(ctx); const me = v.user; const acc = isAccounts(app, me); const scope = scopeFor(app.db, me); const wide = acc || scope.level !== 'self';
    const allowed = (id: string): boolean => acc || scope.people.has(id);
    const asked = ctx.query.get('person') || ''; const personId = !wide ? me.id : asked && allowed(asked) ? asked : '';
    const people = wide ? listEmployees(app.db, { status: 'active' }).filter((e) => allowed(e.id)).map((e) => ({ id: e.id, full_name: e.full_name })) : [];
    const entries = ledger(app, { employeeId: personId || undefined, people: acc ? null : scope.people }).reverse().slice(0, 500);
    const name = personId ? (personId === me.id ? me.full_name : people.find((p) => p.id === personId)?.full_name || personId) : '';
    return htmlResponse(ledgerPage(v, { entries, person: personId ? { id: personId, name } : null, balance: personId ? balanceOf(app, personId) : 0, balances: personId ? [] : balances(app).filter((b) => allowed(b.id)), people, accounts: acc, wide, canExport: !!getReport('fin-ledger')?.allowed(app, me) }));
  });
  // ----- Accounts only: vendor bills, petty cash, limits, month close and the file for Zoho Books -----
  const accountsOnly = (ctx: Parameters<Parameters<typeof r.get>[1]>[0]): Employee => { const me = user(ctx); if (!isAccounts(app, me)) throw new HttpError(403, 'This is for the Accounts team.'); return me; };
  const depts = (): { id: string; name: string }[] => listDepartments(app.db).map((d) => ({ id: d.id, name: d.name }));
  const billInput = (b: Record<string, unknown>) => ({ vendorName: str(b, 'vendorName'), vendorGstin: str(b, 'vendorGstin'), billNo: str(b, 'billNo'), billDate: str(b, 'billDate'), category: str(b, 'category'), departmentId: str(b, 'departmentId'), amount: num(b, 'amount'), gstAmount: num(b, 'gstAmount'), description: str(b, 'description'), doc: str(b, 'doc') || undefined, docName: str(b, 'docName') });
  r.get('/money/vendor/new', (ctx) => { accountsOnly(ctx); return htmlResponse(vendorModal(view(ctx), depts())); });
  r.post('/money/vendor', async (ctx) => { const me = accountsOnly(ctx); const c = addVendorBill(app, me, billInput(await ctx.body())); return done(ctx, { reload: true, toast: { title: 'Vendor bill sent for approval', body: `${c.vendor_name} · with ${c.approver_name || 'the approver'}`, kind: 'success' } }); });
  r.get('/money/petty', (ctx) => { accountsOnly(ctx); return htmlResponse(pettyModal(view(ctx), { balance: pettyBalance(app), cap: moneySettings(app).pettyCap, depts: depts(), today: localDateString(new Date()) })); });
  r.post('/money/petty/spend', async (ctx) => { const me = accountsOnly(ctx); const c = pettySpend(app, me, billInput(await ctx.body())); return done(ctx, { reload: true, toast: { title: 'Paid from petty cash', body: `${c.id} · ${pettyBalance(app).toLocaleString('en-IN')} left in the box`, kind: 'success' } }); });
  r.post('/money/petty/topup', async (ctx) => { const me = accountsOnly(ctx); const b = await ctx.body(); const bal = pettyTopUp(app, me, { amount: num(b, 'amount'), date: str(b, 'date'), mode: str(b, 'mode'), ref: str(b, 'ref') }); return done(ctx, { reload: true, toast: { title: 'Cash added', body: `₹${bal.toLocaleString('en-IN')} in the box now`, kind: 'success' } }); });
  r.get('/money/settings', (ctx) => { accountsOnly(ctx); return htmlResponse(moneySettingsModal(view(ctx), { cats: lists.options('finance.expenseCategories').map((o) => o.value), limits: limits(app), settings: moneySettings(app) })); });
  r.post('/money/settings', async (ctx) => {
    const me = accountsOnly(ctx); const b = await ctx.body(); const vals: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) if (k.startsWith('limit:')) vals[k.slice(6)] = v;
    saveLimits(app, me, vals); saveMoneySettings(app, me, { advanceDays: num(b, 'advanceDays') ?? undefined, pettyCap: num(b, 'pettyCap') ?? undefined });
    return done(ctx, { reload: true, toast: { title: 'Saved', kind: 'success' } });
  });
  r.post('/money/months/close', async (ctx) => { const me = accountsOnly(ctx); const b = await ctx.body(); closeMonth(app, me, str(b, 'month')); return done(ctx, { reload: true, toast: { title: 'Month closed', body: str(b, 'month'), kind: 'success' } }); });
  r.post('/money/months/reopen', async (ctx) => { const me = user(ctx); const b = await ctx.body(); reopenMonth(app, me, str(b, 'month')); return done(ctx, { reload: true, toast: { title: 'Month reopened', body: str(b, 'month'), kind: 'info' } }); });
  r.post('/money/months/posted', async (ctx) => { const me = accountsOnly(ctx); const b = await ctx.body(); markPosted(app, me, str(b, 'month'), b.on === true || b.on === 'true'); return done(ctx, { reload: true, toast: { title: 'Saved', kind: 'success' } }); });
  r.get('/money/books.csv', (ctx) => {
    accountsOnly(ctx); const month = ctx.query.get('month') || ''; const x = booksExport(app, month);
    const cell = (v: string | number): string => { const t = String(v ?? ''); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return file('﻿' + [x.columns, ...x.rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n', `loyalflow-expenses-${month}.csv`, 'text/csv; charset=utf-8');
  });
  r.get('/money/doc/:id', (ctx) => { const d = readDoc(app, user(ctx), Number(ctx.params.id)); return file(d.body, d.name, d.mime, true); });
  r.get('/money/:id/pay', (ctx) => {
    const v = view(ctx); if (!isAccounts(app, v.user)) return fail(ctx, 403, 'Payments are recorded by Accounts.');
    const c = getClaim(app, ctx.params.id); if (!c) return fail(ctx, 404, 'That claim does not exist.');
    return htmlResponse(payModal(v, c, c.kind === 'advance' ? advanceState(app, c.id) : null, localDateString(new Date())));
  });
  r.post('/money/:id/pay', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const c = getClaim(app, ctx.params.id); if (!c) return fail(ctx, 404, 'That claim does not exist.');
    const input = { date: str(b, 'date'), mode: str(b, 'mode'), ref: str(b, 'ref'), note: str(b, 'note'), amount: num(b, 'amount'), doc: str(b, 'doc') || undefined, docName: str(b, 'docName') };
    // A bill handed over at the counter is attached first, so the payment has its support.
    if (c.kind !== 'advance' && !c.bills && input.doc) { addDoc(app, me, c.id, 'bill', input.doc, input.docName || 'bill.jpg'); input.doc = undefined; }
    const out = c.kind === 'advance' && c.status === 'paid' ? settleAdvance(app, me, c.id, input) : markPaid(app, me, c.id, input);
    return done(ctx, { reload: true, toast: { title: out.status === 'settled' ? 'Advance settled' : 'Recorded in the ledger', body: `${out.id} · ${out.employee_name}`, kind: 'success' } });
  });
  r.post('/money/:id/docs', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); if (!str(b, 'doc')) return fail(ctx, 400, 'Choose a file first.');
    const d = addDoc(app, me, ctx.params.id, str(b, 'kind'), str(b, 'doc'), str(b, 'docName') || 'document.jpg');
    return done(ctx, { reload: true, toast: { title: 'Document attached', body: d.file_name, kind: 'success' } });
  });
  r.get('/money/:id', (ctx) => {
    const v = view(ctx); const c = requireClaim(app, v.user, ctx.params.id);
    return htmlResponse(claimPage(v, { c, docs: listDocs(app, c.id), entries: entriesOf(app, c.id), state: c.kind === 'advance' && ['paid', 'settled'].includes(c.status) ? advanceState(app, c.id) : null,
      settlements: c.kind === 'advance' ? settlementsOf(app, c.id) : [], advance: c.advance_id ? getClaim(app, c.advance_id) || null : null, accounts: isAccounts(app, v.user), own: c.employee_id === v.user.id }));
  });
}
