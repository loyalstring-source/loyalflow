import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, passwordProblems, safeEqual, hmac } from '../../src/lib/crypto.ts';
import { html, raw, jsonScript, join, when } from '../../src/lib/html.ts';
import { buildXlsx, colName, zip } from '../../src/lib/xlsx.ts';

test('passwords are hashed with scrypt and verified in constant time', () => {
  const h = hashPassword('Correct-Horse-9');
  assert.match(h, /^scrypt\$/);
  assert.equal(verifyPassword('Correct-Horse-9', h), true);
  assert.equal(verifyPassword('wrong', h), false);
  assert.equal(verifyPassword('x', null), false);
  assert.notEqual(hashPassword('same'), hashPassword('same'));
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(hmac('k', 'v'), hmac('k', 'v'));
});

test('password rules: 10+ chars, letter and digit, no obvious words', () => {
  assert.ok(passwordProblems('short1'));
  assert.ok(passwordProblems('onlyletters'));
  assert.ok(passwordProblems('Welcome12345'));
  assert.equal(passwordProblems('Correct-Horse-9'), null);
});

test('html template escapes values and passes Raw through', () => {
  const name = '<script>alert(1)</script>';
  assert.equal(html`<b>${name}</b>`.toString(), '<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>');
  assert.equal(html`<i>${raw('<u>ok</u>')}</i>`.toString(), '<i><u>ok</u></i>');
  assert.equal(html`${[1, 2, html`<s>${'x'}</s>`]}`.toString(), '12<s>x</s>');
  assert.equal(html`${null}${false}${undefined}${true}`.toString(), '');
  assert.equal(join(['a', 'b'], ',').toString(), 'a,b');
  assert.equal(when(false, 'x').toString(), '');
  assert.equal(when(true, () => html`y`).toString(), 'y');
  assert.equal(jsonScript({ a: '</script>' }).toString(), '{"a":"\\u003c/script>"}');
});

test('xlsx writer produces a valid zip with the expected parts', () => {
  const buf = buildXlsx([{ name: 'Data', columns: [{ header: 'Name' }, { header: 'Amount', format: 'inr' }, { header: 'When', format: 'date' }], rows: [['Omkar <Tech>', 12345.5, new Date('2026-11-02T00:00:00Z')], ['Prime', null, null]] }]);
  assert.equal(buf.readUInt32LE(0), 0x04034b50); // local file header signature
  const text = buf.toString('latin1');
  assert.ok(text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('[Content_Types].xml'));
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50); // end of central directory
  assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(26), 'AA'); assert.equal(colName(701), 'ZZ');
  const z = zip([{ name: 'a.txt', data: 'hello' }]);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 1);
});
