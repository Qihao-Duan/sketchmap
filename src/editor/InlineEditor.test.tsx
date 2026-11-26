// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../layout/map';
import type { Measure } from '../layout/wrap';
import { InlineEditor } from './InlineEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const measure: Measure = (t, s) => t.length * s * 0.5;
const box = computeLayout({ id: 'r', text: 'Root', children: [] }, measure).byId.get('r')!;
let container: HTMLDivElement;

function mount(props: Partial<Parameters<typeof InlineEditor>[0]> = {}) {
  const handlers = { onCommit: vi.fn(), onCancel: vi.fn(), onTab: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<InlineEditor box={box} view={{ tx: 0, ty: 0, k: 1 }} measure={measure} initialText="Root" selectAll {...handlers} {...props} />));
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

  it('refuses a link that would push the topic past 5000 characters', () => {
    const { ta } = mount({ initialText: 'x'.repeat(4990), selectAll: false });
    key(ta, { key: 'k', metaKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'example.com');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('5000');
    expect(ta.value).toHaveLength(4990);
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

  it('starts below the image, also while an image-only topic gets its first text', () => {
    const withImage = computeLayout({ id: 'r', text: '', image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }, children: [] }, (t, s) => t.length * s * 0.5).byId.get('r')!;
    const { ta } = mount({ box: withImage, initialText: '' });
    const imageBottom = withImage.y + withImage.image!.y + withImage.image!.h;
    expect(parseFloat(ta.style.top)).toBeGreaterThanOrEqual(imageBottom);
  });

  describe('the box is as wide as the topic will be', () => {
    const long = Array.from({ length: 24 }, () => 'word').join(' ');
    /** A map with a new, still empty topic on each side, and the boxes of both. */
    const shown = (extra: object = {}, text = '') => computeLayout({ id: 'r', text: 'Root', children: [
      { id: 'a', text: 'Alpha', side: 'right', children: [{ id: 't', text, children: [], ...extra }] },
      { id: 'b', text: 'Beta', side: 'left', children: [{ id: 'l', text, children: [], ...extra }] },
    ] }, measure);
    const px = (v: string) => parseFloat(v);

    it('an empty topic opens at the least width', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      expect(px(ta.style.width)).toBe(140);
    });

    it('it grows with the text that is typed, and stops where the topic’s text wraps', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      // 17 px text: 8.5 px a character. 24 characters and 2 × 5 px beside them, and 6 px for the border and some air.
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + 6);
      // A deeper topic wraps at 250 px: six of these words (29 characters) are its widest line.
      type(ta, long);
      expect(px(ta.style.width)).toBe(29 * 8.5 + 10 + 6);
    });

    it('a topic whose text width was set by hand grows up to that width', () => {
      const { ta } = mount({ box: shown({ wrap: 500 }).byId.get('t')!, initialText: '' });
      type(ta, long);
      // 500 px hold 58 characters: eleven of these words (54 characters).
      expect(px(ta.style.width)).toBe(54 * 8.5 + 10 + 6);
    });

    it('a line break ends a line: the widest line counts', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      type(ta, 'word word word word word\nword');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + 6);
    });

    it('it never gets narrower than the topic is now', () => {
      const t = shown({}, long).byId.get('t')!;
      const { ta } = mount({ box: t, initialText: long });
      const before = px(ta.style.width);
      expect(before).toBeGreaterThanOrEqual(t.w);
      type(ta, 'word');
      expect(px(ta.style.width)).toBe(Math.max(t.w, 140));
    });

    it('the room of a priority badge and of the note icon is added', () => {
      const t = shown({ priority: 1, note: 'n' }).byId.get('t')!;
      const { ta } = mount({ box: t, initialText: '' });
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + t.badgeW + t.noteW + 6);
    });

    it('zoomed, it is as wide on the screen as the topic will be there', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '', view: { tx: 0, ty: 0, k: 2 } });
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe((24 * 8.5 + 10) * 2 + 6);
    });

    it('with link syntax in it, it is wide enough for the address', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      type(ta, '[a](https://example.com)');
      expect(px(ta.style.width)).toBe(280);
    });

    it('it grows the way the topic will: to the right on the right of the map, to the left on the left, to both sides for the central topic', () => {
      const map = shown();
      const [t, l, r] = ['t', 'l', 'r'].map((id) => map.byId.get(id)!);
      expect([t.side, l.side]).toEqual([1, -1]);
      const view = { tx: 30, ty: 0, k: 1 };
      const right = mount({ box: t, initialText: '', view }).ta;
      type(right, long);
      expect(px(right.style.left)).toBe(30 + t.x);
      const left = mount({ box: l, initialText: '', view }).ta;
      type(left, long);
      expect(px(left.style.left) + px(left.style.width)).toBe(30 + l.x + l.w);
      const centre = mount({ box: r, initialText: 'Root', view }).ta;
      type(centre, long);
      expect(px(centre.style.left) + px(centre.style.width) / 2).toBe(30 + r.x + r.w / 2);
    });
  });
});
