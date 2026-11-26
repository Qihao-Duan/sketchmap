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

    it('an empty topic opens at the least width, with room for the word that stands in for its text', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      expect(px(ta.style.width)).toBe(140);
      expect(ta.placeholder).toBe('Topic');
      expect(140 - 3 - px(ta.style.paddingLeft) - px(ta.style.paddingRight)).toBe(measure('Topic', 17) + 2);
    });

    it('it grows with the text that is typed, and stops where the topic’s text wraps', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      // 17 px text: 8.5 px a character. 24 characters and 2 × 5 px beside them, and 5 px for the border and some air.
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + 5);
      // A deeper topic wraps at 250 px: six of these words (29 characters) are its widest line.
      type(ta, long);
      expect(px(ta.style.width)).toBe(29 * 8.5 + 10 + 5);
    });

    it('a topic whose text width was set by hand grows up to that width', () => {
      const { ta } = mount({ box: shown({ wrap: 500 }).byId.get('t')!, initialText: '' });
      type(ta, long);
      // 500 px hold 58 characters: eleven of these words (54 characters).
      expect(px(ta.style.width)).toBe(54 * 8.5 + 10 + 5);
    });

    it('a line break ends a line: the widest line counts', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      type(ta, 'word word word word word\nword');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + 5);
    });

    it('it never gets narrower than the topic is now', () => {
      const t = shown({}, long).byId.get('t')!;
      const { ta } = mount({ box: t, initialText: long });
      const before = px(ta.style.width);
      expect(before).toBe(t.w + 5);
      type(ta, 'word');
      expect(px(ta.style.width)).toBe(t.w + 5);
    });

    it('the room of a priority badge and of the note icon is added', () => {
      const t = shown({ priority: 1, note: 'n' }).byId.get('t')!;
      const { ta } = mount({ box: t, initialText: '' });
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe(24 * 8.5 + 10 + t.badgeW + t.noteW + 5);
    });

    it('zoomed, it is as wide on the screen as the topic will be there; the air is 2 px of the map at every zoom', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '', view: { tx: 0, ty: 0, k: 2 } });
      type(ta, 'word word word word word');
      // The border is 3 px on the screen whatever the zoom.
      expect(px(ta.style.width)).toBe((24 * 8.5 + 10 + 2) * 2 + 3);
      const small = mount({ box: shown({ wrap: 500 }).byId.get('t')!, initialText: '', view: { tx: 0, ty: 0, k: 0.5 } }).ta;
      type(small, long);
      expect(px(small.style.width)).toBe((54 * 8.5 + 10 + 2) * 0.5 + 3);
    });

    it('it is measured on what the topic will show, not on what is typed: a link’s address does not count', () => {
      const address = `https://example.org/${'a-very-long-path/'.repeat(9)}`;
      expect(address.length).toBeGreaterThan(170);
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      // The topic shows "Read the docs first": 19 characters. The least width for a text with link syntax is more.
      type(ta, `Read [the docs](${address}) first`);
      expect(px(ta.style.width)).toBe(280);
      // A bare address is shown shortened (28 characters at most): the box is not as wide as the address.
      type(ta, address);
      expect(px(ta.style.width)).toBe(280);
      // With more text beside the link, the box follows the text.
      type(ta, `${long} [the docs](${address})`);
      expect(px(ta.style.width)).toBe(280);
      const wide = mount({ box: shown({ wrap: 500 }).byId.get('t')!, initialText: '' }).ta;
      type(wide, `${long} [the docs](${address})`);
      expect(px(wide.style.width)).toBe(54 * 8.5 + 10 + 5);
    });

    it('a word longer than the topic’s width does not make it wider than that: the box breaks such a word', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      type(ta, 'x'.repeat(80));
      expect(px(ta.style.width)).toBe(250 + 10 + 5);
    });

    it('the marker that the topic shows before its text counts', () => {
      const { ta } = mount({ box: shown({ emoji: '💡' }).byId.get('t')!, initialText: '' });
      type(ta, 'word word word word word');
      expect(px(ta.style.width)).toBe(measure('💡 word word word word word', 17) + 10 + 5);
    });

    it('opened on a short topic, the least width goes where it does not move the text: around centred text, after text that starts on the left', () => {
      const map = computeLayout({ id: 'r', text: 'Root', children: [
        { id: 'a', text: 'Aa', side: 'right', children: [{ id: 't', text: 'Leaf', children: [] }] },
        { id: 'b', text: 'Bb', side: 'left', children: [{ id: 'l', text: 'Leaf', children: [] }] },
      ] }, measure);
      const [a, b, t, l] = ['a', 'b', 't', 'l'].map((id) => map.byId.get(id)!);
      for (const box of [a, b]) {
        const { ta } = mount({ box, initialText: 'Aa' });
        expect(px(ta.style.width)).toBe(140);
        // Centred text: the middle of the box is the middle of the topic.
        expect(px(ta.style.left) + 70, box.id).toBe(box.x + box.w / 2);
      }
      for (const box of [t, l]) {
        const { ta } = mount({ box, initialText: 'Leaf' });
        expect(px(ta.style.width)).toBe(140);
        // Text from the left: the box starts where the topic does, less half of its border and air.
        expect(px(ta.style.left), box.id).toBe(box.x - 2.5);
      }
    });

    it('with link syntax in it, it is wide enough for the address', () => {
      const { ta } = mount({ box: shown().byId.get('t')!, initialText: '' });
      type(ta, '[a](https://example.com)');
      expect(px(ta.style.width)).toBe(280);
    });

    it('the least width adds room beside the text, not for it: the text wraps in the box where it wraps in the topic', () => {
      const map = computeLayout({ id: 'r', text: 'Root', children: [
        { id: 'a', text: 'Aa', side: 'right', children: [{ id: 't', text: '', children: [] }] },
      ] }, measure);
      const [a, t] = ['a', 't'].map((id) => map.byId.get(id)!);
      // An underlined topic: its text starts on the left, so the room is after it. A new topic is as wide
      // as the word that stands in for its text ("Topic", 5 characters) with 2 × 5 px beside it.
      const line = mount({ box: t, initialText: '' }).ta;
      expect(px(line.style.width)).toBe(140);
      expect(px(line.style.paddingLeft)).toBe(5);
      expect(px(line.style.paddingRight)).toBe(5 + 140 - (5 * 8.5 + 10 + 5));
      // Zoomed out, the wrap width is less than the least width on the screen: a long text still has
      // exactly the topic's 250 px (and the air) to wrap in.
      const far = mount({ box: t, initialText: '', view: { tx: 0, ty: 0, k: 0.5 } }).ta;
      type(far, long);
      expect(px(far.style.width)).toBe(140);
      const room = 140 - 3 - px(far.style.paddingLeft) - px(far.style.paddingRight);
      expect(room).toBe((29 * 8.5 + 2) * 0.5);
      // A boxed topic: its text is centred, so the room is on both sides.
      const boxed = mount({ box: a, initialText: 'Aa' }).ta;
      expect(px(boxed.style.paddingLeft)).toBe(16 + (140 - (a.w + 5)) / 2);
      expect(px(boxed.style.paddingRight)).toBe(16 + (140 - (a.w + 5)) / 2);
      // With link syntax the least width is there for the syntax to be read: it is room for the text.
      const link = mount({ box: t, initialText: '' }).ta;
      type(link, '[a](https://example.com)');
      expect(px(link.style.width)).toBe(280);
      expect(px(link.style.paddingRight)).toBe(5);
    });

    it('while it is open it never gets narrower: not when text is deleted, not when a link is recognised and shown as its short label', () => {
      const map = shown();
      const l = map.byId.get('l')!;
      const { ta } = mount({ box: l, initialText: '' });
      type(ta, 'a'.repeat(28));
      const [left, width] = [px(ta.style.left), px(ta.style.width)];
      expect(width).toBe(28 * 8.5 + 10 + 5);
      // On the left of the map the box grows to the left: getting narrower would move the text under the caret.
      type(ta, `https://example.org/${'a'.repeat(8)}`);
      expect(px(ta.style.left)).toBe(left);
      type(ta, `[a](https://example.org/${'a'.repeat(8)})`);
      expect(px(ta.style.left)).toBe(left);
      type(ta, 'a');
      expect([px(ta.style.left), px(ta.style.width)]).toEqual([left, width]);
    });

    it('it grows the way the topic will: to the right on the right of the map, to the left on the left, to both sides for the central topic', () => {
      const map = shown();
      const [t, l, r] = ['t', 'l', 'r'].map((id) => map.byId.get(id)!);
      expect([t.side, l.side]).toEqual([1, -1]);
      const view = { tx: 30, ty: 0, k: 1 };
      // The border and the air are half on either side of where the topic will be.
      const right = mount({ box: t, initialText: '', view }).ta;
      type(right, long);
      expect(px(right.style.left) + 2.5).toBe(30 + t.x);
      const left = mount({ box: l, initialText: '', view }).ta;
      type(left, long);
      expect(px(left.style.left) + px(left.style.width) - 2.5).toBe(30 + l.x + l.w);
      const centre = mount({ box: r, initialText: 'Root', view }).ta;
      type(centre, long);
      expect(px(centre.style.left) + px(centre.style.width) / 2).toBe(30 + r.x + r.w / 2);
    });
  });

  describe('says when it needs more room', () => {
    const long = Array.from({ length: 24 }, () => 'word').join(' ');
    const t = computeLayout({ id: 'r', text: 'Root', children: [{ id: 'a', text: 'Alpha', children: [{ id: 't', text: '', children: [] }] }] }, measure).byId.get('t')!;

    it('not when it opens: the topic it is on was brought into view when it was selected', () => {
      const onGrow = vi.fn();
      mount({ box: t, initialText: '', onGrow });
      expect(onGrow).not.toHaveBeenCalled();
    });

    it('not when it opens, also where the browser lays the text out higher than its line breaks say (a text that wraps)', () => {
      // jsdom lays nothing out; a browser reports the height of the box once it is on the page.
      const height = vi.spyOn(HTMLTextAreaElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
      try {
        const onGrow = vi.fn();
        mount({ box: t, initialText: long, onGrow });
        expect(onGrow).not.toHaveBeenCalled();
      } finally {
        height.mockRestore();
      }
    });

    it('not when only the zoom changes, also where the browser lays the box out anew at the other zoom', () => {
      // A browser reports the box's height after it has drawn it: at a new zoom, first the old one's.
      const height = vi.spyOn(HTMLTextAreaElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
        return parseFloat(this.style.lineHeight) * 4 + 12;
      });
      try {
        const onGrow = vi.fn();
        const handlers = { onCommit: vi.fn(), onCancel: vi.fn(), onTab: vi.fn(), onGrow };
        container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        const at = (k: number) => act(() => root.render(<InlineEditor box={t} view={{ tx: 0, ty: 0, k }} measure={measure} initialText={long} selectAll {...handlers} />));
        for (const k of [1, 2, 3, 0.5, 1, 2]) at(k);
        expect(onGrow).not.toHaveBeenCalled();
        act(() => root.unmount());
      } finally {
        height.mockRestore();
      }
    });

    it('not when only the zoom changes, which makes it larger on the screen and no larger on the map', () => {
      const onGrow = vi.fn();
      const handlers = { onCommit: vi.fn(), onCancel: vi.fn(), onTab: vi.fn(), onGrow };
      container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const at = (k: number) => act(() => root.render(<InlineEditor box={t} view={{ tx: 0, ty: 0, k }} measure={measure} initialText={long} selectAll {...handlers} />));
      at(1);
      const before = parseFloat(container.querySelector('textarea')!.style.width);
      at(2);
      expect(parseFloat(container.querySelector('textarea')!.style.width)).toBeGreaterThan(before);
      at(0.5);
      at(1);
      expect(onGrow).not.toHaveBeenCalled();
      act(() => root.unmount());
    });

    it('when the text makes it wider: where it is on the map now', () => {
      const onGrow = vi.fn();
      const { ta } = mount({ box: t, initialText: '', onGrow, view: { tx: 40, ty: 10, k: 2 } });
      type(ta, 'word word word word word');
      expect(onGrow).toHaveBeenCalledTimes(1);
      const width = (24 * 8.5 + 10) * 2 + 7;
      // One line of 22 px with 4 px above and below it, twice as large on the screen, and 4 px for the border and some air.
      // A topic on the right of the map grows to the right.
      expect(onGrow).toHaveBeenLastCalledWith({ x: t.x - 3.5 / 2, y: t.y, w: width / 2, h: (30 * 2 + 4) / 2 }, 'right');
      type(ta, long);
      expect(onGrow).toHaveBeenCalledTimes(2);
      expect(onGrow.mock.calls[1][0].w).toBe(((29 * 8.5 + 10) * 2 + 7) / 2);
    });

    it('says which way it grows: to the left on the left of the map, to both sides for the central topic', () => {
      const map = computeLayout({ id: 'r', text: 'Root', children: [
        { id: 'a', text: 'Alpha', side: 'right', children: [] },
        { id: 'b', text: 'Beta', side: 'left', children: [{ id: 'l', text: '', children: [] }] },
      ] }, measure);
      const onGrow = vi.fn();
      type(mount({ box: map.byId.get('l')!, initialText: '', onGrow }).ta, long);
      expect(onGrow.mock.calls.at(-1)![1]).toBe('left');
      type(mount({ box: map.byId.get('r')!, initialText: 'Root', onGrow }).ta, long);
      expect(onGrow.mock.calls.at(-1)![1]).toBe('both');
    });

    it('when it moves outwards without getting wider: a new topic on the left of the map, still under the least width', () => {
      const map = computeLayout({ id: 'r', text: 'Root', children: [
        { id: 'a', text: 'Alpha', side: 'right', children: [] },
        { id: 'b', text: 'Beta', side: 'left', children: [{ id: 'l', text: '', children: [] }] },
      ] }, measure);
      const onGrow = vi.fn();
      const px = (v: string) => parseFloat(v);
      const { ta } = mount({ box: map.byId.get('l')!, initialText: '', onGrow });
      const before = px(ta.style.left);
      type(ta, 'A deeper to');
      expect(px(ta.style.width)).toBe(140);
      expect(px(ta.style.left)).toBeLessThan(before);
      expect(onGrow).toHaveBeenCalledTimes(1);
      expect(onGrow.mock.calls[0][0].x).toBe(px(ta.style.left));
    });

    it('when a line break makes it higher', () => {
      const onGrow = vi.fn();
      const { ta } = mount({ box: t, initialText: 'word', onGrow });
      type(ta, 'word\nword\nword');
      expect(onGrow).toHaveBeenCalledTimes(1);
      // Three lines of 22 px, 4 px above and below them, and 4 px for the border and some air.
      expect(onGrow.mock.calls[0][0].h).toBe(3 * 22 + 8 + 4);
    });

    it('not when it stays as it is or gets smaller', () => {
      const onGrow = vi.fn();
      const { ta } = mount({ box: t, initialText: '', onGrow });
      type(ta, 'word word word word word');
      type(ta, 'word word word word wor');
      type(ta, 'word');
      expect(onGrow).toHaveBeenCalledTimes(1);
    });
  });
});
