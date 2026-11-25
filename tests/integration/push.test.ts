// Notifications to phones and browsers (web push): encryption against the RFC's worked example, VAPID, and the flow.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, verify, randomBytes } from 'node:crypto';
import { startServer, Client, type TestServer, testApp, emp, BDM, COO } from '../helpers.ts';
import { encrypt, b64u, unb64u, newVapid, vapidHeader, allowedEndpoint } from '../../src/lib/webpush.ts';
import { createTask } from '../../src/modules/tasks/service.ts';

type Sent = { url: string; headers: Record<string, string>; bytes: number };
const sent = (app: { push: unknown }): Sent[] => (app.push as { pushed: Sent[] }).pushed;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const browser = (path = 'abc'): { endpoint: string; keys: { p256dh: string; auth: string } } => { const e = createECDH('prime256v1'); e.generateKeys(); return { endpoint: `https://fcm.googleapis.com/fcm/send/${path}`, keys: { p256dh: b64u(e.getPublicKey()), auth: b64u(randomBytes(16)) } }; };

describe('web push', () => {
  test('encryption gives exactly the message in the worked example of RFC 8291', () => {
    const out = encrypt(Buffer.from('When I grow up, I want to be a watermelon'), 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', unb64u('DGv6ra1nlYgDCS1FRnbzlw'), { privateKey: unb64u('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
    assert.equal(b64u(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
    assert.throws(() => encrypt(Buffer.from('x'), 'AAAA', 'BTBZMqHH6r4Tts7J_aSIgg'), /expected form/);
  });
  test('the server signs who it is, for the push service the message goes to', () => {
    const k = newVapid(); const h = vapidHeader('https://web.push.apple.com/abc123', k, 'mailto:admin@loyalstring.com'); const [a, b, s] = h.split('t=')[1].split(',')[0].split('.'); const pub = unb64u(k.publicKey);
    assert.ok(verify('sha256', Buffer.from(`${a}.${b}`), { key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, unb64u(s)));
    const claims = JSON.parse(unb64u(b).toString()); assert.equal(claims.aud, 'https://web.push.apple.com'); assert.equal(claims.sub, 'mailto:admin@loyalstring.com'); assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600 + 5);
    assert.match(h, new RegExp(`k=${k.publicKey}$`));
  });
  test('only real push services are accepted as endpoints', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://web.push.apple.com/x', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-pn1p.notify.windows.com/w/?token=x']) assert.ok(allowedEndpoint(ok), ok);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://localhost:3000/admin', 'https://fcm.googleapis.com.evil.io/x', 'not a url']) assert.ok(!allowedEndpoint(bad), bad);
  });
  test('a notification also goes to every device the person turned on; a dead device is forgotten', async () => {
    const app = testApp(); const bdm = emp(app, BDM); const coo = emp(app, COO);
    createTask(app, coo, { title: 'Before turning on', assigneeId: bdm.id }); await settle(); assert.equal(sent(app).length, 0, 'nothing is sent to someone with no device');
    app.push.subscribe(bdm.id, browser('phone'), 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0'); app.push.subscribe(bdm.id, browser('gone-laptop'), 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Edg/130.0');
    assert.deepEqual(app.push.devices(bdm.id).map((d) => d.label).sort(), ['Android phone · Chrome', 'Windows computer · Edge']);
    createTask(app, coo, { title: 'Call Omkar Tech about the renewal', assigneeId: bdm.id }); await settle();
    assert.equal(sent(app).length, 2); const m = sent(app)[0]; assert.match(m.headers.Authorization, /^vapid t=.+, k=.+/); assert.equal(m.headers['Content-Encoding'], 'aes128gcm'); assert.equal(m.headers.TTL, '86400'); assert.ok(m.bytes > 100);
    assert.deepEqual(app.push.devices(bdm.id).map((d) => d.label), ['Android phone · Chrome'], 'the device the push service said is gone was removed'); assert.ok(app.push.devices(bdm.id)[0].last_ok_at);
    assert.throws(() => app.push.subscribe(bdm.id, { endpoint: 'https://evil.example.com/x', keys: browser().keys }, ''), /not one LoyalFlow knows/);
    assert.throws(() => app.push.subscribe(bdm.id, { endpoint: 'https://fcm.googleapis.com/fcm/send/y', keys: { p256dh: 'AAAA', auth: 'AA' } }, ''), /keys needed/);
  });
});

describe('web push in the browser', () => {
  let s: TestServer; before(async () => { s = await startServer(); }); after(async () => { await s.close(); });
  test('a person turns it on, sends a test and turns it off; the page and the service worker carry what is needed', async () => {
    const c = new Client(s.base); await c.login(BDM); const id = emp(s.app, BDM).id;
    const key = await (await c.get('/push/key')).json() as { key: string }; assert.equal(unb64u(key.key).length, 65); assert.equal(key.key, s.app.push.publicKey);
    assert.equal((await c.postJson('/push/test', {})).status, 400, 'nothing to test before it is on');
    const sub = browser('desk'); assert.equal((await c.postJson('/push/subscribe', sub)).status, 200); assert.equal((await c.postJson('/push/subscribe', sub)).status, 200, 'saving the same device twice is fine'); assert.equal(s.app.push.devices(id).length, 1);
    assert.equal((await c.postJson('/push/subscribe', { endpoint: 'https://evil.example.com/x', keys: sub.keys })).status, 400);
    const t = await c.postJson('/push/test', {}); assert.equal(t.status, 200); assert.ok(sent(s.app).some((m) => m.url === sub.endpoint));
    const page = await (await c.get('/notifications')).text(); assert.match(page, /data-push-card/); assert.match(page, /Turn on notifications/); assert.match(page, /On for: /);
    const sw = await (await c.get('/sw.js')).text(); assert.match(sw, /addEventListener\('push'/); assert.match(sw, /notificationclick/);
    assert.equal((await c.postJson('/push/unsubscribe', { endpoint: sub.endpoint })).status, 200); assert.equal(s.app.push.devices(id).length, 0);
    assert.equal((await new Client(s.base).get('/push/key')).status === 200, false, 'signed-out visitors get nothing');
  });
});
