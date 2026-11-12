export type Route = { name: 'list' } | { name: 'editor'; id: string } | { name: 'view'; id: string } | { name: 'notFound' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'list' };
  const m = /^\/(e|m)\/([A-Za-z0-9_-]{21})\/?$/.exec(pathname);
  if (m) return { name: m[1] === 'e' ? 'editor' : 'view', id: m[2] };
  return { name: 'notFound' };
}
