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

// jsdom's 2D canvas context needs the optional `@napi-rs/canvas` native backend, which this project
// does not install. Without it, `HTMLCanvasElement.getContext('2d')` returns null and jsdom logs a
// "Not implemented" error on every call; real browsers always provide a working context. Production
// code (`canvasMeasure` in src/render/fonts.ts) assumes one is available, so stand in with just enough
// of the API (`font`, `measureText`) for jsdom tests that exercise it to get a number back instead of a
// crash or console noise.
if (typeof HTMLCanvasElement !== 'undefined') {
  const fakeContext = {
    font: '10px sans-serif',
    measureText: (text: string) => ({ width: text.length * (parseFloat(fakeContext.font) || 10) * 0.6 }) as TextMetrics,
  };
  HTMLCanvasElement.prototype.getContext = (() => fakeContext) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
