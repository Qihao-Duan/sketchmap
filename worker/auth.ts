import { allowedEmails } from './google';
import type { Env } from './index';
import { readSession } from './session';

const encoder = new TextEncoder();

/** True when the request carries `Authorization: Bearer <ownerKey>`, compared in constant time. */
export function isOwner(request: Request, ownerKey: string): boolean {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match || !ownerKey) return false;
  const given = encoder.encode(match[1]);
  const expected = encoder.encode(ownerKey);
  if (given.byteLength !== expected.byteLength) {
    crypto.subtle.timingSafeEqual(expected, expected); // keep timing similar
    return false;
  }
  return crypto.subtle.timingSafeEqual(given, expected);
}

/** Who is asking: the holder of the owner key, or a Google account on the owner's list. */
export type Who = { via: 'key' } | { via: 'google'; sub: string; email: string };

/** The id recorded beside a map for the account that owns it, or undefined for the owner key. */
export const ownerId = (who: Who): string | undefined => (who.via === 'google' ? `google:${who.sub}` : undefined);

const READS = new Set(['GET', 'HEAD']);

/**
 * Decides whether a request may edit. The owner key always may. A session cookie may when its account is
 * still on the list and, for anything that changes data, when the request comes from this site's own pages:
 * a browser attaches cookies to requests other sites cause too, and names the page's origin on every write.
 */
export async function authorize(request: Request, env: Env): Promise<Who | null> {
  if (isOwner(request, env.OWNER_KEY)) return { via: 'key' };
  const session = await readSession(request, env.OWNER_KEY);
  if (!session || !allowedEmails(env).has(session.email)) return null;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null; // switched off: sessions end with it
  if (!READS.has(request.method) && request.headers.get('Origin') !== new URL(request.url).origin) return null;
  return { via: 'google', sub: session.sub, email: session.email };
}
