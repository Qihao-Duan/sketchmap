// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displaySize, IMAGE_SIZES, ImageError, prepareImage, sizeAtWidth, sniffKind } from './imagePrep';

describe('image preparation', () => {
  it('keeps the aspect ratio at the requested width, within the schema limits', () => {
    expect(displaySize(1000, 500)).toEqual({ w: 200, h: 100 });
    expect(displaySize(300, 900, IMAGE_SIZES.S)).toEqual({ w: 120, h: 360 });
    expect(displaySize(4000, 10)).toEqual({ w: 200, h: 16 });
    expect(displaySize(10, 4000, IMAGE_SIZES.L)).toEqual({ w: 300, h: 2048 });
  });

  it('sizes a picture to any width in its own proportions, in whole pixels', () => {
    expect(sizeAtWidth({ w: 1200, h: 800 }, 240)).toEqual({ w: 240, h: 160 });
    expect(sizeAtWidth({ w: 1200, h: 800 }, 239.6)).toEqual({ w: 240, h: 160 });
    expect(sizeAtWidth({ w: 1200, h: 800 }, 100)).toEqual({ w: 100, h: 67 });
    expect(sizeAtWidth({ w: 800, h: 1200 }, 100)).toEqual({ w: 100, h: 150 });
  });

  it('stops where a side would leave the 16-2048px range, so the picture is never cropped to fit', () => {
    expect(sizeAtWidth({ w: 1200, h: 800 }, 5)).toEqual({ w: 24, h: 16 });
    expect(sizeAtWidth({ w: 800, h: 1200 }, 5)).toEqual({ w: 16, h: 24 });
    expect(sizeAtWidth({ w: 1200, h: 800 }, 9000)).toEqual({ w: 2048, h: 1365 });
    expect(sizeAtWidth({ w: 800, h: 1200 }, 9000)).toEqual({ w: 1365, h: 2048 });
    expect(sizeAtWidth({ w: 1200, h: 800 }, -50)).toEqual({ w: 24, h: 16 });
  });

  it('a picture too long and thin for the range keeps the asked width, and its other side stops at the limit', () => {
    expect(sizeAtWidth({ w: 4000, h: 10 }, 300)).toEqual({ w: 300, h: 16 });
    expect(sizeAtWidth({ w: 10, h: 4000 }, 300)).toEqual({ w: 300, h: 2048 });
    expect(sizeAtWidth({ w: 4000, h: 10 }, 9000)).toEqual({ w: 2048, h: 16 });
  });

  it('recognises image types from their bytes', () => {
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(sniffKind(new TextEncoder().encode('GIF89a...'))).toBe('gif');
    expect(sniffKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffKind(new TextEncoder().encode('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffKind(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('refuses non-images with a message that says why', async () => {
    await expect(prepareImage(new File(['hello'], 'x.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(ImageError);
  });

  it('accepts only bytes that really are PNG, JPEG, WebP or GIF (SVG content is routed to rasterisation instead; see below)', async () => {
    await expect(prepareImage(new File(['just text'], 'x.png', { type: 'image/png' }))).rejects.toThrow(/isn’t a PNG, JPEG, WebP or GIF image/);
    await expect(prepareImage(new File([new Uint8Array([0x1f, 0x8b, 8, 0])], 'x.svgz', { type: 'image/png' }))).rejects.toThrow(/isn’t a PNG, JPEG, WebP or GIF image/);
  });

  it('refuses files over 30 MB before decoding them', async () => {
    const big = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 31 * 1024 * 1024 });
    await expect(prepareImage(big)).rejects.toThrow(/over 30 MB/);
  });
});

// The user's decision (2026-11-13): SVG is no longer refused outright. It is drawn into a PNG in the browser,
// through an <img> element (so it can't run script or load external resources). jsdom can't actually decode an
// image, so these tests mock just enough of the platform (`URL.createObjectURL`/`revokeObjectURL`, and `Image`'s
// `decode`) to assert the routing and error wording, not a real rasterisation.
describe('SVG images are drawn into a PNG instead of being refused', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('no longer gives "SVG images aren’t supported"; a decode failure gives "couldn’t be drawn" instead', async () => {
    class RejectingImage {
      decode() {
        return Promise.reject(new Error('jsdom cannot decode images'));
      }
      set src(_v: string) {}
    }
    vi.stubGlobal('Image', RejectingImage);

    // Routed by the declared type.
    await expect(prepareImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' })))
      .rejects.toThrow(/That SVG couldn’t be drawn\./);
    // Routed by sniffed content, even though it claims to be a PNG and carries a <script> (an <img> can't run it).
    const sneaky = new File(['<!-- hi --><svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'], 'x.png', { type: 'image/png' });
    await expect(prepareImage(sneaky)).rejects.toThrow(/That SVG couldn’t be drawn\./);

    vi.unstubAllGlobals();
  });

  it('refuses an SVG source over 5 MiB before ever trying to draw it', async () => {
    const big = new File(['<svg/>'], 'big.svg', { type: 'image/svg+xml' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    await expect(prepareImage(big)).rejects.toThrow(/too large \(over 5 MB\)\./);
  });
});
