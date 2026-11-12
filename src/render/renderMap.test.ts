// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { hashSeed, renderMap } from './renderMap';

const measure = (t: string, size: number) => t.length * size * 0.5;
const tree: MapNode = {
  id: 'r', text: 'Root',
  children: [
    { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] },
    { id: 'b', text: 'Folded', collapsed: true, children: [{ id: 'b1', text: 'x', children: [] }, { id: 'b2', text: 'y', children: [] }] },
  ],
};

function draw(selectedId: string | null = null) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(world);
  renderMap(svg, world, computeLayout(tree, measure), { selectedId });
  return world;
}

describe('renderMap', () => {
  it('draws one topic group per visible topic and one path per branch', () => {
    const world = draw();
    const ids = [...world.querySelectorAll('g.topic')].map((g) => g.getAttribute('data-id'));
    expect(ids).toEqual(['r', 'a', 'a1', 'b']);
    expect(world.querySelector('g.branches')!.children).toHaveLength(3);
    expect(world.querySelector('g.topic')!.firstElementChild!.getAttribute('class')).toBe('hit');
  });

  it('writes each wrapped line as its own text element in the hand-drawn font', () => {
    const t = draw().querySelector('g.topic[data-id="a1"] text')!;
    expect(t.textContent).toBe('A1');
    expect(t.getAttribute('font-family')).toContain('Excalifont');
  });

  it('is deterministic: same layout, same strokes', () => {
    expect(draw().innerHTML).toBe(draw().innerHTML);
  });

  it('marks the selected topic and shows how many topics a fold hides', () => {
    const world = draw('a');
    expect(world.querySelector('g.topic[data-id="a"]')!.getAttribute('class')).toContain('selected');
    const fold = world.querySelector('g.fold[data-fold="b"]')!;
    expect(fold.getAttribute('class')).toContain('folded');
    expect(fold.querySelector('text')!.textContent).toBe('2');
    expect(world.querySelector('g.fold[data-fold="a"]')!.getAttribute('class')).toBe('fold');
  });

  it('hashSeed is stable and positive', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed('')).toBeGreaterThan(0);
  });

  it('draws org-chart deep topics as unfilled outlines', async () => {
    const { computeOrgLayout } = await import('../layout/org');
    const { PALETTE } = await import('../layout/styles');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const layout = computeOrgLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] }, measure);
    renderMap(svg, world, layout, { selectedId: null });
    const small = world.querySelector('g.topic[data-id="a1"]')!;
    const strokes = [...small.querySelectorAll('path')].map((p) => p.getAttribute('stroke'));
    expect(strokes.length).toBeGreaterThan(0);
    expect(strokes).not.toContain(PALETTE[0].fill); // no hachure fill
  });
});
