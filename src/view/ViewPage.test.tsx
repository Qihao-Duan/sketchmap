// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../shared/types';
import { MapView, ViewPage } from './ViewPage';

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
});
