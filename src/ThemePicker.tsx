import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from './api/client';
import { SITE_THEMES, type SiteTheme } from './shared/theme';
import { currentLook, pickedLook, restoreLook, showSiteTheme, SITE_THEME_CHANGED, siteThemeOf, whileSaving, type Look } from './theme';

export const THEME_LABELS: Record<SiteTheme, string> = { light: 'Light', dark: 'Dark', system: 'System' };
const THEME_TITLES: Record<SiteTheme, string> = {
  light: 'Always light',
  dark: 'Always dark',
  system: 'Follow each viewer’s system setting (light or dark)',
};

function failure(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) return 'Couldn’t save the theme: sign in again.';
  if (e instanceof ApiError && e.status === 0) return 'Couldn’t save the theme: you seem to be offline.';
  return `Couldn’t save the theme: ${e instanceof Error ? e.message : String(e)}`;
}

/** The setting the server is known to hold, and how this page looked with it. */
interface Confirmed {
  value: SiteTheme;
  look: Look;
}
const snapshot = (root: HTMLElement): Confirmed => ({ value: siteThemeOf(root), look: currentLook(root) });

/**
 * Picks the theme for the whole site (the list, every editor, every embed): three buttons, like the layout switch.
 * The page changes at once; the choice is saved on the server, and if that fails the page goes back to the last saved
 * look and says why. One save at a time, so saves reach the server in order: a pick made meanwhile waits, and only the
 * latest waiting pick is sent. Every other click is sent, even of the choice this page thinks is saved: another window
 * may have changed it since. Nothing is ever disabled (that would drop keyboard focus onto the page, where the
 * editor's keys act on the map), and a mouse click leaves the focus where it was.
 */
export function ThemePicker({ save, root = document.documentElement }: { save(theme: SiteTheme): Promise<void>; root?: HTMLElement }) {
  const labelId = useId();
  const [value, setValue] = useState<SiteTheme>(() => siteThemeOf(root));
  const [error, setError] = useState<string>();
  const confirmed = useRef<Confirmed>(snapshot(root));
  const running = useRef(false);
  const waiting = useRef<SiteTheme | null>(null);

  // The page re-read the setting (back from the browser's memory, a tab shown or a window focused again): follow it.
  useEffect(() => {
    const follow = () => {
      confirmed.current = snapshot(root);
      setValue(confirmed.current.value);
      setError(undefined);
    };
    root.addEventListener(SITE_THEME_CHANGED, follow);
    return () => root.removeEventListener(SITE_THEME_CHANGED, follow);
  }, [root]);

  const run = async (next: SiteTheme) => {
    running.current = true;
    try {
      await whileSaving(root, save(next));
      confirmed.current = { value: next, look: pickedLook(next) };
    } catch (e) {
      waiting.current = null;
      restoreLook(root, confirmed.current.look);
      setValue(confirmed.current.value);
      setError(failure(e));
    } finally {
      running.current = false;
      const then = waiting.current;
      waiting.current = null;
      if (then !== null && then !== confirmed.current.value) void run(then);
    }
  };

  const pick = (next: SiteTheme) => {
    setValue(next);
    setError(undefined);
    showSiteTheme(root, next);
    if (running.current) waiting.current = next;
    else void run(next);
  };

  return (
    <span className="theme-pick">
      <span className="theme-label" id={labelId}>Theme</span>
      <span className="theme-options" role="group" aria-labelledby={labelId}>
        {SITE_THEMES.map((t) => (
          <button key={t} type="button" aria-pressed={value === t} title={THEME_TITLES[t]} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}>
            {THEME_LABELS[t]}
          </button>
        ))}
      </span>
      {error && <span role="alert" className="error">{error}</span>}
    </span>
  );
}
