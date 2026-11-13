import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import { contentSecurityPolicy, IMMUTABLE_CACHE } from '../assets';

function withAssets(contentType: string, extra: Record<string, string> = {}): Env {
  const ASSETS = {
    fetch: async () => new Response('body', { headers: { 'Content-Type': contentType, ...extra } }),
  } as unknown as Fetcher;
  return { ...(env as unknown as Env), ASSETS };
}
/** An ASSETS stub serving a real `<html>` document, for the `?theme=` HTMLRewriter tests below. */
function withHtmlAssets(body: string, contentType = 'text/html; charset=utf-8'): Env {
  const ASSETS = { fetch: async () => new Response(body, { headers: { 'Content-Type': contentType } }) } as unknown as Fetcher;
  return { ...(env as unknown as Env), ASSETS };
}
const get = (path: string, e: Env) => worker.fetch(new Request(`http://x${path}`), e);

describe('asset responses', () => {
  it('sends a strict CSP that also forbids framing on the list page and the editor', async () => {
    for (const path of ['/', '/e/abcdefghijklmnopqrstu']) {
      const res = await get(path, withAssets('text/html; charset=utf-8'));
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('lets the view page be framed anywhere, with the same CSP otherwise', async () => {
    const res = await get('/m/abcdefghijklmnopqrstu', withAssets('text/html', { 'X-Frame-Options': 'DENY' }));
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('frame-ancestors');
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(await res.text()).toBe('body');
  });

  it('leaves scripts and fonts without a CSP but adds nosniff', async () => {
    const res = await get('/assets/index.js', withAssets('text/javascript'));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('?theme= sets data-theme in the served HTML, so there is no flash of the system theme', () => {
  const html = '<!doctype html><html><head><title>Sketchmap</title></head><body></body></html>';

  it('writes data-theme onto <html> for a recognised value', async () => {
    const res = await get('/m/x?theme=dark', withHtmlAssets(html));
    expect(await res.text()).toContain('<html data-theme="dark">');
  });

  it('leaves the HTML untouched for an unrecognised value or no param', async () => {
    for (const path of ['/m/x?theme=blue', '/m/x']) {
      const res = await get(path, withHtmlAssets(html));
      expect(await res.text()).toBe(html);
    }
  });

  it('leaves a non-HTML asset untouched even with ?theme=', async () => {
    const res = await get('/assets/index.js?theme=dark', withHtmlAssets('console.log(1)', 'text/javascript'));
    expect(await res.text()).toBe('console.log(1)');
  });
});

describe('long-lived caching for content-hashed files', () => {
  const REVALIDATE = 'public, max-age=0, must-revalidate';
  const FONT = '/fonts/Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2';

  it('caches hashed bundles and font subsets for a year', async () => {
    for (const [path, type] of [
      ['/assets/index-D4btxGR0.js', 'text/javascript'],
      ['/assets/index-Bq3_x-9Z.css', 'text/css'],
      ['/assets/file-open-002ab408-BHUWm0Sh.js', 'text/javascript'],
      [FONT, 'font/woff2'],
      ['/fonts/Xiaolai/Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2', 'font/woff2'],
    ]) {
      const res = await get(path, withAssets(type, { 'Cache-Control': REVALIDATE }));
      expect(res.headers.get('Cache-Control'), path).toBe(IMMUTABLE_CACHE);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('leaves pages, unhashed files and the licence text alone', async () => {
    for (const [path, type] of [
      ['/', 'text/html; charset=utf-8'],
      ['/m/abcdefghijklmnopqrstu', 'text/html'],
      ['/assets/plain.js', 'text/javascript'],
      ['/fonts/OFL.txt', 'text/plain'],
      ['/fonts/Other/Other-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2', 'font/woff2'],
    ]) {
      const res = await get(path, withAssets(type, { 'Cache-Control': REVALIDATE }));
      expect(res.headers.get('Cache-Control'), path).toBe(REVALIDATE);
    }
  });

  it('does not cache the page that answers for a bundle that no longer exists', async () => {
    // not_found_handling: single-page-application answers a missing file with index.html and status 200.
    const res = await get('/assets/gone-AAAAAAAA.js', withAssets('text/html; charset=utf-8', { 'Cache-Control': REVALIDATE }));
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });

  it('does not cache an error answer', async () => {
    const ASSETS = { fetch: async () => new Response('nope', { status: 404, headers: { 'Content-Type': 'text/javascript', 'Cache-Control': REVALIDATE } }) } as unknown as Fetcher;
    const res = await get('/assets/index-D4btxGR0.js', { ...(env as unknown as Env), ASSETS });
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });

  const notModified = (path: string, headers: Record<string, string>) => {
    const ASSETS = { fetch: async () => new Response(null, { status: 304, headers: { 'Cache-Control': REVALIDATE, ...headers } }) } as unknown as Fetcher;
    return get(path, { ...(env as unknown as Env), ASSETS });
  };

  it('also carries the year-long header on a 304 revalidation answer', async () => {
    const res = await notModified(FONT, { 'Content-Type': 'font/woff2' });
    expect(res.status).toBe(304);
    expect(res.headers.get('Cache-Control')).toBe(IMMUTABLE_CACHE);
  });

  it('leaves a 304 for the single-page fallback alone', async () => {
    const res = await notModified('/assets/gone-AAAAAAAA.js', { 'Content-Type': 'text/html; charset=utf-8' });
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });

  it('leaves a 304 without a Content-Type alone', async () => {
    const res = await notModified('/assets/index-D4btxGR0.js', {});
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });
});

describe('contentSecurityPolicy', () => {
  it('production: same-origin scripts only', () => {
    expect(contentSecurityPolicy('/e/x', false)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("dev: also Vite's inline React-refresh preamble and the HMR websocket; the view stays frameable", () => {
    const csp = contentSecurityPolicy('/m/x', true);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('frame-ancestors');
  });
});
