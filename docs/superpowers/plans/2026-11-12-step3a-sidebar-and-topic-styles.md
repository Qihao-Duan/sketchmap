# Step 3a: sidebar and topic styles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Topics can be marked by importance (Key, Highlight, Normal, Aside), priority (①②③), a marker emoji and a note. These are set from a details sidebar or with Alt shortcuts, drawn in the hand-drawn style everywhere (editor, Notion view, SVG/PNG export), and kept in Markdown where Markdown can carry them.

**Architecture:**
- The data model already has the fields (`emphasis`, `priority`, `emoji`, `note` in `src/shared/types.ts` and the zod schema), so nothing on the server changes.
- **Layout:** `measureTopic` measures everything a topic draws: the importance-adjusted style, the marker emoji as the first word of the text, the space for the priority badge, and the space for the note icon. Every layout copies that into its `TopicBox`.
- **Renderer:** it draws only what layout measured.
- **Reducer:** new actions change the selected topic, each as one undo step. Note typing is coalesced into one step.
- **Sidebar:** a new `DetailsPanel` component drives those actions.
- **Markdown:** out and in follow spec §9 for Key and priority, and for the marker by ruling.

**Tech Stack:** React 19, TypeScript 5.9, immer 11, roughjs 4.6, Vitest 4 (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md` — §3 "Importance and priority", §4 (Alt keys, details panel), §6 (importance looks, priority badge, note icon), §9 (Markdown rules), §11 step 3.

## Global Constraints

- **Marker set (§3):** 💡 ✅ ⚠️ ❓ ⭐ 📌 🔥 ❌ 📅 👤, one marker per topic.
- **Importance levels, lowest to highest:** Aside, Normal (the default, stored as no field), Highlight, Key (§3).
- **Key (§6):**
  - strokes ×1.5
  - solid fill instead of hachure
  - text +2 px, made heavier with a thin stroke of the same ink, because Excalifont has only one weight
  - an underlined topic is promoted to a box
  - the branch into it is ×1.45 width
- **Highlight (§6):** a yellow `#ffe066` highlighter swipe (a rough, slightly skewed polygon) behind each line of text. The branch is unchanged.
- **Aside (§6):**
  - dashed grey `#868e96` outline or underline, with no fill
  - grey text, −2 px
  - the branch is dashed, ×0.8 width
- **Priority badge (§6):** a solid rough circle (red `#e03131`, orange `#f08c00`, blue `#1971c2`) with a white number, sized to the text, placed before the first line.
- **Note icon (§6):** a small page drawn in rough strokes. Hovering it shows the note.
- **Keys (§4):**
  - Alt ↑ / Alt ↓ raise or lower importance (Aside ↔ Normal ↔ Highlight ↔ Key).
  - Alt 1 / 2 / 3 set priority ①②③, and Alt 0 clears it. These use `KeyboardEvent.code`, because Option+digit types a symbol on macOS.
- **Details panel order (§4):** title, Importance (four buttons with rough.js previews: Key, Highlight, Normal, Aside), Priority (①②③ and "none"), Marker, note. The links list arrives in step 3b, and the image section in step 4.
- **Markdown out (§9):**
  - A Key topic is `**…**`.
  - Priority is a leading 🔴 / 🟠 / 🔵.
  - Highlight and Aside are dropped, and the export says so.
- **Markdown in (§9):** a leading 🔴 / 🟠 / 🔵 becomes priority 1/2/3, and an item wrapped entirely in `**…**` becomes Key.
- **Ruling (the spec says nothing about markers or notes in Markdown):**
  - The marker is written after the priority emoji as a leading `💡 `, and read back when a line starts with a marker followed by a space.
  - Notes are not written, and the "not kept" notice names them.
- **Undo:** every change is one undo step. Consecutive note edits on one topic are one undo step until anything else happens.
- **Header and sidebar buttons call `endEdit()` before dispatching.** This is the step-2 final-review lesson: a button that keeps focus must close an open inline edit first.
- **Keep everything passing:** 178 unit tests, 12 Worker tests, 3 e2e tests, plus `npm run typecheck`.
- **Commits:** the subject line comes from the task. The co-author trailer goes only in a separate final `-m` paragraph.

## File map

| File | Change |
|---|---|
| `src/shared/types.ts` | Add the `MARKERS` constant |
| `src/layout/styles.ts` | `styleFor(depth, kind, emphasis)` and the colour and size constants for decorations |
| `src/layout/map.ts` | `Measured` gains decoration geometry; `TopicBox extends Measured`; `BranchPath.toEmphasis` |
| `src/layout/org.ts` | Builds boxes from `Measured` and sets `toEmphasis` |
| `src/render/renderMap.ts` | Draws the importance looks, badges, note icons, and the branch weights |
| `src/editor/store.ts` | `setEmphasis`, `bumpEmphasis`, `setPriority`, `setMarker`, `setNote` (coalesced) |
| `src/editor/keymap.ts` | Alt ↑/↓ and Alt 0–3 by code |
| `src/editor/DetailsPanel.tsx` (new) | The sidebar |
| `src/editor/EditorPage.tsx` | Wires the commands, the panel, the Details toggle and the Markdown notice |
| `src/editor/OutlinePanel.tsx` | The "not kept" line |
| `src/io/markdown.ts`, `src/io/htmlOutline.ts` | The §9 rules |
| `src/app.css` | Sidebar styles |
| `e2e/smoke.spec.ts`, `README.md` | End-to-end test and documentation |

Task order: 1 and 3 are independent of each other. 2 needs 1. 4 needs 1–3. 5 needs 1 and 4. 6 needs everything.

---

### Task 1: Layout measures importance, priority, marker and note

**Files:**
- Modify: `src/shared/types.ts`, `src/layout/styles.ts`, `src/layout/map.ts`, `src/layout/org.ts`
- Test: `src/layout/map.test.ts`

**Interfaces:**
- Produces:
  - `MARKERS` (readonly tuple of the 10 emoji) in `src/shared/types.ts`.
  - In `src/layout/styles.ts`: `styleFor(depth: number, kind?: LayoutKind, emphasis?: Emphasis): NodeStyle`, plus `INK`, `ASIDE_INK`, `HIGHLIGHTER`, `PRIORITY_COLORS: Record<1|2|3,string>`, `badgeSize(fontSize): number` and `DECOR = { badgeGap: 6, noteW: 24 }`.
  - `Measured` gains `lineWidths: number[]`, `textW: number`, `badgeW: number` and `noteW: number`.
  - `TopicBox extends Measured`.
  - `BranchPath.toEmphasis?: Emphasis`.

- [ ] **Step 1: Write the failing tests.** Append to `src/layout/map.test.ts`. Add `LayoutKind` to the existing `import type { MapNode } from '../shared/types';` line, so that it reads `import type { LayoutKind, MapNode } from '../shared/types';`.

```ts
/** Adds random importance, priority, notes and markers, using its own random stream. */
function decorate(node: MapNode, rand: () => number): MapNode {
  const r = rand();
  return {
    ...node,
    ...(r < 0.2 ? { emphasis: 'key' as const } : r < 0.35 ? { emphasis: 'aside' as const } : r < 0.45 ? { emphasis: 'highlight' as const } : {}),
    ...(rand() < 0.25 ? { priority: (1 + Math.floor(rand() * 3)) as 1 | 2 | 3 } : {}),
    ...(rand() < 0.2 ? { note: 'a note' } : {}),
    ...(rand() < 0.2 ? { emoji: '💡' } : {}),
    children: node.children.map((c) => decorate(c, rand)),
  };
}

describe('topic decorations', () => {
  const at = (extra: Partial<MapNode>, kind: LayoutKind = 'map') =>
    layoutMap(n('r', 'Root', [n('a', 'A', [n('x', 'Topic', [], extra)])]), kind, measure).byId.get('x')!;

  it('Key promotes an underlined or small topic to a box with text 2 px larger', () => {
    expect(at({}).style.kind).toBe('line');
    expect(at({ emphasis: 'key' }).style).toMatchObject({ kind: 'box', fontSize: 19 });
    expect(at({ emphasis: 'key' }, 'org').style).toMatchObject({ kind: 'box', fontSize: 19 });
    const firstLevel = layoutMap(n('r', 'Root', [n('a', 'A', [], { emphasis: 'key' })]), 'map', measure).byId.get('a')!;
    expect(firstLevel.style).toMatchObject({ kind: 'box', fontSize: 22 });
  });

  it('Aside makes the text 2 px smaller and keeps the kind', () => {
    expect(at({ emphasis: 'aside' }).style).toMatchObject({ kind: 'line', fontSize: 15 });
  });

  it('a priority badge reserves space left of the text, a note reserves space right of it', () => {
    const plain = at({});
    const pri = at({ priority: 1 });
    const note = at({ note: 'Remember' });
    expect(pri.badgeW).toBe(Math.round(17 * 1.05) + 6);
    expect(pri.w - plain.w).toBe(pri.badgeW);
    expect(note.noteW).toBe(24);
    expect(note.w - plain.w).toBe(24);
    expect(at({ note: '  \n ' }).noteW).toBe(0);
  });

  it('draws the marker emoji as the first word of the text', () => {
    const t = at({ emoji: '💡' });
    expect(t.lines[0]).toBe('💡 Topic');
    expect(t.lineWidths[0]).toBe(measure('💡 Topic', 17));
  });

  it('records the importance of the topic each branch leads into, in every layout', () => {
    const tree = n('r', 'Root', [n('a', 'A', [], { emphasis: 'key' }), n('b', 'B', [], { emphasis: 'aside' }), n('c', 'C')]);
    for (const kind of ['map', 'logic', 'org'] as const) {
      const byTo = new Map(layoutMap(tree, kind, measure).branches.map((b) => [b.to, b.toEmphasis]));
      expect([byTo.get('a'), byTo.get('b'), byTo.get('c')], kind).toEqual(['key', 'aside', undefined]);
    }
  });

  it.each(['map', 'logic', 'org'] as const)('never overlaps decorated topics in 150 random maps: %s', (kind) => {
    const rand = mulberry32(11);
    const extras = mulberry32(5);
    for (let k = 0; k < 150; k++) {
      const l = layoutMap(decorate(randomTree(rand), extras), kind, measure);
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

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/layout/map.test.ts`
Expected: the new tests fail. `badgeW`, `lineWidths` and `toEmphasis` are undefined, and Key is not promoted.

- [ ] **Step 3: Add `MARKERS` to `src/shared/types.ts`.** Append:

```ts
/** The marker set: at most one marker per topic (spec §3). */
export const MARKERS = ['💡', '✅', '⚠️', '❓', '⭐', '📌', '🔥', '❌', '📅', '👤'] as const;
```

- [ ] **Step 4: Change `src/layout/styles.ts`.**
  - Change the first line to `import type { Emphasis, LayoutKind } from '../shared/types';`.
  - Rename the existing `styleFor` to a private `baseStyle(depth: number, kind: LayoutKind): NodeStyle`, keeping its body.
  - Add after it:

```ts
/**
 * Style by depth and layout, adjusted for importance (spec §6): Key text is 2 px larger and turns an
 * underlined or small topic into a box; Aside text is 2 px smaller.
 */
export function styleFor(depth: number, kind: LayoutKind = 'map', emphasis?: Emphasis): NodeStyle {
  const base = baseStyle(depth, kind);
  if (emphasis === 'key') {
    if (base.kind === 'line' || base.kind === 'small') {
      return { kind: 'box', fontSize: base.fontSize + 2, padX: 13, padY: 7, maxW: base.maxW, lineHeight: base.lineHeight + 2 };
    }
    return { ...base, fontSize: base.fontSize + 2, lineHeight: base.lineHeight + 2 };
  }
  if (emphasis === 'aside') return { ...base, fontSize: base.fontSize - 2, lineHeight: base.lineHeight - 2 };
  return base;
}

export const INK = '#1e1e1e';
/** Aside topics: dashed grey outline and grey text. */
export const ASIDE_INK = '#868e96';
/** Highlight: the highlighter swipe behind the text. */
export const HIGHLIGHTER = '#ffe066';
export const PRIORITY_COLORS: Record<1 | 2 | 3, string> = { 1: '#e03131', 2: '#f08c00', 3: '#1971c2' };
/** Diameter of the priority badge for a text size. */
export const badgeSize = (fontSize: number): number => Math.round(fontSize * 1.05);
/** Gap after the priority badge, and the slot after the text that holds the note icon. */
export const DECOR = { badgeGap: 6, noteW: 24 } as const;
```

- [ ] **Step 5: Change `src/layout/map.ts`.**

**Imports:** change the first line to `import type { Emphasis, LayoutKind, MapNode } from '../shared/types';`, and change the styles import to `import { badgeSize, DECOR, GAP, PALETTE, ROOT_COLOR, styleFor, type BranchColor, type NodeStyle } from './styles';`.

**`TopicBox`:** replace the interface with:

```ts
export interface TopicBox extends Measured {
  id: string;
  node: MapNode;
  parentId: string | null;
  depth: number;
  side: Side;
  x: number;
  y: number;
  color: BranchColor;
  /** Centre of the fold toggle: just beyond where branches leave this topic. */
  fold: { x: number; y: number };
}
```

**`BranchPath`:** add after `fromDepth: number;`:

```ts
  /** Importance of the topic this branch leads into: Key branches are wider, Aside ones thinner and dashed. */
  toEmphasis?: Emphasis;
```

**`Measured` and `measureTopic`:** replace both with:

```ts
export interface Measured {
  style: NodeStyle;
  /** Wrapped lines; a marker emoji starts the first one. */
  lines: string[];
  lineWidths: number[];
  /** Width of the text block: the widest line, at least 1.6 em. */
  textW: number;
  /** Space left of the text for the priority badge; 0 without a priority. */
  badgeW: number;
  /** Space right of the text for the note icon; 0 without a note. */
  noteW: number;
  w: number;
  h: number;
}

export function measureTopic(node: MapNode, depth: number, measure: Measure, kind: LayoutKind = 'map'): Measured {
  const style = styleFor(depth, kind, node.emphasis);
  const display = (node.emoji ? `${node.emoji} ` : '') + node.text;
  const lines = wrapText(display || ' ', style.fontSize, style.maxW, measure);
  const lineWidths = lines.map((l) => measure(l, style.fontSize));
  const textW = lineWidths.reduce((m, lw) => Math.max(m, lw), style.fontSize * 1.6);
  const badgeW = node.priority ? badgeSize(style.fontSize) + DECOR.badgeGap : 0;
  const noteW = node.note?.trim() ? DECOR.noteW : 0;
  return {
    style, lines, lineWidths, textW, badgeW, noteW,
    w: Math.ceil(badgeW + textW + noteW + style.padX * 2),
    h: Math.ceil(lines.length * style.lineHeight + style.padY * 2),
  };
}
```

**In `computeLayout`'s `add`:** build the box from the measurement:

```ts
    const box: TopicBox = { ...m, id: n.id, node: n, parentId, depth, side, x, y, color, fold: { x: 0, y: 0 } };
```

**In `place`:** the branch records the child's importance:

```ts
    branches.push({
      from: parent.id, to: n.id, d: branchPath(anchorOut(parent, side), anchorIn(box)), color, fromDepth: parent.depth,
      ...(n.emphasis && { toEmphasis: n.emphasis }),
    });
```

- [ ] **Step 6: Change `src/layout/org.ts`.**

**In `place`:**

```ts
    const box: TopicBox = { ...m, id: n.id, node: n, parentId, depth, side: 0, x, y, color, fold: { x: x + m.w + 11, y: y + m.h / 2 } };
```

**Both `branches.push({ … })` calls:** add `...(row.node.emphasis && { toEmphasis: row.node.emphasis }),` after `fromDepth: …,`.

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run src/layout && npm run typecheck`
Expected: everything passes, including the existing layout tests (the fold positions are unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/layout/styles.ts src/layout/map.ts src/layout/org.ts src/layout/map.test.ts
git commit -m "feat(layout): measure importance, priority badge, marker and note icon" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: The renderer draws importance looks, badges and note icons

**Files:**
- Modify: `src/render/renderMap.ts`
- Test: `src/render/renderMap.test.ts`

**Interfaces:**
- Consumes the Task 1 fields: `t.badgeW`, `t.noteW`, `t.textW`, `t.lineWidths`, `b.toEmphasis`, and the constants from `../layout/styles`.
- Produces this markup, which later tests rely on:
  - `g.badge` holds a `text` with the number and a `title` "Priority N".
  - `g.note-icon` holds a `title` with the note.
  - `g.swipe` appears once per highlighted line.
  - Key text has `stroke="#1e1e1e"`, and Aside text has `fill="#868e96"`.

- [ ] **Step 1: Write the failing tests.** Append inside `describe('renderMap', …)` in `src/render/renderMap.test.ts`:

```ts
  describe('importance, priority and notes', () => {
    const decorated: MapNode = {
      id: 'r', text: 'Root',
      children: [
        { id: 'k', text: 'Key', emphasis: 'key', children: [{ id: 'k1', text: 'Under key', children: [] }] },
        { id: 'h', text: 'Two\nlines', emphasis: 'highlight', children: [] },
        { id: 's', text: 'Aside', emphasis: 'aside', children: [] },
        { id: 'p', text: 'Urgent', priority: 2, note: 'Call Ana', children: [] },
      ],
    };
    const drawn = () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      svg.appendChild(world);
      renderMap(svg, world, computeLayout(decorated, measure), { selectedId: null });
      return world;
    };
    const topic = (w: Element, id: string) => w.querySelector(`g.topic[data-id="${id}"]`)!;
    const fills = (g: Element) => [...g.querySelectorAll('path')].map((p) => p.getAttribute('fill'));

    it('Key: solid fill, heavier text', () => {
      const k = topic(drawn(), 'k');
      expect(fills(k)).toContain(PALETTE[0].fill);
      expect(k.querySelector('text')!.getAttribute('stroke')).toBe('#1e1e1e');
    });

    it('Highlight: one highlighter swipe per line', () => {
      const h = topic(drawn(), 'h');
      expect(h.querySelectorAll('g.swipe')).toHaveLength(2);
      expect(fills(h.querySelector('g.swipe')!)).toContain('#ffe066');
    });

    it('Aside: grey dashed outline, no fill, grey text', () => {
      const s = topic(drawn(), 's');
      expect(s.querySelector('text')!.getAttribute('fill')).toBe('#868e96');
      const outlines = [...s.querySelectorAll('path')].filter((p) => p.getAttribute('stroke') === '#868e96');
      expect(outlines.length).toBeGreaterThan(0);
      expect(outlines.every((p) => p.getAttribute('stroke-dasharray'))).toBe(true);
      expect(fills(s).filter((f) => f && f !== 'none')).toEqual([]);
    });

    it('Priority: an orange badge with its number; Note: a page icon whose tooltip is the note', () => {
      const p = topic(drawn(), 'p');
      expect(p.querySelector('g.badge text')!.textContent).toBe('2');
      expect(p.querySelector('g.badge title')!.textContent).toBe('Priority 2');
      expect(fills(p.querySelector('g.badge')!)).toContain('#f08c00');
      expect(p.querySelector('g.note-icon title')!.textContent).toBe('Call Ana');
      expect(topic(drawn(), 'k').querySelector('g.badge, g.note-icon')).toBeNull();
    });

    it('branches into Key topics are 1.45× wider, into Aside topics 0.8× and dashed', () => {
      const w = drawn();
      const layout = computeLayout(decorated, measure);
      const branch = (to: string) => w.querySelector('g.branches')!.children[layout.branches.findIndex((b) => b.to === to)].querySelector('path')!;
      expect(Number(branch('k').getAttribute('stroke-width'))).toBeCloseTo(2.4 * 1.45);
      expect(Number(branch('s').getAttribute('stroke-width'))).toBeCloseTo(2.4 * 0.8);
      expect(branch('s').getAttribute('stroke-dasharray')).toBeTruthy();
      expect(Number(branch('h').getAttribute('stroke-width'))).toBeCloseTo(2.4);
    });
  });
```

Also add `import { PALETTE } from '../layout/styles';` at the top of the file.

**Rough's SVG output, for orientation:**
- `fillStyle: 'solid'` produces a `<path>` with `fill` set to the colour and `stroke="none"`.
- Hachure produces stroked paths with `fill="none"`.
- `strokeLineDash` becomes `stroke-dasharray`.
- Each shape is a `<g>` that wraps one or more `<path>` elements.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/render/renderMap.test.ts`
Expected: the five new tests fail.

- [ ] **Step 3: Implement in `src/render/renderMap.ts`.**

**Imports and constants:**
- Delete `const INK = '#1e1e1e';`.
- Add `import { ASIDE_INK, badgeSize, HIGHLIGHTER, INK, PRIORITY_COLORS } from '../layout/styles';`.

**In `renderMap`,** replace the branch loop with:

```ts
  for (const b of layout.branches) {
    const em = b.toEmphasis;
    const width = (b.fromDepth === 0 ? 2.4 : 1.6) * (em === 'key' ? 1.45 : em === 'aside' ? 0.8 : 1);
    branches.appendChild(
      rc.path(b.d, {
        stroke: b.color.stroke, strokeWidth: width, roughness: 1, bowing: 0.8, seed: hashSeed(`${b.to}:branch`),
        ...(em === 'aside' ? { strokeLineDash: [6, 5] } : {}),
      }),
    );
  }
```

**In `drawTopic`,** replace everything from `const r = Math.min(26, …)` down to, but not including, the fold-toggle block (`if (t.depth > 0 && t.node.children.length > 0) {`) with:

```ts
  const em = t.node.emphasis;
  const key = em === 'key';
  const aside = em === 'aside';
  const r = Math.min(26, Math.min(t.w, t.h) * 0.3);
  const { stroke, fill } = t.color;
  const outline = aside ? ASIDE_INK : stroke;
  const weight = key ? 1.5 : 1;
  const dash = aside ? { strokeLineDash: [5, 4] } : {};
  // Key: solid fill. Aside: no fill. Otherwise hachure, as by depth.
  const boxFill = (gap: number, fillWeight: number) =>
    key ? { fill, fillStyle: 'solid' } : aside ? {} : { fill, fillStyle: 'hachure', hachureGap: gap, fillWeight, hachureAngle: -41 };
  const shape = roundedRect(t.x, t.y, t.w, t.h, r);
  if (t.style.kind === 'root') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 2.2 * weight, roughness: 1, ...boxFill(7, 1.1), ...dash, seed }));
  } else if (t.style.kind === 'box') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 1.8 * weight, roughness: 1, ...boxFill(8, 0.9), ...dash, seed }));
  } else if (t.style.kind === 'small') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 1.4 * weight, roughness: 1, ...dash, seed }));
  } else {
    g.appendChild(rc.line(t.x, t.y + t.h, t.x + t.w, t.y + t.h, { stroke: outline, strokeWidth: 1.6 * weight, roughness: 1, ...dash, seed }));
  }

  const { fontSize, lineHeight, padX, padY } = t.style;
  const centred = t.style.kind !== 'line';
  const ink = aside ? ASIDE_INK : INK;
  const textLeft = t.x + padX + t.badgeW;
  /** Left edge of line i; centred lines sit in the middle of the text block. */
  const lineLeft = (i: number) => (centred ? textLeft + (t.textW - t.lineWidths[i]) / 2 : textLeft);
  t.lines.forEach((line, i) => {
    const lx = lineLeft(i);
    const lw = t.lineWidths[i];
    const by = t.y + padY + i * lineHeight + lineHeight / 2 + fontSize * 0.34;
    if (em === 'highlight' && line) {
      const top = by - fontSize * 0.8;
      const bot = by + fontSize * 0.28;
      el(doc, 'g', { class: 'swipe' }, g).appendChild(
        rc.polygon([[lx - 5, top + 2], [lx + lw + 5, top - 1], [lx + lw + 3, bot + 1], [lx - 3, bot + 3]], {
          fill: HIGHLIGHTER, fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed: seed + 40 + i,
        }),
      );
    }
    const text = el(doc, 'text', {
      x: centred ? lx + lw / 2 : lx,
      y: by,
      'font-size': fontSize,
      'font-family': FONT_STACK,
      'text-anchor': centred ? 'middle' : 'start',
      fill: ink,
      // Excalifont has one weight: Key text gets a thin outline in its own ink.
      ...(key ? { stroke: ink, 'stroke-width': 0.6, 'paint-order': 'stroke', 'stroke-linejoin': 'round' } : {}),
    }, g);
    text.textContent = line;
  });

  if (t.node.priority) {
    const d = badgeSize(fontSize);
    const cx = lineLeft(0) - t.badgeW + d / 2;
    const cy = t.y + padY + lineHeight / 2;
    const color = PRIORITY_COLORS[t.node.priority];
    const badge = el(doc, 'g', { class: 'badge' }, g);
    badge.appendChild(rc.circle(cx, cy, d, { fill: color, fillStyle: 'solid', stroke: color, strokeWidth: 1.2, roughness: 0.8, seed: seed + 50 }));
    el(doc, 'text', {
      x: cx, y: cy + d * 0.22, 'font-size': Math.round(d * 0.62), 'font-weight': 800,
      'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle', fill: '#ffffff',
    }, badge).textContent = String(t.node.priority);
    el(doc, 'title', {}, badge).textContent = `Priority ${t.node.priority}`;
  }

  const note = t.node.note?.trim();
  if (note) {
    const ix = textLeft + t.textW + 8;
    const iy = t.y + padY + (t.lines.length * lineHeight) / 2;
    const icon = el(doc, 'g', { class: 'note-icon' }, g);
    // A transparent target, so hovering anywhere on the little page shows the note.
    el(doc, 'rect', { x: ix - 4, y: iy - 11, width: 20, height: 22, fill: 'transparent', 'pointer-events': 'all' }, icon);
    icon.appendChild(rc.rectangle(ix, iy - 8, 12, 15, { stroke: INK, strokeWidth: 1, roughness: 0.8, seed: seed + 3 }));
    icon.appendChild(rc.line(ix + 3, iy - 3, ix + 9, iy - 3, { stroke: INK, strokeWidth: 1, roughness: 0.5, seed: seed + 4 }));
    icon.appendChild(rc.line(ix + 3, iy + 1, ix + 9, iy + 1, { stroke: INK, strokeWidth: 1, roughness: 0.5, seed: seed + 5 }));
    el(doc, 'title', {}, icon).textContent = note.length > 1000 ? `${note.slice(0, 1000)}…` : note;
  }
```

**Leave unchanged:** the selection highlight above this block, and the fold-toggle block after it. They already use `INK`, which is now imported.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/render src/io src/view && npm run typecheck`
Expected: everything passes. The export and view tests use `renderMap`, so they cover the change too.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderMap.ts src/render/renderMap.test.ts
git commit -m "feat(render): draw Key, Highlight and Aside looks, priority badges and note icons" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Reducer actions and Alt shortcuts

**Files:**
- Modify: `src/editor/store.ts`, `src/editor/keymap.ts`, `src/editor/EditorPage.tsx` (only the `run` switch)
- Test: `src/editor/store.test.ts`, `src/editor/keymap.test.ts`, `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Produces these `EditorAction` members:
  - `{ type: 'setEmphasis'; emphasis: Emphasis | null }`
  - `{ type: 'bumpEmphasis'; delta: 1 | -1 }`
  - `{ type: 'setPriority'; priority: 1 | 2 | 3 | null }`
  - `{ type: 'setMarker'; emoji: string | null }`
  - `{ type: 'setNote'; id: string; note: string }`
- The first four act on `state.selectedId`. `setNote` names its topic, because the note box can commit after the selection has moved.
- All five do nothing while `state.editing` is set.
- `Command` gains `{ type: 'emphasis'; delta: 1 | -1 }` and `{ type: 'priority'; value: 0 | 1 | 2 | 3 }`.
- `KeyInput` gains `code?: string`.

- [ ] **Step 1: Write the failing tests.**

**`src/editor/store.test.ts`:** append a new `describe` block:

```ts
describe('importance, priority, marker and note', () => {
  const sel = (id: string) => reduce(initEditor(base()), { type: 'select', id });
  const nodeA = (s: EditorState) => s.map.root.children[0];

  it('setEmphasis, setPriority and setMarker set and clear fields on the selected topic, one undo step each', () => {
    let s = sel('a');
    s = reduce(s, { type: 'setEmphasis', emphasis: 'key' });
    s = reduce(s, { type: 'setPriority', priority: 2 });
    s = reduce(s, { type: 'setMarker', emoji: '💡' });
    expect(nodeA(s)).toMatchObject({ emphasis: 'key', priority: 2, emoji: '💡' });
    expect(s.past).toHaveLength(3);
    s = reduce(s, { type: 'setPriority', priority: null });
    expect('priority' in nodeA(s)).toBe(false);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).priority).toBe(2);
  });

  it('setting the value a topic already has changes nothing', () => {
    const s = sel('a');
    expect(reduce(s, { type: 'setEmphasis', emphasis: null })).toBe(s);
    expect(reduce(s, { type: 'setMarker', emoji: null })).toBe(s);
  });

  it('bumpEmphasis steps Aside ↔ Normal ↔ Highlight ↔ Key and stops at both ends', () => {
    let s = sel('a');
    const bump = (delta: 1 | -1) => (s = reduce(s, { type: 'bumpEmphasis', delta }));
    bump(1);
    expect(nodeA(s).emphasis).toBe('highlight');
    bump(1);
    expect(nodeA(s).emphasis).toBe('key');
    const top = s;
    bump(1);
    expect(s).toBe(top);
    bump(-1);
    bump(-1);
    expect('emphasis' in nodeA(s)).toBe(false);
    bump(-1);
    expect(nodeA(s).emphasis).toBe('aside');
    const bottom = s;
    bump(-1);
    expect(s).toBe(bottom);
  });

  it('note edits on one topic share one undo step until anything else happens', () => {
    let s = sel('a');
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Re' });
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Remember  ' });
    expect(nodeA(s).note).toBe('Remember');
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'select', id: 'r' });
    s = reduce(s, { type: 'setNote', id: 'a', note: 'Remember this' });
    expect(s.past).toHaveLength(2);
    s = reduce(s, { type: 'undo' });
    expect(nodeA(s).note).toBe('Remember');
    s = reduce(s, { type: 'undo' });
    expect('note' in nodeA(s)).toBe(false);
  });

  it('an empty note removes the field', () => {
    let s = reduce(sel('a'), { type: 'setNote', id: 'a', note: 'x' });
    s = reduce(s, { type: 'select', id: 'a' });
    s = reduce(s, { type: 'setNote', id: 'a', note: '  \n' });
    expect('note' in nodeA(s)).toBe(false);
  });

  it('does nothing while a topic is being edited', () => {
    const s = reduce(sel('a'), { type: 'addChild' });
    const actions = [
      { type: 'setEmphasis', emphasis: 'key' },
      { type: 'bumpEmphasis', delta: 1 },
      { type: 'setPriority', priority: 1 },
      { type: 'setMarker', emoji: '💡' },
      { type: 'setNote', id: 'a', note: 'x' },
    ] as const;
    for (const action of actions) expect(reduce(s, action)).toBe(s);
  });
});
```

**`src/editor/keymap.test.ts`:** add these rows to the `it.each` table:

```ts
    [k('ArrowUp', { altKey: true }), { type: 'emphasis', delta: 1 }],
    [k('ArrowDown', { altKey: true }), { type: 'emphasis', delta: -1 }],
    [k('¡', { altKey: true, code: 'Digit1' }), { type: 'priority', value: 1 }],
    [k('3', { altKey: true, code: 'Numpad3' }), { type: 'priority', value: 3 }],
    [k('º', { altKey: true, code: 'Digit0' }), { type: 'priority', value: 0 }],
```

In `it('ignores IME composition, Alt combos, …')`, replace the line `expect(keyToCommand(k('ArrowUp', { altKey: true }))).toBeNull();` with:

```ts
    expect(keyToCommand(k('ArrowLeft', { altKey: true }))).toBeNull();
    expect(keyToCommand(k('4', { altKey: true, code: 'Digit4' }))).toBeNull();
    expect(keyToCommand(k('å', { altKey: true, code: 'KeyA' }))).toBeNull();
```

**`src/editor/EditorPage.test.tsx`:** add inside `describe('Editor', …)`:

```tsx
  it('Alt ↑ raises importance and Alt+2 (read from the key code) sets priority 2', async () => {
    const api = fakeApi();
    mount(api);
    keydown({ key: 'ArrowUp', altKey: true });
    keydown({ key: '™', code: 'Digit2', altKey: true });
    await advance(1100);
    const saved = vi.mocked(api.saveMap).mock.calls.at(-1)![0];
    expect(saved.root).toMatchObject({ emphasis: 'highlight', priority: 2 });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/editor/store.test.ts src/editor/keymap.test.ts src/editor/EditorPage.test.tsx`
Expected: the new tests fail. The actions are unknown and the Alt keys return null.

- [ ] **Step 3: Implement in `src/editor/store.ts`.**

**Import:** change the types import to `import type { Emphasis, LayoutKind, MapNode, MindMap } from '../shared/types';`.

**`EditorState`:** add one field:

```ts
  /** `note:<id>` while consecutive note edits on that topic share one undo step. */
  lastEdit?: string;
```

**`EditorAction`:** add these members:

```ts
  | { type: 'setEmphasis'; emphasis: Emphasis | null }
  | { type: 'bumpEmphasis'; delta: 1 | -1 }
  | { type: 'setPriority'; priority: 1 | 2 | 3 | null }
  | { type: 'setMarker'; emoji: string | null }
  | { type: 'setNote'; id: string; note: string };
```

**Helpers:** add below `keepSelection`:

```ts
/** Importance from lowest to highest; undefined is Normal. */
const IMPORTANCE: ReadonlyArray<Emphasis | undefined> = ['aside', undefined, 'highlight', 'key'];

type Decoration = 'emphasis' | 'priority' | 'emoji';

/** Sets or clears one decoration on the selected topic, as one undo step. */
function decorate(state: EditorState, field: Decoration, value: string | number | null): EditorState {
  if (state.editing) return state;
  const f = T.findNode(state.map.root, state.selectedId);
  if (!f || (f.node[field] ?? null) === value) return state;
  const next = produce(state.map, (d) => {
    const node = T.findNode(d.root, state.selectedId)!.node as Partial<Record<Decoration, unknown>>;
    if (value === null) delete node[field];
    else node[field] = value;
  });
  return commit(state, next);
}
```

**Rename and wrap the reducer:** rename `export function editorReducer(` to `function reduce(`, and add this exported wrapper after it:

```ts
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const next = reduce(state, action);
  // Anything except another note edit (or a save echo) ends a note-typing session.
  if (next.lastEdit === undefined || action.type === 'setNote' || action.type === 'serverSaved') return next;
  return { ...next, lastEdit: undefined };
}
```

**New cases:** add these to `reduce`'s switch, before `case 'undo'`:

```ts
    case 'setEmphasis':
      return decorate(state, 'emphasis', action.emphasis);

    case 'bumpEmphasis': {
      const f = T.findNode(state.map.root, state.selectedId);
      if (!f) return state;
      const i = IMPORTANCE.indexOf(f.node.emphasis);
      const j = Math.max(0, Math.min(IMPORTANCE.length - 1, i + action.delta));
      return decorate(state, 'emphasis', IMPORTANCE[j] ?? null);
    }

    case 'setPriority':
      return decorate(state, 'priority', action.priority);

    case 'setMarker':
      return decorate(state, 'emoji', action.emoji);

    case 'setNote': {
      if (state.editing) return state;
      const note = action.note.replace(/\s+$/, '');
      const f = T.findNode(state.map.root, action.id);
      if (!f || (f.node.note ?? '') === note) return state;
      const next = produce(state.map, (d) => {
        const node = T.findNode(d.root, action.id)!.node;
        if (note) node.note = note;
        else delete node.note;
      });
      const session = `note:${action.id}`;
      // The note box dispatches at every pause in typing; one typing session on one topic is one undo step.
      if (state.lastEdit === session) return { ...state, map: next, future: [], revision: state.revision + 1 };
      return { ...commit(state, next), lastEdit: session };
    }
```

- [ ] **Step 4: Implement in `src/editor/keymap.ts`.**

**`Command`:** add these members:

```ts
  | { type: 'emphasis'; delta: 1 | -1 }
  | { type: 'priority'; value: 0 | 1 | 2 | 3 };
```

**`KeyInput`:** add after `key: string;`:

```ts
  /** Physical key, such as "Digit2". Option+2 types "™" on macOS, so the priority shortcuts read the code. */
  code?: string;
```

**`keyToCommand`:** replace the line `if (e.altKey) return null;` with:

```ts
  if (e.altKey) {
    if (e.key === 'ArrowUp') return { type: 'emphasis', delta: 1 };
    if (e.key === 'ArrowDown') return { type: 'emphasis', delta: -1 };
    const digit = /^(?:Digit|Numpad)([0-3])$/.exec(e.code ?? '');
    return digit ? { type: 'priority', value: Number(digit[1]) as 0 | 1 | 2 | 3 } : null;
  }
```

- [ ] **Step 5: Wire the commands in `src/editor/EditorPage.tsx`.** Add two cases to the `switch (cmd.type)` inside `run`, before its `default:` branch. That branch dispatches `{ type: cmd.type }`, so without these cases the typecheck fails.

```ts
      case 'emphasis':
        dispatch({ type: 'bumpEmphasis', delta: cmd.delta });
        return;
      case 'priority':
        dispatch({ type: 'setPriority', priority: cmd.value === 0 ? null : cmd.value });
        return;
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: everything passes.

- [ ] **Step 7: Commit**

```bash
git add src/editor/store.ts src/editor/store.test.ts src/editor/keymap.ts src/editor/keymap.test.ts src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx
git commit -m "feat(editor): importance, priority, marker and note actions; Alt shortcuts" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The details sidebar

**Files:**
- Create: `src/editor/DetailsPanel.tsx`
- Modify: `src/editor/EditorPage.tsx`, `src/app.css`
- Test: `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Consumes:
  - the Task 3 actions
  - from Task 1: `MARKERS`, plus `INK`, `ASIDE_INK`, `HIGHLIGHTER` and `PRIORITY_COLORS`
  - `endEdit()` in EditorPage, which already exists from step 2
- Produces:
  - `DetailsPanel({ node, onEmphasis, onPriority, onMarker, onNote })`
  - `aside[aria-label="Topic details"]`
  - groups `[aria-label="Importance"]`, `[aria-label="Priority"]` and `[aria-label="Marker"]`
  - priority buttons labelled "Priority 1"…"Priority 3" and "No priority"
  - marker buttons labelled "Marker 💡" and so on
  - `textarea[aria-label="Note"]`
  - a header button "Details" with `aria-pressed`
  - the localStorage key `sketchmap:details`

- [ ] **Step 1: Write the failing tests.**

**Helpers:** in `src/editor/EditorPage.test.tsx`, add next to the other helpers:

```tsx
const clickLabel = (label: string) => act(async () => {
  (container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(0);
});
const pressedIn = (group: string) =>
  [...container.querySelectorAll(`[aria-label="${group}"] button[aria-pressed="true"]`)].map((b) => b.getAttribute('aria-label') ?? b.textContent);
```

**Tests:** add a new `describe` block:

```tsx
describe('Details panel', () => {
  it('sets importance, priority and marker on the selected topic, each one undo step', async () => {
    mount(fakeApi());
    expect(pressedIn('Importance')).toEqual(['Normal']);
    expect(pressedIn('Priority')).toEqual(['No priority']);
    await click('Key');
    await clickLabel('Priority 2');
    await clickLabel('Marker 💡');
    expect(pressedIn('Importance')).toEqual(['Key']);
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
    expect(pressedIn('Marker')).toEqual(['Marker 💡']);
    expect(container.querySelector('g.badge text')!.textContent).toBe('2');
    keydown({ key: 'z', metaKey: true });
    expect(pressedIn('Marker')).toEqual([]);
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
    await clickLabel('Priority 2'); // pressing the active priority again keeps it
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
  });

  it('a second click on the active marker removes it', async () => {
    mount(fakeApi());
    await clickLabel('Marker ✅');
    await clickLabel('Marker ✅');
    expect(pressedIn('Marker')).toEqual([]);
  });

  it('saves a note after a pause, as one undo step, and shows the note icon', async () => {
    mount(fakeApi());
    const ta = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    type(ta, 'Remember');
    await advance(800);
    type(ta, 'Remember this');
    await advance(800);
    expect(container.querySelector('g.note-icon title')!.textContent).toBe('Remember this');
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelector('g.note-icon')).toBeNull();
    expect(ta.value).toBe('');
  });

  it('closes an open topic edit first, keeping the typed text', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea.inline-editor') as HTMLTextAreaElement, 'Hi');
    await click('Key');
    expect(container.querySelector('textarea.inline-editor')).toBeNull();
    expect(topics()).toBe(2);
    expect(pressedIn('Importance')).toEqual(['Key']);
    expect(container.querySelector('[aria-label="Topic details"] .topic-title')!.textContent).toBe('Hi');
  });

  it('the Details button hides the panel and remembers the choice', async () => {
    mount(fakeApi());
    await click('Details');
    expect(container.querySelector('[aria-label="Topic details"]')).toBeNull();
    expect(localStorage.getItem('sketchmap:details')).toBe('0');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/editor/EditorPage.test.tsx -t "Details panel"`
Expected: FAIL. There is no panel yet.

- [ ] **Step 3: Create `src/editor/DetailsPanel.tsx`.**

```tsx
import rough from 'roughjs';
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { ASIDE_INK, HIGHLIGHTER, INK, PRIORITY_COLORS } from '../layout/styles';
import { MARKERS, type Emphasis, type MapNode } from '../shared/types';

type Rough = ReturnType<typeof rough.svg>;
type Draw = (rc: Rough, svg: SVGSVGElement) => void;

const SVGNS = 'http://www.w3.org/2000/svg';
/** The note is saved after this long without typing, and on blur. */
const NOTE_DELAY_MS = 800;
// Buttons don't take focus on mouse click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

/** A small hand-drawn preview; `draw` must be a stable (module-level) function. */
function Mini({ w, h, draw }: { w: number; h: number; draw: Draw }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    const svg = ref.current!;
    svg.replaceChildren();
    draw(rough.svg(svg), svg);
  }, [draw]);
  return <svg ref={ref} className="mini" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" />;
}

const IMPORTANCE: Array<{ value: Emphasis | null; label: string; title: string; draw: Draw }> = [
  {
    value: 'key', label: 'Key', title: 'Key (Alt ↑ raises importance)',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 4, 32, 16, { stroke: INK, strokeWidth: 2.6, fill: '#a5d8ff', fillStyle: 'solid', roughness: 1, seed: 3 })); },
  },
  {
    value: 'highlight', label: 'Highlight', title: 'Highlight',
    draw: (rc, s) => {
      s.appendChild(rc.polygon([[3, 8], [37, 5], [36, 18], [4, 20]], { fill: HIGHLIGHTER, fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed: 4 }));
      s.appendChild(rc.line(9, 13, 31, 12, { stroke: INK, strokeWidth: 1.4, roughness: 0.8, seed: 5 }));
    },
  },
  {
    value: null, label: 'Normal', title: 'Normal',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 4, 32, 16, { stroke: INK, strokeWidth: 1.2, fill: '#a5d8ff', fillStyle: 'hachure', hachureGap: 4, roughness: 1, seed: 7 })); },
  },
  {
    value: 'aside', label: 'Aside', title: 'Aside (Alt ↓ lowers importance)',
    draw: (rc, s) => { s.appendChild(rc.rectangle(4, 5, 32, 14, { stroke: ASIDE_INK, strokeWidth: 1.2, strokeLineDash: [4, 4], roughness: 1, seed: 6 })); },
  },
];

const badge = (n: 1 | 2 | 3): Draw => (rc, s) => {
  s.appendChild(rc.circle(13, 13, 20, { fill: PRIORITY_COLORS[n], fillStyle: 'solid', stroke: PRIORITY_COLORS[n], roughness: 0.8, seed: 9 + n }));
  const t = s.ownerDocument.createElementNS(SVGNS, 'text');
  const attrs: Array<[string, string]> = [
    ['x', '13'], ['y', '17.5'], ['text-anchor', 'middle'], ['font-size', '13'], ['font-weight', '800'],
    ['font-family', 'system-ui, sans-serif'], ['fill', '#ffffff'],
  ];
  for (const [k, v] of attrs) t.setAttribute(k, v);
  t.textContent = String(n);
  s.appendChild(t);
};

const PRIORITIES: Array<{ value: 1 | 2 | 3 | null; label: string; title: string; draw: Draw }> = [
  { value: 1, label: 'Priority 1', title: 'Priority 1 (Alt 1)', draw: badge(1) },
  { value: 2, label: 'Priority 2', title: 'Priority 2 (Alt 2)', draw: badge(2) },
  { value: 3, label: 'Priority 3', title: 'Priority 3 (Alt 3)', draw: badge(3) },
  {
    value: null, label: 'No priority', title: 'No priority (Alt 0)',
    draw: (rc, s) => { s.appendChild(rc.circle(13, 13, 18, { stroke: ASIDE_INK, strokeWidth: 1.2, strokeLineDash: [3, 3], roughness: 0.8, seed: 8 })); },
  },
];

export interface DetailsPanelProps {
  node: MapNode;
  onEmphasis(emphasis: Emphasis | null): void;
  onPriority(priority: 1 | 2 | 3 | null): void;
  onMarker(emoji: string | null): void;
  onNote(id: string, note: string): void;
}

/** The selected topic's importance, priority, marker and note. Mount it with `key={node.id}`. */
export function DetailsPanel({ node, onEmphasis, onPriority, onMarker, onNote }: DetailsPanelProps) {
  const [note, setNote] = useState(node.note ?? '');
  const noteBox = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const onNoteRef = useRef(onNote);
  onNoteRef.current = onNote;

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    onNoteRef.current(node.id, text);
  };
  // A note still waiting for its pause is saved when the panel goes away (another topic was selected).
  useEffect(() => () => flush(), []);
  // Undo or redo can change the note underneath: show the stored note unless the user is typing here.
  useEffect(() => {
    if (document.activeElement !== noteBox.current) setNote(node.note ?? '');
  }, [node.note]);

  const title = (node.emoji ? `${node.emoji} ` : '') + (node.text.split('\n')[0].trim() || 'Untitled topic');
  return (
    <aside className="float details" aria-label="Topic details">
      <h2>Topic details</h2>
      <div className="topic-title">{title}</div>
      <div className="field">
        <span className="flabel">Importance</span>
        <div className="chips importance" role="group" aria-label="Importance">
          {IMPORTANCE.map((it) => (
            <button
              key={it.label}
              type="button"
              className="chip tool"
              title={it.title}
              aria-pressed={(node.emphasis ?? null) === it.value}
              onMouseDown={noFocus}
              onClick={() => onEmphasis(it.value)}
            >
              <Mini w={40} h={24} draw={it.draw} />
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="flabel">Priority</span>
        <div className="chips" role="group" aria-label="Priority">
          {PRIORITIES.map((p) => (
            <button
              key={p.label}
              type="button"
              className="chip"
              aria-label={p.label}
              title={p.title}
              aria-pressed={(node.priority ?? null) === p.value}
              onMouseDown={noFocus}
              onClick={() => onPriority(p.value)}
            >
              <Mini w={26} h={26} draw={p.draw} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="flabel">Marker</span>
        <div className="chips" role="group" aria-label="Marker">
          {MARKERS.map((mk) => (
            <button
              key={mk}
              type="button"
              className="chip"
              aria-label={`Marker ${mk}`}
              aria-pressed={node.emoji === mk}
              onMouseDown={noFocus}
              onClick={() => onMarker(node.emoji === mk ? null : mk)}
            >
              {mk}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span className="flabel">Note</span>
        <textarea
          ref={noteBox}
          aria-label="Note"
          rows={4}
          placeholder="Add a note…"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            pending.current = e.target.value;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, NOTE_DELAY_MS);
          }}
          onBlur={flush}
        />
      </label>
    </aside>
  );
}
```

- [ ] **Step 4: Wire the panel into `src/editor/EditorPage.tsx`.**

**Imports:**
- Add `import { DetailsPanel } from './DetailsPanel';`.
- Change the tree import to `import { allText, findNode } from '../model/tree';`.

**Above `export function Editor`:** add `const DETAILS_KEY = 'sketchmap:details';`.

**State:** add next to the other `useState`s:

```tsx
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      const stored = storage.getItem(DETAILS_KEY);
      if (stored !== null) return stored === '1';
    } catch {
      // Storage blocked: fall back to the default.
    }
    return window.innerWidth >= 760;
  });
```

**Helpers:** add after `endEdit`:

```tsx
  const toggleDetails = () => {
    const next = !detailsOpen;
    setDetailsOpen(next);
    try {
      storage.setItem(DETAILS_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  };
  const selectedNode = findNode(state.map.root, state.selectedId)?.node ?? null;
```

**Header:** add a button before the "Outline" button:

```tsx
        <button type="button" aria-pressed={detailsOpen} onClick={toggleDetails}>Details</button>
```

**`<Canvas>`:** add `rightInset={detailsOpen ? 296 : 0}`.

**In `<main className="editor-stage">`:** render the panel after the `InlineEditor` block and before the `OutlinePanel` block. It **must** come after the inline editor in the DOM, because existing tests find the inline editor with `container.querySelector('textarea')`.

```tsx
        {detailsOpen && selectedNode && (
          <DetailsPanel
            key={selectedNode.id}
            node={selectedNode}
            onEmphasis={(emphasis) => {
              endEdit();
              dispatch({ type: 'setEmphasis', emphasis });
            }}
            onPriority={(priority) => {
              endEdit();
              dispatch({ type: 'setPriority', priority });
            }}
            onMarker={(emoji) => {
              endEdit();
              dispatch({ type: 'setMarker', emoji });
            }}
            onNote={(id, note) => dispatch({ type: 'setNote', id, note })}
          />
        )}
```

- [ ] **Step 5: Add the styles to `src/app.css`.** Append:

```css
.details { right: 12px; top: 12px; width: 268px; max-width: calc(100% - 24px); max-height: calc(100% - 24px); overflow: auto; box-sizing: border-box; padding: 14px; display: flex; flex-direction: column; gap: 12px; z-index: 3; }
.details h2 { font: 700 12px/1 var(--ui); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-2); margin: 0; }
.details .topic-title { font-family: var(--hand); font-size: 20px; line-height: 1.2; overflow-wrap: anywhere; }
.details .field { display: flex; flex-direction: column; gap: 5px; }
.details .flabel { font: 600 12px/1.2 var(--ui); color: var(--ink-2); }
.details textarea { font: 400 13.5px/1.4 var(--ui); color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; resize: vertical; }
.details textarea:focus { border-color: var(--accent); outline: none; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.details .chip { font-size: 17px; line-height: 1; padding: 5px 6px; border-radius: 7px; border: 1px solid transparent; }
.details .chip[aria-pressed="true"] { border-color: var(--accent); background: var(--accent-soft); }
.details .chip.tool { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; font: 600 11px/1 var(--ui); color: var(--ink-2); padding: 6px 3px; }
.details .chip.tool[aria-pressed="true"] { color: var(--accent); }
.details .importance { flex-wrap: nowrap; gap: 2px; }
svg.mini { display: block; filter: var(--canvas-filter); }
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: everything passes. Existing EditorPage tests that click header buttons by text are unaffected, because the new button's text is "Details" and the panel's heading is not a button.

- [ ] **Step 7: Commit**

```bash
git add src/editor/DetailsPanel.tsx src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/app.css
git commit -m "feat(editor): details sidebar for importance, priority, marker and note" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: Markdown keeps Key, priority and markers, and says what it drops

**Files:**
- Modify: `src/io/markdown.ts`, `src/io/htmlOutline.ts`, `src/editor/EditorPage.tsx`, `src/editor/OutlinePanel.tsx`
- Test: `src/io/markdown.test.ts`, `src/io/htmlOutline.test.ts`, `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Consumes `MARKERS` (Task 1).
- Produces, in `src/io/markdown.ts`:
  - `readDecorations(raw: string): Pick<MapNode, 'text' | 'priority' | 'emoji' | 'emphasis'>`
  - `markdownLosses(root: MapNode): string[]`, a subset of `['Highlight', 'Aside', 'notes']` in that order
- `OutlinePanel` gains the prop `lost?: string[]`.

- [ ] **Step 1: Write the failing tests.**

**`src/io/markdown.test.ts`:**
- Change the import to `import { MAX_OUTLINE_DEPTH, markdownLosses, parseOutline, readDecorations, toMarkdown } from './markdown';`.
- Add inside `describe('parseOutline', …)`:

```ts
  it('writes Key as bold and priority and marker as leading emoji, and reads them back', () => {
    const tree = n('Plan', [
      { ...n('Ship'), emphasis: 'key', priority: 1 },
      { ...n('Idea'), emoji: '💡', priority: 3 },
      { ...n('Later'), emphasis: 'aside' },
    ]);
    const md = toMarkdown(tree);
    expect(md).toBe('# Plan\n- 🔴 **Ship**\n- 🔵 💡 Idea\n- Later\n');
    const pick = ({ text, emphasis, priority, emoji }: MapNode) => ({ text, emphasis, priority, emoji });
    expect(parseOutline(md)!.root.children.map(pick)).toEqual([
      { text: 'Ship', emphasis: 'key', priority: 1, emoji: undefined },
      { text: 'Idea', emphasis: undefined, priority: 3, emoji: '💡' },
      { text: 'Later', emphasis: undefined, priority: undefined, emoji: undefined },
    ]);
  });

  it('reads priority emoji, markers and whole-item bold; partial bold stays text', () => {
    expect(readDecorations('🟠 ✅ **Done**')).toEqual({ text: 'Done', priority: 2, emoji: '✅', emphasis: 'key' });
    expect(readDecorations('Not **all** bold')).toEqual({ text: 'Not **all** bold' });
    expect(readDecorations('💡idea')).toEqual({ text: '💡idea' });
  });

  it('lists what Markdown cannot keep', () => {
    const tree = n('R', [{ ...n('a'), emphasis: 'highlight' }, { ...n('b'), note: 'x' }, { ...n('c'), emphasis: 'key' }]);
    expect(markdownLosses(tree)).toEqual(['Highlight', 'notes']);
    expect(markdownLosses(n('R', [{ ...n('a'), emphasis: 'aside' }]))).toEqual(['Aside']);
    expect(markdownLosses(n('R'))).toEqual([]);
  });
```

**`src/io/htmlOutline.test.ts`:** add:

```ts
  it('reads priority emoji, markers and whole-item bold from list items too', () => {
    const parsed = parseHtmlOutline('<ul><li>🔴 💡 **Ship**</li></ul>')!;
    expect(parsed.root).toMatchObject({ text: 'Ship', priority: 1, emoji: '💡', emphasis: 'key' });
  });
```

**`src/editor/EditorPage.test.tsx`:** add inside `describe('Editor', …)`:

```tsx
  it('says what Copy as Markdown leaves out, and the Outline panel says it too', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mount(fakeApi(), { ...map, root: { ...map.root, emphasis: 'highlight', note: 'n' } });
      await click('Copy as Markdown');
      expect(container.textContent).toContain('Not kept in Markdown: Highlight, notes.');
      await click('Outline');
      expect(container.querySelector('[aria-label="Markdown outline"]')!.textContent).toContain('Not kept in Markdown: Highlight, notes.');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/io src/editor/EditorPage.test.tsx`
Expected: the new tests fail.

- [ ] **Step 3: Implement in `src/io/markdown.ts`.**

**Import:** change it to `import { MARKERS, type MapNode } from '../shared/types';`.

**Add below `oneLine`:**

```ts
const PRIORITY_MARK = { 1: '🔴', 2: '🟠', 3: '🔵' } as const;
const PRIORITY_FROM_MARK: Record<string, 1 | 2 | 3> = { '🔴': 1, '🟠': 2, '🔵': 3 };

/** One topic as one Markdown line: priority emoji, marker, then the text, bold for Key (spec §9). */
function topicLine(n: MapNode): string {
  let t = oneLine(n.text);
  if (n.emphasis === 'key' && t) t = `**${t}**`;
  if (n.emoji) t = `${n.emoji} ${t}`;
  if (n.priority) t = `${PRIORITY_MARK[n.priority]} ${t}`;
  return t.trimEnd();
}

/** Reads back what `topicLine` writes: a leading 🔴/🟠/🔵, a leading marker and a space, and a whole item in **…** (spec §9). */
export function readDecorations(raw: string): Pick<MapNode, 'text' | 'priority' | 'emoji' | 'emphasis'> {
  let text = raw;
  const out: Pick<MapNode, 'priority' | 'emoji' | 'emphasis'> = {};
  const p = /^(🔴|🟠|🔵)\s*/u.exec(text);
  if (p) {
    out.priority = PRIORITY_FROM_MARK[p[1]];
    text = text.slice(p[0].length);
  }
  const marker = MARKERS.find((m) => text.startsWith(`${m} `));
  if (marker) {
    out.emoji = marker;
    text = text.slice(marker.length + 1);
  }
  const bold = /^\*\*([\s\S]+)\*\*$/.exec(text);
  if (bold && bold[1].trim() && !bold[1].includes('**')) {
    out.emphasis = 'key';
    text = bold[1];
  }
  return { text, ...out };
}

/** What Markdown can't carry, for the "not kept" notice (spec §9): Highlight, Aside and notes. */
export function markdownLosses(root: MapNode): string[] {
  const found = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.emphasis === 'highlight') found.add('Highlight');
    if (n.emphasis === 'aside') found.add('Aside');
    if (n.note?.trim()) found.add('notes');
    stack.push(...n.children);
  }
  return ['Highlight', 'Aside', 'notes'].filter((x) => found.has(x));
}
```

**In `toMarkdown`:** use `topicLine` in both places. The root line becomes `` `# ${topicLine(root)}` ``, and each child line becomes `` `${'  '.repeat(depth)}- ${topicLine(c)}` ``.

**In `parseOutline`:** replace the `make` line with:

```ts
  const make = (t: string): MapNode => {
    const { text: body, ...rest } = readDecorations(t);
    return { id: newNodeId(), text: body.slice(0, MAX_TEXT), children: [], ...rest };
  };
```

**Why `stack.push(...n.children)` is safe in `markdownLosses`:** it spreads one topic's children, which is bounded by what one topic holds, not by the whole map.

- [ ] **Step 4: Implement in `src/io/htmlOutline.ts`.**
  - Change the markdown import to `import { MAX_OUTLINE_DEPTH, readDecorations, type ParsedOutline } from './markdown';`.
  - In `toNode`, replace `if (text) return [{ id: newNodeId(), text, children }];` with:

```ts
    if (text) {
      const { text: body, ...rest } = readDecorations(text);
      return [{ id: newNodeId(), text: body, children, ...rest }];
    }
```

- [ ] **Step 5: Show the notice in `src/editor/EditorPage.tsx` and `src/editor/OutlinePanel.tsx`.**

**`EditorPage.tsx`:**
- Change the import to `import { markdownLosses, parseOutline, toMarkdown } from '../io/markdown';`.
- Add the state `const [mdNotice, setMdNotice] = useState<string | null>(null);`.
- Replace `copyMarkdown` with:

```tsx
  const copyMarkdown = () => {
    if (!navigator.clipboard) {
      setOutlineOpen(true);
      return;
    }
    const lost = markdownLosses(state.map.root);
    navigator.clipboard.writeText(toMarkdown(state.map.root)).then(
      () => {
        setMdCopied(true);
        setMdNotice(lost.length ? `Copied. Not kept in Markdown: ${lost.join(', ')}.` : null);
      },
      () => setOutlineOpen(true),
    );
  };
```

- Render the notice next to the `exportError` banner:

```tsx
      {mdNotice && (
        <div className="banner" role="status">
          {mdNotice}
          <button type="button" onClick={() => setMdNotice(null)}>Dismiss</button>
        </div>
      )}
```

- Pass the losses to the panel: `<OutlinePanel … lost={markdownLosses(state.map.root)} />`.

**`OutlinePanel.tsx`:**
- Add `lost?: string[];` to `Props`, and destructure it.
- Add after the existing `<p className="muted">…</p>`:

```tsx
      {lost && lost.length > 0 && <p className="muted">Not kept in Markdown: {lost.join(', ')}.</p>}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npm test && npm run typecheck`
Expected: everything passes, including the existing Markdown round-trip and paste tests.

- [ ] **Step 7: Commit**

```bash
git add src/io/markdown.ts src/io/markdown.test.ts src/io/htmlOutline.ts src/io/htmlOutline.test.ts src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/editor/OutlinePanel.tsx
git commit -m "feat(io): Markdown keeps Key, priority and markers and names what it drops" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: End-to-end test and README

**Files:**
- Modify: `e2e/smoke.spec.ts`, `README.md`

**Interfaces:**
- Consumes the markup from Tasks 2 and 4, and the existing `openNewMap(page)` helper in `e2e/smoke.spec.ts`.

- [ ] **Step 1: Write the test.** Append to `e2e/smoke.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run it**

Run: `npx playwright test`
Expected: 4 passed.
- After the Tab the new topic is open for typing. Enter commits it and keeps it selected.
- If `Alt+Digit2` does not reach the window keydown listener because a button has focus, check the step-1 note in `EditorChrome.tsx`. The sidebar buttons use `onMouseDown` preventDefault, so focus stays where it was. Fix the test, not the app, unless the app is wrong.

- [ ] **Step 3: Update `README.md`.** Add a short "Topic details" section next to the step-2 features section, in the README's existing style:
  - The **Details** button shows or hides the sidebar for the selected topic.
  - **Importance:** Key, Highlight, Normal and Aside, with Alt ↑ / Alt ↓.
  - **Priority:** ①②③, with Alt 1–3, and Alt 0 to clear.
  - **Marker:** the ten markers. Clicking the active marker removes it.
  - **Note:** saved as you type. Hover the little page icon on a topic to read it, in the editor and in the Notion view.
  - **Copy as Markdown** keeps Key (bold), priority (🔴🟠🔵) and markers. It names what it can't keep: Highlight, Aside and notes.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run test:worker && npx playwright test`
Expected: all pass. Unit tests are 178 plus the new ones, the Worker has 12, and e2e has 4.

- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts README.md
git commit -m "test(e2e): topic details survive a reload and show in the view; README" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage:**
- §3 importance and priority: Tasks 1–4.
- The marker set: Tasks 1 and 4.
- Notes: Tasks 1–4.
- §4 Alt keys: Task 3. The details panel's title, importance, priority, marker and note: Task 4.
- §6 looks, badge and note icon: Task 2.
- §9 Markdown for Key and priority: Task 5.
- §10 unit tests for "model edits and undo, including importance bumps and priority": Task 3.
- Deferred to plan 3b: links (`parseRich`, ⌘K, paste over selection, the links list in the panel, the CSP).
- Deferred to plan 3c: `.xmind` import.

**Types:** these names are used consistently across tasks:
- `Measured`: `lineWidths`, `textW`, `badgeW`, `noteW`
- `BranchPath.toEmphasis`
- the actions `setEmphasis`, `bumpEmphasis`, `setPriority`, `setMarker` and `setNote`
- the commands `emphasis` and `priority`
- `readDecorations` and `markdownLosses`

**Known limits, kept on purpose:**
- The note tooltip uses SVG `<title>`, so it has no touch support.
- Pasted HTML bold (`<strong>`) is not read as Key; only the `**…**` text form is.
