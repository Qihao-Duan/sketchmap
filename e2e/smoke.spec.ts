import { expect, test, type Page } from '@playwright/test';

// The same sandbox Notion puts on a generic /embed iframe (observed on a public notion.site page, 2026-11-12).
const NOTION_SANDBOX =
  'allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-storage-access-by-user-activation allow-popups-to-escape-sandbox';

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

async function openNewMap(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  await expect(page.locator('g.topic')).toHaveCount(1);
  return page.url().split('/e/')[1];
}

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
