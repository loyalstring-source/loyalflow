import type { Db } from '../db/index.ts';

export interface AuditEntry { entity: string; entityId: string; action: string; before?: unknown; after?: unknown; actorId?: string | null; requestId?: string | null }

export function audit(db: Db, e: AuditEntry): void {
  db.run('INSERT INTO audit_log (at, actor_id, entity, entity_id, action, before, after, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    new Date().toISOString(), e.actorId ?? null, e.entity, e.entityId, e.action,
    e.before === undefined ? null : JSON.stringify(e.before), e.after === undefined ? null : JSON.stringify(e.after), e.requestId ?? null
  ]);
}

export function auditTrail(db: Db, entity: string, entityId: string, limit = 50) {
  return db.all<{ id: number; at: string; actor_id: string | null; action: string; before: string | null; after: string | null; actor_name: string | null }>(
    'SELECT a.*, e.full_name AS actor_name FROM audit_log a LEFT JOIN employees e ON e.id = a.actor_id WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT ?', [entity, entityId, limit]);
}
