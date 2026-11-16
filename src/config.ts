import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface Config {
  port: number;
  host: string;
  baseUrl: string;
  dataDir: string;
  databasePath: string;
  uploadsDir: string;
  backupsDir: string;
  sessionSecret: string;
  cookieSecure: boolean;
  demo: boolean;
  seedPassword: string;
  emailDomain: string;
  /** Microsoft Graph mail for candidate messages. Empty values mean it is not configured and nothing is sent. */
  graph: { tenantId: string; clientId: string; clientSecret: string; sender: string };
  /** Encrypts assessment invitation links at rest. Stable across restarts. */
  assessmentSecret: string;
  mail: { transport: 'console' | 'smtp'; host: string; port: number; user: string; pass: string; from: string; starttls: boolean };
  timezoneOffsetMinutes: number; // IST
  sessionDays: number;
  apiTokenDays: number;
  schedulerEnabled: boolean;
  logLevel: 'debug' | 'info' | 'warn';
}

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function loadOrCreateSecret(dataDir: string): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const file = join(dataDir, 'session.secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

let cached: Config | null = null;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const dataDir = resolve(env('DATA_DIR', './data'));
  mkdirSync(dataDir, { recursive: true });
  const baseUrl = env('BASE_URL', `http://localhost:${env('PORT', '3000')}`).replace(/\/$/, '');
  const cfg: Config = {
    port: Number(env('PORT', '3000')),
    host: env('HOST', '0.0.0.0'),
    baseUrl,
    dataDir,
    databasePath: env('DATABASE_PATH', join(dataDir, 'loyalflow.sqlite')),
    uploadsDir: join(dataDir, 'uploads'),
    backupsDir: join(dataDir, 'backups'),
    sessionSecret: overrides.sessionSecret ?? loadOrCreateSecret(dataDir),
    cookieSecure: env('COOKIE_SECURE', baseUrl.startsWith('https://') ? '1' : '0') === '1',
    // Accept both: the env var for Docker and Linux, `--demo` for Windows, where a
    // bare VAR=1 prefix is not shell syntax and silently fails.
    demo: env('LOYALFLOW_DEMO', '0') === '1' || process.argv.includes('--demo'),
    seedPassword: env('SEED_PASSWORD', 'Welcome@LoyalFlow1'),
    emailDomain: env('EMAIL_DOMAIN', 'loyalstring.com'),
    mail: {
      transport: env('MAIL_TRANSPORT', 'console') === 'smtp' ? 'smtp' : 'console',
      host: env('SMTP_HOST', 'smtp.office365.com'),
      port: Number(env('SMTP_PORT', '587')),
      user: env('SMTP_USER', ''),
      pass: env('SMTP_PASS', ''),
      from: env('MAIL_FROM', 'LoyalFlow <noreply@loyalstring.com>'),
      starttls: env('SMTP_STARTTLS', '1') === '1'
    },
    graph: { tenantId: env('GRAPH_TENANT_ID', ''), clientId: env('GRAPH_CLIENT_ID', ''), clientSecret: env('GRAPH_CLIENT_SECRET', ''), sender: env('GRAPH_SENDER', '') },
    assessmentSecret: env('ASSESSMENT_LINK_SECRET', ''),
    timezoneOffsetMinutes: 330,
    sessionDays: Number(env('SESSION_DAYS', '14')),
    apiTokenDays: Number(env('API_TOKEN_DAYS', '90')),
    schedulerEnabled: env('SCHEDULER', '1') === '1',
    logLevel: (env('LOG_LEVEL', 'info') as Config['logLevel'])
  };
  mkdirSync(cfg.uploadsDir, { recursive: true });
  mkdirSync(cfg.backupsDir, { recursive: true });
  const merged = { ...cfg, ...overrides };
  if (Object.keys(overrides).length === 0) cached = merged;
  return merged;
}
