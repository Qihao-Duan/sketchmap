// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTheme, themeFromSearch } from './theme';

describe('themeFromSearch', () => {
  it('reads exactly light or dark, and ignores anything else', () => {
    expect(themeFromSearch('?theme=dark')).toBe('dark');
    expect(themeFromSearch('?x=1&theme=light')).toBe('light');
    expect(themeFromSearch('?theme=Dark')).toBeNull();
    expect(themeFromSearch('?theme=')).toBeNull();
    expect(themeFromSearch('?theme=blue')).toBeNull();
    expect(themeFromSearch('')).toBeNull();
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
