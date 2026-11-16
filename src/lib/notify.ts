import type { Db } from '../db/index.ts';
import type { Mailer } from './mailer.ts';
import { getEmployee } from '../modules/people/model.ts';

export interface Notice { employeeId: string; title: string; body?: string; link?: string; kind?: 'info' | 'warn' | 'critical' | 'success'; email?: boolean }

export interface Notifier {
  send(n: Notice): void;
  sendMany(ids: string[], n: Omit<Notice, 'employeeId'>): void;
}

export function createNotifier(db: Db, mailer: Mailer, baseUrl: string): Notifier {
  function send(n: Notice): void {
    const at = new Date().toISOString();
    db.run('INSERT INTO notifications (employee_id, title, body, link, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [n.employeeId, n.title, n.body || '', n.link || '', n.kind || 'info', at]);
    if (n.email === false) return;
    const emp = getEmployee(db, n.employeeId);
    if (!emp || emp.status !== 'active') return;
    const link = n.link ? `${baseUrl}${n.link}` : baseUrl;
    void mailer.send({
      to: emp.email,
      subject: `[LoyalFlow] ${n.title}`,
      text: `${n.title}\n\n${n.body || ''}\n\nOpen: ${link}\n`,
      html: `<p style="font-family:sans-serif"><strong>${esc(n.title)}</strong></p><p style="font-family:sans-serif">${esc(n.body || '')}</p><p><a href="${link}">Open in LoyalFlow</a></p>`
    }).then((r) => {
      // This runs long after send() returned. By now the mail may have failed, or the
      // process may be shutting down with the database already closed — neither is a
      // reason to take anything down, because the notification itself is already saved.
      if (!r.ok) return;
      try {
        db.run('UPDATE notifications SET emailed_at = ? WHERE employee_id = ? AND created_at = ? AND title = ?', [new Date().toISOString(), n.employeeId, at, n.title]);
      } catch { /* database closed, or the row is gone: the notification still stands */ }
    }).catch(() => { /* the mailer is down; the in-app notification is what matters */ });
  }
  return {
    send,
    sendMany(ids, n) { for (const id of new Set(ids)) send({ ...n, employeeId: id }); }
  };
}

function esc(s: string): string { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }

export function unreadNotifications(db: Db, employeeId: string, limit = 20) {
  return db.all<{ id: number; title: string; body: string; link: string; kind: string; created_at: string; read_at: string | null }>(
    'SELECT id, title, body, link, kind, created_at, read_at FROM notifications WHERE employee_id = ? ORDER BY id DESC LIMIT ?', [employeeId, limit]);
}

export function unreadCount(db: Db, employeeId: string): number {
  return db.get<{ n: number }>('SELECT count(*) AS n FROM notifications WHERE employee_id = ? AND read_at IS NULL', [employeeId])?.n || 0;
}

export function markAllRead(db: Db, employeeId: string): void {
  db.run('UPDATE notifications SET read_at = ? WHERE employee_id = ? AND read_at IS NULL', [new Date().toISOString(), employeeId]);
}
