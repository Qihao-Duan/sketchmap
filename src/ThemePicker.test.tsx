// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import type { SiteTheme } from './shared/theme';
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
const select = () => container.querySelector('select') as HTMLSelectElement;
async function choose(value: string) {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
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
  it('offers Light, Dark and Follow system, showing the saved setting', () => {
    mount(vi.fn(), { 'data-site-theme': 'system' });
    expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow system']]);
    expect(select().value).toBe('system');
    expect(container.querySelector('label')!.textContent).toMatch(/^Theme/);
  });

  it('changes the page at once, saves the choice, and is locked until the save is answered', async () => {
    const pending = deferred();
    const save = vi.fn(() => pending.promise);
    mount(save);
    await choose('dark');
    expect(save).toHaveBeenCalledWith('dark');
    expect([html.dataset.siteTheme, html.dataset.theme]).toEqual(['dark', 'dark']);
    expect(select().disabled).toBe(true);
    await act(async () => pending.resolve());
    expect(select().disabled).toBe(false);
    expect(select().value).toBe('dark');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await choose('system');
    expect(save).toHaveBeenLastCalledWith('system');
    expect([html.dataset.siteTheme, html.hasAttribute('data-theme')]).toEqual(['system', false]);
  });

  it('when the save fails, puts the page back exactly as it was (a ?theme= look included) and says why', async () => {
    const pending = deferred();
    // Opened with ?theme=dark while the site is light.
    mount(() => pending.promise, { 'data-site-theme': 'light', 'data-theme': 'dark' });
    await choose('system');
    expect(html.hasAttribute('data-theme')).toBe(false);
    await act(async () => pending.reject(new ApiError(401, 'Unauthorized')));
    expect([html.dataset.siteTheme, html.dataset.theme]).toEqual(['light', 'dark']);
    expect(select().value).toBe('light');
    expect(select().disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t save the theme: sign in again.');
  });

  it('names an offline failure and a server refusal differently, and clears the message on the next try', async () => {
    const save = vi.fn<(t: SiteTheme) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(0, 'Network error'))
      .mockRejectedValueOnce(new ApiError(500, 'Internal error'))
      .mockResolvedValueOnce(undefined);
    mount(save);
    await choose('dark');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t save the theme: you seem to be offline.');
    await choose('dark');
    expect(container.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t save the theme: Internal error');
    await choose('dark');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(html.dataset.theme).toBe('dark');
  });
});
