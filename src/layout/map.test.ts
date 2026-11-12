import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from './map';
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
});
