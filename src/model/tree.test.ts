import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import {
  addChild, addSiblingAfter, allText, carrySides, countDescendants, createMap, findNode, fixedSides, isInBranch,
  moveNodes, newNode, removeNode, removeNodes, setText, settleSides, toggleCollapsed, topMost, visibleChildren,
} from './tree';

const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text, children, ...extra });
const big = () => n('r', 'Root', [n('a', 'A', [n('a1', 'A1'), n('a2', 'A2')]), n('b', 'B', [n('b1', 'B1')]), n('c', 'C')]);
const sample = () => n('r', 'Root', [n('a', 'A', [n('a1', 'A1'), n('a2', 'A2')]), n('b', 'B')]);

describe('tree', () => {
  it('createMap makes a 21-char map id, a 10-char root id and version 0', () => {
    const m = createMap('Plan', '2026-11-12T00:00:00.000Z');
    expect(m.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(m.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(m).toMatchObject({ title: 'Plan', layout: 'map', version: 0, root: { text: 'Plan', children: [] } });
  });

  it('findNode reports parent, index and depth', () => {
    const f = findNode(sample(), 'a2')!;
    expect([f.parent!.id, f.index, f.depth]).toEqual(['a', 1, 2]);
    expect(findNode(sample(), 'nope')).toBeNull();
  });

  it('addChild appends and unfolds the parent', () => {
    const t = sample();
    toggleCollapsed(t, 'a');
    addChild(t, 'a', newNode('A3'));
    expect(t.children[0].collapsed).toBeUndefined();
    expect(t.children[0].children.map((c) => c.text)).toEqual(['A1', 'A2', 'A3']);
  });

  it('addSiblingAfter inserts right after; on the root it adds a child', () => {
    const t = sample();
    addSiblingAfter(t, 'a1', n('x', 'X'));
    expect(t.children[0].children.map((c) => c.id)).toEqual(['a1', 'x', 'a2']);
    addSiblingAfter(t, 'r', n('y', 'Y'));
    expect(t.children.map((c) => c.id)).toEqual(['a', 'b', 'y']);
  });

  it('removeNode picks next sibling, else previous, else parent; never removes the root', () => {
    const t = sample();
    expect(removeNode(t, 'a1')).toBe('a2');
    expect(removeNode(t, 'a2')).toBe('a');
    expect(removeNode(t, 'b')).toBe('a');
    expect(removeNode(t, 'r')).toBeNull();
  });

  it('moveNodes moves a branch under a target and refuses moves into itself', () => {
    const t = sample();
    expect(moveNodes(t, ['a'], 'a1')).toBe(false);
    expect(moveNodes(t, ['a'], 'a')).toBe(false);
    expect(moveNodes(t, ['r'], 'b')).toBe(false);
    expect(moveNodes(t, ['a'], 'b')).toBe(true);
    expect(t.children.map((c) => c.id)).toEqual(['b']);
    expect(t.children[0].children[0].id).toBe('a');
  });

  it('toggleCollapsed only folds non-root topics that have children', () => {
    const t = sample();
    expect(toggleCollapsed(t, 'r')).toBe(false);
    expect(toggleCollapsed(t, 'b')).toBe(false);
    expect(toggleCollapsed(t, 'a')).toBe(true);
    expect(visibleChildren(t.children[0])).toEqual([]);
    expect(toggleCollapsed(t, 'a')).toBe(true);
    expect(t.children[0].collapsed).toBeUndefined();
  });

  it('setText, countDescendants, isInBranch, allText', () => {
    const t = sample();
    expect(setText(t, 'b', 'Bee')).toBe(true);
    expect(countDescendants(t)).toBe(4);
    expect(isInBranch(t.children[0], 'a2')).toBe(true);
    expect(isInBranch(t.children[0], 'b')).toBe(false);
    expect(allText(t)).toBe('Root\nA\nA1\nA2\nBee');
  });
});

describe('several topics at once', () => {
  const kids = (t: MapNode, id: string) => findNode(t, id)!.node.children.map((c) => c.id);

  it('topMost keeps the chosen topics that are not inside another chosen one, in drawing order', () => {
    expect(topMost(big(), ['b1', 'a1', 'a'])).toEqual(['a', 'b1']);
    expect(topMost(big(), ['c', 'a2', 'a1'])).toEqual(['a1', 'a2', 'c']);
  });

  it('topMost never returns the root, and a chosen root does not hide the topics under it', () => {
    expect(topMost(big(), ['r', 'a1', 'nope'])).toEqual(['a1']);
  });

  it('removeNodes removes every branch and returns the next sibling of the anchor', () => {
    const t = big();
    expect(removeNodes(t, ['a1', 'b'], 'b')).toBe('c');
    expect(kids(t, 'r')).toEqual(['a', 'c']);
    expect(kids(t, 'a')).toEqual(['a2']);
  });

  it('removeNodes falls back to the previous sibling that is left, then to the parent', () => {
    expect(removeNodes(big(), ['b', 'c'], 'c')).toBe('a');
    expect(removeNodes(big(), ['a1', 'a2'], 'a1')).toBe('a');
    expect(removeNodes(big(), ['a', 'b', 'c'], 'b')).toBe('r');
  });

  it('removeNodes starts from the removed branch that holds the anchor, not from the first removed one', () => {
    // Removed branches: a1 (first) and b. The anchor b1 sits inside b, so the next topic is b's sibling c;
    // starting from a1 instead would give a2.
    expect(removeNodes(big(), ['a1', 'b', 'b1'], 'b1')).toBe('c');
    expect(removeNodes(big(), ['a', 'a1', 'c'], 'a1')).toBe('b');
  });

  it('removeNodes removes nothing for the root alone or for unknown ids', () => {
    const t = big();
    expect(removeNodes(t, ['r'], 'r')).toBeNull();
    expect(removeNodes(t, ['nope'], 'nope')).toBeNull();
    expect(t).toEqual(big());
  });

  it('moveNodes puts the topics at the end of the target in drawing order, and unfolds the target', () => {
    const t = big();
    findNode(t, 'b')!.node.collapsed = true;
    expect(moveNodes(t, ['c', 'a1'], 'b')).toBe(true);
    expect(kids(t, 'b')).toEqual(['b1', 'a1', 'c']);
    expect(findNode(t, 'b')!.node.collapsed).toBeUndefined();
    expect(kids(t, 'a')).toEqual(['a2']);
    expect(kids(t, 'r')).toEqual(['a', 'b']);
  });

  it('moveNodes moves a chosen parent once with its branch, even when one of its children is chosen too', () => {
    const t = big();
    expect(moveNodes(t, ['a', 'a1'], 'c')).toBe(true);
    expect(kids(t, 'c')).toEqual(['a']);
    expect(kids(t, 'a')).toEqual(['a1', 'a2']);
  });

  it('moveNodes refuses a target inside a moved branch, the root alone and unknown targets, changing nothing', () => {
    const t = big();
    expect(moveNodes(t, ['a', 'c'], 'a1')).toBe(false);
    expect(moveNodes(t, ['a', 'c'], 'a')).toBe(false);
    expect(moveNodes(t, ['r'], 'a')).toBe(false);
    expect(moveNodes(t, ['a'], 'nope')).toBe(false);
    expect(t).toEqual(big());
  });
});

describe('sides of the main branches', () => {
  const side = (id: string, s?: 'left' | 'right'): MapNode => ({ id, text: id, children: [], ...(s && { side: s }) });

  it('fixedSides is null while no main branch has a side: the layout balances them itself', () => {
    expect(fixedSides(n('r', 'Root', [side('a'), side('b')]))).toBeNull();
    expect(fixedSides(n('r', 'Root'))).toBeNull();
  });

  it('fixedSides gives every main branch a side: its own, else the one of the branch before it, else right', () => {
    expect(fixedSides(n('r', 'Root', [side('a'), side('b', 'left'), side('c'), side('d', 'right'), side('e')]))).toEqual(['right', 'left', 'left', 'right', 'right']);
  });

  it('a side deeper in the map does not count', () => {
    expect(fixedSides(n('r', 'Root', [n('a', 'A', [side('a1', 'left')])]))).toBeNull();
  });

  it('a new main branch made next to another one takes that branch’s side', () => {
    const t = n('r', 'Root', [side('a', 'right'), side('b', 'left'), side('c')]);
    addSiblingAfter(t, 'c', side('x'));
    addSiblingAfter(t, 'a', side('y'));
    expect(t.children.map((c) => `${c.id}:${c.side ?? '-'}`)).toEqual(['a:right', 'y:right', 'b:left', 'c:-', 'x:left']);
  });

  it('a new main branch made from the central topic goes to the side with fewer branches; right when equal', () => {
    const t = n('r', 'Root', [side('a', 'right'), side('b', 'right'), side('c', 'left')]);
    addChild(t, 'r', side('x'));
    addChild(t, 'r', side('y'));
    addSiblingAfter(t, 'r', side('z'));
    expect(t.children.slice(3).map((c) => `${c.id}:${c.side}`)).toEqual(['x:left', 'y:right', 'z:left']);
  });

  it('new topics get no side while the sides are balanced automatically, and never below the main branches', () => {
    const auto = n('r', 'Root', [side('a')]);
    addChild(auto, 'r', side('x'));
    addSiblingAfter(auto, 'a', side('y'));
    expect(auto.children.every((c) => c.side === undefined)).toBe(true);
    const fixed = n('r', 'Root', [n('a', 'A', [side('a1')], { side: 'left' })]);
    addChild(fixed, 'a', side('x'));
    addSiblingAfter(fixed, 'a1', side('y'));
    expect(fixed.children[0].children.map((c) => `${c.id}:${c.side ?? '-'}`)).toEqual(['a1:-', 'y:-', 'x:-']);
  });
});

describe('settleSides and carrySides', () => {
  const side = (id: string, s?: 'left' | 'right'): MapNode => ({ id, text: id, children: [], ...(s && { side: s }) });
  const sides = (node: MapNode) => node.children.map((c) => `${c.id}:${c.side ?? '-'}`);

  it('settleSides gives every main branch the side it is shown on, once any has one, so it no longer depends on its neighbour', () => {
    const t = n('r', 'Root', [side('a'), side('b', 'left'), side('c'), side('d', 'right'), side('e')]);
    expect(settleSides(t)).toBe(true);
    expect(sides(t)).toEqual(['a:right', 'b:left', 'c:left', 'd:right', 'e:right']);
    expect(settleSides(t)).toBe(false);
    // b goes: c stays on the left
    t.children.splice(1, 1);
    expect(fixedSides(t)).toEqual(['right', 'left', 'right', 'right']);
  });

  it('settleSides leaves a map alone whose sides are balanced automatically', () => {
    const t = n('r', 'Root', [side('a'), n('b', 'B', [side('b1', 'left')])]);
    expect(settleSides(t)).toBe(false);
    expect(sides(t)).toEqual(['a:-', 'b:-']);
  });

  it('carrySides gives the main branches of a rewritten map the sides the same texts had, in order', () => {
    const from = n('r', 'Root', [{ ...side('1', 'left'), text: 'Plan' }, { ...side('2', 'right'), text: 'Build' }, { ...side('3', 'left'), text: 'Plan' }, { ...side('4', 'right'), text: 'Ship' }]);
    const to = n('x', 'Root', [{ ...side('p'), text: 'Build' }, { ...side('q'), text: 'New' }, { ...side('s'), text: 'Plan' }, { ...side('t'), text: 'Plan' }, { ...side('u'), text: 'Plan' }]);
    carrySides(from, to);
    expect(sides(to)).toEqual(['p:right', 'q:-', 's:left', 't:left', 'u:-']);
  });

  it('carrySides matches on the texts it is given for the old branches, when they are not the stored ones', () => {
    const from = n('r', 'Root', [{ ...side('1', 'left'), text: 'First line\nSecond line' }, { ...side('2', 'right'), text: 'Other' }]);
    const to = n('x', 'Root', [{ ...side('p'), text: 'Other' }, { ...side('q'), text: 'First line Second line' }]);
    carrySides(from, to, ['First line Second line', 'Other']);
    expect(sides(to)).toEqual(['p:right', 'q:left']);
  });

  it('carrySides does nothing when the sides were automatic', () => {
    const to = n('x', 'Root', [side('p')]);
    carrySides(n('r', 'Root', [side('p')]), to);
    expect(sides(to)).toEqual(['p:-']);
  });
});

describe('moveNodes: next to a topic, and onto a side', () => {
  const ids = (node: MapNode) => node.children.map((c) => c.id);
  const sides = (node: MapNode) => node.children.map((c) => `${c.id}:${c.side ?? '-'}`);

  it('puts a topic just before or just after another one, under that one’s parent', () => {
    const t = big();
    expect(moveNodes(t, ['c'], 'a', { where: 'before' })).toBe(true);
    expect(ids(t)).toEqual(['c', 'a', 'b']);
    expect(moveNodes(t, ['c'], 'a', { where: 'after' })).toBe(true);
    expect(ids(t)).toEqual(['a', 'c', 'b']);
    expect(moveNodes(t, ['b1'], 'a1', { where: 'after' })).toBe(true);
    expect(ids(t.children[0])).toEqual(['a1', 'b1', 'a2']);
    expect(ids(findNode(t, 'b')!.node)).toEqual([]);
  });

  it('several topics go there together, in drawing order, wherever they came from', () => {
    const t = big();
    expect(moveNodes(t, ['c', 'a2', 'b1'], 'a1', { where: 'before' })).toBe(true);
    expect(ids(t.children[0])).toEqual(['a2', 'b1', 'c', 'a1']);
    expect(ids(t)).toEqual(['a', 'b']);
  });

  it('does not unfold the topic it is put next to', () => {
    const t = big();
    toggleCollapsed(t, 'a');
    moveNodes(t, ['c'], 'a', { where: 'after' });
    expect(t.children[0].collapsed).toBe(true);
  });

  it('refuses a place next to the central topic, next to a moved topic or inside a moved branch', () => {
    const t = big();
    const before = JSON.stringify(t);
    expect(moveNodes(t, ['a'], 'r', { where: 'before' })).toBe(false);
    expect(moveNodes(t, ['a', 'c'], 'c', { where: 'after' })).toBe(false);
    expect(moveNodes(t, ['a'], 'a1', { where: 'after' })).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
  });

  it('reports no move, and changes nothing, when the topics are already exactly there', () => {
    const t = big();
    const before = JSON.stringify(t);
    expect(moveNodes(t, ['b'], 'a', { where: 'after' })).toBe(false);
    expect(moveNodes(t, ['b'], 'c', { where: 'before' })).toBe(false);
    expect(moveNodes(t, ['a', 'b'], 'c', { where: 'before' })).toBe(false);
    expect(moveNodes(t, ['c'], 'r')).toBe(false);
    expect(moveNodes(t, ['a1', 'a2'], 'a')).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
    // the same topics in another order is a move
    expect(moveNodes(t, ['a'], 'r')).toBe(true);
    expect(ids(t)).toEqual(['b', 'c', 'a']);
  });

  it('onto a side: the moved main branch gets that side, and every other main branch keeps the side it is shown on', () => {
    const t = big();
    expect(moveNodes(t, ['a'], 'c', { where: 'after', side: 'left', shown: { a: 'right', b: 'right', c: 'left' } })).toBe(true);
    expect(sides(t)).toEqual(['b:right', 'c:left', 'a:left']);
  });

  it('onto the central topic with a side: last in order, on that side', () => {
    const t = big();
    expect(moveNodes(t, ['a1'], 'r', { side: 'left', shown: { a: 'right', b: 'right', c: 'left' } })).toBe(true);
    expect(sides(t)).toEqual(['a:right', 'b:right', 'c:left', 'a1:left']);
  });

  it('several topics put on a side together all get it, in drawing order', () => {
    const t = big();
    expect(moveNodes(t, ['b1', 'a', 'a2'], 'c', { where: 'before', side: 'left', shown: { a: 'right', b: 'right', c: 'left' } })).toBe(true);
    expect(sides(t)).toEqual(['b:right', 'a:left', 'b1:left', 'c:left']);
    expect(ids(t.children[1])).toEqual(['a1', 'a2']);
  });

  it('a main branch already in that place still changes side, and is no move when it is shown on that side already', () => {
    const t = big();
    const shown = { a: 'right', b: 'right', c: 'left' } as const;
    const before = JSON.stringify(t);
    expect(moveNodes(t, ['c'], 'r', { side: 'left', shown })).toBe(false);
    expect(JSON.stringify(t)).toBe(before);
    expect(moveNodes(t, ['c'], 'r', { side: 'right', shown })).toBe(true);
    expect(sides(t)).toEqual(['a:right', 'b:right', 'c:right']);
  });

  it('a side a main branch already has is kept over the shown one, and a side is only for main branches', () => {
    const t = n('r', 'Root', [n('a', 'A', [n('a1', 'A1')], { side: 'left' }), n('b', 'B'), n('c', 'C')]);
    // below a main branch the side means nothing: it is not set there, and nothing is fixed
    expect(moveNodes(t, ['c'], 'a1', { where: 'after', side: 'right', shown: { a: 'right', b: 'right' } })).toBe(true);
    expect(sides(t)).toEqual(['a:left', 'b:-']);
    expect(sides(t.children[0])).toEqual(['a1:-', 'c:-']);
    expect(moveNodes(t, ['a1'], 'b', { where: 'before', side: 'right', shown: { a: 'right', b: 'left' } })).toBe(true);
    expect(sides(t)).toEqual(['a:left', 'a1:right', 'b:left']);
  });

  it('a main branch that leaves the central topic loses its side; one that stays a main branch keeps it', () => {
    const t = n('r', 'Root', [n('a', 'A', [], { side: 'left' }), n('b', 'B', [], { side: 'right' }), n('c', 'C', [], { side: 'left' })]);
    expect(moveNodes(t, ['a'], 'b')).toBe(true);
    expect(t.children[0].children[0]).toMatchObject({ id: 'a' });
    expect(t.children[0].children[0].side).toBeUndefined();
    expect(moveNodes(t, ['c'], 'b', { where: 'before' })).toBe(true);
    expect(sides(t)).toEqual(['c:left', 'b:right']);
    expect(moveNodes(t, ['c'], 'a', { where: 'after' })).toBe(true);
    expect(sides(t.children[0])).toEqual(['a:-', 'c:-']);
  });
});
