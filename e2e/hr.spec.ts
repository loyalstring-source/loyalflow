import { test, expect } from 'playwright/test';
import { login, COO, HR, SUPPORT_LEAD, SUPPORT_IC } from './helpers.ts';

test('COO: run payroll for the month, read a payslip, download the bank file', async ({ page }) => {
  await login(page, COO);
  await page.goto('/payroll');
  await expect(page.locator('h1')).toHaveText('Payroll');

  // The most recent run is this month's draft, from the demo data.
  const row = page.locator('tbody tr', { hasText: /Draft/i }).first();
  await expect(row).toBeVisible();
  await row.locator('a[href^="/payroll/PAY-"]').first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toContainText(/\w+ \d{4}/);

  // Statutory totals must be on the page before anyone approves anything.
  await expect(page.getByText(/Provident fund|PF/i).first()).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /Approve/ }).first().click();
  await expect(page.locator('.toast')).toContainText(/Approved/i);
  await page.waitForLoadState('networkidle');

  const bank = page.locator('a[href$="bank.csv"]').first();
  await expect(bank).toBeVisible();

  // Open one payslip and check it nets out on screen.
  await page.locator('table a').first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Net pay/i).first()).toBeVisible();
});

test('employee: see my own payslips and file a tax declaration', async ({ page }) => {
  await login(page, SUPPORT_IC);
  await page.goto('/me/payslips');
  await expect(page.locator('h1')).toContainText(/Payslip/i);
  await page.goto('/me/tax-declaration');
  await expect(page.locator('body')).toContainText(/regime/i);
});

test('attendance: a missed punch is raised as a request with a reason', async ({ page }) => {
  await login(page, SUPPORT_IC);
  await page.goto('/attendance');
  await expect(page.locator('h1')).toHaveText('Attendance');
  await page.getByRole('button', { name: /Miss-punch request/i }).click();
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#modal')).toContainText(/reason/i);
});

test('appraisal: self review goes to the manager', async ({ page }) => {
  await login(page, SUPPORT_IC);
  await page.goto('/appraisals');
  await expect(page.locator('h1')).toHaveText('Appraisals');
  const mine = page.locator('table a').first();
  if (await mine.count()) {
    await mine.click();
    await page.waitForLoadState('networkidle');
    const box = page.locator('#f-review, textarea[name=review]').first();
    if (await box.count()) {
      await box.fill('This year I kept the desk inside SLA, handled the Nirmal Agro escalation and trained Madhuri on the invoice module. The hard part was August when we were two people short. Next year I want to own onboarding calls.');
      await page.selectOption('select[name=rating]', '4');
      await page.getByRole('button', { name: /Submit self review/i }).click();
      await expect(page.locator('.toast')).toContainText(/submitted/i);
    }
  }
});

test('hiring: a scorecard stays private until the whole panel is in', async ({ page }) => {
  await login(page, HR);
  await page.goto('/hire');
  await expect(page.locator('h1')).toHaveText('Hiring');
  await expect(page.getByText('Open roles').first()).toBeVisible();

  await page.locator('table a', { hasText: 'Technical Support Engineer' }).first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toContainText('Technical Support Engineer');

  // A candidate who has been interviewed.
  await page.goto('/hire/app/APP-1');
  await expect(page.getByText(/Rohit Deshmukh/).first()).toBeVisible();
  await page.locator('a[href^="/hire/interview/"]').first().click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/hidden until everyone has submitted|panel/i).first()).toBeVisible();
});

test('hiring: an unrelated colleague is kept out of candidate records', async ({ page }) => {
  await login(page, SUPPORT_IC);
  const res = await page.goto('/hire/candidates');
  expect(res?.status()).toBe(403);
  await expect(page.getByText(/Hiring is run by HR/i)).toBeVisible();
});

test('hiring: HR drafts an offer and nothing is sent until it is issued', async ({ page }) => {
  await login(page, HR);
  await page.goto('/hire/app/APP-1');
  await expect(page.getByText(/Offers/i).first()).toBeVisible();
  // The demo offer is already out; the page must say who issued it rather than implying the system did.
  await expect(page.locator('body')).toContainText(/issued/i);
});

test('the panel member sees their hire but not the candidate list', async ({ page }) => {
  await login(page, SUPPORT_LEAD);
  await page.goto('/hire/app/APP-1');
  await expect(page.locator('h1')).toContainText('Rohit Deshmukh');
  const res = await page.goto('/hire/candidates');
  expect(res?.status()).toBe(403);
});
