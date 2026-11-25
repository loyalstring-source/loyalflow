import { loadConfig, type Config } from './config.ts';
import { openDb, type Db } from './db/index.ts';
import { createMailer, type Mailer } from './lib/mailer.ts';
import { createNotifier, type Notifier } from './lib/notify.ts';
import { createPusher, loadOrCreateVapid, newVapid, type Pusher } from './lib/webpush.ts';
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
  /** Notifications to phones and browsers that have them turned on. */
  push: Pusher;
  startedAt: Date;
}

export function createApp(overrides: Partial<Config> = {}): App {
  const cfg = loadConfig(overrides);
  const db = openDb(cfg.databasePath);
  applyLists(db);
  const mailer = createMailer(cfg.mail);
  const push = createPusher(db, loadOrCreateVapid(cfg.dataDir), { subject: `mailto:admin@${cfg.emailDomain}`, baseUrl: cfg.baseUrl });
  const notify = createNotifier(db, mailer, cfg.baseUrl, push);
  return { cfg, db, mailer, notify, push, graph: createGraphMailer(cfg.graph), startedAt: new Date() };
}

/** In-memory app for tests: fresh schema, console mailer, no scheduler. */
export function createTestApp(): App {
  const cfg = loadConfig({ databasePath: ':memory:', sessionSecret: 'test-secret-test-secret-test-secret-1234', schedulerEnabled: false, demo: true, baseUrl: 'http://localhost:3000', cookieSecure: false });
  const db = openDb(':memory:');
  applyLists(db);
  const mailer = createMailer({ ...cfg.mail, transport: 'console' });
  // Tests never reach a real push service: what would have been sent is kept on `pushed` for them to read.
  const pushed: { url: string; headers: Record<string, string>; bytes: number }[] = [];
  const push = Object.assign(createPusher(db, newVapid(), { subject: 'mailto:admin@loyalstring.com', baseUrl: cfg.baseUrl, fetch: async (url, init) => { pushed.push({ url, headers: init.headers, bytes: init.body.length }); return { status: url.includes('gone') ? 410 : 201 }; } }), { pushed });
  const notify = createNotifier(db, mailer, cfg.baseUrl, push);
  return { cfg, db, mailer, notify, push, graph: createGraphMailer({ tenantId: '', clientId: '', clientSecret: '', sender: '' }), startedAt: new Date() };
}
