import { expect, type Page } from '@playwright/test';

/** On the sign-in page: gets in with the owner key. */
export async function enterOwnerKey(page: Page): Promise<void> {
  // Where the server offers Google sign-in, the owner key sits behind "Use the owner key instead".
  const keyField = page.getByLabel('Owner key');
  const viaKey = page.getByText('Use the owner key instead');
  await expect(keyField.or(viaKey).first()).toBeVisible();
  if (await viaKey.isVisible()) await viaKey.click();
  await keyField.fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function openNewMap(page: Page): Promise<string> {
  await page.goto('/');
  await enterOwnerKey(page);
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  await expect(page.locator('g.topic')).toHaveCount(1);
  return page.url().split('/e/')[1];
}
