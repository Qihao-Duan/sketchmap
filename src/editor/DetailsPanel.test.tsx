// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailsPanel } from './DetailsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
afterEach(() => container.remove());

describe('DetailsPanel image row', () => {
  it('locks Remove and the sizes while a replacement is uploading, so a late upload can’t undo them', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const noop = vi.fn();
    act(() =>
      createRoot(container).render(
        <DetailsPanel
          node={{ id: 'a', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/c.png', w: 200, h: 100 }, children: [] }}
          onEmphasis={noop} onPriority={noop} onMarker={noop} onNote={noop}
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop} onTextWidth={noop}
          uploading
        />,
      ),
    );
    const buttons = [...container.querySelectorAll('button')];
    const byText = (t: string) => buttons.find((b) => b.textContent === t)!;
    expect(byText('Remove').disabled).toBe(true);
    for (const s of ['S', 'M', 'L']) expect(byText(s).disabled, s).toBe(true);
    expect(byText('Uploading…').disabled).toBe(true);
  });

  it('says the size of the image, and how to give it any other size', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const noop = vi.fn();
    act(() =>
      createRoot(container).render(
        <DetailsPanel
          node={{ id: 'a', text: 'Cat', image: { key: 'img/abcdefghijklmnopqrstu/c.png', w: 260, h: 130 }, children: [] }}
          onEmphasis={noop} onPriority={noop} onMarker={noop} onNote={noop}
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop} onTextWidth={noop}
        />,
      ),
    );
    expect(container.querySelector('.image-size')!.textContent).toBe('260 × 130 px. For any other size, drag the square on the image’s corner.');
    // 260 wide is none of S, M and L.
    expect(container.querySelectorAll('[aria-label="Image size"] button[aria-pressed="true"]')).toHaveLength(0);
  });

  it('says no size for a topic without an image', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const noop = vi.fn();
    act(() =>
      createRoot(container).render(
        <DetailsPanel
          node={{ id: 'a', text: 'Cat', children: [] }}
          onEmphasis={noop} onPriority={noop} onMarker={noop} onNote={noop}
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop} onTextWidth={noop}
        />,
      ),
    );
    expect(container.querySelector('.image-size')).toBeNull();
  });

  it('lets the file picker offer SVG files too (they are drawn into PNG)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const noop = vi.fn();
    act(() =>
      createRoot(container).render(
        <DetailsPanel
          node={{ id: 'a', text: 'Cat', children: [] }}
          onEmphasis={noop} onPriority={noop} onMarker={noop} onNote={noop}
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop} onTextWidth={noop}
        />,
      ),
    );
    expect(container.querySelector('input[aria-label="Image file"]')!.getAttribute('accept')).toContain('image/svg+xml');
  });
});

describe('DetailsPanel text width row', () => {
  function show(node: Parameters<typeof DetailsPanel>[0]['node'], extra: Partial<Parameters<typeof DetailsPanel>[0]> = {}) {
    container = document.createElement('div');
    document.body.appendChild(container);
    const noop = vi.fn();
    const onTextWidth = vi.fn();
    act(() =>
      createRoot(container).render(
        <DetailsPanel
          node={node}
          onEmphasis={noop} onPriority={noop} onMarker={noop} onNote={noop}
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop}
          onTextWidth={onTextWidth} autoWrap={250}
          {...extra}
        />,
      ),
    );
    const row = container.querySelector('[aria-label="Text width"]')!;
    const button = (t: string) => [...row.querySelectorAll('button')].find((b) => b.textContent === t)!;
    return { onTextWidth, button, hint: () => container.querySelector('.text-width')?.textContent };
  }

  it('has Narrower, Wider and Automatic, which ask for that step', () => {
    const { onTextWidth, button } = show({ id: 'a', text: 'Cat', children: [] });
    act(() => button('Wider').click());
    act(() => button('Narrower').click());
    act(() => button('Automatic').click());
    expect(onTextWidth.mock.calls).toEqual([['wider'], ['narrower'], ['auto']]);
  });

  it('a topic with no width of its own has Automatic marked, and the panel says where its text wraps', () => {
    const { button, hint } = show({ id: 'a', text: 'Cat', children: [] });
    expect(button('Automatic').getAttribute('aria-pressed')).toBe('true');
    expect(hint()).toBe('Automatic: the text wraps at 250 px. For any other width, drag the bar on the topic’s side.');
  });

  it('a topic with a width set by hand says that width, and Automatic is not marked', () => {
    const { button, hint } = show({ id: 'a', text: 'Cat', wrap: 420, children: [] });
    expect(button('Automatic').getAttribute('aria-pressed')).toBe('false');
    expect(hint()).toBe('The text wraps at 420 px. For any other width, drag the bar on the topic’s side.');
  });

  it('with several topics selected the buttons are there, for all of them, and no width of one topic is said', () => {
    const { button, hint } = show({ id: 'a', text: 'Cat', wrap: 420, children: [] }, { count: 3 });
    expect(button('Wider')).toBeDefined();
    expect(hint()).toBeUndefined();
    expect(container.textContent).toContain('Importance, priority, marker and text width go to all of them.');
  });

  it('a step that would show nothing is not offered: its button is off, and a press on it does nothing', () => {
    const off = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') === 'true';
    const one = show({ id: 'a', text: 'Cat', children: [] }, { steps: { wider: false, narrower: false } });
    expect([off(one.button('Wider')), off(one.button('Narrower')), off(one.button('Automatic'))]).toEqual([true, true, false]);
    act(() => one.button('Wider').click());
    act(() => one.button('Narrower').click());
    expect(one.onTextWidth).not.toHaveBeenCalled();
    // Off, but still a button the keyboard can be on: a button that goes off while it has the focus
    // would otherwise drop the focus, and the next key would go to the map.
    expect([one.button('Wider').disabled, one.button('Narrower').disabled]).toEqual([false, false]);
    container.remove();
    const some = show({ id: 'a', text: 'Two words', children: [] }, { steps: { wider: false, narrower: true } });
    expect([off(some.button('Wider')), off(some.button('Narrower'))]).toEqual([true, false]);
    act(() => some.button('Narrower').click());
    expect(some.onTextWidth.mock.calls).toEqual([['narrower']]);
    container.remove();
    // Not told which steps lead somewhere (several topics, an open text box): both are offered.
    const unknown = show({ id: 'a', text: 'Cat', children: [] });
    expect([off(unknown.button('Wider')), off(unknown.button('Narrower'))]).toEqual([false, false]);
  });

  it('a click on a button leaves the keyboard where it is', () => {
    const { button } = show({ id: 'a', text: 'Cat', children: [] });
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => void button('Wider').dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
  });
});

