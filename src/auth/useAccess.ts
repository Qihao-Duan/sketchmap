import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSession, signInFailure, signOut, type SessionInfo } from './access';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from './ownerKey';

/**
 * Whether this browser may edit. `out` carries what the sign-in page needs: is Google offered, anything to
 * say, and whether the server could not be asked at all (then the page offers to try again).
 */
export type Access =
  | { state: 'checking' }
  | { state: 'in'; email: string | null }
  | { state: 'out'; google: boolean; message?: string; unreachable?: boolean };

export interface AccessControls {
  access: Access;
  /** The owner key was typed in. */
  enterKey(key: string): void;
  /** A request came back 401: forget a stored key and look again. Safe to call for every refused request. */
  rejected(): void;
  /** Ask the server again (after it could not be reached). */
  recheck(): void;
  /** Resolves false, changing nothing, when the server did not confirm the sign-out. */
  signOut(): Promise<boolean>;
}

const UNREACHABLE = 'Couldn’t reach the server to check your sign-in. Check your connection, then try again.';

/**
 * The owner pages' gate. A stored owner key counts as "in" at once, as it always did (a wrong one shows up
 * as a 401 on the first request). Without a key, the server is asked whether a Google session is open.
 */
export function useAccess(session: (key?: string | null) => Promise<SessionInfo> = fetchSession): AccessControls {
  const [access, setAccessState] = useState<Access>(() => (getOwnerKey() ? { state: 'in', email: null } : { state: 'checking' }));
  const current = useRef(access);
  const setAccess = useCallback((next: Access) => {
    current.current = next;
    setAccessState(next);
  }, []);
  const alive = useRef(true);
  const latest = useRef(0);
  // Read during the first render, before the effect below tidies the address. In development React runs
  // that effect twice; the second run must still have the reason to show.
  const failure = useRef<{ text: string | undefined } | null>(null);
  failure.current ??= { text: signInFailure(location.search) };

  /**
   * Asks the server and settles on "in" or "out". `mustLeave`: the server has just refused this browser's
   * session, so whatever it now says about being signed in, the user goes to the sign-in page. Without that,
   * a server that said "signed in" and then refused the next request would be asked again and again.
   */
  const check = useCallback((message?: string, mustLeave = false) => {
    const mine = ++latest.current;
    setAccess({ state: 'checking' });
    void session().then((s) => {
      // An answer that arrives after a newer question, or after the page is gone, is dropped.
      if (!alive.current || mine !== latest.current) return;
      if (s.signedIn && !mustLeave) setAccess({ state: 'in', email: s.email });
      else if (s.unreachable) setAccess({ state: 'out', google: false, message: UNREACHABLE, unreachable: true });
      else setAccess({ state: 'out', google: s.google, message });
    });
  }, [session, setAccess]);

  useEffect(() => {
    alive.current = true;
    // A failed Google sign-in lands on /?signin=<reason>: say why once, and tidy the address.
    const params = new URLSearchParams(location.search);
    if (params.has('signin')) {
      params.delete('signin');
      history.replaceState(history.state, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
    }
    if (!getOwnerKey()) check(failure.current?.text);
    return () => {
      alive.current = false;
    };
  }, [check]);

  const enterKey = useCallback((key: string) => {
    latest.current++; // a look that is still under way no longer matters
    setOwnerKey(key);
    setAccess({ state: 'in', email: null });
  }, [setAccess]);

  const rejected = useCallback(() => {
    // Several requests can be refused together; only the first refusal of a signed-in page counts. A later
    // one would find the key already forgotten and blame the wrong thing.
    if (current.current.state !== 'in') return;
    const hadKey = !!getOwnerKey();
    clearOwnerKey();
    // A refused key may sit on top of a good Google session, so that is looked for. A refused session is over.
    if (hadKey) check('That owner key was rejected. Check it and try again.');
    else check('Your sign-in has ended. Sign in again.', true);
  }, [check]);

  const recheck = useCallback(() => check(), [check]);

  const leave = useCallback(async () => {
    if (!(await signOut())) return false;
    clearOwnerKey();
    check();
    return true;
  }, [check]);

  return { access, enterKey, rejected, recheck, signOut: leave };
}
