import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import {
  addChild, addSiblingAfter, allText, countDescendants, createMap, findNode, isInBranch,
  moveNode, moveNodes, newNode, removeNode, removeNodes, setText, toggleCollapsed, topMost, visibleChildren,
} from './tree';

const n = (id: string, text: string, children: MapNode[] = []): MapNode => ({ id, text, children });
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

  it('moveNode moves a branch under a target and refuses moves into itself', () => {
    const t = sample();
    expect(moveNode(t, 'a', 'a1')).toBe(false);
    expect(moveNode(t, 'a', 'a')).toBe(false);
    expect(moveNode(t, 'r', 'b')).toBe(false);
    expect(moveNode(t, 'a', 'b')).toBe(true);
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
  const big = () => n('r', 'Root', [n('a', 'A', [n('a1', 'A1'), n('a2', 'A2')]), n('b', 'B', [n('b1', 'B1')]), n('c', 'C')]);
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
