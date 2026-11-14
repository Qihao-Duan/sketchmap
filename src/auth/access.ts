import { getOwnerKey } from './ownerKey';

/** What the server says about this browser: is it signed in, as which Google account, and is Google sign-in offered. */
export interface SessionInfo {
  signedIn: boolean;
  email: string | null;
  google: boolean;
}

const SIGNED_OUT: SessionInfo = { signedIn: false, email: null, google: false };
const plainFetch: typeof fetch = (input, init) => fetch(input, init);

/**
 * Asks the server whether this browser may edit: by its session cookie, or by `key` when one is given.
 * Never throws. If the server can't be reached the answer is "signed out", and the sign-in page is shown;
 * the next real request then says what is wrong.
 */
export async function fetchSession(key: string | null = getOwnerKey(), fetchImpl: typeof fetch = plainFetch): Promise<SessionInfo> {
  try {
    const res = await fetchImpl('/api/session', key ? { headers: { Authorization: `Bearer ${key}` } } : {});
    if (!res.ok) return SIGNED_OUT;
    const body = (await res.json()) as Partial<SessionInfo> | null;
    return { signedIn: body?.signedIn === true, email: typeof body?.email === 'string' ? body.email : null, google: body?.google === true };
  } catch {
    return SIGNED_OUT;
  }
}

/** Ends the Google session. Quiet on failure: the caller forgets the owner key and shows the sign-in page either way. */
export async function signOut(fetchImpl: typeof fetch = plainFetch): Promise<void> {
  try {
    await fetchImpl('/auth/logout', { method: 'POST' });
  } catch {
    // offline: the cookie stays until it runs out; nothing more to do from here
  }
}

/** Where the "Sign in with Google" link goes. `next` is the page to come back to. */
export const googleSignInUrl = (next: string): string => `/auth/google?next=${encodeURIComponent(next)}`;

const SIGN_IN_FAILURES: Record<string, string> = {
  cancelled: 'Signing in with Google was cancelled.',
  expired: 'That sign-in took too long. Try again.',
  notallowed: 'That Google account isn’t allowed to edit these maps.',
  failed: 'Signing in with Google didn’t work. Try again.',
};

/** When Google's sign-in fails, the Worker sends the browser to `/?signin=<reason>`: the reason in words. */
export function signInFailure(search: string): string | undefined {
  const reason = new URLSearchParams(search).get('signin');
  return reason === null ? undefined : (SIGN_IN_FAILURES[reason] ?? SIGN_IN_FAILURES.failed);
}
