// Expenses and advances: claiming, the Accounts desk, documents, payments and the ledger.
import type { App } from '../app.ts';
import { Router, htmlResponse, file } from '../lib/http.ts';
import { type Employee, listEmployees } from '../modules/people/model.ts';
import { scopeFor } from '../lib/scope.ts';
import { localDateString } from '../lib/time.ts';
import { submitClaim, requireClaim, getClaim, listDocs, addDoc, readDoc, markPaid, settleAdvance, advanceState, openAdvances, myClaims, settlementsOf, entriesOf, accountsDesk, ledger, balanceOf, balances, isAccounts, type Kind } from '../modules/money/service.ts';
import { budgetFor } from '../modules/ops/service.ts';
import { getReport } from '../modules/reports/engine.ts';
import { listDeals } from '../modules/sales/service.ts';
import { myMoneyPage, newClaimModal, claimPage, payModal, accountsPage, ledgerPage } from '../ui/pages/money.ts';
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
    const c = submitClaim(app, me, { kind: str(b, 'kind'), category: str(b, 'category'), amount: num(b, 'amount'), description: str(b, 'description'), expenseDate: str(b, 'expenseDate'), advanceId: str(b, 'advanceId'), dealId: str(b, 'dealId'), km: num(b, 'km'), doc: str(b, 'doc') || undefined, docName: str(b, 'docName') });
    return done(ctx, { reload: true, toast: { title: c.kind === 'advance' ? 'Advance requested' : c.kind === 'settlement' ? 'Bills sent for approval' : 'Expense sent for approval', body: `With ${c.approver_name || 'your approver'}.${c.kind !== 'advance' && !c.docs ? ' Remember to attach the bill.' : ''}`, kind: 'success' } });
  });
  r.get('/money/accounts', (ctx) => { const v = view(ctx); if (!isAccounts(app, v.user)) return fail(ctx, 403, 'The Accounts desk is for the Accounts team.'); return htmlResponse(accountsPage(v, accountsDesk(app))); });
  r.get('/money/ledger', (ctx) => {
    const v = view(ctx); const me = v.user; const acc = isAccounts(app, me); const scope = scopeFor(app.db, me); const wide = acc || scope.level !== 'self';
    const allowed = (id: string): boolean => acc || scope.people.has(id);
    const asked = ctx.query.get('person') || ''; const personId = !wide ? me.id : asked && allowed(asked) ? asked : '';
    const people = wide ? listEmployees(app.db, { status: 'active' }).filter((e) => allowed(e.id)).map((e) => ({ id: e.id, full_name: e.full_name })) : [];
    const entries = ledger(app, { employeeId: personId || undefined, people: acc ? null : scope.people }).reverse().slice(0, 500);
    const name = personId ? (personId === me.id ? me.full_name : people.find((p) => p.id === personId)?.full_name || personId) : '';
    return htmlResponse(ledgerPage(v, { entries, person: personId ? { id: personId, name } : null, balance: personId ? balanceOf(app, personId) : 0, balances: personId ? [] : balances(app).filter((b) => allowed(b.id)), people, accounts: acc, wide, canExport: !!getReport('fin-ledger')?.allowed(app, me) }));
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
    if (c.kind === 'reimbursement' && !c.bills && input.doc) { addDoc(app, me, c.id, 'bill', input.doc, input.docName || 'bill.jpg'); input.doc = undefined; }
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
