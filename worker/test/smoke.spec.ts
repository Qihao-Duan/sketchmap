import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';

describe('worker smoke', () => {
  it('answers unknown API paths with JSON 404', async () => {
    const res = await worker.fetch(new Request('http://x/api/nope'), env as unknown as Env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
