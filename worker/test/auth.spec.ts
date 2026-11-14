import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../index';
import { handleAuth } from '../google';
import { seal, SESSION_COOKIE, SESSION_DAYS, SIGNIN_COOKIE } from '../session';
import type { MindMap } from '../../src/shared/types';

const E = env as unknown as Env; // no Google settings: the owner key is the only way in
const KEY = 'test-owner-key';
const CLIENT = 'client-123.apps.googleusercontent.com';
/** The same Worker with Google sign-in switched on for two accounts. */
const G: Env = { ...E, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'client-secret', OWNER_EMAILS: 'Me@Example.com, second@example.com' };
const SITE = 'https://maps.test';
const nowSec = () => Math.floor(Date.now() / 1000);

const b64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** Shaped like Google's ID token. The signature part is never checked: see worker/google.ts. */
const idToken = (claims: Record<string, unknown>) => `${b64url('{"alg":"RS256"}')}.${b64url(JSON.stringify(claims))}.sig`;
const setCookies = (res: Response) => res.headers.getSetCookie();
const cookieValue = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1) ?? null;
const cookieAttrs = (res: Response, name: string) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split('; ').slice(1).sort() ?? null;

/** Walks the whole sign-in: our redirect to Google, then Google's redirect back with a code. */
async function signIn({ claims = {}, next = '/e/abc', state, cookie, tokenStatus = 200, query = '', e = G }: {
  claims?: Record<string, unknown>; next?: string; state?: string; cookie?: string | null; tokenStatus?: number; query?: string; e?: Env;
} = {}) {
  const start = await handleAuth(new Request(`${SITE}/auth/google?next=${encodeURIComponent(next)}`), e);
  const toGoogle = new URL(start.headers.get('Location')!);
  const pending = cookieValue(start, SIGNIN_COOKIE);
  const token = idToken({
    iss: 'https://accounts.google.com', aud: CLIENT, exp: nowSec() + 3600, nonce: toGoogle.searchParams.get('nonce'),
    sub: '1234567890', email: 'me@example.com', email_verified: true, ...claims,
  });
  const tokenFetch = vi.fn<typeof fetch>(async () => Response.json(tokenStatus === 200 ? { id_token: token } : { error: 'invalid_grant' }, { status: tokenStatus }));
  const sent = cookie === undefined ? pending : cookie;
  const back = await handleAuth(
    new Request(`${SITE}/auth/google/callback?${query || `code=the-code&state=${state ?? toGoogle.searchParams.get('state')}`}`, {
      headers: sent === null ? {} : { Cookie: `${SIGNIN_COOKIE}=${sent}` },
    }),
    e,
    tokenFetch,
  );
  return { start, toGoogle, back, tokenFetch, session: cookieValue(back, SESSION_COOKIE) };
}

/** A request to the Worker carrying a session cookie, as a browser on our own pages would send it. */
function withSession(session: string | null, path: string, init: RequestInit = {}, { origin = SITE, e = G }: { origin?: string | null; e?: Env } = {}) {
  const headers = new Headers(init.headers);
  if (session) headers.set('Cookie', `${SESSION_COOKIE}=${session}`);
  if (origin && init.method && init.method !== 'GET') headers.set('Origin', origin);
  return worker.fetch(new Request(`${SITE}${path}`, { ...init, headers }), e);
}

describe('where sign-in stands', () => {
  it('says Google sign-in is off until the client id, the client secret and an allowed email are all set', async () => {
    const off = [E, { ...G, GOOGLE_CLIENT_ID: undefined }, { ...G, GOOGLE_CLIENT_SECRET: '' }, { ...G, OWNER_EMAILS: ' , ' }];
    for (const e of off) {
      const res = await worker.fetch(new Request(`${SITE}/api/session`), e as Env);
      expect(await res.json()).toEqual({ signedIn: false, email: null, google: false });
      expect((await worker.fetch(new Request(`${SITE}/auth/google`), e as Env)).status).toBe(404);
    }
    const on = await worker.fetch(new Request(`${SITE}/api/session`), G);
    expect([on.status, on.headers.get('Cache-Control'), await on.json()]).toEqual([200, 'no-store', { signedIn: false, email: null, google: true }]);
  });

  it('counts the owner key as signed in', async () => {
    const res = await worker.fetch(new Request(`${SITE}/api/session`, { headers: { Authorization: `Bearer ${KEY}` } }), E);
    expect(await res.json()).toEqual({ signedIn: true, email: null, google: false });
    const wrong = await worker.fetch(new Request(`${SITE}/api/session`, { headers: { Authorization: 'Bearer nope' } }), E);
    expect(await wrong.json()).toMatchObject({ signedIn: false });
  });
});

describe('signing in with Google', () => {
  it('sends the browser to Google with a state, a nonce and a PKCE challenge, and remembers them in a short-lived cookie', async () => {
    const { start, toGoogle } = await signIn();
    expect(start.status).toBe(302);
    expect(toGoogle.origin + toGoogle.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    const q = toGoogle.searchParams;
    expect([q.get('client_id'), q.get('redirect_uri'), q.get('response_type'), q.get('scope'), q.get('code_challenge_method')]).toEqual([
      CLIENT, `${SITE}/auth/google/callback`, 'code', 'openid email', 'S256',
    ]);
    for (const name of ['state', 'nonce', 'code_challenge']) expect(q.get(name)!.length).toBeGreaterThanOrEqual(22);
    expect(cookieAttrs(start, SIGNIN_COOKIE)).toEqual(['HttpOnly', 'Max-Age=600', 'Path=/', 'SameSite=Lax', 'Secure']);
    expect(start.headers.get('Cache-Control')).toBe('no-store');
    const again = (await signIn()).toGoogle.searchParams;
    expect(again.get('state')).not.toBe(q.get('state'));
    expect(again.get('nonce')).not.toBe(q.get('nonce'));
  });

  it('on the way back, trades the code for an ID token and starts a session for an allowed account', async () => {
    const { toGoogle, back, tokenFetch, session } = await signIn();
    expect([back.status, back.headers.get('Location')]).toEqual([302, '/e/abc']);
    expect(session).toBeTruthy();
    expect(cookieAttrs(back, SESSION_COOKIE)).toEqual(['HttpOnly', `Max-Age=${SESSION_DAYS * 86400}`, 'Path=/', 'SameSite=Lax', 'Secure']);
    expect(cookieAttrs(back, SIGNIN_COOKIE)).toContain('Max-Age=0'); // the one-time cookie is spent

    const [url, init] = tokenFetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(init!.body as string);
    expect([init!.method, form.get('grant_type'), form.get('code'), form.get('client_id'), form.get('client_secret'), form.get('redirect_uri')]).toEqual([
      'POST', 'authorization_code', 'the-code', CLIENT, 'client-secret', `${SITE}/auth/google/callback`,
    ]);
    // PKCE: the verifier we send now hashes to the challenge we gave Google at the start.
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(form.get('code_verifier')!)));
    expect(b64url(String.fromCharCode(...digest))).toBe(toGoogle.searchParams.get('code_challenge'));

    const me = await withSession(session, '/api/session');
    expect(await me.json()).toEqual({ signedIn: true, email: 'me@example.com', google: true });
  });

  it('compares the allowed emails without regard to case', async () => {
    const { session } = await signIn({ claims: { email: 'ME@example.COM' } });
    expect(await (await withSession(session, '/api/session')).json()).toMatchObject({ signedIn: true, email: 'me@example.com' });
  });

  it.each([
    ['an account that is not on the list', { claims: { email: 'stranger@example.com' } }, 'notallowed'],
    ['an email Google has not verified', { claims: { email_verified: false } }, 'failed'],
    ['a token made for another app', { claims: { aud: 'someone-else.apps.googleusercontent.com' } }, 'failed'],
    ['a token from another issuer', { claims: { iss: 'https://evil.example' } }, 'failed'],
    ['a token that has run out', { claims: { exp: 1_600_000_000 } }, 'failed'],
    ['a token for a different sign-in attempt', { claims: { nonce: 'not-ours' } }, 'failed'],
    ['a token without an account id', { claims: { sub: undefined } }, 'failed'],
    ['a state that does not match', { state: 'forged' }, 'failed'],
    ['Google refusing the code', { tokenStatus: 400 }, 'failed'],
    ['the user pressing Cancel at Google', { query: 'error=access_denied&state=x' }, 'cancelled'],
    ['no code coming back', { query: 'state=x' }, 'failed'],
    ['no sign-in cookie', { cookie: null }, 'expired'],
    ['a sign-in cookie that was changed', { cookie: 'eyJzdGF0ZSI6IngifQ.AAAA' }, 'expired'],
  ] as const)('refuses %s and starts no session', async (_name, how, reason) => {
    const { back, session } = await signIn(how as Parameters<typeof signIn>[0]);
    expect([back.status, back.headers.get('Location')]).toEqual([302, `/?signin=${reason}`]);
    expect(session).toBeNull();
  });

  it('refuses a sign-in cookie that is older than ten minutes', async () => {
    const stale = await seal({ state: 's', nonce: 'n', verifier: 'v', next: '/', exp: nowSec() - 1 }, KEY, 'signin');
    const { back, session } = await signIn({ cookie: stale, state: 's' });
    expect(back.headers.get('Location')).toBe('/?signin=expired');
    expect(session).toBeNull();
  });

  it('never asks Google for a token when the state is wrong', async () => {
    expect((await signIn({ state: 'forged' })).tokenFetch).not.toHaveBeenCalled();
  });

  it.each(['//evil.example/x', 'https://evil.example/', '/\\evil.example', 'e/abc', '/ok\r\nSet-Cookie: x=1', `/${'a'.repeat(300)}`])(
    'after signing in, goes only to a page of this site: %j falls back to the map list',
    async (next) => {
      expect((await signIn({ next })).back.headers.get('Location')).toBe('/');
    },
  );

  it('keeps a normal page address, with its query', async () => {
    expect((await signIn({ next: '/e/abcdefghijklmnopqrstu?theme=dark' })).back.headers.get('Location')).toBe('/e/abcdefghijklmnopqrstu?theme=dark');
  });
});

describe('a Google session', () => {
  it('opens the map list and lets our own pages create, save and delete', async () => {
    const { session } = await signIn();
    expect((await withSession(session, '/api/maps')).status).toBe(200);
    const created = await withSession(session, '/api/maps', { method: 'POST', body: '{"title":"Mine"}' });
    expect(created.status).toBe(201);
    const map = (await created.json()) as MindMap;
    const saved = await withSession(session, `/api/maps/${map.id}`, { method: 'PUT', body: JSON.stringify(map), headers: { 'If-Match': created.headers.get('ETag')! } });
    expect(saved.status).toBe(200);
    expect((await withSession(session, `/api/maps/${map.id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('refuses a write that does not come from our own pages (another site, or no Origin at all)', async () => {
    const { session } = await signIn();
    for (const origin of ['https://evil.example', 'https://maps.test.evil.example', 'null', null]) {
      const res = await withSession(session, '/api/maps', { method: 'POST', body: '{}' }, { origin });
      expect([origin, res.status]).toEqual([origin, 401]);
    }
    // reading the list from another site is refused by the browser (no CORS headers), not here
    expect((await withSession(session, '/api/maps')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('is refused when it was changed, has run out, or was signed with another owner key', async () => {
    const { session } = await signIn();
    const [body, sig] = session!.split('.');
    const forgedBody = b64url(JSON.stringify({ sub: '1234567890', email: 'me@example.com', exp: nowSec() + 999_999 }));
    const expired = await seal({ sub: '1234567890', email: 'me@example.com', exp: nowSec() - 1 }, KEY, 'session');
    const otherKey = await seal({ sub: '1234567890', email: 'me@example.com', exp: nowSec() + 3600 }, 'another-owner-key', 'session');
    const asSignin = await seal({ sub: '1234567890', email: 'me@example.com', exp: nowSec() + 3600 }, KEY, 'signin');
    for (const bad of [`${forgedBody}.${sig}`, `${body}.AAAA`, body, '', 'x.y.z', expired, otherKey, asSignin]) {
      expect([bad.slice(0, 12), (await withSession(bad, '/api/maps')).status]).toEqual([bad.slice(0, 12), 401]);
    }
    expect((await withSession(session, '/api/maps')).status).toBe(200);
  });

  it('ends when the account is taken off the list, or Google sign-in is switched off', async () => {
    const { session } = await signIn();
    expect((await withSession(session, '/api/maps', {}, { e: { ...G, OWNER_EMAILS: 'second@example.com' } })).status).toBe(401);
    expect((await withSession(session, '/api/maps', {}, { e: E })).status).toBe(401);
  });

  it('signing out clears the cookie', async () => {
    const out = await withSession((await signIn()).session, '/auth/logout', { method: 'POST' });
    expect(out.status).toBe(204);
    expect(cookieValue(out, SESSION_COOKIE)).toBe('');
    expect(cookieAttrs(out, SESSION_COOKIE)).toContain('Max-Age=0');
    expect((await worker.fetch(new Request(`${SITE}/auth/logout`), G)).status).toBe(405);
    expect((await worker.fetch(new Request(`${SITE}/auth/nope`), G)).status).toBe(404);
  });

  it('the owner key keeps working next to it, with or without a session cookie', async () => {
    const { session } = await signIn();
    const res = await worker.fetch(new Request(`${SITE}/api/maps`, { method: 'POST', body: '{}', headers: { Authorization: `Bearer ${KEY}`, Cookie: `${SESSION_COOKIE}=${session}` } }), G);
    expect(res.status).toBe(201);
    expect((await worker.fetch(new Request(`${SITE}/api/maps`, { headers: { Authorization: `Bearer ${KEY}` } }), G)).status).toBe(200);
  });
});

describe('who a map belongs to', () => {
  const ownerOf = async (id: string) => (await E.MAPS.head(`maps/${id}.json`))!.customMetadata?.owner;
  const viaKey = (path: string, init: RequestInit = {}) =>
    worker.fetch(new Request(`${SITE}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${KEY}` } }), G);

  it('a map made in a Google session records that account; saving it with the owner key keeps the record', async () => {
    const { session } = await signIn();
    const created = await withSession(session, '/api/maps', { method: 'POST', body: '{}' });
    const map = (await created.json()) as MindMap;
    expect(await ownerOf(map.id)).toBe('google:1234567890');
    const saved = await viaKey(`/api/maps/${map.id}`, { method: 'PUT', body: JSON.stringify(map), headers: { 'If-Match': created.headers.get('ETag')! } });
    expect(saved.status).toBe(200);
    expect(await ownerOf(map.id)).toBe('google:1234567890');
    expect(await saved.json()).not.toHaveProperty('owner'); // kept beside the map, never inside it
  });

  it('a map made with the owner key has no owner until a Google session first saves it', async () => {
    const created = await viaKey('/api/maps', { method: 'POST', body: '{}' });
    const map = (await created.json()) as MindMap;
    expect(await ownerOf(map.id)).toBeUndefined();
    const { session } = await signIn({ claims: { sub: '42', email: 'second@example.com' } });
    const saved = await withSession(session, `/api/maps/${map.id}`, { method: 'PUT', body: JSON.stringify(map), headers: { 'If-Match': created.headers.get('ETag')! } });
    expect(saved.status).toBe(200);
    expect(await ownerOf(map.id)).toBe('google:42');
    // a later save by the other allowed account does not take it over
    const { session: first } = await signIn();
    const again = await withSession(first, `/api/maps/${map.id}`, { method: 'PUT', body: await saved.clone().text(), headers: { 'If-Match': saved.headers.get('ETag')! } });
    expect(again.status).toBe(200);
    expect(await ownerOf(map.id)).toBe('google:42');
  });
});
