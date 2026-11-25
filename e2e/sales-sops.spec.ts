import { test, expect } from 'playwright/test';
import { login, BDM, SUPPORT_LEAD, SUPPORT_IC, PRODUCTION_LEAD } from './helpers.ts';

test('BDM: new lead, exit rules, estimates on the deal and a visit with location', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 18.5204, longitude: 73.8567 });
  await login(page, BDM);
  await page.goto('/pipeline');
  await page.getByRole('button', { name: 'New lead' }).click();
  await page.fill('#f-customerName', 'E2E Plastics');
  await page.fill('#f-city', 'Pune');
  await page.fill('#f-title', 'Floor tracking kit');
  await page.fill('#f-value', '450000');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('Lead created');
  await page.waitForLoadState('networkidle');

  const card = page.locator('.kcard', { hasText: 'E2E Plastics' }).first();
  await card.click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toBeVisible();
  // Qualified is locked until need/budget/timeline are recorded
  const qualified = drawer.getByRole('button', { name: /Qualified/ });
  await expect(qualified).toHaveAttribute('title', /need, budget and timeline/);
  await drawer.getByText('Qualification, PO and details').click();
  await drawer.locator('#f-qualified_need').fill('Track WIP');
  await drawer.locator('#f-qualified_budget').fill('5 L');
  await drawer.locator('#f-qualified_timeline').fill('This quarter');
  await drawer.locator('form[action$="/update"] button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('Deal updated');
  await page.waitForLoadState('networkidle');
  await card.click();
  await drawer.getByRole('button', { name: 'Contacted' }).click();
  await expect(page.locator('.toast')).toContainText('Moved to contacted');
  await page.waitForLoadState('networkidle');

  await page.locator('.kcard', { hasText: 'E2E Plastics' }).first().click();
  // Quotes are now estimates: the deal offers one, and its discount routing is covered in tests/integration/estimates.test.ts.
  await expect(drawer.getByRole('heading', { name: 'Estimates' })).toBeVisible();
  await expect(drawer).toContainText('No estimate yet');
  await drawer.locator('[data-chips="kind"] .chip', { hasText: 'Visit' }).click();
  await drawer.locator('#f-notes').fill('Met the plant head');
  await drawer.locator('form[action$="/activity"] button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('Visit logged');
});

test('support IC: tick SOP steps with evidence, request leave; lead approves it', async ({ page }) => {
  await login(page, SUPPORT_LEAD);
  await page.goto('/sops');
  const huddle = page.locator('.sop', { hasText: 'Daily support huddle' }).first();
  await expect(huddle).toBeVisible();
  const unchecked = huddle.locator('input[type=checkbox]:not(:checked)').first();
  const needsPrompt = await unchecked.getAttribute('data-prompt');
  if (needsPrompt) page.once('dialog', (d) => d.accept('Called all three P1 customers'));
  await unchecked.click();
  await expect(page.locator('.toast')).toContainText(/Step done|Checklist complete/);

  await page.goto('/approvals');
  await page.getByRole('button', { name: 'Request leave' }).click();
  await page.fill('#f-from', '2026-12-21');
  await page.fill('#f-to', '2026-12-22');
  await page.fill('#f-reason', 'E2E holiday');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText(/Leave request sent|Leave approved/);
});

test('production lead switches to Hindi and the board follows', async ({ page }) => {
  await login(page, PRODUCTION_LEAD);
  await page.goto('/production');
  await expect(page.locator('h1')).toHaveText('Production');
  await page.locator('.lang button', { hasText: 'हिन्दी' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toHaveText('उत्पादन');
  await expect(page.locator('.column-head', { hasText: 'उत्पादन में' })).toBeVisible();
  await page.locator('.lang button', { hasText: 'English' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toHaveText('Production');
});

test('an IC cannot open the company page or settings', async ({ page }) => {
  await login(page, SUPPORT_IC);
  await page.goto('/company');
  await expect(page.locator('h1')).toHaveText('Not allowed');
  await page.goto('/settings');
  await expect(page.locator('h1')).toHaveText('Not allowed');
  await expect(page.locator('.nav a', { hasText: 'Company' })).toHaveCount(0);
});

test('phase 2: procurement, budgets, travel, hours and imports open; timer runs on a work order', async ({ page }) => {
  await login(page, 'sridhar.ngowda@loyalstring.com');
  for (const [url, h1] of [['/procurement', 'Procurement'], ['/budgets', 'Budgets'], ['/travel', 'Sales travel'], ['/hours', 'Man-hours'], ['/imports', 'Import data']]) {
    await page.goto(url); await expect(page.locator('h1')).toHaveText(h1);
  }
  await page.goto('/production');
  await page.locator('.kcard').first().click();
  const drawer = page.locator('#drawer');
  await drawer.getByRole('button', { name: 'Start timer' }).click();
  await expect(page.locator('.toast')).toContainText('Timer running');
  await page.waitForLoadState('networkidle');
  await page.locator('.kcard').first().click();
  await drawer.getByRole('button', { name: 'Stop timer' }).click();
  await expect(page.locator('.toast')).toContainText('Logged');
});

test('development: HOD plans an issue, moves it, QA fails a test, release flow', async ({ page }) => {
  await login(page, 'karan.bhoite@loyalstring.com');
  await page.goto('/dev');
  await expect(page.locator('h1')).toHaveText('Development');
  await page.getByRole('button', { name: 'New issue' }).click();
  await page.fill('#f-title', 'E2E: export audit log as CSV');
  await page.locator('[data-chips="type"] .chip', { hasText: 'Feature' }).click();
  await page.fill('#f-points', '3');
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('created');
  await page.waitForLoadState('networkidle');
  const card = page.locator('.kcard', { hasText: 'E2E: export audit log' }).first();
  await card.click();
  const drawer = page.locator('#drawer');
  await drawer.getByRole('button', { name: 'In progress', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('in progress');
  await page.waitForLoadState('networkidle');
  await page.locator('.kcard', { hasText: 'E2E: export audit log' }).first().click();
  await drawer.locator('form[action$="/checks"]').first().locator('#f-title').fill('Write the exporter');
  await drawer.locator('form[action$="/checks"]').first().locator('button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('Sub-task added');
  await page.goto('/dev/planning');
  await expect(page.locator('h1')).toHaveText('Sprint planning');
  await page.goto('/dev/projects');
  await expect(page.locator('.card', { hasText: 'Floor app v3' })).toBeVisible();
  await page.goto('/dev/releases');
  await page.getByRole('link', { name: /3\.2\.0/ }).first().click();
  await expect(page.locator('h1')).toContainText('Release 3.2.0');
  await page.goto('/dev/metrics');
  await expect(page.locator('h1')).toHaveText('Development metrics');
});
