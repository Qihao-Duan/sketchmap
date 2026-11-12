import { describe, expect, it } from 'vitest';
import type { MindMap } from '../shared/types';
import { ApiError, createApi } from './client';

const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'T', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'T', children: [] } };

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
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
    const err = await createApi(() => 'k', impl).listMaps().catch((e) => e);
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
});
