// "Sign in with Google": the OpenID Connect authorization-code flow, run entirely by the Worker.
// The browser is sent to Google and comes back with a one-time code; the Worker trades the code for an
// ID token that names the account, and starts a session if that account is on the owner's list.
// No Google script runs in the page, so the strict Content-Security-Policy stays as it is.

import type { Env } from './index';
import { errorResponse } from './http';
import { base64url, fromBase64url, parseJson, readCookie, seal, SESSION_COOKIE, SESSION_DAYS, setCookie, SIGNIN_COOKIE, unseal } from './session';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
/** How long the browser may stay at Google before the attempt lapses. */
const SIGNIN_SECONDS = 600;

/** What the sign-in keeps, in a sealed cookie, while the browser is away at Google. */
interface Pending {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  exp: number;
}

/** The Google accounts allowed to edit, lower-cased. Set with `wrangler secret put OWNER_EMAILS`, separated by commas or spaces. */
export function allowedEmails(env: Pick<Env, 'OWNER_EMAILS'>): Set<string> {
  return new Set((env.OWNER_EMAILS ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean));
}

/** Google sign-in is on only when everything it needs is set; until then the owner key is the only way in. */
export function googleEnabled(env: Env): boolean {
  return !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET && !!env.OWNER_KEY && allowedEmails(env).size > 0;
}

const random = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** Where to go after signing in: a path on this site and nothing else, so the link can't be used to bounce people elsewhere. */
export function safeNext(next: string | null, origin: string): string {
  if (!next || next.length > 200 || !next.startsWith('/') || /^\/[/\\]/.test(next) || /[\\\u0000-\u001f\u007f]/.test(next)) return '/';
  try {
    const url = new URL(next, origin);
    return url.origin === origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}

function redirect(location: string, cookies: string[]): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/** Back to the map list, which says in words why signing in did not work. The one-time cookie is dropped. */
const giveUp = (reason: 'cancelled' | 'expired' | 'failed' | 'notallowed') => redirect(`/?signin=${reason}`, [setCookie(SIGNIN_COOKIE, '', 0)]);

async function start(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pending: Pending = {
    state: random(16),
    nonce: random(16),
    verifier: random(32),
    next: safeNext(url.searchParams.get('next'), url.origin),
    exp: Math.floor(Date.now() / 1000) + SIGNIN_SECONDS,
  };
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pending.verifier))));
  const to = new URL(AUTHORIZE_URL);
  to.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${url.origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return redirect(to.toString(), [setCookie(SIGNIN_COOKIE, await seal(pending, env.OWNER_KEY, 'signin'), SIGNIN_SECONDS)]);
}

/** The claims of an ID token, unverified: see `finish` for why reading them this way is sound here. */
function claimsOf(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== 'string') return null;
  const payload = fromBase64url(idToken.split('.')[1] ?? '');
  const claims = payload && parseJson(new TextDecoder().decode(payload));
  return claims && typeof claims === 'object' && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
}

async function finish(request: Request, env: Env, tokenFetch: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  if (url.searchParams.has('error')) return giveUp('cancelled');

  // The cookie proves this browser started the attempt; the state ties Google's answer to that attempt.
  const pending = (await unseal(readCookie(request, SIGNIN_COOKIE), env.OWNER_KEY, 'signin')) as Pending | null;
  if (!pending || typeof pending.state !== 'string' || !(pending.exp * 1000 > now)) return giveUp('expired');
  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== pending.state) return giveUp('failed');

  let token: unknown;
  try {
    const res = await tokenFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${url.origin}/auth/google/callback`,
        code_verifier: pending.verifier,
      }).toString(),
    });
    if (!res.ok) return giveUp('failed');
    token = await res.json();
  } catch {
    return giveUp('failed');
  }

  // The ID token's signature is not checked. It did not pass through the browser: this Worker fetched it
  // straight from Google's token endpoint over TLS, authenticated with the client secret. OpenID Connect
  // Core (section 3.1.3.7, step 6) accepts that in place of the signature check, and Google's own guide
  // says of this case that "you can be confident that the token you receive really comes from Google and
  // is valid". Its claims are still checked, one by one.
  const claims = claimsOf((token as { id_token?: unknown } | null)?.id_token);
  if (!claims) return giveUp('failed');
  const { iss, aud, exp, nonce, sub, email } = claims;
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (typeof iss !== 'string' || !ISSUERS.has(iss) || aud !== env.GOOGLE_CLIENT_ID) return giveUp('failed');
  if (typeof exp !== 'number' || !(exp * 1000 > now) || nonce !== pending.nonce) return giveUp('failed');
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email || !verified) return giveUp('failed');
  if (!allowedEmails(env).has(email.toLowerCase())) return giveUp('notallowed');

  const session = { sub, email: email.toLowerCase(), exp: Math.floor(now / 1000) + SESSION_DAYS * 86400 };
  return redirect(safeNext(pending.next, url.origin), [
    setCookie(SESSION_COOKIE, await seal(session, env.OWNER_KEY, 'session'), SESSION_DAYS * 86400),
    setCookie(SIGNIN_COOKIE, '', 0),
  ]);
}

/** `/auth/…`. `tokenFetch` is how the Worker reaches Google's token endpoint; tests pass their own. */
export async function handleAuth(request: Request, env: Env, tokenFetch: typeof fetch = (input, init) => fetch(input, init)): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/auth/logout') {
    // Signing out needs no proof of who is asking: the worst another site can do with it is sign the owner out.
    if (request.method !== 'POST') return errorResponse(405, 'Method not allowed');
    return new Response(null, { status: 204, headers: { 'Set-Cookie': setCookie(SESSION_COOKIE, '', 0), 'Cache-Control': 'no-store' } });
  }
  if (!googleEnabled(env) || (pathname !== '/auth/google' && pathname !== '/auth/google/callback')) return errorResponse(404, 'Not found');
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed');
  return pathname === '/auth/google' ? start(request, env) : finish(request, env, tokenFetch);
}
