import { expect, test } from '@playwright/test';
import { makeZip } from '../src/test/zipFixture';
import { openNewMap } from './helpers';

test('the production build works under its strict CSP: editor, PNG export and view', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => {
    if (m.text().startsWith('CSP violation')) violations.push(m.text());
  });

  const res = await page.goto('/');
  expect(res!.headers()['content-security-policy']).toContain("script-src 'self';");
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(2);
  expect(violations).toEqual([]);

  // Import a small .xmind through the list page, still under the same strict CSP (the owner key is already set).
  await page.goto('/');
  const xmind = await makeZip([{ name: 'content.json', deflate: true, data: JSON.stringify([
    { id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Imported', children: { attached: [{ id: 'a', title: 'Child' }] } } },
  ]) }]);
  await page.locator('input[aria-label="XMind file"]').setInputFiles({ name: 'small.xmind', mimeType: 'application/octet-stream', buffer: Buffer.from(xmind) });
  await expect(page.locator('.import-result')).toBeVisible();
  expect(violations).toEqual([]);
});
