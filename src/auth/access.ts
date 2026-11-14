import { getOwnerKey } from './ownerKey';

/** What the server says about this browser: is it signed in, as which Google account, and is Google sign-in offered. */
export interface SessionInfo {
  signedIn: boolean;
  email: string | null;
  google: boolean;
  /** The server gave no usable answer (no connection, or an error on its side), so the rest is unknown. */
  unreachable?: boolean;
}

const SIGNED_OUT: SessionInfo = { signedIn: false, email: null, google: false };
const UNREACHABLE: SessionInfo = { ...SIGNED_OUT, unreachable: true };
const plainFetch: typeof fetch = (input, init) => fetch(input, init);

/**
 * Asks the server whether this browser may edit: by its session cookie, or by `key` when one is given.
 * Never throws. When the server can't be reached, or fails, the answer is "signed out" and marked
 * `unreachable`, so the page can say so and offer to try again instead of looking plainly signed out.
 */
export async function fetchSession(key: string | null = getOwnerKey(), fetchImpl: typeof fetch = plainFetch): Promise<SessionInfo> {
  try {
    const res = await fetchImpl('/api/session', key ? { headers: { Authorization: `Bearer ${key}` } } : {});
    if (res.status >= 500) return UNREACHABLE;
    if (!res.ok) return SIGNED_OUT;
    const body = (await res.json()) as Partial<SessionInfo> | null;
    return { signedIn: body?.signedIn === true, email: typeof body?.email === 'string' ? body.email : null, google: body?.google === true };
  } catch {
    return UNREACHABLE; // no connection, or an answer that is not JSON
  }
}

/**
 * Ends the Google session in this browser. Resolves false when the server did not confirm it (no connection,
 * or an error): the session cookie can't be removed from here, so the browser is then still signed in.
 */
export async function signOut(fetchImpl: typeof fetch = plainFetch): Promise<boolean> {
  try {
    return (await fetchImpl('/auth/logout', { method: 'POST' })).ok;
  } catch {
    return false;
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
