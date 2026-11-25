// Web Push without a third-party library: VAPID (RFC 8292) to identify this server to the browser's push service,
// and message encryption for the browser (RFC 8291, aes128gcm). The browser gives us an endpoint and two keys when a
// person turns notifications on; we encrypt each message for that browser and post it to the endpoint.
import { createECDH, createHmac, createCipheriv, randomBytes, generateKeyPairSync, createPrivateKey, sign as signData } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/index.ts';

export const b64u = (b: Buffer | Uint8Array): string => Buffer.from(b).toString('base64url');
export const unb64u = (s: string): Buffer => Buffer.from(s, 'base64url');
const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();

export interface VapidKeys { publicKey: string; privateKey: string }
/** One key pair per installation, kept beside the database. Losing it only means people turn notifications on again. */
export function loadOrCreateVapid(dataDir: string): VapidKeys {
  const file = join(dataDir, 'push.keys.json');
  if (existsSync(file)) { try { const k = JSON.parse(readFileSync(file, 'utf8')) as VapidKeys; if (k.publicKey && k.privateKey) return k; } catch { /* fall through and make a new pair */ } }
  const keys = newVapid(); writeFileSync(file, JSON.stringify(keys), { mode: 0o600 }); return keys;
}
export function newVapid(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string }; const d = (privateKey.export({ format: 'jwk' }) as { d: string }).d;
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(jwk.x), unb64u(jwk.y)])), privateKey: d };
}
/** The signed token that tells the push service which server is sending. */
export function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const pub = unb64u(keys.publicKey); const aud = new URL(endpoint).origin;
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))); const body = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: keys.privateKey }, format: 'jwk' });
  const sig = signData('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}
/** Encrypts a message for one browser. `salt` and `local` are given only by the test that checks this against the RFC's worked example. */
export function encrypt(plaintext: Buffer, p256dh: string, auth: string, salt: Buffer = randomBytes(16), local?: { privateKey: Buffer }): Buffer {
  const ua = unb64u(p256dh); const secret = unb64u(auth);
  if (ua.length !== 65 || ua[0] !== 4 || secret.length !== 16) throw new Error('The browser keys are not in the expected form.');
  const ecdh = createECDH('prime256v1'); if (local) ecdh.setPrivateKey(local.privateKey); else ecdh.generateKeys();
  const as = ecdh.getPublicKey(); const shared = ecdh.computeSecret(ua);
  const ikm = hmac(hmac(secret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.from([0, 0, 0x10, 0]);   // record size 4096
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, ct]);
}

export interface PushMessage { title: string; body?: string; link?: string; tag?: string }
export interface Subscription { id: number; employee_id: string; endpoint: string; p256dh: string; auth: string }
export interface Pusher {
  publicKey: string;
  /** Sends to every device the person has turned notifications on for. Never throws; resolves to how many were accepted. */
  toEmployee(employeeId: string, m: PushMessage): Promise<number>;
  subscribe(employeeId: string, sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, userAgent: string): void;
  unsubscribe(employeeId: string, endpoint: string): void;
  devices(employeeId: string): { id: number; label: string; created_at: string; last_ok_at: string | null }[];
}
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;
/** Only real push services may be posted to, so a made-up "subscription" cannot make the server call an arbitrary address. */
const ALLOWED = [/(^|\.)googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)mozaws\.net$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.services\.mozilla\.com$/];
export const allowedEndpoint = (endpoint: string): boolean => { try { const u = new URL(endpoint); return u.protocol === 'https:' && ALLOWED.some((r) => r.test(u.hostname)); } catch { return false; } };
const deviceLabel = (ua: string): string => { const os = /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Android/.test(ua) ? 'Android phone' : /Windows/.test(ua) ? 'Windows computer' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux computer' : 'Device'; const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser'; return `${os} · ${br}`; };

export function createPusher(db: Db, keys: VapidKeys, o: { subject: string; baseUrl: string; fetch?: Fetch }): Pusher {
  const post: Fetch = o.fetch || ((url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(8000) }) as Promise<{ status: number }>);
  async function toEmployee(employeeId: string, m: PushMessage): Promise<number> {
    let subs: Subscription[] = [];
    try { subs = db.all<Subscription>('SELECT id, employee_id, endpoint, p256dh, auth FROM push_subscriptions WHERE employee_id = ?', [employeeId]); } catch { return 0; }
    if (!subs.length) return 0;
    const payload = Buffer.from(JSON.stringify({ title: m.title.slice(0, 120), body: (m.body || '').slice(0, 300), url: m.link ? (m.link.startsWith('http') ? m.link : `${o.baseUrl}${m.link}`) : o.baseUrl, tag: m.tag || '' }));
    let ok = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        const res = await post(s.endpoint, { method: 'POST', headers: { Authorization: vapidHeader(s.endpoint, keys, o.subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' }, body: encrypt(payload, s.p256dh, s.auth) });
        // The browser has dropped this subscription (app removed, permission withdrawn): forget it.
        if (res.status === 404 || res.status === 410) { try { db.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]); } catch { /* database closed */ } }
        else if (res.status >= 200 && res.status < 300) { ok++; try { db.run('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?', [new Date().toISOString(), s.id]); } catch { /* database closed */ } }
      } catch { /* the push service could not be reached; the notification is still in LoyalFlow */ }
    }));
    return ok;
  }
  return {
    publicKey: keys.publicKey, toEmployee,
    subscribe(employeeId, sub, userAgent) {
      const endpoint = String(sub?.endpoint || ''); const p256dh = String(sub?.keys?.p256dh || ''); const auth = String(sub?.keys?.auth || '');
      if (!allowedEndpoint(endpoint)) throw new Error('This browser\'s push service is not one LoyalFlow knows.');
      if (unb64u(p256dh).length !== 65 || unb64u(auth).length !== 16) throw new Error('The browser did not send the keys needed.');
      const now = new Date().toISOString();
      db.run('INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth, label, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET employee_id = excluded.employee_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label', [employeeId, endpoint, p256dh, auth, deviceLabel(userAgent), now]);
      // Ten devices is plenty for one person; the oldest go first.
      db.run('DELETE FROM push_subscriptions WHERE employee_id = ? AND id NOT IN (SELECT id FROM push_subscriptions WHERE employee_id = ? ORDER BY id DESC LIMIT 10)', [employeeId, employeeId]);
    },
    unsubscribe(employeeId, endpoint) { db.run('DELETE FROM push_subscriptions WHERE employee_id = ? AND endpoint = ?', [employeeId, endpoint]); },
    devices(employeeId) { return db.all('SELECT id, label, created_at, last_ok_at FROM push_subscriptions WHERE employee_id = ? ORDER BY id DESC', [employeeId]); }
  };
}
