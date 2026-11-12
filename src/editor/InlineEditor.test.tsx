// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../layout/map';
import { InlineEditor } from './InlineEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const box = computeLayout({ id: 'r', text: 'Root', children: [] }, (t, s) => t.length * s * 0.5).byId.get('r')!;
let container: HTMLDivElement;

function mount(props: Partial<Parameters<typeof InlineEditor>[0]> = {}) {
  const handlers = { onCommit: vi.fn(), onCancel: vi.fn(), onTab: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<InlineEditor box={box} view={{ tx: 0, ty: 0, k: 1 }} initialText="Root" selectAll {...handlers} {...props} />));
  return { ta: container.querySelector('textarea')!, ...handlers };
}
function type(ta: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (ta: HTMLElement, init: KeyboardEventInit) => act(() => void ta.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

afterEach(() => container.remove());

describe('InlineEditor', () => {
  it('focuses with the text selected and commits on Enter, once', () => {
    const t = mount();
    expect(document.activeElement).toBe(t.ta);
    type(t.ta, 'New text');
    key(t.ta, { key: 'Enter' });
    act(() => t.ta.blur());
    expect(t.onCommit).toHaveBeenCalledTimes(1);
    expect(t.onCommit).toHaveBeenCalledWith('New text');
  });
  it('keeps Shift+Enter as a line break, cancels on Escape and hands Tab over', () => {
    const t = mount();
    key(t.ta, { key: 'Enter', shiftKey: true });
    expect(t.onCommit).not.toHaveBeenCalled();
    key(t.ta, { key: 'Escape' });
    expect(t.onCancel).toHaveBeenCalledTimes(1);
    const u = mount();
    type(u.ta, 'Parent');
    key(u.ta, { key: 'Tab' });
    expect(u.onTab).toHaveBeenCalledWith('Parent');
  });
  it('ignores keys while an IME is composing', () => {
    const t = mount();
    key(t.ta, { key: 'Enter', isComposing: true });
    expect(t.onCommit).not.toHaveBeenCalled();
  });
  it('commits on blur', () => {
    const t = mount();
    act(() => t.ta.blur());
    expect(t.onCommit).toHaveBeenCalledWith('Root');
  });
  it('caps input at the 5000-character topic limit', () => {
    const t = mount();
    expect(t.ta.maxLength).toBe(5000);
  });
  it('lines up with a decorated topic: padding leaves room for the badge and the note icon', () => {
    const decoratedBox = computeLayout({ id: 'r', text: 'Root', priority: 1, note: 'n', children: [] }, (t, s) => t.length * s * 0.5).byId.get('r')!;
    const t = mount({ box: decoratedBox, view: { tx: 0, ty: 0, k: 1 } });
    expect(t.ta.style.paddingLeft).toBe(`${decoratedBox.style.padX + decoratedBox.badgeW}px`);
    expect(t.ta.style.paddingRight).toBe(`${decoratedBox.style.padX + decoratedBox.noteW}px`);
  });

  it('⌘/Ctrl K links the selected words: type a web address, Enter, and the editor keeps going', () => {
    const { ta, onCommit, onCancel } = mount({ initialText: 'Read the docs', selectAll: false });
    act(() => ta.setSelectionRange(9, 13));
    key(ta, { key: 'k', metaKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    expect(document.activeElement).toBe(url);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'example.com/docs');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(container.querySelector('input[aria-label="Link URL"]')).toBeNull();
    expect(ta.value).toBe('Read the [docs](https://example.com/docs)');
    expect(document.activeElement).toBe(ta);
    expect(onCommit).not.toHaveBeenCalled();
    key(ta, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Read the [docs](https://example.com/docs)');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl K with nothing selected links the whole text; a bad address shows an error and changes nothing', () => {
    const { ta } = mount({ initialText: 'Plan', selectAll: false });
    key(ta, { key: 'k', ctrlKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'javascript:alert(1)');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('http://');
    expect(ta.value).toBe('Plan');
    act(() => {
      setter.call(url, 'https://a.com');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(ta.value).toBe('[Plan](https://a.com)');
  });

  it('Escape in the link field closes only the field', () => {
    const { ta, onCancel } = mount({ initialText: 'Plan', selectAll: true });
    key(ta, { key: 'k', metaKey: true });
    key(container.querySelector('input[aria-label="Link URL"]')!, { key: 'Escape' });
    expect(container.querySelector('input[aria-label="Link URL"]')).toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('pasting a web address over selected words links them; other pastes are left alone', () => {
    const { ta } = mount({ initialText: 'Read the docs', selectAll: false });
    const paste = (text: string) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      act(() => void ta.dispatchEvent(ev));
      return ev;
    };
    act(() => ta.setSelectionRange(9, 13));
    expect(paste('https://example.com/docs').defaultPrevented).toBe(true);
    expect(ta.value).toBe('Read the [docs](https://example.com/docs)');
    act(() => ta.setSelectionRange(0, 4));
    expect(paste('not a url').defaultPrevented).toBe(false);
    act(() => ta.setSelectionRange(3, 3));
    expect(paste('https://b.com').defaultPrevented).toBe(false); // no selection: a normal paste (a bare URL)
  });

  it('an Enter that confirms IME composition in the link field does not apply the link', () => {
    const { ta } = mount({ initialText: 'Plan', selectAll: true });
    key(ta, { key: 'k', metaKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'https://a.com');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter', isComposing: true });
    expect(container.querySelector('input[aria-label="Link URL"]')).not.toBeNull();
    expect(ta.value).toBe('Plan');
  });

  it('going back to the text closes the link field and keeps editing; Tab stays in the field', () => {
    const { ta, onCommit } = mount({ initialText: 'Plan', selectAll: true });
    key(ta, { key: 'k', metaKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => void url.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    act(() => void url.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: ta })));
    expect(container.querySelector('input[aria-label="Link URL"]')).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });
});
