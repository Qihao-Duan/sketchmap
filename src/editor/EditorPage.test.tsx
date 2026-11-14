// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import { buildExcalidraw } from '../io/excalidraw';
import { buildSvg, download } from '../io/exportImage';
import { ImageError, prepareImage } from '../io/imagePrep';
import type { MindMap } from '../shared/types';
import { draftKey } from './autosave';
import { Editor, EditorPage } from './EditorPage';

// jsdom can't decode images (createImageBitmap/OffscreenCanvas aren't implemented): stub prepareImage,
// keeping the real displaySize/IMAGE_SIZES so the rest of the image flow behaves like production.
vi.mock('../io/imagePrep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../io/imagePrep')>();
  return { ...actual, prepareImage: vi.fn() };
});

// buildExcalidraw lazily imports the real @excalidraw/excalidraw library; stub it so unit tests never pull
// that in, keeping excalidrawLosses and EXCALIDRAW_MIME real.
vi.mock('../io/excalidraw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../io/excalidraw')>();
  return { ...actual, buildExcalidraw: vi.fn(async () => ({ json: '{"type":"excalidraw"}', missingImages: 0 })) };
});
vi.mock('../io/exportImage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../io/exportImage')>();
  return { ...actual, download: vi.fn(), buildSvg: vi.fn(actual.buildSvg) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't', root: { id: 'root000001', text: 'Root', children: [] } };
const measure = () => (t: string, s: number) => t.length * s * 0.5;
let container: HTMLDivElement;
// Every editor a test mounts is unmounted afterwards. An editor left alive keeps listening for keys on the
// window and keeps saving, so it would act on the next test's key presses and clear the shared local draft.
const roots: Root[] = [];
function rootIn(el: HTMLElement): Root {
  const root = createRoot(el);
  roots.push(root);
  return root;
}

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listMaps: vi.fn(), createMap: vi.fn(), deleteMap: vi.fn(),
    uploadImage: vi.fn(async () => ({ key: 'img/abcdefghijklmnopqrstu/k.png' })),
    getMap: vi.fn(async () => ({ map, etag: '"server"' })),
    saveMap: vi.fn(async (m: MindMap) => ({ map: { ...m, version: m.version + 1, title: m.root.text }, etag: '"e2"' })),
    ...overrides,
  };
}
function mount(api: ApiClient, initial: MindMap = map, etag = '"e1"') {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => rootIn(container).render(<Editor initial={initial} etag={etag} api={api} measureFactory={measure} />));
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
async function pasteFile(file: File) {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { files: [file], getData: () => '' } });
  await act(async () => {
    window.dispatchEvent(ev);
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function chooseImage(file: File) {
  const input = container.querySelector('input[aria-label="Image file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function dropFile(el: Element, file: File) {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], types: ['Files'] } });
  await act(async () => {
    el.dispatchEvent(ev);
    await vi.advanceTimersByTimeAsync(0);
  });
}
/** An `uploadImage` that resolves only when the returned `release` is called; one entry in `releases` per call. */
function deferredUploads() {
  const releases: Array<() => void> = [];
  const uploadImage = vi.fn(
    () =>
      new Promise<{ key: string }>((resolve) => {
        releases.push(() => resolve({ key: `img/abcdefghijklmnopqrstu/${releases.length}.png` }));
      }),
  );
  return { uploadImage, releases };
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

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(prepareImage).mockReset();
  vi.mocked(prepareImage).mockResolvedValue({ blob: new Blob(['x'], { type: 'image/png' }), width: 200, height: 100 });
  vi.mocked(buildExcalidraw).mockReset();
  vi.mocked(buildExcalidraw).mockResolvedValue({ json: '{"type":"excalidraw"}', missingImages: 0 });
  vi.mocked(download).mockReset();
});
afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  container.remove();
  vi.useRealTimers();
});

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

  it('saves at once when the browser reports the connection is back, instead of waiting out the backoff', async () => {
    let calls = 0;
    const api = fakeApi({
      saveMap: vi.fn(async (m: MindMap) => {
        if (++calls === 1) throw new ApiError(0, 'offline');
        return { map: { ...m, version: m.version + 1 }, etag: '"e2"' };
      }),
    });
    mount(api);
    keydown({ key: 'Tab' });
    const ta = container.querySelector('textarea.inline-editor') as HTMLTextAreaElement;
    type(ta, 'Child');
    keydown({ key: 'Enter' }, ta);
    await advance(1000);
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Not saved, retrying');
    act(() => void window.dispatchEvent(new Event('online')));
    await advance(0);
    expect(api.saveMap).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Saved');
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
    localStorage.setItem('sketchmap:owner-key', 'stale-key');
    await advance(1000);
    const dialog = container.querySelector('.dialog-backdrop')!;
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('The owner key was rejected. Enter it again to keep saving.');
    expect(dialog.querySelector('a.google-button')).toBeNull();
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Not saved: sign in again');
    expect(localStorage.getItem('sketchmap:owner-key')).toBeNull(); // the refused key is dropped at once
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

  it('⌘K on the selected topic links it; Remove link takes it off; each is one undo step', async () => {
    mount(fakeApi());
    keydown({ key: 'k', metaKey: true });
    const input = () => container.querySelector('[aria-label="Link"] input[aria-label="Link URL"]') as HTMLInputElement;
    typeInput(input(), 'example.com');
    keydown({ key: 'Enter' }, input());
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
    expect(container.querySelector('g.topic a')!.getAttribute('href')).toBe('https://example.com');
    const listed = container.querySelector('[aria-label="Topic details"] .links a')!;
    expect(listed.textContent).toBe('Root ↗');
    expect(listed.getAttribute('rel')).toBe('noopener noreferrer');
    keydown({ key: 'k', metaKey: true });
    await click('Remove link');
    expect(container.querySelector('g.topic a')).toBeNull();
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelector('g.topic a')).not.toBeNull();
  });

  it('⌘K refuses a non-web address and Escape closes the prompt', () => {
    mount(fakeApi());
    keydown({ key: 'k', ctrlKey: true });
    const input = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    typeInput(input, 'javascript:alert(1)');
    keydown({ key: 'Enter' }, input);
    expect(container.querySelector('[aria-label="Link"] [role="alert"]')!.textContent).toContain('http://');
    expect(container.querySelector('g.topic a')).toBeNull();
    keydown({ key: 'Escape' }, input);
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
  });

  it('the details panel shows the plain title of a linked topic', () => {
    mount(fakeApi(), { ...map, root: { ...map.root, text: '[Plan](https://a.com) ahead' } });
    expect(container.querySelector('[aria-label="Topic details"] .topic-title')!.textContent).toBe('Plan ahead');
  });

  it('closes the link prompt when its topic goes away, and the keys work again', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'X');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    keydown({ key: 'k', metaKey: true });
    expect(container.querySelector('[aria-label="Link"]')).not.toBeNull();
    await click('Undo');
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
    expect(topics()).toBe(1);
    keydown({ key: 'Tab' });
    expect(topics()).toBe(2);
  });

  it('keeps the link prompt open with a reason when the link would make the topic too long', () => {
    mount(fakeApi(), { ...map, root: { ...map.root, text: 'x'.repeat(4990) } });
    keydown({ key: 'k', metaKey: true });
    const input = container.querySelector('[aria-label="Link"] input') as HTMLInputElement;
    typeInput(input, 'example.com');
    keydown({ key: 'Enter' }, input);
    expect(container.querySelector('[aria-label="Link"] [role="alert"]')!.textContent).toContain('5000');
    expect(container.querySelector('g.topic a')).toBeNull();
  });

  it('closes the link prompt when a topic is opened for editing', () => {
    mount(fakeApi());
    keydown({ key: 'k', metaKey: true });
    const hit = container.querySelector('g.topic rect.hit')!;
    const press = (type: string) => act(() => void hit.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: 10, clientY: 10 })));
    press('pointerdown'); press('pointerup'); press('pointerdown'); press('pointerup');
    expect(container.querySelector('textarea.inline-editor')).not.toBeNull();
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
  });

  it('⌘K opens the prompt; clicking Outline closes it, and the Outline panel is open', async () => {
    mount(fakeApi());
    keydown({ key: 'k', metaKey: true });
    expect(container.querySelector('[aria-label="Link"]')).not.toBeNull();
    await click('Outline');
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
    expect(container.querySelector('textarea[aria-label="Outline text"]')).not.toBeNull();
  });
});

describe('Details panel', () => {
  it('the ▸ on the panel folds it into a slim tab; the tab opens it again; the choice is remembered', async () => {
    mount(fakeApi());
    await clickLabel('Fold the details panel');
    expect(container.querySelector('[aria-label="Topic details"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Show topic details"]')!.textContent).toContain('Details');
    expect(localStorage.getItem('sketchmap:details')).toBe('0');
    await clickLabel('Show topic details');
    expect(container.querySelector('[aria-label="Topic details"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Show topic details"]')).toBeNull();
    expect(localStorage.getItem('sketchmap:details')).toBe('1');
  });

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

  it('saves a note still waiting for its pause when a toolbar button adds a topic', async () => {
    const api = fakeApi();
    mount(api);
    const ta = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    act(() => ta.focus());
    type(ta, 'Lost?');
    await click('+ Child');
    await advance(1100);
    expect(vi.mocked(api.saveMap).mock.calls.at(-1)![0].root.note).toBe('Lost?');
  });

  it('shows the undone note after Undo from the toolbar, even if the note box had focus', async () => {
    mount(fakeApi());
    const ta = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    act(() => ta.focus());
    type(ta, 'Remember this');
    await advance(800);
    await click('Undo');
    expect(ta.value).toBe('');
  });

  it('asks before closing while a note is unsaved, and dispatches it', () => {
    mount(fakeApi());
    type(container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement, 'Quick thought');
    const ev = new Event('beforeunload', { cancelable: true });
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(container.querySelector('g.note-icon title')!.textContent).toBe('Quick thought');
  });

  it('does nothing to the parent when the sidebar is used while a new topic is still empty', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    await click('Key');
    expect(topics()).toBe(1);
    expect(pressedIn('Importance')).toEqual(['Normal']);
    keydown({ key: 'Tab' });
    await clickLabel('Priority 1');
    expect(topics()).toBe(1);
    expect(pressedIn('Priority')).toEqual(['No priority']);
  });

  it('keeps the note box out of reach while a new topic is open', () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    const note = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void note.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    expect(note.readOnly).toBe(true);
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

  it('a listed link keeps keyboard focus off itself on a mouse click, so shortcuts keep working', () => {
    mount(fakeApi(), { ...map, root: { ...map.root, text: '[Plan](https://a.com) ahead' } });
    const a = container.querySelector('[aria-label="Topic details"] .links a') as HTMLAnchorElement;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void a.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });
});

describe('Images', () => {
  const file = () => new File(['x'], 'photo.png', { type: 'image/png' });
  const topicImage = () => container.querySelector('image.topic-image');

  it('choosing a file in the Image row draws image.topic-image', async () => {
    mount(fakeApi());
    expect(topicImage()).toBeNull();
    await chooseImage(file());
    expect(topicImage()).not.toBeNull();
    expect(topicImage()!.getAttribute('width')).toBe('200');
  });

  it('S, M and L change its width', async () => {
    mount(fakeApi());
    await chooseImage(file());
    await click('S');
    expect(topicImage()!.getAttribute('width')).toBe('120');
    await click('L');
    expect(topicImage()!.getAttribute('width')).toBe('300');
    await click('M');
    expect(topicImage()!.getAttribute('width')).toBe('200');
  });

  it('Remove takes the image away, and undo brings it back', async () => {
    mount(fakeApi());
    await chooseImage(file());
    expect(topicImage()).not.toBeNull();
    await click('Remove');
    expect(topicImage()).toBeNull();
    keydown({ key: 'z', metaKey: true });
    expect(topicImage()).not.toBeNull();
  });

  it('a rejected prepareImage shows the banner and adds nothing', async () => {
    // Message updated for the user's decision (2026-11-13): SVG is no longer refused outright, so
    // "SVG images aren't supported" is no longer something prepareImage can reject with; "couldn't be
    // drawn" (a decode failure) is a real rejection message now in its place.
    vi.mocked(prepareImage).mockRejectedValue(new ImageError('That SVG couldn’t be drawn.'));
    mount(fakeApi());
    await chooseImage(file());
    expect(topicImage()).toBeNull();
    const banner = container.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain('Image not added: That SVG couldn’t be drawn.');
    act(() => void (banner.querySelector('button') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('pasting a clipboard with an image file attaches it to the selected topic', async () => {
    mount(fakeApi());
    await pasteFile(file());
    expect(topicImage()).not.toBeNull();
  });

  it('an uploadImage rejection (413, too large) shows the banner and adds nothing', async () => {
    const api = fakeApi({ uploadImage: vi.fn(async () => { throw new ApiError(413, 'Image is larger than 5 MB'); }) });
    mount(api);
    await chooseImage(file());
    expect(topicImage()).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Image not added: Image is larger than 5 MB');
  });

  it('a non-image dropped on the canvas shows the banner and never calls uploadImage', async () => {
    const api = fakeApi();
    vi.mocked(prepareImage).mockRejectedValue(new ImageError('That file isn’t a PNG, JPEG, WebP or GIF image.'));
    mount(api);
    const svg = container.querySelector('svg')!;
    await dropFile(svg, new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect(topicImage()).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent)
      .toContain('Image not added: That file isn’t a PNG, JPEG, WebP or GIF image.');
    expect(api.uploadImage).not.toHaveBeenCalled();
  });

  it('a window drop carrying files is defaultPrevented, so the browser never navigates away from the editor', () => {
    mount(fakeApi());
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [] } });
    act(() => void window.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
  });

  it('a finished upload never blurs the inline editor; the image is added once the edit commits', async () => {
    const { uploadImage, releases } = deferredUploads();
    mount(fakeApi({ uploadImage }));
    await chooseImage(file());
    keydown({ key: 'F2' });
    const ta = container.querySelector('textarea.inline-editor') as HTMLTextAreaElement;
    type(ta, 'Hello');
    await act(async () => {
      releases[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.activeElement).toBe(ta);
    expect(topicImage()).toBeNull();
    keydown({ key: 'Enter' }, ta);
    expect(topicImage()).not.toBeNull();
    expect(container.textContent).toContain('Hello');
  });

  it('a finished upload while the Note box is focused keeps its focus and draws the image at once', async () => {
    const { uploadImage, releases } = deferredUploads();
    mount(fakeApi({ uploadImage }));
    await chooseImage(file());
    const note = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    act(() => note.focus());
    type(note, 'A photo of my cat');
    await act(async () => {
      releases[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(document.activeElement).toBe(note);
    expect(topicImage()).not.toBeNull();
    expect(note.value).toBe('A photo of my cat');
  });

  it('two overlapping uploads keep Remove locked until both finish', async () => {
    const { uploadImage, releases } = deferredUploads();
    mount(fakeApi({ uploadImage }));
    await chooseImage(file());
    await chooseImage(file());
    expect(releases).toHaveLength(2);
    const remove = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Remove') as HTMLButtonElement | undefined;
    await act(async () => {
      releases[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(remove()?.disabled).toBe(true);
    await act(async () => {
      releases[1]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(remove()?.disabled).toBe(false);
  });

  it('Copy as Markdown does not claim images are lost, even though the Outline panel leaves them out', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      mount(fakeApi(), { ...map, root: { ...map.root, image: { key: 'img/abcdefghijklmnopqrstu/a.png', w: 200, h: 100 } } });
      await click('Copy as Markdown');
      expect(container.textContent).not.toContain('Not kept in Markdown');
      await click('Outline');
      expect(container.querySelector('[aria-label="Markdown outline"]')!.textContent).toContain('Not kept in Markdown: images.');
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('Add image… is disabled with an explanatory title while a new topic is open', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Add image…') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('Finish the new topic first (Enter)');
  });

  it('dropping an image on the canvas while a new topic is open is refused with a banner, and never uploads', async () => {
    const api = fakeApi();
    mount(api);
    keydown({ key: 'Tab' });
    const svg = container.querySelector('svg')!;
    await dropFile(svg, file());
    expect(topicImage()).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent)
      .toContain('Image not added: finish the new topic first (Enter), then add the image.');
    expect(api.uploadImage).not.toHaveBeenCalled();
  });
});

describe('Excalidraw export', () => {
  const exportButtons = () => [...container.querySelectorAll('button')].filter((b) => ['SVG', 'PNG', 'Excalidraw'].includes(b.textContent ?? ''));

  it('clicking Excalidraw downloads a .excalidraw blob and shows what was left out', async () => {
    mount(fakeApi(), { ...map, root: { ...map.root, note: 'Remember' } });
    await click('Excalidraw');
    expect(buildExcalidraw).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(download).mock.calls[0];
    expect(blob.type).toBe('application/vnd.excalidraw+json');
    expect(filename).toBe('Root.excalidraw');
    expect(container.textContent).toContain('Downloaded. Not kept in .excalidraw: notes.');
  });

  it('adds the missing-image count to the notice, after any other losses', async () => {
    vi.mocked(buildExcalidraw).mockResolvedValue({ json: '{"type":"excalidraw"}', missingImages: 2 });
    mount(fakeApi(), { ...map, root: { ...map.root, note: 'Remember' } });
    await click('Excalidraw');
    expect(container.textContent).toContain('Downloaded. Not kept in .excalidraw: notes, 2 images that could not be loaded.');
  });

  it('disables all three export buttons while the build is pending, and ignores a second click', async () => {
    let release!: () => void;
    vi.mocked(buildExcalidraw).mockReturnValue(new Promise((resolve) => { release = () => resolve({ json: '{"type":"excalidraw"}', missingImages: 0 }); }));
    mount(fakeApi());
    act(() => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Excalidraw')!.click();
    });
    expect(exportButtons().every((b) => b.disabled)).toBe(true);
    act(() => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Excalidraw')!.click();
    });
    expect(buildExcalidraw).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(exportButtons().every((b) => b.disabled)).toBe(false);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('commits an open inline edit before building the file', async () => {
    mount(fakeApi());
    keydown({ key: 'F2' });
    type(container.querySelector('textarea.inline-editor') as HTMLTextAreaElement, 'Changed');
    await click('Excalidraw');
    expect(vi.mocked(buildExcalidraw).mock.calls.at(-1)![0].byId.get('root000001')!.lines.join(' ')).toContain('Changed');
    expect(container.querySelector('textarea.inline-editor')).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    expect(vi.mocked(download).mock.calls[0][1]).toBe('Changed.excalidraw'); // named from the text on screen, not the last saved title
  });

  it('includes an image whose upload finished during an edit that changed nothing', async () => {
    const { uploadImage, releases } = deferredUploads();
    mount(fakeApi({ uploadImage }));
    await chooseImage(new File(['x'], 'photo.png', { type: 'image/png' }));
    keydown({ key: 'F2' });
    await act(async () => {
      releases[0]();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.querySelector('image.topic-image')).toBeNull();
    await click('Excalidraw');
    expect(vi.mocked(buildExcalidraw).mock.calls.at(-1)![0].byId.get('root000001')!.node.image).toBeDefined();
  });

  it('includes a note still waiting for its pause', async () => {
    mount(fakeApi());
    const note = container.querySelector('textarea[aria-label="Note"]') as HTMLTextAreaElement;
    act(() => note.focus());
    type(note, 'Remember');
    await click('Excalidraw');
    const banners = [...container.querySelectorAll('[role="status"]')].map((e) => e.textContent); // the save badge is a status too
    expect(banners.some((t) => t?.startsWith('Downloaded. Not kept in .excalidraw: notes.'))).toBe(true);
  });

  it('SVG export takes the same path', async () => {
    mount(fakeApi());
    keydown({ key: 'F2' });
    type(container.querySelector('textarea.inline-editor') as HTMLTextAreaElement, 'Changed');
    await click('SVG');
    expect(vi.mocked(buildSvg).mock.calls.at(-1)![0].byId.get('root000001')!.lines.join(' ')).toContain('Changed');
  });

  it('shows "Export failed: boom" and re-enables the buttons when buildExcalidraw rejects', async () => {
    vi.mocked(buildExcalidraw).mockRejectedValue(new Error('boom'));
    mount(fakeApi());
    await click('Excalidraw');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Export failed: boom');
    expect(exportButtons().every((b) => b.disabled)).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('Editor: several topics selected', () => {
  const three: MindMap = {
    ...map,
    root: { id: 'root000001', text: 'Root', children: [{ id: 'kidA000001', text: 'Alpha', children: [] }, { id: 'kidB000001', text: 'Beta', children: [] }] },
  };
  const selectedOnScreen = () => [...container.querySelectorAll('g.topic.selected')].map((g) => g.getAttribute('data-id')).sort();
  const hitOf = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;
  const pointer = (el: Element, type: string, init: MouseEventInit = {}) =>
    act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 5, clientY: 5, ...init })));
  const click = (id: string, init: MouseEventInit = {}) => {
    pointer(hitOf(id), 'pointerdown', init);
    pointer(hitOf(id), 'pointerup', init);
  };
  const panel = () => container.querySelector('[aria-label="Topic details"]')!;

  it('⌘A selects every topic, Delete removes all but the central one as one step, and ⌘Z brings them back', () => {
    mount(fakeApi(), three);
    keydown({ key: 'a', metaKey: true });
    expect(selectedOnScreen()).toEqual(['kidA000001', 'kidB000001', 'root000001']);
    keydown({ key: 'Delete' });
    expect(container.querySelectorAll('g.topic')).toHaveLength(1);
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelectorAll('g.topic')).toHaveLength(3);
  });

  it('Shift-click adds a topic; the panel then covers them all, and a priority goes to each', () => {
    mount(fakeApi(), three);
    click('kidA000001');
    click('kidB000001', { shiftKey: true });
    expect(selectedOnScreen()).toEqual(['kidA000001', 'kidB000001']);
    expect(panel().querySelector('h2')!.textContent).toBe('2 topics selected');
    expect(panel().querySelector('[aria-label="Note"]')).toBeNull();
    expect(panel().querySelector('[aria-label="Image file"]')).toBeNull();
    act(() => (panel().querySelector('[aria-label="Priority 2"]') as HTMLButtonElement).click());
    expect([...container.querySelectorAll('g.badge text')].map((t) => t.textContent)).toEqual(['2', '2']);
    expect(selectedOnScreen()).toEqual(['kidA000001', 'kidB000001']);
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelectorAll('g.badge')).toHaveLength(0);
  });

  it('Shift-click on a selected topic takes it out again', () => {
    mount(fakeApi(), three);
    click('kidA000001');
    click('kidB000001', { shiftKey: true });
    click('kidA000001', { shiftKey: true });
    expect(selectedOnScreen()).toEqual(['kidB000001']);
    expect(panel().querySelector('h2')!.textContent).toBe('Topic details');
  });

  it('Escape, a plain click on a topic, and a click on the background go back to one selected topic', () => {
    mount(fakeApi(), three);
    keydown({ key: 'a', metaKey: true });
    keydown({ key: 'Escape' });
    expect(selectedOnScreen()).toEqual(['root000001']);
    keydown({ key: 'a', metaKey: true });
    click('kidB000001');
    expect(selectedOnScreen()).toEqual(['kidB000001']);
    keydown({ key: 'a', metaKey: true });
    const svg = container.querySelector('.canvas svg')!;
    pointer(svg, 'pointerdown', { clientX: 4000, clientY: 4000 });
    pointer(svg, 'pointerup', { clientX: 4000, clientY: 4000 });
    expect(selectedOnScreen()).toEqual(['kidB000001']);
  });

  it('Tab on several selected topics adds the child to the current one and selects only the new topic', () => {
    mount(fakeApi(), three);
    click('kidA000001');
    click('kidB000001', { shiftKey: true }); // Beta is now the current topic
    keydown({ key: 'Tab' });
    expect(container.querySelectorAll('g.topic')).toHaveLength(4);
    expect(selectedOnScreen()).toHaveLength(1);
    type(container.querySelector('textarea')!, 'Child');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    act(() => ([...container.querySelectorAll('button')].find((b) => b.textContent === 'Outline') as HTMLButtonElement).click());
    const outline = (container.querySelector('textarea[aria-label="Outline text"]') as HTMLTextAreaElement).value;
    expect(outline).toMatch(/- Alpha\n- Beta\n {2}- Child\n/);
  });

  it('the Delete button is offered when the central topic is the current one but other topics are selected with it', () => {
    mount(fakeApi(), three);
    const del = () => container.querySelector('button[title^="Delete topic"]') as HTMLButtonElement;
    expect(del().disabled).toBe(true); // the central topic alone can't be deleted
    keydown({ key: 'a', metaKey: true }); // the central topic stays the current one
    expect(panel().querySelector('h2')!.textContent).toBe('3 topics selected');
    expect(del().disabled).toBe(false);
    act(() => del().click());
    expect(container.querySelectorAll('g.topic')).toHaveLength(1);
  });
});

describe('getting into the editor', () => {
  const stored = { ...map, root: { id: 'root000001', text: 'Root', children: [{ id: 'kidA000001', text: 'Alpha', children: [] }] } };
  /** A server that knows one map. `session` is what /api/session answers. */
  /** Saves are refused (401), as when a session has ended. */
  function stubServer(session: object | (() => Response)) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      if (url === '/api/session') return typeof session === 'function' ? session() : Response.json(session);
      if (init.method === 'PUT') return Response.json({ error: 'Unauthorized' }, { status: 401 });
      return new Response(JSON.stringify(stored), { headers: { ETag: '"e1"' } });
    }));
    return calls;
  }
  async function editAndWait() {
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'A');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await act(async () => {});
  }

  it('opened with a Google session, a refused save offers Google again at once', async () => {
    stubServer({ signedIn: true, email: 'me@example.com', google: true });
    await open();
    await editAndWait();
    const dialog = container.querySelector('.dialog-backdrop')!;
    expect(dialog.querySelector('a.google-button')).not.toBeNull();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toMatch(/^Your sign-in has ended\./);
  });

  it('opened with the owner key on a site that offers Google, a refused key offers Google as well as the key', async () => {
    localStorage.setItem('sketchmap:owner-key', 'old-key');
    const calls = stubServer({ signedIn: false, email: null, google: true });
    await open();
    await editAndWait();
    const dialog = container.querySelector('.dialog-backdrop')!;
    expect(calls).toContain('GET /api/session');
    expect(dialog.querySelector('a.google-button')).not.toBeNull();
    expect(dialog.querySelector('#owner-key')).not.toBeNull();
    expect(dialog.querySelector('[role="alert"]')!.textContent).toMatch(/^The owner key was rejected\./);
  });

  it('when the sign-in check cannot reach the server, says so and offers Try again, which opens the map once it answers', async () => {
    let up = false;
    stubServer(() => (up ? Response.json({ signedIn: true, email: 'me@example.com', google: true }) : Response.json({ error: 'Bad gateway' }, { status: 502 })));
    await open();
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/Couldn’t reach the server/);
    up = true;
    const retry = container.querySelector('button.retry') as HTMLButtonElement;
    await act(async () => retry.click());
    await act(async () => {});
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
  });
  async function open() {
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => rootIn(container).render(<EditorPage id={stored.id} />));
    await act(async () => {});
    await act(async () => {});
  }
  afterEach(() => vi.unstubAllGlobals());

  it('with a Google session and no key, opens the map', async () => {
    const calls = stubServer({ signedIn: true, email: 'me@example.com', google: true });
    await open();
    expect(calls.slice(0, 2)).toEqual(['GET /api/session', `GET /api/maps/${stored.id}`]);
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
  });

  it('signed out, offers Google with this map as the page to come back to, and loads nothing', async () => {
    const calls = stubServer({ signedIn: false, email: null, google: true });
    await open();
    expect((container.querySelector('a.google-button') as HTMLAnchorElement).getAttribute('href')).toBe(`/auth/google?next=%2Fe%2F${stored.id}`);
    expect(calls).toEqual(['GET /api/session']);
  });

  it('with a stored key, opens the map at once without asking about a session', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubServer({ signedIn: false, email: null, google: true });
    await open();
    expect(calls).toEqual([`GET /api/maps/${stored.id}`]);
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
  });

  describe('when a save is refused in a Google session', () => {
    const refusing = () => fakeApi({ saveMap: vi.fn(async () => { throw new ApiError(401, 'Unauthorized'); }) });
    async function editAndBeRefused(storage?: Storage) {
      container = document.createElement('div');
      document.body.appendChild(container);
      act(() => rootIn(container).render(<Editor initial={map} etag={'"e1"'} api={refusing()} measureFactory={measure} googleSession storage={storage} />));
      keydown({ key: 'Tab' });
      type(container.querySelector('textarea')!, 'A');
      keydown({ key: 'Enter' }, container.querySelector('textarea')!);
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      return container.querySelector('.dialog-backdrop')!;
    }
    /** Whether the browser would ask "Leave site?". */
    const leaveWarning = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    const follow = (link: Element) => {
      link.addEventListener('click', (e) => e.preventDefault()); // jsdom has no navigation
      act(() => void link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    };
    beforeEach(() => vi.useFakeTimers());

    it('the dialog offers Google at once, back to this map, and says the changes are kept; following the link then raises no "Leave site?"', async () => {
      const dialog = await editAndBeRefused();
      const link = dialog.querySelector('a.google-button') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`/auth/google?next=%2Fe%2F${map.id}`);
      expect(dialog.querySelector('[role="alert"]')!.textContent).toMatch(/^Your sign-in has ended\. Sign in again to keep saving\. Your changes are kept in this browser/);
      expect(dialog.querySelector('#owner-key')).not.toBeNull();
      expect(leaveWarning()).toBe(true); // unsaved work, and nobody is leaving on purpose yet
      follow(link);
      expect(leaveWarning()).toBe(false);
    });

    it('when this browser kept only an older copy (it filled up), says the changes are not kept, and leaving still warns', async () => {
      // The first draft (the new, still empty topic) is written; then storage is full and the text "A" is not.
      const data = new Map<string, string>();
      const full = {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => { if (data.size > 0) throw new Error('quota'); data.set(k, v); },
        removeItem: (k: string) => void data.delete(k), clear: () => data.clear(), key: () => null, get length() { return data.size; },
      } as Storage;
      const dialog = await editAndBeRefused(full);
      expect(data.size).toBe(1); // an older copy is there
      expect(dialog.querySelector('[role="alert"]')!.textContent).toMatch(/could not keep a copy of your changes\. Copy what you need first/);
      follow(dialog.querySelector('a.google-button')!);
      expect(leaveWarning()).toBe(true);
    });

    it('opening Google in a new tab (⌘/Ctrl-click) leaves the warning in place, and so does staying after all', async () => {
      const dialog = await editAndBeRefused();
      const link = dialog.querySelector('a.google-button')!;
      link.addEventListener('click', (e) => e.preventDefault());
      act(() => void link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })));
      expect(leaveWarning()).toBe(true);
      follow(link);
      expect(leaveWarning()).toBe(false);
      // Back to the key instead: the dialog closes, and the page warns again while changes are unsaved.
      typeInput(dialog.querySelector('#owner-key') as HTMLInputElement, 'k');
      act(() => void dialog.querySelector('.key-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      expect(leaveWarning()).toBe(true);
    });

    it('when this browser could not keep any copy, says so instead, and leaving still warns', async () => {
      const blocked = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
      const dialog = await editAndBeRefused(blocked);
      expect(dialog.querySelector('[role="alert"]')!.textContent).toMatch(/could not keep a copy of your changes\. Copy what you need first/);
      follow(dialog.querySelector('a.google-button')!);
      expect(leaveWarning()).toBe(true);
    });
  });
});
