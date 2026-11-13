import type { Env } from './index';
import { API_HEADERS, errorResponse, json } from './http';
import { MapValidationError, parseMindMap } from '../src/shared/schema';
import { plainTitle } from '../src/shared/title';
import { LIMITS, type MapSummary, type MindMap } from '../src/shared/types';
import { newMapId, newNodeId } from '../src/model/ids';
import { deleteImages } from './images';

const ID_RE = /^[A-Za-z0-9_-]{21}$/;
const objectKey = (id: string) => `maps/${id}.json`;
// R2 `put` replaces custom metadata, so every write sends all three fields.
const metadata = (m: MindMap) => ({ title: m.title, updatedAt: m.updatedAt, version: String(m.version) });
const CONFLICT = 'The map changed since you loaded it';

export async function listMaps(env: Env): Promise<Response> {
  const out: MapSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.MAPS.list({ prefix: 'maps/', include: ['customMetadata'], cursor });
    for (const o of page.objects) {
      out.push({
        id: o.key.slice('maps/'.length, -'.json'.length),
        title: o.customMetadata?.title ?? 'Untitled map',
        updatedAt: o.customMetadata?.updatedAt ?? o.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return json(out);
}

export async function createMap(request: Request, env: Env): Promise<Response> {
  let text = 'Central topic';
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body?.title === 'string' && body.title.trim()) text = body.title.trim().slice(0, 200);
  } catch {
    // an empty or non-JSON body just means "default title"
  }
  const root = { id: newNodeId(), text, children: [] };
  const map: MindMap = { id: newMapId(), title: plainTitle(root), layout: 'map', version: 1, updatedAt: new Date().toISOString(), root };
  const obj = await env.MAPS.put(objectKey(map.id), JSON.stringify(map), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: metadata(map),
  });
  return json(map, { status: 201, headers: { ETag: obj!.httpEtag } });
}

export async function getMap(id: string, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return errorResponse(404, 'Not found');
  const obj = await env.MAPS.get(objectKey(id));
  if (!obj) return errorResponse(404, 'Not found');
  return new Response(obj.body, {
    headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ETag: obj.httpEtag },
  });
}

export async function saveMap(id: string, request: Request, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return errorResponse(404, 'Not found');
  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch) return errorResponse(428, 'If-Match header required');
  const etag = ifMatch.replace(/^W\//, '').replace(/"/g, '');

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > LIMITS.mapJsonBytes) return errorResponse(413, 'Map is larger than 2 MB');
  let incoming: MindMap;
  try {
    incoming = parseMindMap(JSON.parse(body));
  } catch (e) {
    return errorResponse(400, e instanceof MapValidationError ? e.message : 'Body must be JSON');
  }
  if (incoming.id !== id) return errorResponse(400, 'Map id does not match the URL');

  const current = await env.MAPS.head(objectKey(id));
  if (!current) return errorResponse(404, 'Not found');
  if (current.etag !== etag) return errorResponse(409, CONFLICT, { ETag: current.httpEtag });

  const saved: MindMap = {
    ...incoming,
    version: Number(current.customMetadata?.version ?? '0') + 1,
    updatedAt: new Date().toISOString(),
    title: plainTitle(incoming.root),
  };
  const obj = await env.MAPS.put(objectKey(id), JSON.stringify(saved), {
    onlyIf: { etagMatches: etag },
    httpMetadata: { contentType: 'application/json' },
    customMetadata: metadata(saved),
  });
  if (!obj) return errorResponse(409, CONFLICT); // someone saved between head() and put()
  return json(saved, { headers: { ETag: obj.httpEtag } });
}

export async function deleteMap(id: string, env: Env): Promise<Response> {
  if (ID_RE.test(id)) {
    await env.MAPS.delete(objectKey(id));
    await deleteImages(id, env);
  }
  return new Response(null, { status: 204, headers: API_HEADERS });
}
