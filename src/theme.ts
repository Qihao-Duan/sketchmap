// `Theme`, `SiteTheme` and the rules live in src/shared/theme.ts: the worker tsconfig includes src/shared, so the
// Worker writes the same `data-theme` and `data-site-theme` into the served HTML (see worker/assets.ts).
import { DEFAULT_SITE_THEME, parseSiteTheme, shownTheme, type SiteTheme, type Theme } from './shared/theme';

/** Forces `theme` on the document (`data-theme` on `<html>`); null follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme | null): void {
  if (theme) root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}

/** The site setting the Worker wrote into this page (`data-site-theme` on `<html>`), or the default. */
export function siteThemeOf(root: HTMLElement): SiteTheme {
  return parseSiteTheme(root.dataset.siteTheme) ?? DEFAULT_SITE_THEME;
}

/** Shows a newly picked site setting on this page, dropping any `?theme=` the page was opened with. */
export function showSiteTheme(root: HTMLElement, site: SiteTheme): void {
  root.dataset.siteTheme = site;
  applyTheme(root, shownTheme(null, site));
}
