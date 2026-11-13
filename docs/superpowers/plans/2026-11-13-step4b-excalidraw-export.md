# Step 4b: `.excalidraw` export — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The editor's toolbar gains an **Excalidraw** export next to SVG and PNG. It downloads `<title>.excalidraw`, a file that opens in excalidraw.com (or any Excalidraw 0.18 app) as an editable drawing of the map as it is shown: boxes, underlines, branches, text, highlight swipes, priority badges, folded-branch counters and images.

**Architecture:**
- **A pure mapping** `toExcalidrawSkeleton(layout, fileIds)` in `src/io/excalidraw.ts` turns the laid-out map (`MapLayout`, the same input the SVG renderer draws) into Excalidraw *element skeletons*. It reproduces `renderMap`'s geometry and is unit-tested without the library.
- **The builder** `buildExcalidraw(layout)` loads `@excalidraw/excalidraw` with a dynamic `import()` (so it is a separate chunk, fetched only on export), fetches each topic image from `/img/…` into the `files` map, runs `convertToExcalidrawElements` and serialises the scene JSON.
- **The editor** adds the button, a busy state while the chunk loads, and a notice listing what the format can't carry (notes, extra links, folded topics).

**Tech Stack:** TypeScript, React 19, `@excalidraw/excalidraw@0.18.1` (`convertToExcalidrawElements`, `restore` in tests), Vitest (node + jsdom), Playwright (dev + prod CSP projects).

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md` — §9 "`.excalidraw` out", §6 (looks being mapped), §11 step 4.

## Global Constraints

- Spec §9: "Boxes, underlines and branches become rectangles, lines and curved lines; text becomes text elements in Excalifont (fontFamily 5); images become image elements plus `files`."
- Spec §9: "Elements are built through `convertToExcalidrawElements` from `@excalidraw/excalidraw@0.18.1`, loaded only when you export. … this version stays pinned." The version string stays exactly `"0.18.1"` (no `^`/`~`).
- App code imports `@excalidraw/excalidraw` only through `await import('@excalidraw/excalidraw')` inside `buildExcalidraw`. No static import anywhere under `src/` outside test files; the main entry chunk must not grow by the library.
- The production CSP (`worker/assets.ts`) is NOT changed. The export must work under it (proved by `e2e/prod.spec.ts`).
- Images are fetched only for keys matching `IMAGE_KEY_RE` (from `src/shared/types.ts`), same-origin `/<key>`; a failed fetch drops that image element but keeps its frame (as the SVG export does).
- The export mirrors what the canvas shows: visible topics only (folded branches stay folded, with their counter). Notes are not exported. Each text element carries at most one link (the topic's first). The editor says so after download.
- Stroke widths come from one place (`topicStrokeWidth`, `branchStrokeWidth` in `src/layout/styles.ts`), shared by `renderMap` and the export.
- Commit messages end with the trailer line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` on its own line after a blank line — never on the subject line.

## Facts verified before planning (2026-11-13, against the installed 0.18.1)

- `convertToExcalidrawElements(skeletons, { regenerateIds: false })` keeps our ids; the default (`true`) replaces them. Output order = input order for skeletons without `label`/`start`/`end`.
- A `line` skeleton with `points` but no `width`/`height` comes out as width 100, height 0: pass `width`/`height` computed from the points.
- Text elements are measured by Excalidraw on a canvas with the font string `"<size>px Excalifont, Xiaolai, …"` — the same family names our `@font-face` rules declare, so in the browser the measurement uses our loaded fonts.
- Under jsdom the library needs (a) a 2D context with `measureText` — `src/test/setup.ts` already installs a fake one — and (b) a global `FontFace` constructor; the test stubs it. Vitest must inline the package (`test.server.deps.inline`), or Node refuses its `open-color` JSON import.
- `convertToExcalidrawElements` constructs `FontFace` objects but never loads them or touches `document.fonts`; nothing is fetched from Excalidraw's CDN. (The library only loads fonts when its React component mounts, which we never do.)
- The bundle's only `new Function` is in emscripten font-subsetting glue, not on the path we call (inference from reading the bundle; the prod e2e is the proof).
- Excalidraw's own MIME type for scene files is `application/vnd.excalidraw+json`.

---

### Task 1: Pure mapping from the layout to Excalidraw skeletons

**Files:**
- Create: `src/io/excalidraw.ts`
- Create: `src/io/excalidraw.test.ts`
- Modify: `src/layout/styles.ts` (add `topicStrokeWidth`, `branchStrokeWidth`)
- Modify: `src/render/renderMap.ts` (use the two helpers; no visual change)

**Interfaces:**
- Consumes: `MapLayout`, `TopicBox`, `BranchPath` from `src/layout/map.ts`; `hashSeed` from `src/render/renderMap.ts`; `IMAGE_KEY_RE` from `src/shared/types.ts`; style constants from `src/layout/styles.ts`.
- Produces (Task 2 and 3 rely on these exact names):
  - `export interface Skeleton { type: 'rectangle' | 'ellipse' | 'line' | 'text' | 'image'; id: string; x: number; y: number; [prop: string]: unknown }`
  - `export interface SkeletonScene { elements: Skeleton[]; centres: Map<string, { x: number; y?: number }> }` — for text elements that must be centred after Excalidraw measures them: final `x = centre.x - width / 2`, and when `y` is set, `y = centre.y - height / 2`.
  - `export function toExcalidrawSkeleton(layout: MapLayout, fileIds: ReadonlyMap<string, string>): SkeletonScene` — `fileIds` maps an image key (`img/…`) to the Excalidraw file id; an image whose key is missing from the map is left out (its frame stays).
  - `export function pathPoints(d: string): { points: Array<[number, number]>; curved: boolean }`
  - `export function excalidrawLosses(layout: MapLayout): string[]`
  - `export function fileIdFor(key: string): string`
  - In `styles.ts`: `export function topicStrokeWidth(kind: TopicKind, emphasis?: Emphasis): number` and `export function branchStrokeWidth(fromDepth: number, toEmphasis?: Emphasis): number`.

- [ ] **Step 1: Add the stroke-width helpers to `src/layout/styles.ts`** (append after `badgeSize`):

```ts
/** Outline width of a topic's box or underline; Key is ×1.5 (spec §6). */
export function topicStrokeWidth(kind: TopicKind, emphasis?: Emphasis): number {
  const base = kind === 'root' ? 2.2 : kind === 'box' ? 1.8 : kind === 'small' ? 1.4 : 1.6;
  return base * (emphasis === 'key' ? 1.5 : 1);
}

/** Width of the branch into a topic: wider from the root; Key ×1.45, Aside ×0.8 (spec §6). */
export function branchStrokeWidth(fromDepth: number, toEmphasis?: Emphasis): number {
  return (fromDepth === 0 ? 2.4 : 1.6) * (toEmphasis === 'key' ? 1.45 : toEmphasis === 'aside' ? 0.8 : 1);
}
```

- [ ] **Step 2: Use them in `src/render/renderMap.ts`** — no behaviour change.
  - In `renderMap`, replace `const width = (b.fromDepth === 0 ? 2.4 : 1.6) * (em === 'key' ? 1.45 : em === 'aside' ? 0.8 : 1);` with `const width = branchStrokeWidth(b.fromDepth, em);`.
  - In `drawTopic`, delete `const weight = key ? 1.5 : 1;` and replace the four `strokeWidth: 2.2 * weight`, `1.8 * weight`, `1.4 * weight`, `1.6 * weight` with `strokeWidth: topicStrokeWidth(t.style.kind, em)`.
  - Add `branchStrokeWidth, topicStrokeWidth` to the existing import from `'../layout/styles'`.
  - Run `npx vitest run src/render` — Expected: all pass unchanged (the existing tests assert `2.4 * 1.45` etc.).

- [ ] **Step 3: Write the failing tests** — `src/io/excalidraw.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layoutMap } from '../layout';
import { ASIDE_INK, HIGHLIGHTER, INK, LINK_COLOR, PALETTE, PRIORITY_COLORS, ROOT_COLOR, branchStrokeWidth, topicStrokeWidth } from '../layout/styles';
import type { Measure } from '../layout/wrap';
import type { LayoutKind, MapNode } from '../shared/types';
import { excalidrawLosses, fileIdFor, pathPoints, toExcalidrawSkeleton, type Skeleton } from './excalidraw';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text, children, ...extra });
const KEY = 'img/AAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBB.png';
const scene = (root: MapNode, kind: LayoutKind = 'map', fileIds = new Map<string, string>()) => {
  const layout = layoutMap(root, kind, measure);
  return { layout, ...toExcalidrawSkeleton(layout, fileIds) };
};
const byId = (els: Skeleton[], id: string) => els.find((e) => e.id === id)!;

describe('pathPoints', () => {
  it('samples a cubic branch into five points, drawn curved', () => {
    const { points, curved } = pathPoints('M0 0 C50 0 50 100 100 100');
    expect(curved).toBe(true);
    expect(points).toEqual([[0, 0], [29.7, 15.6], [50, 50], [70.3, 84.4], [100, 100]]);
  });
  it('keeps an org elbow as straight corner points', () => {
    expect(pathPoints('M10 20 L10 -35.5 L60 -35.5')).toEqual({ points: [[10, 20], [10, -35.5], [60, -35.5]], curved: false });
  });
});

describe('toExcalidrawSkeleton', () => {
  it('draws the root as a hachured rounded rectangle and a depth-1 topic as a box in its branch colour', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('a', 'Alpha')]));
    const root = byId(elements, 'r:shape');
    const box = layout.byId.get('r')!;
    expect(root).toMatchObject({
      type: 'rectangle', x: box.x, y: box.y, width: box.w, height: box.h, strokeColor: ROOT_COLOR.stroke,
      backgroundColor: ROOT_COLOR.fill, fillStyle: 'hachure', strokeStyle: 'solid', roundness: { type: 3 },
      strokeWidth: topicStrokeWidth('root'), groupIds: ['topic:r'],
    });
    expect(byId(elements, 'a:shape')).toMatchObject({ type: 'rectangle', strokeColor: PALETTE[0].stroke, backgroundColor: PALETTE[0].fill });
  });

  it('underlines a depth-2 topic in the map layout, and boxes it (unfilled) in the org layout', () => {
    const tree = n('r', 'Root', [n('a', 'Alpha', [n('b', 'Beta')])]);
    const { layout, elements } = scene(tree);
    const b = layout.byId.get('b')!;
    expect(byId(elements, 'b:shape')).toMatchObject({ type: 'line', x: b.x, y: b.y + b.h, points: [[0, 0], [b.w, 0]], width: b.w, height: 0 });
    const org = scene(tree, 'org').elements;
    expect(byId(org, 'b:shape')).toMatchObject({ type: 'rectangle', backgroundColor: 'transparent', strokeWidth: topicStrokeWidth('small') });
  });

  it('gives Key a solid fill and heavier stroke, and Aside a dashed grey outline with grey text and no fill', () => {
    const { elements } = scene(n('r', 'Root', [n('k', 'Key', [], { emphasis: 'key' }), n('s', 'Side', [], { emphasis: 'aside' })]));
    expect(byId(elements, 'k:shape')).toMatchObject({ fillStyle: 'solid', strokeWidth: topicStrokeWidth('box', 'key') });
    expect(byId(elements, 's:shape')).toMatchObject({ strokeStyle: 'dashed', strokeColor: ASIDE_INK, backgroundColor: 'transparent' });
    expect(byId(elements, 's:text')).toMatchObject({ strokeColor: ASIDE_INK });
    expect(byId(elements, 's:branch')).toMatchObject({ strokeStyle: 'dashed', strokeWidth: branchStrokeWidth(0, 'aside') });
  });

  it('writes the shown text (link labels, marker) as one Excalifont text element, centred in a box and left-aligned on a line', () => {
    const { layout, elements, centres } = scene(n('r', 'See [docs](https://example.com/d) now', [n('a', 'A', [n('b', 'Beta')])], { emoji: '✅' }));
    const r = layout.byId.get('r')!;
    const text = byId(elements, 'r:text');
    expect(text).toMatchObject({
      type: 'text', text: r.lines.join('\n'), fontFamily: 5, fontSize: r.style.fontSize, textAlign: 'center',
      verticalAlign: 'top', lineHeight: r.style.lineHeight / r.style.fontSize, y: r.y + r.textTop,
      strokeColor: INK, link: 'https://example.com/d', groupIds: ['topic:r'],
    });
    expect(text.text).toContain('✅ See docs now');
    expect(centres.get('r:text')).toEqual({ x: r.x + r.style.padX + r.badgeW + r.textW / 2 });
    const b = layout.byId.get('b')!;
    expect(byId(elements, 'b:text')).toMatchObject({ textAlign: 'left', x: b.x + b.style.padX });
    expect(centres.has('b:text')).toBe(false);
  });

  it('colours a topic that is entirely one link in the link colour', () => {
    const { elements } = scene(n('r', 'Root', [n('a', '[Alpha](https://a.example)')]));
    expect(byId(elements, 'a:text')).toMatchObject({ strokeColor: LINK_COLOR, link: 'https://a.example' });
  });

  it('puts a highlighter swipe behind each non-blank line, before the text', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('h', 'Highlighted words', [], { emphasis: 'highlight' })]));
    const swipes = elements.filter((e) => e.id.startsWith('h:highlight'));
    expect(swipes).toHaveLength(layout.byId.get('h')!.lines.length);
    expect(swipes[0]).toMatchObject({ type: 'rectangle', backgroundColor: HIGHLIGHTER, fillStyle: 'solid', strokeColor: 'transparent' });
    expect(elements.indexOf(swipes[0])).toBeLessThan(elements.indexOf(byId(elements, 'h:text')));
  });

  it('draws a priority badge as a filled circle with a centred white number', () => {
    const { elements, centres } = scene(n('r', 'Root', [n('p', 'Urgent', [], { priority: 1 })]));
    expect(byId(elements, 'p:badge')).toMatchObject({ type: 'ellipse', backgroundColor: PRIORITY_COLORS[1], fillStyle: 'solid' });
    expect(byId(elements, 'p:badge-text')).toMatchObject({ type: 'text', text: '1', strokeColor: '#ffffff', fontFamily: 5 });
    const c = centres.get('p:badge-text')!;
    const badge = byId(elements, 'p:badge');
    expect(c.x).toBeCloseTo(badge.x + (badge.width as number) / 2);
    expect(c.y).toBeCloseTo(badge.y + (badge.height as number) / 2);
  });

  it('shows a folded branch as a counter circle and leaves its hidden topics out', () => {
    const { elements } = scene(n('r', 'Root', [n('f', 'Folded', [n('x', 'Hidden'), n('y', 'Hidden too')], { collapsed: true })]));
    expect(byId(elements, 'f:fold')).toMatchObject({ type: 'ellipse', width: 20, height: 20 });
    expect(byId(elements, 'f:fold-text')).toMatchObject({ type: 'text', text: '2' });
    expect(elements.some((e) => e.id.startsWith('x:'))).toBe(false);
  });

  it('adds an image element only for a fetched file, and always its frame', () => {
    const img = { key: KEY, w: 120, h: 80 };
    const tree = n('r', 'Root', [n('i', 'Pic', [], { image: img })]);
    const without = scene(tree).elements;
    expect(without.some((e) => e.id === 'i:image')).toBe(false);
    expect(byId(without, 'i:frame')).toMatchObject({ type: 'rectangle', width: 120, height: 80, backgroundColor: 'transparent' });
    const { layout, elements } = scene(tree, 'map', new Map([[KEY, fileIdFor(KEY)]]));
    const t = layout.byId.get('i')!;
    expect(byId(elements, 'i:image')).toMatchObject({
      type: 'image', fileId: fileIdFor(KEY), status: 'saved', x: t.x + t.image!.x, y: t.y + t.image!.y, width: 120, height: 80,
    });
  });

  it('ignores an image key that is not one of ours', () => {
    const bad = 'https://evil.example/x.png';
    const { elements } = scene(n('r', 'Root', [n('i', 'Pic', [], { image: { key: bad, w: 120, h: 80 } })]), 'map', new Map([[bad, 'x']]));
    expect(elements.some((e) => e.id === 'i:image' || e.id === 'i:frame')).toBe(false);
  });

  it('draws each branch as a line in its colour and width, starting at the path start', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('a', 'Alpha')]));
    const b = layout.branches[0];
    const line = byId(elements, 'a:branch');
    const { points } = pathPoints(b.d);
    expect(line).toMatchObject({ type: 'line', x: points[0][0], y: points[0][1], strokeColor: b.color.stroke, strokeWidth: branchStrokeWidth(0), roundness: { type: 2 } });
    expect((line.points as number[][])[0]).toEqual([0, 0]);
    expect(line.width).toBeCloseTo(Math.abs(points[4][0] - points[0][0]));
    expect(elements.indexOf(line)).toBeLessThan(elements.indexOf(byId(elements, 'r:shape'))); // branches under topics
  });

  it('skips the text element of an image-only topic', () => {
    const { elements } = scene(n('r', 'Root', [n('i', '', [], { image: { key: KEY, w: 120, h: 80 } })]));
    expect(elements.some((e) => e.id === 'i:text')).toBe(false);
  });

  it('uses stable seeds, so two exports of the same map draw the same strokes', () => {
    const tree = n('r', 'Root', [n('a', 'Alpha')]);
    expect(scene(tree).elements).toEqual(scene(tree).elements);
    expect(typeof byId(scene(tree).elements, 'r:shape').seed).toBe('number');
  });
});

describe('excalidrawLosses', () => {
  it('lists notes, second links and folded topics, and nothing for a plain map', () => {
    const plain = layoutMap(n('r', 'Root', [n('a', 'Alpha')]), 'map', measure);
    expect(excalidrawLosses(plain)).toEqual([]);
    const lossy = layoutMap(n('r', 'Root', [
      n('a', 'Alpha', [], { note: 'a note' }),
      n('b', '[one](https://1.example) and [two](https://2.example)'),
      n('f', 'Folded', [n('x', 'Hidden')], { collapsed: true }),
    ]), 'map', measure);
    expect(excalidrawLosses(lossy)).toEqual(['notes', 'links after the first in a topic', 'topics inside folded branches']);
  });
});

describe('fileIdFor', () => {
  it('turns an image key into a stable, path-free id', () => {
    expect(fileIdFor(KEY)).toBe('AAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBB');
  });
});
```

- [ ] **Step 4: Run them to verify they fail**

Run: `npx vitest run src/io/excalidraw.test.ts`
Expected: FAIL — `Failed to resolve import "./excalidraw"`.

- [ ] **Step 5: Write `src/io/excalidraw.ts`**

```ts
import type { BranchPath, MapLayout, TopicBox } from '../layout/map';
import { countDescendants } from '../model/tree';
import { hashSeed } from '../render/renderMap';
import { IMAGE_KEY_RE } from '../shared/types';
import {
  ASIDE_INK, HIGHLIGHTER, INK, LINK_COLOR, PRIORITY_COLORS, badgeSize, branchStrokeWidth, topicStrokeWidth,
} from '../layout/styles';

/** An element skeleton for `convertToExcalidrawElements` (our own loose type, so the library stays out of the main bundle). */
export interface Skeleton {
  type: 'rectangle' | 'ellipse' | 'line' | 'text' | 'image';
  id: string;
  x: number;
  y: number;
  [prop: string]: unknown;
}

/**
 * The skeletons, plus where to centre the text elements that Excalidraw measures itself: after conversion,
 * x = centre.x − width / 2 (and y = centre.y − height / 2 when y is given).
 */
export interface SkeletonScene {
  elements: Skeleton[];
  centres: Map<string, { x: number; y?: number }>;
}

/** Excalifont (spec §9). */
const EXCALIFONT = 5;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** An Excalidraw file id for one of our image keys: `img/<folder>/<file>.<ext>` → `<folder>-<file>`. */
export function fileIdFor(key: string): string {
  const [, folder, file] = key.split('/');
  return `${folder}-${file.replace(/\.[a-z]+$/, '')}`;
}

/**
 * The points along one of our branch paths. `M x y C x1 y1 x2 y2 x y` (map, logic, org root) is sampled at five
 * points and drawn curved; `M x y L … L …` (an org elbow) keeps its corners and is drawn straight.
 */
export function pathPoints(d: string): { points: Array<[number, number]>; curved: boolean } {
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (d.includes('C')) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      return [r1(a * x0 + b * x1 + c * x2 + e * x3), r1(a * y0 + b * y1 + c * y2 + e * y3)];
    };
    return { points: [0, 0.25, 0.5, 0.75, 1].map(at), curved: true };
  }
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return { points, curved: false };
}

/** What the `.excalidraw` file can't carry, in the order the editor lists it. */
export function excalidrawLosses(layout: MapLayout): string[] {
  const lost: string[] = [];
  if (layout.boxes.some((b) => b.node.note?.trim())) lost.push('notes');
  if (layout.boxes.some((b) => new Set(b.segments.flat().flatMap((s) => (s.href ? [s.href] : []))).size > 1)) {
    lost.push('links after the first in a topic');
  }
  if (layout.boxes.some((b) => b.node.collapsed && b.node.children.length > 0)) lost.push('topics inside folded branches');
  return lost;
}

function branch(b: BranchPath): Skeleton {
  const { points, curved } = pathPoints(b.d);
  const [x0, y0] = points[0];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    type: 'line', id: `${b.to}:branch`, x: x0, y: y0,
    points: points.map(([x, y]) => [r1(x - x0), r1(y - y0)]),
    width: r1(Math.max(...xs) - Math.min(...xs)), height: r1(Math.max(...ys) - Math.min(...ys)),
    strokeColor: b.color.stroke, strokeWidth: branchStrokeWidth(b.fromDepth, b.toEmphasis),
    strokeStyle: b.toEmphasis === 'aside' ? 'dashed' : 'solid', roughness: 1,
    roundness: curved ? { type: 2 } : null, seed: hashSeed(`${b.to}:branch`),
  };
}

function topic(t: TopicBox, fileIds: ReadonlyMap<string, string>, out: Skeleton[], centres: SkeletonScene['centres']) {
  const groupIds = [`topic:${t.id}`];
  const seed = hashSeed(t.id);
  const em = t.node.emphasis;
  const key = em === 'key';
  const aside = em === 'aside';
  const { kind, fontSize, lineHeight, padX } = t.style;
  const strokeStyle = aside ? 'dashed' : 'solid';
  const outline = aside ? ASIDE_INK : t.color.stroke;
  const centred = kind !== 'line';
  const textLeft = t.x + padX + t.badgeW;
  const lineLeft = (i: number) => (centred ? textLeft + (t.textW - t.lineWidths[i]) / 2 : textLeft);
  const part = (p: Omit<Skeleton, 'id'> & { id: string }) => out.push({ roughness: 1, groupIds, ...p });

  // Highlight swipes sit behind everything else of the topic, as in renderMap.
  if (em === 'highlight') {
    t.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const by = t.y + t.textTop + i * lineHeight + lineHeight / 2 + fontSize * 0.34;
      const top = by - fontSize * 0.8;
      part({
        type: 'rectangle', id: `${t.id}:highlight${i}`, x: r1(lineLeft(i) - 4), y: r1(top),
        width: r1(t.lineWidths[i] + 8), height: r1(fontSize * 1.08), strokeColor: 'transparent',
        backgroundColor: HIGHLIGHTER, fillStyle: 'solid', roundness: null, seed: seed + 40 + i,
      });
    });
  }

  if (kind === 'line') {
    part({
      type: 'line', id: `${t.id}:shape`, x: t.x, y: t.y + t.h, points: [[0, 0], [t.w, 0]], width: t.w, height: 0,
      strokeColor: outline, strokeWidth: topicStrokeWidth(kind, em), strokeStyle, roundness: null, seed,
    });
  } else {
    part({
      type: 'rectangle', id: `${t.id}:shape`, x: t.x, y: t.y, width: t.w, height: t.h, strokeColor: outline,
      backgroundColor: aside || kind === 'small' ? 'transparent' : t.color.fill, fillStyle: key ? 'solid' : 'hachure',
      strokeWidth: topicStrokeWidth(kind, em), strokeStyle, roundness: { type: 3 }, seed,
    });
  }

  // Only keys of the stored-image form, as on the canvas: a hand-edited map can't point the export elsewhere.
  if (t.image && t.node.image && IMAGE_KEY_RE.test(t.node.image.key)) {
    const box = { x: t.x + t.image.x, y: t.y + t.image.y, width: t.image.w, height: t.image.h };
    const fileId = fileIds.get(t.node.image.key);
    if (fileId) {
      part({ type: 'image', id: `${t.id}:image`, ...box, fileId, status: 'saved', scale: [1, 1], strokeColor: 'transparent', seed: seed + 5 });
    }
    part({
      type: 'rectangle', id: `${t.id}:frame`, ...box, strokeColor: t.color.stroke, backgroundColor: 'transparent',
      strokeWidth: 1, roundness: null, seed: seed + 6,
    });
  }

  if (t.lines.join('').trim()) {
    const shown = t.segments.flat().filter((s) => s.text.trim());
    const href = shown.find((s) => s.href)?.href ?? null;
    const allLink = shown.length > 0 && shown.every((s) => s.href);
    part({
      type: 'text', id: `${t.id}:text`, x: textLeft, y: t.y + t.textTop, text: t.lines.join('\n'),
      fontSize, fontFamily: EXCALIFONT, textAlign: centred ? 'center' : 'left', verticalAlign: 'top',
      lineHeight: lineHeight / fontSize, strokeColor: allLink ? LINK_COLOR : aside ? ASIDE_INK : INK, link: href,
      seed: seed + 1,
    });
    if (centred) centres.set(`${t.id}:text`, { x: textLeft + t.textW / 2 });
  }

  if (t.node.priority) {
    const d = badgeSize(fontSize);
    const cx = lineLeft(0) - t.badgeW + d / 2;
    const cy = t.y + t.textTop + lineHeight / 2;
    const color = PRIORITY_COLORS[t.node.priority];
    part({
      type: 'ellipse', id: `${t.id}:badge`, x: cx - d / 2, y: cy - d / 2, width: d, height: d, strokeColor: color,
      backgroundColor: color, fillStyle: 'solid', strokeWidth: 1, seed: seed + 50,
    });
    part({
      type: 'text', id: `${t.id}:badge-text`, x: cx, y: cy, text: String(t.node.priority), fontSize: Math.round(d * 0.62),
      fontFamily: EXCALIFONT, textAlign: 'center', verticalAlign: 'middle', strokeColor: '#ffffff', seed: seed + 51,
    });
    centres.set(`${t.id}:badge-text`, { x: cx, y: cy });
  }

  if (t.depth > 0 && t.node.collapsed && t.node.children.length > 0) {
    const { x: cx, y: cy } = t.fold;
    part({
      type: 'ellipse', id: `${t.id}:fold`, x: cx - 10, y: cy - 10, width: 20, height: 20, strokeColor: t.color.stroke,
      backgroundColor: t.color.fill, fillStyle: 'solid', strokeWidth: 1, seed: seed + 9,
    });
    part({
      type: 'text', id: `${t.id}:fold-text`, x: cx, y: cy, text: String(countDescendants(t.node)), fontSize: 12,
      fontFamily: EXCALIFONT, textAlign: 'center', verticalAlign: 'middle', strokeColor: INK, seed: seed + 10,
    });
    centres.set(`${t.id}:fold-text`, { x: cx, y: cy });
  }
}

/**
 * The map as Excalidraw skeletons, in drawing order: branches first, then each topic's parts (grouped, so a topic
 * moves as one in Excalidraw). Mirrors renderMap's geometry; notes, link underlines and editor-only controls are left out.
 */
export function toExcalidrawSkeleton(layout: MapLayout, fileIds: ReadonlyMap<string, string>): SkeletonScene {
  const elements: Skeleton[] = layout.branches.map(branch);
  const centres: SkeletonScene['centres'] = new Map();
  for (const t of layout.boxes) topic(t, fileIds, elements, centres);
  return { elements, centres };
}
```

Notes for the implementer:
- `countDescendants` is exported by `src/model/tree.ts` (the renderer already imports it from there). If its name differs, use the function `renderMap.ts` uses for the folded counter.
- If a test expectation disagrees with the geometry `renderMap.ts` draws (e.g. `layout.byId`, `t.fold`, the badge position), `renderMap.ts` is the authority: fix the test to mirror it and say so in the report.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/io/excalidraw.test.ts src/render src/layout`
Expected: PASS. Then `npm run typecheck` — Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/io/excalidraw.ts src/io/excalidraw.test.ts src/layout/styles.ts src/render/renderMap.ts
git commit -m "feat(export): map the laid-out map to Excalidraw element skeletons

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Build the `.excalidraw` file with the pinned library, loaded on demand

**Files:**
- Modify: `src/io/excalidraw.ts` (add `buildExcalidraw`, `EXCALIDRAW_MIME`)
- Create: `src/io/excalidrawFile.test.ts` (jsdom; runs the real library)
- Modify: `vitest.config.ts` (inline the package for tests)
- Modify: `package.json` (move `"@excalidraw/excalidraw": "0.18.1"` from `devDependencies` to `dependencies`; keep the exact version), then `npm install` to refresh `package-lock.json`
- Modify: `src/io/exportImage.ts` (`fileName` accepts `'excalidraw'`)

**Interfaces:**
- Consumes: `toExcalidrawSkeleton`, `fileIdFor`, `Skeleton` (Task 1); `bytesToBase64` from `src/io/exportImage.ts`; `IMAGE_KEY_RE`.
- Produces:
  - `export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json';`
  - `export async function buildExcalidraw(layout: MapLayout, opts?: { fetchImpl?: typeof fetch; source?: string }): Promise<string>` — the scene file's JSON text.
  - `fileName(title, 'excalidraw')` → `"<title>.excalidraw"`.

- [ ] **Step 1: Let Vitest load the package** — in `vitest.config.ts`, inside `test`, add:

```ts
    // @excalidraw/excalidraw ships ESM that imports JSON without an import attribute, which Node refuses;
    // letting Vite transform it (only the test that loads it pays for this) makes it importable.
    server: { deps: { inline: [/@excalidraw\/excalidraw/, /open-color/] } },
```

- [ ] **Step 2: Move the dependency.** In `package.json`, delete `"@excalidraw/excalidraw": "0.18.1",` from `devDependencies` and add it (same exact string, alphabetical order) to `dependencies`. Run `npm install` (no version change; it only rewrites the lockfile's `dev` flags). Confirm with `git diff package.json package-lock.json` that the version is still exactly `0.18.1`.

- [ ] **Step 3: Write the failing test** — `src/io/excalidrawFile.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import type { MapNode } from '../shared/types';
import { buildExcalidraw, fileIdFor } from './excalidraw';
import { fileName } from './exportImage';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text, children, ...extra });
const KEY = 'img/AAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBB.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(() => {
  // jsdom has no FontFace; the library constructs (but never loads) font faces while measuring text.
  globalThis.FontFace ??= class {
    constructor(public family: string, public source: string, public descriptors?: object) {}
  } as unknown as typeof FontFace;
});

const okFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === `/${KEY}`) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  return new Response('nope', { status: 404 });
}) as typeof fetch;

describe('buildExcalidraw', () => {
  it('writes a scene Excalidraw itself restores, with our ids, Excalifont text and the image in files', async () => {
    const root = n('r', 'Root', [n('a', 'Alpha', [n('b', 'Beta')]), n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } })]);
    const layout = layoutMap(root, 'map', measure);
    const json = await buildExcalidraw(layout, { fetchImpl: okFetch, source: 'https://sketchmap.test' });
    const file = JSON.parse(json);
    expect(file).toMatchObject({ type: 'excalidraw', version: 2, source: 'https://sketchmap.test', appState: { viewBackgroundColor: '#ffffff' } });

    const { restore } = await import('@excalidraw/excalidraw');
    const restored = restore(file, null, null);
    const ids = restored.elements.map((e) => e.id);
    expect(ids).toEqual(file.elements.map((e: { id: string }) => e.id)); // nothing dropped on load
    expect(ids).toEqual(expect.arrayContaining(['r:shape', 'r:text', 'a:branch', 'b:shape', 'i:image', 'i:frame']));

    const text = restored.elements.find((e) => e.id === 'a:text')!;
    expect(text).toMatchObject({ type: 'text', text: 'Alpha', fontFamily: 5 });
    const id = fileIdFor(KEY);
    expect(restored.elements.find((e) => e.id === 'i:image')).toMatchObject({ type: 'image', fileId: id });
    expect(restored.files[id]).toMatchObject({ id, mimeType: 'image/png' });
    expect(restored.files[id].dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it('centres box text on the topic after Excalidraw measures it', async () => {
    const layout = layoutMap(n('r', 'Root words'), 'map', measure);
    const r = layout.byId.get('r')!;
    const file = JSON.parse(await buildExcalidraw(layout, { fetchImpl: okFetch }));
    const text = file.elements.find((e: { id: string }) => e.id === 'r:text');
    expect(text.x + text.width / 2).toBeCloseTo(r.x + r.style.padX + r.badgeW + r.textW / 2, 5);
  });

  it('drops an image that fails to load, keeping its frame, and never fetches a foreign key', async () => {
    const calls: string[] = [];
    const failing = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('gone', { status: 404 });
    }) as typeof fetch;
    const root = n('r', 'Root', [
      n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } }),
      n('x', 'Evil', [], { image: { key: 'https://evil.example/x.png', w: 120, h: 80 } }),
    ]);
    const file = JSON.parse(await buildExcalidraw(layoutMap(root, 'map', measure), { fetchImpl: failing }));
    const ids = file.elements.map((e: { id: string }) => e.id);
    expect(ids).toContain('i:frame');
    expect(ids).not.toContain('i:image');
    expect(file.files).toEqual({});
    expect(calls).toEqual([`/${KEY}`]);
  });

  it('refuses a response that is not an image type it knows', async () => {
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const root = n('r', 'Root', [n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } })]);
    const file = JSON.parse(await buildExcalidraw(layoutMap(root, 'map', measure), { fetchImpl: html }));
    expect(file.files).toEqual({});
  });
});

describe('fileName', () => {
  it('names the download .excalidraw', () => {
    expect(fileName('My map', 'excalidraw')).toBe('My map.excalidraw');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/io/excalidrawFile.test.ts`
Expected: FAIL — `buildExcalidraw` is not exported (and a type error for `fileName(…, 'excalidraw')`).

- [ ] **Step 5: Implement.**

In `src/io/exportImage.ts`, widen `fileName`'s parameter: `ext: 'svg' | 'png' | 'excalidraw'`.

Append to `src/io/excalidraw.ts` (add `import { bytesToBase64 } from './exportImage';` to the imports):

```ts
/** Excalidraw's own media type for scene files. */
export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface BinaryFile { id: string; mimeType: string; dataURL: string; created: number; lastRetrieved: number }

/** Fetches each stored topic image once; a failed or non-image response leaves that image out. */
async function loadFiles(layout: MapLayout, fetchImpl: typeof fetch) {
  const keys = new Set<string>();
  for (const b of layout.boxes) if (b.image && b.node.image && IMAGE_KEY_RE.test(b.node.image.key)) keys.add(b.node.image.key);
  const files: Record<string, BinaryFile> = {};
  const fileIds = new Map<string, string>();
  const now = Date.now();
  await Promise.all([...keys].map(async (key) => {
    try {
      const res = await fetchImpl(`/${key}`);
      const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!res.ok || !IMAGE_MIMES.has(mimeType)) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const id = fileIdFor(key);
      files[id] = { id, mimeType, dataURL: `data:${mimeType};base64,${bytesToBase64(bytes)}`, created: now, lastRetrieved: now };
      fileIds.set(key, id);
    } catch {
      // Left out, as the SVG export does; the frame still marks where it was.
    }
  }));
  return { files, fileIds };
}

/**
 * The `.excalidraw` file for the laid-out map (spec §9). The pinned library is loaded here, on demand, so it never
 * weighs on the editor or the embed.
 */
export async function buildExcalidraw(
  layout: MapLayout,
  opts: { fetchImpl?: typeof fetch; source?: string } = {},
): Promise<string> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const [{ convertToExcalidrawElements }, { files, fileIds }] = await Promise.all([
    import('@excalidraw/excalidraw'),
    loadFiles(layout, fetchImpl),
  ]);
  const { elements: skeletons, centres } = toExcalidrawSkeleton(layout, fileIds);
  const converted = convertToExcalidrawElements(
    skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  const elements = converted.map((e) => {
    const c = centres.get(e.id);
    if (!c) return e;
    return { ...e, x: c.x - e.width / 2, ...(c.y === undefined ? {} : { y: c.y - e.height / 2 }) };
  });
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: opts.source ?? location.origin,
    elements,
    appState: { viewBackgroundColor: '#ffffff' },
    files,
  }, null, 2);
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/io` then `npm test` and `npm run typecheck`.
Expected: all PASS. If the library's `restore` signature differs from `restore(data, localAppState, localElements)`, check `node_modules/@excalidraw/excalidraw/dist/types/excalidraw/data/restore.d.ts` and adapt the test call only.

- [ ] **Step 7: Check the chunking.** Run `npm run build`, then `ls -la dist/client/assets/*.js | awk '{print $5, $9}' | sort -n | tail -8`. Baselines on `main` (9a7926f): `index-*.js` 336,416 B, `EditorPage-*.js` 40,007 B. Expected: both within +10 KB of those; the library lands in separate, larger chunk(s). Record the sizes in the report. If the entry or EditorPage chunk grew by the library, something imports it statically — find and fix it.

- [ ] **Step 8: Commit**

```bash
git add src/io/excalidraw.ts src/io/excalidrawFile.test.ts src/io/exportImage.ts vitest.config.ts package.json package-lock.json
git commit -m "feat(export): build .excalidraw files with the pinned library, loaded on demand

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The Excalidraw button, end-to-end proof under the strict CSP, docs

**Files:**
- Modify: `src/editor/EditorPage.tsx` (button, busy state, notice)
- Modify: `src/editor/EditorPage.test.tsx` (button wiring)
- Modify: `e2e/smoke.spec.ts` (download and parse)
- Modify: `e2e/prod.spec.ts` (works under production CSP)
- Modify: `README.md`, `docs/superpowers/specs/2026-11-12-sketchmap-design.md` §9

**Interfaces:**
- Consumes: `buildExcalidraw`, `excalidrawLosses`, `EXCALIDRAW_MIME` (Tasks 1–2); `download`, `fileName` from `src/io/exportImage.ts`.
- Produces: a toolbar button with accessible name **Excalidraw** (exact), and after a download a status banner reading `Downloaded. Not kept in .excalidraw: <losses joined by ", ">.` when there are losses.

- [ ] **Step 1: Rename the Markdown-only notice to a general one.** In `src/editor/EditorPage.tsx`, rename the state `mdNotice`/`setMdNotice` to `notice`/`setNotice` (all uses; behaviour unchanged).

- [ ] **Step 2: Extend `exportAs`.** Replace the current `exportAs` with:

```tsx
  const [exporting, setExporting] = useState(false);
  const exportAs = async (kind: 'svg' | 'png' | 'excalidraw') => {
    if (exporting) return;
    setExporting(true);
    try {
      setExportError(undefined);
      if (kind === 'excalidraw') {
        const json = await buildExcalidraw(layout);
        download(new Blob([json], { type: EXCALIDRAW_MIME }), fileName(state.map.title, 'excalidraw'));
        const lost = excalidrawLosses(layout);
        setNotice(lost.length ? `Downloaded. Not kept in .excalidraw: ${lost.join(', ')}.` : null);
        return;
      }
      const svg = await buildSvg(layout, visibleText(layout));
      const blob = kind === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      download(blob, fileName(state.map.title, kind));
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };
```

(Place the `useState` with the other state hooks at the top of `Editor`, not inline, to respect the rules of hooks. Import `buildExcalidraw, EXCALIDRAW_MIME, excalidrawLosses` from `'../io/excalidraw'` — a static import of *our* module is fine; it only reaches the library through its dynamic `import()`.)

- [ ] **Step 3: Add the button** next to SVG and PNG in the toolbar `extra`:

```tsx
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('svg')} disabled={exporting}>SVG</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('png')} disabled={exporting}>PNG</button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => exportAs('excalidraw')}
                disabled={exporting}
                title="Download a .excalidraw file to keep drawing in Excalidraw"
              >
                Excalidraw
              </button>
```

- [ ] **Step 4: Unit test the wiring** in `src/editor/EditorPage.test.tsx`. Follow the file's existing render helper and mocking style. Mock the module boundary with `vi.mock('../io/excalidraw', async (orig) => ({ ...(await orig()), buildExcalidraw: vi.fn(async () => '{"type":"excalidraw"}') }))` and spy on `download` (mock `'../io/exportImage'` partially the same way, keeping `fileName`). Cases:
  1. Clicking **Excalidraw** calls `buildExcalidraw` once and `download` with a Blob of type `application/vnd.excalidraw+json` and filename `<title>.excalidraw`; for a map whose topic has a note, the status banner then reads `Downloaded. Not kept in .excalidraw: notes.`
  2. While `buildExcalidraw`'s promise is pending, all three export buttons are disabled; a second click does not call it again.
  3. When `buildExcalidraw` rejects with `new Error('boom')`, the alert banner reads `Export failed: boom` and the buttons are enabled again.

Run: `npx vitest run src/editor/EditorPage.test.tsx` — Expected: PASS.

- [ ] **Step 5: End-to-end (dev).** Append to `e2e/smoke.spec.ts` (it already imports `PNG_2x2` and `openNewMap`):

```ts
test('the Excalidraw export downloads a scene with the topics, their text and the image file', async ({ page }) => {
  await openNewMap(page);
  await page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_2x2 });
  await expect(page.locator('g.topic image.topic-image')).toHaveCount(1);
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
```

Note: the new topic's default text may differ from typing into an empty topic — mirror how the existing first test creates "Alpha" if this sequence doesn't produce it.

- [ ] **Step 6: End-to-end (production CSP).** In `e2e/prod.spec.ts`, right after the PNG download assertion (`expect((await download).suggestedFilename()).toMatch(/\.png$/);`), add:

```ts
  // The pinned Excalidraw library loads as a separate same-origin chunk and runs under script-src 'self'.
  const excalidraw = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excalidraw' }).click();
  expect((await excalidraw).suggestedFilename()).toMatch(/\.excalidraw$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(violations).toEqual([]);
```

- [ ] **Step 7: Run e2e** (from the main checkout only — worktrees lack the untracked `.dev.vars`): `npx playwright test`. Expected: all pass (dev and prod projects). If you are in a worktree, skip this step and say so in the report; the controller runs it.

- [ ] **Step 8: Docs.**
  - `README.md`: in the features list near the SVG/PNG export line, add: "**Excalidraw export:** downloads a `.excalidraw` file (open it at excalidraw.com, or drag it onto an Excalidraw canvas) with boxes, branches, text in Excalifont, highlight swipes, priority badges and images. Each topic's parts are grouped. Notes aren't included, a topic keeps only its first link, and folded branches stay folded; the editor lists what was left out." In the "Not yet checked" line, add "opening the `.excalidraw` export in excalidraw.com".
  - Spec §9 "`.excalidraw` out": add two bullets: "Mirrors what the canvas shows: folded branches stay folded (with their counter). Notes are not carried; a text element keeps the topic's first link. The editor lists what was left out." and "Each topic's parts share a group, so a topic moves as one in Excalidraw; branches are unbound lines."

- [ ] **Step 9: Commit**

```bash
git add src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx e2e/smoke.spec.ts e2e/prod.spec.ts README.md docs/superpowers/specs/2026-11-12-sketchmap-design.md
git commit -m "feat(editor): Excalidraw export button, proven under the production CSP

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
