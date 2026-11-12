// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { Canvas } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tree: MapNode = { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] };
const layout = computeLayout(tree, (t, s) => t.length * s * 0.5);
let container: HTMLDivElement;

function mount(interactive = true) {
  const h = { onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Canvas layout={layout} selectedId={null} interactive={interactive} {...h} />));
  return h;
}
const press = (el: Element, type: string, x = 10, y = 10) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })));
const hit = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;

afterEach(() => container.remove());

describe('Canvas', () => {
  it('draws the map and selects a topic on press', () => {
    const h = mount();
    expect(container.querySelectorAll('g.topic')).toHaveLength(3);
    press(hit('a'), 'pointerdown');
    press(hit('a'), 'pointerup');
    expect(h.onSelect).toHaveBeenCalledWith('a');
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('opens the editor on a second press within 420 ms', () => {
    const h = mount();
    for (let i = 0; i < 2; i++) {
      press(hit('a1'), 'pointerdown');
      press(hit('a1'), 'pointerup');
    }
    expect(h.onEdit).toHaveBeenCalledWith('a1');
  });

  it('toggles a fold without selecting', () => {
    const h = mount();
    press(container.querySelector('[data-fold="a"] rect')!, 'pointerdown');
    expect(h.onToggleFold).toHaveBeenCalledWith('a');
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('pans when dragging the background', () => {
    mount();
    const svg = container.querySelector('svg')!;
    const world = container.querySelector('g.world')!;
    press(svg, 'pointerdown', 100, 100);
    press(svg, 'pointermove', 140, 130);
    press(svg, 'pointerup', 140, 130);
    expect(world.getAttribute('transform')).toBe('translate(40 30) scale(1)');
  });

  it('does not select topics in view-only mode, but still folds', () => {
    const h = mount(false);
    press(hit('a'), 'pointerdown');
    expect(h.onSelect).not.toHaveBeenCalled();
    press(container.querySelector('[data-fold="a"] rect')!, 'pointerdown');
    expect(h.onToggleFold).toHaveBeenCalledWith('a');
  });
});
