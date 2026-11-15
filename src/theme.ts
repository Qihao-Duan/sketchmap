// `Theme`, `SiteTheme` and the rules live in src/shared/theme.ts: the worker tsconfig includes src/shared, so the
// Worker writes the same `data-theme` and `data-site-theme` into the served HTML (see worker/assets.ts).
import { DEFAULT_SITE_THEME, parseSiteTheme, shownTheme, themeFromSearch, type SiteTheme, type Theme } from './shared/theme';

/** Fired on `<html>` when `refreshSiteTheme` has shown the saved setting again, so the picker can follow. */
export const SITE_THEME_CHANGED = 'sketchmap:site-theme';

/** What this page has done with the setting: picks made here, saves started here, saves still running. */
interface PageState {
  picks: number;
  savesStarted: number;
  saving: number;
}
const pages = new WeakMap<HTMLElement, PageState>();
function stateOf(root: HTMLElement): PageState {
  let s = pages.get(root);
  if (!s) pages.set(root, (s = { picks: 0, savesStarted: 0, saving: 0 }));
  return s;
}

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
  stateOf(root).picks++;
  root.dataset.siteTheme = site;
  applyTheme(root, shownTheme(null, site));
}

/** Runs a save of the setting, marked as running so `refreshSiteTheme` can't put an older answer over it. */
export async function whileSaving<T>(root: HTMLElement, saving: Promise<T>): Promise<T> {
  const s = stateOf(root);
  s.savesStarted++;
  s.saving++;
  try {
    return await saving;
  } finally {
    s.saving--;
  }
}

/**
 * Reads the saved setting again and shows it. For a page the browser brings back from memory (Back/Forward) or a tab
 * shown again: either may have been served before the setting last changed. Does nothing while this page is saving a
 * pick, and drops the answer if this page picked or started a save meanwhile (the answer may predate that save). A
 * `?theme=` on the address still wins, unless the owner picked on this page. Never throws.
 */
export async function refreshSiteTheme(
  root: HTMLElement,
  search: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<void> {
  const s = stateOf(root);
  if (s.saving) return;
  const before = { picks: s.picks, savesStarted: s.savesStarted };
  let site: SiteTheme | null;
  try {
    const res = await fetchImpl('/api/settings', { cache: 'no-store' });
    if (!res.ok) return;
    site = parseSiteTheme(((await res.json()) as { theme?: unknown } | null)?.theme);
  } catch {
    return;
  }
  if (!site || s.saving || s.picks !== before.picks || s.savesStarted !== before.savesStarted) return;
  root.dataset.siteTheme = site;
  applyTheme(root, shownTheme(s.picks > 0 ? null : themeFromSearch(search), site));
  root.dispatchEvent(new Event(SITE_THEME_CHANGED));
}
