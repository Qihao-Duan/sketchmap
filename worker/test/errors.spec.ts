import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../index';

function withThrowingMaps(): Env {
  const MAPS = {
    get: async () => {
      throw new Error('boom');
    },
  } as unknown as R2Bucket;
  return { ...(env as unknown as Env), MAPS };
}

describe('worker error handling', () => {
  it('returns JSON 500 with no-store when something in the /api/ branch throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await worker.fetch(new Request('http://x/api/maps/abcdefghijklmnopqrstu'), withThrowingMaps());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
