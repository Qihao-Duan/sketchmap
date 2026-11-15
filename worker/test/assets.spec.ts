import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../index';
import { contentSecurityPolicy, IMMUTABLE_CACHE } from '../assets';
import { SETTINGS_KEY } from '../settings';

function withAssets(contentType: string, extra: Record<string, string> = {}): Env {
  const ASSETS = {
    fetch: async () => new Response('body', { headers: { 'Content-Type': contentType, ...extra } }),
  } as unknown as Fetcher;
  return { ...(env as unknown as Env), ASSETS };
}
/** An ASSETS stub serving a real `<html>` document, for the theme HTMLRewriter tests below. */
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

describe('the theme is written into every served page, so there is no flash of another look', () => {
  const html = '<!doctype html><html><head><title>Sketchmap</title></head><body></body></html>';
  const MAPS = (env as unknown as Env).MAPS;
  const saveSetting = (theme: unknown) => MAPS.put(SETTINGS_KEY, JSON.stringify({ theme }));
  /** The `<html>` start tag of the page served at `path`. */
  const htmlTag = async (path: string, e: Env = withHtmlAssets(html)) => (await (await get(path, e)).text()).match(/<html[^>]*>/)![0];
  afterEach(() => MAPS.delete(SETTINGS_KEY));

  it('is light when nothing is saved: the site does not follow the system on its own', async () => {
    for (const path of ['/', '/e/abcdefghijklmnopqrstu', '/m/abcdefghijklmnopqrstu']) {
      expect(await htmlTag(path), path).toBe('<html data-site-theme="light" data-theme="light">');
    }
  });

  it('shows the saved setting on every page, the embed included; "system" leaves the look to the system', async () => {
    await saveSetting('dark');
    for (const path of ['/', '/e/abcdefghijklmnopqrstu', '/m/abcdefghijklmnopqrstu']) {
      expect(await htmlTag(path), path).toBe('<html data-site-theme="dark" data-theme="dark">');
    }
    await saveSetting('system');
    expect(await htmlTag('/m/abcdefghijklmnopqrstu')).toBe('<html data-site-theme="system">');
  });

  it('lets a link\'s ?theme= win over the setting, and ignores an unknown ?theme=', async () => {
    await saveSetting('system');
    expect(await htmlTag('/m/x?theme=dark')).toBe('<html data-site-theme="system" data-theme="dark">');
    await saveSetting('dark');
    expect(await htmlTag('/m/x?theme=light')).toBe('<html data-site-theme="dark" data-theme="light">');
    expect(await htmlTag('/m/x?theme=blue')).toBe('<html data-site-theme="dark" data-theme="dark">');
  });

  it('falls back to light for a garbled setting, and still serves the page when storage fails', async () => {
    await MAPS.put(SETTINGS_KEY, 'not json');
    expect(await htmlTag('/')).toBe('<html data-site-theme="light" data-theme="light">');
    await saveSetting('purple');
    expect(await htmlTag('/')).toBe('<html data-site-theme="light" data-theme="light">');

    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...withHtmlAssets(html), MAPS: { get: async () => { throw new Error('R2 is down'); } } as unknown as R2Bucket };
    const res = await get('/m/x', broken);
    expect(res.status).toBe(200);
    expect((await res.text()).match(/<html[^>]*>/)![0]).toBe('<html data-site-theme="light" data-theme="light">');
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('also covers the page sent for a missing file (single-page fallback)', async () => {
    await saveSetting('dark');
    expect(await htmlTag('/assets/gone-AAAAAAAA.js')).toBe('<html data-site-theme="dark" data-theme="dark">');
  });

  it('sends pages whole and fresh: no validators, so a browser never keeps a page showing an old setting', async () => {
    const seen: Request[] = [];
    const ASSETS = {
      fetch: async (r: Request) => {
        seen.push(r);
        return new Response(html, { headers: { 'Content-Type': 'text/html', ETag: '"same-file"', 'Last-Modified': 'Sun, 15 Nov 2026 00:00:00 GMT' } });
      },
    } as unknown as Fetcher;
    const res = await worker.fetch(
      new Request('http://x/e/abcdefghijklmnopqrstu', { headers: { 'If-None-Match': '"same-file"', 'If-Modified-Since': 'Sun, 15 Nov 2026 00:00:00 GMT' } }),
      { ...(env as unknown as Env), ASSETS },
    );
    expect(res.status).toBe(200);
    expect([res.headers.get('ETag'), res.headers.get('Last-Modified'), res.headers.get('Cache-Control')]).toEqual([null, null, 'no-cache']);
    expect([seen[0].headers.get('If-None-Match'), seen[0].headers.get('If-Modified-Since')]).toEqual([null, null]);
  });

  it('keeps revalidation for content-hashed files, and leaves other files untouched even with ?theme=', async () => {
    const seen: Request[] = [];
    const ASSETS = { fetch: async (r: Request) => { seen.push(r); return new Response('console.log(1)', { headers: { 'Content-Type': 'text/javascript', ETag: '"js"' } }); } } as unknown as Fetcher;
    const e = { ...(env as unknown as Env), ASSETS };
    const res = await worker.fetch(new Request('http://x/assets/index-D4btxGR0.js?theme=dark', { headers: { 'If-None-Match': '"js"' } }), e);
    expect(seen[0].headers.get('If-None-Match')).toBe('"js"');
    expect(res.headers.get('ETag')).toBe('"js"');
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

  it('sends pages with no-cache (the theme is written into them), never the year-long header', async () => {
    for (const path of ['/', '/m/abcdefghijklmnopqrstu']) {
      const res = await get(path, withAssets('text/html; charset=utf-8', { 'Cache-Control': REVALIDATE }));
      expect(res.headers.get('Cache-Control'), path).toBe('no-cache');
    }
  });

  it('leaves unhashed files and the licence text alone', async () => {
    for (const [path, type] of [
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
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
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

  it('never gives the single-page fallback the year-long header, even on a 304', async () => {
    const res = await notModified('/assets/gone-AAAAAAAA.js', { 'Content-Type': 'text/html; charset=utf-8' });
    expect(res.headers.get('Cache-Control')).not.toBe(IMMUTABLE_CACHE);
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
