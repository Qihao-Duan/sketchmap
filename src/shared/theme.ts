export type Theme = 'light' | 'dark';

/** `?theme=light|dark` forces the look, e.g. for a Notion page whose theme differs from the system's. */
export function themeFromSearch(search: string): Theme | null {
  const t = new URLSearchParams(search).get('theme');
  return t === 'light' || t === 'dark' ? t : null;
}
