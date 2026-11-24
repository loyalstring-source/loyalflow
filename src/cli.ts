// Command line: seed, backup, create-user, set-password, snapshot.
import { join } from 'node:path';
import { existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { createApp } from './app.ts';
import { seedMaster } from './db/seed-master.ts';
import { seedBulk } from './db/seed-bulk.ts';
import { seedDemo } from './db/seed-demo.ts';
import { seedDemoExtras } from './db/seed-demo-extras.ts';
import { setPassword } from './lib/auth.ts';
import { getEmployeeByEmail } from './modules/people/model.ts';
import { snapshotNow } from './modules/kpi/engine.ts';
import { generateInstances } from './modules/sops/service.ts';

const [cmd, ...args] = process.argv.slice(2);
/** `--demo` works on Windows, macOS and Linux alike; LOYALFLOW_DEMO=1 still works where the shell supports it. */
const wantDemo = args.includes('--demo') || process.env.LOYALFLOW_DEMO === '1';

async function main(): Promise<void> {
  const app = createApp();
  switch (cmd) {
    case 'seed': {
      const r = seedMaster(app);
      console.log(`Master data ready: ${r.employees} employees, ${app.db.get<{ n: number }>('SELECT count(*) AS n FROM departments')?.n} departments.`);
      if (wantDemo) { seedDemo(app); seedDemoExtras(app); console.log('Demo data loaded.'); }
      else console.log('No demo data. Add --demo for the sample customers, tickets, deals and work orders.');
      generateInstances(app);
      snapshotNow(app);
      console.log(`Database: ${app.cfg.databasePath}`);
      console.log(`Sign in with any employee email and the seed password${wantDemo ? '' : ' (users must change it at first login)'}.`);
      break;
    }
    case 'seed-bulk': {
      try {
        const counts = seedBulk(app, { force: args.includes('--force') });
        const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        console.log('Bulk test data added:');
        for (const [k, n] of rows) console.log(`  ${String(n).padStart(5)}  ${k}`);
        generateInstances(app);
        // Backfill 13 weeks of KPI history from the backdated rows, so trends and
        // sparklines have something real behind them rather than one live point.
        // KPIs measured over a date range (bookings, SLA, leads) come out right;
        // the handful that measure a state right now (open tickets, headcount)
        // repeat today's figure across the history.
        process.stdout.write('\nRebuilding 13 weeks of KPI history');
        for (let w = 13; w >= 0; w--) { snapshotNow(app, new Date(Date.now() - w * 7 * 86_400_000)); process.stdout.write('.'); }
        console.log(' done');
        console.log(`\nDatabase: ${app.cfg.databasePath}`);
        console.log('Start the server and sign in as usual. Run with --force to add another batch.');
      } catch (e) { console.log((e as Error).message); process.exit(1); }
      break;
    }
    case 'backup': {
      const file = join(app.cfg.backupsDir, `loyalflow-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      app.db.backupTo(file);
      const keep = Number(args[0] || 14);
      const files = readdirSync(app.cfg.backupsDir).filter((f) => f.endsWith('.sqlite')).sort();
      while (files.length > keep) { const old = files.shift()!; unlinkSync(join(app.cfg.backupsDir, old)); }
      console.log(`Backup written: ${file} (${Math.round(statSync(file).size / 1024)} KB); keeping ${keep}.`);
      break;
    }
    case 'set-password': {
      const [email, password] = args;
      const user = email ? getEmployeeByEmail(app.db, email) : undefined;
      if (!user || !password) { console.error('Usage: set-password <email> <password>'); process.exit(1); }
      const problem = setPassword(app, user.id, password, null);
      if (problem) { console.error(problem); process.exit(1); }
      console.log(`Password set for ${user.full_name}.`);
      break;
    }
    case 'snapshot': {
      console.log(`Stored ${snapshotNow(app)} KPI values.`);
      break;
    }
    default:
      console.log('Commands: seed | backup [keep] | set-password <email> <password> | snapshot');
      if (!existsSync(app.cfg.databasePath)) console.log('No database yet: run `npm run seed` first.');
  }
  app.db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
