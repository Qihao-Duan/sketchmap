import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import { SETTINGS_KEY } from '../settings';

const E = env as unknown as Env;
const KEY = 'test-owner-key';

function call(path: string, init: RequestInit = {}, key: string | null = KEY) {
  const headers = new Headers(init.headers);
  if (key !== null) headers.set('Authorization', `Bearer ${key}`);
  return worker.fetch(new Request(`http://x${path}`, { ...init, headers }), E);
}
const putTheme = (body: unknown, key: string | null = KEY) =>
  call('/api/settings', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }, key);
const readTheme = async () => (await (await call('/api/settings', {}, null)).json()) as { theme: string };

afterEach(() => E.MAPS.delete(SETTINGS_KEY));

describe('settings API', () => {
  it('lets anyone read the theme, light until one is saved, without caching', async () => {
    const res = await call('/api/settings', {}, null);
    expect([res.status, await res.json()]).toEqual([200, { theme: 'light' }]);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('saves light, dark or system for the owner, and answers with what was saved', async () => {
    for (const theme of ['dark', 'system', 'light']) {
      const res = await putTheme({ theme });
      expect([res.status, await res.json()]).toEqual([200, { theme }]);
      expect(await readTheme()).toEqual({ theme });
    }
  });

  it('refuses to save without the right owner key, and changes nothing', async () => {
    await putTheme({ theme: 'dark' });
    for (const key of [null, 'wrong']) {
      const res = await putTheme({ theme: 'system' }, key);
      expect([res.status, await res.json()]).toEqual([401, { error: 'Unauthorized' }]);
    }
    expect(await readTheme()).toEqual({ theme: 'dark' });
  });

  it('refuses anything but light, dark or system, and a body that is not JSON', async () => {
    for (const body of [{ theme: 'Dark' }, { theme: 'blue' }, { theme: 1 }, {}, null, 'not json']) {
      expect((await putTheme(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await readTheme()).toEqual({ theme: 'light' });
  });

  it('answers other methods with 405', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH']) expect((await call('/api/settings', { method })).status, method).toBe(405);
  });

  it('is stored outside maps/, so the map list never shows it', async () => {
    await putTheme({ theme: 'dark' });
    expect(await E.MAPS.head(SETTINGS_KEY)).not.toBeNull();
    const list = (await (await call('/api/maps')).json()) as Array<{ id: string }>;
    expect(list.some((m) => m.id.includes('settings'))).toBe(false);
  });
});
