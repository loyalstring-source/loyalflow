import type { App } from '../app.ts';
import { Router, htmlResponse, redirect, cookie, json } from '../lib/http.ts';
import { login, logout, requestPasswordReset, completePasswordReset, setPassword, csrfToken } from '../lib/auth.ts';
import { randomToken, safeEqual, verifyPassword } from '../lib/crypto.ts';
import { loginPage, forgotPage, resetPage, changePasswordPage, ratePage } from '../ui/pages/auth.ts';
import { publicPage } from '../ui/layout.ts';
import { html } from '../lib/html.ts';
import { rateTicket } from '../modules/desk/service.ts';
import type { Employee } from '../modules/people/model.ts';
import { str, view, type RCtx } from './helpers.ts';

export const SESSION_COOKIE = 'lf_session';
const LOGIN_CSRF = 'lf_csrf';

function loginCsrf(ctx: RCtx, app: App): string {
  let t = ctx.cookies[LOGIN_CSRF];
  if (!t || t.length < 16) {
    t = randomToken(16);
    ctx.setCookies.push(cookie(LOGIN_CSRF, t, { maxAge: 3600, secure: app.cfg.cookieSecure }));
  }
  return t;
}

function safeNext(n: string): string { return n && n.startsWith('/') && !n.startsWith('//') ? n : '/'; }

export function registerPublic(r: Router<Employee>, app: App): void {
  r.get('/health', () => json({ ok: true, uptimeSeconds: Math.round((Date.now() - app.startedAt.getTime()) / 1000), version: '1.2.0' }));
  r.get('/offline', () => htmlResponse(publicPage({ title: 'Offline', body: html`<div class="card" style="max-width:480px;margin:60px auto;text-align:center"><span style="font-size:36px">📡</span><h2 style="margin-top:8px">You are offline</h2><p class="muted" style="margin-top:6px">LoyalFlow needs a connection to load live data. Check your network and try again.</p><a class="btn btn-primary" href="/" style="margin-top:16px">Retry</a></div>` })));

  r.get('/login', (ctx) => {
    if (ctx.user) return redirect(safeNext(ctx.query.get('next') || '/'));
    return htmlResponse(loginPage({ csrf: loginCsrf(ctx, app), next: ctx.query.get('next') || '', info: ctx.query.get('reset') === '1' ? 'Password saved. Sign in with your new password.' : ctx.query.get('out') === '1' ? 'You are signed out.' : undefined }));
  });

  r.post('/login', async (ctx) => {
    const body = await ctx.body();
    const csrf = loginCsrf(ctx, app);
    if (!ctx.wantsJson && !(str(body, '_csrf') && safeEqual(str(body, '_csrf'), csrf))) return htmlResponse(loginPage({ csrf, error: 'The sign-in form expired. Please try again.', email: str(body, 'email') }), 400);
    const result = login(app, str(body, 'email'), str(body, 'password'), 'web', String(ctx.req.headers['user-agent'] || ''));
    if (!result.ok) {
      if (ctx.wantsJson) return json({ ok: false, error: result.reason }, 401);
      return htmlResponse(loginPage({ csrf, error: result.reason, email: str(body, 'email'), next: str(body, 'next') }), 401);
    }
    // "Remember me" keeps the sign-in on this device; without it the browser forgets it when it is closed. Apps signing in with JSON are remembered as before.
    const remember = ctx.wantsJson || str(body, 'remember') === '1';
    ctx.setCookies.push(cookie(SESSION_COOKIE, result.token, { maxAge: remember ? app.cfg.sessionDays * 86400 : undefined, secure: app.cfg.cookieSecure, sameSite: 'Lax' }));
    if (ctx.wantsJson) return json({ ok: true, redirect: result.user.must_change_password ? '/change-password' : safeNext(str(body, 'next')) });
    return redirect(result.user.must_change_password ? '/change-password' : safeNext(str(body, 'next')));
  });

  r.post('/logout', (ctx) => {
    logout(app, ctx.sessionToken);
    ctx.setCookies.push(cookie(SESSION_COOKIE, '', { maxAge: 0, secure: app.cfg.cookieSecure }));
    return ctx.wantsJson ? json({ ok: true, redirect: '/login?out=1' }) : redirect('/login?out=1');
  });

  r.get('/forgot-password', (ctx) => htmlResponse(forgotPage({ csrf: loginCsrf(ctx, app) })));
  r.post('/forgot-password', async (ctx) => {
    const body = await ctx.body();
    const csrf = loginCsrf(ctx, app);
    if (!(str(body, '_csrf') && safeEqual(str(body, '_csrf'), csrf))) return htmlResponse(forgotPage({ csrf }), 400);
    const { token } = requestPasswordReset(app, str(body, 'email'));
    const demoLink = app.cfg.demo && app.mailer.transport === 'console' && token ? `/reset-password?token=${token}` : null;
    return htmlResponse(forgotPage({ csrf, sent: true, demoLink }));
  });

  r.get('/reset-password', (ctx) => htmlResponse(resetPage({ csrf: loginCsrf(ctx, app), token: ctx.query.get('token') || '' })));
  r.post('/reset-password', async (ctx) => {
    const body = await ctx.body();
    const csrf = loginCsrf(ctx, app);
    const token = str(body, 'token');
    if (!(str(body, '_csrf') && safeEqual(str(body, '_csrf'), csrf))) return htmlResponse(resetPage({ csrf, token, error: 'The form expired. Please try again.' }), 400);
    if (str(body, 'password') !== str(body, 'password2')) return htmlResponse(resetPage({ csrf, token, error: 'The two passwords do not match.' }), 400);
    const problem = completePasswordReset(app, token, str(body, 'password'));
    if (problem) return htmlResponse(resetPage({ csrf, token, error: problem }), 400);
    return redirect('/login?reset=1');
  });

  // Customer satisfaction rating: public, one-click link from the resolution email.
  r.get('/rate/:token', (ctx) => {
    const token = ctx.params.token;
    const t = app.db.get<{ id: string; subject: string; customer_name: string; rating: number | null }>('SELECT t.id, t.subject, COALESCE(c.contact_name, c.name, "there") AS customer_name, t.rating FROM tickets t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.rating_token = ?', [token]);
    if (!t) return htmlResponse(ratePage({ ticketId: '', subject: '', customer: '', rating: null, invalid: true }), 404);
    const r = Number(ctx.query.get('r') || 0);
    if (r >= 1 && r <= 5) {
      const rated = rateTicket(app, token, r);
      return htmlResponse(ratePage({ ticketId: t.id, subject: t.subject, customer: t.customer_name, rating: rated?.rating ?? r, done: true }));
    }
    return htmlResponse(ratePage({ ticketId: t.id, subject: t.subject, customer: t.customer_name, rating: t.rating, done: t.rating !== null }));
  });
}

export function registerAuthenticated(r: Router<Employee>, app: App): void {
  r.get('/change-password', (ctx) => htmlResponse(changePasswordPage(view(ctx), { forced: ctx.user!.must_change_password === 1 })));
  r.post('/change-password', async (ctx) => {
    const body = await ctx.body();
    const v = view(ctx);
    const forced = ctx.user!.must_change_password === 1;
    if (!forced && !verifyPassword(str(body, 'current'), ctx.user!.password_hash)) return htmlResponse(changePasswordPage(v, { error: 'The current password is not right.' }), 400);
    if (str(body, 'password') !== str(body, 'password2')) return htmlResponse(changePasswordPage(v, { forced, error: 'The two passwords do not match.' }), 400);
    const problem = setPassword(app, ctx.user!.id, str(body, 'password'), ctx.user!.id);
    if (problem) return htmlResponse(changePasswordPage(v, { forced, error: problem }), 400);
    return redirect('/?pw=1');
  });
}

export { csrfToken };
