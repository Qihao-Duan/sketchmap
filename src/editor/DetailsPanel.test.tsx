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
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop}
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
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop}
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
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop}
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
          onImageFile={noop} onImageSize={noop} onImageRemove={noop} onFold={noop}
        />,
      ),
    );
    expect(container.querySelector('input[aria-label="Image file"]')!.getAttribute('accept')).toContain('image/svg+xml');
  });
});
