// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { applyTheme, refreshSiteTheme, showSiteTheme, SITE_THEME_CHANGED, siteThemeOf, whileSaving } from './theme';
import { DEFAULT_SITE_THEME, parseSiteTheme, shownTheme, themeFromSearch } from './shared/theme';

describe('themeFromSearch', () => {
  it('reads exactly light or dark, and ignores anything else', () => {
    expect(themeFromSearch('?theme=dark')).toBe('dark');
    expect(themeFromSearch('?x=1&theme=light')).toBe('light');
    expect(themeFromSearch('?theme=Dark')).toBeNull();
    expect(themeFromSearch('?theme=')).toBeNull();
    expect(themeFromSearch('?theme=blue')).toBeNull();
    expect(themeFromSearch('?theme=system')).toBeNull();
    expect(themeFromSearch('')).toBeNull();
  });
});

describe('the site theme', () => {
  it('is light until the owner picks another: it does not follow the system on its own', () => {
    expect(DEFAULT_SITE_THEME).toBe('light');
  });

  it('accepts exactly light, dark and system', () => {
    expect(['light', 'dark', 'system'].map(parseSiteTheme)).toEqual(['light', 'dark', 'system']);
    for (const bad of ['Dark', '', 'blue', null, undefined, 1, {}]) expect(parseSiteTheme(bad)).toBeNull();
  });

  it('is shown unless the link says ?theme=, and "system" leaves the look to the system (null)', () => {
    expect(shownTheme(null, 'light')).toBe('light');
    expect(shownTheme(null, 'dark')).toBe('dark');
    expect(shownTheme(null, 'system')).toBeNull();
    expect(shownTheme('dark', 'light')).toBe('dark');
    expect(shownTheme('light', 'system')).toBe('light');
  });

  it('is read back from the page, with the default when the Worker did not write it', () => {
    const root = document.createElement('html');
    expect(siteThemeOf(root)).toBe('light');
    root.dataset.siteTheme = 'system';
    expect(siteThemeOf(root)).toBe('system');
    root.dataset.siteTheme = 'purple';
    expect(siteThemeOf(root)).toBe('light');
  });

  it('once picked, shows on the page at once, replacing a ?theme= look', () => {
    const root = document.createElement('html');
    root.dataset.theme = 'light'; // e.g. opened with ?theme=light
    showSiteTheme(root, 'dark');
    expect([root.dataset.siteTheme, root.dataset.theme]).toEqual(['dark', 'dark']);
    showSiteTheme(root, 'system');
    expect([root.dataset.siteTheme, root.hasAttribute('data-theme')]).toEqual(['system', false]);
  });
});

describe('refreshSiteTheme', () => {
  const answering = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;
  const served = (attrs: Record<string, string>) => {
    const root = document.createElement('html');
    for (const [k, v] of Object.entries(attrs)) root.setAttribute(k, v);
    return root;
  };
  const look = (root: HTMLElement) => [root.getAttribute('data-site-theme'), root.getAttribute('data-theme')];

  it('shows the setting the server holds now, asks without the browser cache, and tells the picker', async () => {
    const root = served({ 'data-site-theme': 'light', 'data-theme': 'light' });
    const heard = vi.fn();
    root.addEventListener(SITE_THEME_CHANGED, heard);
    const fetchImpl = answering({ theme: 'system' });
    await refreshSiteTheme(root, '', fetchImpl);
    expect(look(root)).toEqual(['system', null]);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0]).toEqual(['/api/settings', { cache: 'no-store' }]);
  });

  it('keeps a ?theme= look, unless the owner picked on this page', async () => {
    const root = served({ 'data-site-theme': 'light', 'data-theme': 'dark' });
    await refreshSiteTheme(root, '?theme=dark', answering({ theme: 'light' }));
    expect(look(root)).toEqual(['light', 'dark']);
    showSiteTheme(root, 'system');
    await refreshSiteTheme(root, '?theme=dark', answering({ theme: 'light' }));
    expect(look(root)).toEqual(['light', 'light']);
  });

  it('changes nothing on a failure, an error answer or a garbled one', async () => {
    const root = served({ 'data-site-theme': 'dark', 'data-theme': 'dark' });
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    for (const f of [offline, answering({ error: 'x' }, 500), answering({ theme: 'purple' }), answering(null)]) {
      await refreshSiteTheme(root, '', f);
      expect(look(root)).toEqual(['dark', 'dark']);
    }
  });

  it('does nothing while this page is saving a pick, and drops an answer that a pick or a save overtook', async () => {
    const root = served({ 'data-site-theme': 'light', 'data-theme': 'light' });
    let finish!: () => void;
    const saving = whileSaving(root, new Promise<void>((r) => { finish = r; }));
    const fetchImpl = answering({ theme: 'dark' });
    await refreshSiteTheme(root, '', fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    finish();
    await saving;

    // The answer was asked for before the pick: it may be older than the save that follows.
    let release!: (r: Response) => void;
    const slow = vi.fn(() => new Promise<Response>((r) => { release = r; })) as unknown as typeof fetch;
    const asked = refreshSiteTheme(root, '', slow);
    showSiteTheme(root, 'system');
    release(Response.json({ theme: 'dark' }));
    await asked;
    expect(look(root)).toEqual(['system', null]);

    const again = refreshSiteTheme(root, '', slow);
    await whileSaving(root, Promise.resolve());
    release(Response.json({ theme: 'dark' }));
    await again;
    expect(look(root)).toEqual(['system', null]);
  });
});

describe('applyTheme', () => {
  it('sets data-theme, and removes it for null', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root, null);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
