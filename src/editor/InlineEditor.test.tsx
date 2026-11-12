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
});
