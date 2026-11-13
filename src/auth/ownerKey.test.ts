import { describe, expect, it } from 'vitest';
import { adoptLocalOwnerKey, clearOwnerKey, getOwnerKey, setOwnerKey } from './ownerKey';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('owner key storage', () => {
  it('stores a trimmed key, reads it back and clears it', () => {
    const s = memoryStorage();
    expect(getOwnerKey(s)).toBeNull();
    setOwnerKey('  secret  ', s);
    expect(getOwnerKey(s)).toBe('secret');
    clearOwnerKey(s);
    expect(getOwnerKey(s)).toBeNull();
  });
  it('returns null instead of throwing when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied'); } };
    expect(getOwnerKey(blocked)).toBeNull();
  });
  it('works with the default storage (the in-memory stand-in under node)', () => {
    setOwnerKey('k');
    expect(getOwnerKey()).toBe('k');
    clearOwnerKey();
    expect(getOwnerKey()).toBeNull();
  });
});

describe('the key handed over by the local dev server', () => {
  it('is remembered as if it had been typed, replacing an older one', () => {
    const s = memoryStorage();
    setOwnerKey('old', s);
    expect(adoptLocalOwnerKey('local', 'localhost', s)).toBe(true);
    expect(getOwnerKey(s)).toBe('local');
  });
  it('is ignored when there is none, which is every build except the local dev server', () => {
    const s = memoryStorage();
    expect(adoptLocalOwnerKey(null, 'localhost', s)).toBe(false);
    expect(adoptLocalOwnerKey('', 'localhost', s)).toBe(false);
    expect(getOwnerKey(s)).toBeNull();
  });
  it('is ignored when the page was not opened on this machine’s own address', () => {
    const s = memoryStorage();
    expect(adoptLocalOwnerKey('local', '192.168.1.5', s)).toBe(false);
    expect(adoptLocalOwnerKey('local', 'sketchmap.example.workers.dev', s)).toBe(false);
    expect(getOwnerKey(s)).toBeNull();
  });
});
