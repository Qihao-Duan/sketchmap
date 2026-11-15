import { useState } from 'react';
import { ApiError } from './api/client';
import { SITE_THEMES, type SiteTheme } from './shared/theme';
import { showSiteTheme, siteThemeOf } from './theme';

export const THEME_LABELS: Record<SiteTheme, string> = { light: 'Light', dark: 'Dark', system: 'Follow system' };

function failure(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) return 'Couldn’t save the theme: sign in again.';
  if (e instanceof ApiError && e.status === 0) return 'Couldn’t save the theme: you seem to be offline.';
  return `Couldn’t save the theme: ${e instanceof Error ? e.message : String(e)}`;
}

function setOrRemove(el: HTMLElement, name: string, value: string | null) {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/**
 * Picks the theme for the whole site (the list, every editor, every embed). This page changes at once; the choice is
 * saved on the server, and if that fails the page goes back to how it looked and says why. Locked while saving, so two
 * saves can't reach the server in the wrong order.
 */
export function ThemePicker({ save, root = document.documentElement }: { save(theme: SiteTheme): Promise<void>; root?: HTMLElement }) {
  const [value, setValue] = useState<SiteTheme>(() => siteThemeOf(root));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const pick = async (next: SiteTheme) => {
    const was = { value, theme: root.getAttribute('data-theme'), site: root.getAttribute('data-site-theme') };
    setValue(next);
    setSaving(true);
    setError(undefined);
    showSiteTheme(root, next);
    try {
      await save(next);
    } catch (e) {
      setValue(was.value);
      setOrRemove(root, 'data-theme', was.theme);
      setOrRemove(root, 'data-site-theme', was.site);
      setError(failure(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="theme-pick">
      <label>
        Theme{' '}
        <select value={value} disabled={saving} onChange={(e) => void pick(e.target.value as SiteTheme)}>
          {SITE_THEMES.map((t) => (
            <option key={t} value={t}>{THEME_LABELS[t]}</option>
          ))}
        </select>
      </label>
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  );
}
