import { expect, test } from '@playwright/test';
import { makeZip } from '../src/test/zipFixture';
import { PNG_2x2 } from './fixtures/pixel';
import { seal, SESSION_COOKIE } from '../worker/session';
import { enterOwnerKey, openNewMap } from './helpers';

// The same sandbox Notion puts on a generic /embed iframe (observed on a public notion.site page, 2026-11-12).
const NOTION_SANDBOX =
  'allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-storage-access-by-user-activation allow-popups-to-escape-sandbox';

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

test('create a map, edit it, reload it, and see it inside a Notion-like embed', async ({ page, baseURL }) => {
  await page.goto('/');
  await enterOwnerKey(page);
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
    `<iframe src="${baseURL}/m/${id}" sandbox="${NOTION_SANDBOX}" style="width:900px;height:500px;border:0"></iframe>`,
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
    // Firefox's ClipboardEvent constructor ignores `clipboardData`, so it is attached as a property instead.
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: data });
    window.dispatchEvent(paste);
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

  // In the view a click on the note icon opens the whole note in a card; Escape puts it away.
  await page.locator('g.note-icon').click();
  const card = page.locator('.note-card');
  await expect(card.locator('.note-text')).toHaveText('Remember this');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);

  // The card stays with its icon when the map moves without a press (zooming with ⌘/Ctrl and the wheel; the
  // map is also refitted when the fonts arrive or the page is resized). A press anywhere else closes it.
  await page.locator('g.note-icon').click();
  const iconBox = async () => (await page.locator('g.note-icon').boundingBox())!;
  const placed = async () => {
    const [i, c] = [await iconBox(), (await card.boundingBox())!];
    return { dx: c.x - i.x, dy: c.y - (i.y + i.height) };
  };
  const start = await placed();
  const iconBefore = await iconBox();
  // A small zoom around a point left of the icon: the icon moves right a little but stays on the page.
  await page.mouse.move(iconBefore.x - 120, iconBefore.y);
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.wheel(0, -20);
  await page.keyboard.up('ControlOrMeta');
  await expect.poll(async () => (await iconBox()).x).not.toBeCloseTo(iconBefore.x, 0);
  await expect(card).toBeVisible();
  const end = await placed();
  expect(Math.abs(end.dx - start.dx)).toBeLessThan(2);
  expect(Math.abs(end.dy - start.dy)).toBeLessThan(2);
  await page.mouse.click(20, 400);
  await expect(card).toHaveCount(0);
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 700 } });

  test('a tap on the note icon in the view shows the note, and a tap elsewhere puts it away', async ({ page }) => {
    const id = await openNewMap(page);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Alpha');
    await page.keyboard.press('Enter');
    await expect(page.locator('g.topic')).toHaveCount(2);
    // The Details panel starts folded on a screen this narrow.
    const details = page.getByRole('button', { name: 'Show topic details' });
    if (await details.isVisible()) await details.click();
    const note = 'Gate B12, boards at 9:40. Bring the printed ticket and the passport; the desk closes forty minutes before.';
    await page.getByLabel('Note').fill(note);
    await page.getByLabel('Note').blur();
    // The badge can still read "Saved" from the save before, so ask the server whether the note has arrived.
    await expect
      .poll(async () => (await (await page.request.get(`/api/maps/${id}`)).json()).root.children[0]?.note, { timeout: 10_000 })
      .toBe(note);

    await page.goto(`/m/${id}`);
    // The map is redrawn and refitted once its fonts arrive: read the icon's place after that has settled.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const iconRect = page.locator('g.note-icon rect');
    let icon = (await iconRect.boundingBox())!;
    await expect
      .poll(async () => {
        const now = await iconRect.boundingBox();
        const same = !!now && !!icon && Math.abs(now.x - icon.x) < 0.5 && Math.abs(now.y - icon.y) < 0.5;
        if (now) icon = now;
        return same;
      })
      .toBe(true);
    await page.touchscreen.tap(icon.x + icon.width / 2, icon.y + icon.height / 2);
    const card = page.locator('.note-card');
    await expect(card.locator('.note-text')).toHaveText(note);
    // The icon sits near the right edge of this narrow page. The card is still full width (320 px, the most
    // it takes), not squeezed into the space right of the icon, and stays inside the page with 8 px to spare.
    const box = (await card.boundingBox())!;
    expect(icon.x).toBeGreaterThan(250);
    expect(box.width).toBeGreaterThanOrEqual(319);
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 7);
    expect(box.y + box.height).toBeLessThanOrEqual(700 - 7);
    await page.touchscreen.tap(20, 680);
    await expect(card).toHaveCount(0);
  });
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

/** Adds main branches with these names to a new map, one below the other. */
async function addMainBranches(page: import('@playwright/test').Page, names: string[]): Promise<void> {
  await page.keyboard.press('Tab');
  for (const [i, name] of names.entries()) {
    if (i > 0) await page.keyboard.press('Enter'); // a new sibling below
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('g.topic')).toHaveCount(names.length + 1);
}

test('a topic dragged to the edge of another one goes next to it, and ⌘/Ctrl ↑ ↓ move it among its siblings', async ({ page }) => {
  await openNewMap(page);
  const names = ['Alpha', 'Beta', 'Gamma'];
  await addMainBranches(page, names);
  await page.getByRole('button', { name: 'Logic chart' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  const box = async (text: string) => (await page.locator('g.topic', { has: page.locator('text', { hasText: text }) }).locator('rect.hit').boundingBox())!;
  /** The branches from top to bottom, as drawn. */
  const fromTop = async () => {
    const ys = new Map<string, number>();
    for (const name of names) ys.set(name, (await box(name)).y);
    return [...names].sort((p, q) => ys.get(p)! - ys.get(q)!);
  };
  expect(await fromTop()).toEqual(['Alpha', 'Beta', 'Gamma']);

  // Drag Gamma to the top edge of Alpha: a line shows the place, and Alpha is not marked as a new parent.
  const [alpha, gamma] = [await box('Alpha'), await box('Gamma')];
  const end = { x: alpha.x + alpha.width / 2, y: alpha.y + alpha.height * 0.15 };
  await page.mouse.move(gamma.x + gamma.width / 2, gamma.y + gamma.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(page.locator('g.drop-line line')).toHaveCount(1);
  await expect(page.locator('g.topic.drop')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('g.drop-line line')).toHaveCount(0);
  await expect.poll(fromTop).toEqual(['Gamma', 'Alpha', 'Beta']);

  // Gamma is still the selected topic: the keys move it one place at a time, and stop at the end.
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect.poll(fromTop).toEqual(['Alpha', 'Gamma', 'Beta']);
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await page.keyboard.press('ControlOrMeta+ArrowDown');
  await expect.poll(fromTop).toEqual(['Alpha', 'Beta', 'Gamma']);
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  await expect.poll(fromTop).toEqual(['Alpha', 'Gamma', 'Beta']);
  // ⌘/Ctrl ← does nothing in a logic chart, and does not take the browser back either.
  await page.keyboard.press('ControlOrMeta+ArrowLeft');
  await expect(page).toHaveURL(/\/e\//);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(fromTop).toEqual(['Alpha', 'Beta', 'Gamma']);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(fromTop).toEqual(['Alpha', 'Gamma', 'Beta']);

  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('g.topic')).toHaveCount(4);
  expect(await fromTop()).toEqual(['Alpha', 'Gamma', 'Beta']);
  await page.getByRole('button', { name: 'Outline' }).click();
  expect(await page.locator('textarea[aria-label="Outline text"]').inputValue()).toMatch(/- Alpha\n- Gamma\n- Beta\n/);
});

test('map layout: a main branch put on the other side of the central topic stays there, also after a reload and in the view', async ({ page }) => {
  const id = await openNewMap(page);
  await addMainBranches(page, ['Alpha', 'Beta', 'Gamma', 'Delta']);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  const box = async (text: string) => (await page.locator('g.topic', { has: page.locator('text', { hasText: text }) }).locator('rect.hit').boundingBox())!;
  /** Which side of the central topic each branch is on. */
  const sides = async () => {
    const root = await box('Central topic');
    const out: Record<string, string> = {};
    for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) out[name] = (await box(name)).x < root.x ? 'left' : 'right';
    return out;
  };
  // Balanced automatically: the first two on the right, the rest on the left.
  expect(await sides()).toEqual({ Alpha: 'right', Beta: 'right', Gamma: 'left', Delta: 'left' });

  // Drop Alpha on the left half of the central topic.
  const [alpha, root] = [await box('Alpha'), await box('Central topic')];
  await page.mouse.move(alpha.x + alpha.width / 2, alpha.y + alpha.height / 2);
  await page.mouse.down();
  await page.mouse.move(root.x + root.width * 0.25, root.y + root.height / 2, { steps: 10 });
  await expect(page.locator('g.topic.drop')).toHaveCount(1);
  await page.mouse.up();
  // Alpha is on the left now, and Beta did not follow it or get company: the sides are fixed.
  await expect.poll(sides).toEqual({ Alpha: 'left', Beta: 'right', Gamma: 'left', Delta: 'left' });

  // The keys do the same: → takes the selected branch (Alpha) back to the right, ← to the left again.
  await page.keyboard.press('ControlOrMeta+ArrowRight');
  await expect.poll(sides).toEqual({ Alpha: 'right', Beta: 'right', Gamma: 'left', Delta: 'left' });
  await page.keyboard.press('ControlOrMeta+ArrowLeft');
  await expect.poll(sides).toEqual({ Alpha: 'left', Beta: 'right', Gamma: 'left', Delta: 'left' });
  await expect(page).toHaveURL(/\/e\//); // ⌘← moved the branch, not the browser

  // A new branch made next to Beta stays on Beta's side.
  await page.locator('g.topic', { has: page.locator('text', { hasText: 'Beta' }) }).click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Epsilon');
  await page.keyboard.press('Enter');
  const epsilonSide = async () => ((await box('Epsilon')).x < (await box('Central topic')).x ? 'left' : 'right');
  await expect.poll(epsilonSide).toBe('right');

  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('g.topic')).toHaveCount(6);
  expect(await sides()).toEqual({ Alpha: 'left', Beta: 'right', Gamma: 'left', Delta: 'left' });
  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(6);
  expect(await sides()).toEqual({ Alpha: 'left', Beta: 'right', Gamma: 'left', Delta: 'left' });
  expect(await epsilonSide()).toBe('right');
});

test('the left button drags a selection box over several topics; the right button moves the canvas', async ({ page }) => {
  await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(3);
  // Logic chart: both topics sit to the right of the central one, with clear background around them.
  await page.getByRole('button', { name: 'Logic chart' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  const box = async (text: string) => (await page.locator('g.topic', { has: page.locator('text', { hasText: text }) }).locator('rect.hit').boundingBox())!;
  const [a, b] = [await box('Alpha'), await box('Beta')];
  const from = { x: Math.min(a.x, b.x) - 14, y: Math.min(a.y, b.y) - 14 };
  const to = { x: Math.max(a.x + a.width, b.x + b.width) + 14, y: Math.max(a.y + a.height, b.y + b.height) + 14 };
  // The drag starts on the bare canvas, not on a topic or a panel.
  expect(await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return !!el?.closest('svg[role="img"]') && !el.closest('g.topic');
  }, from)).toBe(true);
  const central = await box('Central topic');

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await expect(page.locator('.select-box')).toBeVisible();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.select-box')).toBeHidden();
  await expect(page.locator('g.topic.selected')).toHaveCount(2);
  await expect(page.locator('[aria-label="Topic details"] h2')).toHaveText('2 topics selected');
  expect(await box('Central topic')).toEqual(central); // the canvas stayed where it was

  // One change reaches both, one Delete removes both, and one undo brings both back.
  await page.keyboard.press('Alt+1');
  await expect(page.locator('g.topic g.badge')).toHaveCount(2);
  await page.keyboard.press('Delete');
  await expect(page.locator('g.topic')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('g.topic')).toHaveCount(3);

  // The right button moves the canvas, even when the drag starts on a topic, and moves no topic.
  const before = await box('Central topic');
  const grab = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(grab.x + 90, grab.y + 40, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  const after = await box('Central topic');
  expect(Math.abs(after.x - before.x - 90)).toBeLessThan(1);
  expect(Math.abs(after.y - before.y - 40)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Outline' }).click();
  expect(await page.locator('textarea[aria-label="Outline text"]').inputValue()).toMatch(/^# Central topic\n[\s\S]*- .*Alpha\n- .*Beta\n/); // both still under the central topic, in order
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

test('a link opens from inside a Notion-sandboxed iframe (pins allow-popups)', async ({ page, context, baseURL }) => {
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
    `<iframe src="${baseURL}/m/${id}" sandbox="${NOTION_SANDBOX}" style="width:900px;height:500px;border:0"></iframe>`,
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('g.topic')).toHaveCount(2);
  const popup = context.waitForEvent('page');
  await frame.locator('g.topic a', { hasText: 'docs' }).click();
  await (await popup).waitForURL('https://example.com/docs');
});

test('an .xmind file imports as a new map, with links, notes and priority, and shows in the view', async ({ page }) => {
  await page.goto('/');
  await enterOwnerKey(page);
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

test('an image pasted from the clipboard, or dropped on a topic, lands on that topic', async ({ page }) => {
  await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);
  const ids = await page.locator('g.topic').evaluateAll((els) => els.map((el) => [el.textContent ?? '', el.getAttribute('data-id')!] as const));
  const alpha = ids.find(([text]) => text.includes('Alpha'))![1];
  const root = ids.find(([text]) => !text.includes('Alpha'))![1];

  const send = (kind: 'paste' | 'drop', topicId: string) => page.evaluate(({ kind, topicId, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pic.png', { type: 'image/png' }));
    if (kind === 'paste') {
      const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: data }); // Firefox's constructor ignores it
      window.dispatchEvent(paste);
    } else {
      const hit = document.querySelector(`g.topic[data-id="${topicId}"] rect.hit`)!;
      hit.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, { kind, topicId, b64: PNG_2x2.toString('base64') });

  await send('paste', alpha); // Alpha is the selected topic after Enter
  await expect(page.locator(`image.topic-image[data-id="${alpha}"]`)).toHaveCount(1);
  await send('drop', root); // a drop goes to the topic under it, not to the selection
  await expect(page.locator(`image.topic-image[data-id="${root}"]`)).toHaveCount(1);
  await expect(page.locator('image.topic-image')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an .xmind file with an image imports the image too', async ({ page }) => {
  await page.goto('/');
  await enterOwnerKey(page);
  const xmind = await makeZip([
    { name: 'content.json', data: JSON.stringify([{
      id: 's', class: 'sheet', title: 'S',
      rootTopic: { id: 'r', title: 'With a picture', children: { attached: [{ id: 'a', title: 'Photo', image: { src: 'xap:resources/pic.png' } }] } },
    }]) },
    { name: 'resources/pic.png', data: new Uint8Array(PNG_2x2), deflate: false },
  ]);
  await page.locator('input[aria-label="XMind file"]').setInputFiles({ name: 'pic.xmind', mimeType: 'application/octet-stream', buffer: Buffer.from(xmind) });
  await expect(page.locator('.import-result')).toContainText('2 topics');
  await page.locator('.import-result a').click();
  await page.waitForURL(/\/e\//);
  const image = page.locator('image.topic-image');
  await expect(image).toHaveCount(1);
  const href = (await image.getAttribute('href'))!;
  expect(href).toMatch(/^\/img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{10}\.png$/);
  expect((await page.request.get(href)).status()).toBe(200);
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
  // The look is set on <html> directly: this test is about the dark-mode layers, not about which setting picks dark
  // (the site setting is shared by every test on this server, and changing it is tested in prod.spec.ts).
  const look = (theme: 'light' | 'dark') => page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
  await look('light');
  const light = await sample();
  // The samples are the source stripes themselves, not just "unaffected by the filter": catches a
  // regression where the photo layer draws the right pixels but at the wrong place or scale.
  for (let i = 0; i < COLS.length; i++) {
    const rgb = hexToRgb(COLS[i]);
    for (let ch = 0; ch < 3; ch++) expect(Math.abs(light[i][ch] - rgb[ch])).toBeLessThanOrEqual(20);
  }
  await look('dark');
  await expect.poll(() => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter)).toContain('invert');
  const dark = await sample();
  for (let i = 0; i < COLS.length; i++) {
    for (let ch = 0; ch < 3; ch++) expect(Math.abs(dark[i][ch] - light[i][ch])).toBeLessThanOrEqual(3);
  }

  // Pan and zoom, then check the photo and its (filtered) frame are still aligned: the frame's
  // sketchy stroke has a little width, so a few pixels of slack.
  await page.mouse.move(20, 20); // the right button moves the canvas from anywhere
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(150, 130, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.getByRole('button', { name: 'Zoom in' }).click();

  const imageBox = (await image.boundingBox())!;
  const frameBox = (await page.locator('svg.frames g.topic-frame').boundingBox())!;
  expect(imageBox.x).toBeGreaterThanOrEqual(frameBox.x - 3);
  expect(imageBox.y).toBeGreaterThanOrEqual(frameBox.y - 3);
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(frameBox.x + frameBox.width + 3);
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(frameBox.y + frameBox.height + 3);
});

test('?theme= forces the embed light or dark, whatever the system says; without it the site is light, not the system', async ({ page }) => {
  // Nothing on this server changes the site setting (prod.spec.ts tests the picker on its own server), so it is the default.
  const id = await openNewMap(page);
  const filter = () => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter);
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  // Set server-side (the Worker rewrites the served HTML), so there's no flash of another theme.
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

  await page.goto(`/m/${id}`); // no override, dark system: still light, the site's default
  await expect(page.locator('g.topic')).toHaveCount(1);
  expect(await filter()).toBe('none');
  expect(await paper()).toBe('rgb(251, 250, 246)');
  await page.goto(`/e/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(1);
  expect(await filter()).toBe('none');
});

test('a Google session (no owner key) lists, creates, saves and deletes maps, and signing out ends it', async ({ page, context, baseURL, browserName }) => {
  // Signed out, the page offers Google, and that link really leads to Google with this site's client id.
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Sign in with Google' });
  await expect(link).toHaveAttribute('href', '/auth/google?next=%2F');
  const toGoogle = await page.request.get('/auth/google?next=%2F', { maxRedirects: 0 });
  expect(toGoogle.status()).toBe(302);
  const target = new URL(toGoogle.headers()['location']);
  expect([target.origin, target.searchParams.get('client_id'), target.searchParams.get('redirect_uri')]).toEqual([
    'https://accounts.google.com', 'e2e-client.apps.googleusercontent.com', `${baseURL}/auth/google/callback`,
  ]);

  // Google itself can't be part of a test, so the session it would end in is made here, the way the Worker
  // makes it: sealed with the test server's owner key, for the one account on that server's list.
  const session = await seal({ sub: 'e2e-account', email: 'owner@e2e.example', exp: Math.floor(Date.now() / 1000) + 3600 }, 'dev-owner-key', 'session');
  // Given by host and path, not by address: Chromium refuses to be handed a Secure cookie for an http address,
  // though like the others it then sends it to this local server.
  await context.addCookies([{ name: SESSION_COOKIE, value: session, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your maps' })).toBeVisible();
  await expect(page.locator('.account')).toHaveText('owner@e2e.example');
  expect(await page.evaluate(() => localStorage.getItem('sketchmap:owner-key'))).toBeNull();

  // Every write below carries the cookie and nothing else; the Worker accepts it only from this site's own pages.
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  const id = page.url().split('/e/')[1];
  await expect(page.locator('g.topic')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Signed in');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(page.locator('g.topic')).toHaveCount(2);

  // The same request from another site's page is refused, cookie or not.
  const foreign = await page.request.post('/api/maps', { headers: { Origin: 'https://evil.example' }, data: {} });
  expect(foreign.status()).toBe(401);

  await page.goto('/');
  const row = page.locator('ul.maps li', { has: page.locator(`a[href="/e/${id}"]`) });
  await row.getByRole('button', { name: 'Delete…' }).click();
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator(`a[href="/e/${id}"]`)).toHaveCount(0);

  // Signing out answers with a Secure cookie that clears the session. WebKit takes no Secure cookie over the
  // plain http of this local test server (it does over https, where the site really runs), so there the
  // cookie is removed by hand and only what follows is checked.
  if (browserName === 'webkit') {
    await context.clearCookies();
    await page.reload();
  } else {
    await page.getByRole('button', { name: 'Sign out' }).click();
  }
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toBeVisible();
  await page.goto(`/e/${id}`);
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', `/auth/google?next=%2Fe%2F${id}`);
});
