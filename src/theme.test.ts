// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, showSiteTheme, siteThemeOf } from './theme';
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

describe('applyTheme', () => {
  it('sets data-theme, and removes it for null', () => {
    const root = document.createElement('html');
    applyTheme(root, 'dark');
    expect(root.dataset.theme).toBe('dark');
    applyTheme(root, null);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});
