import { describe, expect, it, vi } from 'vitest';
import { fetchSession, googleSignInUrl, signInFailure, signOut } from './access';

const answering = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

describe('fetchSession', () => {
  it('reports what the server says, sending the owner key when there is one', async () => {
    const f = answering({ signedIn: true, email: 'me@example.com', google: true });
    expect(await fetchSession('k', f)).toEqual({ signedIn: true, email: 'me@example.com', google: true });
    expect(f).toHaveBeenCalledWith('/api/session', { headers: { Authorization: 'Bearer k' } });
    await fetchSession(null, f);
    expect(f).toHaveBeenLastCalledWith('/api/session', {});
  });

  it('counts a clear answer of another shape as signed out', async () => {
    const out = { signedIn: false, email: null, google: false };
    expect(await fetchSession(null, answering([{ id: 'a map list, not a session' }]))).toEqual(out);
    expect(await fetchSession(null, answering({ signedIn: 'yes', email: 7, google: 1 }))).toEqual(out);
    expect(await fetchSession(null, answering({ error: 'Not found' }, 404))).toEqual(out);
  });

  it('says so when the server gave no usable answer, without throwing: its own error, no connection, not JSON', async () => {
    const unknown = { signedIn: false, email: null, google: false, unreachable: true };
    expect(await fetchSession(null, answering({ error: 'Internal error' }, 500))).toEqual(unknown);
    expect(await fetchSession(null, answering('<html>bad gateway</html>', 502))).toEqual(unknown);
    expect(await fetchSession(null, answering('<html>not json</html>'))).toEqual(unknown);
    expect(await fetchSession(null, vi.fn<typeof fetch>(async () => { throw new TypeError('offline'); }))).toEqual(unknown);
  });

  it('keeps "Google is offered" even when nobody is signed in', async () => {
    expect(await fetchSession(null, answering({ signedIn: false, email: null, google: true }))).toEqual({ signedIn: false, email: null, google: true });
  });
});

describe('signOut', () => {
  it('posts to the sign-out address and reports whether the server confirmed it', async () => {
    const f = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(await signOut(f)).toBe(true);
    expect(f).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(await signOut(answering({ error: 'Internal error' }, 500))).toBe(false);
    expect(await signOut(vi.fn<typeof fetch>(async () => { throw new TypeError('offline'); }))).toBe(false);
  });
});

describe('the Google link and its failure messages', () => {
  it('carries the page to come back to, encoded', () => {
    expect(googleSignInUrl('/e/abc?theme=dark')).toBe('/auth/google?next=%2Fe%2Fabc%3Ftheme%3Ddark');
  });

  it('turns the reason in the address into words; an unknown reason gets the general message; no reason, nothing', () => {
    expect(signInFailure('?signin=notallowed')).toMatch(/isn’t allowed/);
    expect(signInFailure('?signin=cancelled')).toMatch(/cancelled/);
    expect(signInFailure('?signin=expired')).toMatch(/too long/);
    expect(signInFailure('?x=1&signin=failed')).toMatch(/didn’t work/);
    expect(signInFailure('?signin=%3Cscript%3E')).toBe(signInFailure('?signin=failed'));
    expect(signInFailure('?theme=dark')).toBeUndefined();
    expect(signInFailure('')).toBeUndefined();
  });
});
