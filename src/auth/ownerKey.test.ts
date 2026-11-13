import { describe, expect, it } from 'vitest';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from './ownerKey';

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
  it('uses the browser storage by default', () => {
    setOwnerKey('k');
    expect(getOwnerKey()).toBe('k');
    clearOwnerKey();
    expect(getOwnerKey()).toBeNull();
  });
});
