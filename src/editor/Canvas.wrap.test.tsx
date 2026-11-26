// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { layoutMap } from '../layout';
import { computeLayout, measureTopic, type MapLayout } from '../layout/map';
import { Canvas, type CanvasHandle } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const measure = (t: string, s: number) => t.length * s * 0.5;
/** 24 words: at 17 px (8.5 px a character) four lines of six words in a deeper topic, which wraps at 250 px. */
const long = Array.from({ length: 24 }, () => 'word').join(' ');
const tree = (): MapNode => ({
  id: 'r', text: 'Root', children: [
    { id: 'a', text: 'Alpha', children: [
      { id: 't', text: long, children: [] },
      { id: 'u', text: 'Short', children: [{ id: 'u1', text: 'Leaf', children: [] }] },
    ] },
    { id: 'b', text: 'Beta', children: [{ id: 'l', text: long, children: [{ id: 'l1', text: 'Leaf', children: [] }] }] },
  ],
});
const layout = computeLayout(tree(), measure);

let container: HTMLDivElement;
let root: Root | null = null;

interface Options {
  layout?: MapLayout;
  selectedId?: string | null;
  extraIds?: string[];
  interactive?: boolean;
}
function mount({ layout: shown = layout, selectedId = 't', extraIds, interactive = true }: Options = {}) {
  const h = { onWrapText: vi.fn(), onResizeImage: vi.fn(), onSelect: vi.fn(), onSelectMany: vi.fn(), onToggleFold: vi.fn(), onEdit: vi.fn(), measure };
  const canvas: { current: CanvasHandle | null } = { current: null };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Canvas ref={canvas} layout={shown} selectedId={selectedId} extraIds={extraIds} interactive={interactive} {...h} />));
  return { ...h, canvas };
}
const remount = (o: Options) => {
  act(() => root!.unmount());
  container.remove();
  return mount(o);
};
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

function fire(el: Element, type: string, x: number, y: number, init: MouseEventInit = {}) {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 0, clientX: x, clientY: y, ...init });
  act(() => void el.dispatchEvent(ev));
  return ev;
}
const handle = () => container.querySelector<HTMLElement>('.wrap-handle')!;
const outline = () => container.querySelector<HTMLElement>('.size-box')!;
/** Where the handle is on screen, in px. */
const at = () => [parseFloat(handle().style.left), parseFloat(handle().style.top)] as const;
const boxOf = (id: string, shown: MapLayout = layout) => shown.byId.get(id)!;
/** The edge of topic `id` that its text grows towards: the left one on the left of the map, else the right one. */
const edgeOf = (id: string, shown: MapLayout = layout) => (boxOf(id, shown).side === -1 ? boxOf(id, shown).x : boxOf(id, shown).x + boxOf(id, shown).w);
/** The middle of topic `id`'s text, top to bottom. */
function midOf(id: string, shown: MapLayout = layout) {
  const b = boxOf(id, shown);
  return b.y + b.textTop + (b.lines.length * b.style.lineHeight) / 2;
}
/** What topic `id` becomes when its text wraps at `wrap`. */
const wrappedAt = (id: string, wrap: number, shown: MapLayout = layout) => measureTopic({ ...boxOf(id, shown).node, wrap }, boxOf(id, shown).depth, measure, shown.kind);
/** Presses the handle where it is, moves it `dx` screen px sideways and lets go. The view is not moved: jsdom has no size. */
function drag(dx: number) {
  const [x, y] = at();
  fire(handle(), 'pointerdown', x, y, { buttons: 1 });
  fire(handle(), 'pointermove', x + dx, y, { buttons: 1 });
  fire(handle(), 'pointerup', x + dx, y);
}

describe('Canvas: the side of a topic’s text', () => {
  it('the layout of the test map is the one the numbers below count on', () => {
    expect([boxOf('t').side, boxOf('l').side]).toEqual([1, -1]);
    expect([boxOf('t').w, boxOf('t').h, boxOf('t').lines.length]).toEqual([257, 96, 4]);
  });

  it('the selected topic has a handle on the edge its text grows towards, at the middle of the text', () => {
    mount();
    expect(handle().hidden).toBe(false);
    expect(at()).toEqual([boxOf('t').x + 257, boxOf('t').y + 48]);
    // For the pointer only: the keyboard and a screen reader have the buttons of the Details panel.
    expect(handle().getAttribute('aria-hidden')).toBe('true');
  });

  it('on the left of the map the handle is on the topic’s left edge; on the central topic, on its right edge', () => {
    mount({ selectedId: 'l' });
    expect(at()).toEqual([boxOf('l').x, midOf('l')]);
    remount({ selectedId: 'r' });
    expect(at()).toEqual([boxOf('r').x + boxOf('r').w, midOf('r')]);
  });

  it('the handle keeps clear of the fold button: where that is in its way, it sits above it', () => {
    // A main branch: its fold button is at the middle of the same edge.
    mount({ selectedId: 'a' });
    expect(boxOf('a').fold.y).toBe(midOf('a'));
    expect(at()).toEqual([edgeOf('a'), boxOf('a').fold.y - 27]);
    // A deeper topic with one line: the fold button is at the end of its underline, 15 px below the middle of the text.
    remount({ selectedId: 'u' });
    expect(at()).toEqual([edgeOf('u'), boxOf('u').fold.y - 27]);
    // With four lines the button is far enough away.
    remount({ selectedId: 'l' });
    expect(at()).toEqual([edgeOf('l'), midOf('l')]);
  });

  it('zoomed in, the handle keeps its own size, so it needs less room above the fold button', () => {
    const { canvas } = mount({ selectedId: 'a' });
    act(() => canvas.current!.zoomBy(2));
    const { ty } = canvas.current!.view();
    // The button is twice as large (11 px → 22 px to its edge); the handle is still 14 px from its middle to its end.
    expect(at()[1]).toBe(ty + 2 * boxOf('a').fold.y - 38);
  });

  it('there is no handle while nothing is selected, with several topics selected, or for a topic without text', () => {
    mount({ selectedId: null });
    expect(handle().hidden).toBe(true);
    remount({ selectedId: 't', extraIds: ['u'] });
    expect(handle().hidden).toBe(true);
    const pictureOnly = computeLayout({ id: 'r', text: 'Root', children: [
      { id: 'p', text: '', image: { key: 'img/abcdefghijklmnopqrstu/p.png', w: 200, h: 100 }, children: [] },
    ] }, measure);
    remount({ layout: pictureOnly, selectedId: 'p' });
    expect(handle().hidden).toBe(true);
  });

  it('there is no handle in the view-only page, nor where a new width would go nowhere or could not be shown', () => {
    mount({ interactive: false });
    expect(container.querySelector('.wrap-handle')).toBeNull();
    act(() => root!.unmount());
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<Canvas layout={layout} selectedId="t" interactive onToggleFold={() => {}} measure={measure} />));
    expect(handle().hidden).toBe(true);
    act(() => root!.render(<Canvas layout={layout} selectedId="t" interactive onToggleFold={() => {}} onWrapText={() => {}} />));
    expect(handle().hidden).toBe(true);
    act(() => root!.render(<Canvas layout={layout} selectedId="t" interactive onToggleFold={() => {}} onWrapText={() => {}} measure={measure} />));
    expect(handle().hidden).toBe(false);
  });

  it('the handle moves with the selection and stays on the edge when the canvas is zoomed and moved', () => {
    const { canvas, ...h } = mount();
    act(() => root!.render(<Canvas ref={canvas} layout={layout} selectedId="l" interactive {...h} />));
    expect(at()).toEqual([edgeOf('l'), midOf('l')]);
    act(() => canvas.current!.zoomBy(2));
    const svg = container.querySelector('svg')!;
    fire(svg, 'pointerdown', 300, 300, { button: 2, buttons: 2 });
    fire(svg, 'pointermove', 340, 270, { button: 2, buttons: 2 });
    fire(svg, 'pointerup', 340, 270, { button: 2 });
    expect(at()).toEqual([40 + 2 * edgeOf('l'), -30 + 2 * midOf('l')]);
  });

  it('dragging the handle outwards gives the width the text is to wrap at, once and on release', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 90, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y + 40, { buttons: 1 });
    expect(h.onWrapText).not.toHaveBeenCalled();
    fire(handle(), 'pointerup', x + 200, y + 40);
    expect(h.onWrapText).toHaveBeenCalledTimes(1);
    // The topic's edge 200 px further out: 457 px wide, of which 2 × 5 px are not text.
    expect(h.onWrapText).toHaveBeenCalledWith('t', 447);
  });

  it('dragging towards the topic makes the text narrower', () => {
    const h = mount();
    drag(-150);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 97);
  });

  it('on the left of the map, outwards is to the left', () => {
    const h = mount({ selectedId: 'l' });
    drag(-200);
    expect(h.onWrapText).toHaveBeenLastCalledWith('l', 447);
    drag(150);
    expect(h.onWrapText).toHaveBeenLastCalledWith('l', 97);
  });

  it('while dragging, a dashed outline shows what the topic becomes and says the width; it goes away on release', () => {
    mount();
    const t = boxOf('t');
    const [x, y] = at();
    expect(outline().hidden).toBe(true);
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    const becomes = wrappedAt('t', 447);
    expect(becomes.lines).toHaveLength(3);
    expect(outline().hidden).toBe(false);
    // On the right of the map a topic grows from its left edge, and stays centred on its branch.
    expect(outline().style.left).toBe(`${t.x}px`);
    expect(outline().style.top).toBe(`${t.y + t.h / 2 - becomes.h / 2}px`);
    expect(outline().style.width).toBe(`${becomes.w}px`);
    expect(outline().style.height).toBe(`${becomes.h}px`);
    expect(outline().textContent).toBe('447 px');
    // The handle goes with the pointer: it is where the text may reach to, not where it happens to end.
    expect(at()[0]).toBe(x + 200);
    expect(at()[0]).toBeGreaterThan(t.x + becomes.w);
    fire(handle(), 'pointerup', x + 200, y);
    expect(outline().hidden).toBe(true);
  });

  it('on the left of the map the outline grows from the topic’s right edge', () => {
    mount({ selectedId: 'l' });
    const l = boxOf('l');
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x - 200, y, { buttons: 1 });
    const becomes = wrappedAt('l', 447);
    expect(outline().style.left).toBe(`${l.x + l.w - becomes.w}px`);
    expect(outline().style.width).toBe(`${becomes.w}px`);
    expect(at()[0]).toBe(x - 200);
  });

  it('the central topic grows to both sides: its edge follows the pointer, and the outline stays centred', () => {
    const shown = computeLayout({ id: 'r', text: long, children: [{ id: 'a', text: 'Alpha', children: [] }] }, measure);
    const h = mount({ layout: shown, selectedId: 'r' });
    const r = boxOf('r', shown);
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 100, y, { buttons: 1 });
    // 100 px further out on each side; 2 × 26 px of the box are not text.
    const wrap = r.w + 200 - 52;
    const becomes = wrappedAt('r', wrap, shown);
    expect(outline().style.left).toBe(`${r.x + r.w / 2 - becomes.w / 2}px`);
    expect(outline().textContent).toBe(`${wrap} px`);
    expect(at()[0]).toBe(x + 100);
    fire(handle(), 'pointerup', x + 100, y);
    expect(h.onWrapText).toHaveBeenCalledWith('r', wrap);
  });

  it('in an org chart the outline grows downwards from the topic’s top', () => {
    const shown = layoutMap(tree(), 'org', measure);
    const h = mount({ layout: shown });
    const t = boxOf('t', shown);
    const [x, y] = at();
    expect(x).toBe(t.x + t.w);
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    // A small box: 2 × 11 px of it are not text.
    const wrap = t.w + 200 - 22;
    const becomes = wrappedAt('t', wrap, shown);
    expect(becomes.lines.length).toBeLessThan(t.lines.length);
    expect(outline().style.left).toBe(`${t.x}px`);
    expect(outline().style.top).toBe(`${t.y}px`);
    expect(outline().style.height).toBe(`${becomes.h}px`);
    fire(handle(), 'pointerup', x + 200, y);
    expect(h.onWrapText).toHaveBeenCalledWith('t', wrap);
  });

  it('the room of a priority badge and of the note icon is not text', () => {
    const shown = computeLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'Alpha', children: [
      { id: 't', text: long, priority: 1, note: 'A note', children: [] },
    ] }] }, measure);
    const h = mount({ layout: shown });
    const t = boxOf('t', shown);
    expect([t.badgeW, t.noteW]).toEqual([24, 24]);
    drag(200);
    expect(h.onWrapText).toHaveBeenCalledWith('t', t.w + 200 - 10 - 48);
  });

  it('a drag that leaves every line as it is changes nothing, and the outline says so', () => {
    const h = mount({ selectedId: 'u' });
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 120, y, { buttons: 1 });
    expect(outline().hidden).toBe(false);
    expect(outline().style.width).toBe(`${boxOf('u').w}px`);
    expect(outline().textContent).toBe('No change');
    fire(handle(), 'pointerup', x + 120, y);
    expect(h.onWrapText).not.toHaveBeenCalled();
    // Also for a text with several lines, when no word changes its line.
    remount({ selectedId: 't' });
    drag(4);
    expect(h.onWrapText).not.toHaveBeenCalled();
  });

  it('the width cannot be dragged below or above what a map may hold, and the handle stops there', () => {
    const h = mount();
    const t = boxOf('t');
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x - 5000, y, { buttons: 1 });
    expect(outline().textContent).toBe('60 px');
    expect(at()[0]).toBe(t.x + 60 + 10);
    fire(handle(), 'pointermove', x + 9000, y, { buttons: 1 });
    expect(outline().textContent).toBe('1600 px');
    expect(at()[0]).toBe(t.x + 1600 + 10);
    fire(handle(), 'pointerup', x + 9000, y);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 1600);
  });

  it('zoomed in, the same drag on the screen changes the width by less', () => {
    const { canvas, onWrapText } = mount();
    act(() => canvas.current!.zoomBy(2));
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    const becomes = wrappedAt('t', 347);
    expect(outline().style.left).toBe(`${2 * boxOf('t').x}px`);
    expect(outline().style.width).toBe(`${2 * becomes.w}px`);
    expect(outline().style.height).toBe(`${2 * becomes.h}px`);
    fire(handle(), 'pointerup', x + 200, y);
    expect(onWrapText).toHaveBeenCalledWith('t', 347);
  });

  it('a press beside the middle of the handle keeps that distance: the edge does not jump to the pointer', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x + 5, y - 6, { buttons: 1 });
    fire(handle(), 'pointermove', x + 205, y - 6, { buttons: 1 });
    expect(outline().textContent).toBe('447 px');
    expect(at()[0]).toBe(x + 200);
    fire(handle(), 'pointerup', x + 205, y - 6);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 447);
  });

  it('the canvas moved during a drag: the edge stays under the pointer', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    // The wheel moves the map 40px to the left under a pointer that stays where it is.
    act(() => void handle().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 40, deltaY: 0 })));
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    expect(outline().style.left).toBe(`${boxOf('t').x - 40}px`);
    expect(outline().textContent).toBe('487 px');
    expect(at()[0]).toBe(x + 200);
    fire(handle(), 'pointerup', x + 200, y);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 487);
  });

  it('the handle takes the pointer for the whole drag, so moves off the small handle still reach it', () => {
    mount();
    const capture = vi.fn();
    handle().setPointerCapture = capture;
    const [x, y] = at();
    const down = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y });
    Object.defineProperty(down, 'pointerId', { value: 7 });
    act(() => void handle().dispatchEvent(down));
    expect(capture).toHaveBeenCalledWith(7);
  });

  it('a press that never moves, or moves less than 3 px, gives no width', () => {
    const h = mount();
    drag(0);
    drag(2);
    expect(h.onWrapText).not.toHaveBeenCalled();
    expect(outline().hidden).toBe(true);
  });

  it('a drag that comes back to where it started gives no width', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    fire(handle(), 'pointermove', x, y, { buttons: 1 });
    expect(outline().textContent).toBe('No change');
    fire(handle(), 'pointerup', x, y);
    expect(h.onWrapText).not.toHaveBeenCalled();
  });

  it('a cancelled drag gives no width, and the outline and the handle go back', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    fire(handle(), 'pointercancel', x + 200, y);
    expect(h.onWrapText).not.toHaveBeenCalled();
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([x, y]);
  });

  it('a drag whose release never arrived stops at the next move without a button, and gives no width', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 260, y, { buttons: 0 });
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([x, y]);
    fire(handle(), 'pointerup', x + 260, y);
    expect(h.onWrapText).not.toHaveBeenCalled();
  });

  it('a drag the browser takes the pointer from gives no width', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    fire(handle(), 'lostpointercapture', x + 200, y);
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([x, y]);
    expect(h.onWrapText).not.toHaveBeenCalled();
  });

  it('only the main button drags, and the browser’s menu stays shut on the handle', () => {
    const h = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { button: 2, buttons: 2 });
    fire(handle(), 'pointermove', x + 200, y, { button: 2, buttons: 2 });
    expect(outline().hidden).toBe(true);
    fire(handle(), 'pointerup', x + 200, y, { button: 2 });
    expect(h.onWrapText).not.toHaveBeenCalled();
    expect(fire(handle(), 'contextmenu', 0, 0, { button: 2 }).defaultPrevented).toBe(true);
  });

  it('a press on the handle selects nothing else, opens no text box and keeps the keyboard where it is', () => {
    const h = mount();
    const [x, y] = at();
    expect(fire(handle(), 'mousedown', x, y).defaultPrevented).toBe(true);
    drag(200);
    expect(h.onSelect).not.toHaveBeenCalled();
    expect(h.onSelectMany).not.toHaveBeenCalled();
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('a finger drags the handle like the mouse does', () => {
    const h = mount();
    const [x, y] = at();
    const touch = (type: string, px: number, buttons: number) => {
      const ev = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: px, clientY: y });
      Object.defineProperty(ev, 'pointerType', { value: 'touch' });
      act(() => void handle().dispatchEvent(ev));
    };
    touch('pointerdown', x, 1);
    touch('pointermove', x + 200, 1);
    touch('pointerup', x + 200, 0);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 447);
  });

  it('the wheel over the handle moves the canvas, as it does anywhere else on it', () => {
    mount();
    const world = container.querySelector('g.world')!;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 10, deltaY: 20 });
    act(() => void handle().dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(world.getAttribute('transform')).toBe('translate(-10 -20) scale(1)');
  });

  describe('a double click on the handle', () => {
    const withWrap = computeLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'Alpha', children: [
      { id: 't', text: long, wrap: 447, children: [] },
    ] }] }, measure);

    it('takes a width set by hand away: the text wraps where its level says again', () => {
      const h = mount({ layout: withWrap });
      fire(handle(), 'dblclick', ...at());
      expect(h.onWrapText).toHaveBeenCalledTimes(1);
      expect(h.onWrapText).toHaveBeenCalledWith('t', null);
    });

    it('does nothing on a topic whose width is automatic', () => {
      const h = mount();
      fire(handle(), 'dblclick', ...at());
      expect(h.onWrapText).not.toHaveBeenCalled();
    });
  });

  describe('a drag ends without a width when its topic is no longer the one with the handle', () => {
    /** Presses the handle of `t` and drags it; the button stays down. */
    function startDrag() {
      const { canvas: _canvas, ...h } = mount();
      const [x, y] = at();
      fire(handle(), 'pointerdown', x, y, { buttons: 1 });
      fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
      expect(outline().hidden).toBe(false);
      return { h, x, y };
    }
    const letGo = (x: number, y: number) => {
      fire(handle(), 'pointermove', x + 240, y, { buttons: 1 });
      fire(handle(), 'pointerup', x + 240, y);
    };

    it('the selection moved to another topic: the handle is on that topic, and neither gets a width', () => {
      const { h, x, y } = startDrag();
      act(() => root!.render(<Canvas layout={layout} selectedId="l" interactive {...h} />));
      expect(outline().hidden).toBe(true);
      expect(at()).toEqual([edgeOf('l'), midOf('l')]);
      letGo(x, y);
      expect(outline().hidden).toBe(true);
      expect(at()).toEqual([edgeOf('l'), midOf('l')]);
      expect(h.onWrapText).not.toHaveBeenCalled();
    });

    it('nothing is selected any more', () => {
      const { h, x, y } = startDrag();
      act(() => root!.render(<Canvas layout={layout} selectedId={null} interactive {...h} />));
      expect(outline().hidden).toBe(true);
      expect(handle().hidden).toBe(true);
      letGo(x, y);
      expect(h.onWrapText).not.toHaveBeenCalled();
    });

    it('new widths can no longer be taken (a text box opened)', () => {
      const { h, x, y } = startDrag();
      const { onWrapText: _off, ...rest } = h;
      act(() => root!.render(<Canvas layout={layout} selectedId="t" interactive {...rest} />));
      expect(outline().hidden).toBe(true);
      expect(handle().hidden).toBe(true);
      letGo(x, y);
      expect(h.onWrapText).not.toHaveBeenCalled();
    });
  });

  it('a drag goes on when the map is drawn again, from where the topic is now and with the text it has now', () => {
    const { canvas: _canvas, ...h } = mount();
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    // The main branch got a longer text (an undo, say), which pushes its topics outwards.
    const changed = tree();
    changed.children[0].text = 'Alpha, and now with more text';
    const moved = computeLayout(changed, measure);
    expect(boxOf('t', moved).x).not.toBe(boxOf('t').x);
    act(() => root!.render(<Canvas layout={moved} selectedId="t" interactive {...h} />));
    expect(outline().hidden).toBe(false);
    expect(outline().style.left).toBe(`${boxOf('t', moved).x}px`);
    // Let go 240 px from the press: the edge the pointer holds is that far from where it was on the screen.
    fire(handle(), 'pointermove', x + 240, y, { buttons: 1 });
    fire(handle(), 'pointerup', x + 240, y);
    const wrap = x + 240 - boxOf('t', moved).x - 10;
    expect(wrap).not.toBe(487);
    expect(h.onWrapText).toHaveBeenCalledWith('t', wrap);
  });

  it('a topic with an image has both handles, and each does its own job', () => {
    const shown = computeLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'Alpha', children: [
      { id: 't', text: long, image: { key: 'img/abcdefghijklmnopqrstu/p.png', w: 120, h: 60 }, children: [] },
    ] }] }, measure);
    const h = mount({ layout: shown });
    const t = boxOf('t', shown);
    expect(container.querySelector<HTMLElement>('.image-handle')!.hidden).toBe(false);
    // The middle of the text, not of the whole topic: the image is above the text.
    expect(at()).toEqual([t.x + t.w, t.y + t.textTop + 44]);
    drag(200);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 447);
    expect(h.onResizeImage).not.toHaveBeenCalled();
  });

  it('one drag at a time: a press on the other handle (a second finger) ends the drag that is on, without a change', () => {
    const shown = computeLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'Alpha', children: [
      { id: 't', text: long, image: { key: 'img/abcdefghijklmnopqrstu/p.png', w: 120, h: 60 }, children: [] },
    ] }] }, measure);
    const h = mount({ layout: shown });
    const t = boxOf('t', shown);
    const corner = container.querySelector<HTMLElement>('.image-handle')!;
    const [cx, cy] = [t.x + t.image!.x + 120, t.y + t.image!.y + 60];
    const [x, y] = at();
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    expect(outline().textContent).toBe('447 px');
    fire(corner, 'pointerdown', cx, cy, { buttons: 1 });
    expect(outline().hidden).toBe(true);
    expect(at()).toEqual([x, y]);
    fire(handle(), 'pointermove', x + 220, y, { buttons: 1 });
    fire(handle(), 'pointerup', x + 220, y);
    expect(h.onWrapText).not.toHaveBeenCalled();
    fire(corner, 'pointermove', cx + 60, cy + 30, { buttons: 1 });
    expect(outline().textContent).toBe('180 × 90');
    // And the other way round.
    fire(handle(), 'pointerdown', x, y, { buttons: 1 });
    expect(outline().hidden).toBe(true);
    fire(corner, 'pointerup', cx + 60, cy + 30);
    expect(h.onResizeImage).not.toHaveBeenCalled();
    fire(handle(), 'pointermove', x + 200, y, { buttons: 1 });
    fire(handle(), 'pointerup', x + 200, y);
    expect(h.onWrapText).toHaveBeenCalledTimes(1);
    expect(h.onWrapText).toHaveBeenCalledWith('t', 447);
  });
});
