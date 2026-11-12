import type { Env } from './index';

export function securityHeaders(pathname: string, contentType: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  const isHtml = (contentType ?? '').includes('text/html');
  if (isHtml && !pathname.startsWith('/m/')) headers['Content-Security-Policy'] = "frame-ancestors 'none'";
  return headers;
}

export async function serveAsset(request: Request, env: Pick<Env, 'ASSETS'>): Promise<Response> {
  const upstream = await env.ASSETS.fetch(request);
  const res = new Response(upstream.body, upstream); // copy so headers are mutable
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/m/')) {
    res.headers.delete('X-Frame-Options');
    res.headers.delete('Content-Security-Policy');
  }
  for (const [k, v] of Object.entries(securityHeaders(pathname, upstream.headers.get('Content-Type')))) res.headers.set(k, v);
  return res;
}
