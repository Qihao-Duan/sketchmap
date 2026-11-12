import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
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
