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

  it('in the view-only page, dragging the background moves the canvas', () => {
    mount(false);
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
    mount(false);
    const svg = container.querySelector('svg')!;
    const world = container.querySelector('g.world')!;
    press(svg, 'pointerdown', 100, 100);
    press(svg, 'pointermove', 140, 130, 0);
    expect(world.getAttribute('transform')).toBe('translate(0 0) scale(1)');
    press(svg, 'pointermove', 180, 160, 1); // a later move with a button down belongs to no gesture
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

      // The pointer is captured by the drawing; the pressed element itself may have been redrawn by now.
      press(drawing, 'pointerup', 20, 20);
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
      const [drawing, photos, frames] = container.querySelectorAll('.canvas > svg');
      const hitP = container.querySelector('g.topic[data-id="p"] rect.hit')!;
      // jsdom gives the canvas no size, so the view is not moved: screen points are map points.
      const q = imgLayout.byId.get('q')!;
      const [qx, qy] = [q.x + q.w / 2, q.y + q.h / 2];
      press(hitP, 'pointerdown', qx - 20, qy - 20);
      press(hitP, 'pointermove', qx, qy, 1); // past the drag threshold; the pointer is now over Other
      // The drop highlight re-rendered the canvas (Other's group gained `drop`)...
      expect(container.querySelector('g.topic[data-id="q"]')!.classList.contains('drop')).toBe(true);
      // ...and the ghosts, and the one photo, survived it.
      expect(photos.querySelectorAll('g.ghost-photo')).toHaveLength(1);
      expect(frames.querySelectorAll('g.ghost-frame')).toHaveLength(1);
      expect(photos.querySelectorAll('g.photos-world image.topic-image[data-id="p"]')).toHaveLength(1);
      // The redraw replaced the pressed element; the pointer is captured by the drawing, which gets the rest.
      press(drawing, 'pointermove', qx + 2, qy + 2, 1); // moving on keeps them too
      expect(photos.querySelectorAll('g.ghost-photo')).toHaveLength(1);
      expect(frames.querySelectorAll('g.ghost-frame')).toHaveLength(1);
      press(drawing, 'pointerup', qx + 2, qy + 2);
      expect(photos.querySelectorAll('g.ghost-photo')).toHaveLength(0);
    });
  });
});

describe('Canvas: selecting with a box, moving with the right button', () => {
  const flat: MapNode = { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [] }, { id: 'b', text: 'B', children: [] }, { id: 'c', text: 'C', children: [] }] };
  const flatLayout = computeLayout(flat, (t, s) => t.length * s * 0.5);
  type Extra = { selectedId?: string | null; extraIds?: string[]; interactive?: boolean };

  // Unmounted after each test (and before a second mount): a canvas listens on the window while it lives.
  let mounted: ReturnType<typeof createRoot> | null = null;
  const unmount = () => {
    act(() => mounted?.unmount());
    mounted = null;
  };
  afterEach(unmount);
  function mountFlat({ selectedId = null, extraIds, interactive = true }: Extra = {}) {
    unmount();
    const h = { onSelect: vi.fn(), onToggleSelect: vi.fn(), onSelectMany: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn() };
    container = document.createElement('div');
    document.body.appendChild(container);
    mounted = createRoot(container);
    act(() => mounted!.render(<Canvas layout={flatLayout} selectedId={selectedId} extraIds={extraIds} interactive={interactive} {...h} />));
    return h;
  }
  /** A pointer event with any button, modifier or pointer type. Returns the event, to read defaultPrevented. */
  function fire(el: Element, type: string, x: number, y: number, init: MouseEventInit & { pointerType?: string } = {}) {
    const { pointerType, ...rest } = init;
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: x, clientY: y, ...rest });
    if (pointerType) Object.defineProperty(ev, 'pointerType', { value: pointerType });
    act(() => void el.dispatchEvent(ev));
    return ev;
  }
  const svgEl = () => container.querySelector('svg')!;
  const worldT = () => container.querySelector('g.world')!.getAttribute('transform');
  const box = (id: string) => flatLayout.byId.get(id)!;
  const centre = (id: string) => [box(id).x + box(id).w / 2, box(id).y + box(id).h / 2] as const;
  /** Ids of the topics a screen rectangle touches (the view is not moved in these tests: jsdom has no size). */
  const touched = (x0: number, y0: number, x1: number, y1: number) =>
    flatLayout.boxes.filter((b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0).map((b) => b.id);
  /** A rectangle around one topic, a little larger than it. */
  const around = (id: string) => {
    const b = box(id);
    return [b.x - 3, b.y - 3, b.x + b.w + 3, b.y + b.h + 3] as const;
  };

  it('in the editor, a left-button drag on the background selects the topics the box touches and leaves the canvas where it is', () => {
    const h = mountFlat();
    const [x0, y0, x1, y1] = around('a');
    const expected = touched(x0, y0, x1, y1);
    expect(expected).toContain('a');
    fire(svgEl(), 'pointerdown', x0, y0);
    fire(svgEl(), 'pointermove', x1, y1, { buttons: 1 });
    const mark = container.querySelector<HTMLElement>('.select-box')!;
    expect(mark.hidden).toBe(false);
    expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual([`${x0}px`, `${y0}px`, `${x1 - x0}px`, `${y1 - y0}px`]);
    fire(svgEl(), 'pointerup', x1, y1);
    expect(h.onSelectMany).toHaveBeenLastCalledWith(expected);
    expect(mark.hidden).toBe(true);
    expect(worldT()).toBe('translate(0 0) scale(1)');
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('the box works in any direction and reports again only when the touched topics change', () => {
    const h = mountFlat();
    const [x0, y0, x1, y1] = around('b');
    fire(svgEl(), 'pointerdown', x1, y1);
    fire(svgEl(), 'pointermove', x0, y0, { buttons: 1 });
    fire(svgEl(), 'pointermove', x0 - 1, y0 - 1, { buttons: 1 });
    const calls = h.onSelectMany.mock.calls.map((c) => c[0]);
    expect(calls.at(-1)).toEqual(touched(x0 - 1, y0 - 1, x1, y1));
    expect(calls.at(-1)).toContain('b');
    expect(new Set(calls.map((ids) => ids.join(' '))).size).toBe(calls.length);
  });

  it('a plain click on the background selects nothing, and so does a box that touches nothing', () => {
    const h = mountFlat({ selectedId: 'a', extraIds: ['b'] });
    const far = Math.max(...flatLayout.boxes.map((b) => b.y + b.h)) + 200;
    fire(svgEl(), 'pointerdown', 0, far);
    fire(svgEl(), 'pointerup', 0, far);
    expect(h.onSelectMany.mock.calls).toEqual([[[]]]);
    h.onSelectMany.mockClear();
    fire(svgEl(), 'pointerdown', 0, far);
    fire(svgEl(), 'pointermove', 30, far + 30, { buttons: 1 });
    fire(svgEl(), 'pointerup', 30, far + 30);
    expect(h.onSelectMany.mock.calls).toEqual([[[]]]);
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('a press on the background that the browser cancels changes nothing', () => {
    const h = mountFlat({ selectedId: 'a' });
    fire(svgEl(), 'pointerdown', 0, 9000);
    fire(svgEl(), 'pointercancel', 0, 9000);
    expect(h.onSelectMany).not.toHaveBeenCalled();
  });

  it('a box dragged over a topic and back off it ends with nothing selected', () => {
    const h = mountFlat({ selectedId: 'c' });
    const [x0, y0, x1] = around('b');
    const far = Math.max(...flatLayout.boxes.map((b) => b.y + b.h)) + 200;
    fire(svgEl(), 'pointerdown', x0, far);
    fire(svgEl(), 'pointermove', x1, y0, { buttons: 1 });
    expect(h.onSelectMany.mock.calls.at(-1)![0]).toContain('b');
    fire(svgEl(), 'pointermove', x0 + 20, far + 20, { buttons: 1 });
    fire(svgEl(), 'pointerup', x0 + 20, far + 20);
    expect(h.onSelectMany).toHaveBeenLastCalledWith([]);
  });

  it('with Shift held, a box that touches nothing keeps what was selected', () => {
    const h = mountFlat({ selectedId: 'a', extraIds: ['b'] });
    const far = Math.max(...flatLayout.boxes.map((b) => b.y + b.h)) + 200;
    fire(svgEl(), 'pointerdown', 0, far, { shiftKey: true });
    fire(svgEl(), 'pointermove', 30, far + 30, { buttons: 1, shiftKey: true });
    fire(svgEl(), 'pointerup', 30, far + 30, { shiftKey: true });
    expect(h.onSelectMany.mock.calls).toEqual([[['a', 'b']]]);
  });

  it('dragging from the central topic, which never moves, keeps a multi-selection; a still click on it selects just it', () => {
    const h = mountFlat({ selectedId: 'r', extraIds: ['a', 'b'] });
    const r = container.querySelector('g.topic[data-id="r"] rect.hit')!;
    fire(r, 'pointerdown', 10, 10);
    fire(r, 'pointermove', 90, 40, { buttons: 1 });
    fire(r, 'pointerup', 90, 40);
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
    fire(r, 'pointerdown', 10, 10);
    fire(r, 'pointerup', 11, 10);
    expect(h.onSelect).toHaveBeenCalledWith('r');
  });

  it('while the right button drags, and just after, the right-click menu is held back anywhere on the page (it opens on release on Windows and Linux)', () => {
    vi.useFakeTimers();
    try {
      mountFlat();
      const menuOn = (el: Element) => fire(el, 'contextmenu', 5, 5, { button: 2 }).defaultPrevented;
      expect(menuOn(document.body)).toBe(false); // no drag yet: the page keeps its menu
      fire(svgEl(), 'pointerdown', 100, 100, { button: 2, buttons: 2 });
      fire(svgEl(), 'pointermove', 400, 300, { buttons: 2 });
      expect(menuOn(document.body)).toBe(true);
      fire(svgEl(), 'pointerup', 400, 300, { button: 2 });
      expect(menuOn(document.body)).toBe(true); // released over a panel: the menu event follows the release
      act(() => void vi.advanceTimersByTime(400));
      expect(menuOn(document.body)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the view-only page never holds the menu back', () => {
    mountFlat({ interactive: false });
    fire(svgEl(), 'pointerdown', 100, 100, { button: 2, buttons: 2 });
    expect(fire(document.body, 'contextmenu', 5, 5, { button: 2 }).defaultPrevented).toBe(false);
  });

  it('with Shift held, the box adds to what was selected, and a plain Shift-click on the background changes nothing', () => {
    const h = mountFlat({ selectedId: 'c', extraIds: ['r'] });
    const [x0, y0, x1, y1] = around('a');
    fire(svgEl(), 'pointerdown', x0, y0, { shiftKey: true });
    fire(svgEl(), 'pointermove', x1, y1, { buttons: 1, shiftKey: true });
    fire(svgEl(), 'pointerup', x1, y1, { shiftKey: true });
    expect(h.onSelectMany).toHaveBeenLastCalledWith(['c', 'r', ...touched(x0, y0, x1, y1).filter((id) => id !== 'c' && id !== 'r')]);
    h.onSelectMany.mockClear();
    fire(svgEl(), 'pointerdown', 0, 9000, { shiftKey: true });
    fire(svgEl(), 'pointerup', 0, 9000, { shiftKey: true });
    expect(h.onSelectMany).not.toHaveBeenCalled();
  });

  it('in the editor, the right and the middle button move the canvas, from the background or from a topic, and select nothing', () => {
    const h = mountFlat();
    fire(svgEl(), 'pointerdown', 100, 100, { button: 2, buttons: 2 });
    fire(svgEl(), 'pointermove', 140, 130, { buttons: 2 });
    fire(svgEl(), 'pointerup', 140, 130, { button: 2 });
    expect(worldT()).toBe('translate(40 30) scale(1)');
    const onTopic = container.querySelector('g.topic[data-id="a"] rect.hit')!;
    fire(onTopic, 'pointerdown', 10, 10, { button: 1, buttons: 4 });
    fire(onTopic, 'pointermove', 20, 5, { buttons: 4 });
    fire(onTopic, 'pointerup', 20, 5, { button: 1 });
    expect(worldT()).toBe('translate(50 25) scale(1)');
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onSelectMany).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it('the right-click menu is held back in the editor, where the right button moves the canvas, and left alone in the view-only page', () => {
    mountFlat();
    expect(fire(svgEl(), 'contextmenu', 10, 10, { button: 2 }).defaultPrevented).toBe(true);
    container.remove();
    mountFlat({ interactive: false });
    expect(fire(svgEl(), 'contextmenu', 10, 10, { button: 2 }).defaultPrevented).toBe(false);
  });

  it('in the view-only page the right button does nothing', () => {
    mountFlat({ interactive: false });
    fire(svgEl(), 'pointerdown', 100, 100, { button: 2, buttons: 2 });
    fire(svgEl(), 'pointermove', 140, 130, { buttons: 2 });
    expect(worldT()).toBe('translate(0 0) scale(1)');
  });

  it('a finger on the editor background still moves the canvas', () => {
    const h = mountFlat();
    fire(svgEl(), 'pointerdown', 100, 100, { pointerType: 'touch' });
    fire(svgEl(), 'pointermove', 140, 130, { buttons: 1, pointerType: 'touch' });
    fire(svgEl(), 'pointerup', 140, 130, { pointerType: 'touch' });
    expect(worldT()).toBe('translate(40 30) scale(1)');
    expect(h.onSelectMany).not.toHaveBeenCalled();
  });

  it('a tap with a finger on the editor background selects nothing; a still click of the right button, and a tap in the view-only page, select nothing new', () => {
    const h = mountFlat({ selectedId: 'a' });
    fire(svgEl(), 'pointerdown', 100, 9000, { pointerType: 'touch' });
    fire(svgEl(), 'pointerup', 101, 9000, { pointerType: 'touch' });
    expect(h.onSelectMany.mock.calls).toEqual([[[]]]);
    expect(worldT()).toBe('translate(0 0) scale(1)');
    h.onSelectMany.mockClear();
    fire(svgEl(), 'pointerdown', 100, 9000, { button: 2, buttons: 2 });
    fire(svgEl(), 'pointerup', 100, 9000, { button: 2 });
    expect(h.onSelectMany).not.toHaveBeenCalled();
    const view = mountFlat({ interactive: false });
    fire(svgEl(), 'pointerdown', 100, 9000, { pointerType: 'touch' });
    fire(svgEl(), 'pointerup', 100, 9000, { pointerType: 'touch' });
    expect(view.onSelectMany).not.toHaveBeenCalled();
  });

  it('Shift-click adds a topic to the selection or takes it out, instead of selecting only it', () => {
    const h = mountFlat({ selectedId: 'a' });
    const b = container.querySelector('g.topic[data-id="b"] rect.hit')!;
    fire(b, 'pointerdown', 10, 10, { shiftKey: true });
    fire(b, 'pointerup', 10, 10, { shiftKey: true });
    expect(h.onToggleSelect).toHaveBeenCalledWith('b');
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('draws the selection mark on every selected topic', () => {
    mountFlat({ selectedId: 'a', extraIds: ['c'] });
    expect([...container.querySelectorAll('g.topic.selected')].map((g) => g.getAttribute('data-id')).sort()).toEqual(['a', 'c']);
  });

  it('pressing one of several selected topics keeps them all selected; releasing without a drag selects just that one', () => {
    const h = mountFlat({ selectedId: 'a', extraIds: ['b'] });
    const b = container.querySelector('g.topic[data-id="b"] rect.hit')!;
    fire(b, 'pointerdown', 10, 10);
    expect(h.onSelect).not.toHaveBeenCalled();
    fire(b, 'pointerup', 10, 10);
    expect(h.onSelect).toHaveBeenCalledWith('b');
  });

  it('dragging one of several selected topics shows a ghost for each and drops them together on the target', () => {
    const h = mountFlat({ selectedId: 'a', extraIds: ['b'] });
    const overlay = container.querySelector('g.overlay')!;
    const hitOf = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
    const [ax, ay] = centre('a');
    const [bx, by] = centre('b');
    const [cx, cy] = centre('c');
    fire(hitOf('a'), 'pointerdown', ax, ay);
    fire(hitOf('a'), 'pointermove', bx, by, { buttons: 1 });
    expect([...overlay.children].map((g) => g.getAttribute('data-id')).sort()).toEqual(['a', 'b']);
    expect([...overlay.children].map((g) => g.getAttribute('transform'))).toEqual(Array(2).fill(`translate(${bx - ax} ${by - ay})`));
    // b is being moved too, so it is no place to drop on
    expect(container.querySelector('g.topic.drop')).toBeNull();
    fire(hitOf('a'), 'pointermove', cx, cy, { buttons: 1 });
    expect(container.querySelector('g.topic.drop')?.getAttribute('data-id')).toBe('c');
    fire(hitOf('a'), 'pointerup', cx, cy);
    expect(h.onMove).toHaveBeenCalledWith('a', { targetId: 'c', where: 'into' });
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(overlay.children.length).toBe(0);
  });

  describe('dropping next to a topic', () => {
    const hitOf = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
    const line = () => container.querySelector('g.drop-line line');
    /** Drags topic `id` to a point (jsdom: screen points are map points) and holds it there. */
    const dragTo = (id: string, x: number, y: number) => {
      const [x0, y0] = centre(id);
      fire(hitOf(id), 'pointerdown', x0, y0);
      fire(hitOf(id), 'pointermove', x, y, { buttons: 1 });
    };

    it('the fixture: a and b are on the right, c is on the left', () => {
      expect(['a', 'b', 'c'].map((id) => box(id).side)).toEqual([1, 1, -1]);
    });

    it('over the top edge of a topic a line shows the place before it, and the topic is not marked as the target', () => {
      const h = mountFlat({ selectedId: 'b' });
      const a = box('a');
      dragTo('b', a.x + a.w / 2, a.y + 2);
      expect(container.querySelector('g.topic.drop')).toBeNull();
      expect(['x1', 'y1', 'x2', 'y2'].map((k) => Number(line()!.getAttribute(k)))).toEqual([a.x, a.y - 13, a.x + a.w, a.y - 13]);
      fire(hitOf('b'), 'pointerup', a.x + a.w / 2, a.y + 2);
      expect(h.onMove).toHaveBeenCalledWith('b', { targetId: 'a', where: 'before', side: 'right' });
      expect(line()).toBeNull();
    });

    it('over the bottom edge: the place after it; on the left side of the map that is before it in order', () => {
      const h = mountFlat({ selectedId: 'a' });
      const c = box('c');
      dragTo('a', c.x + c.w / 2, c.y + c.h - 2);
      expect(Number(line()!.getAttribute('y1'))).toBe(c.y + c.h + 13);
      fire(hitOf('a'), 'pointerup', c.x + c.w / 2, c.y + c.h - 2);
      expect(h.onMove).toHaveBeenCalledWith('a', { targetId: 'c', where: 'before', side: 'left' });
    });

    it('moving from the edge to the middle swaps the line for the target mark; off every topic, both go', () => {
      mountFlat({ selectedId: 'b' });
      const a = box('a');
      dragTo('b', a.x + a.w / 2, a.y + 2);
      expect(line()).not.toBeNull();
      fire(hitOf('b'), 'pointermove', a.x + a.w / 2, a.y + a.h / 2, { buttons: 1 });
      expect(line()).toBeNull();
      expect(container.querySelector('g.topic.drop')?.getAttribute('data-id')).toBe('a');
      fire(hitOf('b'), 'pointermove', a.x + a.w + 300, a.y - 300, { buttons: 1 });
      expect(line()).toBeNull();
      expect(container.querySelector('g.topic.drop')).toBeNull();
    });

    it('the central topic takes the branch onto the side of the half it is dropped on', () => {
      const h = mountFlat({ selectedId: 'a' });
      const r = box('r');
      dragTo('a', r.x + r.w * 0.25, r.y + r.h / 2);
      expect(container.querySelector('g.topic.drop')?.getAttribute('data-id')).toBe('r');
      // marked as the target, with a line along its left side
      expect(['x1', 'x2'].map((k) => Number(line()!.getAttribute(k)))).toEqual([r.x - 10, r.x - 10]);
      fire(hitOf('a'), 'pointerup', r.x + r.w * 0.25, r.y + r.h / 2);
      expect(h.onMove).toHaveBeenCalledWith('a', { targetId: 'r', where: 'into', side: 'left' });
    });

    it('a lost or cancelled release takes the line away and moves nothing', () => {
      const h = mountFlat({ selectedId: 'b' });
      const a = box('a');
      dragTo('b', a.x + a.w / 2, a.y + 2);
      fire(hitOf('b'), 'pointermove', a.x + a.w / 2, a.y + 2, { buttons: 0 });
      expect(line()).toBeNull();
      dragTo('b', a.x + a.w / 2, a.y + 2);
      expect(line()).not.toBeNull();
      fire(hitOf('b'), 'pointercancel', a.x + a.w / 2, a.y + 2);
      expect(line()).toBeNull();
      expect(h.onMove).not.toHaveBeenCalled();
    });

    it('is no place while the pointer is over something outside the canvas (a panel, the toolbar)', () => {
      const h = mountFlat({ selectedId: 'b' });
      const a = box('a');
      const panel = document.createElement('div');
      document.body.appendChild(panel);
      const original = document.elementFromPoint;
      try {
        // over the canvas the middle of a is a place
        document.elementFromPoint = () => hitOf('a');
        dragTo('b', a.x + a.w / 2, a.y + a.h / 2);
        expect(container.querySelector('g.topic.drop')?.getAttribute('data-id')).toBe('a');
        // the same topic under a panel is not: the mark goes, and a release there moves nothing
        document.elementFromPoint = () => panel;
        fire(hitOf('b'), 'pointermove', a.x + a.w / 2, a.y + a.h / 2 + 1, { buttons: 1 });
        expect(container.querySelector('g.topic.drop')).toBeNull();
        fire(hitOf('b'), 'pointerup', a.x + a.w / 2, a.y + a.h / 2 + 1);
        expect(h.onMove).not.toHaveBeenCalled();
        // back over the canvas it is a place again
        document.elementFromPoint = () => hitOf('a');
        dragTo('b', a.x + a.w / 2, a.y + a.h / 2);
        fire(hitOf('b'), 'pointerup', a.x + a.w / 2, a.y + a.h / 2);
        expect(h.onMove).toHaveBeenCalledWith('b', { targetId: 'a', where: 'into' });
      } finally {
        document.elementFromPoint = original;
        panel.remove();
      }
    });

    it('finds the place in map units when the canvas is zoomed and moved', () => {
      unmount();
      const h = { onMove: vi.fn() };
      const handle: { current: CanvasHandle | null } = { current: null };
      container = document.createElement('div');
      document.body.appendChild(container);
      mounted = createRoot(container);
      act(() => mounted!.render(<Canvas ref={handle} layout={flatLayout} selectedId="b" interactive onToggleFold={() => {}} {...h} />));
      act(() => handle.current!.zoomBy(2));
      const { tx, ty, k } = handle.current!.view();
      expect(k).toBe(2);
      const a = box('a');
      const screen = (x: number, y: number) => [x * k + tx, y * k + ty] as const;
      const [sx, sy] = screen(a.x + a.w / 2, a.y + 2);
      fire(hitOf('b'), 'pointerdown', ...screen(...centre('b')));
      fire(hitOf('b'), 'pointermove', sx, sy, { buttons: 1 });
      fire(hitOf('b'), 'pointerup', sx, sy);
      expect(h.onMove).toHaveBeenCalledWith('b', { targetId: 'a', where: 'before', side: 'right' });
    });
  });

  it('a selected topic inside another selected topic gets no ghost of its own, and the central topic never moves', () => {
    const deep: MapNode = { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }, { id: 'b', text: 'B', children: [] }] };
    const deepLayout = computeLayout(deep, (t, s) => t.length * s * 0.5);
    container = document.createElement('div');
    document.body.appendChild(container);
    mounted = createRoot(container);
    act(() => mounted!.render(<Canvas layout={deepLayout} selectedId="a1" extraIds={['a', 'r']} interactive onToggleFold={() => {}} />));
    const overlay = container.querySelector('g.overlay')!;
    const a1 = container.querySelector('g.topic[data-id="a1"] rect.hit')!;
    fire(a1, 'pointerdown', 10, 10);
    fire(a1, 'pointermove', 60, 60, { buttons: 1 });
    expect([...overlay.children].map((g) => g.getAttribute('data-id'))).toEqual(['a']);
  });
});

describe('Canvas: notes', () => {
  const noted: MapNode = { id: 'r', text: 'Root', children: [{ id: 'n', text: 'Trip', note: 'Pack light', children: [] }] };
  const notedLayout = computeLayout(noted, (t, s) => t.length * s * 0.5);
  let root: ReturnType<typeof createRoot> | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });
  function mountNoted(interactive: boolean) {
    const h = { onNote: vi.fn(), onSelect: vi.fn(), onToggleFold: vi.fn() };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Canvas layout={notedLayout} selectedId={null} interactive={interactive} {...h} />));
    return h;
  }
  const icon = () => container.querySelector('g.note-icon[data-note="n"]')!;
  const iconHit = () => icon().querySelector('rect')!;

  it('in the view-only page, a tap on the note icon asks to show that topic’s note', () => {
    const h = mountNoted(false);
    press(iconHit(), 'pointerdown', 50, 50);
    press(iconHit(), 'pointerup', 51, 50);
    expect(h.onNote).toHaveBeenCalledTimes(1);
    expect(h.onNote).toHaveBeenCalledWith('n');
  });

  it('a drag that starts on the note icon moves the canvas and shows nothing', () => {
    const h = mountNoted(false);
    press(iconHit(), 'pointerdown', 50, 50);
    press(iconHit(), 'pointermove', 90, 80, 1);
    press(iconHit(), 'pointerup', 90, 80);
    expect(h.onNote).not.toHaveBeenCalled();
    expect(container.querySelector('g.world')!.getAttribute('transform')).toBe('translate(40 30) scale(1)');
  });

  it('Enter or Space on a focused note icon does the same; other keys do nothing', () => {
    const h = mountNoted(false);
    const key = (k: string) => {
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      act(() => void icon().dispatchEvent(ev));
      return ev.defaultPrevented;
    };
    expect(icon().getAttribute('tabindex')).toBe('0');
    expect(key('Enter')).toBe(true);
    expect(key(' ')).toBe(true);
    expect(key('a')).toBe(false);
    expect(h.onNote).toHaveBeenCalledTimes(2);
  });

  it('in the editor the icon is part of its topic: pressing it selects the topic, and it is no tab stop', () => {
    const h = mountNoted(true);
    expect(icon().hasAttribute('tabindex')).toBe(false);
    press(iconHit(), 'pointerdown', 50, 50);
    press(iconHit(), 'pointerup', 50, 50);
    expect(h.onSelect).toHaveBeenCalledWith('n');
    expect(h.onNote).not.toHaveBeenCalled();
  });
});
