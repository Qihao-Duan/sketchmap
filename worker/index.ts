import { serveAsset } from './assets';
import { isOwner } from './auth';
import { errorResponse } from './http';
import { createMap, deleteMap, getMap, listMaps, saveMap } from './maps';
import { uploadImage, serveImage } from './images';

export interface Env {
  MAPS: R2Bucket;
  OWNER_KEY: string;
  ASSETS: Fetcher;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['api', 'maps', id?, 'images'?]
  if (parts[1] !== 'maps' || parts.length > 4) return errorResponse(404, 'Not found');
  const id = parts[2];
  const action = parts[3];
  const method = request.method;
  if (!id) {
    if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
    if (method === 'GET') return listMaps(env);
    if (method === 'POST') return createMap(request, env);
    return errorResponse(405, 'Method not allowed');
  }
  if (action) {
    if (action !== 'images') return errorResponse(404, 'Not found');
    if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
    if (method === 'POST') return uploadImage(id, request, env);
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
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        console.error(e);
        return errorResponse(500, 'Internal error');
      }
    }
    if (url.pathname.startsWith('/img/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed');
      try {
        return await serveImage(url.pathname, env);
      } catch (e) {
        console.error(e);
        return errorResponse(500, 'Internal error');
      }
    }
    return serveAsset(request, env);
  },
} satisfies ExportedHandler<Env>;
