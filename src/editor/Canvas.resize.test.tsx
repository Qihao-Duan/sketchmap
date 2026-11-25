// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { Canvas, type CanvasHandle } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const measure = (t: string, s: number) => t.length * s * 0.5;
const picture = (name: string, w: number, h: number) => ({ key: `img/abcdefghijklmnopqrstu/${name}.png`, w, h });
const mapWith = (image: { key: string; w: number; h: number }): MapNode => ({
  id: 'r', text: 'Root', children: [
    { id: 'p', text: 'Pic', image, children: [] },
    { id: 'q', text: 'Plain', children: [] },
  ],
});
const layout = computeLayout(mapWith(picture('pic', 200, 100)), measure);

let container: HTMLDivElement;
let root: Root | null = null;

interface Options {
  layout?: typeof layout;
  selectedId?: string | null;
  extraIds?: string[];
  interactive?: boolean;
}
function mount({ layout: shown = layout, selectedId = 'p', extraIds, interactive = true }: Options = {}) {
  const h = { onResizeImage: vi.fn(), onSelect: vi.fn(), onSelectMany: vi.fn(), onToggleFold: vi.fn() };
  const canvas: { current: CanvasHandle | null } = { current: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Canvas ref={canvas} layout={shown} selectedId={selectedId} extraIds={extraIds} interactive={interactive} {...h} />));
  return { ...h, canvas };
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  vi.unstubAllGlobals();
});

function fire(el: Element, type: string, x: number, y: number, init: MouseEventInit = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: x, clientY: y, ...init });
  act(() => void el.dispatchEvent(ev));
  return ev;
}
const handle = () => container.querySelector<HTMLElement>('.image-handle')!;
const outline = () => container.querySelector<HTMLElement>('.image-size-box')!;
/** Where topic `id`'s image is in map units: its top-left corner and its bottom-right one. */
function imageOf(id: string, shown = layout) {
  const b = shown.byId.get(id)!;
  const left = b.x + b.image!.x;
  const top = b.y + b.image!.y;
  return { left, top, right: left + b.image!.w, bottom: top + b.image!.h };
}
/** Where the handle is on screen, in px. */
const at = () => [parseFloat(handle().style.left), parseFloat(handle().style.top)] as const;
/** Presses the handle at the image's corner, moves by (dx, dy) screen px and lets go. The view is not moved: jsdom has no size. */
function drag(dx: number, dy: number, from = imageOf('p')) {
  fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
  fire(handle(), 'pointermove', from.right + dx, from.bottom + dy, { buttons: 1 });
  fire(handle(), 'pointerup', from.right + dx, from.bottom + dy);
}

describe('Canvas: the corner of an image', () => {
  it('the selected topic’s image has a handle on its bottom-right corner', () => {
    mount();
    expect(handle().hidden).toBe(false);
    expect(at()).toEqual([imageOf('p').right, imageOf('p').bottom]);
    // For the pointer only: the keyboard and a screen reader have the S, M and L buttons.
    expect(handle().getAttribute('aria-hidden')).toBe('true');
  });

  it('there is no handle where a new size would go nowhere (no onResizeImage)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Canvas layout={layout} selectedId="p" interactive onToggleFold={() => {}} />));
    expect(handle().hidden).toBe(true);
  });

  it('there is no handle while nothing is selected, on a topic without an image, or with several topics selected', () => {
    mount({ selectedId: null });
    expect(handle().hidden).toBe(true);
    act(() => root!.unmount());
    container.remove();
    mount({ selectedId: 'q' });
    expect(handle().hidden).toBe(true);
    act(() => root!.unmount());
    container.remove();
    mount({ selectedId: 'p', extraIds: ['q'] });
    expect(handle().hidden).toBe(true);
  });

  it('there is no handle in the view-only page', () => {
    mount({ interactive: false });
    expect(container.querySelector('.image-handle')).toBeNull();
  });

  it('there is no handle for an image the canvas does not draw (its key is not a stored image)', () => {
    mount({ layout: computeLayout(mapWith({ key: 'https://elsewhere.example/x.png', w: 200, h: 100 }), measure) });
    expect(handle().hidden).toBe(true);
  });

  it('the handle moves to another topic’s image when that topic is selected, and goes away when the selection does', () => {
    const two = computeLayout({ id: 'r', text: 'Root', children: [
      { id: 'p', text: 'Pic', image: picture('pic', 200, 100), children: [] },
      { id: 's', text: 'Second', image: picture('second', 120, 90), children: [] },
    ] }, measure);
    const { canvas: _canvas, ...h } = mount({ layout: two });
    expect(at()).toEqual([imageOf('p', two).right, imageOf('p', two).bottom]);
    act(() => root!.render(<Canvas layout={two} selectedId="s" interactive {...h} />));
    expect(at()).toEqual([imageOf('s', two).right, imageOf('s', two).bottom]);
    act(() => root!.render(<Canvas layout={two} selectedId={null} interactive {...h} />));
    expect(handle().hidden).toBe(true);
  });

  it('the handle stays on the corner when the canvas is zoomed and moved', () => {
    const { canvas } = mount();
    act(() => canvas.current!.zoomBy(2));
    const svg = container.querySelector('svg')!;
    fire(svg, 'pointerdown', 300, 300, { button: 2, buttons: 2 });
    fire(svg, 'pointermove', 340, 270, { button: 2, buttons: 2 });
    fire(svg, 'pointerup', 340, 270, { button: 2 });
    const { tx, ty, k } = canvas.current!.view();
    expect([tx, ty, k]).toEqual([40, -30, 2]);
    expect(at()).toEqual([40 + 2 * imageOf('p').right, -30 + 2 * imageOf('p').bottom]);
  });

  it('dragging the handle along the diagonal gives the new size, in the image’s proportions, once and on release', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 30, from.bottom + 15, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    expect(h.onResizeImage).not.toHaveBeenCalled();
    fire(handle(), 'pointerup', from.right + 60, from.bottom + 30);
    expect(h.onResizeImage).toHaveBeenCalledTimes(1);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 260, h: 130 });
  });

  it('dragging towards the image makes it smaller', () => {
    const h = mount();
    drag(-80, -40);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 120, h: 60 });
  });

  it('while dragging, a dashed outline from the image’s top-left corner shows the new size and says it; it goes away on release', () => {
    mount();
    const from = imageOf('p');
    expect(outline().hidden).toBe(true);
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    expect(outline().hidden).toBe(false);
    expect(outline().style.left).toBe(`${from.left}px`);
    expect(outline().style.top).toBe(`${from.top}px`);
    expect(outline().style.width).toBe('260px');
    expect(outline().style.height).toBe('130px');
    expect(outline().textContent).toBe('260 × 130');
    // The handle goes with the outline's corner.
    expect(at()).toEqual([from.left + 260, from.top + 130]);
    fire(handle(), 'pointerup', from.right + 60, from.bottom + 30);
    expect(outline().hidden).toBe(true);
  });

  it('a drag sideways or downwards only also resizes: the corner goes to the nearest point on the diagonal', () => {
    const h = mount();
    drag(50, 0);
    expect(h.onResizeImage).toHaveBeenLastCalledWith('p', { w: 240, h: 120 });
    drag(0, 50);
    expect(h.onResizeImage).toHaveBeenLastCalledWith('p', { w: 220, h: 110 });
    drag(-50, 0);
    expect(h.onResizeImage).toHaveBeenLastCalledWith('p', { w: 160, h: 80 });
  });

  it('zoomed in, the same drag on the screen changes the size by less', () => {
    const { canvas, onResizeImage } = mount();
    act(() => canvas.current!.zoomBy(2));
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 60, y + 30, { buttons: 1 });
    expect(outline().style.left).toBe(`${2 * imageOf('p').left}px`);
    expect(outline().style.width).toBe('460px');
    expect(outline().style.height).toBe('230px');
    fire(handle(), 'pointerup', x + 60, y + 30);
    expect(onResizeImage).toHaveBeenCalledWith('p', { w: 230, h: 115 });
  });

  it('the image cannot be dragged below or above the sizes a map may hold', () => {
    const h = mount();
    drag(-5000, -5000);
    expect(h.onResizeImage).toHaveBeenLastCalledWith('p', { w: 32, h: 16 });
    drag(9000, 9000);
    expect(h.onResizeImage).toHaveBeenLastCalledWith('p', { w: 2048, h: 1024 });
  });

  it('a move of a few pixels is already a drag', () => {
    const h = mount();
    drag(4, 3);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 204, h: 102 });
  });

  it('the handle takes the pointer for the whole drag, so moves off the small handle still reach it', () => {
    mount();
    const capture = vi.fn();
    handle().setPointerCapture = capture;
    const from = imageOf('p');
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: from.right, clientY: from.bottom });
    Object.defineProperty(down, 'pointerId', { value: 7 });
    act(() => void handle().dispatchEvent(down));
    expect(capture).toHaveBeenCalledWith(7);
  });

  it('the canvas moved during a drag: the corner stays under the pointer', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    expect(outline().textContent).toBe('260 × 130');
    // The wheel moves the map 40px to the left under a pointer that stays where it is.
    act(() => void handle().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 40, deltaY: 0 })));
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    expect(outline().style.left).toBe(`${from.left - 40}px`);
    expect(outline().textContent).toBe('292 × 146');
    expect(at()).toEqual([from.left - 40 + 292, from.top + 146]);
    fire(handle(), 'pointerup', from.right + 60, from.bottom + 30);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 292, h: 146 });
  });

  describe('a drag ends without a new size when its image is no longer the one with the handle', () => {
    const two = computeLayout({ id: 'r', text: 'Root', children: [
      { id: 'p', text: 'Pic', image: picture('pic', 200, 100), children: [] },
      { id: 's', text: 'Second', image: picture('second', 120, 90), children: [] },
      { id: 'q', text: 'Plain', children: [] },
    ] }, measure);
    /** Presses the handle of `p` and drags it; the button stays down. */
    function startDrag() {
      const { canvas: _canvas, ...h } = mount({ layout: two });
      const from = imageOf('p', two);
      fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
      fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
      expect(outline().hidden).toBe(false);
      return { h, from };
    }
    const letGo = (from: { right: number; bottom: number }) => {
      fire(handle(), 'pointermove', from.right + 80, from.bottom + 40, { buttons: 1 });
      fire(handle(), 'pointerup', from.right + 80, from.bottom + 40);
    };

    it('the selection moved to a topic without an image: the outline goes away with the handle', () => {
      const { h, from } = startDrag();
      act(() => root!.render(<Canvas layout={two} selectedId="q" interactive {...h} />));
      expect(outline().hidden).toBe(true);
      expect(handle().hidden).toBe(true);
      letGo(from);
      expect(outline().hidden).toBe(true);
      expect(h.onResizeImage).not.toHaveBeenCalled();
    });

    it('the selection moved to another topic with an image: the handle is on that image, and it is not resized', () => {
      const { h, from } = startDrag();
      act(() => root!.render(<Canvas layout={two} selectedId="s" interactive {...h} />));
      expect(outline().hidden).toBe(true);
      expect(at()).toEqual([imageOf('s', two).right, imageOf('s', two).bottom]);
      letGo(from);
      expect(outline().hidden).toBe(true);
      expect(at()).toEqual([imageOf('s', two).right, imageOf('s', two).bottom]);
      expect(h.onResizeImage).not.toHaveBeenCalled();
    });

    it('nothing is selected any more', () => {
      const { h, from } = startDrag();
      act(() => root!.render(<Canvas layout={two} selectedId={null} interactive {...h} />));
      expect(outline().hidden).toBe(true);
      letGo(from);
      expect(h.onResizeImage).not.toHaveBeenCalled();
    });

    it('the topic got another picture (a replacement arrived): the new one is not given the old one’s shape', () => {
      const { h, from } = startDrag();
      const replaced = computeLayout({ id: 'r', text: 'Root', children: [
        { id: 'p', text: 'Pic', image: picture('square', 200, 200), children: [] },
        { id: 's', text: 'Second', image: picture('second', 120, 90), children: [] },
        { id: 'q', text: 'Plain', children: [] },
      ] }, measure);
      act(() => root!.render(<Canvas layout={replaced} selectedId="p" interactive {...h} />));
      expect(outline().hidden).toBe(true);
      expect(at()).toEqual([imageOf('p', replaced).right, imageOf('p', replaced).bottom]);
      letGo(from);
      expect(h.onResizeImage).not.toHaveBeenCalled();
    });

    it('new sizes can no longer be taken (an upload started)', () => {
      const { h, from } = startDrag();
      const { onResizeImage: _off, ...rest } = h;
      act(() => root!.render(<Canvas layout={two} selectedId="p" interactive {...rest} />));
      expect(outline().hidden).toBe(true);
      expect(handle().hidden).toBe(true);
      letGo(from);
      expect(h.onResizeImage).not.toHaveBeenCalled();
    });
  });

  it('a drag goes on when the map is drawn again and the image is still the same, from where the image is now', () => {
    const { canvas: _canvas, ...h } = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    // The central topic got a longer text, which pushes the topics beside it outwards.
    const moved = computeLayout({ id: 'r', text: 'Root, and now with a longer text', children: [
      { id: 'p', text: 'Pic', image: picture('pic', 200, 100), children: [] },
      { id: 'q', text: 'Plain', children: [] },
    ] }, measure);
    const now = imageOf('p', moved);
    expect([now.left, now.top]).not.toEqual([from.left, from.top]);
    act(() => root!.render(<Canvas layout={moved} selectedId="p" interactive {...h} />));
    expect(outline().hidden).toBe(false);
    expect(outline().style.left).toBe(`${now.left}px`);
    expect(outline().style.top).toBe(`${now.top}px`);
    // The pointer is let go 80, 40 from where it pressed: the corner it holds is that far from where it was.
    fire(handle(), 'pointermove', from.right + 80, from.bottom + 40, { buttons: 1 });
    const [cw, ch] = [from.right + 80 - now.left, from.bottom + 40 - now.top];
    const width = Math.round(((cw * 200 + ch * 100) / (200 * 200 + 100 * 100)) * 200);
    expect(width).not.toBe(280); // not what the drag would give had the image stayed where it was
    fire(handle(), 'pointerup', from.right + 80, from.bottom + 40);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: width, h: Math.round(width / 2) });
  });

  it('the browser’s menu stays shut on the handle, as on the rest of the canvas', () => {
    mount();
    expect(fire(handle(), 'contextmenu', 0, 0, { button: 2 }).defaultPrevented).toBe(true);
  });

  it('a press that never moves gives no new size', () => {
    const h = mount();
    drag(1, 1);
    expect(h.onResizeImage).not.toHaveBeenCalled();
    expect(outline().hidden).toBe(true);
  });

  it('a drag that comes back to the size it started from gives no new size', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    fire(handle(), 'pointermove', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointerup', from.right, from.bottom);
    expect(h.onResizeImage).not.toHaveBeenCalled();
  });

  it('a cancelled drag gives no new size, and the outline and the handle go back', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    fire(handle(), 'pointercancel', from.right + 60, from.bottom + 30);
    expect(h.onResizeImage).not.toHaveBeenCalled();
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([from.right, from.bottom]);
  });

  it('a drag whose release never arrived stops at the next move without a button, and gives no new size', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 90, from.bottom + 45, { buttons: 0 });
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([from.right, from.bottom]);
    fire(handle(), 'pointerup', from.right + 90, from.bottom + 45);
    expect(h.onResizeImage).not.toHaveBeenCalled();
  });

  it('a drag the browser takes the pointer from gives no new size', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { buttons: 1 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { buttons: 1 });
    fire(handle(), 'lostpointercapture', from.right + 60, from.bottom + 30);
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([from.right, from.bottom]);
    expect(h.onResizeImage).not.toHaveBeenCalled();
  });

  it('only the main button resizes', () => {
    const h = mount();
    const from = imageOf('p');
    fire(handle(), 'pointerdown', from.right, from.bottom, { button: 2, buttons: 2 });
    fire(handle(), 'pointermove', from.right + 60, from.bottom + 30, { button: 2, buttons: 2 });
    expect(outline().hidden).toBe(true);
    fire(handle(), 'pointerup', from.right + 60, from.bottom + 30, { button: 2 });
    expect(h.onResizeImage).not.toHaveBeenCalled();
  });

  it('a press on the handle selects nothing else and keeps the keyboard where it is', () => {
    const h = mount();
    const from = imageOf('p');
    expect(fire(handle(), 'mousedown', from.right, from.bottom).defaultPrevented).toBe(true);
    drag(60, 30);
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onSelectMany).not.toHaveBeenCalled();
  });

  it('a finger drags the handle like the mouse does', () => {
    const h = mount();
    const from = imageOf('p');
    const touch = (type: string, x: number, y: number, buttons: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: x, clientY: y });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      act(() => void handle().dispatchEvent(ev));
    };
    touch('pointerdown', from.right, from.bottom, 1);
    touch('pointermove', from.right + 60, from.bottom + 30, 1);
    touch('pointerup', from.right + 60, from.bottom + 30, 0);
    expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 260, h: 130 });
  });

  it('the wheel over the handle moves the canvas, as it does anywhere else on it', () => {
    mount();
    const world = container.querySelector('g.world')!;
    const before = world.getAttribute('transform');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 10, deltaY: 20 });
    act(() => void handle().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(world.getAttribute('transform')).not.toBe(before);
    expect(world.getAttribute('transform')).toBe('translate(-10 -20) scale(1)');
  });

  describe('the picture’s own proportions', () => {
    class FakeImage {
      static made: FakeImage[] = [];
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      naturalWidth = 0;
      naturalHeight = 0;
      constructor() {
        FakeImage.made.push(this);
      }
    }
    /** A 1000×333 picture shown at 200×66: a size whose proportions are a little off, as whole pixels make them. */
    const drifted = (name: string) => computeLayout(mapWith(picture(name, 200, 66)), measure);

    it('are used once the browser knows them, so a resized image is not cropped at its edges', () => {
      FakeImage.made = [];
      vi.stubGlobal('Image', FakeImage);
      const shown = drifted('known');
      const h = mount({ layout: shown });
      expect(FakeImage.made.map((i) => i.src)).toEqual(['/img/abcdefghijklmnopqrstu/known.png']);
      Object.assign(FakeImage.made[0], { naturalWidth: 1000, naturalHeight: 333 });
      FakeImage.made[0].onload?.();
      drag(100, 33, imageOf('p', shown));
      expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 300, h: 100 });
    });

    it('until then, the proportions of the size it has now are kept', () => {
      FakeImage.made = [];
      vi.stubGlobal('Image', FakeImage);
      const shown = drifted('unknown');
      const h = mount({ layout: shown });
      drag(100, 33, imageOf('p', shown));
      expect(h.onResizeImage).toHaveBeenCalledWith('p', { w: 300, h: 99 });
    });
  });
});
