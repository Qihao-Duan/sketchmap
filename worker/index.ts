import { serveAsset } from './assets';
import { authorize } from './auth';
import { googleEnabled, handleAuth } from './google';
import { errorResponse, json } from './http';
import { createMap, deleteMap, getMap, listMaps, saveMap } from './maps';
import { uploadImage, serveImage } from './images';

export interface Env {
  MAPS: R2Bucket;
  OWNER_KEY: string;
  ASSETS: Fetcher;
  /** Google sign-in is on when the next three are all set (see worker/google.ts). Each is a Worker secret. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** The Google accounts allowed to edit: emails separated by commas or spaces. */
  OWNER_EMAILS?: string;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['api', 'maps', id?, 'images'?]
  const method = request.method;
  if (parts[1] === 'session' && parts.length === 2) {
    // What the sign-in page needs to know: is this browser in already, and is the Google button to be shown.
    if (method !== 'GET') return errorResponse(405, 'Method not allowed');
    const who = await authorize(request, env);
    return json({ signedIn: who !== null, email: who?.via === 'google' ? who.email : null, google: googleEnabled(env) });
  }
  if (parts[1] !== 'maps' || parts.length > 4) return errorResponse(404, 'Not found');
  const id = parts[2];
  const action = parts[3];
  if (!id) {
    const who = await authorize(request, env);
    if (!who) return errorResponse(401, 'Unauthorized');
    if (method === 'GET') return listMaps(env);
    if (method === 'POST') return createMap(request, env, who);
    return errorResponse(405, 'Method not allowed');
  }
  if (action) {
    if (action !== 'images') return errorResponse(404, 'Not found');
    if (!(await authorize(request, env))) return errorResponse(401, 'Unauthorized');
    if (method === 'POST') return uploadImage(id, request, env);
    return errorResponse(405, 'Method not allowed');
  }
  if (method === 'GET') return getMap(id, env);
  const who = await authorize(request, env);
  if (!who) return errorResponse(401, 'Unauthorized');
  if (method === 'PUT') return saveMap(id, request, env, who);
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
    if (url.pathname.startsWith('/auth/')) {
      try {
        return await handleAuth(request, env);
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
