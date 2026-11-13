import { themeFromSearch } from '../src/shared/theme';
import type { Env } from './index';

/**
 * Content-Security-Policy for the app's HTML. Production allows only same-origin scripts; `vite dev` also needs its
 * inline React-refresh preamble and the HMR websocket. Inline style attributes are allowed: React and the renderer set
 * them. `/m/*` may be framed anywhere (the Notion embed); every other page may not be framed at all.
 */
export function contentSecurityPolicy(pathname: string, dev: boolean): string {
  const directives = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (!pathname.startsWith('/m/')) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

export function securityHeaders(pathname: string, contentType: string | null, dev = import.meta.env.DEV): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if ((contentType ?? '').includes('text/html')) headers['Content-Security-Policy'] = contentSecurityPolicy(pathname, dev);
  return headers;
}

/**
 * A year, and never re-checked. Bundle names are content hashes, so they change with the content. Font names are fixed
 * by the pinned Excalidraw version, and `scripts/copy-fonts.mjs` fails the build if one ever changes content under the same name.
 */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Vite's bundles (`<name>-<8-character hash>.<ext>`) and the font subsets (`<Family>-Regular-<32 hex>.woff2`). */
const CONTENT_HASHED = /^\/(assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+|fonts\/(Excalifont|Xiaolai)\/\2-Regular-[0-9a-f]{32}\.woff2)$/;

export async function serveAsset(request: Request, env: Pick<Env, 'ASSETS'>): Promise<Response> {
  const upstream = await env.ASSETS.fetch(request);
  const res = new Response(upstream.body, upstream); // copy so headers are mutable
  const { pathname, search } = new URL(request.url);
  if (pathname.startsWith('/m/')) {
    res.headers.delete('X-Frame-Options');
    res.headers.delete('Content-Security-Policy');
  }
  for (const [k, v] of Object.entries(securityHeaders(pathname, upstream.headers.get('Content-Type')))) res.headers.set(k, v);
  // Only real files: a bundle name that no longer exists is answered with the HTML page (single-page
  // fallback), and that must not be kept for a year. A 304 answer to a revalidation carries the header too, so
  // a browser that stored the file earlier switches to the long lifetime; one without a Content-Type is left alone.
  const contentType = upstream.headers.get('Content-Type');
  if ((upstream.status === 200 || upstream.status === 304) && CONTENT_HASHED.test(pathname) && contentType && !contentType.includes('text/html')) {
    res.headers.set('Cache-Control', IMMUTABLE_CACHE);
  }
  // Set `data-theme` server-side so there's no flash of the system theme while the module script
  // loads and runs: `main.tsx`'s own `applyTheme` call is harmless and still covers non-Worker hosting.
  const theme = (res.headers.get('Content-Type') ?? '').includes('text/html') ? themeFromSearch(search) : null;
  if (theme) {
    return new HTMLRewriter().on('html', { element(el) { el.setAttribute('data-theme', theme); } }).transform(res);
  }
  return res;
}
