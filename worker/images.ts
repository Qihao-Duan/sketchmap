import { newNodeId } from '../src/model/ids';
import { errorResponse, json } from './http';
import type { Env } from './index';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{21}$/;
import { IMAGE_KEY_RE as KEY_RE } from '../src/shared/types';
const NOT_FOUND_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8' };

/** The image type from its first bytes, never from the Content-Type header (spec §8). */
export function sniffImage(b: Uint8Array): { ext: 'png' | 'jpg' | 'webp' | 'gif'; type: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', type: 'image/png' };
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', type: 'image/jpeg' };
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: 'gif', type: 'image/gif' };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', type: 'image/webp' };
  return null;
}

/** Reads a request body, giving up past `max` bytes even when Content-Length is missing or wrong (no full buffering). */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** POST /api/maps/:id/images (owner only): stores one image under the map and returns its key. */
export async function uploadImage(mapId: string, request: Request, env: Env): Promise<Response> {
  if (!ID_RE.test(mapId)) return errorResponse(404, 'Not found');
  if (Number(request.headers.get('Content-Length') ?? '0') > IMAGE_MAX_BYTES) return errorResponse(413, 'Image is larger than 5 MB');
  if (!(await env.MAPS.head(`maps/${mapId}.json`))) return errorResponse(404, 'Not found');
  const bytes = await readCapped(request, IMAGE_MAX_BYTES);
  if (!bytes) return errorResponse(413, 'Image is larger than 5 MB');
  const kind = sniffImage(bytes);
  if (!kind) return errorResponse(415, 'Only PNG, JPEG, WebP and GIF images can be uploaded');
  const key = `img/${mapId}/${newNodeId()}.${kind.ext}`;
  await env.MAPS.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  return json({ key }, { status: 201 });
}

/** GET /img/<mapId>/<file>: public, cached for a year (keys never change), and inert even if opened directly. */
export async function serveImage(pathname: string, env: Env): Promise<Response> {
  const key = pathname.slice(1);
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  const obj = await env.MAPS.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ETag: obj.httpEtag,
    },
  });
}

/** Deletes every image stored for a map (spec §8: clean-up on map delete). */
export async function deleteImages(mapId: string, env: Env): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.MAPS.list({ prefix: `img/${mapId}/`, cursor });
    if (page.objects.length) await env.MAPS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
