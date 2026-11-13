// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImage } from '../io/imagePrep';
import { makeZip } from '../test/zipFixture';
import { ListPage } from './ListPage';

// jsdom can't decode images (createImageBitmap/OffscreenCanvas aren't implemented): stub prepareImage,
// keeping the real displaySize/IMAGE_SIZES so the rest of the image flow behaves like production.
vi.mock('../io/imagePrep', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../io/imagePrep')>();
  return { ...actual, prepareImage: vi.fn() };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = 'abcdefghijklmnopqrstu';
let container: HTMLDivElement;
const render = async (go = vi.fn()) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<ListPage go={go} />));
  await act(async () => {});
  return go;
};
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); });

const stubKey = `img/${id}/stub.png`;

function stubApi() {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push([method, url]);
    if (method === 'POST' && url.endsWith('/images')) return Response.json({ key: stubKey });
    if (method === 'POST') return Response.json({ id, title: 'Central topic', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'Central topic', children: [] } }, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json([{ id, title: 'Weekly plan', updatedAt: '2026-11-12T10:00:00.000Z' }]);
  }));
  return calls;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(prepareImage).mockReset();
  vi.mocked(prepareImage).mockResolvedValue({ blob: new Blob(['x'], { type: 'image/png' }), width: 200, height: 100 });
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

describe('ListPage', () => {
  it('asks for the owner key first', async () => {
    stubApi();
    await render();
    expect(container.querySelector('#owner-key')).not.toBeNull();
  });

  it('lists maps and opens a new one after creating it', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const go = await render();
    expect(container.textContent).toContain('Weekly plan');
    expect(container.querySelector(`a[href="/e/${id}"]`)).not.toBeNull();
    await click('New map');
    expect(calls).toContainEqual(['POST', '/api/maps']);
    expect(go).toHaveBeenCalledWith(`/e/${id}`);
  });

  it('deletes only after the in-page confirmation', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    await render();
    await click('Delete…');
    expect(calls.some(([m]) => m === 'DELETE')).toBe(false);
    await click('Delete');
    expect(calls).toContainEqual(['DELETE', `/api/maps/${id}`]);
  });

  it('imports an .xmind file as a new map and says what it left out', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const saved: unknown[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT') {
        saved.push(JSON.parse(String(init.body)));
        return Response.json(JSON.parse(String(init.body)), { headers: { ETag: '"e2"' } });
      }
      return base(url, init);
    });
    await render();
    const xmind = await makeZip([{ name: 'content.json', deflate: false, data: JSON.stringify([
      {
        id: 's',
        class: 'sheet',
        title: 'S',
        rootTopic: {
          id: 'r',
          title: 'Trip',
          children: { attached: [{ id: 'a', title: 'Pack' }], detached: [{ id: 'f', title: 'Loose' }] },
        },
        relationships: [{ id: 'x' }],
      },
    ]) }]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    expect(calls.map(([m]) => m)).toContain('POST');
    expect(saved[0]).toMatchObject({
      root: { text: 'Trip', children: [{ text: 'Pack' }, { text: 'Loose' }] },
      layout: 'map',
    });
    const status = container.querySelector('.import-result')!;
    expect(status.textContent).toContain('3 topics');
    expect(status.textContent).toContain('1 relationship');
    expect(status.textContent).toContain('Changed: 1 floating topic attached to the root');
    expect(status.querySelector('a')!.getAttribute('href')).toBe(`/e/${id}`);
  });

  it('imports an .xmind file\'s image: uploads the resource and stores its key on the topic', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const saved: unknown[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT') {
        saved.push(JSON.parse(String(init.body)));
        return Response.json(JSON.parse(String(init.body)), { headers: { ETag: '"e2"' } });
      }
      return base(url, init);
    });
    await render();
    const xmind = await makeZip([
      { name: 'content.json', deflate: false, data: JSON.stringify([
        {
          id: 's',
          class: 'sheet',
          title: 'S',
          rootTopic: {
            id: 'r',
            title: 'Trip',
            children: { attached: [{ id: 'a', title: 'Pack', image: { src: 'xap:resources/a.png' } }] },
          },
        },
      ]) },
      { name: 'resources/a.png', deflate: false, data: new Uint8Array([1, 2, 3]) },
    ]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    expect(calls).toContainEqual(['POST', `/api/maps/${id}/images`]);
    expect(saved[0]).toMatchObject({
      root: { text: 'Trip', children: [{ text: 'Pack', image: { key: stubKey, w: 200, h: 100 } }] },
    });
  });

  it('counts an .xmind image that could not be added, without failing the rest of the import', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    stubApi();
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT') return Response.json(JSON.parse(String(init.body)), { headers: { ETag: '"e2"' } });
      return base(url, init);
    });
    vi.mocked(prepareImage).mockRejectedValue(new Error('That image couldn’t be read.'));
    await render();
    const xmind = await makeZip([
      { name: 'content.json', deflate: false, data: JSON.stringify([
        {
          id: 's',
          class: 'sheet',
          title: 'S',
          rootTopic: {
            id: 'r',
            title: 'Trip',
            children: { attached: [{ id: 'a', title: 'Pack', image: { src: 'xap:resources/a.png' } }] },
          },
        },
      ]) },
      { name: 'resources/a.png', deflate: false, data: new Uint8Array([1, 2, 3]) },
    ]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    const status = container.querySelector('.import-result')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('1 image could not be added');
  });

  it('pluralises the topic count in the import summary, down to one', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    stubApi();
    await render();
    const xmind = await makeZip([{ name: 'content.json', deflate: false, data: JSON.stringify([
      { id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Solo' } },
    ]) }]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'solo.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    const status = container.querySelector('.import-result')!;
    expect(status.textContent).toContain('1 topic.');
    expect(status.textContent).not.toContain('1 topics');
  });

  it('deletes the created map and shows an error when saving the import fails', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT') return Response.json({ error: 'Nope' }, { status: 500 });
      return base(url, init);
    });
    await render();
    const xmind = await makeZip([{ name: 'content.json', deflate: false, data: JSON.stringify([
      { id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Trip' } },
    ]) }]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    expect(calls).toContainEqual(['DELETE', `/api/maps/${id}`]);
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(container.querySelector('.import-result')).toBeNull();
  });

  it('shows a busy, disabled button while an import is in flight, then re-enables it', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    stubApi();
    const base = vi.mocked(fetch).getMockImplementation()!;
    let releasePost!: (r: Response) => void;
    const pending = new Promise<Response>((resolve) => { releasePost = resolve; });
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if ((init.method ?? 'GET') === 'POST') return pending;
      return base(url, init);
    });
    await render();
    const xmind = await makeZip([{ name: 'content.json', deflate: false, data: JSON.stringify([
      { id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Trip' } },
    ]) }]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });

    const busy = button('Importing…');
    expect(busy).toBeDefined();
    expect(busy.disabled).toBe(true);

    await act(async () => {
      releasePost(Response.json({ id, title: 'Central topic', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'Central topic', children: [] } }, { status: 201 }));
      await pending;
    });
    await act(async () => {});

    const done = button('Import .xmind');
    expect(done).toBeDefined();
    expect(done.disabled).toBe(false);
  });
});
