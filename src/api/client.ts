import type { MapSummary, MindMap } from '../shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public etag: string | null = null) {
    super(message);
  }
}

export interface Saved {
  map: MindMap;
  etag: string;
}

export interface ApiClient {
  listMaps(): Promise<MapSummary[]>;
  createMap(title?: string): Promise<Saved>;
  getMap(id: string): Promise<Saved>;
  saveMap(map: MindMap, etag: string): Promise<Saved>;
  deleteMap(id: string): Promise<void>;
  uploadImage(mapId: string, blob: Blob): Promise<{ key: string }>;
}

export const GET_RETRY_DELAY_MS = 400;

export function createApi(
  getKey: () => string | null,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  base = '',
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): ApiClient {
  async function once(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    const key = auth ? getKey() : null;
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetchImpl(base + path, { ...init, headers });
    } catch {
      throw new ApiError(0, 'Network error: you seem to be offline');
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, message, res.headers.get('ETag'));
    }
    return res;
  }
  /** A read that failed on the network or with a server error is tried once more: reads are safe to repeat, writes are not. */
  async function request(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const read = !init.method || init.method === 'GET';
    try {
      return await once(path, init, auth);
    } catch (e) {
      if (!read || !(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) throw e;
      await sleep(GET_RETRY_DELAY_MS);
      return once(path, init, auth);
    }
  }
  const saved = async (res: Response): Promise<Saved> => ({ map: (await res.json()) as MindMap, etag: res.headers.get('ETag') ?? '' });
  const mapPath = (id: string) => `/api/maps/${encodeURIComponent(id)}`;

  return {
    listMaps: async () => (await (await request('/api/maps')).json()) as MapSummary[],
    createMap: async (title) => saved(await request('/api/maps', { method: 'POST', body: JSON.stringify(title ? { title } : {}) })),
    getMap: async (id) => saved(await request(mapPath(id), {}, false)),
    saveMap: async (map, etag) =>
      saved(await request(mapPath(map.id), { method: 'PUT', body: JSON.stringify(map), headers: { 'If-Match': etag } })),
    deleteMap: async (id) => {
      await request(mapPath(id), { method: 'DELETE' });
    },
    uploadImage: async (mapId, blob) =>
      (await (await request(`${mapPath(mapId)}/images`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } })).json()) as { key: string },
  };
}
