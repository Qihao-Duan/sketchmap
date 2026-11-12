// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { MindMap } from '../shared/types';
import { draftKey } from './autosave';
import { Editor } from './EditorPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't', root: { id: 'root000001', text: 'Root', children: [] } };
const measure = () => (t: string, s: number) => t.length * s * 0.5;
let container: HTMLDivElement;

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listMaps: vi.fn(), createMap: vi.fn(), deleteMap: vi.fn(),
    getMap: vi.fn(async () => ({ map, etag: '"server"' })),
    saveMap: vi.fn(async (m: MindMap) => ({ map: { ...m, version: m.version + 1, title: m.root.text }, etag: '"e2"' })),
    ...overrides,
  };
}
function mount(api: ApiClient, initial: MindMap = map, etag = '"e1"') {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Editor initial={initial} etag={etag} api={api} measureFactory={measure} />));
}
const keydown = (init: KeyboardEventInit, target: EventTarget = window) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
function type(ta: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function typeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function paste(text: string, html = '') {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: (type: string) => (type === 'text/html' ? html : text) } });
  act(() => void window.dispatchEvent(ev));
}
const pressed = () => container.querySelector('[aria-label="Layout"] button[aria-pressed="true"]')!.textContent;
const topics = () => container.querySelectorAll('g.topic').length;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const click = (text: string) => act(async () => {
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click();
  await vi.advanceTimersByTimeAsync(0); // let the async handler finish
});
const clickLabel = (label: string) => act(async () => {
  (container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(0);
});
const pressedIn = (group: string) =>
  [...container.querySelectorAll(`[aria-label="${group}"] button[aria-pressed="true"]`)].map((b) => b.getAttribute('aria-label') ?? b.textContent);

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { container.remove(); vi.useRealTimers(); });

describe('Editor', () => {
  it('Tab adds a child, typing + Enter names it, and it autosaves 1 s later', async () => {
    const api = fakeApi();
    mount(api);
    keydown({ key: 'Tab' });
    const ta = container.querySelector('textarea.inline-editor') as HTMLTextAreaElement;
    type(ta, 'Child');
    keydown({ key: 'Enter' }, ta);
    expect(topics()).toBe(2);
    await advance(1000);
    expect(api.saveMap).toHaveBeenCalledTimes(1);
    const [saved, etag] = vi.mocked(api.saveMap).mock.calls[0];
    expect([saved.root.children[0].text, etag]).toEqual(['Child', '"e1"']);
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Saved');
  });

  it('Delete removes the selected topic and ⌘Z brings it back', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Temp');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    keydown({ key: 'Delete' });
    expect(topics()).toBe(1);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(2);
  });

  it('shows an alert banner with the server message when a save is rejected for good, and stops retrying', async () => {
    const api = fakeApi({ saveMap: vi.fn(async () => { throw new ApiError(400, 'Topic text is too long'); }) });
    mount(api);
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Child');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await advance(1000);
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Not saved: rejected by the server');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Topic text is too long');
    expect(alert?.textContent).toContain('kept in this browser');
    await advance(60_000);
    expect(api.saveMap).toHaveBeenCalledTimes(1);
  });

  it('on a conflict, "Load the newer version" replaces the map and stops saving mine', async () => {
    const api = fakeApi({ saveMap: vi.fn(async () => { throw new ApiError(409, 'changed', '"x"'); }) });
    mount(api);
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Mine');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await advance(1000);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Load the newer version');
    expect(api.getMap).toHaveBeenCalledWith(map.id);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(topics()).toBe(1);
    await advance(5000);
    expect(api.saveMap).toHaveBeenCalledTimes(1);
  });

  it('offers to restore a local draft that differs from the server copy', async () => {
    const draftMap = { ...map, root: { ...map.root, children: [{ id: 'draft00001', text: 'From draft', children: [] }] } };
    localStorage.setItem(draftKey(map.id), JSON.stringify({ map: draftMap, etag: '"old"', savedAt: 1 }));
    const api = fakeApi();
    mount(api);
    expect(container.textContent).toContain('unsaved changes');
    await click('Restore');
    expect(topics()).toBe(2);
    await advance(1000);
    expect(vi.mocked(api.saveMap).mock.calls[0][0].root.children[0].text).toBe('From draft');
    expect(vi.mocked(api.saveMap).mock.calls[0][1]).toBe('"old"');
  });

  it('restoring a draft based on an old ETag asks via the conflict dialog instead of silently overwriting a newer server version', async () => {
    const draftMap = { ...map, root: { ...map.root, children: [{ id: 'draft00001', text: 'From draft', children: [] }] } };
    localStorage.setItem(draftKey(map.id), JSON.stringify({ map: draftMap, etag: '"old"', savedAt: 1 }));
    const api = fakeApi({ saveMap: vi.fn(async () => { throw new ApiError(409, 'changed', '"x"'); }) });
    mount(api);
    await click('Restore');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await advance(1000);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('on a 401, asks for the owner key and retries the save once it is entered', async () => {
    let calls = 0;
    const api = fakeApi({
      saveMap: vi.fn(async (m: MindMap) => {
        calls++;
        if (calls === 1) throw new ApiError(401, 'Unauthorized');
        return { map: { ...m, version: m.version + 1, title: m.root.text }, etag: '"e2"' };
      }),
    });
    mount(api);
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Child');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await advance(1000);
    expect(container.textContent).toContain('owner key');
    const input = container.querySelector('#owner-key') as HTMLInputElement;
    expect(input).not.toBeNull();
    typeInput(input, 'new-owner-key');
    await click('Continue');
    expect(calls).toBe(2);
  });

  it('"Keep mine and overwrite" saves the current map with the fresh ETag returned by getMap', async () => {
    let calls = 0;
    const api = fakeApi({
      saveMap: vi.fn(async (m: MindMap) => {
        calls++;
        if (calls === 1) throw new ApiError(409, 'changed', '"x"');
        return { map: { ...m, version: m.version + 1, title: m.root.text }, etag: '"e3"' };
      }),
    });
    mount(api);
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Mine');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await advance(1000);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Keep mine and overwrite');
    expect(api.getMap).toHaveBeenCalledWith(map.id);
    expect(vi.mocked(api.saveMap).mock.calls[1][1]).toBe('"server"');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('offers a draft that differs from the server copy only in its layout', async () => {
    const draftMap = { ...map, layout: 'org' as const };
    localStorage.setItem(draftKey(map.id), JSON.stringify({ map: draftMap, etag: '"old"', savedAt: 1 }));
    mount(fakeApi());
    expect(container.textContent).toContain('unsaved changes');
    await click('Restore');
    expect(pressed()).toBe('Org chart');
  });

  it('warns that the draft is older than the saved map when its timestamp precedes updatedAt', async () => {
    const draftMap = { ...map, root: { ...map.root, children: [{ id: 'draft00001', text: 'From draft', children: [] }] } };
    localStorage.setItem(draftKey(map.id), JSON.stringify({ map: draftMap, etag: '"old"', savedAt: 1000 }));
    const newerInitial = { ...map, updatedAt: new Date(2000).toISOString() };
    mount(fakeApi(), newerInitial);
    expect(container.textContent).toContain('older than the saved map');
  });

  it('switches to the org chart as an undoable, autosaved change', async () => {
    const api = fakeApi();
    mount(api);
    expect(pressed()).toBe('Mind map');
    await click('Org chart');
    expect(pressed()).toBe('Org chart');
    await advance(1000);
    expect(vi.mocked(api.saveMap).mock.calls[0][0].layout).toBe('org');
    keydown({ key: 'z', metaKey: true });
    expect(pressed()).toBe('Mind map');
  });

  it('ends an empty new-topic edit before switching layout, so the layout switch is not reverted by Esc', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    expect(topics()).toBe(2);
    await click('Org chart');
    expect(topics()).toBe(1);
    expect(pressed()).toBe('Org chart');
    keydown({ key: 'Escape' });
    expect(pressed()).toBe('Org chart');
  });

  it('ends a named new-topic edit before switching layout, so undo steps through the edit and then the add', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    const ta = container.querySelector('textarea.inline-editor') as HTMLTextAreaElement;
    type(ta, 'Hello');
    await click('Org chart');
    expect(topics()).toBe(2);
    expect(container.textContent).toContain('Hello');
    expect(pressed()).toBe('Org chart');
    keydown({ key: 'z', metaKey: true });
    expect(pressed()).toBe('Mind map');
    expect(topics()).toBe(2);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(1);
  });

  it('pasting an outline adds topics under the selection as one undo step', () => {
    mount(fakeApi());
    paste('- Alpha\n  - Alpha 1\n- Beta');
    expect(topics()).toBe(4);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(1);
  });

  it('prefers the HTML list structure when the clipboard has one (XMind, Notion)', () => {
    mount(fakeApi());
    paste('flat fallback text', '<ul><li><p>Topic</p><ul><li><p>Line one</p><p>Line two</p></li></ul></li></ul>');
    expect(topics()).toBe(3);
    expect(container.textContent).toContain('Line two');
    expect(container.textContent).not.toContain('flat fallback text');
  });

  it('ignores a window paste while the Outline panel is open', async () => {
    mount(fakeApi());
    await click('Outline');
    paste('- Alpha\n- Beta');
    expect(topics()).toBe(1);
  });

  it('replaces the map from the Outline panel; undo brings the old map back', async () => {
    mount(fakeApi());
    await click('Outline');
    const ta = container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement;
    expect(ta.value).toBe('# Root\n');
    type(ta, '# New root\n- X\n- Y');
    await click('Replace map with this');
    expect(container.querySelector('textarea[aria-label="Outline text"]')).toBeNull();
    expect(topics()).toBe(3);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(1);
  });

  it('shows an error for an empty outline and keeps the panel open', async () => {
    mount(fakeApi());
    await click('Outline');
    type(container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement, '   ');
    await click('Replace map with this');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('The outline is empty.');
    expect(topics()).toBe(1);
  });

  it('focuses the Outline textarea on open, and Escape closes the panel', async () => {
    mount(fakeApi());
    await click('Outline');
    const ta = container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    keydown({ key: 'Escape' }, ta);
    expect(container.querySelector('textarea[aria-label="Outline text"]')).toBeNull();
  });

  it('copies the map as Markdown', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mount(fakeApi());
      await click('Copy as Markdown');
      expect(writeText).toHaveBeenCalledWith('# Root\n');
      expect(container.textContent).toContain('Markdown copied');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('Alt ↑ raises importance and Alt+2 (read from the key code) sets priority 2', async () => {
    const api = fakeApi();
    mount(api);
    keydown({ key: 'ArrowUp', altKey: true });
    keydown({ key: '™', code: 'Digit2', altKey: true });
    await advance(1100);
    const saved = vi.mocked(api.saveMap).mock.calls.at(-1)![0];
    expect(saved.root).toMatchObject({ emphasis: 'highlight', priority: 2 });
  });

  it('says what Copy as Markdown leaves out, and the Outline panel says it too', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mount(fakeApi(), { ...map, root: { ...map.root, emphasis: 'highlight', note: 'n' } });
      await click('Copy as Markdown');
      expect(container.textContent).toContain('Not kept in Markdown: Highlight, notes.');
      await click('Outline');
      expect(container.querySelector('[aria-label="Markdown outline"]')!.textContent).toContain('Not kept in Markdown: Highlight, notes.');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });
});

describe('Details panel', () => {
  it('sets importance, priority and marker on the selected topic, each one undo step', async () => {
    mount(fakeApi());
    expect(pressedIn('Importance')).toEqual(['Normal']);
    expect(pressedIn('Priority')).toEqual(['No priority']);
    await click('Key');
    await clickLabel('Priority 2');
    await clickLabel('Marker 💡');
    expect(pressedIn('Importance')).toEqual(['Key']);
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
    expect(pressedIn('Marker')).toEqual(['Marker 💡']);
    expect(container.querySelector('g.badge text')!.textContent).toBe('2');
    keydown({ key: 'z', metaKey: true });
    expect(pressedIn('Marker')).toEqual([]);
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
    await clickLabel('Priority 2'); // pressing the active priority again keeps it
    expect(pressedIn('Priority')).toEqual(['Priority 2']);
  });

  it('a second click on the active marker removes it', async () => {
    mount(fakeApi());
    await clickLabel('Marker ✅');
    await clickLabel('Marker ✅');
    expect(pressedIn('Marker')).toEqual([]);
  });

  it('saves a note after a pause, as one undo step, and shows the note icon', async () => {
    mount(fakeApi());
    const ta = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    type(ta, 'Remember');
    await advance(800);
    type(ta, 'Remember this');
    await advance(800);
    expect(container.querySelector('g.note-icon title')!.textContent).toBe('Remember this');
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelector('g.note-icon')).toBeNull();
    expect(ta.value).toBe('');
  });

  it('closes an open topic edit first, keeping the typed text', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea.inline-editor') as HTMLTextAreaElement, 'Hi');
    await click('Key');
    expect(container.querySelector('textarea.inline-editor')).toBeNull();
    expect(topics()).toBe(2);
    expect(pressedIn('Importance')).toEqual(['Key']);
    expect(container.querySelector('[aria-label="Topic details"] .topic-title')!.textContent).toBe('Hi');
  });

  it('the Details button hides the panel and remembers the choice', async () => {
    mount(fakeApi());
    await click('Details');
    expect(container.querySelector('[aria-label="Topic details"]')).toBeNull();
    expect(localStorage.getItem('sketchmap:details')).toBe('0');
  });
});
