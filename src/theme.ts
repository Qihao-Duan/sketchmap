// `Theme` and `themeFromSearch` live in src/shared/theme.ts: the worker tsconfig includes src/shared,
// so the Worker can read `?theme=` itself and set `data-theme` in the served HTML (see worker/assets.ts).
import type { Theme } from './shared/theme';

/** Forces `theme` on the document (`data-theme` on `<html>`); null follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme | null): void {
  if (theme) root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}
