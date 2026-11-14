// Signed cookies: the session a Google sign-in starts, and the short-lived note the sign-in keeps while
// the browser is away at Google. Both are "<base64url(JSON)>.<base64url(HMAC-SHA-256)>": anyone can read
// them, only this Worker can make or change one.

/** `__Host-`: the browser accepts the cookie only from this exact host, over HTTPS, for the whole site. */
export const SESSION_COOKIE = '__Host-sm_session';
export const SIGNIN_COOKIE = '__Host-sm_signin';
export const SESSION_DAYS = 30;

export interface Session {
  /** Google's permanent id for the account. */
  sub: string;
  /** The account's email, lower-cased. */
  email: string;
  /** When the session ends, in seconds since 1970. */
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Parses JSON that came from outside; null instead of throwing. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The signing key is derived from the owner key, one per purpose. So there is no second secret to keep,
 * changing the owner key ends every session, and a cookie sealed for one purpose is no good for another.
 */
async function signingKey(ownerKey: string, purpose: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(ownerKey), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(`sketchmap ${purpose} v1`) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function seal(value: unknown, ownerKey: string, purpose: string): Promise<string> {
  const body = base64url(encoder.encode(JSON.stringify(value)));
  const mac = await crypto.subtle.sign('HMAC', await signingKey(ownerKey, purpose), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(mac))}`;
}

/** The value inside a sealed token, or null when the token is missing, malformed or not ours. */
export async function unseal(token: string | null, ownerKey: string, purpose: string): Promise<unknown> {
  if (!token || !ownerKey) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const mac = fromBase64url(parts[1]);
  const body = fromBase64url(parts[0]);
  if (!mac || !body || mac.byteLength !== 32) return null;
  // subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await signingKey(ownerKey, purpose), mac, encoder.encode(parts[0]));
  return ok ? parseJson(decoder.decode(body)) : null;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * HttpOnly: page scripts can't read it. SameSite=Lax: sent when the browser follows a link here (Google's
 * redirect back needs that) but not on another site's background or form requests. `maxAge` 0 deletes it.
 */
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

/** The session a request carries, if it is ours and has not run out. Whether the account is still allowed is checked by the caller. */
export async function readSession(request: Request, ownerKey: string, now = Date.now()): Promise<Session | null> {
  const value = (await unseal(readCookie(request, SESSION_COOKIE), ownerKey, 'session')) as Partial<Session> | null;
  if (!value || typeof value.sub !== 'string' || typeof value.email !== 'string' || typeof value.exp !== 'number') return null;
  return value.exp * 1000 > now ? { sub: value.sub, email: value.email, exp: value.exp } : null;
}
