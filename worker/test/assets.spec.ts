import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import { contentSecurityPolicy } from '../assets';

function withAssets(contentType: string, extra: Record<string, string> = {}): Env {
  const ASSETS = {
    fetch: async () => new Response('body', { headers: { 'Content-Type': contentType, ...extra } }),
  } as unknown as Fetcher;
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
