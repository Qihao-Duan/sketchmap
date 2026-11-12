import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import type { MapSummary, MindMap } from '../../src/shared/types';

const E = env as unknown as Env;
const KEY = 'test-owner-key';

function call(path: string, init: RequestInit = {}, key: string | null = KEY) {
  const headers = new Headers(init.headers);
  if (key !== null) headers.set('Authorization', `Bearer ${key}`);
  return worker.fetch(new Request(`http://x${path}`, { ...init, headers }), E);
}
async function create(title = 'Plan') {
  const res = await call('/api/maps', { method: 'POST', body: JSON.stringify({ title }) });
  return { res, map: (await res.json()) as MindMap, etag: res.headers.get('ETag')! };
}
const put = (map: MindMap, etag: string | null, key: string | null = KEY) =>
  call(`/api/maps/${map.id}`, { method: 'PUT', body: JSON.stringify(map), headers: etag ? { 'If-Match': etag } : {} }, key);

describe('maps API', () => {
  it('refuses to create or list without the right owner key', async () => {
    expect((await call('/api/maps', { method: 'POST' }, null)).status).toBe(401);
    expect((await call('/api/maps', { method: 'POST' }, 'wrong')).status).toBe(401);
    expect((await call('/api/maps', { method: 'POST' }, 'x'.repeat(KEY.length))).status).toBe(401);
    const res = await call('/api/maps', {}, null);
    expect([res.status, await res.json()]).toEqual([401, { error: 'Unauthorized' }]);
  });

  it('creates a map with version 1, an ETag and no-store caching', async () => {
    const { res, map, etag } = await create('Weekly plan');
    expect(res.status).toBe(201);
    expect(etag).toBeTruthy();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(map).toMatchObject({ title: 'Weekly plan', layout: 'map', version: 1, root: { text: 'Weekly plan', children: [] } });
    expect(map.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it('lets anyone read a map by id, and 404s unknown or malformed ids', async () => {
    const { map, etag } = await create();
    const res = await call(`/api/maps/${map.id}`, {}, null);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(etag);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(map);
    expect((await call('/api/maps/aaaaaaaaaaaaaaaaaaaaa', {}, null)).status).toBe(404);
    expect((await call('/api/maps/not-an-id', {}, null)).status).toBe(404);
  });

  it('saves with If-Match: bumps version, recomputes title, returns a new ETag', async () => {
    const { map, etag } = await create();
    const edited: MindMap = { ...map, title: 'ignored', root: { ...map.root, text: 'Renamed\nsecond line', children: [{ id: 'child00001', text: 'A', children: [] }] } };
    const res = await put(edited, etag);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as MindMap;
    expect([saved.version, saved.title, saved.root.children.length]).toEqual([2, 'Renamed', 1]);
    expect(res.headers.get('ETag')).not.toBe(etag);
  });

  it('answers 428 without If-Match and 409 with a stale ETag', async () => {
    const { map, etag } = await create();
    expect((await put(map, null)).status).toBe(428);
    const first = await put(map, etag);
    expect(first.status).toBe(200);
    const stale = await put(map, etag);
    expect(stale.status).toBe(409);
    expect(stale.headers.get('ETag')).toBe(first.headers.get('ETag'));
  });

  it('rejects invalid bodies, mismatched ids and maps over 2 MB', async () => {
    const { map, etag } = await create();
    const bad = await call(`/api/maps/${map.id}`, { method: 'PUT', body: '{"nope":1}', headers: { 'If-Match': etag } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/id|layout|root/);
    expect(
      (
        await call(`/api/maps/${map.id}`, {
          method: 'PUT',
          body: JSON.stringify({ ...map, id: 'bbbbbbbbbbbbbbbbbbbbb' }),
          headers: { 'If-Match': etag },
        })
      ).status,
    ).toBe(400);
    const huge = { ...map, root: { ...map.root, note: 'x'.repeat(10) } } as MindMap & { pad?: string };
    const body = JSON.stringify(huge).replace('"layout"', `"pad":"${'x'.repeat(2_000_001)}","layout"`);
    const big = await call(`/api/maps/${map.id}`, { method: 'PUT', body, headers: { 'If-Match': etag } });
    expect(big.status).toBe(413);
  });

  it('lists maps newest first and deletes them', async () => {
    const a = await create('Alpha');
    const b = await create('Beta');
    const list = (await (await call('/api/maps')).json()) as MapSummary[];
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([a.map.id, b.map.id]));
    const times = list.map((s) => s.updatedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(list.find((s) => s.id === b.map.id)?.title).toBe('Beta');
    expect((await call(`/api/maps/${a.map.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/maps/${a.map.id}`, {}, null)).status).toBe(404);
  });
});
