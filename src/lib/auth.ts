import type { App } from '../app.ts';
import { hashPassword, verifyPassword, randomToken, sha256, hmac, passwordProblems, safeEqual } from './crypto.ts';
import { audit } from './audit.ts';
import { getEmployee, getEmployeeByEmail, type Employee } from '../modules/people/model.ts';
import { fmtTime } from './time.ts';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export type LoginResult = { ok: true; token: string; user: Employee } | { ok: false; reason: string; lockedUntil?: string };

export function login(app: App, email: string, password: string, kind: 'web' | 'api', userAgent = ''): LoginResult {
  const { db } = app;
  const user = getEmployeeByEmail(db, email);
  const generic = 'Email or password is incorrect.';
  if (!user || user.status !== 'active' || !user.password_hash) return { ok: false, reason: generic };
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return { ok: false, reason: `Too many attempts. The account is locked until ${fmtTime(user.locked_until)} IST; try again then or reset your password.`, lockedUntil: user.locked_until };
  }
  if (!verifyPassword(password, user.password_hash)) {
    const failed = user.failed_logins + 1;
    const lockedUntil = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null;
    db.run('UPDATE employees SET failed_logins = ?, locked_until = ? WHERE id = ?', [lockedUntil ? 0 : failed, lockedUntil, user.id]);
    if (lockedUntil) audit(db, { entity: 'employee', entityId: user.id, action: 'login.locked', after: { lockedUntil } });
    return { ok: false, reason: lockedUntil ? `Too many attempts. The account is locked for ${LOCK_MINUTES} minutes.` : generic, lockedUntil: lockedUntil || undefined };
  }
  const token = createSession(app, user.id, kind, userAgent);
  db.run('UPDATE employees SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [new Date().toISOString(), user.id]);
  audit(db, { entity: 'employee', entityId: user.id, action: 'login', actorId: user.id, after: { kind } });
  return { ok: true, token, user };
}

export function createSession(app: App, employeeId: string, kind: 'web' | 'api', userAgent = ''): string {
  const token = randomToken(32);
  const days = kind === 'api' ? app.cfg.apiTokenDays : app.cfg.sessionDays;
  const nowIso = new Date().toISOString();
  app.db.run('INSERT INTO sessions (token_hash, employee_id, kind, created_at, expires_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [sha256(token), employeeId, kind, nowIso, new Date(Date.now() + days * 86_400_000).toISOString(), nowIso, userAgent.slice(0, 200)]);
  return token;
}

export function userForToken(app: App, token: string | null | undefined): Employee | null {
  if (!token) return null;
  const row = app.db.get<{ employee_id: string; expires_at: string; last_seen_at: string }>('SELECT employee_id, expires_at, last_seen_at FROM sessions WHERE token_hash = ?', [sha256(token)]);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) { app.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]); return null; }
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) app.db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [new Date().toISOString(), sha256(token)]);
  const user = getEmployee(app.db, row.employee_id);
  return user && user.status === 'active' ? user : null;
}

export function logout(app: App, token: string | null | undefined): void {
  if (token) app.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
}

export function logoutEverywhere(app: App, employeeId: string): void {
  app.db.run('DELETE FROM sessions WHERE employee_id = ?', [employeeId]);
}

/**
 * An administrator gives a person a temporary password (told to them directly). The person must choose their own at the next sign-in,
 * so the administrator never knows the password in use. Other sign-ins of that person are ended.
 */
export function setTemporaryPassword(app: App, employeeId: string, password: string, actorId: string): string | null {
  const problem = passwordProblems(password);
  if (problem) return problem;
  app.db.run('UPDATE employees SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [hashPassword(password), new Date().toISOString(), employeeId]);
  app.db.run('DELETE FROM sessions WHERE employee_id = ?', [employeeId]);
  audit(app.db, { entity: 'employee', entityId: employeeId, action: 'password.temporary_set_by_admin', actorId });
  return null;
}

export function setPassword(app: App, employeeId: string, password: string, actorId: string | null): string | null {
  const problem = passwordProblems(password);
  if (problem) return problem;
  const current = getEmployee(app.db, employeeId);
  if (current?.password_hash && verifyPassword(password, current.password_hash)) return 'Choose a password you have not used before.';
  app.db.run('UPDATE employees SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [hashPassword(password), new Date().toISOString(), employeeId]);
  audit(app.db, { entity: 'employee', entityId: employeeId, action: 'password.set', actorId });
  return null;
}

/** How account emails (password and sign-in links) leave: SMTP if set up, else Microsoft 365 (Graph) if set up, else not at all. */
export function accountMailChannel(app: App): 'smtp' | 'graph' | 'none' {
  return app.mailer.transport === 'smtp' ? 'smtp' : app.graph.configured ? 'graph' : 'none';
}

/**
 * Create a link for setting a password and email it when email is set up. Valid for 60 minutes, or longer when an
 * administrator asks for a link to hand over personally. Always returns silently for an unknown address, so emails cannot be enumerated.
 * `emailed` says whether a message was handed to a mail service; with no mail service the caller must pass the link on itself.
 */
export function requestPasswordReset(app: App, email: string, opts: { hours?: number; send?: boolean } = {}): { token: string | null; link: string | null; emailed: boolean } {
  const user = getEmployeeByEmail(app.db, email);
  if (!user || user.status !== 'active') return { token: null, link: null, emailed: false };
  const token = randomToken(24); const hours = opts.hours || 1;
  app.db.run('INSERT INTO password_resets (token_hash, employee_id, expires_at) VALUES (?, ?, ?)', [sha256(token), user.id, new Date(Date.now() + hours * 3_600_000).toISOString()]);
  const link = `${app.cfg.baseUrl}/reset-password?token=${token}`;
  const channel = opts.send === false ? 'none' : accountMailChannel(app);
  const subject = 'Set your LoyalFlow password'; const validFor = hours === 1 ? '60 minutes' : `${hours} hours`;
  const text = `Hello ${user.full_name},\n\nUse this link within ${validFor} to set your password:\n${link}\n\nIf you did not ask for this, ignore this email.`;
  if (channel === 'smtp') void app.mailer.send({ to: user.email, subject, text });
  else if (channel === 'graph') void app.graph.send({ to: user.email, subject, html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5"><p>Hello ${user.full_name.replace(/[<>&]/g, '')},</p><p>Use this link within ${validFor} to set your LoyalFlow password:</p><p><a href="${link}">${link}</a></p><p style="color:#666">If you did not ask for this, ignore this email.</p></div>` })
    .then((r) => { if (r.state !== 'accepted') console.error(`[mail:graph] password link not sent: ${r.detail}`); }).catch((e) => console.error('[mail:graph] failed', (e as Error).message));
  else if (opts.send !== false) void app.mailer.send({ to: user.email, subject, text });   // console transport: written to the log only
  audit(app.db, { entity: 'employee', entityId: user.id, action: 'password.reset_requested' });
  return { token, link, emailed: channel !== 'none' };
}

export function completePasswordReset(app: App, token: string, password: string): string | null {
  const row = app.db.get<{ employee_id: string; expires_at: string; used_at: string | null }>('SELECT employee_id, expires_at, used_at FROM password_resets WHERE token_hash = ?', [sha256(token)]);
  if (!row || row.used_at || new Date(row.expires_at) < new Date()) return 'This link has expired. Ask for a new one.';
  const problem = setPassword(app, row.employee_id, password, row.employee_id);
  if (problem) return problem;
  app.db.run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [new Date().toISOString(), sha256(token)]);
  logoutEverywhere(app, row.employee_id);
  return null;
}

/** CSRF token for HTML forms: HMAC of the session token, so it cannot be forged without the cookie. */
export function csrfToken(app: App, sessionToken: string): string { return hmac(app.cfg.sessionSecret, 'csrf:' + sessionToken); }
export function csrfValid(app: App, sessionToken: string | null, provided: string | undefined): boolean {
  return !!sessionToken && !!provided && safeEqual(csrfToken(app, sessionToken), provided);
}
