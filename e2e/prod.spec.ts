import { expect, test } from '@playwright/test';
import { makeZip } from '../src/test/zipFixture';
import { PNG_2x2 } from './fixtures/pixel';
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

  // An uploaded image is served from /img/…, drawn with a same-origin <image href>, and inlined for
  // export by fetching that same path: img-src 'self' data: blob: and connect-src 'self' both cover it.
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_2x2 });
  await expect(page.locator('image.topic-image')).toHaveCount(1);
  expect(violations).toEqual([]);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);

  // The pinned Excalidraw library loads as a separate same-origin chunk and runs under script-src 'self'.
  const excalidraw = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excalidraw' }).click();
  expect((await excalidraw).suggestedFilename()).toMatch(/\.excalidraw$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
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

  // Hashed bundles and font subsets are kept for a year; pages are always fetched fresh.
  await page.goto('/');
  const script = (await page.locator('script[type="module"][src]').first().getAttribute('src'))!;
  expect((await page.request.get(script)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  // The list page is loaded lazily, and its hand-drawn heading asks for the font only once it is drawn.
  await expect(page.getByRole('heading', { name: 'Your maps' })).toBeVisible();
  const fontPath = () =>
    page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).find((p) => p.startsWith('/fonts/')) ?? null);
  await expect.poll(fontPath).not.toBeNull();
  const font = (await fontPath())!;
  const first = await page.request.get(font);
  expect(first.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  // A browser that stored the font earlier revalidates it: the 304 answer carries the long lifetime too.
  const again = await page.request.get(font, { headers: { 'If-None-Match': first.headers()['etag'] } });
  expect(again.status()).toBe(304);
  expect(again.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await page.request.get('/')).headers()['cache-control'] ?? '').not.toContain('immutable');
});
