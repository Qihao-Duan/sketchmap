import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { layoutMap } from '../layout';
import { navigate } from './navigate';

const measure = (t: string, size: number) => t.length * size * 0.5;
const n = (id: string, children: MapNode[] = []): MapNode => ({ id, text: id.toUpperCase(), children });
// right: a (a1, a2); left: b
const layout = computeLayout(n('root', [n('a', [n('a1'), n('a2')]), n('b')]), measure);

describe('navigate', () => {
  it('moves outward, inward and between siblings by position', () => {
    expect(navigate(layout, 'root', 'right')).toBe('a');
    expect(navigate(layout, 'root', 'left')).toBe('b');
    expect(navigate(layout, 'a', 'right')).toBe('a1');
    expect(navigate(layout, 'a1', 'down')).toBe('a2');
    expect(navigate(layout, 'a2', 'up')).toBe('a1');
    expect(navigate(layout, 'a1', 'left')).toBe('a');
  });
  it('returns null when nothing lies in that direction', () => {
    expect(navigate(layout, 'b', 'left')).toBeNull();
    expect(navigate(layout, 'missing', 'left')).toBeNull();
  });
});

describe('in logic and org charts', () => {
  const node = (id: string, text: string, children: MapNode[] = []): MapNode => ({ id, text, children });
  // Reviewer's tree: Root → Alpha [A one long text [Deep], A two], Beta [B one, B two with more words], Gamma.
  const tree = node('root', 'Root', [
    node('alpha', 'Alpha', [
      node('a1', 'A one long text', [node('deep', 'Deep')]),
      node('a2', 'A two'),
    ]),
    node('beta', 'Beta', [
      node('b1', 'B one'),
      node('b2', 'B two with more words'),
    ]),
    node('gamma', 'Gamma'),
  ]);
  const firstLevel = new Set(['alpha', 'beta', 'gamma']);

  describe('org', () => {
    const org = layoutMap(tree, 'org', measure);
    it('Down from Root reaches a first-level topic, never a depth-2 topic', () => {
      const id = navigate(org, 'root', 'down', 'org');
      expect(id).not.toBeNull();
      expect(firstLevel.has(id!)).toBe(true);
    });
    it('Right from a first-level topic reaches the next column, Left goes back', () => {
      expect(navigate(org, 'alpha', 'right', 'org')).toBe('beta');
      expect(navigate(org, 'beta', 'left', 'org')).toBe('alpha');
    });
    it('Up from a child reaches its own column header; Down from the header reaches it back', () => {
      expect(navigate(org, 'a1', 'up', 'org')).toBe('alpha');
      expect(navigate(org, 'alpha', 'down', 'org')).toBe('a1');
    });
  });

  describe('logic', () => {
    const logic = layoutMap(tree, 'logic', measure);
    it('Left from a child reaches its parent', () => {
      expect(navigate(logic, 'a1', 'left', 'logic')).toBe('alpha');
    });
    it('Right from the parent reaches one of its own children (both share a left edge; the tie goes to the one closer vertically)', () => {
      const id = navigate(logic, 'alpha', 'right', 'logic');
      expect(['a1', 'a2']).toContain(id);
    });
  });
});
