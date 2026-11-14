// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../shared/types';
import { MapView, placeNoteCard, ViewPage } from './ViewPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const map: MindMap = {
  id: 'abcdefghijklmnopqrstu', title: 'Plan', layout: 'map', version: 3, updatedAt: 't',
  root: { id: 'r', text: 'Plan', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
};
const measure = () => (t: string, s: number) => t.length * s * 0.5;
let container: HTMLDivElement;
const render = async (ui: ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(ui));
};
const press = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe('MapView', () => {
  it('shows the map read-only with a View only pill and an edit link in a new tab', async () => {
    await render(<MapView map={map} measureFactory={measure} />);
    expect(container.querySelectorAll('g.topic')).toHaveLength(3);
    expect(container.textContent).toContain('View only');
    const link = container.querySelector('a.edit-link')!;
    expect([link.getAttribute('href'), link.getAttribute('target')]).toEqual([`/e/${map.id}`, '_blank']);
    press(container.querySelector('g.topic[data-id="a"] rect.hit')!);
    expect(container.querySelector('g.topic.selected')).toBeNull();
  });

  describe('notes', () => {
    const long = `First line\nSecond line ${'x'.repeat(1200)} END`;
    const noted: MindMap = {
      ...map,
      root: { id: 'r', text: 'Plan', children: [
        { id: 'a', text: 'A', note: 'Bring the tickets', children: [{ id: 'a1', text: 'A1', children: [] }] },
        { id: 'b', text: 'B', note: long, children: [] },
      ] },
    };
    const tap = (el: Element) => {
      act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
      act(() => void el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
    };
    const iconOf = (id: string) => container.querySelector(`g.note-icon[data-note="${id}"] rect`)!;
    const card = () => container.querySelector('.note-card');

    it('a tap on a note icon shows the whole note in a card; a second tap puts it away', async () => {
      await render(<MapView map={noted} measureFactory={measure} />);
      expect(card()).toBeNull();
      tap(iconOf('a'));
      expect(card()!.getAttribute('role')).toBe('dialog');
      expect(card()!.querySelector('.note-text')!.textContent).toBe('Bring the tickets');
      tap(iconOf('a'));
      expect(card()).toBeNull();
    });

    it('shows a long note in full (the hover tooltip stops at 1000 characters) and switches when another icon is tapped', async () => {
      await render(<MapView map={noted} measureFactory={measure} />);
      tap(iconOf('a'));
      tap(iconOf('b'));
      expect(container.querySelectorAll('.note-card')).toHaveLength(1);
      expect(card()!.querySelector('.note-text')!.textContent).toBe(long);
    });

    it('goes away on Escape, on its close button, and on a press anywhere outside it', async () => {
      await render(<MapView map={noted} measureFactory={measure} />);
      tap(iconOf('a'));
      act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(card()).toBeNull();
      tap(iconOf('a'));
      act(() => (card()!.querySelector('button[aria-label="Close note"]') as HTMLButtonElement).click());
      expect(card()).toBeNull();
      tap(iconOf('a'));
      act(() => void card()!.querySelector('.note-text')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      expect(card()).not.toBeNull(); // a press inside the card (to select text, to scroll) keeps it
      act(() => void container.querySelector('.view-bar')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      expect(card()).toBeNull();
    });

    it('goes away when a branch is folded', async () => {
      await render(<MapView map={noted} measureFactory={measure} />);
      tap(iconOf('b'));
      press(container.querySelector('[data-fold="a"] rect')!);
      expect(card()).toBeNull();
    });

    describe('with the page laid out (jsdom has no layout, so the boxes are given here)', () => {
      const page = { left: 0, top: 0, right: 400, bottom: 400 };
      let iconBox = { left: 100, top: 100, right: 120, bottom: 120 };
      const rect = ({ left, top, right, bottom }: typeof page) =>
        ({ left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) }) as DOMRect;
      beforeEach(() => {
        iconBox = { left: 100, top: 100, right: 120, bottom: 120 };
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
          return rect(this.closest('[data-note]') ? iconBox : page);
        });
      });
      afterEach(() => vi.restoreAllMocks());
      const wheel = () =>
        act(() => void container.querySelector('svg')!.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })));

      it('a second tap that drifts a few pixels still puts the card away (the drift moves the map a little)', async () => {
        await render(<MapView map={noted} measureFactory={measure} />);
        tap(iconOf('a'));
        expect(card()).not.toBeNull();
        const icon = iconOf('a');
        act(() => void icon.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 })));
        act(() => void icon.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 7, clientY: 8 })));
        act(() => void icon.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 7, clientY: 8 })));
        expect(card()).toBeNull();
      });

      it('stays with its icon while the map moves or is redrawn, and goes away once the icon has left the page', async () => {
        await render(<MapView map={noted} measureFactory={measure} />);
        tap(iconOf('b'));
        wheel();
        expect(card()).not.toBeNull();
        iconBox = { left: 500, top: 100, right: 520, bottom: 120 }; // moved off the right edge
        wheel();
        expect(card()).toBeNull();
      });
    });
  });

  describe('placeNoteCard', () => {
    const page = { width: 390, height: 700 };
    const icon = (left: number, top: number) => ({ left, top, right: left + 20, bottom: top + 22 });

    it('puts the card under its icon, a little to the left of it', () => {
      expect(placeNoteCard(page, icon(100, 200), { width: 200, height: 80 })).toEqual({ left: 88, top: 230 });
    });

    it('keeps the card inside the page on the right and the left, with 8 px to spare', () => {
      expect(placeNoteCard(page, icon(330, 200), { width: 320, height: 80 }).left).toBe(390 - 320 - 8);
      expect(placeNoteCard(page, icon(2, 200), { width: 120, height: 80 }).left).toBe(8);
    });

    it('goes above the icon when it does not fit under it', () => {
      expect(placeNoteCard(page, icon(100, 600), { width: 200, height: 120 })).toEqual({ left: 88, top: 600 - 8 - 120 });
    });

    it('when it fits neither under nor above, sits as low as the page allows: never past the bottom, never above the top', () => {
      const short = { width: 720, height: 420 };
      expect(placeNoteCard(short, icon(300, 200), { width: 320, height: 294 }).top).toBe(420 - 8 - 294);
      expect(placeNoteCard({ width: 390, height: 300 }, icon(100, 140), { width: 320, height: 400 }).top).toBe(8);
    });
  });

  it('folds branches locally without touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await render(<MapView map={map} measureFactory={measure} />);
    press(container.querySelector('[data-fold="a"] rect')!);
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('draws the map in its saved layout', async () => {
    await render(<MapView map={{ ...map, layout: 'org' }} measureFactory={measure} />);
    const hit = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
    const rootBottom = Number(hit('r').getAttribute('y')) + Number(hit('r').getAttribute('height'));
    expect(Number(hit('a').getAttribute('y'))).toBeGreaterThan(rootBottom); // org chart: first level sits below the root
  });
});

describe('ViewPage', () => {
  it('loads the map without an owner key', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json(map, { headers: { ETag: '"e"' } }));
    vi.stubGlobal('fetch', fetchSpy);
    await render(<ViewPage id={map.id} />);
    await act(async () => {});
    expect(container.querySelectorAll('g.topic').length).toBeGreaterThan(0);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('explains when a map does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not found' }, { status: 404 })));
    await render(<ViewPage id={map.id} />);
    await act(async () => {});
    expect(container.textContent).toContain('This map doesn’t exist or was deleted.');
  });

  it('shows "Loading map…" at once when Try again is clicked, not the old error', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      vi.stubGlobal('fetch', vi.fn(() => (++calls <= 2 ? Promise.reject(new TypeError('offline')) : new Promise<Response>(() => {}))));
      await render(<ViewPage id={map.id} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // the read is retried once, then fails
      expect(calls).toBe(2);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      const again = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
      await act(async () => { again.click(); });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(container.textContent).toContain('Loading map…');
    } finally {
      vi.useRealTimers();
    }
  });
});
