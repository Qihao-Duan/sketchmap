import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchSession, signInFailure, signOut, type SessionInfo } from './access';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from './ownerKey';

/** Whether this browser may edit. `out` carries what the sign-in page needs: is Google offered, and anything to say. */
export type Access =
  | { state: 'checking' }
  | { state: 'in'; email: string | null }
  | { state: 'out'; google: boolean; message?: string };

export interface AccessControls {
  access: Access;
  /** The owner key was typed in. */
  enterKey(key: string): void;
  /** A request came back 401: forget a stored key and look again. */
  rejected(): void;
  signOut(): Promise<void>;
}

/**
 * The owner pages' gate. A stored owner key counts as "in" at once, as it always did (a wrong one shows up
 * as a 401 on the first request). Without a key, the server is asked whether a Google session is open.
 */
export function useAccess(session: (key?: string | null) => Promise<SessionInfo> = fetchSession): AccessControls {
  const [access, setAccess] = useState<Access>(() => (getOwnerKey() ? { state: 'in', email: null } : { state: 'checking' }));
  const alive = useRef(true);
  const latest = useRef(0);

  const check = useCallback((message?: string) => {
    const mine = ++latest.current;
    setAccess({ state: 'checking' });
    void session().then((s) => {
      // An answer that arrives after a newer question, or after the page is gone, is dropped.
      if (!alive.current || mine !== latest.current) return;
      setAccess(s.signedIn ? { state: 'in', email: s.email } : { state: 'out', google: s.google, message });
    });
  }, [session]);

  useEffect(() => {
    alive.current = true;
    // A failed Google sign-in lands on /?signin=<reason>: say why once, and tidy the address.
    const failure = signInFailure(location.search);
    if (failure !== undefined) {
      const params = new URLSearchParams(location.search);
      params.delete('signin');
      history.replaceState(history.state, '', location.pathname + (params.size ? `?${params}` : '') + location.hash);
    }
    if (!getOwnerKey()) check(failure);
    return () => {
      alive.current = false;
    };
  }, [check]);

  const enterKey = useCallback((key: string) => {
    latest.current++; // a look that is still under way no longer matters
    setOwnerKey(key);
    setAccess({ state: 'in', email: null });
  }, []);

  const rejected = useCallback(() => {
    const hadKey = !!getOwnerKey();
    clearOwnerKey();
    check(hadKey ? 'That owner key was rejected. Check it and try again.' : 'Your sign-in has ended. Sign in again.');
  }, [check]);

  const leave = useCallback(async () => {
    await signOut();
    clearOwnerKey();
    check();
  }, [check]);

  return { access, enterKey, rejected, signOut: leave };
}
