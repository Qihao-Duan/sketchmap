# Sketchmap Step 2 ("Text in and out") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Markdown outlines into topics and topics back into Markdown, and add the logic-chart and org-chart layouts. Both features go into the live editor and the Notion view.

**Architecture:**
- Pure layout functions stay DOM-free. The balanced map, the logic chart and the org chart all return the same `MapLayout` shape, and a small dispatcher `layoutMap(root, kind, measure)` picks one.
- Markdown conversion is a pure module in `src/io/`.
- The editor gains three reducer actions (`setLayout`, `pasteNodes`, `replaceRoot`), a layout switcher, an Outline panel, "Copy as Markdown", and paste-to-add.

**Tech Stack:** unchanged from step 1 (React 19, Vite 8, TypeScript 5.9, immer, roughjs, Vitest 4, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md`. See §4 (paste), §5 (layouts), §6 (styles), §9 (Markdown) and §11 step 2.

**Builds on:** `main` at `ce79618`. That is step 1, deployed and checked in Notion.

## Global Constraints

Copied from the spec, plus the step-1 code these tasks must keep working.

- **Layouts** (spec §5): `map` is the default; `logic` grows every branch to the right.
- **`org` layout:**
  - Top-down. First-level branches spread out horizontally.
  - **From depth 2, children stack vertically under their parent.**
  - Gaps (this plan's values): `rootGap 56`, `colGap 40`, `indent 28`, `rowGap 10`.
- **Styles** (spec §6):
  - Depth 0 is `root` at 28 px; depth 1 is `box` at 20 px; depth 2+ is `line` (underlined) at 17 px.
  - **In `org`, depth 2+ topics are small unfilled boxes**: kind `small`, 17 px, `padX 11`, `padY 7`, `maxW 200`, `lineHeight 22`.
- **No overlap:** for every layout, the "no two topics overlap" property test must hold.
- **Markdown out** (spec §9): `# Root`, then nested `- ` bullets with 2 spaces per level. It pastes straight into Notion as a nested list. Multi-line topic text is joined into one line with single spaces.
- **Markdown in** (spec §9):
  - Headings and nested bullets with any indent width are accepted; a tab counts as 4 spaces.
  - `- `, `* `, `+ `, `• `, `1. ` and `1) ` are bullets, and `[ ]` / `[x]` checkbox prefixes are dropped.
  - A single top-level item becomes the root. Otherwise the items go under a root called **"Outline"**.
  - Topic text is cut to 5000 characters, the schema limit.
- **Paste** (spec §4): multi-line text is parsed as an outline and added under the selected topic. The first pasted topic becomes selected, and the whole paste is one undo step.
- **Persistence:** the chosen layout is saved with the map (`MindMap.layout`). It is an undoable change and autosaves like any other edit.
- **View:** the Notion view uses the map's saved layout and fits small maps up to **150%** zoom (`fitMaxK 1.5`). It still never captures a plain mouse wheel.
- **Keep working:**
  - all 125 unit tests, 12 Worker tests and 2 e2e tests
  - the markup contract: `g.topic[data-id]` with `rect.hit` as the first child, and `g.fold[data-fold]` (`.folded`)
  - `InlineEditor` text alignment: `line` is left-aligned, every other kind is centred
- **Not in step 2:** importance, priority, markers, notes, links, images, `.xmind` import, `.excalidraw` export. These are steps 3 and 4.

## File Structure

```
src/layout/styles.ts     + 'small' kind, styleFor(depth, kind), ORG gaps
src/layout/map.ts        TopicBox gains `fold` (toggle position); exports measureTopic(…, kind) and boundsOf();
                         computeLayout(root, measure, kind: 'map' | 'logic' = 'map')
src/layout/org.ts        NEW computeOrgLayout(root, measure)
src/layout/index.ts      NEW layoutMap(root, kind, measure), the one entry point the UI uses
src/render/renderMap.ts  draws 'small' boxes; the fold toggle uses t.fold
src/io/markdown.ts       NEW toMarkdown(root), parseOutline(text)
src/editor/store.ts      + setLayout, pasteNodes, replaceRoot actions
src/editor/OutlinePanel.tsx  NEW
src/editor/EditorPage.tsx    layout switcher, Outline, Copy as Markdown, paste handler, refit on layout change
src/view/ViewPage.tsx    saved layout + fitMaxK 1.5
src/app.css              switcher and outline panel styles
e2e/smoke.spec.ts        + a layout/paste/persist/view test
README.md                Known limitations: the small-map line changes
```

---

### Task 1: Logic and org layouts, the `small` style, and fold positions

**Files:**
- Modify: `src/layout/styles.ts`, `src/layout/map.ts`, `src/render/renderMap.ts`
- Create: `src/layout/org.ts`, `src/layout/index.ts`
- Test: `src/layout/map.test.ts` (extend), `src/layout/org.test.ts` (new), `src/render/renderMap.test.ts` (extend)

**Interfaces:**
- **Changes:**
  - `TopicKind` gains `'small'`.
  - `styleFor(depth: number, kind: LayoutKind = 'map'): NodeStyle`
  - `TopicBox` gains `fold: { x: number; y: number }`, the centre of the fold toggle. Every layout sets it.
  - Exported: `measureTopic(node, depth, measure, kind = 'map')` and `boundsOf(boxes): Bounds`.
  - `computeLayout(root, measure, kind: 'map' | 'logic' = 'map')`. Existing two-argument calls keep working.
  - `computeOrgLayout(root, measure): MapLayout`, in `org.ts`.
  - `layoutMap(root: MapNode, kind: LayoutKind, measure: Measure): MapLayout`, in `index.ts`.
  - `ORG = { rootGap: 56, colGap: 40, indent: 28, rowGap: 10 }`, in `styles.ts`.
- **Renderer:** `renderMap` draws the fold toggle at `t.fold`. It no longer imports `anchorOut`.

- [ ] **Step 1: Write the failing tests**

Append to `src/layout/map.test.ts`, inside the existing `describe` block after the last test:

```ts
  it('logic chart: every first-level branch grows to the right, in order', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A'), n('b', 'B'), n('c', 'C')]), measure, 'logic');
    const [a, b, c] = ['a', 'b', 'c'].map((id) => l.byId.get(id)!);
    expect([a.side, b.side, c.side]).toEqual([1, 1, 1]);
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });

  it('puts the fold toggle 11 px beyond where the branch leaves the topic', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1', [n('x', 'X')])]), n('b', 'B', [n('b1', 'B1')])]), measure);
    const a = l.byId.get('a')!; // right side, box
    expect(a.fold).toEqual({ x: a.x + a.w + 11, y: a.y + a.h / 2 });
    const b = l.byId.get('b')!; // left side, box
    expect(b.fold).toEqual({ x: b.x - 11, y: b.y + b.h / 2 });
    const a1 = l.byId.get('a1')!; // underlined topic: toggle sits on the underline
    expect(a1.fold).toEqual({ x: a1.x + a1.w + 11, y: a1.y + a1.h });
  });
```

Then add a new block at the end of `src/layout/map.test.ts`. It reuses `mulberry32`, `randomTree` and `measure` from that file:

```ts
import { layoutMap } from './index';

describe('layoutMap (all layouts)', () => {
  it.each(['map', 'logic', 'org'] as const)('never overlaps topics in 150 random maps: %s', (kind) => {
    const rand = mulberry32(7);
    for (let k = 0; k < 150; k++) {
      const l = layoutMap(randomTree(rand), kind, measure);
      expect(l.branches).toHaveLength(l.boxes.length - 1);
      for (let i = 0; i < l.boxes.length; i++) {
        for (let j = i + 1; j < l.boxes.length; j++) {
          const a = l.boxes[i], b = l.boxes[j];
          const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
          expect(overlap, `${kind}: ${a.id} overlaps ${b.id} in tree ${k}`).toBe(false);
        }
      }
    }
  });
});
```

Move the `import { layoutMap } from './index';` line up to sit with the other imports at the top of the file.

`src/layout/org.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeOrgLayout } from './org';
import { ORG, PALETTE } from './styles';
import type { Measure } from './wrap';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode =>
  ({ id, text, children, ...extra });
const tree = () =>
  n('r', 'Root', [
    n('a', 'Alpha', [n('a1', 'A one', [n('a11', 'Deep')]), n('a2', 'A two')]),
    n('b', 'Beta', [n('b1', 'B one')]),
  ]);

describe('computeOrgLayout', () => {
  it('puts the root on top, centred on x = 0', () => {
    const r = computeOrgLayout(tree(), measure).byId.get('r')!;
    expect([r.x + r.w / 2, r.y]).toEqual([0, 0]);
  });

  it('lays first-level branches out in one row, left to right, under the root', () => {
    const l = computeOrgLayout(tree(), measure);
    const [r, a, b] = ['r', 'a', 'b'].map((id) => l.byId.get(id)!);
    expect(a.y).toBe(r.h + ORG.rootGap);
    expect(b.y).toBe(a.y);
    expect(a.x + a.w).toBeLessThan(b.x);
    expect([a.style.kind, a.color]).toEqual(['box', PALETTE[0]]);
    expect(b.color).toEqual(PALETTE[1]);
  });

  it('stacks deeper levels vertically under their parent, indented, as small boxes', () => {
    const l = computeOrgLayout(tree(), measure);
    const [a, a1, a11, a2] = ['a', 'a1', 'a11', 'a2'].map((id) => l.byId.get(id)!);
    expect(a1.x).toBe(a.x + ORG.indent);
    expect(a11.x).toBe(a1.x + ORG.indent);
    expect(a2.x).toBe(a1.x);
    expect(a1.y).toBe(a.y + a.h + ORG.rowGap);
    expect(a11.y).toBe(a1.y + a1.h + ORG.rowGap);
    expect(a2.y).toBe(a11.y + a11.h + ORG.rowGap);
    expect([a1.style.kind, a11.style.kind]).toEqual(['small', 'small']);
    expect(a1.color).toEqual(PALETTE[0]);
  });

  it('hides folded branches and puts fold toggles to the right of each topic', () => {
    const t = tree();
    t.children[0].collapsed = true;
    const l = computeOrgLayout(t, measure);
    expect(l.byId.has('a1')).toBe(false);
    const a = l.byId.get('a')!;
    expect(a.fold).toEqual({ x: a.x + a.w + 11, y: a.y + a.h / 2 });
  });

  it('draws one branch per non-root topic, starting at the root bottom centre', () => {
    const l = computeOrgLayout(tree(), measure);
    expect(l.branches).toHaveLength(l.boxes.length - 1);
    const r = l.byId.get('r')!;
    expect(l.branches.find((b) => b.to === 'a')!.d.startsWith(`M0 ${r.h} C`)).toBe(true);
    expect(l.branches.find((b) => b.to === 'a1')!.d).toMatch(/^M[\d.-]+ [\d.-]+ L/);
  });
});
```

Append to `src/render/renderMap.test.ts`, inside its `describe`:

```ts
  it('draws org-chart deep topics as unfilled outlines', async () => {
    const { computeOrgLayout } = await import('../layout/org');
    const { PALETTE } = await import('../layout/styles');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const layout = computeOrgLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] }, measure);
    renderMap(svg, world, layout, { selectedId: null });
    const small = world.querySelector('g.topic[data-id="a1"]')!;
    const strokes = [...small.querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain(PALETTE[0].fill); // no hachure fill
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/layout src/render`
Expected: FAIL. `./org` and `./index` are missing, `computeLayout` ignores `'logic'`, and boxes have no `fold`.

- [ ] **Step 3: Implement**

**3a. `src/layout/styles.ts`**

Replace the `TopicKind` line and `styleFor`, and add `ORG` after `GAP`:

```ts
import type { LayoutKind } from '../shared/types';

export type TopicKind = 'root' | 'box' | 'line' | 'small';
```

```ts
export function styleFor(depth: number, kind: LayoutKind = 'map'): NodeStyle {
  if (depth === 0) return { kind: 'root', fontSize: 28, padX: 26, padY: 15, maxW: 300, lineHeight: 36 };
  if (depth === 1) return { kind: 'box', fontSize: 20, padX: 16, padY: 9, maxW: 230, lineHeight: 26 };
  if (kind === 'org') return { kind: 'small', fontSize: 17, padX: 11, padY: 7, maxW: 200, lineHeight: 22 };
  return { kind: 'line', fontSize: 17, padX: 5, padY: 4, maxW: 250, lineHeight: 22 };
}
```

```ts
/** Org chart spacing: root → first row, between columns, per-level indent, between stacked rows. */
export const ORG = { rootGap: 56, colGap: 40, indent: 28, rowGap: 10 } as const;
```

**3b. `src/layout/map.ts`.** Make these edits; everything else stays.

1. Add `fold` to `TopicBox`, right after `color: BranchColor;`:

```ts
  /** Centre of the fold toggle: just beyond where branches leave this topic. */
  fold: { x: number; y: number };
```

2. Import the layout kind at the top:

```ts
import type { LayoutKind, MapNode } from '../shared/types';
```

This replaces the existing `import type { MapNode } …` line.

3. Replace `function measureTopic(…)` with an exported version that takes the kind:

```ts
export function measureTopic(node: MapNode, depth: number, measure: Measure, kind: LayoutKind = 'map'): Measured {
  const style = styleFor(depth, kind);
  const lines = wrapText(node.text || ' ', style.fontSize, style.maxW, measure);
  const textW = Math.max(style.fontSize * 1.6, ...lines.map((l) => measure(l, style.fontSize)));
  return {
    style,
    lines,
    w: Math.ceil(textW + style.padX * 2),
    h: Math.ceil(lines.length * style.lineHeight + style.padY * 2),
  };
}

export function boundsOf(boxes: TopicBox[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
```

Also export the `Measured` interface (`export interface Measured …`), so `org.ts` can use it.

4. Change the `computeLayout` signature, and pass `kind` into measuring:

```ts
export function computeLayout(root: MapNode, measure: Measure, kind: 'map' | 'logic' = 'map'): MapLayout {
```

In `measureAll`, use `measureTopic(n, depth, measure, kind)`.

5. In `add(…)`, build the box with `fold` set:

```ts
    const fs: 1 | -1 = side === -1 ? -1 : 1;
    const box: TopicBox = {
      id: n.id, node: n, parentId, depth, side, x, y, w: m.w, h: m.h, style: m.style, lines: m.lines, color,
      fold: { x: 0, y: 0 },
    };
    const [ox, oy] = anchorOut(box, fs);
    box.fold = { x: ox + fs * 11, y: oy };
```

The old single-line `const box: TopicBox = { … }` is replaced by these lines.

6. In the right/left split, make `logic` send everything right:

```ts
  if (kind === 'logic') {
    right.push(...kids);
  } else {
    let acc = 0;
    for (const c of kids) {
      if (right.length === 0 || acc < total / 2) {
        right.push(c);
        acc += blockH.get(c.id)!;
      } else {
        left.push(c);
      }
    }
    left.reverse(); // clockwise reading order, as in XMind
  }
```

This replaces the existing `let acc = 0; for (…) {…} left.reverse();` lines.

7. Replace the min/max loop at the end with `return { boxes, byId, branches, bounds: boundsOf(boxes) };`.

**3c. `src/layout/org.ts`**

```ts
import type { MapNode } from '../shared/types';
import { visibleChildren } from '../model/tree';
import { boundsOf, measureTopic, type BranchPath, type MapLayout, type TopicBox } from './map';
import { ORG, PALETTE, ROOT_COLOR, type BranchColor } from './styles';
import type { Measure } from './wrap';

const r1 = (v: number) => Math.round(v * 10) / 10;

interface Row {
  node: MapNode;
  depth: number;
  parentId: string;
}

/** Org chart: root on top, first-level branches side by side, deeper levels as indented vertical lists. */
export function computeOrgLayout(root: MapNode, measure: Measure): MapLayout {
  const boxes: TopicBox[] = [];
  const byId = new Map<string, TopicBox>();
  const branches: BranchPath[] = [];

  const place = (n: MapNode, depth: number, x: number, y: number, color: BranchColor, parentId: string | null): TopicBox => {
    const m = measureTopic(n, depth, measure, 'org');
    const box: TopicBox = {
      id: n.id, node: n, parentId, depth, side: 0, x, y, w: m.w, h: m.h, style: m.style, lines: m.lines, color,
      fold: { x: x + m.w + 11, y: y + m.h / 2 },
    };
    boxes.push(box);
    byId.set(n.id, box);
    return box;
  };

  const rm = measureTopic(root, 0, measure, 'org');
  place(root, 0, -rm.w / 2, 0, ROOT_COLOR, null);

  // Each first-level branch becomes one column: its topics in reading order, indented by depth.
  const columns = visibleChildren(root).map((first) => {
    const rows: Row[] = [];
    const walk = (n: MapNode, depth: number, parentId: string) => {
      rows.push({ node: n, depth, parentId });
      visibleChildren(n).forEach((c) => walk(c, depth + 1, n.id));
    };
    walk(first, 1, root.id);
    const width = Math.max(...rows.map((r) => (r.depth - 1) * ORG.indent + measureTopic(r.node, r.depth, measure, 'org').w));
    return { rows, width };
  });

  const total = columns.reduce((s, c) => s + c.width, 0) + ORG.colGap * Math.max(0, columns.length - 1);
  const top = rm.h + ORG.rootGap;
  let x = -total / 2;
  columns.forEach((col, i) => {
    const color = PALETTE[i % PALETTE.length];
    let y = top;
    for (const row of col.rows) {
      const box = place(row.node, row.depth, x + (row.depth - 1) * ORG.indent, y, color, row.parentId);
      const p = byId.get(row.parentId)!;
      if (row.depth === 1) {
        const cx = box.x + box.w / 2;
        const mid = (p.y + p.h + box.y) / 2;
        branches.push({
          from: p.id, to: box.id, color, fromDepth: 0,
          d: `M0 ${r1(p.y + p.h)} C0 ${r1(mid)} ${r1(cx)} ${r1(mid)} ${r1(cx)} ${r1(box.y)}`,
        });
      } else {
        const px = p.x + ORG.indent / 2;
        const cy = box.y + box.h / 2;
        branches.push({
          from: p.id, to: box.id, color, fromDepth: p.depth,
          d: `M${r1(px)} ${r1(p.y + p.h)} L${r1(px)} ${r1(cy)} L${r1(box.x)} ${r1(cy)}`,
        });
      }
      y += box.h + ORG.rowGap;
    }
    x += col.width + ORG.colGap;
  });

  return { boxes, byId, branches, bounds: boundsOf(boxes) };
}
```

**3d. `src/layout/index.ts`**

```ts
import type { LayoutKind, MapNode } from '../shared/types';
import { computeLayout, type MapLayout } from './map';
import { computeOrgLayout } from './org';
import type { Measure } from './wrap';

/** The one entry point the editor, the view and export use. */
export function layoutMap(root: MapNode, kind: LayoutKind, measure: Measure): MapLayout {
  return kind === 'org' ? computeOrgLayout(root, measure) : computeLayout(root, measure, kind);
}
```

**3e. `src/render/renderMap.ts`**

- Change the import to `import type { MapLayout, TopicBox } from '../layout/map';`, dropping `anchorOut`.
- Before the final `else`, add a branch for `small`:

```ts
  } else if (t.style.kind === 'small') {
    g.appendChild(rc.path(roundedRect(t.x, t.y, t.w, t.h, r), { stroke, strokeWidth: 1.4, roughness: 1, seed }));
```

- In the fold block, replace these three lines:

```ts
    const side = t.side === -1 ? -1 : 1;
    const [ox, oy] = anchorOut(t, side);
    const cx = ox + side * 11;
```

with:

```ts
    const { x: cx, y: oy } = t.fold;
```

Keep the variable names `cx` and `oy` so the rest of the block is unchanged.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/layout src/render && npm test && npm run typecheck`
Expected: all pass, including the new tests, and typecheck is clean. Existing callers (EditorPage, ViewPage, export, Canvas tests) still call `computeLayout(root, measure)`, which defaults to `map`.

- [ ] **Step 5: Commit**

```bash
git add src/layout src/render
git commit -m "feat(layout): logic and org-chart layouts, small org boxes, fold positions from layout"
```

---

### Task 2: Markdown out and in

**Files:**
- Create: `src/io/markdown.ts`
- Test: `src/io/markdown.test.ts`

**Interfaces:**
- Consumes: `newNodeId` (`src/model/ids.ts`) and `MapNode`
- Produces:
  - `toMarkdown(root: MapNode): string`
  - `parseOutline(text: string): ParsedOutline | null`, where `ParsedOutline = { root: MapNode; synthetic: boolean }`. `synthetic` means the root is the generated "Outline" topic.

- [ ] **Step 1: Write the failing test**

`src/io/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { parseOutline, toMarkdown } from './markdown';

const n = (text: string, children: MapNode[] = []): MapNode => ({ id: text, text, children });
const shape = (node: MapNode): unknown => ({ t: node.text, c: node.children.map(shape) });

describe('toMarkdown', () => {
  it('writes the root as a heading and topics as nested bullets, 2 spaces per level', () => {
    const md = toMarkdown(n('Plan', [n('A', [n('A1')]), n('B')]));
    expect(md).toBe('# Plan\n- A\n  - A1\n- B\n');
  });
  it('joins multi-line topic text into one line', () => {
    expect(toMarkdown(n('Root', [n('two\n lines')]))).toBe('# Root\n- two lines\n');
  });
});

describe('parseOutline', () => {
  it('round-trips toMarkdown', () => {
    const tree = n('Plan', [n('A', [n('A1'), n('A2', [n('Deep')])]), n('B')]);
    const parsed = parseOutline(toMarkdown(tree))!;
    expect(parsed.synthetic).toBe(false);
    expect(shape(parsed.root)).toEqual(shape(tree));
    expect(parsed.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('accepts any indent width, tabs, numbers, other bullet marks and checkboxes', () => {
    const text = '- A\n    - A1\n\t\t- A1a\n* B\n1. C\n2) D\n+ E\n• F\n- [ ] todo\n- [x] done';
    const parsed = parseOutline(text)!;
    expect(parsed.synthetic).toBe(true);
    expect(parsed.root.text).toBe('Outline');
    expect(shape(parsed.root)).toEqual({
      t: 'Outline',
      c: [
        { t: 'A', c: [{ t: 'A1', c: [{ t: 'A1a', c: [] }] }] },
        { t: 'B', c: [] }, { t: 'C', c: [] }, { t: 'D', c: [] }, { t: 'E', c: [] }, { t: 'F', c: [] },
        { t: 'todo', c: [] }, { t: 'done', c: [] },
      ],
    });
  });

  it('nests bullets under headings and headings by level', () => {
    const parsed = parseOutline('# Root\n## Section\n- point\n  - detail\n## Other')!;
    expect(shape(parsed.root)).toEqual({
      t: 'Root',
      c: [{ t: 'Section', c: [{ t: 'point', c: [{ t: 'detail', c: [] }] }] }, { t: 'Other', c: [] }],
    });
  });

  it('treats one plain line as a single topic and ignores blank lines and empty bullets', () => {
    expect(shape(parseOutline('\n  Hello world  \n\n')!.root)).toEqual({ t: 'Hello world', c: [] });
    expect(shape(parseOutline('- A\n- \n- B')!.root)).toEqual({ t: 'Outline', c: [{ t: 'A', c: [] }, { t: 'B', c: [] }] });
  });

  it('clamps skipped levels and cuts topic text to 5000 characters', () => {
    const parsed = parseOutline(`- A\n        - jumped\n- ${'x'.repeat(6000)}`)!;
    expect(parsed.root.children[0].children[0].text).toBe('jumped');
    expect(parsed.root.children[1].text).toHaveLength(5000);
  });

  it('returns null for empty input', () => {
    expect(parseOutline('   \n\n')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/io/markdown.test.ts`
Expected: FAIL, "Cannot find module './markdown'".

- [ ] **Step 3: Implement**

`src/io/markdown.ts`:

```ts
import type { MapNode } from '../shared/types';
import { newNodeId } from '../model/ids';

const MAX_TEXT = 5000; // schema limit for topic text
const BULLET = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ').trim();

/** `# Root`, then nested `- ` bullets, 2 spaces per level. Pastes into Notion as a nested list. */
export function toMarkdown(root: MapNode): string {
  const out = [`# ${oneLine(root.text)}`];
  const walk = (node: MapNode, depth: number) => {
    for (const c of node.children) {
      out.push(`${'  '.repeat(depth)}- ${oneLine(c.text)}`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return `${out.join('\n')}\n`;
}

export interface ParsedOutline {
  root: MapNode;
  /** True when several top-level items were wrapped in a generated "Outline" root. */
  synthetic: boolean;
}

/** Headings and indented bullets (any indent width; a tab counts as 4 spaces) → a topic tree. */
export function parseOutline(text: string): ParsedOutline | null {
  const items: Array<{ depth: number; text: string }> = [];
  let headingDepth = -1;
  let indents: number[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      headingDepth = heading[1].length - 1;
      indents = [];
      items.push({ depth: headingDepth, text: heading[2].trim() });
      continue;
    }
    const body = raw.trimStart().replace(BULLET, '').trim();
    if (!body) continue;
    const indent = /^[\t ]*/.exec(raw)![0].replace(/\t/g, '    ').length;
    while (indents.length && indent < indents[indents.length - 1]) indents.pop();
    if (!indents.length || indent > indents[indents.length - 1]) indents.push(indent);
    items.push({ depth: headingDepth + indents.length, text: body });
  }
  if (!items.length) return null;

  const base = Math.min(...items.map((i) => i.depth));
  for (const i of items) i.depth -= base;
  const synthetic = !(items[0].depth === 0 && items.filter((i) => i.depth === 0).length === 1);
  const make = (t: string): MapNode => ({ id: newNodeId(), text: t.slice(0, MAX_TEXT), children: [] });
  const root = synthetic ? make('Outline') : make(items.shift()!.text);

  const chain: MapNode[] = [root];
  for (const it of items) {
    const depth = Math.max(1, Math.min(it.depth + (synthetic ? 1 : 0), chain.length));
    const node = make(it.text);
    chain.length = depth;
    chain[depth - 1].children.push(node);
    chain[depth] = node;
  }
  return { root, synthetic };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/io && npm run typecheck`
Expected: 7 markdown tests pass, plus the existing export tests, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/io/markdown.ts src/io/markdown.test.ts
git commit -m "feat(io): Markdown outline out and in"
```

---

### Task 3: Reducer actions for layout, paste and outline replace

**Files:**
- Modify: `src/editor/store.ts`
- Test: `src/editor/store.test.ts` (extend)

**Interfaces:**
- Consumes: `LayoutKind` and `MapNode`
- Produces three new `EditorAction` variants:
  - `{ type: 'setLayout'; layout: LayoutKind }`
  - `{ type: 'pasteNodes'; nodes: MapNode[] }` — appends the nodes under the selected topic and unfolds it. The first node becomes selected. One undo step.
  - `{ type: 'replaceRoot'; root: MapNode }` — replaces the whole tree as one undo step and selects the new root.

  All three bump `revision`, so they autosave. A no-op returns the same state.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` in `src/editor/store.test.ts`:

```ts
  it('setLayout changes the layout as one undo step; the same layout is a no-op', () => {
    const s0 = initEditor(base());
    expect(reduce(s0, { type: 'setLayout', layout: 'map' })).toBe(s0);
    let s = reduce(s0, { type: 'setLayout', layout: 'org' });
    expect([s.map.layout, s.revision, s.past.length]).toEqual(['org', 1, 1]);
    s = reduce(s, { type: 'undo' });
    expect(s.map.layout).toBe('map');
  });

  it('pasteNodes adds topics under the selection, unfolds it, selects the first, one undo step', () => {
    let s = reduce(reduce(initEditor(base()), { type: 'toggleFold', id: 'a' }), { type: 'select', id: 'a' });
    const pasted = [{ id: 'p1', text: 'P1', children: [{ id: 'p11', text: 'P11', children: [] }] }, { id: 'p2', text: 'P2', children: [] }];
    s = reduce(s, { type: 'pasteNodes', nodes: pasted });
    const a = s.map.root.children[0];
    expect(a.collapsed).toBeUndefined();
    expect(a.children.map((c) => c.id)).toEqual(['a1', 'p1', 'p2']);
    expect(s.selectedId).toBe('p1');
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.children[0].children.map((c) => c.id)).toEqual(['a1']);
    expect(reduce(s, { type: 'pasteNodes', nodes: [] })).toBe(s);
  });

  it('replaceRoot swaps the whole tree as one undo step', () => {
    let s = reduce(initEditor(base()), { type: 'replaceRoot', root: { id: 'nr', text: 'New', children: [] } });
    expect([s.map.root.text, s.selectedId, s.revision]).toEqual(['New', 'nr', 1]);
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.text).toBe('Root');
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/store.test.ts`
Expected: FAIL. The new action types are unknown (TypeScript errors, and the reducer returns `undefined`).

- [ ] **Step 3: Implement**

In `src/editor/store.ts`:

1. Change the type import to `import type { LayoutKind, MapNode, MindMap } from '../shared/types';`.
2. Add these three members to the `EditorAction` union:

```ts
  | { type: 'setLayout'; layout: LayoutKind }
  | { type: 'pasteNodes'; nodes: MapNode[] }
  | { type: 'replaceRoot'; root: MapNode }
```

3. Add these cases to `editorReducer`, before `case 'undo':`:

```ts
    case 'setLayout':
      return state.map.layout === action.layout ? state : commit(state, { ...state.map, layout: action.layout });

    case 'pasteNodes': {
      if (!action.nodes.length || !T.findNode(state.map.root, state.selectedId)) return state;
      const next = produce(state.map, (d) => {
        const f = T.findNode(d.root, state.selectedId)!;
        delete f.node.collapsed;
        f.node.children.push(...action.nodes);
      });
      return commit(state, next, { selectedId: action.nodes[0].id, editing: null });
    }

    case 'replaceRoot':
      return commit(state, { ...state.map, root: action.root }, { selectedId: action.root.id, editing: null });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: every editor test passes, including the 3 new ones, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/store.ts src/editor/store.test.ts
git commit -m "feat(editor): setLayout, pasteNodes and replaceRoot actions"
```

---

### Task 4: Editor UI — layout switcher, Outline panel, Copy as Markdown, paste

**Files:**
- Create: `src/editor/OutlinePanel.tsx`
- Modify: `src/editor/EditorPage.tsx`, `src/app.css`
- Test: `src/editor/EditorPage.test.tsx` (extend)

**Interfaces:**
- Consumes:
  - `layoutMap` (Task 1)
  - `toMarkdown` and `parseOutline` (Task 2)
  - `setLayout`, `pasteNodes` and `replaceRoot` (Task 3)
- Produces:
  - `<OutlinePanel initialText onApply(text): string | null onClose() />`. `onApply` returns an error message, or `null` on success.
  - Header controls:
    - a `role="group"` labelled "Layout", with buttons "Mind map", "Logic chart" and "Org chart" (`aria-pressed`)
    - an "Outline" button
    - a "Copy as Markdown" button, labelled "Markdown copied" after copying
  - Paste anywhere outside a text field adds an outline under the selected topic.
  - The canvas refits whenever the layout changes.

- [ ] **Step 1: Write the failing tests**

In `src/editor/EditorPage.test.tsx`, add this helper below the existing `type` helper:

```tsx
function paste(text: string) {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  act(() => void window.dispatchEvent(ev));
}
const pressed = () => container.querySelector('[aria-label="Layout"] button[aria-pressed="true"]')!.textContent;
```

Then append inside the `describe`:

```tsx
  it('switches to the org chart as an undoable, autosaved change', async () => {
    const api = fakeApi();
    mount(api);
    expect(pressed()).toBe('Mind map');
    await click('Org chart');
    expect(pressed()).toBe('Org chart');
    await advance(1000);
    expect(vi.mocked(api.saveMap).mock.calls[0][0].layout).toBe('org');
    keydown({ key: 'z', metaKey: true });
    expect(pressed()).toBe('Mind map');
  });

  it('pasting an outline adds topics under the selection as one undo step', () => {
    mount(fakeApi());
    paste('- Alpha\n  - Alpha 1\n- Beta');
    expect(topics()).toBe(4);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(1);
  });

  it('replaces the map from the Outline panel; undo brings the old map back', async () => {
    mount(fakeApi());
    await click('Outline');
    const ta = container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('# Root\n');
    type(ta, '# New root\n- X\n- Y');
    await click('Replace map with this');
    expect(container.querySelector('textarea[aria-label="Outline text"]')).toBeNull();
    expect(topics()).toBe(3);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(1);
  });

  it('shows an error for an empty outline and keeps the panel open', async () => {
    mount(fakeApi());
    await click('Outline');
    type(container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement, '   ');
    await click('Replace map with this');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('The outline is empty.');
    expect(topics()).toBe(1);
  });

  it('copies the map as Markdown', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mount(fakeApi());
      await click('Copy as Markdown');
      expect(writeText).toHaveBeenCalledWith('# Root\n');
      expect(container.textContent).toContain('Markdown copied');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/EditorPage.test.tsx`
Expected: FAIL. There is no "Layout" group, "Outline" or "Copy as Markdown" button yet, and a paste adds nothing.

- [ ] **Step 3: Create `src/editor/OutlinePanel.tsx`**

```tsx
import { useState } from 'react';

interface Props {
  initialText: string;
  /** Returns an error message to show, or null when the outline was applied. */
  onApply(text: string): string | null;
  onClose(): void;
}

export function OutlinePanel({ initialText, onApply, onClose }: Props) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <aside className="float outline-panel" aria-label="Markdown outline">
      <h2>Map as a Markdown outline</h2>
      <p className="muted">Edit the text and apply it, or paste an outline copied from Notion. Headings and indented lists both work.</p>
      <textarea
        aria-label="Outline text"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
      />
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="button" className="primary" onClick={() => setError(onApply(text))}>Replace map with this</button>
        <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Wire it into `src/editor/EditorPage.tsx`**

1. **Imports:**
   - Replace `import { computeLayout } from '../layout/map';` with `import { layoutMap } from '../layout';`.
   - Change the shared-types import to `import type { LayoutKind, MindMap } from '../shared/types';`.
   - Add:

```ts
import { parseOutline, toMarkdown } from '../io/markdown';
import { OutlinePanel } from './OutlinePanel';
```

2. **Layout constant.** Below `IGNORE_KEYS_IN`, add:

```ts
const LAYOUTS: Array<[LayoutKind, string]> = [['map', 'Mind map'], ['logic', 'Logic chart'], ['org', 'Org chart']];
```

3. **The layout memo:**

```ts
  const layout = useMemo(
    () => layoutMap(state.map.root, state.map.layout, measure),
    [state.map.root, state.map.layout, measure],
  );
```

4. **New state,** next to the other `useState` calls:

```ts
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
```

5. **Two effects,** after the `ensureVisible` effect:

```ts
  // Refit when the layout changes (not on first render, where the canvas fits itself).
  const firstLayout = useRef(true);
  useEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    canvas.current?.fit();
  }, [state.map.layout]);

  // Paste an outline (or plain lines) anywhere outside a text field: topics go under the selection.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      const parsed = text.trim() ? parseOutline(text) : null;
      if (!parsed) return;
      e.preventDefault();
      dispatch({ type: 'pasteNodes', nodes: parsed.synthetic ? parsed.root.children : [parsed.root] });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
```

6. **Handlers,** next to `copyLink`:

```ts
  const copyMarkdown = () => {
    if (!navigator.clipboard) {
      setOutlineOpen(true);
      return;
    }
    navigator.clipboard.writeText(toMarkdown(state.map.root)).then(
      () => setMdCopied(true),
      () => setOutlineOpen(true),
    );
  };
  const applyOutline = (text: string): string | null => {
    const parsed = parseOutline(text);
    if (!parsed) return 'The outline is empty.';
    dispatch({ type: 'replaceRoot', root: parsed.root });
    setOutlineOpen(false);
    return null;
  };
```

7. **Header.** Right after `<SaveBadge status={status} />`, insert:

```tsx
        <div className="layout-switch" role="group" aria-label="Layout">
          {LAYOUTS.map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              aria-pressed={state.map.layout === kind}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => dispatch({ type: 'setLayout', layout: kind })}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setOutlineOpen(true)}>Outline</button>
        <button type="button" onClick={copyMarkdown}>{mdCopied ? 'Markdown copied' : 'Copy as Markdown'}</button>
```

8. **The panel.** Inside `<main className="editor-stage">`, right after the `{editing && editBox && (…)}` block, add:

```tsx
        {outlineOpen && (
          <OutlinePanel initialText={toMarkdown(state.map.root)} onApply={applyOutline} onClose={() => setOutlineOpen(false)} />
        )}
```

- [ ] **Step 5: Append the styles to `src/app.css`**

```css
.layout-switch { display: inline-flex; gap: 2px; padding: 3px; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; }
.editor-bar .layout-switch button { padding: 6px 10px; border-radius: 7px; color: var(--ink-2); }
.editor-bar .layout-switch button[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12); }
.outline-panel { right: 12px; top: 12px; bottom: 12px; width: min(380px, calc(100% - 24px)); box-sizing: border-box; padding: 14px; display: flex; flex-direction: column; gap: 10px; z-index: 5; }
.outline-panel h2 { margin: 0; font-size: 15px; }
.outline-panel p { margin: 0; font-size: 12.5px; }
.outline-panel textarea { flex: 1; min-height: 140px; resize: none; font: 12.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
.outline-panel .row { display: flex; flex-wrap: wrap; gap: 6px; }
.outline-panel button { border: 1px solid var(--line); }
.outline-panel button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/editor && npm test && npm run typecheck`
Expected: all pass, including the 5 new Editor tests, with pristine output and clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/editor/OutlinePanel.tsx src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/app.css
git commit -m "feat(editor): layout switcher, Markdown outline panel, copy as Markdown, paste outlines"
```

---

### Task 5: The Notion view uses the saved layout and fits small maps up to 150%

**Files:**
- Modify: `src/view/ViewPage.tsx`, `README.md`
- Test: `src/view/ViewPage.test.tsx` (extend)

**Interfaces:**
- Consumes: `layoutMap` (Task 1)
- Produces: `MapView` draws `map.layout` and passes `fitMaxK={1.5}` to `Canvas`.

- [ ] **Step 1: Write the failing test**

Append inside `describe('MapView', …)` in `src/view/ViewPage.test.tsx`:

```tsx
  it('draws the map in its saved layout', async () => {
    await render(<MapView map={{ ...map, layout: 'org' }} measureFactory={measure} />);
    const hit = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
    const rootBottom = Number(hit('r').getAttribute('y')) + Number(hit('r').getAttribute('height'));
    expect(Number(hit('a').getAttribute('y'))).toBeGreaterThan(rootBottom); // org chart: first level sits below the root
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/view`
Expected: FAIL, because the view still draws the balanced map, where `a` sits beside the root.

- [ ] **Step 3: Implement**

In `src/view/ViewPage.tsx`:
- Replace `import { computeLayout } from '../layout/map';` with `import { layoutMap } from '../layout';`.
- Change the memo to:

```tsx
  const layout = useMemo(() => layoutMap(local.root, local.layout, measure), [local.root, local.layout, measure]);
```

- Change `fitMaxK={1}` to `fitMaxK={1.5}`.

In `README.md`, under "Known limitations", delete this line, because it is no longer true:

```
- A small map is shown at most at 100% zoom, so it can look small in a large embed frame.
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/view && npm test && npm run typecheck`
Expected: all pass, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/view/ViewPage.tsx src/view/ViewPage.test.tsx README.md
git commit -m "feat(view): use the map's saved layout and let small maps fill the embed (up to 150%)"
```

---

### Task 6: End-to-end — layout and pasted outline survive a reload and show in the view

**Files:**
- Modify: `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the whole app in `npm run dev`
- Produces: a third Playwright test. The two existing tests stay unchanged.

- [ ] **Step 1: Add the test**

Change the first line of `e2e/smoke.spec.ts` to `import { expect, test, type Page } from '@playwright/test';`, then append:

```ts
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
  const top = async (label: RegExp) => (await page.locator('svg text', { hasText: label }).boundingBox())!.y;
  expect(await top(/^Alpha 1$/)).toBeGreaterThan(await top(/^Alpha$/)); // stacked under its parent
  expect(Math.abs((await top(/^Alpha$/)) - (await top(/^Beta$/)))).toBeLessThan(2); // first level shares a row
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:e2e`
Expected: `3 passed`. If the new test fails, find out why from the trace or a headed run before you change anything. Don't weaken the assertions. If the app is wrong, report it with the evidence.

- [ ] **Step 3: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(e2e): org layout and pasted outline persist and show in the view"
```
