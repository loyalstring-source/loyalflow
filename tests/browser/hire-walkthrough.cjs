// Walks the hiring, assessment and appraisal forms in a real browser, the way a person would.
// The integration tests post JSON straight to the server, so they cannot see a form that fails to send its fields.
// Run against a demo server with test data:  node tests/browser/hire-walkthrough.cjs [baseUrl]
const { chromium } = require('playwright');
const zlib = require('node:zlib');
// A minimal .docx (a stored zip with one document part), so the walkthrough can upload real files.
function docx(text) {
  const files = { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document><w:body>' + text.split('\n').map((l) => '<w:p><w:r><w:t>' + l.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>' };
  const parts = [], central = []; let offset = 0;
  for (const [name, body] of Object.entries(files)) {
    const data = Buffer.from(body, 'utf8'), n = Buffer.from(name, 'utf8'), crc = zlib.crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n); offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const cvText = (name, email, phone) => `${name}\n${email} | ${phone} | Pune\n\nSummary\nTechnical support engineer with 4 years of experience supporting ERP and billing software for retail stores.\n\nExperience\nSupport Engineer, Example Retail Systems Pvt Ltd, Jan 2022 to Present\nHandled GST billing and inventory tickets for 60 stores.\n\nEducation\nB.Com, Pune University, 2019\n\nSkills: Excel, SQL, Tally, customer support, ERP, inventory`;
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const PW = process.env.SEED_PASSWORD || 'Welcome@LoyalFlow1';
let failed = 0;
const ok = (cond, label, extra = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond ? '' : ' ' + extra}`); if (!cond) failed++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const p = await ctx.newPage();
  p.on('response', async (r) => { if (r.url().includes('/bulk/') && r.request().method() === 'POST') console.error('   ', r.status(), r.url().split('/').pop(), (await r.text().catch(() => '')).slice(0, 300)); }); p.on('pageerror', (e) => console.error('   page error:', e.message));
  const posts = []; const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(e.message));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Walkthrough reason text' : undefined));
  p.on('response', async (r) => { if (r.request().method() === 'POST' && !r.url().includes('/login')) { let body = ''; try { body = await r.text(); } catch { /* navigated */ } posts.push({ url: r.url().replace(BASE, ''), status: r.status(), sent: r.request().postData() || '', body }); } });
  const last = () => posts[posts.length - 1] || { status: 0, url: '', sent: '', body: '' };
  const go = (path) => p.goto(BASE + path, { waitUntil: 'networkidle' });
  const submit = async () => { const n = posts.length; await p.click('#modal form [type=submit]'); for (let i = 0; i < 40 && posts.length === n; i++) await p.waitForTimeout(100); await p.waitForLoadState('networkidle'); };
  const openModal = async (text) => { await p.click(`button:has-text("${text}"), a:has-text("${text}")`); await p.waitForSelector('#modal form[data-post]', { state: 'visible' }); };
  const posted = (label) => ok(last().status === 200, label, `→ ${last().status} ${last().url} sent=${last().sent.slice(0, 120)} got=${last().body.slice(0, 160)}`);

  await p.goto(BASE + '/login');
  await p.fill('input[name=email]', 'sridhar.narayanagowda@loyalstring.com'); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]'); await p.waitForURL(BASE + '/');

  // 1. New vacancy
  const stamp = String(Date.now()).slice(-6);
  await go('/hire'); await openModal('New vacancy');
  await p.fill('#modal form[data-post] input[name=title]', `Walkthrough Role ${stamp}`);
  await p.selectOption('#modal form[data-post] select[name=departmentId]', { index: 1 });
  await p.fill('#modal form[data-post] input[name=budgetCtc]', '500000');
  await p.fill('#modal form[data-post] textarea[name=justification]', 'Created by the browser walkthrough to prove the form sends its fields.');
  const before = posts.length;
  await p.click('#modal form[data-post] input[name=location]'); await p.waitForTimeout(300);
  ok(posts.length === before, 'clicking inside a form does not submit it');
  await submit(); posted('new vacancy saves');
  await p.waitForURL(/\/hire\/req\//, { timeout: 10000 }).catch(() => {}); await p.waitForLoadState('networkidle');
  ok(/\/hire\/req\//.test(p.url()), 'lands on the vacancy page', p.url());
  const reqUrl = p.url();

  // 2. Cancel closes a modal; then open the vacancy with an approval reference
  await openModal('Open vacancy');
  await p.click('#modal form[data-post] .js-close-modal'); await p.waitForTimeout(400);
  ok(!(await p.isVisible('#modal form[data-post] input[name=approvalRef]').catch(() => false)), 'Cancel closes the modal');
  await openModal('Open vacancy'); await p.fill('#modal form[data-post] input[name=approvalRef]', 'Approved by COO, walkthrough'); await submit(); posted('vacancy opens with an approval reference');

  // 3. Two candidates on that vacancy
  const appUrls = [];
  for (const name of [`Walk Alpha ${stamp}`, `Walk Beta ${stamp}`]) {
    await p.goto(reqUrl, { waitUntil: 'networkidle' }); await openModal('Add candidate');
    await p.fill('#modal form[data-post] input[name=fullName]', name);
    await p.fill('#modal form[data-post] input[name=email]', `${name.replace(/\s+/g, '.').toLowerCase()}@example.com`);
    await p.fill('#modal form[data-post] input[name=experienceYears]', '3');
    await p.selectOption('#modal form[data-post] select[name=requisitionId]', { label: (await p.$$eval('#modal form[data-post] select[name=requisitionId] option', (os, s) => os.map((o) => o.textContent).find((t) => t.includes(s)), stamp)) });
    await p.selectOption('#modal form[data-post] select[name=source]', 'referral');
    await submit(); posted(`candidate "${name}" saves`);
    await p.waitForURL(/\/hire\/app\//, { timeout: 10000 }).catch(() => {}); await p.waitForLoadState('networkidle');
    ok(/\/hire\/app\//.test(p.url()), 'lands on the application', p.url());
    appUrls.push(p.url());
  }
  ok((await p.textContent('h1')).includes('Walk Beta'), 'the name typed is the name saved');

  // 4. Stage button, screening notes, schedule with a two-person panel
  await p.click('button:has-text("Screening")'); await p.waitForLoadState('networkidle'); posted('stage button moves the card');
  await p.fill('textarea[name=notes]', 'Spoke on the phone. Clear and prompt.'); await p.click('form[data-post$="/notes"] [type=submit]'); await p.waitForTimeout(800); posted('screening notes save');
  await openModal('Schedule interview');
  const boxes = await p.$$('#modal form[data-post] input[name="panel[]"]'); await boxes[0].check(); await boxes[1].check();
  const d = new Date(Date.now() + 3 * 86400000); d.setHours(11, 0, 0, 0);
  await p.fill('#modal form[data-post] input[name=startsAt]', new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await submit(); posted('interview schedules');
  ok(/"panel":\[".+",".+"\]/.test(last().sent), 'both panel members are sent', last().sent.slice(0, 200));

  // 5. Hold, resume, decision (reject path needs no scorecard), reopen
  await openModal('Put on hold'); await p.fill('#modal form[data-post] textarea[name=reason]', 'Waiting for the manager'); await p.fill('#modal form[data-post] input[name=until]', new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)); await submit(); posted('hold saves');
  await p.click('button:has-text("Resume")'); await p.waitForLoadState('networkidle'); posted('resume works');
  await openModal('Record decision'); await p.selectOption('#modal form[data-post] select[name=outcome]', 'reject'); await p.fill('#modal form[data-post] textarea[name=rationale]', 'Walkthrough: not the right fit for this role.'); await submit(); posted('decision records');
  ok((await p.textContent('body')).includes('Rejected'), 'the application shows as rejected');

  // 6. English assessment: single, then batch from the vacancy, then take and review it
  await p.goto(appUrls[0], { waitUntil: 'networkidle' });
  await openModal('Invite'); await p.selectOption('#modal form[data-post] select[name=level]', 'B1'); await submit(); posted('single assessment invitation');
  await p.goto(reqUrl, { waitUntil: 'networkidle' }); await openModal('English assessment');
  await p.check('#modal form[data-post] input[name="applicationIds[]"]'); await submit(); posted('batch assessment invitation');
  await p.waitForURL(/\/hire\/assessments/, { timeout: 10000 }).catch(() => {}); await p.waitForLoadState('networkidle');
  ok(/"applicationIds":\["APP-/.test(last().sent), 'the ticked applicant is sent as a list', last().sent.slice(0, 160));
  ok(p.url().includes('/hire/assessments'), 'lands on the queue', p.url());
  await p.click(`tr:has-text("Walk Alpha ${stamp}") button:has-text("Get link")`); await p.waitForSelector('#share-link');
  const link = await p.inputValue('#share-link');
  ok(/\/assess\/[A-Za-z0-9_-]{20,}$/.test(link), 'Get link shows the candidate link to copy', link.slice(0, 60));
  await p.click('#modal .js-close-modal');
  const c = await ctx.newPage(); await c.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle' });
  await c.click('button:has-text("Begin")'); await c.waitForSelector('#assess-form');
  for (const name of await c.$$eval('#assess-form input[type=radio]', (els) => [...new Set(els.map((e) => e.name))])) await c.check(`input[name="${name}"][value="1"]`);
  await c.fill('#writing', 'Dear Sir, I am sorry but I cannot come on Sunday because of a family function. I can work on Saturday instead. Thank you.');
  c.on('dialog', (dlg) => dlg.accept()); await c.click('#submit-btn'); await c.waitForLoadState('networkidle');
  ok((await c.textContent('body')).includes('has been submitted'), 'candidate submits through the page');
  await c.close();
  await go('/hire/assessments?status=review');
  ok(await p.isVisible(`tr:has-text("Walk Alpha ${stamp}")`), 'the submitted assessment is waiting for review');
  await p.click(`tr:has-text("Walk Alpha ${stamp}") :text-is("Review")`); await p.waitForLoadState('networkidle');
  for (const k of ['task', 'organisation', 'grammar', 'vocabulary', 'tone']) await p.check(`input[name="s_${k}"][value="3"]`);
  await p.selectOption('select[name=outcome]', 'meets'); await p.fill('textarea[name=note]', 'Clear and polite.');
  { const n = posts.length; await p.click('form[data-post$="/review"] [type=submit]'); for (let i = 0; i < 40 && posts.length === n; i++) await p.waitForTimeout(100); await p.waitForLoadState('networkidle'); }
  posted('writing review saves');

  // 6b. Screening with points, the interview plan, a CV on one candidate, and a bulk upload
  await p.goto(appUrls[0], { waitUntil: 'networkidle' });
  const selects = await p.$$('form[data-post$="/screening"] select');
  ok(selects.length >= 5, 'screening questions are on the application', String(selects.length));
  for (const sel of selects) { const opts = await sel.$$eval('option', (os) => os.map((o) => o.value).filter(Boolean)); await sel.selectOption(opts[opts.length - 1]); }
  await p.fill('form[data-post$="/screening"] input[name=n_q1]', 'Handles ERP tickets for 40 stores.');
  { const n = posts.length; await p.click('form[data-post$="/screening"] [type=submit]'); for (let i = 0; i < 40 && posts.length === n; i++) await p.waitForTimeout(100); await p.waitForLoadState('networkidle'); }
  posted('screening score saves');
  ok(/Scored by/.test(await p.textContent('body')), 'the score and who gave it are shown');

  await p.goto(reqUrl, { waitUntil: 'networkidle' });
  await p.click('section:has(h2:has-text("Interview plan")) button:has-text("Change")'); await p.waitForSelector('#modal form[data-post$="/plan"]');
  await p.fill('#modal input[name=name_4]', 'Practical test'); await p.fill('#modal input[name=order_4]', '2'); await p.fill('#modal input[name=order_1]', '3');
  await submit(); posted('interview plan saves');
  ok(/HR round[\s\S]*Practical test[\s\S]*Team manager round/.test(await p.textContent('section:has(h2:has-text("Interview plan"))')), 'the new round sits where its order number puts it');
  await p.goto(appUrls[0], { waitUntil: 'networkidle' });
  await p.click('section:has(h2:has-text("Interview plan")) button:has-text("Schedule")'); await p.waitForSelector('#modal form[data-post$="/schedule"]');
  ok((await p.inputValue('#modal input[name=roundName]')) === 'HR round', 'scheduling the next round fills in its name');
  ok((await p.$$('#modal input[name="panel[]"]:checked')).length === 1, 'and ticks the planned interviewer');
  await p.click('#modal .js-close-modal');

  await p.setInputFiles('#cv-file', { name: 'Walk Alpha CV.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx(cvText('Walk Alpha', 'walk.alpha@example.com', '+91 98765 11111')) });
  await p.waitForSelector('a:has-text("Open CV")', { timeout: 15000 });
  ok(/4 years/.test(await p.inputValue('form[data-post$="/summary"] textarea')), 'the uploaded CV is read into the summary');
  posted('single CV upload');

  await p.goto(reqUrl + '/bulk', { waitUntil: 'networkidle' });
  await p.setInputFiles('#bulk-files', [1, 2, 3].map((i) => ({ name: `bulk${i}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx(cvText(`Bulk Walk${String.fromCharCode(64 + i)} ${stamp}`, `bulk${i}.${stamp}@example.com`, `+91 98${stamp}0${i}`)) })));
  await p.waitForSelector('#bulk-create', { state: 'visible', timeout: 30000 }); await p.waitForFunction(() => document.querySelectorAll('#bulk-table tbody tr').length === 3);
  ok((await p.inputValue('#bulk-table input[data-i="0"][data-k="email"]')) === `bulk1.${stamp}@example.com`, 'the table shows what was read from each file');
  await p.uncheck('#bulk-table input[data-i="2"][data-k="include"]');
  await p.fill('#bulk-table input[data-i="1"][data-k="fullName"]', `Bulk Corrected ${stamp}`);
  await p.click('#bulk-create'); await p.waitForSelector('#bulk-result .list', { timeout: 8000 }).catch(async (e) => { console.error('bulk create said:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map((t) => t.textContent).join(' / ') + ' :: ' + document.getElementById('bulk-result').textContent + ' :: ' + document.getElementById('bulk-create').disabled)); throw e; });
  const result = await p.textContent('#bulk-result');
  ok(/2 created, 1 not created/.test(result), 'only the ticked rows are created', result.slice(0, 120));
  ok(result.includes(`Bulk Corrected ${stamp}`), 'a name corrected in the table is the name saved');
  await go('/hire/settings');
  ok(/Read CVs with Google Gemini/.test(await p.textContent('body')), 'hiring settings page opens');

  // 7. Close the vacancy with a choice for the people in play
  await p.goto(reqUrl, { waitUntil: 'networkidle' }); await openModal('Close vacancy');
  await p.fill('#modal form[data-post] textarea[name=reason]', 'Walkthrough finished'); await p.selectOption('#modal form[data-post] select[name=applicants]', 'close'); await submit(); posted('vacancy closes');

  // 8. One appraisal form, as proof the same fix reaches that module
  await go('/appraisals');
  const first = await p.getAttribute('a[href^="/appraisals/A"], a[href^="/appraisals/"]:not([href$="/appraisals/"])', 'href').catch(() => null);
  if (first) {
    await go(first);
    const form = await p.$('form[data-post]');
    if (form) {
      const action = await form.getAttribute('data-post'); const n = posts.length;
      await p.click('form[data-post] textarea, form[data-post] input:not([type=hidden])').catch(() => {}); await p.waitForTimeout(300);
      ok(posts.length === n, `clicking inside the appraisal form (${action}) does not submit it`);
    }
  }
  ok(pageErrors.length === 0, 'no script errors on any page', pageErrors[0] || '');
  await b.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll browser checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('walkthrough crashed:', e.message.split('\n')[0]); process.exit(2); });
