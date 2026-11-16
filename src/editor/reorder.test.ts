import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { layoutMap } from '../layout';
import { GAP, ORG } from '../layout/styles';
import { dropAt, shownSides, stepSibling } from './reorder';

const measure = (t: string, size: number) => t.length * size * 0.5;
const n = (id: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text: id.toUpperCase(), children, ...extra });
/** r → a (a1 a2 a3), b, c, d. Balanced by height, the map layout shows a and b on the right, d above c on the left. */
const tree = () => n('r', [n('a', [n('a1'), n('a2'), n('a3')]), n('b'), n('c'), n('d')]);
const map = layoutMap(tree(), 'map', measure);
const logic = layoutMap(tree(), 'logic', measure);
const org = layoutMap(tree(), 'org', measure);
const box = (l: typeof map, id: string) => l.byId.get(id)!;
const mid = (l: typeof map, id: string) => ({ x: box(l, id).x + box(l, id).w / 2, y: box(l, id).y + box(l, id).h / 2 });
/** A point on a topic: `fx`, `fy` from 0 (left / top edge) to 1 (right / bottom edge). */
const on = (l: typeof map, id: string, fx: number, fy: number) => ({ x: box(l, id).x + box(l, id).w * fx, y: box(l, id).y + box(l, id).h * fy });
const drop = (l: typeof map, p: { x: number; y: number }, moving: string[] = ['zz']) => dropAt(l, p.x, p.y, moving);

describe('the fixture', () => {
  it('is laid out as the tests below assume', () => {
    expect(['a', 'b', 'c', 'd'].map((id) => box(map, id).side)).toEqual([1, 1, -1, -1]);
    expect(box(map, 'd').y).toBeLessThan(box(map, 'c').y);
  });
});

describe('dropAt: where dragged topics would go', () => {
  it('the middle of a topic: onto it, with no line', () => {
    expect(drop(logic, mid(logic, 'a2'))).toEqual({ targetId: 'a2', where: 'into' });
    expect(drop(logic, mid(logic, 'b'))).toEqual({ targetId: 'b', where: 'into' });
  });

  it('the top edge of a topic: just before it; the bottom edge: just after it; a line shows the place', () => {
    const a2 = box(logic, 'a2');
    expect(drop(logic, on(logic, 'a2', 0.5, 0.05))).toEqual({
      targetId: 'a2', where: 'before', line: { x1: a2.x, y1: a2.y - GAP.vDeep / 2, x2: a2.x + a2.w, y2: a2.y - GAP.vDeep / 2 },
    });
    expect(drop(logic, on(logic, 'a2', 0.5, 0.95))).toEqual({
      targetId: 'a2', where: 'after', line: { x1: a2.x, y1: a2.y + a2.h + GAP.vDeep / 2, x2: a2.x + a2.w, y2: a2.y + a2.h + GAP.vDeep / 2 },
    });
    const b = box(logic, 'b');
    expect(drop(logic, on(logic, 'b', 0.5, 0.05))?.line?.y1).toBe(b.y - GAP.vRoot / 2);
  });

  it('the middle half of a topic takes children; the quarter at each end is the place next to it', () => {
    for (const id of ['a2', 'b']) {
      expect(drop(logic, on(logic, id, 0.5, 0.2)), id).toMatchObject({ targetId: id, where: 'before' });
      expect(drop(logic, on(logic, id, 0.5, 0.27)), id).toEqual({ targetId: id, where: 'into' });
      expect(drop(logic, on(logic, id, 0.5, 0.73)), id).toEqual({ targetId: id, where: 'into' });
      expect(drop(logic, on(logic, id, 0.5, 0.8)), id).toMatchObject({ targetId: id, where: 'after' });
    }
    expect(drop(org, on(org, 'b', 0.2, 0.5))).toMatchObject({ targetId: 'b', where: 'before' });
    expect(drop(org, on(org, 'b', 0.27, 0.5))).toEqual({ targetId: 'b', where: 'into' });
    expect(drop(org, on(org, 'b', 0.73, 0.5))).toEqual({ targetId: 'b', where: 'into' });
    expect(drop(org, on(org, 'b', 0.8, 0.5))).toMatchObject({ targetId: 'b', where: 'after' });
  });

  it('the fold toggle of a topic counts as the topic: dropped there, topics become its children', () => {
    for (const l of [map, logic, org]) {
      const a = box(l, 'a');
      expect(drop(l, { x: a.fold.x, y: a.fold.y }), l.kind).toEqual({ targetId: 'a', where: 'into' });
      expect(drop(l, { x: a.fold.x + 10, y: a.fold.y - 10 }), l.kind).toEqual({ targetId: 'a', where: 'into' });
      expect(drop(l, { x: a.fold.x, y: a.fold.y }, ['a']), l.kind).toBeNull();
    }
    // a topic without children has no toggle: beyond its box there is nothing
    const b = box(logic, 'b');
    expect(drop(logic, { x: b.fold.x, y: b.fold.y })).toBeNull();
    // folded, the toggle is the counter badge
    const folded = layoutMap(n('r', [n('a', [n('a1')], { collapsed: true }), n('b')]), 'logic', measure);
    expect(drop(folded, { x: box(folded, 'a').fold.x, y: box(folded, 'a').fold.y })).toEqual({ targetId: 'a', where: 'into' });
  });

  it('the hit area reaches 4 px beyond the topic, like a press on it', () => {
    const a2 = box(logic, 'a2');
    expect(drop(logic, { x: a2.x - 3, y: a2.y + a2.h / 2 })).toMatchObject({ targetId: 'a2', where: 'into' });
    expect(drop(logic, { x: a2.x + a2.w / 2, y: a2.y - 3 })).toMatchObject({ targetId: 'a2', where: 'before' });
  });

  it('in the gap between two topics: next to the nearer one', () => {
    const a1 = box(logic, 'a1');
    const a2 = box(logic, 'a2');
    const x = a1.x + 5;
    expect(drop(logic, { x, y: a1.y + a1.h + 4.5 })).toMatchObject({ targetId: 'a1', where: 'after' });
    expect(drop(logic, { x, y: a2.y - 4.5 })).toMatchObject({ targetId: 'a2', where: 'before' });
  });

  it('away from every topic: nowhere', () => {
    const a3 = box(logic, 'a3');
    expect(drop(logic, { x: a3.x + a3.w + 200, y: a3.y })).toBeNull();
    expect(drop(logic, { x: a3.x + 5, y: a3.y + a3.h + 15 })).toBeNull();
  });

  it('a dragged topic, and everything in its branch, is no place to drop', () => {
    expect(drop(logic, mid(logic, 'a2'), ['a'])).toBeNull();
    expect(drop(logic, mid(logic, 'a'), ['a'])).toBeNull();
    expect(drop(logic, on(logic, 'a2', 0.5, 0.05), ['b', 'a2'])).toBeNull();
    expect(drop(logic, mid(logic, 'a2'), ['b', 'a1'])).toEqual({ targetId: 'a2', where: 'into' });
  });

  it('in the gap next to a dragged topic, the place is next to its neighbour', () => {
    const a1 = box(logic, 'a1');
    const a2 = box(logic, 'a2');
    expect(drop(logic, { x: a2.x + 5, y: a2.y - 4.5 }, ['a2'])).toMatchObject({ targetId: 'a1', where: 'after' });
    expect(a2.y - 4.5 - (a1.y + a1.h)).toBeLessThan(14);
    // on the dragged topic itself (its hit area included) there is no place
    expect(drop(logic, { x: a2.x + 5, y: a2.y - 2 }, ['a2'])).toBeNull();
  });

  it('map layout: a place among the main branches carries its side', () => {
    expect(drop(map, on(map, 'b', 0.5, 0.05))).toMatchObject({ targetId: 'b', where: 'before', side: 'right' });
    expect(drop(map, on(map, 'b', 0.5, 0.95))).toMatchObject({ targetId: 'b', where: 'after', side: 'right' });
    expect(drop(map, mid(map, 'b'))).toEqual({ targetId: 'b', where: 'into' });
    expect(drop(map, on(map, 'a2', 0.5, 0.05))).not.toHaveProperty('side');
  });

  it('map layout: the left side runs from the bottom up, so above a topic there is after it in order', () => {
    const c = box(map, 'c');
    expect(drop(map, on(map, 'c', 0.5, 0.05))).toEqual({
      targetId: 'c', where: 'after', side: 'left', line: { x1: c.x, y1: c.y - GAP.vRoot / 2, x2: c.x + c.w, y2: c.y - GAP.vRoot / 2 },
    });
    expect(drop(map, on(map, 'c', 0.5, 0.95))).toMatchObject({ targetId: 'c', where: 'before', side: 'left' });
  });

  it('map layout: the central topic takes a branch onto the side of the half it is dropped on', () => {
    const r = box(map, 'r');
    // a line along that side of the central topic shows which side it will be
    expect(drop(map, on(map, 'r', 0.2, 0.5))).toEqual({
      targetId: 'r', where: 'into', side: 'left', line: { x1: r.x - 10, y1: r.y, x2: r.x - 10, y2: r.y + r.h },
    });
    expect(drop(map, on(map, 'r', 0.8, 0.1))).toEqual({
      targetId: 'r', where: 'into', side: 'right', line: { x1: r.x + r.w + 10, y1: r.y, x2: r.x + r.w + 10, y2: r.y + r.h },
    });
  });

  it('logic and org charts have no sides', () => {
    expect(drop(logic, on(logic, 'r', 0.2, 0.5))).toEqual({ targetId: 'r', where: 'into' });
    expect(drop(logic, on(logic, 'b', 0.5, 0.05))).not.toHaveProperty('side');
    expect(drop(org, on(org, 'r', 0.2, 0.5))).toEqual({ targetId: 'r', where: 'into' });
  });

  it('org chart: the main branches stand side by side, so the left and right edges are the places next to them', () => {
    const b = box(org, 'b');
    expect(drop(org, on(org, 'b', 0.05, 0.5))).toEqual({
      targetId: 'b', where: 'before', line: { x1: b.x - ORG.colGap / 2, y1: b.y, x2: b.x - ORG.colGap / 2, y2: b.y + b.h },
    });
    expect(drop(org, on(org, 'b', 0.95, 0.5))).toEqual({
      targetId: 'b', where: 'after', line: { x1: b.x + b.w + ORG.colGap / 2, y1: b.y, x2: b.x + b.w + ORG.colGap / 2, y2: b.y + b.h },
    });
    expect(drop(org, on(org, 'b', 0.5, 0.05))).toEqual({ targetId: 'b', where: 'into' });
    // in the gap between two of them
    const c = box(org, 'c');
    expect(drop(org, { x: c.x - 5, y: c.y + c.h / 2 })).toMatchObject({ targetId: 'c', where: 'before' });
  });

  it('org chart: under a topic that shows children comes its first child, so its bottom edge is the place before that child', () => {
    // r → a (a1 (a11 a12), a2), b: the rows of a are a1, a11, a12, a2, each indented by its depth
    const deep = layoutMap(n('r', [n('a', [n('a1', [n('a11'), n('a12')]), n('a2')]), n('b')]), 'org', measure);
    const a11 = box(deep, 'a11');
    const place = { targetId: 'a11', where: 'before', line: { x1: a11.x, y1: a11.y - ORG.rowGap / 2, x2: a11.x + a11.w, y2: a11.y - ORG.rowGap / 2 } };
    expect(drop(deep, on(deep, 'a1', 0.5, 0.95))).toEqual(place);
    // the gap between the two rows gives the same place from either side
    const a1 = box(deep, 'a1');
    expect(drop(deep, { x: a11.x + 2, y: a1.y + a1.h + 4.5 })).toEqual(place);
    expect(drop(deep, { x: a11.x + 2, y: a11.y - 4.5 })).toEqual(place);
    // folded, or without children, the place under a topic is the one after it
    expect(drop(deep, on(deep, 'a12', 0.5, 0.95))).toMatchObject({ targetId: 'a12', where: 'after' });
    const folded = layoutMap(n('r', [n('a', [n('a1', [n('a11')], { collapsed: true }), n('a2')])]), 'org', measure);
    expect(drop(folded, on(folded, 'a1', 0.5, 0.95))).toMatchObject({ targetId: 'a1', where: 'after' });
    // the child being dragged itself does not count
    expect(drop(deep, on(deep, 'a1', 0.5, 0.95), ['a11'])).toMatchObject({ targetId: 'a12', where: 'before' });
    expect(drop(deep, on(deep, 'a1', 0.5, 0.95), ['a11', 'a12'])).toMatchObject({ targetId: 'a1', where: 'after' });
    // the keys still move a topic past its sibling's whole branch
    expect(stepSibling(deep, 'a2', 'up')).toEqual({ targetId: 'a1', where: 'before' });
    expect(stepSibling(deep, 'a1', 'down')).toEqual({ targetId: 'a2', where: 'after' });
  });

  it('org chart: deeper topics are listed one below the other', () => {
    const a2 = box(org, 'a2');
    expect(drop(org, on(org, 'a2', 0.5, 0.05))).toEqual({
      targetId: 'a2', where: 'before', line: { x1: a2.x, y1: a2.y - ORG.rowGap / 2, x2: a2.x + a2.w, y2: a2.y - ORG.rowGap / 2 },
    });
    expect(drop(org, on(org, 'a2', 0.5, 0.95))).toMatchObject({ targetId: 'a2', where: 'after' });
    expect(drop(org, on(org, 'a2', 0.05, 0.5))).toEqual({ targetId: 'a2', where: 'into' });
  });
});

describe('stepSibling: one place in a direction, from the keyboard', () => {
  it('up and down move a topic over the sibling above or below it', () => {
    expect(stepSibling(logic, 'a2', 'up')).toEqual({ targetId: 'a1', where: 'before' });
    expect(stepSibling(logic, 'a2', 'down')).toEqual({ targetId: 'a3', where: 'after' });
    expect(stepSibling(logic, 'b', 'up')).toEqual({ targetId: 'a', where: 'before' });
    expect(stepSibling(org, 'a2', 'down')).toEqual({ targetId: 'a3', where: 'after' });
  });

  it('nothing at the end of the list, for the central topic, or for an unknown topic', () => {
    expect(stepSibling(logic, 'a1', 'up')).toBeNull();
    expect(stepSibling(logic, 'a3', 'down')).toBeNull();
    expect(stepSibling(logic, 'r', 'down')).toBeNull();
    expect(stepSibling(logic, 'nope', 'down')).toBeNull();
  });

  it('left and right do nothing where topics are listed one below the other', () => {
    expect(stepSibling(logic, 'a2', 'left')).toBeNull();
    expect(stepSibling(logic, 'b', 'right')).toBeNull();
    expect(stepSibling(map, 'a2', 'left')).toBeNull();
    expect(stepSibling(org, 'a2', 'right')).toBeNull();
  });

  it('map layout: a main branch stays on its side, and the place carries the side', () => {
    expect(stepSibling(map, 'b', 'up')).toEqual({ targetId: 'a', where: 'before', side: 'right' });
    expect(stepSibling(map, 'a', 'down')).toEqual({ targetId: 'b', where: 'after', side: 'right' });
    expect(stepSibling(map, 'b', 'down')).toBeNull();
    // the left side runs from the bottom up: c is below d
    expect(stepSibling(map, 'c', 'up')).toEqual({ targetId: 'd', where: 'after', side: 'left' });
    expect(stepSibling(map, 'd', 'down')).toEqual({ targetId: 'c', where: 'before', side: 'left' });
    expect(stepSibling(map, 'd', 'up')).toBeNull();
  });

  it('map layout: left and right take a main branch to the other side, at about the height it is at', () => {
    // right, from the top: x (centre -35), y (+35). left, from the top: s (-70), q (0), p (+70); in order p, q, s.
    const two = layoutMap(n('r', [n('x', [], { side: 'right' }), n('y', [], { side: 'right' }), n('p', [], { side: 'left' }), n('q', [], { side: 'left' }), n('s', [], { side: 'left' })]), 'map', measure);
    const centre = (id: string) => box(two, id).y + box(two, id).h / 2;
    expect(['x', 'y', 's', 'q', 'p'].map(centre)).toEqual([-35, 35, -70, 0, 70]);
    // x goes above q, the first branch on the left that is lower than it: after q in order
    expect(stepSibling(two, 'x', 'left')).toEqual({ targetId: 'q', where: 'after', side: 'left' });
    expect(stepSibling(two, 'y', 'left')).toEqual({ targetId: 'p', where: 'after', side: 'left' });
    // q goes above y on the right, where above is before in order
    expect(stepSibling(two, 'q', 'right')).toEqual({ targetId: 'y', where: 'before', side: 'right' });
    // nothing on the other side is lower than p: it goes below the lowest one
    expect(stepSibling(two, 'p', 'right')).toEqual({ targetId: 'y', where: 'after', side: 'right' });
    // already on that side
    expect(stepSibling(two, 'x', 'right')).toBeNull();
    expect(stepSibling(two, 'p', 'left')).toBeNull();
  });

  it('map layout: onto an empty side goes through the central topic', () => {
    const oneSided = layoutMap(n('r', [n('a', [], { side: 'right' }), n('b', [], { side: 'right' })]), 'map', measure);
    expect(stepSibling(oneSided, 'b', 'left')).toEqual({ targetId: 'r', where: 'into', side: 'left' });
  });

  it('org chart: the main branches move left and right, not up and down', () => {
    expect(stepSibling(org, 'b', 'left')).toEqual({ targetId: 'a', where: 'before' });
    expect(stepSibling(org, 'b', 'right')).toEqual({ targetId: 'c', where: 'after' });
    expect(stepSibling(org, 'a', 'left')).toBeNull();
    expect(stepSibling(org, 'd', 'right')).toBeNull();
    expect(stepSibling(org, 'b', 'up')).toBeNull();
  });
});

describe('shownSides', () => {
  it('map layout: the side every main branch is shown on', () => {
    expect(shownSides(map)).toEqual({ a: 'right', b: 'right', c: 'left', d: 'left' });
  });

  it('other layouts have none', () => {
    expect(shownSides(logic)).toBeUndefined();
    expect(shownSides(org)).toBeUndefined();
  });
});
