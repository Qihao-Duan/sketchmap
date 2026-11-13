// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { Canvas, type CanvasHandle } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tree: MapNode = { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] };
const layout = computeLayout(tree, (t, s) => t.length * s * 0.5);
let container: HTMLDivElement;

function mount(interactive = true) {
  const h = { onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn(), onDropFile: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Canvas layout={layout} selectedId={null} interactive={interactive} {...h} />));
  return h;
}
const press = (el: Element, type: string, x = 10, y = 10, buttons = 0) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y })));
const hit = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
const dragEvent = (type: string, dataTransfer: { files?: File[]; types?: string[] }) => {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: dataTransfer.files ?? [], types: dataTransfer.types ?? [] } });
  return ev;
};

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
    press(svg, 'pointermove', 140, 130, 1);
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

  it('stops a pan if the pointerup is lost', () => {
    mount();
    const svg = container.querySelector('svg')!;
    const world = container.querySelector('g.world')!;
    press(svg, 'pointerdown', 100, 100);
    press(svg, 'pointermove', 140, 130, 0);
    expect(world.getAttribute('transform')).toBe('translate(0 0) scale(1)');
  });

  it('removes a drag ghost if the pointerup is lost', () => {
    mount();
    const overlay = container.querySelector('g.overlay')!;
    press(hit('a1'), 'pointerdown');
    press(hit('a1'), 'pointermove', 20, 20, 1);
    expect(overlay.children.length).toBeGreaterThan(0);
    press(hit('a1'), 'pointermove', 20, 20, 0);
    expect(overlay.children.length).toBe(0);
  });

  it('keeps onViewChange current after a re-render', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const a = vi.fn();
    const b = vi.fn();
    const base = { layout, selectedId: null, interactive: true, onToggleFold: vi.fn() };
    act(() => root.render(<Canvas {...base} onViewChange={a} />));
    act(() => root.render(<Canvas {...base} onViewChange={b} />));
    a.mockClear(); // mounting legitimately calls onViewChange once; only calls from here on matter
    const svg = container.querySelector('svg')!;
    act(() => void svg.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })));
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  describe('links', () => {
    const linked = computeLayout({ id: 'r', text: 'See [docs](https://example.com/d)', children: [] }, (t, s) => t.length * s * 0.5);
    function mountLinked(interactive: boolean) {
      const h = { onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn() };
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() => createRoot(container).render(<Canvas layout={linked} selectedId={null} interactive={interactive} {...h} />));
      return h;
    }
    const at = (el: Element, type: string, x: number, y: number, mods: MouseEventInit = {}) =>
      act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...mods })));
    const link = () => container.querySelector('g.topic a tspan')!;

    it('the view opens a link on a plain click', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointerup', 11, 10);
      expect(open).toHaveBeenCalledWith('https://example.com/d', '_blank', 'noopener,noreferrer');
      open.mockRestore();
    });

    it('the view does not open a link when the press turns into a pan', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointerup', 60, 40);
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('the editor selects on a plain click and opens on ⌘/Ctrl-click', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      const h = mountLinked(true);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointerup', 10, 10);
      expect(h.onSelect).toHaveBeenCalledWith('r');
      expect(open).not.toHaveBeenCalled();
      h.onSelect.mockClear();
      at(link(), 'pointerdown', 10, 10, { metaKey: true });
      at(link(), 'pointerup', 10, 10, { metaKey: true });
      expect(open).toHaveBeenCalledWith('https://example.com/d', '_blank', 'noopener,noreferrer');
      expect(h.onSelect).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('never lets the browser follow a link by itself; keyboard activation opens it', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
      act(() => void link().dispatchEvent(click));
      expect(click.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
      act(() => void link().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      expect(open).toHaveBeenCalledTimes(1);
      open.mockRestore();
    });

    it('a cancelled press never opens a link', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointercancel', 10, 10);
      const h = mountLinked(true);
      at(link(), 'pointerdown', 10, 10, { metaKey: true });
      at(link(), 'pointercancel', 10, 10, { metaKey: true });
      expect(open).not.toHaveBeenCalled();
      expect(h.onMove).not.toHaveBeenCalled();
      open.mockRestore();
    });

    it('a real mouse click (press, release, click) opens the link exactly once', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointerup', 10, 10);
      act(() => void link().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
      expect(open).toHaveBeenCalledTimes(1);
      open.mockRestore();
    });

    it('a pan that wanders and comes back does not open the link', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      mountLinked(false);
      at(link(), 'pointerdown', 10, 10);
      at(link(), 'pointermove', 130, 10, { buttons: 1 });
      at(link(), 'pointerup', 12, 10);
      expect(open).not.toHaveBeenCalled();
      open.mockRestore();
    });
  });

  it('[O1 regression guard] makes every element in the drag ghost unclickable, so elementFromPoint finds the topic underneath it', () => {
    mount();
    const overlay = container.querySelector('g.overlay')!;
    press(hit('a1'), 'pointerdown');
    press(hit('a1'), 'pointermove', 20, 20, 1);
    const withPointerEvents = [...overlay.querySelectorAll('[pointer-events]')];
    expect(withPointerEvents.length).toBeGreaterThan(0);
    for (const n of withPointerEvents) expect(n.getAttribute('pointer-events')).toBe('none');
  });

  it('ensureVisible keeps the topic clear of a right-hand panel (rightInset)', () => {
    const spy = vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1000, height: 600, top: 0, left: 0, right: 1000, bottom: 600, toJSON: () => ({}),
    } as DOMRect);
    try {
      const canvasRef: { current: CanvasHandle | null } = { current: null };
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() =>
        createRoot(container).render(
          <Canvas ref={canvasRef} layout={layout} selectedId={null} interactive rightInset={300} onToggleFold={vi.fn()} />,
        ),
      );
      const svg = container.querySelector('svg')!;
      // Pan the background so topic a1 sits where the 300 px Details sidebar would cover it.
      press(svg, 'pointerdown', 100, 100);
      press(svg, 'pointermove', 100 + 268.3, 100, 1);
      press(svg, 'pointerup', 100 + 268.3, 100);
      act(() => canvasRef.current!.ensureVisible('a1'));
      const v = canvasRef.current!.view();
      const box = layout.byId.get('a1')!;
      expect(box.x * v.k + v.tx + box.w * v.k).toBeLessThanOrEqual(1000 - 300);
    } finally {
      spy.mockRestore();
    }
  });

  describe('drop', () => {
    const file = new File(['x'], 'photo.png', { type: 'image/png' });

    it('dropping a file on a topic calls onDropFile with that topic’s id', () => {
      const h = mount();
      act(() => void hit('a').dispatchEvent(dragEvent('drop', { files: [file], types: ['Files'] })));
      expect(h.onDropFile).toHaveBeenCalledWith('a', file);
    });

    it('dropping on the background calls onDropFile with null', () => {
      const h = mount();
      const svg = container.querySelector('svg')!;
      act(() => void svg.dispatchEvent(dragEvent('drop', { files: [file], types: ['Files'] })));
      expect(h.onDropFile).toHaveBeenCalledWith(null, file);
    });

    it('dragover with Files is preventDefaulted', () => {
      mount();
      const svg = container.querySelector('svg')!;
      const ev = dragEvent('dragover', { types: ['Files'] });
      act(() => void svg.dispatchEvent(ev));
      expect(ev.defaultPrevented).toBe(true);
    });

    it('a view-only canvas ignores drops and dragover', () => {
      const h = mount(false);
      const svg = container.querySelector('svg')!;
      const over = dragEvent('dragover', { types: ['Files'] });
      act(() => void svg.dispatchEvent(over));
      expect(over.defaultPrevented).toBe(false);
      act(() => void svg.dispatchEvent(dragEvent('drop', { files: [file], types: ['Files'] })));
      expect(h.onDropFile).not.toHaveBeenCalled();
    });
  });

  describe('photo layer', () => {
    it('draws images on an unfiltered svg over the drawing, panned and zoomed with it', () => {
      const withImage: MapNode = { id: 'r', text: 'Root', children: [
        { id: 'p', text: 'Pic', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 120, h: 80 }, children: [] },
      ] };
      const imgLayout = computeLayout(withImage, (t, s) => t.length * s * 0.5);
      container = document.createElement('div');
      document.body.appendChild(container);
      const ref = { current: null as CanvasHandle | null };
      act(() => createRoot(container).render(
        <Canvas ref={(h) => { ref.current = h; }} layout={imgLayout} selectedId={null} interactive onToggleFold={() => {}} />,
      ));
      const svgs = container.querySelectorAll('.canvas > svg');
      expect(svgs).toHaveLength(3); // drawing, photos, frames, in that order
      const [drawing, photos, frames] = svgs;
      expect(drawing.getAttribute('role')).toBe('img');
      expect(photos.classList.contains('photos')).toBe(true);
      expect(photos.getAttribute('aria-hidden')).toBe('true');
      expect(frames.classList.contains('frames')).toBe(true);
      expect(frames.getAttribute('aria-hidden')).toBe('true');
      expect(drawing.querySelectorAll('image')).toHaveLength(0);
      expect(photos.querySelectorAll('image.topic-image[data-id="p"]')).toHaveLength(1);
      // The frame stays with the drawing's g.world (no topic-frame of its own there); it moved to the frames layer.
      expect(drawing.querySelector('g.world g.topic-frame')).toBeNull();
      expect(frames.querySelectorAll('g.topic-frame[data-id="p"]')).toHaveLength(1);
      act(() => ref.current!.zoomBy(1.5));
      const world = drawing.querySelector('g.world')!;
      expect(photos.querySelector('g.photos-world')!.getAttribute('transform')).toBe(world.getAttribute('transform'));
      expect(frames.querySelector('g.frames-world')!.getAttribute('transform')).toBe(world.getAttribute('transform'));
    });

    it('keeps the dragged photo out of the dark-filtered drawing svg while it follows the pointer', () => {
      const withImage: MapNode = { id: 'r', text: 'Root', children: [
        { id: 'p', text: 'Pic', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 120, h: 80 }, children: [] },
      ] };
      const imgLayout = computeLayout(withImage, (t, s) => t.length * s * 0.5);
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() => createRoot(container).render(
        <Canvas layout={imgLayout} selectedId={null} interactive onToggleFold={() => {}} />,
      ));
      const [drawing, photos, frames] = container.querySelectorAll('.canvas > svg');
      const hitP = container.querySelector('g.topic[data-id="p"] rect.hit')!;
      press(hitP, 'pointerdown', 10, 10);
      press(hitP, 'pointermove', 20, 20, 1); // dx = dy = 10, past the 6 px drag threshold

      // The dragged topic's photo never sits inside the filtered drawing svg...
      expect(drawing.querySelectorAll('image')).toHaveLength(0);
      // ...it lives in its own translate group on the unfiltered photo layer, following the pointer.
      const ghostGroup = photos.querySelector('g.ghost-photo')!;
      expect(ghostGroup).not.toBeNull();
      expect(ghostGroup.querySelectorAll('image.topic-image[data-id="p"]')).toHaveLength(1);
      expect(ghostGroup.getAttribute('transform')).toBe('translate(10 10)');
      // Its frame rides along on the (filtered) frames layer, same translate.
      const ghostFrame = frames.querySelector('g.ghost-frame')!;
      expect(ghostFrame).not.toBeNull();
      expect(ghostFrame.querySelectorAll('g.topic-frame[data-id="p"]')).toHaveLength(1);
      expect(ghostFrame.getAttribute('transform')).toBe('translate(10 10)');

      press(hitP, 'pointerup', 20, 20);
      expect(photos.querySelector('g.ghost-photo')).toBeNull();
      expect(frames.querySelector('g.ghost-frame')).toBeNull();
    });

    it('keeps the dragged photo and frame ghosts when the drop target changes and the canvas re-renders mid-drag', () => {
      const withImage: MapNode = { id: 'r', text: 'Root', children: [
        { id: 'p', text: 'Pic', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 120, h: 80 }, children: [] },
        { id: 'q', text: 'Other', children: [] },
      ] };
      const imgLayout = computeLayout(withImage, (t, s) => t.length * s * 0.5);
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() => createRoot(container).render(
        <Canvas layout={imgLayout} selectedId={null} interactive onToggleFold={() => {}} />,
      ));
      const [, photos, frames] = container.querySelectorAll('.canvas > svg');
      const hitP = container.querySelector('g.topic[data-id="p"] rect.hit')!;
      const hitQ = container.querySelector('g.topic[data-id="q"] rect.hit')!;
      const original = document.elementFromPoint;
      document.elementFromPoint = () => hitQ;
      try {
        press(hitP, 'pointerdown', 10, 10);
        press(hitP, 'pointermove', 20, 20, 1); // past the drag threshold; the pointer is now over Other
        // The drop highlight re-rendered the canvas (Other's group gained `drop`)...
        expect(container.querySelector('g.topic[data-id="q"]')!.classList.contains('drop')).toBe(true);
        // ...and the ghosts, and the one photo, survived it.
        expect(photos.querySelectorAll('g.ghost-photo')).toHaveLength(1);
        expect(frames.querySelectorAll('g.ghost-frame')).toHaveLength(1);
        expect(photos.querySelectorAll('g.photos-world image.topic-image[data-id="p"]')).toHaveLength(1);
        press(hitP, 'pointermove', 30, 30, 1); // moving on keeps them too
        expect(photos.querySelectorAll('g.ghost-photo')).toHaveLength(1);
        expect(frames.querySelectorAll('g.ghost-frame')).toHaveLength(1);
        press(hitP, 'pointerup', 30, 30);
      } finally {
        document.elementFromPoint = original;
      }
    });
  });
});
