export type Theme = 'light' | 'dark';
/** The site's saved look: one setting for the list, every editor and every embed. 'system' follows each viewer's system. */
export type SiteTheme = Theme | 'system';

export const SITE_THEMES: readonly SiteTheme[] = ['light', 'dark', 'system'];
/** Until the owner picks one, the site is light: it does not follow the system on its own. */
export const DEFAULT_SITE_THEME: SiteTheme = 'light';

export function parseSiteTheme(value: unknown): SiteTheme | null {
  return SITE_THEMES.includes(value as SiteTheme) ? (value as SiteTheme) : null;
}

/** `?theme=light|dark` forces the look of one page, e.g. a Notion embed on a page whose theme differs from the site's. */
export function themeFromSearch(search: string): Theme | null {
  const t = new URLSearchParams(search).get('theme');
  return t === 'light' || t === 'dark' ? t : null;
}

/** The look a page shows: the link's `?theme=` first, then the site setting. null means "follow the system". */
export function shownTheme(override: Theme | null, site: SiteTheme): Theme | null {
  return override ?? (site === 'system' ? null : site);
}
