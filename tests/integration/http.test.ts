import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, COO, SUPPORT_IC, SUPPORT_LEAD, BDM, PRODUCTION_LEAD, HR, DEV_LEAD, PASSWORD, type TestServer } from '../helpers.ts';
import { listTickets } from '../../src/modules/desk/service.ts';

let srv: TestServer;
before(async () => { srv = await startServer({ demo: true }); });
after(async () => { await srv.close(); });

test('unauthenticated requests redirect to login; JSON callers get 401', async () => {
  const c = new Client(srv.base);
  const r = await c.get('/');
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location') || '', /^\/login\?next=/);
  const j = await c.get('/api/v1/me', { accept: 'application/json' });
  assert.equal(j.status, 401);
  const h = await c.get('/health');
  assert.equal(h.status, 200);
  const s = await c.get('/static/app.css');
  assert.equal(s.status, 200);
  assert.match(s.headers.get('content-type') || '', /text\/css/);
  const t = await c.get('/static/../package.json');
  assert.notEqual(t.status, 200, 'no path traversal');
});

test('login sets a session cookie, wrong passwords lock the account after five attempts', async () => {
  const c = new Client(srv.base);
  const bad = await c.postForm('/login', { email: COO, password: 'nope' });
  assert.equal(bad.status, 400, 'missing CSRF is rejected');
  const ok = await c.login(COO);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/');
  assert.ok(c.cookies.has('lf_session'));
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Good (morning|afternoon|evening), Sridhar/);

  const l = new Client(srv.base);
  for (let i = 0; i < 5; i++) { const r = await l.login(HR, 'wrong-password-1'); assert.equal(r.status, 401); }
  const locked = await l.login(HR, PASSWORD);
  assert.equal(locked.status, 401);
  assert.match(await locked.text(), /Too many attempts/);
  srv.app.db.run('UPDATE employees SET failed_logins = 0, locked_until = NULL WHERE email = ?', [HR]);
});

test('state-changing requests need CSRF for cookie sessions; JSON with the custom header is accepted', async () => {
  const c = new Client(srv.base);
  await c.login(SUPPORT_LEAD);
  const noCsrf = await fetch(srv.base + '/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `lf_session=${c.cookies.get('lf_session')}` }, body: JSON.stringify({ subject: 'x' }) });
  assert.equal(noCsrf.status, 403);
  const crossOrigin = await fetch(srv.base + '/tickets', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'LoyalFlow', origin: 'https://evil.example', cookie: `lf_session=${c.cookies.get('lf_session')}` }, body: JSON.stringify({ subject: 'x' }) });
  assert.equal(crossOrigin.status, 403);
  const created = await c.postJson('/tickets', { subject: 'CSRF-ok ticket', priority: 'P3', channel: 'email' });
  assert.equal(created.status, 200);
  assert.equal(created.json.ok, true);
  assert.match(created.json.toast.title, /T-\d+ created/);
  const csrf = await c.csrf();
  const form = await c.postForm('/tickets', { _csrf: csrf, subject: 'Form ticket', priority: 'P4', channel: 'phone' });
  assert.equal(form.status, 303, 'plain forms redirect');
  assert.ok(listTickets(srv.app, { q: 'Form ticket' }).length === 1);
});

test('the JSON API works with a bearer token and never needs CSRF', async () => {
  const login = await fetch(srv.base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: SUPPORT_IC, password: PASSWORD }) });
  const body = await login.json() as { ok: boolean; token: string; user: { id: string; permissions: string[] } };
  assert.equal(body.ok, true);
  assert.ok(body.token.length > 20);
  assert.ok(body.user.permissions.includes('desk.write'));
  const headers = { authorization: `Bearer ${body.token}`, accept: 'application/json', 'content-type': 'application/json' };
  const me = await (await fetch(srv.base + '/api/v1/me', { headers })).json() as { user: { id: string } };
  assert.equal(me.user.id, body.user.id);
  const today = await (await fetch(srv.base + '/api/v1/today', { headers })).json() as { ok: boolean; tickets: unknown[]; sops: unknown[] };
  assert.equal(today.ok, true);
  assert.ok(Array.isArray(today.tickets));
  const checkin = await (await fetch(srv.base + '/attendance/check-in', { method: 'POST', headers, body: JSON.stringify({ lat: 18.5, lng: 73.8 }) })).json() as { ok: boolean; toast: { title: string } };
  assert.equal(checkin.ok, true);
  assert.equal(checkin.toast.title, 'Checked in');
  const kpi = await fetch(srv.base + '/api/v1/kpi/company', { headers });
  assert.equal(kpi.status, 403, 'ICs cannot see the company page');
  const bad = await fetch(srv.base + '/api/v1/me', { headers: { authorization: 'Bearer nonsense' } });
  assert.equal(bad.status, 401);
});

test('every page renders for every kind of user', async () => {
  const pages = ['/', '/analytics', '/desk', '/dev', '/pipeline', '/production', '/sops', '/sops?tab=library', '/approvals', '/approvals?tab=mine', '/tasks', '/people', '/me', '/notifications', '/customers', '/search?q=omkar', '/kpi/sop_compliance'];
  const managerPages = ['/company', '/kpi/bookings_mtd', '/sops?tab=people', '/exports/company.xlsx', '/exports/tickets.xlsx', '/exports/pipeline.xlsx', '/exports/production.xlsx', '/exports/analytics.xlsx'];
  const adminPages = ['/settings', '/settings?section=sla', '/settings?section=shifts', '/settings?section=approvals', '/settings?section=ops', '/settings?section=system', '/settings/targets', '/exports/company.pptx', '/exports/attendance.xlsx', '/exports/people.xlsx'];
  for (const [email, kind] of [[COO, 'admin'], [SUPPORT_LEAD, 'manager'], [SUPPORT_IC, 'ic'], [BDM, 'ic'], [PRODUCTION_LEAD, 'manager'], [DEV_LEAD, 'manager'], [HR, 'ic']] as const) {
    const c = new Client(srv.base);
    const r = await c.login(email);
    assert.equal(r.status, 303, `${email} logs in`);
    // HR is limited to the people side and the company KPIs; the HR access test in hire.test.ts covers what is closed to them.
    const hrClosed = ['/analytics', '/desk', '/dev', '/pipeline', '/production', '/customers'];
    const list = [...pages, ...(kind !== 'ic' ? managerPages : []), ...(kind === 'admin' ? adminPages : [])].filter((p) => email !== HR || !hrClosed.includes(p));
    for (const p of list) {
      const res = await c.get(p);
      assert.equal(res.status, 200, `${email} GET ${p} → ${res.status}`);
    }
    if (kind === 'ic') {
      assert.equal((await c.get('/company')).status, email === HR ? 200 : 403);
      assert.equal((await c.get('/settings')).status, 403);
      assert.equal((await c.get('/exports/company.xlsx')).status, 403);
    }
    assert.equal((await c.get('/no-such-page')).status, 404);
  }
});

test('drawers return fragments; first-login users are forced to change their password', async () => {
  const c = new Client(srv.base);
  await c.login(SUPPORT_LEAD);
  const t = listTickets(srv.app, { status: 'open' })[0];
  const frag = await c.get(`/tickets/${t.id}?partial=1`);
  const html = await frag.text();
  assert.ok(html.startsWith('<div class="drawer-head">'), 'fragment, not a full page');
  assert.ok(!html.includes('<html'));
  const full = await (await c.get(`/tickets/${t.id}`)).text();
  assert.ok(full.includes('<html'));

  srv.app.db.run('UPDATE employees SET must_change_password = 1 WHERE email = ?', [BDM]);
  const b = new Client(srv.base);
  const r = await b.login(BDM);
  assert.equal(r.headers.get('location'), '/change-password');
  assert.equal((await b.get('/pipeline')).status, 303);
  const page = await b.get('/change-password');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1] || '';
  const weak = await b.postForm('/change-password', { _csrf: csrf, password: 'short', password2: 'short' });
  assert.equal(weak.status, 400);
  const good = await b.postForm('/change-password', { _csrf: csrf, password: 'Brand-New-Pass-77', password2: 'Brand-New-Pass-77' });
  assert.equal(good.status, 303);
  assert.equal((await b.get('/pipeline')).status, 200);
  const again = new Client(srv.base);
  assert.equal((await again.login(BDM, 'Brand-New-Pass-77')).status, 303);
});

test('password reset by email link works once', async () => {
  const c = new Client(srv.base);
  const page = await c.get('/forgot-password');
  const csrf = /name="_csrf" value="([^"]+)"/.exec(await page.text())?.[1] || '';
  const sent = await c.postForm('/forgot-password', { _csrf: csrf, email: HR });
  const html = await sent.text();
  const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
  assert.ok(token, 'demo mode shows the reset link');
  const resetPage = await c.get(`/reset-password?token=${token}`);
  const csrf2 = /name="_csrf" value="([^"]+)"/.exec(await resetPage.text())?.[1] || '';
  const done = await c.postForm('/reset-password', { _csrf: csrf2, token: token!, password: 'Reset-Pass-2026x', password2: 'Reset-Pass-2026x' });
  assert.equal(done.status, 303);
  const twice = await c.postForm('/reset-password', { _csrf: csrf2, token: token!, password: 'Another-Pass-2026x', password2: 'Another-Pass-2026x' });
  assert.equal(twice.status, 400, 'token cannot be reused');
  assert.equal((await new Client(srv.base).login(HR, 'Reset-Pass-2026x')).status, 303);
});

describe('compression and caching', () => {
  test('pages and static text are gzipped when the browser accepts it, and static files can be revalidated', async () => {
    const s2 = await startServer();
    try {
      const plain = await fetch(`${s2.base}/static/theme.css?v=1`, { headers: { 'accept-encoding': 'identity' } });
      assert.equal(plain.headers.get('content-encoding'), null); assert.match(plain.headers.get('cache-control') || '', /immutable/);
      const etag = plain.headers.get('etag')!; assert.ok(etag); const css = await plain.text();
      const zipped = await fetch(`${s2.base}/static/theme.css?v=1`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(zipped.headers.get('content-encoding'), 'gzip'); assert.equal(await zipped.text(), css, 'the same file after unzipping');
      assert.equal((await fetch(`${s2.base}/static/theme.css?v=1`, { headers: { 'if-none-match': etag } })).status, 304);
      assert.doesNotMatch((await fetch(`${s2.base}/static/theme.css`)).headers.get('cache-control') || '', /immutable/, 'without a version stamp the file is kept for a day only');
      assert.equal((await fetch(`${s2.base}/sw.js`)).headers.get('cache-control'), 'no-cache');
      const login = await fetch(`${s2.base}/login`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(login.headers.get('content-encoding'), 'gzip'); assert.ok((await login.text()).includes('<form'));
      const png = await fetch(`${s2.base}/static/ls-mark.png`, { headers: { 'accept-encoding': 'gzip' } }); assert.equal(png.headers.get('content-encoding'), null, 'images are already compressed');
    } finally { await s2.close(); }
  });
});
