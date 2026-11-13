/** A store that lasts only as long as the page: the stand-in when the browser blocks site data. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

/**
 * `localStorage`, or an in-memory stand-in when the browser refuses it: with site data blocked, reading
 * `localStorage` itself throws. Only reading is probed, so a storage that is merely full stays in use and
 * what it already holds (the owner key) stays reachable.
 */
export function createBrowserStorage(read: () => Storage = () => localStorage): Storage {
  try {
    const storage = read();
    storage.getItem('sketchmap:probe');
    return storage;
  } catch {
    return memoryStorage();
  }
}

let shared: Storage | undefined;

/** The one storage every page uses. With the stand-in, the owner key, drafts and panel state last until the page is closed or reloaded. */
export function browserStorage(): Storage {
  shared ??= createBrowserStorage();
  return shared;
}
