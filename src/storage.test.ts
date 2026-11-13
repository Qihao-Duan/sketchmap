import { describe, expect, it } from 'vitest';
import { createBrowserStorage } from './storage';

const real = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
};

describe('createBrowserStorage', () => {
  it('uses the browser storage when it can be read', () => {
    const store = real();
    expect(createBrowserStorage(() => store)).toBe(store);
  });

  it('falls back to a working in-memory store when reading the storage throws', () => {
    const s = createBrowserStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(s.getItem('k')).toBeNull();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    expect(s.length).toBe(1);
    expect(s.key(0)).toBe('k');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('falls back when the storage object exists but refuses reads', () => {
    const broken = { ...real(), getItem: () => { throw new DOMException('denied', 'SecurityError'); } } as Storage;
    const s = createBrowserStorage(() => broken);
    expect(s).not.toBe(broken);
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
  });

  it('keeps a full storage that can still be read (the stored owner key must stay reachable)', () => {
    const full = { ...real(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } as Storage;
    expect(createBrowserStorage(() => full)).toBe(full);
  });
});
