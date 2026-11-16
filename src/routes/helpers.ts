import type { App } from '../app.ts';
import { json, redirect, htmlResponse, HttpError, type Ctx, type Response } from '../lib/http.ts';
import type { Employee } from '../modules/people/model.ts';
import type { View } from '../ui/layout.ts';
import type { Raw } from '../lib/html.ts';

export type RCtx = Ctx<Employee>;

export function view(ctx: RCtx): View {
  const v = ctx.state.view as View | undefined;
  if (!v) throw new HttpError(401, 'Please sign in');
  return v;
}

export function user(ctx: RCtx): Employee {
  if (!ctx.user) throw new HttpError(401, 'Please sign in');
  return ctx.user;
}

export interface Outcome { ok?: boolean; toast?: { title: string; body?: string; kind?: 'info' | 'success' | 'warn' | 'critical' }; confetti?: boolean; reload?: boolean; redirect?: string; close?: boolean; html?: string; target?: string; drawer?: string; data?: unknown }

/** Respond to an action: JSON for fetch() callers, a redirect for plain form posts. */
export function done(ctx: RCtx, o: Outcome = {}): Response {
  if (ctx.wantsJson) return json({ ok: true, ...o });
  const back = o.redirect || String(ctx.req.headers['referer'] || '/');
  return redirect(back.startsWith('/') || back.startsWith(ctx.url.origin) ? back : '/');
}

export function fail(ctx: RCtx, status: number, message: string): Response {
  if (ctx.wantsJson) return json({ ok: false, error: message }, status);
  throw new HttpError(status, message);
}

/** HTML page, or just the fragment when the request comes from the drawer loader. */
export function render(ctx: RCtx, full: () => Raw, partial?: () => Raw): Response {
  if (ctx.partial && partial) return htmlResponse(partial());
  return htmlResponse(full());
}

export function str(body: Record<string, unknown>, key: string, fallback = ''): string {
  const v = body[key];
  if (v === undefined || v === null) return fallback;
  return String(v).trim();
}

export function num(body: Record<string, unknown>, key: string, fallback: number | null = null): number | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(body: Record<string, unknown>, key: string): boolean {
  const v = body[key];
  return v === true || v === 'true' || v === '1' || v === 'on' || v === 1;
}

export function required(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) if (!str(body, k)) return `${k.replace(/_/g, ' ')} is required`;
  return null;
}

export function appOf(ctx: RCtx): App { return (ctx.state.app as App); }
