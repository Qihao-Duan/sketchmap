# Step 4c: dark-mode polish — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In dark mode, topic images keep their true colours (today they come out darker and duller: a measured yellow stripe `#fcc419` shows as `#ddac79`). And a Notion embed can be forced to light or dark with `?theme=light|dark`, for a Notion page whose theme differs from the system setting.

**Architecture:**
- **Photos on their own layer.** The canvas keeps its Excalidraw-style dark filter (`invert(93%) hue-rotate(180deg)` on the drawing's `<svg>`). Topic images move to a second, unfiltered `<svg class="photos">` stacked exactly on top of it (same size, same pan/zoom transform, `pointer-events: none`). Frames, text and hit areas stay in the drawing, so clicking, dragging and dropping work as before. Exports (which never filter) keep drawing images inline.
- **A theme override.** Colour tokens switch on `color-scheme` via CSS `light-dark()`, so a `data-theme="light|dark"` on `<html>` can force either look. The filter token switches with one media-query rule plus one attribute rule. `src/main.tsx` reads `?theme=` once at startup, before the first render.

**Base:** main at 05f5fa8 (step 4b merged).

**Tech Stack:** React 19, TypeScript, CSS (`light-dark()`, custom properties), Vitest (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md` — §6 "Dark mode", §7 (the embed), §11 step 4.

## Global Constraints

- Spec §6: "Like Excalidraw, the drawing gets `invert(93%) hue-rotate(180deg)`." Unchanged for everything except images.
- Ruling (replaces spec §6's "Images get a counter-filter … slightly faded"): images are not filtered at all; they sit on an unfiltered layer. Why: measured on real pixels (Chromium 158), no counter-filter can restore saturated colours, because `hue-rotate(180deg)` pushes them out of gamut before the parent filter, and they clip. Max error per channel, out of 255: the current filter 96, Excalidraw's `… saturate(1.25)` 94, and the exact algebraic inverse `invert(100%) hue-rotate(180deg) contrast(1.1628)` 110 (on yellow). The separate layer is exact, and it needs no CSS filter on SVG groups, whose support outside Chromium is unverified.
- Exports (SVG, PNG, `.excalidraw`) are theme-independent: no filters, white background. Unchanged.
- No new dependencies. The production CSP is unchanged.
- `?theme=` accepts exactly `light` or `dark`; anything else is ignored (follow the system).
- Commit messages end with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` on its own line after a blank line — never on the subject line.

---

### Task 1: Images on an unfiltered photo layer

**Files:**
- Modify: `src/render/renderMap.ts` (`RenderOptions.photos`)
- Modify: `src/render/renderMap.test.ts`
- Modify: `src/editor/Canvas.tsx` (second svg, shared transform, ghost)
- Modify: `src/editor/Canvas.test.tsx`
- Modify: `src/app.css`
- Modify: `src/editor/EditorPage.test.tsx` (selector), `e2e/smoke.spec.ts`, `e2e/prod.spec.ts` (selectors + a new dark-mode pixel test)
- Modify: `README.md`, `docs/superpowers/specs/2026-11-12-sketchmap-design.md` §6

**Interfaces:**
- Produces: `RenderOptions.photos?: SVGGElement`. When it is given, `renderMap` empties it first, then draws each topic's `<image class="topic-image" data-id="<topic id>">` into it, at the same world coordinates. The frame stays in the topic's group. When it is absent, the image is drawn inline in the topic's group, exactly as today. That is the path `buildSvg` uses for export, and it stays unchanged.
- The canvas DOM: `.canvas > svg[role=img]` (the drawing, filtered in dark mode) and then `.canvas > svg.photos[aria-hidden=true] > g.photos-world > image.topic-image`.

- [ ] **Step 1: Failing renderMap test.** Add to `src/render/renderMap.test.ts`, next to 'draws the topic image above the text, with a sketchy frame':

```ts
  it('draws images into the photo layer when one is given, leaving the frame in the topic', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const photos = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    photos.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'image')); // stale, from a previous render
    svg.append(world, photos);
    const withImage: MapNode = {
      id: 'r', text: 'Root',
      children: [{ id: 'img', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }],
    };
    const layout = computeLayout(withImage, measure);
    renderMap(svg, world, layout, { selectedId: null, photos });
    expect(world.querySelectorAll('image')).toHaveLength(0);
    const imgs = photos.querySelectorAll('image.topic-image');
    expect(imgs).toHaveLength(1);
    const box = layout.byId.get('img')!;
    expect(imgs[0].getAttribute('data-id')).toBe('img');
    expect(Number(imgs[0].getAttribute('x'))).toBeCloseTo(box.x + box.image!.x);
    expect(Number(imgs[0].getAttribute('y'))).toBeCloseTo(box.y + box.image!.y);
    // The rough frame is still drawn with the topic (a g of rough paths after the hit rect and the box).
    const topic = world.querySelector('g.topic[data-id="img"]')!;
    expect(topic.querySelectorAll('path').length).toBeGreaterThan(1);
  });
```

Run: `npx vitest run src/render/renderMap.test.ts` — Expected: FAIL (images still in the world, so the length is 1, not 0).

- [ ] **Step 2: Implement in `src/render/renderMap.ts`.**
  - Add to `RenderOptions`: `/** Draws topic images here instead of inline: the canvas's unfiltered photo layer (dark mode leaves photos alone). */ photos?: SVGGElement;`
  - In `renderMap`, after `world.replaceChildren();`, add `opts.photos?.replaceChildren();`.
  - In `drawTopic`, the image call (`el(doc, 'image', { class: 'topic-image', href: `/${imageKey}`, … }, g)`, inside the `storedImageKey(t)` block) gains `'data-id': t.id` in its attributes and its parent becomes `opts.photos ?? g`. The frame (`g.appendChild(rc.rectangle(…))`) is unchanged. (`data-id` is harmless inline, and it lets the canvas find a topic's photo.)
  - Run the renderMap tests. Expected: all PASS. The existing inline test passes `{ selectedId: null }`, so its image stays inline. The test at line ~186, which checks that the frame follows the image, still passes inline.

- [ ] **Step 3: Failing Canvas test.** Add to `src/editor/Canvas.test.tsx` (it mounts `<Canvas>` the way `mount()` does, but with a tree that has an image):

```ts
describe('photo layer', () => {
  it('draws images on an unfiltered svg over the drawing, panned and zoomed with it', () => {
    const withImage: MapNode = { id: 'r', text: 'Root', children: [
      { id: 'p', text: 'Pic', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 120, h: 80 }, children: [] },
    ] };
    const imgLayout = computeLayout(withImage, (t, s) => t.length * s * 0.5);
    container = document.createElement('div');
    document.body.appendChild(container);
    const ref = { current: null as CanvasHandle | null };
    act(() => createRoot(container).render(
      <Canvas ref={(h) => { ref.current = h; }} layout={imgLayout} selectedId={null} interactive onToggleFold={() => {}} />,
    ));
    const [drawing, photos] = container.querySelectorAll('.canvas > svg');
    expect(drawing.getAttribute('role')).toBe('img');
    expect(photos.classList.contains('photos')).toBe(true);
    expect(photos.getAttribute('aria-hidden')).toBe('true');
    expect(drawing.querySelectorAll('image')).toHaveLength(0);
    expect(photos.querySelectorAll('image.topic-image[data-id="p"]')).toHaveLength(1);
    act(() => ref.current!.zoomBy(1.5));
    const world = drawing.querySelector('g.world')!;
    expect(photos.querySelector('g.photos-world')!.getAttribute('transform')).toBe(world.getAttribute('transform'));
  });
});
```

Run: `npx vitest run src/editor/Canvas.test.tsx` — Expected: FAIL (only one svg).

- [ ] **Step 4: Implement in `src/editor/Canvas.tsx`.**
  - Add `const photosRef = useRef<SVGGElement>(null);` beside `overlayRef`.
  - In `applyView`, also run `photosRef.current?.setAttribute('transform', t);`.
  - In the `useLayoutEffect`, pass `{ selectedId, dropTargetId: dropTarget, photos: photosRef.current ?? undefined }` to `renderMap`.
  - In the JSX, right after the closing `</svg>` of the drawing (still inside `<div className="canvas">`), add:

```tsx
      {/* Topic images, outside the drawing's dark-mode filter so photos keep their colours; clicks pass through to the drawing. */}
      <svg className="photos" aria-hidden="true">
        <g ref={photosRef} className="photos-world" />
      </svg>
```

  - The drag ghost: where it clones `source` into `g.ghost`, also carry the photo, so an image topic doesn't lose its picture while being dragged. After `g.ghost = source.cloneNode(true) as SVGGElement;`, add:

```ts
        const photo = photosRef.current?.querySelector(`image[data-id="${g.id}"]`);
        if (photo) g.ghost.appendChild(photo.cloneNode(true));
```

  (Appended on top, the same stacking the live photo layer has: the photo above the topic's box and frame.)
  - Run `npx vitest run src/editor` — Expected: all PASS. If an existing test reads `container.querySelector('svg')`, it still gets the drawing, because it comes first.

- [ ] **Step 5: CSS** in `src/app.css`:
  - Delete the `--image-filter: none;` line in `:root`, the `--image-filter: invert(100%) hue-rotate(180deg);` line in the dark block, and the last rule `.canvas svg image.topic-image { filter: var(--image-filter); }`.
  - After the `.canvas svg { … }` rule, add:

```css
/* Topic images sit on their own layer above the drawing, untouched by the dark-mode filter. */
.canvas svg.photos { position: absolute; inset: 0; pointer-events: none; filter: none; }
```

- [ ] **Step 6: Selectors.** The image is no longer inside `g.topic`. Replace `g.topic image.topic-image` with `image.topic-image` in `src/editor/EditorPage.test.tsx`, which defines `topicImage` and names a test after it (rename that test to '… draws image.topic-image'), and in every use in `e2e/smoke.spec.ts` and `e2e/prod.spec.ts`. Run `grep -rn "g.topic image" src e2e`. Expected: no matches.

- [ ] **Step 7: Dark-mode pixel test (e2e).** Append to `e2e/smoke.spec.ts`:

```ts
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
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter)).toContain('invert');
  const dark = await sample();
  for (let i = 0; i < COLS.length; i++) {
    for (let ch = 0; ch < 3; ch++) expect(Math.abs(dark[i][ch] - light[i][ch])).toBeLessThanOrEqual(3);
  }
});
```

  The stripes are opaque, so `prepareImage` re-encodes them as JPEG at 0.85. The test therefore compares the browser's own rendering in light mode with dark mode, not against the hex values. Note: if the topic is selected, its selection highlight sits under the image, not over it, so it doesn't change the sampled pixels.

- [ ] **Step 8: Run everything.** Run `npm test`, `npm run typecheck`, and, from the main checkout only, `npx playwright test`. Expected: all PASS. In a worktree, skip Playwright and say so.

- [ ] **Step 9: Docs.**
  - In `README.md`, replace the dark-mode sentence ("In dark mode photos are counter-inverted, so they keep roughly their real colours (strongly saturated colours come out a little duller).") with: "In dark mode the drawing is inverted the way Excalidraw does it, but images are drawn on their own layer, so photos keep their true colours."
  - In spec §6 "Dark mode", replace the bullet "Images get a counter-filter so photos don't come out inverted. They end up slightly faded, which is fine." with: "Images sit on a separate, unfiltered layer above the drawing, so photos keep their true colours. A counter-filter can't do this: `hue-rotate(180deg)` pushes saturated colours out of gamut before the drawing's filter, so they clip, measured at up to 110/255 off on yellow."

- [ ] **Step 10: Commit**

```bash
git add src/render/renderMap.ts src/render/renderMap.test.ts src/editor/Canvas.tsx src/editor/Canvas.test.tsx src/app.css src/editor/EditorPage.test.tsx e2e/smoke.spec.ts e2e/prod.spec.ts README.md docs/superpowers/specs/2026-11-12-sketchmap-design.md
git commit -m "feat(dark): topic images on an unfiltered layer keep their true colours" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `?theme=light|dark` forces the look (for Notion pages whose theme differs from the system)

**Files:**
- Create: `src/theme.ts`, `src/theme.test.ts`
- Modify: `src/main.tsx` (apply before the first render)
- Modify: `src/app.css` (tokens via `light-dark()`; the filter token by media query + attribute)
- Modify: `e2e/smoke.spec.ts`
- Modify: `README.md`, spec §7

**Interfaces:**
- Produces: `export type Theme = 'light' | 'dark';`, `export function themeFromSearch(search: string): Theme | null`, `export function applyTheme(root: HTMLElement, theme: Theme | null): void` (sets or removes `data-theme`).

- [ ] **Step 1: Failing unit test** — `src/theme.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, themeFromSearch } from './theme';

describe('themeFromSearch', () => {
  it('reads exactly light or dark, and ignores anything else', () => {
    expect(themeFromSearch('?theme=dark')).toBe('dark');
    expect(themeFromSearch('?x=1&theme=light')).toBe('light');
    expect(themeFromSearch('?theme=Dark')).toBeNull();
    expect(themeFromSearch('?theme=')).toBeNull();
    expect(themeFromSearch('?theme=blue')).toBeNull();
    expect(themeFromSearch('')).toBeNull();
  });
});

describe('applyTheme', () => {
  it('sets data-theme, and removes it for null', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root, null);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
```

Run: `npx vitest run src/theme.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement** `src/theme.ts`:

```ts
export type Theme = 'light' | 'dark';

/** `?theme=light|dark` forces the look, e.g. for a Notion page whose theme differs from the system's. */
export function themeFromSearch(search: string): Theme | null {
  const t = new URLSearchParams(search).get('theme');
  return t === 'light' || t === 'dark' ? t : null;
}

/** Forces `theme` on the document (`data-theme` on `<html>`); null follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme | null): void {
  if (theme) root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}
```

  In `src/main.tsx`, import `{ applyTheme, themeFromSearch } from './theme'` and call `applyTheme(document.documentElement, themeFromSearch(location.search));` right after `installFontFaces();`, before `createRoot`.

- [ ] **Step 3: CSS tokens.** Rewrite the top of `src/app.css`, from `:root {` through the end of the `@media (prefers-color-scheme: dark) { … }` block, as follows. The values are the existing light and dark values, paired:

```css
:root {
  color-scheme: light dark;
  --paper: light-dark(#fbfaf6, #151517); --surface: light-dark(#ffffff, #1e1e21); --surface-2: light-dark(#f4f2ec, #26262a);
  --ink: light-dark(#1e1e1e, #ebe8e2); --ink-2: light-dark(#5f5b53, #a8a49b); --line: light-dark(#e3e0d8, #34343a);
  --accent: light-dark(#3b5bdb, #9fb1ff); --accent-ink: light-dark(#ffffff, #11131c); --accent-soft: light-dark(#e9edff, #252b45);
  --dots: light-dark(#dedad0, #2b2b30); --warn: light-dark(#c2410c, #fb923c);
  --shadow: 0 1px 2px light-dark(rgba(40, 36, 28, 0.06), rgba(0, 0, 0, 0.45)), 0 8px 24px light-dark(rgba(40, 36, 28, 0.08), rgba(0, 0, 0, 0.4));
  --canvas-filter: none;
  --hand: "Excalifont", "Xiaolai", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
  --ui: system-ui, -apple-system, "Segoe UI", sans-serif;
}
/* ?theme=light|dark (data-theme on <html>) overrides the system setting. */
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; --canvas-filter: invert(93%) hue-rotate(180deg); }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --canvas-filter: invert(93%) hue-rotate(180deg); }
}
```

  (The dark shadow's second layer used `0 10px 28px`, and the light one `0 8px 24px`. Keep `0 8px 24px` for both. The difference is invisible, and offsets can't go through `light-dark()`.) Make sure nothing else in the file depends on `--image-filter`; Task 1 removed it.

- [ ] **Step 4: e2e.** Append to `e2e/smoke.spec.ts`:

```ts
test('?theme= forces the embed light or dark, whatever the system says', async ({ page }) => {
  const id = await openNewMap(page);
  const filter = () => page.locator('.canvas > svg[role="img"]').evaluate((s) => getComputedStyle(s).filter);
  const paper = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

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
```

- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, and, from the main checkout only, `npx playwright test`. Expected: all PASS.

- [ ] **Step 6: Docs.**
  - In `README.md`, under the Notion embed instructions, add: "The embed follows your system's light or dark setting. If your Notion page uses a different theme, add `?theme=dark` or `?theme=light` to the embed link, e.g. `https://…/m/<id>?theme=dark`."
  - In spec §7, add the bullet: "`?theme=light|dark` forces the look; otherwise it follows `prefers-color-scheme`. This is for a Notion page whose theme differs from the system's, since an embedded page can't read Notion's theme."

- [ ] **Step 7: Commit**

```bash
git add src/theme.ts src/theme.test.ts src/main.tsx src/app.css e2e/smoke.spec.ts README.md docs/superpowers/specs/2026-11-12-sketchmap-design.md
git commit -m "feat(dark): ?theme=light|dark forces the look of an embed" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
