const STORAGE_KEY = 'sketchmap:owner-key';

export function getOwnerKey(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setOwnerKey(key: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // blocked storage: the key works for this page only
  }
}

export function clearOwnerKey(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
