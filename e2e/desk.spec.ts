import { test, expect } from 'playwright/test';
import { login, SUPPORT_LEAD, COO } from './helpers.ts';

test('support lead: sign in, raise a P1, reply, resolve with confetti, see it on the company page', async ({ page }) => {
  await login(page, SUPPORT_LEAD);
  await expect(page.locator('h1')).toHaveText('Today');
  await expect(page.getByText(/Good (morning|afternoon|evening), Prasad/)).toBeVisible();

  await page.goto('/desk');
  await expect(page.locator('h1')).toHaveText('Service desk');
  await page.getByRole('button', { name: 'New ticket' }).click();
  await expect(page.locator('#modal')).toBeVisible();
  await page.fill('#f-subject', 'E2E: scanner offline at Kalyani');
  await page.fill('#f-description', 'Raised by the Playwright test');
  await page.locator('[data-chips="priority"] .chip', { hasText: 'P1' }).click();
  await page.locator('#modal button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText(/T-\d+ created/);
  await page.waitForLoadState('networkidle');
  const card = page.locator('.kcard', { hasText: 'E2E: scanner offline at Kalyani' }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/kcard-p1/);

  await card.click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('h2')).toContainText('E2E: scanner offline');
  await drawer.locator('#f-text').fill('We have dispatched an engineer.');
  await drawer.locator('button[type=submit]', { hasText: 'Send' }).click();
  await expect(page.locator('.toast')).toContainText('Reply sent');
  await page.waitForLoadState('networkidle');

  await card.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('In progress').first()).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await drawer.getByRole('button', { name: 'Resolve ticket' }).click();
  await expect(page.locator('.toast')).toContainText('resolved');
  await expect(page.locator('.confetti')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.column', { hasText: 'Resolved' }).locator('.kcard', { hasText: 'E2E: scanner offline' })).toBeVisible();

  await page.goto('/company');
  await expect(page.locator('h1')).toHaveText('Company');
  await expect(page.locator('.tile')).toHaveCount(16);
  await page.locator('.tile[data-kpi="sla_breaches_today"]').click();
  await expect(page.locator('h1')).toHaveText('SLA breaches today');
  await expect(page.locator('svg.chart')).toBeVisible();
});

test('COO: approvals from Today, targets, Excel and PowerPoint downloads', async ({ page }) => {
  await login(page, COO);
  const approve = page.locator('section', { hasText: 'Waiting for your approval' }).getByRole('button', { name: 'Approve' }).first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.locator('.toast')).toContainText('Approved');

  await page.goto('/kpi/sop_compliance');
  await page.fill('#f-target', '92');
  await page.fill('#f-reason', 'E2E: raising the bar');
  await page.locator('form[action="/kpi/sop_compliance/target"] button[type=submit]').click();
  await expect(page.locator('.toast')).toContainText('Target saved');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Target 92%').first()).toBeVisible();

  await page.goto('/company');
  const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Excel' }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/loyalflow-company-.*\.xlsx/);
  const [pptx] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'PowerPoint' }).click()]);
  expect(pptx.suggestedFilename()).toMatch(/\.pptx$/);
});

test('keyboard: / focuses search, Escape closes the drawer; 404 shows a friendly page', async ({ page }) => {
  await login(page, COO);
  await page.goto('/desk');
  await page.keyboard.press('/');
  await expect(page.locator('#global-search')).toBeFocused();
  await page.locator('#global-search').fill('Omkar');
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toContainText('Search: Omkar');
  await page.goto('/desk');
  await page.locator('.kcard').first().click();
  await expect(page.locator('#drawer-root')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer-root')).not.toHaveClass(/open/);
  await page.goto('/this-does-not-exist');
  await expect(page.getByText('That page does not exist')).toBeVisible();
});
