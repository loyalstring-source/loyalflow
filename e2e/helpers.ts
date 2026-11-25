import type { Page } from 'playwright/test';

export const PASSWORD = 'Welcome@LoyalFlow1';
export const COO = 'sridhar.ngowda@loyalstring.com';
export const SUPPORT_LEAD = 'prasad.panchal@loyalstring.com';
export const SUPPORT_IC = 'nikita.kakade@loyalstring.com';
export const BDM = 'alpesh.boda@loyalstring.com';
export const PRODUCTION_LEAD = 'lukman.nishad@loyalstring.com';
export const HR = 'amruta.junnarkar@loyalstring.com';
export const DEV_LEAD = 'shubham.bherde@loyalstring.com';

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.fill('#f-email', email);
  await page.fill('#f-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/(\?pw=1)?$/);
}
