import { isOwner } from './auth';
import { errorResponse } from './http';
import { createMap, deleteMap, getMap, listMaps, saveMap } from './maps';

export interface Env {
  MAPS: R2Bucket;
  OWNER_KEY: string;
  ASSETS: Fetcher;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['api', 'maps', id?]
  if (parts[1] !== 'maps' || parts.length > 3) return errorResponse(404, 'Not found');
  const id = parts[2];
  const method = request.method;
  if (!id) {
    if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
    if (method === 'GET') return listMaps(env);
    if (method === 'POST') return createMap(request, env);
    return errorResponse(405, 'Method not allowed');
  }
  if (method === 'GET') return getMap(id, env);
  if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
  if (method === 'PUT') return saveMap(id, request, env);
  if (method === 'DELETE') return deleteMap(id, env);
  return errorResponse(405, 'Method not allowed');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
