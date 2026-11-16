// Sales: product catalogue and estimates with GST on each line.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, testApp, emp, COO, BDM, SALES_HEAD, SUPPORT_IC, HR } from '../helpers.ts';
import { computeLine, computeTotals, saveProduct, setProductImage, createEstimate, saveEstimate, finaliseEstimate, sendEstimate, sendBlock, decideEstimate, getEstimate, estimateItems, estimatesOfDeal, saveEstimateSettings, estimateSettings, shownStatus } from '../../src/modules/sales/estimates.ts';
import { createDeal, getDeal, moveDeal, updateDeal } from '../../src/modules/sales/service.ts';
import { decideTask } from '../../src/modules/tasks/service.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let s: TestServer;
before(async () => { s = await startServer(); });
after(async () => { await s.close(); });
const login = async (email: string): Promise<Client> => { const c = new Client(s.base); await c.login(email); return c; };

describe('the sums', () => {
  test('a line: quantity × rate, less discount, plus GST on what is left', () => {
    assert.deepEqual(computeLine({ qty: 3, rate: 1999.99, discount_pct: 10, gst_rate: 18 }), { gross: 5999.97, discount: 600, taxable: 5399.97, tax: 971.99, amount: 6371.96 });
    assert.deepEqual(computeLine({ qty: 2, rate: 500, discount_pct: 0, gst_rate: 0 }), { gross: 1000, discount: 0, taxable: 1000, tax: 0, amount: 1000 });
  });
  test('totals add the lines and group GST by rate', () => {
    const t = computeTotals([{ qty: 10, rate: 100, discount_pct: 0, gst_rate: 18 }, { qty: 1, rate: 1000, discount_pct: 20, gst_rate: 18 }, { qty: 4, rate: 250, discount_pct: 0, gst_rate: 5 }]);
    assert.deepEqual([t.gross, t.discount, t.taxable, t.tax, t.total], [3000, 200, 2800, 374, 3174]);
    assert.deepEqual(t.byRate, [{ rate: 5, taxable: 1000, tax: 50 }, { rate: 18, taxable: 1800, tax: 324 }]);
  });
});

describe('products', () => {
  test('a sales manager adds a product with a picture; others cannot; bad input is refused', () => {
    const app = testApp(); const head = emp(app, SALES_HEAD); const bdm = emp(app, BDM);
    const p = saveProduct(app, head, { name: 'UHF RFID Reader', description: 'Fixed reader, 4 ports', unit: 'Nos', price: 42000, hsn: '84719000', gstRate: 18 });
    assert.equal(p.price, 42000); assert.equal(p.gst_rate, 18);
    assert.ok(setProductImage(app, head, p.id, 'reader.png', 'data:image/png;base64,' + PNG).image_path.endsWith('.png'));
    assert.throws(() => setProductImage(app, head, p.id, 'reader.png', Buffer.from('not a picture').toString('base64')), /not a PNG/);
    assert.throws(() => setProductImage(app, head, p.id, 'reader.exe', PNG), /PNG, JPG or WebP/);
    assert.throws(() => saveProduct(app, bdm, { name: 'X1', price: 1 }), /sales managers/);
    assert.throws(() => saveProduct(app, head, { name: 'uhf rfid reader', price: 1 }), /already a product/);
    assert.throws(() => saveProduct(app, head, { name: 'Tag', price: -1 }), /price/);
    assert.throws(() => saveProduct(app, head, { name: 'Tag', price: 5, hsn: 'AB' }), /HSN/);
    assert.equal(saveProduct(app, head, { id: p.id, name: p.name, price: 45000, active: false }).active, 0);
  });
});

describe('an estimate from draft to the customer', () => {
  test('lines, GST on each line, finalise sets the deal, send gives a link, the customer accepts', async () => {
    const app = s.app; const head = emp(app, SALES_HEAD); const bdm = emp(app, BDM);
    const reader = saveProduct(app, head, { name: 'Handheld Reader T1', description: 'Android handheld', unit: 'Nos', price: 30000, hsn: '84719000', gstRate: 18 });
    setProductImage(app, head, reader.id, 'r.png', PNG);
    const tag = saveProduct(app, head, { name: 'Jewellery Tag T1', unit: 'Roll', price: 2500, gstRate: 12 });
    saveEstimateSettings(app, head, { sellerName: 'Loyal String Pvt Ltd', gstin: '27ABCDE1234F1Z5', address: 'Pune', validityDays: 10 });
    assert.equal(estimateSettings(app).validityDays, 10);
    const d = createDeal(app, bdm, { customerName: 'Estimate Test Jewellers', city: 'Pune', title: 'RFID for two stores', value: 1, source: 'Referral' });
    updateDeal(app, bdm, d.id, { qualified_need: 'Stock audit', qualified_budget: '2L', qualified_timeline: 'This quarter' } as any);
    moveDeal(app, bdm, d.id, 'contacted'); moveDeal(app, bdm, d.id, 'qualified'); moveDeal(app, bdm, d.id, 'demo');
    assert.throws(() => moveDeal(app, bdm, d.id, 'proposal'), /estimate/);

    const c = await login(BDM);
    const made = await c.postJson(`/deals/${d.id}/estimate`, {}); assert.equal(made.status, 200);
    const id = made.json.redirect.split('/').pop() as string;
    assert.equal((await c.postJson(`/deals/${d.id}/estimate`, {})).json.redirect, `/estimates/${id}`, 'a second press continues the same draft');
    const page = await (await c.get(`/estimates/${id}`)).text(); assert.ok(page.includes('est-lines') && page.includes('Handheld Reader T1'));
    assert.equal((await c.postJson(`/estimates/${id}/finalise`, {})).status, 400, 'an empty estimate cannot be finalised');
    const save = await c.postJson(`/estimates/${id}`, { billName: 'Estimate Test Jewellers', billGstin: '27AAAAA0000A1Z5', billAddress: 'MG Road, Pune', taxMode: 'intra',
      items: [{ productId: reader.id, qty: 2 }, { productId: tag.id, qty: 10, discountPct: 4 }, { name: 'Installation and training', qty: 1, unit: 'Nos', rate: 5000, gstRate: 18 }, { name: '', qty: 1 }] });
    assert.equal(save.status, 200, JSON.stringify(save.json));
    let e = getEstimate(app, id)!; const items = estimateItems(app, id);
    assert.equal(items.length, 3, 'the blank line is dropped');
    assert.deepEqual(items.map((i) => [i.name, i.rate, i.gst_rate, i.taxable, i.tax, i.amount]), [['Handheld Reader T1', 30000, 18, 60000, 10800, 70800], ['Jewellery Tag T1', 2500, 12, 24000, 2880, 26880], ['Installation and training', 5000, 18, 5000, 900, 5900]]);
    assert.ok(items[0].image_path, 'the product picture is carried onto the line');
    assert.deepEqual([e.gross, e.discount_total, e.taxable, e.tax_total, e.total], [90000, 1000, 89000, 14580, 103580]);
    assert.equal((await c.postJson(`/estimates/${id}`, { billGstin: 'SHORT' })).status, 400);
    assert.equal((await c.postJson(`/estimates/${id}/send`, {})).status, 400, 'a draft cannot be sent');
    assert.equal((await new Client(s.base).get(`/e/${'0'.repeat(32)}`)).status, 404);

    assert.equal((await c.postJson(`/estimates/${id}/finalise`, {})).status, 200);
    const deal = getDeal(app, d.id)!; assert.equal(deal.value, 90000); assert.equal(deal.discount_pct, 1.11); assert.equal(deal.quote_attached, 1);
    moveDeal(app, bdm, d.id, 'proposal');
    assert.equal((await c.postJson(`/estimates/${id}`, { subject: 'changed' })).status, 400, 'figures are fixed after finalising');
    assert.equal((await c.postJson(`/estimates/${id}/send`, {})).status, 200);
    e = getEstimate(app, id)!; assert.equal(e.status, 'sent'); assert.match(e.share_token!, /^[a-f0-9]{32}$/);

    const customer = new Client(s.base);   // not signed in
    const pub = await customer.get(`/e/${e.share_token}`); assert.equal(pub.status, 200); const h = await pub.text();
    for (const x of ['Loyal String Pvt Ltd', '27ABCDE1234F1Z5', 'Handheld Reader T1', 'CGST 9%', 'SGST 9%', 'CGST 6%', '1,03,580.00', 'Accept this estimate']) assert.ok(h.includes(x), x);
    assert.ok(!h.includes('IGST') && !h.includes('/static/app.js'), 'no staff screens or scripts on the customer page');
    const img = await customer.get(`/e/${e.share_token}/img/${items[0].id}`); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await customer.get(`/estimates/${id}`)).status, 303, 'the staff page still needs a sign-in');
    const bad = await customer.postForm(`/e/${e.share_token}/respond`, { decision: 'accepted', by: '' }); assert.equal(bad.status, 400);
    const ok = await customer.postForm(`/e/${e.share_token}/respond`, { decision: 'accepted', by: 'Ramesh Shah', note: 'Please deliver by the 25th' }); assert.equal(ok.status, 200);
    e = getEstimate(app, id)!; assert.equal(e.status, 'accepted'); assert.equal(e.decided_by, 'Ramesh Shah');
    assert.equal((await customer.postForm(`/e/${e.share_token}/respond`, { decision: 'declined', by: 'Someone Else' })).status, 400, 'an answer cannot be changed from the link');
    assert.ok(app.db.get("SELECT 1 FROM notifications WHERE employee_id = ? AND title LIKE 'Estimate accepted%'", [bdm.id]));
    const list = await (await c.get('/estimates?status=accepted')).text(); assert.ok(list.includes('Estimate Test Jewellers'));
    const dealPage = await (await c.get(`/deals/${d.id}`)).text(); assert.ok(dealPage.includes(e.number) && dealPage.includes('Accepted'));
  });

  test('a big discount waits for approval; a new version replaces the old; other state shows IGST', () => {
    const app = testApp(); const head = emp(app, SALES_HEAD); const bdm = emp(app, BDM); const coo = emp(app, COO);
    const p = saveProduct(app, head, { name: 'Reader', price: 10000, gstRate: 18 });
    const d = createDeal(app, bdm, { customerName: 'Discount Test', title: 'x', value: 1, source: 'Referral' });
    const e1 = createEstimate(app, bdm, d.id);
    saveEstimate(app, bdm, e1.id, { taxMode: 'inter', items: [{ productId: p.id, qty: 10, discountPct: 20 }] });
    const out = finaliseEstimate(app, bdm, e1.id);
    assert.ok(out.approvalTaskId); assert.equal(out.deal.discount_status, 'pending'); assert.equal(out.deal.discount_pct, 20);
    assert.match(sendBlock(app, getEstimate(app, e1.id)!)!, /waiting for approval/);
    assert.throws(() => sendEstimate(app, bdm, e1.id), /waiting for approval/);
    const task = app.db.get<{ assignee_id: string }>('SELECT assignee_id FROM tasks WHERE id = ?', [out.approvalTaskId!])!;
    decideTask(app, app.db.get<any>('SELECT * FROM employees WHERE id = ?', [task.assignee_id]), out.approvalTaskId!, 'approved', 'Strategic account');
    assert.equal(sendBlock(app, getEstimate(app, e1.id)!), null);
    const sent = sendEstimate(app, bdm, e1.id); assert.equal(sent.estimate.status, 'sent');
    assert.throws(() => decideEstimate(app, emp(app, SUPPORT_IC), sent.estimate, 'accepted', 'Someone', ''), /deal owner/);

    const e2 = createEstimate(app, bdm, d.id); assert.equal(e2.version, 2); assert.equal(e2.number, e1.number); assert.equal(estimateItems(app, e2.id).length, 1);
    saveEstimate(app, bdm, e2.id, { items: [{ productId: p.id, qty: 10, discountPct: 2 }] }); finaliseEstimate(app, bdm, e2.id);
    assert.equal(getEstimate(app, e1.id)!.status, 'superseded'); assert.equal(getDeal(app, d.id)!.discount_pct, 2);
    assert.deepEqual(estimatesOfDeal(app, d.id).map((x) => x.version), [2, 1]);
    assert.throws(() => createEstimate(app, emp(app, SUPPORT_IC), d.id), /deal owner/);
    assert.equal(shownStatus({ ...getEstimate(app, e2.id)!, status: 'sent', valid_until: '2020-01-01' }), 'expired');
    void coo;
  });

  test('who can open what', async () => {
    const hr = await login(HR); assert.equal((await hr.get('/estimates')).status, 403); assert.equal((await hr.get('/products')).status, 403);
    const ic = await login(SUPPORT_IC); assert.equal((await ic.get('/products')).status, 200); assert.equal((await ic.get('/products/new')).status, 403);
    assert.equal((await ic.postJson('/products', { name: 'Sneaky', price: 1 })).status, 403);
    const head = await login(SALES_HEAD); assert.equal((await head.get('/products/new')).status, 200); assert.equal((await head.get('/estimates')).status, 200);
  });
});
