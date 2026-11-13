export type Theme = 'light' | 'dark';

/** `?theme=light|dark` forces the look, e.g. for a Notion page whose theme differs from the system's. */
export function themeFromSearch(search: string): Theme | null {
  const t = new URLSearchParams(search).get('theme');
  return t === 'light' || t === 'dark' ? t : null;
}

/** Forces `theme` on the document (`data-theme` on `<html>`); null follows the system. */
export function applyTheme(root: HTMLElement, theme: Theme | null): void {
  if (theme) root.dataset.theme = theme;
  else root.removeAttribute('data-theme');
}
