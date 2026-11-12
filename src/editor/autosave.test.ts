import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../shared/types';
import { ApiError, type Saved } from '../api/client';
import { Autosaver, draftKey, readDraft, type AutosaveDeps, type SaveStatus } from './autosave';

const mapWith = (text: string): MindMap => ({ id: 'abcdefghijklmnopqrstu', title: text, layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text, children: [] } });

function setup(save: (map: MindMap, etag: string) => Promise<Saved>) {
  const store = new Map<string, string>();
  const statuses: SaveStatus[] = [];
  const saved: Saved[] = [];
  const deps: AutosaveDeps = {
    save: vi.fn(save),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
  const saver = new Autosaver(deps, '"e0"', (s) => statuses.push(s), (s) => saved.push(s));
  return { saver, deps, store, statuses, saved };
}
const ok = (n: number) => async (map: MindMap): Promise<Saved> => ({ map: { ...map, version: n }, etag: `"e${n}"` });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Autosaver', () => {
  it('writes a draft at once and saves the latest map 1 s after the last change', async () => {
    const t = setup(ok(1));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(600);
    t.saver.schedule(mapWith('ab'));
    expect(readDraft(t.deps.storage, 'abcdefghijklmnopqrstu')!.map.root.text).toBe('ab');
    await vi.advanceTimersByTimeAsync(999);
    expect(t.deps.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.deps.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.deps.save).mock.calls[0]).toEqual([mapWith('ab'), '"e0"']);
    expect(t.store.has(draftKey('abcdefghijklmnopqrstu'))).toBe(false);
    expect(t.statuses).toEqual(['pending', 'saving', 'saved']);
    expect(t.saver.currentEtag).toBe('"e1"');
  });

  it('uses the ETag from the previous save for the next one', async () => {
    let n = 0;
    const t = setup(async (map) => ({ map, etag: `"e${++n}"` }));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    t.saver.schedule(mapWith('b'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(t.deps.save).mock.calls.map((c) => c[1])).toEqual(['"e0"', '"e1"']);
  });

  it('retries network failures after 2 s, 4 s, 8 s … and keeps the draft meanwhile', async () => {
    let calls = 0;
    const t = setup(async (map) => {
      calls++;
      if (calls <= 3) throw new ApiError(0, 'offline');
      return { map, etag: '"ok"' };
    });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000); // 1st attempt fails
    expect(t.statuses.at(-1)).toBe('retrying');
    await vi.advanceTimersByTimeAsync(2000); // 2nd fails
    await vi.advanceTimersByTimeAsync(4000); // 3rd fails
    expect(t.store.size).toBe(1);
    await vi.advanceTimersByTimeAsync(7999);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1); // 4th succeeds after 8 s
    expect([calls, t.statuses.at(-1), t.store.size]).toEqual([4, 'saved', 0]);
  });

  it('stops on a conflict and continues after resume() with the server ETag', async () => {
    let first = true;
    const t = setup(async (map, etag) => {
      if (first) { first = false; throw new ApiError(409, 'changed', '"server"'); }
      return { map, etag: `${etag}+1` };
    });
    t.saver.schedule(mapWith('mine'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.statuses.at(-1)).toBe('conflict');
    t.saver.schedule(mapWith('mine2'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.deps.save).toHaveBeenCalledTimes(1);
    t.saver.resume('"server"');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(t.deps.save).mock.calls[1]).toEqual([mapWith('mine2'), '"server"']);
    expect(t.statuses.at(-1)).toBe('saved');
  });

  it('discard() drops pending changes and the draft, e.g. after loading a newer version', async () => {
    const t = setup(ok(1));
    t.saver.schedule(mapWith('a'));
    t.saver.discard('"fresh"', 'abcdefghijklmnopqrstu');
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.deps.save).not.toHaveBeenCalled();
    expect([t.store.size, t.saver.currentEtag, t.statuses.at(-1)]).toEqual([0, '"fresh"', 'saved']);
  });

  it('reports a rejected owner key as unauthorized', async () => {
    const t = setup(async () => { throw new ApiError(401, 'Unauthorized'); });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.statuses.at(-1)).toBe('unauthorized');
  });

  it('saves again when edits arrive during a save', async () => {
    let release!: () => void;
    let n = 0;
    const t = setup((map) => new Promise<Saved>((res) => { n++; release = () => res({ map, etag: `"e${n}"` }); }));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    t.saver.schedule(mapWith('ab'));
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(t.deps.save).mock.calls.map((c) => c[0].root.text)).toEqual(['a', 'ab']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.statuses.at(-1)).toBe('saved');
  });
});
