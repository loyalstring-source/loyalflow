// Settings → Lists: the choices in every module can be changed without a developer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, type TestServer, emp, HR, COO, SUPPORT_IC } from '../helpers.ts';
import * as lists from '../../src/lib/lists.ts';
import { LOST_REASONS, STAGE_LABEL, WIN_CHANCE } from '../../src/modules/sales/service.ts';
import { ONBOARDING_TEMPLATE, SCORE_AREAS, ROUND_TYPES } from '../../src/modules/hr/recruiting.ts';
import { MISS_REASONS, reasonLabel } from '../../src/modules/hr/attendance-rules.ts';
import { WO_LABEL } from '../../src/modules/production/service.ts';
import { leaveBalance } from '../../src/routes/today.ts';
import { probationDue } from '../../src/modules/hr/appraisal.ts';

let s: TestServer; let coo: Client; let hr: Client; let ic: Client;
before(async () => { s = await startServer(); coo = new Client(s.base); await coo.login(COO); hr = new Client(s.base); await hr.login(HR); ic = new Client(s.base); await ic.login(SUPPORT_IC); });
after(async () => { await s.close(); });

/** The form body the screen sends for a list: its current rows, plus changes. */
function form(key: string, change: (rows: lists.ListItem[]) => void, added: { label: string; n?: number }[] = []): Record<string, unknown> {
  const rows = lists.allItems(key).map((r) => ({ ...r })); change(rows);
  const b: Record<string, unknown> = { key, count: rows.length };
  rows.forEach((r, i) => { b[`value_${i}`] = r.value; b[`label_${i}`] = r.label; if (r.labelHi) b[`labelHi_${i}`] = r.labelHi; if (r.n != null) b[`n_${i}`] = r.n; b[`on_${i}`] = r.active ? '1' : '0'; });
  added.forEach((a, i) => { b[`new_label_${i}`] = a.label; if (a.n != null) b[`new_n_${i}`] = a.n; b[`new_on_${i}`] = '1'; });
  return b;
}

describe('lists and options', () => {
  test('every module tab opens for the COO', async () => {
    for (const m of lists.MODULES) { const r = await coo.get('/lists?module=' + encodeURIComponent(m)); assert.equal(r.status, 200, m); const h = await r.text(); for (const d of lists.LIST_DEFS.filter((x) => x.module === m)) assert.ok(h.includes(d.title), d.title); }
  });

  test('sales: add a lost reason, rename a stage and change its win chance', async () => {
    let r = await coo.postJson('/lists/save', form('sales.lostReasons', () => {}, [{ label: 'Went with in-house team' }]));
    assert.equal(r.status, 200); assert.ok(LOST_REASONS.includes('Went with in-house team'));
    r = await coo.postJson('/lists/save', form('sales.stages', (rows) => { const d = rows.find((x) => x.value === 'demo')!; d.label = 'Site demo'; d.n = 60; rows.find((x) => x.value === 'won')!.n = 5; }));
    assert.equal(r.status, 200); assert.equal(STAGE_LABEL.demo, 'Site demo'); assert.equal(WIN_CHANCE.demo, 60); assert.equal(WIN_CHANCE.won, 100, 'won stays 100%');
    const page = await (await coo.get('/pipeline')).text(); assert.ok(page.includes('Site demo'));
  });

  test('a retired entry leaves the drop-down but keeps its name on old records', async () => {
    const r = await coo.postJson('/lists/save', form('hr.missReasons', (rows) => { rows.find((x) => x.value === 'machine')!.active = false; rows.find((x) => x.value === 'other')!.active = false; }));
    assert.equal(r.status, 200);
    assert.ok(!MISS_REASONS.some((x) => x.value === 'machine')); assert.equal(reasonLabel('machine'), 'Machine not working or not reading');
    assert.ok(MISS_REASONS.some((x) => x.value === 'other'), '"Other" cannot be switched off');
  });

  test('leave: a new type appears in the balance and can be requested', async () => {
    const r = await coo.postJson('/lists/save', form('hr.leaveTypes', (rows) => { rows.find((x) => x.value === 'CL')!.n = 10; }, [{ label: 'Comp off', n: 4 }]));
    assert.equal(r.status, 200);
    const me = emp(s.app, SUPPORT_IC); const bal = leaveBalance(s.app, me.id);
    assert.equal(bal.find((t) => t.code === 'CL')!.quota, 10);
    const co = bal.find((t) => t.label === 'Comp off')!; assert.equal(co.quota, 4);
    const modal = await (await ic.get('/approvals/leave/new')).text(); assert.ok(modal.includes('Comp off'));
    const q = await ic.postJson('/leave', { type: co.code, from: '2027-02-08', to: '2027-02-08', reason: 'Worked on Sunday' });
    assert.equal(q.status, 200);
    assert.equal(s.app.db.get<{ type: string }>('SELECT type FROM leave_requests WHERE employee_id = ? ORDER BY rowid DESC LIMIT 1', [me.id])!.type, co.code);
  });

  test('hiring: scorecard areas, interview kinds and onboarding steps; gate steps stay', async () => {
    let r = await hr.postJson('/lists/save', form('hire.scoreAreas', () => {}, [{ label: 'Product knowledge' }])); assert.equal(r.status, 200);
    assert.ok(SCORE_AREAS.some((a) => a.label === 'Product knowledge'));
    r = await hr.postJson('/lists/save', form('hire.roundTypes', () => {}, [{ label: 'Client round' }])); assert.equal(r.status, 200); assert.ok(ROUND_TYPES.includes('client_round'));
    r = await hr.postJson('/lists/save', form('hire.onboarding', (rows) => { for (const x of rows) x.active = x.value === 'documents'; }, [{ label: 'ID card issued', n: 2 }])); assert.equal(r.status, 200);
    const keys = ONBOARDING_TEMPLATE.map((t) => t.key);
    for (const g of ['employee_record', 'training_done', 'training_assessment']) assert.ok(keys.includes(g), g);
    assert.ok(!keys.includes('it_setup')); assert.equal(ONBOARDING_TEMPLATE.find((t) => t.label === 'ID card issued')!.dueDays, 2);
    assert.equal(ONBOARDING_TEMPLATE.find((t) => t.label === 'ID card issued')!.gate, false);
  });

  test('production stage names in English and Hindi; limits', async () => {
    let r = await coo.postJson('/lists/save', form('production.stages', (rows) => { const p = rows.find((x) => x.value === 'packed')!; p.label = 'Packed and labelled'; p.labelHi = 'पैक और लेबल'; }));
    assert.equal(r.status, 200); assert.deepEqual(WO_LABEL.packed, { en: 'Packed and labelled', hi: 'पैक और लेबल' });
    r = await coo.postJson('/lists/numbers', { 'appraisal.probationMonths': 3, 'hire.cvBulkMax': 500 }); assert.equal(r.status, 200);
    assert.equal(probationDue('2026-01-15'), '2026-04-15'); assert.equal(lists.number('hire.cvBulkMax'), 50, 'held to the upper limit');
  });

  test('HR changes the people lists only; a team member changes nothing', async () => {
    assert.equal((await hr.get('/lists')).status, 200);
    const h = await (await hr.get('/lists')).text(); assert.ok(!h.includes('module=Sales'));
    assert.equal((await hr.postJson('/lists/save', form('sales.sources', () => {}, [{ label: 'X' }]))).status, 403);
    assert.equal((await hr.postJson('/lists/department', { name: 'Logistics', code: 'LOG' })).status, 403);
    assert.equal((await ic.get('/lists')).status, 403);
    assert.equal((await ic.postJson('/lists/save', form('hr.leaveTypes', () => {}))).status, 403);
  });

  test('departments and sites can be added and renamed', async () => {
    let r = await coo.postJson('/lists/department', { name: 'Logistics', code: 'log', band: 'operations', shiftCode: 'GEN' }); assert.equal(r.status, 200);
    assert.equal(s.app.db.get<{ name: string }>("SELECT name FROM departments WHERE id = 'LOG'")!.name, 'Logistics');
    assert.equal((await coo.postJson('/lists/department', { name: 'Logistics', code: 'LG2' })).status, 400);
    r = await coo.postJson('/lists/department', { id: 'LOG', name: 'Logistics and stores', band: 'operations', shiftCode: 'GEN' }); assert.equal(r.status, 200);
    r = await coo.postJson('/lists/site', { name: 'Bengaluru office', city: 'Bengaluru', code: 'BLR' }); assert.equal(r.status, 200);
    const people = await (await coo.get('/people')).text(); assert.ok(people.length > 1000);
    const page = await (await coo.get('/lists?module=Organisation')).text(); assert.ok(page.includes('Logistics and stores') && page.includes('Bengaluru office'));
  });

  test('reset puts a list back, and every change is in the audit trail', async () => {
    const r = await coo.postJson('/lists/reset', { key: 'sales.stages' }); assert.equal(r.status, 200);
    assert.equal(STAGE_LABEL.demo, 'Demo'); assert.equal(WIN_CHANCE.demo, 55);
    assert.ok(lists.listHistory(s.app.db).length >= 8);
  });
});
