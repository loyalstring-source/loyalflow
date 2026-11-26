// LoyalFlow HTTP server: static files, sessions, CSRF, routing, error pages and the background scheduler.
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createApp, type App } from './app.ts';
import { Router, makeCtx, send, redirect, json, htmlResponse, HttpError, type Response, type Ctx } from './lib/http.ts';
import { userForToken, csrfToken, csrfValid } from './lib/auth.ts';
import { can, scopeFor, hrRestricted } from './lib/scope.ts';
import { blockedModule } from './lib/roles.ts';
import { getDepartment, type Employee } from './modules/people/model.ts';
import { unreadCount } from './lib/notify.ts';
import { seedMaster } from './db/seed-master.ts';
import { seedDemo } from './db/seed-demo.ts';
import { seedDemoExtras } from './db/seed-demo-extras.ts';
import { generateInstances } from './modules/sops/service.ts';
import { snapshotNow } from './modules/kpi/engine.ts';
import { createScheduler } from './jobs.ts';
import { errorPage, type View } from './ui/layout.ts';
import { registerPublic, registerAuthenticated, SESSION_COOKIE } from './routes/auth.ts';
import * as today from './routes/today.ts';
import * as company from './routes/company.ts';
import * as desk from './routes/desk.ts';
import * as sales from './routes/sales.ts';
import * as production from './routes/production.ts';
import * as sops from './routes/sops.ts';
import * as tasks from './routes/tasks.ts';
import * as money from './routes/money.ts';
import * as people from './routes/people.ts';
import * as settings from './routes/settings.ts';
import * as listsRoutes from './routes/lists.ts';
import * as rolesRoutes from './routes/roles.ts';
import * as estimatesRoutes from './routes/estimates.ts';
import * as reportsRoutes from './routes/reports.ts';
import * as dsrRoutes from './routes/dsr.ts';
import * as briefRoutes from './routes/brief.ts';
import * as exportsRoutes from './routes/exports.ts';
import * as ops from './routes/ops.ts';
import * as dev from './routes/dev.ts';
import * as payroll from './routes/payroll.ts';
import * as hr from './routes/hr.ts';
import * as hire from './routes/hire.ts';
import * as assess from './routes/assess.ts';
import * as hireExtra from './routes/hire-extra.ts';
import * as hirePlus from './routes/hire-plus.ts';
import * as attendanceRoutes from './routes/attendance.ts';
import { registerApi, registerPublicApi } from './routes/api.ts';
import { html } from './lib/html.ts';
import { page } from './ui/layout.ts';
import { listTickets } from './modules/desk/service.ts';
import { listDeals } from './modules/sales/service.ts';
import { listWorkOrders } from './modules/production/service.ts';
import { listEmployees } from './modules/people/model.ts';
import { listCustomers } from './modules/sales/service.ts';
import { table, empty } from './ui/components.ts';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PUBLIC_DIR = join(ROOT, 'public');
const MIME: Record<string, string> = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

/** Files from disk, kept in memory with their gzipped form until the file changes. */
const fileCache = new Map<string, { mtimeMs: number; size: number; body: Buffer; gzipped?: Buffer; etag: string }>();
const TEXT_FILE = /\.(css|js|svg|json|webmanifest|txt|html)$/i;
function serveFile(base: string, rel: string, cache: string, ifNoneMatch = ''): Response | null {
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const path = join(base, safe);
  if (!path.startsWith(base) || !existsSync(path)) return null;
  const st = statSync(path); if (!st.isFile()) return null;
  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream';
  let hit = fileCache.get(path);
  if (!hit || hit.mtimeMs !== st.mtimeMs || hit.size !== st.size) {
    const body = readFileSync(path);
    hit = { mtimeMs: st.mtimeMs, size: st.size, body, gzipped: TEXT_FILE.test(path) && body.length >= 1024 ? gzipSync(body) : undefined, etag: `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"` };
    // Only small, often-asked files are kept; uploads can be large and are read each time.
    if (base === PUBLIC_DIR && body.length < 2_000_000) fileCache.set(path, hit);
  }
  const headers = { 'content-type': type, 'cache-control': cache, etag: hit.etag };
  if (ifNoneMatch && ifNoneMatch === hit.etag) return { status: 304, headers, body: '' };
  return { status: 200, headers, body: hit.body, gzipped: hit.gzipped };
}

export function buildView(app: App, user: Employee, csrf: string, path: string): View {
  const dept = getDepartment(app.db, user.department_id);
  const scope = scopeFor(app.db, user);
  return {
    app, user, csrf, lang: user.lang === 'hi' ? 'hi' : 'en', path, unread: unreadCount(app.db, user.id),
    approvalsPending: app.db.get<{ n: number }>("SELECT count(*) AS n FROM tasks WHERE kind = 'approval' AND status = 'open' AND assignee_id = ?", [user.id])?.n || 0,
    deptCode: dept?.code || '', isManager: scope.level !== 'self'
  };
}

export interface ServerHandle { server: Server; app: App; close(): Promise<void>; scheduler: ReturnType<typeof createScheduler> }

export function createServer(app: App, opts: { log?: (line: string) => void } = {}): ServerHandle {
  const log = opts.log || ((line: string) => console.log(`[${new Date().toISOString()}] ${line}`));
  const pub = new Router<Employee>();
  registerPublic(pub, app);
  registerPublicApi(pub, app);
  assess.registerPublic(pub, app);
  hirePlus.registerPublic(pub, app);
  estimatesRoutes.registerPublic(pub, app);
  attendanceRoutes.registerPublic(pub, app);

  const auth = new Router<Employee>();
  registerAuthenticated(auth, app);
  today.register(auth, app);
  company.register(auth, app);
  desk.register(auth, app);
  dev.register(auth, app);
  sales.register(auth, app);
  production.register(auth, app);
  sops.register(auth, app);
  tasks.register(auth, app);
  money.register(auth, app);
  people.register(auth, app);
  settings.register(auth, app);
  listsRoutes.register(auth, app);
  rolesRoutes.register(auth, app);
  estimatesRoutes.register(auth, app);
  reportsRoutes.register(auth, app);
  dsrRoutes.register(auth, app);
  briefRoutes.register(auth, app);
  exportsRoutes.register(auth, app);
  ops.register(auth, app);
  payroll.register(auth, app);
  hr.register(auth, app);
  hire.register(auth, app);
  assess.register(auth, app);
  hireExtra.register(auth, app);
  hirePlus.register(auth, app);
  attendanceRoutes.register(auth, app);
  registerApi(auth, app);
  auth.get('/search', (ctx) => {
    const v = ctx.state.view as View; const q = (ctx.query.get('q') || '').trim();
    const like = q.toLowerCase();
    const peopleOnly = hrRestricted(app.db, v.user); // HR searches people, not tickets, deals, orders or customers
    const tickets = q && !peopleOnly ? listTickets(app, { q, limit: 20 }) : [];
    const deals = q && !peopleOnly ? listDeals(app, { limit: 2000 }).filter((d) => (d.customer_name || '').toLowerCase().includes(like) || d.title.toLowerCase().includes(like) || d.id.toLowerCase().includes(like)).slice(0, 20) : [];
    const orders = q && !peopleOnly ? listWorkOrders(app, { limit: 2000 }).filter((w) => w.product.toLowerCase().includes(like) || (w.customer_name || '').toLowerCase().includes(like) || w.id.toLowerCase().includes(like)).slice(0, 20) : [];
    const persons = q ? listEmployees(app.db, { status: 'active' }).filter((e) => e.full_name.toLowerCase().includes(like) || e.designation.toLowerCase().includes(like)).slice(0, 20) : [];
    const customers = q && !peopleOnly ? listCustomers(app, q).slice(0, 20) : [];
    const total = tickets.length + deals.length + orders.length + persons.length + customers.length;
    return htmlResponse(page(v, { title: q ? `Search: ${q}` : 'Search', subtitle: q ? `${total} result${total === 1 ? '' : 's'}` : 'Type something to search tickets, deals, orders, customers and people.', body: html`
      ${total === 0 ? empty(q ? 'Nothing matched. Try an id like T-4221 or part of a name.' : 'Press / anywhere to search.', '🔍') : ''}
      ${tickets.length ? html`<section class="card"><h2>Tickets</h2>${table(['Id', 'Subject', 'Customer', 'Status'], tickets.map((t) => [html`<a href="/tickets/${t.id}">${t.id}</a>`, t.subject, t.customer_name, t.status]))}</section>` : ''}
      ${deals.length ? html`<section class="card"><h2>Deals</h2>${table(['Id', 'Customer', 'Deal', 'Stage'], deals.map((d) => [html`<a href="/deals/${d.id}">${d.id}</a>`, d.customer_name || '', d.title, d.stage]))}</section>` : ''}
      ${orders.length ? html`<section class="card"><h2>Work orders</h2>${table(['Id', 'Product', 'Customer', 'Stage'], orders.map((w) => [html`<a href="/work-orders/${w.id}">${w.id}</a>`, w.product, w.customer_name || '', w.stage]))}</section>` : ''}
      ${customers.length ? html`<section class="card"><h2>Customers</h2>${table(['Customer', 'City'], customers.map((c) => [html`<a href="/customers/${c.id}">${c.name}</a>`, c.city]))}</section>` : ''}
      ${persons.length ? html`<section class="card"><h2>People</h2>${table(['Name', 'Role'], persons.map((e) => [html`<a href="/people/${e.id}">${e.full_name}</a>`, e.designation]))}</section>` : ''}` }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = Date.now();
    const ctx = makeCtx<Employee>(req, res, app.cfg.baseUrl);
    ctx.state.app = app;
    let out: Response | null = null;
    try {
      // 1. Static assets (no session needed)
      if (ctx.path.startsWith('/static/')) out = serveFile(PUBLIC_DIR, ctx.path.slice('/static/'.length), ctx.query.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400', String(req.headers['if-none-match'] || '')) || { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
      else if (ctx.path === '/manifest.webmanifest' || ctx.path === '/sw.js' || ctx.path === '/robots.txt' || ctx.path === '/favicon.ico') out = serveFile(PUBLIC_DIR, ctx.path === '/favicon.ico' ? 'icon.svg' : ctx.path.slice(1), ctx.path === '/sw.js' ? 'no-cache' : 'public, max-age=3600', String(req.headers['if-none-match'] || '')) || { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not found' };
      if (out) { send(res, out, ctx.setCookies); return; }

      // 2. Session: cookie (web) or bearer token (mobile/API)
      const authz = String(req.headers['authorization'] || '');
      const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : null;
      ctx.sessionToken = bearer || ctx.cookies[SESSION_COOKIE] || null;
      ctx.user = userForToken(app, ctx.sessionToken);
      if (!ctx.user) ctx.sessionToken = null;

      // 3. Public routes
      out = await pub.dispatch(ctx);
      if (!out) {
        if (!ctx.user) {
          if (ctx.wantsJson || ctx.path.startsWith('/api/')) out = json({ ok: false, error: 'Please sign in', login: '/login' }, 401);
          else out = redirect(`/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`);
        } else {
          const csrf = csrfToken(app, ctx.sessionToken!);
          // 4. CSRF for cookie sessions on state-changing requests (bearer sessions are not cookie-replayable)
          if (ctx.method !== 'GET' && ctx.method !== 'HEAD' && !bearer) {
            const header = String(req.headers['x-csrf'] || '');
            const xrw = String(req.headers['x-requested-with'] || '');
            const origin = String(req.headers['origin'] || '');
            const sameOrigin = !origin || origin === ctx.url.origin;
            let ok = !!header && csrfValid(app, ctx.sessionToken, header);
            // A custom header on a JSON body cannot be sent cross-site without a CORS preflight (which is never granted).
            if (!ok && xrw === 'LoyalFlow' && sameOrigin && String(req.headers['content-type'] || '').includes('application/json')) ok = true;
            if (!ok) { const body = await ctx.body(); ok = csrfValid(app, ctx.sessionToken, typeof body._csrf === 'string' ? body._csrf : undefined); }
            if (!ok) throw new HttpError(403, 'Your session token did not match (CSRF). Reload the page and try again.');
          }
          // 5. Force the first password change
          if (ctx.user.must_change_password === 1 && !ctx.path.startsWith('/change-password') && !ctx.path.startsWith('/logout') && !ctx.path.startsWith('/api/')) {
            out = ctx.wantsJson ? json({ ok: false, error: 'Change your password first', redirect: '/change-password' }, 403) : redirect('/change-password');
          } else {
            { const shut = blockedModule(app.db, ctx.user, ctx.path); if (shut) throw new HttpError(403, `Your role does not include ${shut}. Ask an administrator if you need it.`); }
            ctx.state.view = buildView(app, ctx.user, csrf, ctx.path);
            if (ctx.path.startsWith('/uploads/')) out = serveFile(app.cfg.uploadsDir, ctx.path.slice('/uploads/'.length), 'private, max-age=600');
            else out = await auth.dispatch(ctx);
            if (!out) throw new HttpError(404, `No page at ${ctx.path}`);
          }
        }
      }
    } catch (e) {
      const err = e as Error & { status?: number };
      const status = err instanceof HttpError ? err.status : (typeof err.status === 'number' ? err.status : 500);
      if (status >= 500) log(`ERROR ${ctx.method} ${ctx.path} ${ctx.requestId}: ${err.stack || err.message}`);
      const message = status >= 500 && !app.cfg.demo ? 'Something went wrong on our side. The error has been logged.' : err.message;
      if (ctx.wantsJson || ctx.path.startsWith('/api/')) out = json({ ok: false, error: message, requestId: ctx.requestId }, status);
      else out = htmlResponse(errorPage(status, message, ctx.state.view as View | undefined), status);
    }
    try { send(res, out!, ctx.setCookies); } catch (e) { log(`send failed: ${(e as Error).message}`); }
    const ms = Date.now() - started;
    if (app.cfg.logLevel === 'debug' || out!.status >= 400 || ms > 500) log(`${ctx.method} ${ctx.path} → ${out!.status} ${ms}ms${ctx.user ? ` (${ctx.user.id})` : ''}`);
  }

  const server = createHttpServer((req, res) => { void handle(req, res); });
  const scheduler = createScheduler(app, log);
  return { server, app, scheduler, close: () => new Promise<void>((resolve) => { scheduler.stop(); server.close(() => resolve()); }) };
}

/** Ensure master data, demo data (if enabled), today's SOP checklists and a first KPI snapshot exist. */
export function prepareData(app: App, log: (line: string) => void): void {
  const employees = app.db.get<{ n: number }>('SELECT count(*) AS n FROM employees')?.n || 0;
  if (!employees) { const r = seedMaster(app, { password: app.cfg.seedPassword, mustChange: !app.cfg.demo }); log(`Seeded master data: ${r.employees} employees. Starter password: ${app.cfg.seedPassword}`); }
  if (app.cfg.demo && !(app.db.get<{ n: number }>('SELECT count(*) AS n FROM customers')?.n || 0)) { seedDemo(app); log('Seeded demo data (LOYALFLOW_DEMO=1).'); }
  // Sample data for the newer screens; each part loads only if that part is still empty, so an older demo database is topped up too.
  if (app.cfg.demo) seedDemoExtras(app);
  const created = generateInstances(app);
  if (created) log(`Created ${created} SOP checklists for today.`);
  snapshotNow(app);
}

const isMain = process.argv[1] && (fileURLToPath(import.meta.url) === process.argv[1] || process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));
if (isMain) {
  const app = createApp();
  const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
  prepareData(app, log);
  const handle = createServer(app, { log });
  handle.server.listen(app.cfg.port, app.cfg.host, () => {
    log(`LoyalFlow listening on http://${app.cfg.host}:${app.cfg.port} (${app.cfg.baseUrl}) · db ${app.cfg.databasePath} · mail ${app.mailer.transport}${app.cfg.demo ? ' · DEMO DATA' : ''}`);
    if (app.cfg.schedulerEnabled) { handle.scheduler.start(); log('Scheduler started: SLA checks every minute, KPI snapshots every 15 min, SOPs daily, backup 02:00, digest Monday 08:00.'); }
  });
  const shutdown = () => { log('Shutting down…'); void handle.close().then(() => { app.db.close(); process.exit(0); }); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}

export type { Ctx };
