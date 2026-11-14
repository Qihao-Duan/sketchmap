// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignIn } from './SignIn';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
function mount(props: Partial<Parameters<typeof SignIn>[0]> = {}) {
  const onKey = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<SignIn google={false} next="/" onKey={onKey} {...props} />));
  return onKey;
}
function typeKey(value: string) {
  const input = container.querySelector('#owner-key') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => void container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
afterEach(() => container.remove());

describe('SignIn', () => {
  it('without Google, is the owner-key page as before, with any message as its error', () => {
    const onKey = mount({ message: 'That owner key was rejected. Check it and try again.' });
    expect(container.querySelector('h1')!.textContent).toBe('Enter your owner key');
    expect(container.querySelector('a.google-button')).toBeNull();
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/rejected/);
    typeKey('  my-key  ');
    expect(onKey).toHaveBeenCalledWith('my-key');
  });

  it('with Google, offers the Google link first, back to the page asked for, and keeps the owner key one click away', () => {
    const onKey = mount({ google: true, next: '/e/abcdefghijklmnopqrstu', message: 'Your sign-in has ended. Sign in again.' });
    const link = container.querySelector('a.google-button') as HTMLAnchorElement;
    expect(link.textContent).toBe('Sign in with Google');
    expect(link.getAttribute('href')).toBe('/auth/google?next=%2Fe%2Fabcdefghijklmnopqrstu');
    expect(link.target).toBe(''); // same tab: the session cookie is set on the way back
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')!.textContent).toMatch(/has ended/);
    expect(container.querySelector('details summary')!.textContent).toBe('Use the owner key instead');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    typeKey('k2');
    expect(onKey).toHaveBeenCalledWith('k2');
  });

  it('offers "Try again" only when there is something to retry, in both layouts, and tells when the Google link is followed', () => {
    mount();
    expect(container.querySelector('button.retry')).toBeNull();
    container.remove();
    const onRetry = vi.fn();
    mount({ onRetry });
    act(() => (container.querySelector('button.retry') as HTMLButtonElement).click());
    expect(onRetry).toHaveBeenCalledTimes(1);
    container.remove();
    const onGoogle = vi.fn();
    mount({ google: true, onRetry, onGoogle });
    expect(container.querySelector('button.retry')!.textContent).toBe('Try again');
    const link = container.querySelector('a.google-button')!;
    link.addEventListener('click', (e) => e.preventDefault()); // jsdom has no navigation
    act(() => void link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
    expect(onGoogle).toHaveBeenCalledTimes(1);
  });
});
