// Readiness crawl: sign in as each kind of person, follow every link the screens offer, and report anything that fails.
// Run: node --no-warnings=ExperimentalWarning tests/crawl.ts [demo|real]
import { startServer, Client, COO, CEO, SALES_HEAD, SUPPORT_LEAD, SUPPORT_IC, BDM, PRODUCTION_LEAD, HR } from './helpers.ts';

const mode = process.argv[2] === 'real' ? 'real' : 'demo';
const s = await startServer({ demo: mode === 'demo' });
s.app.db.run('UPDATE employees SET must_change_password = 0');
const acc = s.app.db.get<{ email: string }>("SELECT e.email FROM employees e JOIN departments d ON d.id = e.department_id WHERE d.code = 'ACC' AND e.status = 'active' LIMIT 1")?.email;
const who: [string, string][] = [['COO', COO], ['CEO', CEO], ['Sales head', SALES_HEAD], ['Sales person', BDM], ['Support lead', SUPPORT_LEAD], ['Support agent', SUPPORT_IC], ['Development head', 'karan.bhoite@loyalstring.com'], ['Developer', 'akash.panbhare@loyalstring.com'], ['Production lead', PRODUCTION_LEAD], ['HR', HR]];
if (acc) who.push(['Accounts', acc]);
const skip = /^\/(logout|login)|\/delete|\.zip$|^\/files\/|^\/e\/|^\/assess\//;
let total = 0; const problems: string[] = []; const seenAll = new Set<string>();
for (const [label, email] of who) {
  const c = new Client(s.base); await c.login(email);
  const queue: [string, number, string][] = [['/', 0, 'start']]; const seen = new Set<string>(['/']); let n = 0;
  while (queue.length && n < 700) {
    const [path, depth, from] = queue.shift()!; n++;
    let res: Response; try { res = await c.get(path); } catch (e) { problems.push(`${label}: ${path} did not answer (${(e as Error).message}) — linked from ${from}`); continue; }
    const type = res.headers.get('content-type') || ''; const body = type.includes('html') ? await res.text() : (await res.arrayBuffer(), '');
    seenAll.add(path.split('?')[0].replace(/\/[A-Z]{2,5}-?\d+[^/]*/g, '/:id'));
    if (res.status >= 500) problems.push(`${label}: ${path} → ${res.status} — linked from ${from}`);
    else if (res.status === 403 || res.status === 404) problems.push(`${label}: ${path} → ${res.status} (a link the screen offers) — linked from ${from}`);
    else if (res.status >= 300 && res.status < 400) { const to = res.headers.get('location') || ''; if (to.startsWith('/') && !seen.has(to) && !skip.test(to)) { seen.add(to); queue.push([to, depth, path]); } }
    else if (/Something went wrong|undefined<\/|>undefined<|\[object Object\]|NaN<|>NaN/.test(body)) problems.push(`${label}: ${path} shows "${/Something went wrong|\[object Object\]|NaN|undefined/.exec(body)![0]}" — linked from ${from}`);
    if (depth >= 3 || !body) continue;
    for (const m of body.matchAll(/href="(\/[^"#]*)"/g)) { const h = m[1].replace(/&amp;/g, '&'); if (seen.has(h) || skip.test(h) || /\.(css|js|png|svg|ico|webmanifest)(\?|$)/.test(h)) continue; seen.add(h); queue.push([h, depth + 1, path]); }
  }
  total += n; console.log(`${label.padEnd(18)} ${String(n).padStart(4)} pages${queue.length ? ` (+${queue.length} not reached)` : ''}`);
}
console.log(`\n${mode} data: ${total} page loads, ${seenAll.size} different screens, ${problems.length} problem(s)`);
const groups = new Map<string, { n: number; who: Set<string>; eg: string }>();
for (const p of new Set(problems)) { const [label, rest] = [p.slice(0, p.indexOf(':')), p.slice(p.indexOf(':') + 2)]; const key = rest.replace(/ — linked from .*/, '').replace(/[A-Z]{2,5}-\d+/g, ':id').replace(/=[^&\s]*/g, '=…').replace(/\/LS\d+/g, '/:emp'); const g = groups.get(key) || { n: 0, who: new Set<string>(), eg: rest }; g.n++; g.who.add(label); groups.set(key, g); }
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log(` - ${g.n}× ${k}  [${[...g.who].join(', ')}]  e.g. ${g.eg}`);
await s.close(); process.exit(0);
