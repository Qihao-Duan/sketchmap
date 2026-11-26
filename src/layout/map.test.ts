import { describe, expect, it } from 'vitest';
import type { LayoutKind, MapNode } from '../shared/types';
import { computeLayout } from './map';
import { layoutMap } from './index';
import { PALETTE, ROOT_COLOR } from './styles';
import type { Measure } from './wrap';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode =>
  ({ id, text, children, ...extra });

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomTree(rand: () => number, depth = 0, counter = { v: 0 }): MapNode {
  const kids = depth >= 4 ? 0 : Math.floor(rand() * (depth === 0 ? 7 : 4));
  const words = 1 + Math.floor(rand() * 12);
  return {
    id: `n${counter.v++}`,
    text: Array.from({ length: words }, () => 'word').join(' '),
    children: Array.from({ length: kids }, () => randomTree(rand, depth + 1, counter)),
    ...(rand() < 0.1 ? { collapsed: true } : {}),
  };
}

describe('computeLayout (balanced map)', () => {
  it('centres the root on the origin', () => {
    const l = computeLayout(n('r', 'Root'), measure);
    const r = l.byId.get('r')!;
    expect([r.x + r.w / 2, r.y + r.h / 2, r.side]).toEqual([0, 0, 0]);
  });

  it('fills the right side first, then the left in reverse (clockwise)', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A'), n('b', 'B'), n('c', 'C'), n('d', 'D')]), measure);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => l.byId.get(id)!);
    expect([a.side, b.side, c.side, d.side]).toEqual([1, 1, -1, -1]);
    expect(a.y).toBeLessThan(b.y);
    expect(d.y).toBeLessThan(c.y);
    expect(a.x).toBeGreaterThan(0);
    expect(c.x + c.w).toBeLessThan(0);
  });

  it('keeps 70 px between the root and first-level topics, 36 px deeper', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')])]), measure);
    const [r, a, a1] = ['r', 'a', 'a1'].map((id) => l.byId.get(id)!);
    expect(a.x - (r.x + r.w)).toBe(70);
    expect(a1.x - (a.x + a.w)).toBe(36);
  });

  it('hides the children of a folded topic', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')], { collapsed: true })]), measure);
    expect(l.byId.has('a1')).toBe(false);
    expect(l.branches).toHaveLength(1);
  });

  it('colours first-level branches from the palette and children inherit', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')]), n('b', 'B')]), measure);
    expect(l.byId.get('r')!.color).toEqual(ROOT_COLOR);
    expect(l.byId.get('a')!.color).toEqual(PALETTE[0]);
    expect(l.byId.get('a1')!.color).toEqual(PALETTE[0]);
    expect(l.byId.get('b')!.color).toEqual(PALETTE[1]);
  });

  it('draws one branch per non-root topic, as a cubic path', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')])]), measure);
    expect(l.branches.map((b) => [b.from, b.to])).toEqual([['r', 'a'], ['a', 'a1']]);
    expect(l.branches[0].d).toMatch(/^M-?[\d.]+ -?[\d.]+ C/);
  });

  it('never overlaps topics in 200 random maps, and bounds contain them all', () => {
    const rand = mulberry32(42);
    for (let k = 0; k < 200; k++) {
      const l = computeLayout(randomTree(rand), measure);
      const bs = l.boxes;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        expect(a.x).toBeGreaterThanOrEqual(l.bounds.x);
        expect(a.y + a.h).toBeLessThanOrEqual(l.bounds.y + l.bounds.h);
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
          expect(overlap, `${a.id} overlaps ${b.id} in tree ${k}`).toBe(false);
        }
      }
    }
  });

  it('with sides fixed by hand, each main branch is on its own side: right from the top in order, left from the bottom (clockwise)', () => {
    const l = computeLayout(n('r', 'Root', [
      n('a', 'A', [], { side: 'left' }), n('b', 'B', [], { side: 'right' }), n('c', 'C', [], { side: 'left' }), n('d', 'D', [], { side: 'right' }),
    ]), measure);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => l.byId.get(id)!);
    expect([a.side, b.side, c.side, d.side]).toEqual([-1, 1, -1, 1]);
    expect(b.y).toBeLessThan(d.y);
    expect(c.y).toBeLessThan(a.y);
  });

  it('with sides fixed, a tall branch no longer pushes its neighbours to the other side', () => {
    const tall = n('a', 'A', Array.from({ length: 12 }, (_, i) => n(`a${i}`, 'x')), { side: 'right' });
    const l = computeLayout(n('r', 'Root', [tall, n('b', 'B', [], { side: 'right' }), n('c', 'C', [], { side: 'right' })]), measure);
    expect(['a', 'b', 'c'].map((id) => l.byId.get(id)!.side)).toEqual([1, 1, 1]);
    // the same map without sides is balanced by height: everything after the tall branch goes left
    const auto = computeLayout(n('r', 'Root', [{ ...tall, side: undefined }, n('b', 'B'), n('c', 'C')]), measure);
    expect(['a', 'b', 'c'].map((id) => auto.byId.get(id)!.side)).toEqual([1, -1, -1]);
  });

  it('with sides fixed, a main branch without one goes where the branch before it is; before any, right', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A'), n('b', 'B', [], { side: 'left' }), n('c', 'C'), n('d', 'D', [], { side: 'right' }), n('e', 'E')]), measure);
    expect(['a', 'b', 'c', 'd', 'e'].map((id) => l.byId.get(id)!.side)).toEqual([1, -1, -1, 1, 1]);
  });

  it('all main branches may be on the left', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')], { side: 'left' }), n('b', 'B', [], { side: 'left' })]), measure);
    expect(['a', 'a1', 'b'].map((id) => l.byId.get(id)!.side)).toEqual([-1, -1, -1]);
    expect(l.byId.get('a1')!.x + l.byId.get('a1')!.w).toBeLessThan(l.byId.get('a')!.x);
  });

  it('a logic chart and an org chart ignore the sides', () => {
    const tree = n('r', 'Root', [n('a', 'A', [], { side: 'left' }), n('b', 'B', [], { side: 'right' })]);
    expect(['a', 'b'].map((id) => computeLayout(tree, measure, 'logic').byId.get(id)!.side)).toEqual([1, 1]);
    const org = layoutMap(tree, 'org', measure);
    expect(org.byId.get('a')!.x).toBeLessThan(org.byId.get('b')!.x);
  });

  it('says which layout it is', () => {
    const tree = n('r', 'Root', [n('a', 'A')]);
    expect((['map', 'logic', 'org'] as const).map((kind) => layoutMap(tree, kind, measure).kind)).toEqual(['map', 'logic', 'org']);
  });

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
});

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

/** Adds random importance, priority, notes and markers, using its own random stream. */
function decorate(node: MapNode, rand: () => number): MapNode {
  const r = rand();
  return {
    ...node,
    ...(r < 0.2 ? { emphasis: 'key' as const } : r < 0.35 ? { emphasis: 'aside' as const } : r < 0.45 ? { emphasis: 'highlight' as const } : {}),
    ...(rand() < 0.25 ? { priority: (1 + Math.floor(rand() * 3)) as 1 | 2 | 3 } : {}),
    ...(rand() < 0.2 ? { note: 'a note' } : {}),
    ...(rand() < 0.2 ? { emoji: '💡' } : {}),
    ...(rand() < 0.1 ? { image: { key: 'img/test1234567890123456/a.png', w: 80, h: 40 } } : {}),
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

describe('topic images', () => {
  const image = { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 };
  const at = (text: string, kind: LayoutKind = 'map') =>
    layoutMap(n('r', 'Root', [n('a', 'A', [n('x', text, [], { image })])]), kind, measure).byId.get('x')!;

  it('reserves the image above the text, with a gap, and sizes the box to fit it', () => {
    const t = at('Cat');
    expect(t.image).toEqual({ x: 5, y: 4, w: 200, h: 100 });
    expect(t.textTop).toBe(4 + 100 + 8);
    expect(t.w).toBeGreaterThanOrEqual(210);
    expect(t.h).toBe(t.textTop + 22 + 4);
  });

  it('with no text, there are no lines: just the image, and no gap beneath it', () => {
    const t = at('');
    expect(t.lines).toEqual([]);
    expect(t.lineWidths).toEqual([]);
    expect(t.segments).toEqual([]);
    expect(t.textTop).toBe(4 + 100);
    expect(t.h).toBe(4 + 100 + 4);
  });

  it('centres the image for non-line kinds, left-aligns it for line topics', () => {
    const line = at('Cat', 'map'); // depth 2, line kind
    expect(line.image!.x).toBe(line.style.padX);
    const box = layoutMap(n('r', 'Root', [n('a', 'A', [], { image })]), 'map', measure).byId.get('a')!; // depth 1, box kind
    expect(box.style.kind).toBe('box');
    expect(box.image!.x).toBeCloseTo((box.w - box.image!.w) / 2);
  });

  it('without an image, textTop is just padY and sizing is unaffected', () => {
    const t = layoutMap(n('r', 'Root', [n('a', 'A', [n('x', 'Cat')])]), 'map', measure).byId.get('x')!;
    expect(t.image).toBeUndefined();
    expect(t.textTop).toBe(t.style.padY);
  });
});

describe('links in topics', () => {
  const at = (text: string) => layoutMap(n('r', 'Root', [n('a', 'A', [n('x', text)])]), 'map', measure).byId.get('x')!;

  it('lays out the plain text and cuts the line at link boundaries', () => {
    const t = at('Read [the docs](https://example.com/docs) now');
    expect(t.lines).toEqual(['Read the docs now']);
    expect(t.segments[0]).toEqual([
      { text: 'Read ', x: 0, w: measure('Read ', 17) },
      { text: 'the docs', x: measure('Read ', 17), w: measure('the docs', 17), href: 'https://example.com/docs' },
      { text: ' now', x: measure('Read the docs', 17), w: measure(' now', 17) },
    ]);
  });

  it('keeps the link on every line it wraps onto, after a marker prefix too', () => {
    const t = layoutMap(n('r', 'Root', [n('a', 'A', [n('x', `[${'word '.repeat(8)}end](https://x.com/y)`, [], { emoji: '💡' })])]), 'map', measure).byId.get('x')!;
    expect(t.lines.length).toBeGreaterThan(1);
    expect(t.segments[0][0]).toEqual({ text: '💡 ', x: 0, w: measure('💡 ', 17) });
    for (const line of t.segments) expect(line.filter((s) => s.text.trim()).every((s) => s.href === 'https://x.com/y' || s.text === '💡 ')).toBe(true);
  });

  it('gives a line without links a single plain segment', () => {
    expect(at('Plain').segments).toEqual([[{ text: 'Plain', x: 0, w: measure('Plain', 17) }]]);
  });
});

describe('image topics keep their badge, marker and note inside the box', () => {
  const img = { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 };
  const at = (extra: Partial<MapNode>) => layoutMap(n('r', 'Root', [n('a', 'A', [n('x', '', [], { image: img, ...extra })])]), 'map', measure).byId.get('x')!;
  it('an image-only topic has no text line, but a priority, a note or a marker keeps one', () => {
    expect(at({}).lines).toEqual([]);
    for (const extra of [{ priority: 1 as const }, { note: 'n' }, { emoji: '💡' }]) {
      const t = at(extra);
      expect(t.lines, JSON.stringify(extra)).toHaveLength(1);
      expect(t.h, JSON.stringify(extra)).toBeGreaterThanOrEqual(t.textTop + t.style.lineHeight + t.style.padY);
    }
  });
});

describe('a text width set by hand (wrap)', () => {
  // 17 px text in a deeper topic: 8.5 px a character, so 250 px (the width of its level) holds 29 characters: 6 words.
  const long = Array.from({ length: 24 }, () => 'word').join(' ');
  const deep = (extra: Partial<MapNode> = {}) => computeLayout(n('r', 'Root', [n('a', 'A', [n('t', long, [], extra)])]), measure).byId.get('t')!;

  it('the text wraps at that width instead of the width of its level', () => {
    expect(deep().lines).toHaveLength(4);
    expect(deep({ wrap: 500 }).lines).toHaveLength(3);
    expect(deep({ wrap: 100 }).lines).toHaveLength(12);
    for (const wrap of [100, 500]) for (const w of deep({ wrap }).lineWidths) expect(w).toBeLessThanOrEqual(wrap);
  });

  it('the topic gets wider and lower, and its box still fits the text exactly', () => {
    const [auto, wide] = [deep(), deep({ wrap: 500 })];
    expect(wide.w).toBeGreaterThan(auto.w);
    expect(wide.h).toBeLessThan(auto.h);
    expect(wide.w).toBe(Math.ceil(Math.max(...wide.lineWidths) + wide.style.padX * 2));
  });

  it('a topic with less text than that stays as narrow as its text', () => {
    const short = (extra: Partial<MapNode> = {}) => computeLayout(n('r', 'Root', [n('a', 'A', [n('t', 'Two words', [], extra)])]), measure).byId.get('t')!;
    expect(short({ wrap: 500 }).w).toBe(short().w);
    expect(short({ wrap: 500 }).lines).toEqual(['Two words']);
  });

  it('a word is never broken: one that is longer than the width keeps its line', () => {
    const t = computeLayout(n('r', 'Root', [n('a', 'A', [n('t', 'Supercalifragilistic is longer', [], { wrap: 60 })])]), measure).byId.get('t')!;
    expect(t.lines).toEqual(['Supercalifragilistic', 'is', 'longer']);
    expect(t.textW).toBe(20 * 8.5);
  });

  it('holds for the central topic, for main branches and in every layout', () => {
    for (const kind of ['map', 'logic', 'org'] as LayoutKind[]) {
      const at = (wrap?: number) => layoutMap(n('r', long, [n('a', long, [n('t', long, [], wrap ? { wrap } : {})], wrap ? { wrap } : {})], wrap ? { wrap } : {}), kind, measure);
      for (const id of ['r', 'a', 't']) {
        expect(at(600).byId.get(id)!.lines.length, `${kind} ${id}`).toBeLessThan(at().byId.get(id)!.lines.length);
      }
    }
  });

  it('an image-only topic has no text to wrap: the width changes nothing', () => {
    const image = { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 };
    const pic = (extra: Partial<MapNode> = {}) => computeLayout(n('r', 'Root', [n('p', '', [], { image, ...extra })]), measure).byId.get('p')!;
    expect(pic({ wrap: 600 }).lines).toEqual([]);
    expect([pic({ wrap: 600 }).w, pic({ wrap: 600 }).h]).toEqual([pic().w, pic().h]);
  });
});
