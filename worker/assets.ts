import { shownTheme, themeFromSearch } from '../src/shared/theme';
import type { Env } from './index';
import { pageSiteTheme } from './settings';

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

/**
 * The same request without `If-None-Match` / `If-Modified-Since`. A page is one file for every theme, but this Worker
 * writes the site theme into it: the file's own validators can't tell a browser that the theme changed, so a page is
 * always sent whole (it is about 1 KB). Only for a browser that kept a page from before pages were sent `no-store`.
 */
function withoutValidators(request: Request): Request {
  if (!request.headers.has('If-None-Match') && !request.headers.has('If-Modified-Since')) return request;
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  return new Request(request, { headers });
}

export async function serveAsset(request: Request, env: Pick<Env, 'ASSETS' | 'MAPS'>): Promise<Response> {
  const { pathname, search } = new URL(request.url);
  const hashed = CONTENT_HASHED.test(pathname);
  // App pages (`/`, `/e/<id>`, `/m/<id>`) have no file extension: read the site theme while the file is fetched.
  // Anything else that turns out to be HTML (the single-page fallback for a missing file) reads it afterwards.
  const pageLike = !/\.[A-Za-z0-9]+$/.test(pathname);
  const siteTheme = pageLike ? pageSiteTheme(env) : null;
  const upstream = await env.ASSETS.fetch(pageLike ? withoutValidators(request) : request);
  const res = new Response(upstream.body, upstream); // copy so headers are mutable
  if (pathname.startsWith('/m/')) {
    res.headers.delete('X-Frame-Options');
    res.headers.delete('Content-Security-Policy');
  }
  for (const [k, v] of Object.entries(securityHeaders(pathname, upstream.headers.get('Content-Type')))) res.headers.set(k, v);
  // Only real files: a bundle name that no longer exists is answered with the HTML page (single-page
  // fallback), and that must not be kept for a year. A 304 answer to a revalidation carries the header too, so
  // a browser that stored the file earlier switches to the long lifetime; one without a Content-Type is left alone.
  const contentType = upstream.headers.get('Content-Type');
  if ((upstream.status === 200 || upstream.status === 304) && hashed && contentType && !contentType.includes('text/html')) {
    res.headers.set('Cache-Control', IMMUTABLE_CACHE);
  }
  if (!(contentType ?? '').includes('text/html')) return res;
  // Write the look into the page itself, so there's no flash of another theme while the module script loads:
  // `data-site-theme` is the saved setting (the theme picker shows it), `data-theme` the look this page shows
  // (`?theme=` first, then the setting; none for "follow the system"). `main.tsx` reads both back. `no-store`: a
  // browser must not keep a page that shows an old setting (`no-cache` would still let Back reuse a kept copy).
  res.headers.delete('ETag');
  res.headers.delete('Last-Modified');
  res.headers.set('Cache-Control', 'no-store');
  const site = await (siteTheme ?? pageSiteTheme(env));
  const theme = shownTheme(themeFromSearch(search), site);
  return new HTMLRewriter()
    .on('html', {
      element(el) {
        el.setAttribute('data-site-theme', site);
        if (theme) el.setAttribute('data-theme', theme);
      },
    })
    .transform(res);
}
