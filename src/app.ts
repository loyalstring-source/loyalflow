import { loadConfig, type Config } from './config.ts';
import { openDb, type Db } from './db/index.ts';
import { createMailer, type Mailer } from './lib/mailer.ts';
import { createNotifier, type Notifier } from './lib/notify.ts';
import { createGraphMailer, type GraphMailer } from './lib/graph-mail.ts';
import { applyLists } from './lib/lists.ts';

/** Shared application context passed to services and routes. */
export interface App {
  cfg: Config;
  db: Db;
  mailer: Mailer;
  notify: Notifier;
  /** Microsoft Graph mail for candidate messages. `graph.configured` is false until the four GRAPH_* settings are present. */
  graph: GraphMailer;
  startedAt: Date;
}

export function createApp(overrides: Partial<Config> = {}): App {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.databasePath);
  applyLists(db);
  const mailer = createMailer(cfg.mail);
  const notify = createNotifier(db, mailer, cfg.baseUrl);
  return { cfg, db, mailer, notify, graph: createGraphMailer(cfg.graph), startedAt: new Date() };
}

/** In-memory app for tests: fresh schema, console mailer, no scheduler. */
export function createTestApp(): App {
  const cfg = loadConfig({ databasePath: ':memory:', sessionSecret: 'test-secret-test-secret-test-secret-1234', schedulerEnabled: false, demo: true, baseUrl: 'http://localhost:3000', cookieSecure: false });
  const db = openDb(':memory:');
  applyLists(db);
  const mailer = createMailer({ ...cfg.mail, transport: 'console' });
  const notify = createNotifier(db, mailer, cfg.baseUrl);
  return { cfg, db, mailer, notify, graph: createGraphMailer({ tenantId: '', clientId: '', clientSecret: '', sender: '' }), startedAt: new Date() };
}
