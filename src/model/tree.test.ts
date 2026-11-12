import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import {
  addChild, addSiblingAfter, allText, countDescendants, createMap, findNode, isInBranch,
  moveNode, newNode, removeNode, setText, toggleCollapsed, visibleChildren,
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
