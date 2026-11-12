import { expect, type Page } from '@playwright/test';

export async function openNewMap(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  await expect(page.locator('g.topic')).toHaveCount(1);
  return page.url().split('/e/')[1];
}
