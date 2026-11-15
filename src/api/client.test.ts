import { describe, expect, it } from 'vitest';
import type { MindMap } from '../shared/types';
import { ApiError, createApi, GET_RETRY_DELAY_MS } from './client';

const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'T', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'T', children: [] } };

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const noSleep = async () => {};
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe('api client', () => {
  it('reads maps without the owner key and returns the ETag', async () => {
    const f = fakeFetch(() => Response.json(map, { headers: { ETag: '"e1"' } }));
    const res = await createApi(() => 'k', f.impl).getMap(map.id);
    expect(res).toEqual({ map, etag: '"e1"' });
    expect(f.calls[0].url).toBe(`/api/maps/${map.id}`);
    expect(header(f.calls[0].init, 'Authorization')).toBeNull();
  });

  it('saves with the owner key, If-Match and a JSON body', async () => {
    const f = fakeFetch(() => Response.json({ ...map, version: 2 }, { headers: { ETag: '"e2"' } }));
    const res = await createApi(() => 'k', f.impl).saveMap(map, '"e1"');
    const init = f.calls[0].init;
    expect([init.method, header(init, 'Authorization'), header(init, 'If-Match'), header(init, 'Content-Type')])
      .toEqual(['PUT', 'Bearer k', '"e1"', 'application/json']);
    expect(JSON.parse(init.body as string)).toEqual(map);
    expect(res.etag).toBe('"e2"');
  });

  it('turns error responses into ApiError with status, message and current ETag', async () => {
    const f = fakeFetch(() => Response.json({ error: 'The map changed since you loaded it' }, { status: 409, headers: { ETag: '"e9"' } }));
    const err = await createApi(() => 'k', f.impl).saveMap(map, '"e1"').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.message, err.etag]).toEqual([409, 'The map changed since you loaded it', '"e9"']);
  });

  it('reports network failures as status 0', async () => {
    const impl = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const err = await createApi(() => 'k', impl, '', noSleep).listMaps().catch((e) => e);
    expect([err instanceof ApiError, err.status]).toEqual([true, 0]);
  });

  it('creates and deletes maps with the owner key', async () => {
    const f = fakeFetch((_u, init) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(map, { status: 201, headers: { ETag: '"e1"' } })));
    const api = createApi(() => 'k', f.impl);
    await api.createMap('Plan');
    await api.deleteMap(map.id);
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ title: 'Plan' });
    expect(f.calls.map((c) => [c.init.method, header(c.init, 'Authorization')])).toEqual([['POST', 'Bearer k'], ['DELETE', 'Bearer k']]);
  });

  it('uploads an image, posting the blob with its own Content-Type and the owner key', async () => {
    const f = fakeFetch(() => Response.json({ key: `img/${map.id}/abc.png` }));
    const blob = new Blob(['x'], { type: 'image/png' });
    const res = await createApi(() => 'k', f.impl).uploadImage(map.id, blob);
    const init = f.calls[0].init;
    expect(f.calls[0].url).toBe(`/api/maps/${map.id}/images`);
    expect([init.method, header(init, 'Content-Type'), header(init, 'Authorization')]).toEqual(['POST', 'image/png', 'Bearer k']);
    expect(init.body).toBe(blob);
    expect(res).toEqual({ key: `img/${map.id}/abc.png` });
  });

  it('saves the site theme with the owner key, as JSON, and does not repeat a failed save', async () => {
    let calls = 0;
    const f = fakeFetch(() => (++calls === 1 ? Response.json({ theme: 'dark' }) : Response.json({ error: 'Internal error' }, { status: 500 })));
    const api = createApi(() => 'k', f.impl, '', noSleep);
    await api.saveTheme('dark');
    const init = f.calls[0].init;
    expect([f.calls[0].url, init.method, header(init, 'Authorization'), header(init, 'Content-Type')]).toEqual(['/api/settings', 'PUT', 'Bearer k', 'application/json']);
    expect(JSON.parse(init.body as string)).toEqual({ theme: 'dark' });
    await expect(api.saveTheme('system')).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(2);
  });

  it('tries a failed read once more: after a network error, and after a server error', async () => {
    const body = { id: 'abcdefghijklmnopqrstu' };
    for (const first of [() => Promise.reject(new TypeError('failed to fetch')), async () => new Response('{"error":"Internal error"}', { status: 500 })]) {
      let calls = 0;
      const fetchImpl = (async () => (++calls === 1 ? first() : new Response(JSON.stringify(body), { headers: { ETag: '"e1"' } }))) as typeof fetch;
      const waits: number[] = [];
      const api = createApi(() => null, fetchImpl, '', async (ms) => void waits.push(ms));
      await expect(api.getMap('abcdefghijklmnopqrstu')).resolves.toEqual({ map: body, etag: '"e1"' });
      expect(calls).toBe(2);
      expect(waits).toEqual([GET_RETRY_DELAY_MS]);
    }
  });

  it('gives up after the second failed read, with the second error', async () => {
    let calls = 0;
    const fetchImpl = (async () => new Response(JSON.stringify({ error: `boom ${++calls}` }), { status: 503 })) as typeof fetch;
    const api = createApi(() => 'k', fetchImpl, '', noSleep);
    await expect(api.listMaps()).rejects.toMatchObject({ status: 503, message: 'boom 2' });
    expect(calls).toBe(2);
  });

  it('does not retry a read the server refused (4xx), nor any write', async () => {
    let calls = 0;
    const notFound = (async () => (calls++, new Response('{"error":"Not found"}', { status: 404 }))) as typeof fetch;
    await expect(createApi(() => null, notFound, '', noSleep).getMap('x')).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);

    calls = 0;
    const down = (async () => (calls++, new Response('{"error":"Internal error"}', { status: 500 }))) as typeof fetch;
    const api = createApi(() => 'k', down, '', noSleep);
    await expect(api.saveMap(map, '"e"')).rejects.toMatchObject({ status: 500 });
    await expect(api.createMap()).rejects.toMatchObject({ status: 500 });
    await expect(api.deleteMap('x')).rejects.toMatchObject({ status: 500 });
    await expect(api.uploadImage('x', new Blob(['i']))).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(4);
  });
});
