import { test, expect } from 'playwright/test';
import { login, SUPPORT_IC } from './helpers.ts';

test('phone: Today page fits the screen, check-in works, bottom tabs navigate', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 18.52, longitude: 73.85 });
  await login(page, SUPPORT_IC);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewportSize()!.width;
  expect(width).toBeLessThanOrEqual(viewport + 1);
  const checkIn = page.getByRole('button', { name: /Check in for today/ });
  if (await checkIn.count()) {
    await checkIn.click();
    await expect(page.locator('.toast')).toContainText('Checked in');
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByText(/In at \d\d:\d\d/)).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.locator('.mobile-nav a', { hasText: 'Service desk' }).click();
  await expect(page.locator('h1')).toHaveText('Service desk');
  await page.locator('.mobile-nav a', { hasText: 'Approvals' }).click();
  await expect(page.locator('h1')).toHaveText('Approvals');
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  expect((await manifest.json()).display).toBe('standalone');
});
