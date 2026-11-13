// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { displaySize, IMAGE_SIZES, ImageError, prepareImage, sniffKind } from './imagePrep';

describe('image preparation', () => {
  it('keeps the aspect ratio at the requested width, within the schema limits', () => {
    expect(displaySize(1000, 500)).toEqual({ w: 200, h: 100 });
    expect(displaySize(300, 900, IMAGE_SIZES.S)).toEqual({ w: 120, h: 360 });
    expect(displaySize(4000, 10)).toEqual({ w: 200, h: 16 });
    expect(displaySize(10, 4000, IMAGE_SIZES.L)).toEqual({ w: 300, h: 2048 });
  });

  it('recognises image types from their bytes', () => {
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(sniffKind(new TextEncoder().encode('GIF89a...'))).toBe('gif');
    expect(sniffKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffKind(new TextEncoder().encode('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffKind(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('refuses SVG and non-images with a message that says why', async () => {
    await expect(prepareImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/SVG images aren’t supported/);
    await expect(prepareImage(new File(['<?xml version="1.0"?><svg/>'], 'x.png', { type: 'image/png' }))).rejects.toThrow(/SVG/);
    await expect(prepareImage(new File(['hello'], 'x.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(ImageError);
  });

  it('accepts only bytes that really are PNG, JPEG, WebP or GIF, whatever the file claims', async () => {
    const sneaky = new File(['<!-- hi --><svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'], 'x.png', { type: 'image/png' });
    await expect(prepareImage(sneaky)).rejects.toThrow(/SVG images aren’t supported/);
    await expect(prepareImage(new File(['just text'], 'x.png', { type: 'image/png' }))).rejects.toThrow(/isn’t an image/);
    await expect(prepareImage(new File([new Uint8Array([0x1f, 0x8b, 8, 0])], 'x.svgz', { type: 'image/png' }))).rejects.toThrow(/isn’t an image/);
  });

  it('refuses files over 30 MB before decoding them', async () => {
    const big = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 31 * 1024 * 1024 });
    await expect(prepareImage(big)).rejects.toThrow(/over 30 MB/);
  });
});
