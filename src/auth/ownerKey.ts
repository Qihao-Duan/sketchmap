import { browserStorage } from '../storage';
import { isThisMachine } from './localKey';

const STORAGE_KEY = 'sketchmap:owner-key';

export function getOwnerKey(storage: Pick<Storage, 'getItem'> = browserStorage()): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setOwnerKey(key: string, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // blocked storage: the key works for this page only
  }
}

/**
 * Remembers the key the local dev server put into the page, as if it had been typed, so the developer's
 * own machine never asks for it. `key` is null in every build and on every other kind of server.
 */
export function adoptLocalOwnerKey(key: string | null, hostname: string, storage: Pick<Storage, 'setItem'> = browserStorage()): boolean {
  if (!key || !isThisMachine(hostname)) return false;
  setOwnerKey(key, storage);
  return true;
}

export function clearOwnerKey(storage: Pick<Storage, 'removeItem'> = browserStorage()): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
