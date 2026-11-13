import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import { serveImage } from '../images';
import type { MindMap } from '../../src/shared/types';

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

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const upload = (id: string, body: BodyInit, key: string | null = KEY, type = 'image/png') =>
  call(`/api/maps/${id}/images`, { method: 'POST', body, headers: { 'Content-Type': type } }, key);

describe('images API', () => {
  it('stores an image under the map, serves it publicly with long caching, and refuses strangers', async () => {
    const { map } = await create();
    expect((await upload(map.id, PNG, null)).status).toBe(401);
    const res = await upload(map.id, PNG);
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    expect(key).toMatch(/^img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{10}\.png$/);
    expect(key).not.toContain(map.id);
    const img = await worker.fetch(new Request(`http://x/${key}`), E);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(img.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(img.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(img.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it('checks the type from the bytes, not the header; refuses SVG, text and anything over 5 MB', async () => {
    const { map } = await create();
    expect((await upload(map.id, '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', KEY, 'image/png')).status).toBe(415);
    expect((await upload(map.id, 'hello', KEY, 'image/jpeg')).status).toBe(415);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(map.id, big)).status).toBe(413);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(((await (await upload(map.id, jpeg, KEY, 'text/plain')).json()) as { key: string }).key).toMatch(/\.jpg$/);
  });

  it('needs an existing map, and serves 404 for unknown or malformed image paths', async () => {
    expect((await upload('abcdefghijklmnopqrstu', PNG)).status).toBe(404);
    for (const p of ['/img/nope', '/img/abcdefghijklmnopqrstu/x.svg', '/img/abcdefghijklmnopqrstu/missing.png', '/img/abcdefghijklmnopqrstu/a/b.png']) {
      const r = await worker.fetch(new Request(`http://x${p}`), E);
      expect(r.status, p).toBe(404);
    }
  });

  it(`deletes a map's images with the map, and never lists images as maps`, async () => {
    const { map } = await create('With image');
    const { key } = (await (await upload(map.id, PNG)).json()) as { key: string };
    const list = (await (await call('/api/maps')).json()) as Array<{ id: string }>;
    expect(list.every((m) => !m.id.includes('/'))).toBe(true);
    expect((await call(`/api/maps/${map.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await worker.fetch(new Request(`http://x/${key}`), E)).status).toBe(404);
  });

  it('also deletes a legacy image stored directly under img/<mapId>/ when the map is deleted', async () => {
    const { map } = await create('Legacy image');
    const key = `img/${map.id}/legacy.png`;
    await E.MAPS.put(key, PNG, { httpMetadata: { contentType: 'image/png' } });
    expect((await worker.fetch(new Request(`http://x/${key}`), E)).status).toBe(200);
    expect((await call(`/api/maps/${map.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await worker.fetch(new Request(`http://x/${key}`), E)).status).toBe(404);
  });
});

describe('images API, edges', () => {
  it('refuses a body over 5 MB even without a Content-Length, by counting while it reads', async () => {
    const { map } = await create();
    const chunk = new Uint8Array(1024 * 1024);
    chunk.set(PNG);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 6) return c.close();
        sent++;
        c.enqueue(chunk.slice());
      },
    });
    const req = new Request(`http://x/api/maps/${map.id}/images`, { method: 'POST', body, headers: { Authorization: `Bearer ${KEY}` }, duplex: 'half' } as RequestInit);
    expect((await worker.fetch(req, E)).status).toBe(413);
  });

  it('answers 405 for other methods, serves HEAD, and never serves a path outside img/', async () => {
    const { map } = await create();
    for (const method of ['GET', 'PUT', 'DELETE']) expect((await call(`/api/maps/${map.id}/images`, { method })).status, method).toBe(405);
    const { key } = (await (await upload(map.id, PNG)).json()) as { key: string };
    const head = await worker.fetch(new Request(`http://x/${key}`, { method: 'HEAD' }), E);
    expect(head.status).toBe(200);
    expect((await worker.fetch(new Request(`http://x/${key}`, { method: 'POST' }), E)).status).toBe(405);
    expect((await serveImage('/img/../maps/x.json', E)).status).toBe(404);
    expect((await serveImage(`/maps/${map.id}.json`, E)).status).toBe(404);
  });

  it('never serves the private imgindex, directly or through a traversal', async () => {
    expect((await serveImage('/imgindex/x/y/z.png', E)).status).toBe(404);
    expect((await serveImage('/img/../imgindex/x/y/z.png', E)).status).toBe(404);
  });
});
