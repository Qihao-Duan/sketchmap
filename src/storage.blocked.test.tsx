// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from './api/client';
import type { MindMap } from './shared/types';

// A browser that blocks site data: reading `localStorage` itself throws. The app modules are imported
// inside the tests, after the block is in place, because `browserStorage()` picks its store once.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
const reads = { local: 0, session: 0 };
let container: HTMLDivElement;

beforeAll(() => {
  vi.resetModules();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      reads.local++;
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() {
      reads.session++;
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
});
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  if (originalSession) Object.defineProperty(globalThis, 'sessionStorage', originalSession);
});
afterEach(() => container?.remove());

function mountPoint() {
  container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('with browser storage blocked', () => {
  it('really is blocked in this file', () => {
    expect(() => localStorage).toThrow();
  });

  it('keeps the owner key for the life of the page instead of throwing', async () => {
    const { clearOwnerKey, getOwnerKey, setOwnerKey } = await import('./auth/ownerKey');
    expect(getOwnerKey()).toBeNull();
    setOwnerKey('k');
    expect(getOwnerKey()).toBe('k');
    clearOwnerKey();
    expect(getOwnerKey()).toBeNull();
  });

  it('shows the list page (asking for the owner key) instead of crashing', async () => {
    const { ListPage } = await import('./list/ListPage');
    // No key can be stored, so the page first asks the server whether a session is open; here it isn't.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ signedIn: false, email: null, google: false })));
    try {
      await act(async () => createRoot(mountPoint()).render(<ListPage go={() => {}} />));
      await act(async () => {});
      expect(container.querySelector('#owner-key')).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the editor and draws the map', async () => {
    const { Editor } = await import('./editor/EditorPage');
    const map: MindMap = {
      id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't',
      root: { id: 'root000001', text: 'Root', children: [{ id: 'kid0000001', text: 'Child', children: [] }] },
    };
    const api: ApiClient = {
      listMaps: vi.fn(), createMap: vi.fn(), deleteMap: vi.fn(), uploadImage: vi.fn(),
      getMap: vi.fn(async () => ({ map, etag: '"e1"' })),
      saveMap: vi.fn(async (m: MindMap) => ({ map: m, etag: '"e2"' })),
    };
    act(() => createRoot(mountPoint()).render(<Editor initial={map} etag={'"e1"'} api={api} measureFactory={() => (t, s) => t.length * s * 0.5} />));
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
    // Folding the details panel writes its state: with blocked storage that must be silent too.
    const fold = container.querySelector('button.fold-details') as HTMLButtonElement | null;
    expect(fold).not.toBeNull();
    act(() => fold!.click());
    expect(container.querySelector('.details-tab')).not.toBeNull();
  });

  it('the view-only embed reads no browser storage at all', async () => {
    const before = { ...reads };
    const { MapView } = await import('./view/ViewPage');
    const map: MindMap = {
      id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't',
      root: { id: 'root000001', text: 'Root', children: [{ id: 'kid0000001', text: 'Child', children: [] }] },
    };
    act(() => createRoot(mountPoint()).render(<MapView map={map} measureFactory={() => (t, s) => t.length * s * 0.5} />));
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
    const fold = container.querySelector('[data-fold] rect');
    if (fold) act(() => void fold.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    expect(reads).toEqual(before);
  });
});
