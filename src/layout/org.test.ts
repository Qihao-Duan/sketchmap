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
