import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { Raw } from './html.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface Response {
  status: number;
  headers: Record<string, string | string[]>;
  body: string | Uint8Array;
}

export function htmlResponse(body: Raw | string, status = 200, headers: Record<string, string> = {}): Response {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body: body.toString() };
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(data) };
}

export function text(body: string, status = 200, contentType = 'text/plain; charset=utf-8'): Response {
  return { status, headers: { 'content-type': contentType }, body };
}

export function redirect(location: string, status = 303): Response {
  return { status, headers: { location }, body: '' };
}

export function file(body: Uint8Array | string, filename: string, mime: string, inline = false): Response {
  return {
    status: 200,
    headers: { 'content-type': mime, 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"` },
    body
  };
}

export interface CookieOptions { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' | 'None'; path?: string }

export function cookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`];
  if (o.maxAge !== undefined) parts.push(`Max-Age=${o.maxAge}`);
  if (o.httpOnly !== false) parts.push('HttpOnly');
  if (o.secure) parts.push('Secure');
  parts.push(`SameSite=${o.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export interface Ctx<User = unknown> {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  url: URL;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  requestId: string;
  ip: string;
  user: User | null;
  sessionToken: string | null;
  /** Lazily-parsed request body (JSON or form-encoded). */
  body(): Promise<Record<string, any>>;
  wantsJson: boolean;
  partial: boolean;
  setCookies: string[];
  state: Record<string, unknown>;
}

export type Handler<User = unknown> = (ctx: Ctx<User>) => Promise<Response | void> | Response | void;

interface Route<User> { method: string; pattern: RegExp; keys: string[]; handlers: Handler<User>[] }

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/\/+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{(\w+)\\\}|:(\w+)/g, (_m, a, b) => { keys.push(a || b); return '([^/]+)'; });
  return { pattern: new RegExp(`^${src || '/'}/?$`), keys };
}

export class Router<User = unknown> {
  private routes: Route<User>[] = [];
  private befores: Handler<User>[] = [];

  use(handler: Handler<User>): this { this.befores.push(handler); return this; }
  get(path: string, ...handlers: Handler<User>[]): this { return this.add('GET', path, handlers); }
  post(path: string, ...handlers: Handler<User>[]): this { return this.add('POST', path, handlers); }
  put(path: string, ...handlers: Handler<User>[]): this { return this.add('PUT', path, handlers); }
  delete(path: string, ...handlers: Handler<User>[]): this { return this.add('DELETE', path, handlers); }

  private add(method: string, path: string, handlers: Handler<User>[]): this {
    const { pattern, keys } = compile(path);
    this.routes.push({ method, pattern, keys, handlers });
    return this;
  }

  async dispatch(ctx: Ctx<User>): Promise<Response | null> {
    for (const b of this.befores) {
      const r = await b(ctx);
      if (r) return r;
    }
    for (const route of this.routes) {
      if (route.method !== ctx.method && !(route.method === 'GET' && ctx.method === 'HEAD')) continue;
      const m = route.pattern.exec(ctx.path);
      if (!m) continue;
      ctx.params = {};
      route.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      for (const h of route.handlers) {
        const r = await h(ctx);
        if (r) return r;
      }
      return null;
    }
    return null;
  }
}

const MAX_BODY = 8 * 1024 * 1024;

export function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function makeCtx<User>(req: IncomingMessage, res: ServerResponse, baseUrl: string): Ctx<User> {
  const url = new URL(req.url || '/', baseUrl);
  let parsed: Promise<Record<string, any>> | null = null;
  const accept = String(req.headers['accept'] || '');
  const xrw = String(req.headers['x-requested-with'] || '');
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return {
    req, res,
    method: (req.method || 'GET').toUpperCase(),
    url,
    path: url.pathname.replace(/\/+$/, '') || '/',
    params: {},
    query: url.searchParams,
    cookies: parseCookies(req.headers['cookie'] as string | undefined),
    requestId: randomUUID().slice(0, 8),
    ip: forwarded || req.socket.remoteAddress || '',
    user: null,
    sessionToken: null,
    wantsJson: accept.includes('application/json') || xrw === 'LoyalFlow',
    partial: url.searchParams.get('partial') === '1',
    setCookies: [],
    state: {},
    body() {
      if (!parsed) {
        parsed = readBody(req).then((buf) => {
          const ct = String(req.headers['content-type'] || '');
          if (!buf.length) return {};
          if (ct.includes('application/json')) return JSON.parse(buf.toString('utf8'));
          if (ct.includes('application/x-www-form-urlencoded')) {
            const out: Record<string, any> = {};
            for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) {
              if (k.endsWith('[]')) { const kk = k.slice(0, -2); (out[kk] ||= []).push(v); } else out[k] = v;
            }
            return out;
          }
          return { _raw: buf.toString('utf8') };
        });
      }
      return parsed;
    }
  };
}

export function send(res: ServerResponse, r: Response, setCookies: string[] = []): void {
  const headers: Record<string, string | string[]> = { ...r.headers };
  if (setCookies.length) headers['set-cookie'] = setCookies;
  headers['x-content-type-options'] = 'nosniff';
  headers['x-frame-options'] = 'SAMEORIGIN';
  headers['referrer-policy'] = 'same-origin';
  res.writeHead(r.status, headers);
  res.end(r.body);
}
