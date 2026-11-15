// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import type { SiteTheme } from './shared/theme';
import { refreshSiteTheme } from './theme';
import { ThemePicker } from './ThemePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let reactRoot: Root;
let html: HTMLElement;

/** `html` stands in for <html>, as the Worker served it: `attrs` are what it wrote. */
function mount(save: (t: SiteTheme) => Promise<void>, attrs: Record<string, string> = { 'data-site-theme': 'light', 'data-theme': 'light' }) {
  html = document.createElement('html');
  for (const [k, v] of Object.entries(attrs)) html.setAttribute(k, v);
  container = document.createElement('div');
  document.body.appendChild(container);
  reactRoot = createRoot(container);
  act(() => reactRoot.render(<ThemePicker save={save} root={html} />));
}
const buttons = () => [...container.querySelectorAll('.theme-options button')] as HTMLButtonElement[];
const button = (label: string) => buttons().find((b) => b.textContent === label)!;
const pressed = () => buttons().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;
const look = () => [html.getAttribute('data-site-theme'), html.getAttribute('data-theme')];
async function choose(label: string) {
  await act(async () => button(label).click());
}
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
afterEach(() => {
  act(() => reactRoot.unmount());
  container.remove();
});

describe('ThemePicker', () => {
  it('is a labelled group of three buttons, Light, Dark and System, with the saved setting pressed', () => {
    mount(vi.fn(), { 'data-site-theme': 'system' });
    expect(buttons().map((b) => [b.textContent, b.type])).toEqual([['Light', 'button'], ['Dark', 'button'], ['System', 'button']]);
    expect(pressed()).toEqual(['System']);
    const group = container.querySelector('[role="group"]')!;
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)!.textContent).toBe('Theme');
    expect(button('System').title).toMatch(/system setting/);
  });

  it('changes the page at once and saves the choice; "System" leaves the look to the system', async () => {
    const save = vi.fn(async () => {});
    mount(save);
    await choose('Dark');
    expect(save).toHaveBeenCalledWith('dark');
    expect(look()).toEqual(['dark', 'dark']);
    expect(pressed()).toEqual(['Dark']);
    await choose('System');
    expect(save).toHaveBeenLastCalledWith('system');
    expect(look()).toEqual(['system', null]);
    expect(alertText()).toBeNull();
  });

  it('never disables a button (that would drop keyboard focus onto the page), and a mouse press does not take focus', async () => {
    const pending = deferred();
    mount(() => pending.promise);
    await choose('Dark');
    expect(buttons().some((b) => b.disabled)).toBe(false);
    expect(container.querySelector('[role="group"]')!.getAttribute('aria-busy')).toBe('true');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('System').dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    await act(async () => pending.resolve());
    expect(container.querySelector('[role="group"]')!.hasAttribute('aria-busy')).toBe(false);
  });

  it('sends one save at a time: picks made meanwhile wait, and only the latest is sent, after the first is answered', async () => {
    const first = deferred();
    const save = vi.fn<(t: SiteTheme) => Promise<void>>().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    mount(save);
    await choose('Dark');
    await choose('System');
    await choose('Light');
    await choose('System');
    expect(save.mock.calls).toEqual([['dark']]);
    expect(look()).toEqual(['system', null]); // the page shows the latest pick at once
    await act(async () => first.resolve());
    expect(save.mock.calls).toEqual([['dark'], ['system']]);
    expect(pressed()).toEqual(['System']);
  });

  it('sends nothing more when the waiting pick is what was just saved', async () => {
    const first = deferred();
    const save = vi.fn<(t: SiteTheme) => Promise<void>>().mockReturnValueOnce(first.promise);
    mount(save);
    await choose('Dark');
    await choose('Light');
    await choose('Dark');
    await act(async () => first.resolve());
    expect(save.mock.calls).toEqual([['dark']]);
    expect(look()).toEqual(['dark', 'dark']);
  });

  it('when a save fails, puts the page back exactly as it was (a ?theme= look included), drops waiting picks, and says why', async () => {
    const pending = deferred();
    const save = vi.fn<(t: SiteTheme) => Promise<void>>().mockReturnValueOnce(pending.promise);
    // Opened with ?theme=dark while the site is light.
    mount(save, { 'data-site-theme': 'light', 'data-theme': 'dark' });
    await choose('System');
    await choose('Dark'); // waits
    await act(async () => pending.reject(new ApiError(401, 'Unauthorized')));
    expect(look()).toEqual(['light', 'dark']);
    expect(pressed()).toEqual(['Light']);
    expect(save).toHaveBeenCalledTimes(1);
    expect(alertText()).toBe('Couldn’t save the theme: sign in again.');
  });

  it('on a failure after an earlier save, goes back to that saved choice', async () => {
    const save = vi.fn<(t: SiteTheme) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new ApiError(500, 'Internal error'));
    mount(save);
    await choose('Dark');
    await choose('System');
    expect(look()).toEqual(['dark', 'dark']);
    expect(pressed()).toEqual(['Dark']);
    expect(alertText()).toBe('Couldn’t save the theme: Internal error');
  });

  it('names an offline failure, and clears the message on the next pick', async () => {
    const save = vi.fn<(t: SiteTheme) => Promise<void>>().mockRejectedValueOnce(new ApiError(0, 'Network error')).mockResolvedValue(undefined);
    mount(save);
    await choose('Dark');
    expect(alertText()).toBe('Couldn’t save the theme: you seem to be offline.');
    await choose('Dark');
    expect(alertText()).toBeNull();
    expect(look()).toEqual(['dark', 'dark']);
  });

  it('on a page opened with ?theme=, pressing the saved setting shows it on the page without saving again', async () => {
    const save = vi.fn(async () => {});
    mount(save, { 'data-site-theme': 'light', 'data-theme': 'dark' });
    await choose('Light');
    expect(save).not.toHaveBeenCalled();
    expect(look()).toEqual(['light', 'light']);
  });

  it('follows the setting when the page reads it again (back from the browser\'s memory, or a tab shown again)', async () => {
    mount(vi.fn(async () => {}));
    const answer = (theme: string) => vi.fn(async () => Response.json({ theme })) as unknown as typeof fetch;
    await act(async () => refreshSiteTheme(html, '', answer('dark')));
    expect(look()).toEqual(['dark', 'dark']);
    expect(pressed()).toEqual(['Dark']);
  });
});
