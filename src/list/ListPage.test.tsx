// @vitest-environment jsdom
import { act, StrictMode } from 'react';
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

/** `session`: what /api/session answers. `listStatus`: the status of the map list (401 = key or session refused). */
type Stub = { session?: object | (() => object | Response); listStatus?: number; logout?: () => Response };
function stubApi({ session = { signedIn: false, email: null, google: false }, listStatus = 200, logout }: Stub = {}) {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push([method, url]);
    if (url === '/api/session') {
      const answer = typeof session === 'function' ? session() : session;
      return answer instanceof Response ? answer : Response.json(answer);
    }
    if (url === '/auth/logout') {
      if (logout) return logout();
      if (typeof session !== 'function') Object.assign(session, { signedIn: false, email: null });
      return new Response(null, { status: 204 });
    }
    if (url === '/api/maps' && method === 'GET' && listStatus !== 200) return Response.json({ error: 'Unauthorized' }, { status: listStatus });
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

  it('with a Google session and no key, goes straight to the maps, names the account, and signs out on request', async () => {
    const calls = stubApi({ session: { signedIn: true, email: 'me@example.com', google: true } });
    await render();
    expect(container.querySelector('#owner-key')).toBeNull();
    expect(container.textContent).toContain('Weekly plan');
    expect(container.querySelector('.account')!.textContent).toBe('me@example.com');
    expect(calls.find(([, url]) => url === '/api/maps')).toBeTruthy();
    await click('Sign out');
    await act(async () => {});
    expect(calls).toContainEqual(['POST', '/auth/logout']);
    expect(container.textContent).not.toContain('Weekly plan');
    expect((container.querySelector('a.google-button') as HTMLAnchorElement).getAttribute('href')).toBe('/auth/google?next=%2F');
  });

  it.each([
    ['the server answers with an error', () => Response.json({ error: 'Internal error' }, { status: 500 })],
    ['there is no connection', () => { throw new TypeError('offline'); }],
  ])('when signing out is not confirmed (%s), stays signed in and says so', async (_name, logout) => {
    const calls = stubApi({ session: { signedIn: true, email: 'me@example.com', google: true }, logout: logout as () => Response });
    await render();
    await click('Sign out');
    await act(async () => {});
    expect(calls).toContainEqual(['POST', '/auth/logout']);
    expect(container.textContent).toContain('Weekly plan');
    expect(container.querySelector('.account')!.textContent).toBe('me@example.com');
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/Couldn’t sign out.*still signed in/);
  });

  it('when the server cannot be asked, says so and offers to try again, which works once it answers', async () => {
    let up = false;
    stubApi({ session: () => (up ? { signedIn: true, email: 'me@example.com', google: true } : Response.json({ error: 'Internal error' }, { status: 503 })) });
    await render();
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/Couldn’t reach the server/);
    expect(container.textContent).not.toContain('Weekly plan');
    up = true;
    await click('Try again');
    await act(async () => {});
    expect(container.textContent).toContain('Weekly plan');
  });

  it('a server that says "signed in" but refuses the list ends at the sign-in page, not in a loop', async () => {
    const calls = stubApi({ session: { signedIn: true, email: 'me@example.com', google: true }, listStatus: 401 });
    await render();
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Your sign-in has ended. Sign in again.');
    expect(container.querySelector('a.google-button')).not.toBeNull();
    expect(calls.filter(([, url]) => url === '/api/session')).toHaveLength(2);
    expect(calls.filter(([, url]) => url === '/api/maps')).toHaveLength(1);
  });

  describe('in development, where React runs every effect twice', () => {
    const renderStrict = async () => {
      container = document.createElement('div');
      document.body.appendChild(container);
      await act(async () => createRoot(container).render(<StrictMode><ListPage go={vi.fn()} /></StrictMode>));
      for (let i = 0; i < 4; i++) await act(async () => {});
    };

    it('still says why a Google sign-in failed', async () => {
      history.replaceState(null, '', '/?signin=notallowed');
      try {
        stubApi({ session: { signedIn: false, email: null, google: true } });
        await renderStrict();
        expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
        expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/isn’t allowed to edit/);
        expect(location.search).toBe('');
      } finally {
        history.replaceState(null, '', '/');
      }
    });

    it('two refusals of a stored key still blame the key, not a sign-in that never was', async () => {
      localStorage.setItem('sketchmap:owner-key', 'old-key');
      const calls = stubApi({ listStatus: 401 });
      await renderStrict();
      expect(calls.filter(([, url]) => url === '/api/maps').length).toBeGreaterThanOrEqual(2);
      expect(container.querySelector('[role="alert"]')!.textContent).toBe('That owner key was rejected. Check it and try again.');
    });
  });

  it('signed out, where Google is offered: shows the Google link and asks for no maps', async () => {
    const calls = stubApi({ session: { signedIn: false, email: null, google: true } });
    await render();
    expect(container.querySelector('a.google-button')).not.toBeNull();
    expect(container.querySelector('#owner-key')).not.toBeNull(); // the owner key stays available
    expect(calls.some(([, url]) => url === '/api/maps')).toBe(false);
  });

  it('says why a Google sign-in failed, once, and tidies the address', async () => {
    history.replaceState(null, '', '/?signin=notallowed');
    try {
      stubApi({ session: { signedIn: false, email: null, google: true } });
      await render();
      expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/isn’t allowed to edit/);
      expect(location.pathname + location.search).toBe('/');
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('when a stored key is refused, forgets it and shows the sign-in page with the reason', async () => {
    localStorage.setItem('sketchmap:owner-key', 'old-key');
    stubApi({ listStatus: 401 });
    await render();
    await act(async () => {});
    expect(localStorage.getItem('sketchmap:owner-key')).toBeNull();
    expect(container.querySelector('#owner-key')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('That owner key was rejected. Check it and try again.');
  });

  it('when a Google session has ended, says so and offers Google again', async () => {
    // The cookie runs out between the first look (signed in) and the map list (refused): the second look says so.
    let looks = 0;
    stubApi({ session: () => ({ signedIn: ++looks === 1, email: looks === 1 ? 'me@example.com' : null, google: true }), listStatus: 401 });
    await render();
    await act(async () => {});
    expect(looks).toBe(2);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Your sign-in has ended. Sign in again.');
    expect(container.querySelector('a.google-button')).not.toBeNull();
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

  it('one oversized image resource fails only itself; the other image is still added', async () => {
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
      { name: 'content.json', deflate: false, data: JSON.stringify([{ id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Trip', children: { attached: [
        { id: 'a', title: 'Good', image: { src: 'xap:resources/a.png' } },
        { id: 'b', title: 'Huge', image: { src: 'xap:resources/b.png' } },
      ] } } }]) },
      { name: 'resources/a.png', deflate: false, data: new Uint8Array([1, 2, 3]) },
      { name: 'resources/b.png', deflate: false, data: new Uint8Array([4, 5, 6]) },
    ]);
    // Claim resources/b.png is 2 GB uncompressed, so reading it (alone) is refused.
    const v = new DataView(xmind.buffer, xmind.byteOffset);
    const cdStart = v.getUint32(xmind.length - 22 + 16, true);
    const dec = new TextDecoder();
    for (let p = cdStart; p < xmind.length - 22; ) {
      const nameLen = v.getUint16(p + 28, true);
      if (dec.decode(xmind.subarray(p + 46, p + 46 + nameLen)) === 'resources/b.png') v.setUint32(p + 24, 0x7fffffff, true);
      p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind] as BlobPart[], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    expect(calls.filter(([m, u]) => m === 'POST' && u.endsWith('/images'))).toHaveLength(1);
    expect(saved[0]).toMatchObject({ root: { children: [{ text: 'Good', image: { key: stubKey } }, { text: 'Huge' }] } });
    expect(container.querySelector('.import-result')!.textContent).toContain('1 image could not be added');
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
