// Reset one person's password back to the starter password and clear any lockout.
//   node --no-warnings=ExperimentalWarning scripts\reset-password.ts sridhar.narayanagowda@loyalstring.com
// With no email, lists every account and whether it is locked.
import { createApp } from '../src/app.ts';
import { hashPassword, passwordProblems } from '../src/lib/crypto.ts';

const app = createApp({ schedulerEnabled: false });
const email = (process.argv[2] || '').trim().toLowerCase();
const password = process.argv[3] || app.cfg.seedPassword;

if (!email) {
  const rows = app.db.all<{ id: string; full_name: string; email: string; locked_until: string | null; must_change_password: number }>(
    'SELECT id, full_name, email, locked_until, must_change_password FROM employees ORDER BY id');
  console.log(`\n${rows.length} accounts in ${app.cfg.databasePath}:\n`);
  for (const r of rows) {
    const locked = r.locked_until && r.locked_until > new Date().toISOString();
    console.log(`  ${r.id}  ${r.email.padEnd(42)} ${locked ? 'LOCKED until ' + r.locked_until.slice(11, 16) + ' UTC' : r.must_change_password ? 'must change password' : 'ok'}`);
  }
  console.log('\nTo reset one, run the same command again with the email on the end.\n');
  process.exit(0);
}

const user = app.db.get<{ id: string; full_name: string }>('SELECT id, full_name FROM employees WHERE lower(email) = ?', [email]);
if (!user) {
  console.log(`\nNo account with the email ${email}.`);
  console.log('Run this without an email to see the list.\n');
  process.exit(1);
}
// A custom password still has to meet the policy; the documented starter password is allowed
// through, because that is what a fresh install hands out and this tool exists to get you back to it.
if (password !== app.cfg.seedPassword) {
  const problem = passwordProblems(password);
  if (problem) { console.log(`\nThat password will not do: ${problem}\n`); process.exit(1); }
}
app.db.run('UPDATE employees SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
  [hashPassword(password), new Date().toISOString(), user.id]);
console.log(`\n${user.full_name} can now sign in:\n\n  Email:    ${email}\n  Password: ${password}\n`);
