import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { MIGRATIONS } from './migrations.ts';

export type Row = Record<string, any>;
export type Params = (string | number | null | Uint8Array | bigint)[];

/** Thin, synchronous wrapper over node:sqlite with migrations, transactions and id sequences. */
export class Db {
  readonly raw: DatabaseSync;
  readonly path: string;
  private cache = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(path = ':memory:') {
    this.path = path;
    this.raw = new DatabaseSync(path);
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    this.raw.exec('PRAGMA synchronous = NORMAL');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.cache.set(sql, s); }
    return s;
  }

  exec(sql: string): void { this.raw.exec(sql); }

  run(sql: string, params: Params = []): { changes: number; lastInsertRowid: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  get<T = Row>(sql: string, params: Params = []): T | undefined {
    return this.stmt(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, params: Params = []): T[] {
    return this.stmt(sql).all(...params) as T[];
  }

  /** Run fn inside a transaction; nested calls join the outer transaction. */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) { this.txDepth++; try { return fn(); } finally { this.txDepth--; } }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.txDepth = 0;
    }
  }

  migrate(): string[] {
    this.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(this.all<{ id: string }>('SELECT id FROM schema_migrations').map((r) => r.id));
    const done: string[] = [];
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      this.transaction(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()]);
      });
      done.push(m.id);
    }
    return done;
  }

  /** Human-readable sequential ids such as T-4201, D-2242, WO-1031. */
  nextId(prefix: string, start = 1): string {
    return this.transaction(() => {
      const row = this.get<{ value: number }>('SELECT value FROM counters WHERE name = ?', [prefix]);
      const next = row ? row.value + 1 : start;
      if (row) this.run('UPDATE counters SET value = ? WHERE name = ?', [next, prefix]);
      else this.run('INSERT INTO counters (name, value) VALUES (?, ?)', [prefix, next]);
      return `${prefix}-${next}`;
    });
  }

  /** Online backup to another file using VACUUM INTO (safe while the app runs). */
  backupTo(path: string): void {
    this.raw.exec(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
  }

  close(): void { this.raw.close(); }
}

export function openDb(path: string): Db {
  const db = new Db(path);
  db.migrate();
  return db;
}

export const now = (): string => new Date().toISOString();
