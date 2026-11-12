// Node's built-in global `localStorage`/`sessionStorage` (stable Web Storage API) are non-functional
// without a `--localstorage-file` path: they exist on `global` but lack getItem/setItem/removeItem/
// clear. Because they already exist, vitest's jsdom environment setup does not override them with
// jsdom's real Storage (its `populateGlobal` only replaces keys that are either absent from `global`
// or in its own hardcoded allowlist, which doesn't include these two). Every jsdom test that touches
// the real global Storage objects therefore needs a working stand-in; install one here, once, for all
// jsdom test files.
function createMemoryStorage(): Storage {
  const backing = new Map<string, string>();
  return {
    get length() {
      return backing.size;
    },
    clear: () => backing.clear(),
    getItem: (key) => (backing.has(key) ? backing.get(key)! : null),
    key: (index) => [...backing.keys()][index] ?? null,
    removeItem: (key) => void backing.delete(key),
    setItem: (key, value) => void backing.set(key, String(value)),
  };
}

if (typeof window !== 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', { value: createMemoryStorage(), configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: createMemoryStorage(), configurable: true });
  if ((window as unknown as typeof globalThis) !== globalThis) {
    Object.defineProperty(window, 'localStorage', { value: createMemoryStorage(), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: createMemoryStorage(), configurable: true });
  }
}
