// Shared test helpers: an in-memory app with master data, plus a small HTTP client for integration tests.
import { createTestApp } from '../src/app.ts';
import { seedMaster } from '../src/db/seed-master.ts';
import { getEmployeeByEmail, type Employee } from '../src/modules/people/model.ts';
import type { App } from '../src/app.ts';
import { createServer, prepareData } from '../src/server.ts';

export const PASSWORD = 'Welcome@LoyalFlow1';

export function testApp(opts: { demo?: boolean } = {}): App {
  const app = createTestApp();
  if (opts.demo === false) app.cfg.demo = false;
  seedMaster(app, { password: PASSWORD, mustChange: false });
  return app;
}

export function emp(app: App, email: string): Employee {
  const e = getEmployeeByEmail(app.db, email);
  if (!e) throw new Error(`No employee ${email}`);
  return e;
}

export const COO = 'sridhar.ngowda@loyalstring.com';
export const CEO = 'rahul.thakare@loyalstring.com';
export const SALES_HEAD = 'muruganandam.k@loyalstring.com';
export const SUPPORT_LEAD = 'prasad.panchal@loyalstring.com';
export const SUPPORT_IC = 'nikita.kakade@loyalstring.com';
export const DEV_LEAD = 'shubham.bherde@loyalstring.com';
export const BDM = 'alpesh.boda@loyalstring.com';
export const PRODUCTION_LEAD = 'lukman.nishad@loyalstring.com';
export const HR = 'amruta.junnarkar@loyalstring.com';

export interface TestServer { app: App; base: string; close(): Promise<void> }

/** Start a real HTTP server on a random port with demo data. */
export async function startServer(opts: { demo?: boolean } = {}): Promise<TestServer> {
  const app = createTestApp();
  if (opts.demo === false) app.cfg.demo = false;
  app.cfg.logLevel = 'warn';
  prepareData(app, () => {});
  const handle = createServer(app, { log: () => {} });
  await new Promise<void>((resolve) => handle.server.listen(0, '127.0.0.1', () => resolve()));
  const addr = handle.server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  app.cfg.baseUrl = base;
  return { app, base, close: () => handle.close() };
}

/** Minimal cookie-aware client for tests. */
export class Client {
  cookies = new Map<string, string>();
  base: string;
  constructor(base: string) { this.base = base; }
  private cookieHeader(): string { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; '); }
  private absorb(res: globalThis.Response): void {
    const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    for (const c of set) { const [pair] = c.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i), v = pair.slice(i + 1); if (c.includes('Max-Age=0')) this.cookies.delete(k); else this.cookies.set(k, v); }
  }
  async get(path: string, headers: Record<string, string> = {}): Promise<globalThis.Response> {
    const res = await fetch(this.base + path, { headers: { cookie: this.cookieHeader(), ...headers }, redirect: 'manual' });
    this.absorb(res); return res;
  }
  async postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, any> }> {
    const res = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-requested-with': 'LoyalFlow', cookie: this.cookieHeader(), ...headers }, body: JSON.stringify(body), redirect: 'manual' });
    this.absorb(res);
    const text = await res.text();
    let json: Record<string, any> = {}; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    return { status: res.status, json };
  }
  async postForm(path: string, body: Record<string, string>, headers: Record<string, string> = {}): Promise<globalThis.Response> {
    const res = await fetch(this.base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: this.cookieHeader(), ...headers }, body: new URLSearchParams(body).toString(), redirect: 'manual' });
    this.absorb(res); return res;
  }
  async login(email: string, password = PASSWORD): Promise<globalThis.Response> {
    const page = await this.get('/login');
    const html = await page.text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(html)?.[1] || '';
    return this.postForm('/login', { _csrf: csrf, email, password });
  }
  async csrf(): Promise<string> {
    const res = await this.get('/me');
    const html = await res.text();
    return /"csrf":"([^"]+)"/.exec(html)?.[1] || '';
  }
}
