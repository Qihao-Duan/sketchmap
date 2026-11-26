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

  // The image's corner can be dragged in the built app too: its handle is placed by the built CSS, and
  // the picture is loaded once more, to read its proportions, without breaking the CSP.
  await expect(page.locator('image.topic-image')).toHaveAttribute('width', '200');
  const grip = (await page.locator('.image-handle').boundingBox())!;
  expect(grip.width).toBe(22);
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 50, grip.y + grip.height / 2 + 50, { steps: 5 });
  await expect(page.locator('.size-box')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('image.topic-image')).not.toHaveAttribute('width', '200');
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

// On this server only: the site theme is shared by every page, and the dev server runs three browsers at once.
test('the theme picker sets the look of the whole site: the list, the editor and the Notion embed', async ({ page, browser }) => {
  const DARK = 'rgb(21, 21, 23)';
  const LIGHT = 'rgb(251, 250, 246)';
  const paper = (p = page) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const theme = page.getByRole('group', { name: 'Theme' });
  const pressed = theme.locator('button[aria-pressed="true"]');
  /** Clicks a theme button and waits for the server to answer the save. */
  const pick = async (label: string) => {
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings') && r.request().method() === 'PUT');
    await theme.getByRole('button', { name: label }).click();
    expect((await saved).status()).toBe(200);
  };
  try {
    await page.emulateMedia({ colorScheme: 'light' });
    const id = await openNewMap(page);
    await expect(pressed).toHaveText('Light');
    expect(await paper()).toBe(LIGHT);

    // Picked in the editor: the page turns dark, and the choice is saved for the whole site.
    await pick('Dark');
    expect(await paper()).toBe(DARK);
    await expect(page.getByRole('alert')).toHaveCount(0);
    // The click left the keyboard with the map: Tab still adds a topic.
    await page.keyboard.press('Tab');
    await page.keyboard.type('Beta');
    await page.keyboard.press('Enter');
    await expect(page.locator('g.topic')).toHaveCount(2);
    await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

    // Back to the list page, which was loaded while the site was still light: it shows the new setting.
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Your maps' })).toBeVisible();
    await expect(pressed).toHaveText('Dark');
    expect(await paper()).toBe(DARK);
    await page.goForward();
    await expect(page.locator('g.topic')).toHaveCount(2);

    // Another browser with a light system and no key, as a Notion viewer: the embed is dark in the HTML itself.
    const viewerContext = await browser.newContext({ colorScheme: 'light' });
    const viewer = await viewerContext.newPage();
    const res = await viewer.goto(`/m/${id}`);
    expect(await res!.text()).toContain('data-theme="dark"');
    await expect(viewer.locator('g.topic')).toHaveCount(2);
    expect(await paper(viewer)).toBe(DARK);
    // A link's ?theme= still wins.
    await viewer.goto(`/m/${id}?theme=light`);
    expect(await paper(viewer)).toBe(LIGHT);

    // On the list page the picker shows the saved choice; "System" hands the look to each viewer's system.
    await page.goto('/');
    await expect(pressed).toHaveText('Dark');
    expect(await paper()).toBe(DARK);
    await pick('System');
    expect(await paper()).toBe(LIGHT); // this page's system is light
    await viewer.emulateMedia({ colorScheme: 'dark' });
    await viewer.goto(`/m/${id}`);
    await expect(viewer.locator('g.topic')).toHaveCount(2);
    expect(await paper(viewer)).toBe(DARK);
    await viewer.emulateMedia({ colorScheme: 'light' });
    expect(await paper(viewer)).toBe(LIGHT);
    await viewerContext.close();

    // Back to Light, and a reload keeps it.
    await pick('Light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(pressed).toHaveText('Light');
    expect(await paper()).toBe(LIGHT);
  } finally {
    await page.request.put('/api/settings', { headers: { Authorization: 'Bearer dev-owner-key' }, data: { theme: 'light' } });
  }
});
