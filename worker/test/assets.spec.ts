import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';

function withAssets(contentType: string, extra: Record<string, string> = {}): Env {
  const ASSETS = {
    fetch: async () => new Response('body', { headers: { 'Content-Type': contentType, ...extra } }),
  } as unknown as Fetcher;
  return { ...(env as unknown as Env), ASSETS };
}
const get = (path: string, e: Env) => worker.fetch(new Request(`http://x${path}`), e);

describe('asset responses', () => {
  it('forbids framing the list page and the editor', async () => {
    for (const path of ['/', '/e/abcdefghijklmnopqrstu']) {
      const res = await get(path, withAssets('text/html; charset=utf-8'));
      expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('lets the view page be framed anywhere, even if a framing header slipped in', async () => {
    const res = await get('/m/abcdefghijklmnopqrstu', withAssets('text/html', { 'X-Frame-Options': 'DENY' }));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(await res.text()).toBe('body');
  });

  it('leaves scripts and fonts without a CSP but adds nosniff', async () => {
    const res = await get('/assets/index.js', withAssets('text/javascript'));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
