// Sales: product catalogue, estimates, and the public page a customer opens from the link.
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, HttpError, type Response } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import { can, requireCan, scopeFor } from '../lib/scope.ts';
import { getSetting } from '../lib/settings.ts';
import {
  listProducts, getProduct, saveProduct, setProductImage, canManageCatalogue, imageRoot, imageMime, estimateSettings, saveEstimateSettings,
  listEstimates, requireEstimate, estimateByToken, estimateItems, estimatesOfDeal, createEstimate, saveEstimate, finaliseEstimate, sendEstimate, sendBlock, decideEstimate, canEditEstimate, type LineInput
} from '../modules/sales/estimates.ts';
import { productsPage, productFormPage, estimatesListPage, estimatePage, publicEstimatePage, publicEstimateMissing } from '../ui/pages/estimates.ts';
import { done, fail, view, user, str, num } from './helpers.ts';

const PAGE = 50;
function image(app: App, rel: string): Response {
  const base = imageRoot(app); const path = join(base, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!rel || !path.startsWith(base) || !existsSync(path)) return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
  return { status: 200, headers: { 'content-type': imageMime(path), 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' }, body: readFileSync(path) };
}

export function registerPublic(r: Router<Employee>, app: App): void {
  const quiet = (res: Response): Response => { res.headers = { ...res.headers, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' }; return res; };
  const show = (token: string, msg: { ok?: string; error?: string } = {}, status = 200): Response => {
    const e = estimateByToken(app, token);
    if (!e || e.status === 'draft' || e.status === 'final') return quiet(htmlResponse(publicEstimateMissing(), 404));
    return quiet(htmlResponse(publicEstimatePage(e, estimateItems(app, e.id), estimateSettings(app), token, msg), status));
  };
  r.get('/e/:token', (ctx) => show(ctx.params.token));
  r.get('/e/:token/img/:item', (ctx) => {
    const e = estimateByToken(app, ctx.params.token); if (!e || e.status === 'draft' || e.status === 'final') return { status: 404, headers: {}, body: '' };
    const it = estimateItems(app, e.id).find((i) => String(i.id) === ctx.params.item);
    return image(app, it?.image_path || '');
  });
  r.post('/e/:token/respond', async (ctx) => {
    const e = estimateByToken(app, ctx.params.token); if (!e) return quiet(htmlResponse(publicEstimateMissing(), 404));
    const b = await ctx.body(); const decision = str(b, 'decision');
    if (decision !== 'accepted' && decision !== 'declined') return show(ctx.params.token, { error: 'Please choose Accept or Decline.' }, 400);
    try { decideEstimate(app, null, e, decision, str(b, 'by'), str(b, 'note')); } catch (err) { if (!(err instanceof HttpError)) throw err; return show(ctx.params.token, { error: err.message }, 400); }
    return show(ctx.params.token, { ok: decision === 'accepted' ? 'Thank you. Your acceptance has been recorded and our team will be in touch.' : 'Thank you. We have recorded that you declined this estimate.' });
  });
}

export function register(r: Router<Employee>, app: App): void {
  const db = app.db;
  const discountRule = (): string => { const rules = getSetting(db, 'approvals').discount; return `An overall discount above ${rules[0]?.maxPct ?? 5}% goes for approval when you finalise; the estimate can be sent once it is approved.`; };

  // ----- Products -----
  r.get('/products', (ctx) => { const v = view(ctx); requireCan(db, v.user, 'sales.view'); return htmlResponse(productsPage(v, { products: listProducts(app), canManage: canManageCatalogue(app, v.user), settings: estimateSettings(app) })); });
  r.get('/products/new', (ctx) => { const v = view(ctx); if (!canManageCatalogue(app, v.user)) return fail(ctx, 403, 'Only sales managers change the product list.'); return htmlResponse(productFormPage(v, null)); });
  r.get('/products/:id/edit', (ctx) => { const v = view(ctx); if (!canManageCatalogue(app, v.user)) return fail(ctx, 403, 'Only sales managers change the product list.'); const p = getProduct(app, ctx.params.id); if (!p) return fail(ctx, 404, 'No such product.'); return htmlResponse(productFormPage(v, p)); });
  r.get('/products/:id/image', (ctx) => { requireCan(db, user(ctx), 'sales.view'); return image(app, getProduct(app, ctx.params.id)?.image_path || ''); });
  r.post('/products', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const p = saveProduct(app, me, { id: str(b, 'id') || undefined, name: str(b, 'name'), description: str(b, 'description'), unit: str(b, 'unit'), price: num(b, 'price'), hsn: str(b, 'hsn'), gstRate: num(b, 'gstRate'), active: str(b, 'active', '1') !== '0' });
    return done(ctx, { data: { id: p.id }, redirect: '/products', toast: { title: `${p.name} saved`, kind: 'success' } });
  });
  r.post('/products/:id/image', async (ctx) => { const me = user(ctx); const b = await ctx.body(); setProductImage(app, me, ctx.params.id, str(b, 'name'), str(b, 'data')); return done(ctx, { toast: { title: 'Picture saved', kind: 'success' } }); });
  r.post('/estimates/settings', async (ctx) => { const me = user(ctx); saveEstimateSettings(app, me, await ctx.body()); return done(ctx, { reload: true, toast: { title: 'Estimate details saved', kind: 'success' } }); });

  // ----- Estimates -----
  r.get('/estimates', (ctx) => {
    const v = view(ctx); requireCan(db, v.user, 'sales.view');
    const scope = scopeFor(db, v.user); const ownerIds = scope.level === 'company' || can(db, v.user, 'sales.manage') ? undefined : [...scope.people];
    const status = ctx.query.get('status') || ''; const q = (ctx.query.get('q') || '').trim(); const pageNo = Math.max(1, Number(ctx.query.get('page')) || 1);
    const { rows, total } = listEstimates(app, { ownerIds, status, q, limit: PAGE, offset: (pageNo - 1) * PAGE });
    const counts: Record<string, number> = {}; for (const s of ['draft', 'sent', 'accepted', 'declined']) counts[s] = listEstimates(app, { ownerIds, status: s, limit: 1 }).total;
    return htmlResponse(estimatesListPage(v, { rows, total, status, q, pageNo, pages: Math.max(1, Math.ceil(total / PAGE)), counts }));
  });
  r.post('/deals/:id/estimate', (ctx) => {
    const me = user(ctx); requireCan(db, me, 'sales.write'); const e = createEstimate(app, me, ctx.params.id);
    return done(ctx, { redirect: `/estimates/${e.id}` });
  });
  r.get('/estimates/:id', (ctx) => {
    const v = view(ctx); requireCan(db, v.user, 'sales.view'); const e = requireEstimate(app, ctx.params.id);
    const scope = scopeFor(db, v.user); if (!(scope.level === 'company' || can(db, v.user, 'sales.manage') || scope.people.has(e.owner_id || ''))) return fail(ctx, 403, 'This estimate belongs to another person\'s deal.');
    const canEdit = canEditEstimate(app, v.user, e); const block = sendBlock(app, e);
    return htmlResponse(estimatePage(v, { e, items: estimateItems(app, e.id), settings: estimateSettings(app), canEdit, sendBlock: block, link: canEdit && e.share_token && e.status !== 'superseded' ? `${app.cfg.baseUrl}/e/${e.share_token}` : null,
      versions: estimatesOfDeal(app, e.deal_id), products: listProducts(app, { activeOnly: true }), discountRule: discountRule() }));
  });
  r.get('/estimates/:id/img/:item', (ctx) => {
    requireCan(db, user(ctx), 'sales.view'); const e = requireEstimate(app, ctx.params.id);
    return image(app, estimateItems(app, e.id).find((i) => String(i.id) === ctx.params.item)?.image_path || '');
  });
  r.post('/estimates/:id', async (ctx) => {
    const me = user(ctx); const b = await ctx.body();
    const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).map((i): LineInput => ({ productId: String(i.productId || '') || null, name: String(i.name || ''), description: String(i.description || ''), hsn: String(i.hsn || ''), unit: String(i.unit || ''), qty: i.qty as string, rate: i.rate as string, discountPct: i.discountPct as string, gstRate: i.gstRate as string })) : undefined;
    saveEstimate(app, me, ctx.params.id, { billName: str(b, 'billName') || undefined, billGstin: b.billGstin === undefined ? undefined : str(b, 'billGstin'), billContact: b.billContact === undefined ? undefined : str(b, 'billContact'), billAddress: b.billAddress === undefined ? undefined : str(b, 'billAddress'),
      estimateDate: str(b, 'estimateDate') || undefined, validUntil: str(b, 'validUntil') || undefined, taxMode: str(b, 'taxMode') || undefined, placeOfSupply: b.placeOfSupply === undefined ? undefined : str(b, 'placeOfSupply'), subject: b.subject === undefined ? undefined : str(b, 'subject'), notes: b.notes === undefined ? undefined : str(b, 'notes'), terms: b.terms === undefined ? undefined : str(b, 'terms'), items });
    return done(ctx, { toast: { title: 'Draft saved', kind: 'success' } });
  });
  r.post('/estimates/:id/finalise', (ctx) => {
    const me = user(ctx); const out = finaliseEstimate(app, me, ctx.params.id);
    return done(ctx, { reload: true, toast: out.approvalTaskId && out.deal.discount_status === 'pending' ? { title: 'Finalised; discount sent for approval', body: 'You can send it to the customer once the discount is approved.', kind: 'warn' } : { title: 'Estimate finalised', body: 'Press Send to customer to get the link.', kind: 'success' } });
  });
  r.post('/estimates/:id/send', (ctx) => {
    const me = user(ctx); const first = requireEstimate(app, ctx.params.id).status === 'final'; sendEstimate(app, me, ctx.params.id);
    return done(ctx, { reload: true, toast: { title: first ? 'Marked as sent' : 'Link ready', body: 'Copy the link on this page and send it to the customer.', kind: 'success' } });
  });
  r.post('/estimates/:id/decide', async (ctx) => {
    const me = user(ctx); const b = await ctx.body(); const decision = str(b, 'decision');
    if (decision !== 'accepted' && decision !== 'declined') return fail(ctx, 400, 'Choose Accepted or Declined.');
    decideEstimate(app, me, requireEstimate(app, ctx.params.id), decision, str(b, 'by'), str(b, 'note'));
    return done(ctx, { reload: true, toast: { title: `Recorded as ${decision}`, kind: 'success' } });
  });
  void redirect;
}
