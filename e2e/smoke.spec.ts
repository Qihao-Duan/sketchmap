import { expect, test } from '@playwright/test';
import { makeZip } from '../src/test/zipFixture';
import { PNG_2x2 } from './fixtures/pixel';
import { openNewMap } from './helpers';

// The same sandbox Notion puts on a generic /embed iframe (observed on a public notion.site page, 2026-11-12).
const NOTION_SANDBOX =
  'allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-storage-access-by-user-activation allow-popups-to-escape-sandbox';

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

test('create a map, edit it, reload it, and see it inside a Notion-like embed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  const id = page.url().split('/e/')[1];
  await expect(page.locator('g.topic')).toHaveCount(1);

  await page.locator('svg[aria-label="Mind map"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  await page.keyboard.type('First idea');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('中文也可以');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(3);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.locator('g.topic')).toHaveCount(3);
  await expect(page.locator('g.topic text', { hasText: '中文也可以' })).toBeVisible();

  await page.setContent(
    `<iframe src="http://localhost:5173/m/${id}" sandbox="${NOTION_SANDBOX}" style="width:900px;height:500px;border:0"></iframe>`,
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('g.topic')).toHaveCount(3);
  await expect(frame.getByText('View only')).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Edit in a tab ↗' })).toHaveAttribute('target', '_blank');
});

test('PNG export draws with the embedded hand-drawn fonts', async ({ page }) => {
  await page.goto('/');
  const differ = await page.evaluate(`(async () => {
    const io = await import('/src/io/exportImage.ts');
    const { computeLayout } = await import('/src/layout/map.ts');
    const measure = (t, s) => t.length * s * 0.6;
    const layout = computeLayout({ id: 'r', text: 'Handwriting 中文', children: [] }, measure);
    const withFonts = await io.buildSvg(layout, io.visibleText(layout));
    const withoutFonts = withFonts.replace(/<style>[\\s\\S]*?<\\/style>/, '<style></style>');
    const toDataUrl = (blob) => new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(blob);
    });
    const a = await toDataUrl(await io.svgToPng(withFonts));
    const b = await toDataUrl(await io.svgToPng(withoutFonts));
    return a !== b;
  })()`);
  expect(differ).toBe(true);
});

test('the org chart and a pasted outline survive a reload and show in the view', async ({ page }) => {
  const id = await openNewMap(page);
  await page.getByRole('button', { name: 'Org chart' }).click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', '- Alpha\n  - Alpha 1\n- Beta');
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('g.topic')).toHaveCount(4);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Org chart' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('g.topic')).toHaveCount(4);

  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(4);
  // Read all three positions in one synchronous snapshot: a refit after the fonts load cannot land between them.
  const top = await page.evaluate(() => {
    const y = (label: string) =>
      [...document.querySelectorAll('svg text')].find((e) => e.textContent === label)!.getBoundingClientRect().y;
    return { root: y('Central topic'), alpha: y('Alpha'), alpha1: y('Alpha 1'), beta: y('Beta') };
  });
  // In the mind-map layout all four sit on about one line (Alpha right, Beta left, Alpha 1 beside Alpha).
  expect(top.alpha - top.root).toBeGreaterThan(40); // first level below the root (org: ~170 px, mind map: ~6 px)
  expect(top.alpha1 - top.alpha).toBeGreaterThan(40); // stacked under its parent (org: ~77 px)
  expect(Math.abs(top.alpha - top.beta)).toBeLessThan(2); // first level shares a row
});

test('importance, priority, marker and note survive a reload and show in the view', async ({ page }) => {
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);
  await page.getByRole('button', { name: 'Key', exact: true }).click();
  await page.keyboard.press('Alt+Digit2');
  await page.getByRole('button', { name: 'Marker 💡' }).click();
  await page.getByLabel('Note').fill('Remember this');
  await page.getByLabel('Note').blur();
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  const check = async () => {
    const alpha = page.locator('g.topic', { has: page.locator('text', { hasText: '💡 Alpha' }) });
    await expect(alpha).toHaveCount(1);
    await expect(alpha.locator('g.badge text')).toHaveText('2');
    await expect(alpha.locator('g.note-icon title')).toHaveText('Remember this');
    await expect(alpha.locator('text[stroke]').first()).toBeAttached(); // Key text is outlined
  };
  await page.reload();
  await check();
  await page.goto(`/m/${id}`);
  await check();
});

test('a link made with Cmd/Ctrl K survives a reload and opens from the view', async ({ page, context }) => {
  await context.route('https://example.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/plain' }));
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Read the docs');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('example.com/docs');
  await page.keyboard.press('Enter'); // applies the link
  await page.keyboard.press('Enter'); // commits the topic
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.locator('g.topic a', { hasText: 'docs' })).toHaveAttribute('href', 'https://example.com/docs');
  await page.goto(`/m/${id}`);
  const popup = context.waitForEvent('page');
  await page.locator('g.topic a', { hasText: 'docs' }).click();
  await (await popup).waitForURL('https://example.com/docs');
  await expect(page).toHaveURL(new RegExp(`/m/${id}$`)); // opened in a new tab; the view itself did not navigate
});

test('drag-to-move finds its drop target in a real browser (O1)', async ({ page }) => {
  await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.locator('g.topic', { has: page.locator('text', { hasText: 'Central topic' }) }).click();
  await page.keyboard.press('Tab');
  await page.keyboard.type('Beta');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(3);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  const alpha = page.locator('g.topic', { has: page.locator('text', { hasText: 'Alpha' }) });
  const beta = page.locator('g.topic', { has: page.locator('text', { hasText: 'Beta' }) });
  const alphaBox = (await alpha.boundingBox())!;
  const betaBox = (await beta.boundingBox())!;
  const start = { x: betaBox.x + betaBox.width / 2, y: betaBox.y + betaBox.height / 2 };
  const end = { x: alphaBox.x + alphaBox.width / 2, y: alphaBox.y + alphaBox.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
  }
  await page.mouse.up();
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Outline' }).click();
  const outline = await page.locator('textarea[aria-label="Outline text"]').inputValue();
  expect(outline).toMatch(/- Alpha\n {2}- Beta\n/);
});

test('the editor box fits a long link, and the link field sits below it (I1)', async ({ page }) => {
  await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Read [the design spec](https://docs.example.com/superpowers/specs/2026-11-12-sketchmap-design.md) today');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.keyboard.press('F2'); // reopen the editor on the same (selected) topic
  const ta = page.locator('textarea.inline-editor');
  await expect(ta).toBeVisible();
  const fits = await ta.evaluate((el: HTMLTextAreaElement) => el.scrollHeight <= el.clientHeight + 1);
  expect(fits).toBe(true);

  await page.keyboard.press('ControlOrMeta+k');
  const field = page.locator('input[aria-label="Link URL"]');
  await expect(field).toBeVisible();
  const [fieldTop, taBottom] = await Promise.all([
    field.evaluate((el) => el.getBoundingClientRect().top),
    ta.evaluate((el) => el.getBoundingClientRect().bottom),
  ]);
  expect(fieldTop).toBeGreaterThanOrEqual(taBottom);
});

test('a link opens from inside a Notion-sandboxed iframe (pins allow-popups)', async ({ page, context }) => {
  await context.route('https://example.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/plain' }));
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Read the docs');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('example.com/docs');
  await page.keyboard.press('Enter'); // applies the link
  await page.keyboard.press('Enter'); // commits the topic
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.setContent(
    `<iframe src="http://localhost:5173/m/${id}" sandbox="${NOTION_SANDBOX}" style="width:900px;height:500px;border:0"></iframe>`,
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('g.topic')).toHaveCount(2);
  const popup = context.waitForEvent('page');
  await frame.locator('g.topic a', { hasText: 'docs' }).click();
  await (await popup).waitForURL('https://example.com/docs');
});

test('an .xmind file imports as a new map, with links, notes and priority, and shows in the view', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  const xmind = await makeZip([{ name: 'content.json', data: JSON.stringify([{
    id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Imported trip', structureClass: 'org.xmind.ui.logic.right', children: { attached: [
      { id: 'a', title: 'Booking', href: 'https://example.com/book', markers: [{ markerId: 'priority-2' }], notes: { plain: { content: 'Ask about breakfast' } } },
      { id: 'b', title: 'Packing', branch: 'folded', children: { attached: [{ id: 'b1', title: 'Socks' }] } },
    ] } },
  }]) }]);
  await page.locator('input[aria-label="XMind file"]').setInputFiles({ name: 'trip.xmind', mimeType: 'application/octet-stream', buffer: Buffer.from(xmind) });
  await expect(page.locator('.import-result')).toContainText('4 topics');
  await page.locator('.import-result a').click();
  await page.waitForURL(/\/e\//);
  await expect(page.getByRole('button', { name: 'Logic chart' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('g.topic')).toHaveCount(3); // Socks is folded away
  await expect(page.locator('g.topic a', { hasText: 'Booking' })).toHaveAttribute('href', 'https://example.com/book');
  await expect(page.locator('g.topic g.badge text')).toHaveText('2');
  await expect(page.locator('g.topic g.note-icon title')).toHaveText('Ask about breakfast');
  const id = page.url().split('/e/')[1];
  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(3);
});

test('an image added from the details panel survives a reload, shows in the view and is inlined in the SVG export; deleting the map deletes it', async ({ page }) => {
  const id = await openNewMap(page);

  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_2x2 });

  const image = page.locator('image.topic-image');
  await expect(image).toHaveCount(1);
  const href = (await image.getAttribute('href'))!;
  expect(href).toMatch(/^\/img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{10}\.(png|jpg)$/);
  expect(href).not.toContain(id); // the folder is random, not the map id
  expect(href).toMatch(/\.png$/); // the pixel has transparency, so it stays PNG

  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('image.topic-image')).toHaveAttribute('href', href);

  const fetched = await page.request.get(href);
  expect(fetched.status()).toBe(200);
  expect(fetched.headers()['content-type']).toBe('image/png');

  await page.goto(`/m/${id}`);
  await expect(page.locator('image.topic-image')).toBeVisible();

  await page.goto(`/e/${id}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG' }).click();
  const stream = (await (await download).createReadStream())!;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const svg = Buffer.concat(chunks).toString('utf-8');
  expect(svg).toContain('data:image/png;base64,');

  await page.goto('/');
  const row = page.locator('li').filter({ has: page.locator(`a[href="/e/${id}"]`) });
  await row.getByRole('button', { name: 'Delete…' }).click();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0); // the delete request has finished and the list refreshed

  const afterDelete = await page.request.get(href);
  expect(afterDelete.status()).toBe(404);
});

test('an SVG image is drawn into a PNG, in the browser, and any script it carries never runs', async ({ page }) => {
  await openNewMap(page);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/><script>document.title=\'pwned\'</script></svg>';
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) });

  const image = page.locator('image.topic-image');
  await expect(image).toHaveCount(1);
  const href = (await image.getAttribute('href'))!;
  expect(href).toMatch(/\.png$/); // SVG goes in; only a PNG comes out and is stored

  expect(await page.title()).not.toBe('pwned'); // drawn through an <img>, so the <script> inside never ran
});

test('the Excalidraw export downloads a scene with the topics, their text and the image file', async ({ page }) => {
  await openNewMap(page);
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_2x2 });
  await expect(page.locator('image.topic-image')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excalidraw' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.excalidraw$/);
  const chunks: Buffer[] = [];
  for await (const chunk of (await file.createReadStream())!) chunks.push(chunk as Buffer);
  const scene = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

  expect(scene.type).toBe('excalidraw');
  const texts = scene.elements.filter((e: { type: string }) => e.type === 'text').map((e: { text: string }) => e.text);
  expect(texts).toContain('Alpha');
  expect(scene.elements.some((e: { type: string; fontFamily?: number }) => e.type === 'text' && e.fontFamily !== 5)).toBe(false);
  const image = scene.elements.find((e: { type: string }) => e.type === 'image');
  expect(scene.files[image.fileId].dataURL).toMatch(/^data:image\/png;base64,/);
  // Measured with the real Excalifont in a real browser: the text has a real width.
  expect(scene.elements.find((e: { text?: string }) => e.text === 'Alpha').width).toBeGreaterThan(20);
});

test('in dark mode a topic image keeps its colours while the drawing is inverted', async ({ page }) => {
  await openNewMap(page);
  // Saturated stripes: the colours a counter-filter can't bring back.
  const COLS = ['#e03131', '#2f9e44', '#1971c2', '#fcc419', '#c2255c', '#15aabf'];
  const png = await page.evaluate((cols) => {
    const c = document.createElement('canvas'); c.width = cols.length * 40; c.height = 40;
    const g = c.getContext('2d')!; cols.forEach((col, i) => { g.fillStyle = col; g.fillRect(i * 40, 0, 40, 40); });
    return c.toDataURL('image/png').split(',')[1];
  }, COLS);
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const image = page.locator('image.topic-image');
  await expect(image).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit' }).click();

  const sample = async () => {
    const box = (await image.boundingBox())!;
    const shot = (await page.screenshot()).toString('base64');
    return page.evaluate(async ({ shot, box, n }) => {
      const img = new Image(); img.src = `data:image/png;base64,${shot}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
      const k = img.width / innerWidth;
      return Array.from({ length: n }, (_, i) => [...g.getImageData(Math.round((box.x + box.width * (i + 0.5) / n) * k), Math.round((box.y + box.height / 2) * k), 1, 1).data].slice(0, 3));
    }, { shot, box, n: COLS.length });
  };
  await page.emulateMedia({ colorScheme: 'light' });
  const light = await sample();
  // The samples are the source stripes themselves, not just "unaffected by the filter": catches a
  // regression where the photo layer draws the right pixels but at the wrong place or scale.
  for (let i = 0; i < COLS.length; i++) {
    const rgb = hexToRgb(COLS[i]);
    for (let ch = 0; ch < 3; ch++) expect(Math.abs(light[i][ch] - rgb[ch])).toBeLessThanOrEqual(20);
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter)).toContain('invert');
  const dark = await sample();
  for (let i = 0; i < COLS.length; i++) {
    for (let ch = 0; ch < 3; ch++) expect(Math.abs(dark[i][ch] - light[i][ch])).toBeLessThanOrEqual(3);
  }

  // Pan and zoom, then check the photo and its (filtered) frame are still aligned: the frame's
  // sketchy stroke has a little width, so a few pixels of slack.
  await page.mouse.move(20, 20); // the empty canvas, well clear of the fitted topic (56 px pad)
  await page.mouse.down();
  await page.mouse.move(150, 130, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Zoom in' }).click();

  const imageBox = (await image.boundingBox())!;
  const frameBox = (await page.locator('svg.frames g.topic-frame').boundingBox())!;
  expect(imageBox.x).toBeGreaterThanOrEqual(frameBox.x - 3);
  expect(imageBox.y).toBeGreaterThanOrEqual(frameBox.y - 3);
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 3);
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height + 3);
});

test('?theme= forces the embed light or dark, whatever the system says', async ({ page }) => {
  const id = await openNewMap(page);
  const filter = () => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter);
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // Set server-side (the Worker rewrites the served HTML), so there's no flash of the system theme.
  expect(await (await page.request.get(`/m/${id}?theme=dark`)).text()).toContain('data-theme="dark"');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/m/${id}?theme=dark`);
  await expect(page.locator('g.topic')).toHaveCount(1);
  expect(await filter()).toContain('invert');
  expect(await paper()).toBe('rgb(21, 21, 23)');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/m/${id}?theme=light`);
  await expect(page.locator('g.topic')).toHaveCount(1);
  expect(await filter()).toBe('none');
  expect(await paper()).toBe('rgb(251, 250, 246)');

  await page.goto(`/m/${id}`); // no override: follows the (dark) system
  await expect(page.locator('g.topic')).toHaveCount(1);
  expect(await filter()).toContain('invert');
});
