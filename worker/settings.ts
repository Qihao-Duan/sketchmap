import type { Env } from './index';
import { errorResponse, json } from './http';
import { DEFAULT_SITE_THEME, parseSiteTheme, type SiteTheme } from '../src/shared/theme';

/** The site's settings: one small object beside the maps, outside `maps/`, so the map list never sees it. */
export const SETTINGS_KEY = 'settings/site.json';

export interface SiteSettings {
  theme: SiteTheme;
}

/** The saved settings; the defaults when nothing is saved yet or the saved object is unreadable. Storage errors throw. */
async function loadSettings(env: Pick<Env, 'MAPS'>): Promise<SiteSettings> {
  const obj = await env.MAPS.get(SETTINGS_KEY);
  if (!obj) return { theme: DEFAULT_SITE_THEME };
  let data: unknown;
  try {
    data = await obj.json();
  } catch {
    return { theme: DEFAULT_SITE_THEME };
  }
  return { theme: parseSiteTheme((data as { theme?: unknown } | null)?.theme) ?? DEFAULT_SITE_THEME };
}

/** The theme to write into a served page. Never throws: a page is still served, in the default look, if storage fails. */
export async function pageSiteTheme(env: Pick<Env, 'MAPS'>): Promise<SiteTheme> {
  try {
    return (await loadSettings(env)).theme;
  } catch (e) {
    console.error(e);
    return DEFAULT_SITE_THEME;
  }
}

/** GET /api/settings: anyone may read them (every page, the embed included, shows the theme). */
export async function getSettings(env: Pick<Env, 'MAPS'>): Promise<Response> {
  return json(await loadSettings(env));
}

/** PUT /api/settings with `{ "theme": "light" | "dark" | "system" }`. The caller has checked that this is the owner. */
export async function saveSettings(request: Request, env: Pick<Env, 'MAPS'>): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Expected a JSON body');
  }
  const theme = parseSiteTheme((body as { theme?: unknown } | null)?.theme);
  if (!theme) return errorResponse(400, 'theme must be "light", "dark" or "system"');
  const settings: SiteSettings = { theme };
  await env.MAPS.put(SETTINGS_KEY, JSON.stringify(settings), { httpMetadata: { contentType: 'application/json' } });
  return json(settings);
}
