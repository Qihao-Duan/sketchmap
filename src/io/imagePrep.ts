/** Thrown for any image that the browser refuses to prepare, with a message that says why. */
export class ImageError extends Error {}

export const IMAGE_SIZES = { S: 120, M: 200, L: 300 } as const;

const MIN_PX = 16;
const MAX_PX = 2048;
/** Largest image file accepted for preparation (before re-encoding shrinks it). */
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_UPLOAD_BYTES = MAX_SOURCE_IMAGE_BYTES;
const MAX_ENCODED_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY = 0.85;
const SNIFF_BYTES = 512;
/** An SVG source is refused above this size, before it is ever drawn (there is no raster size to shrink from). */
const MAX_SVG_SOURCE_BYTES = MAX_ENCODED_BYTES;
/** `rasteriseSvg` gives up on a decode that never settles (e.g. a pathological SVG). */
const SVG_DECODE_TIMEOUT_MS = 10_000;
/** A decoded SVG is scaled up to at least this long on its longest side, so tiny icons stay crisp. */
const MIN_SVG_PX = 64;

/** Width = target; height keeps the aspect ratio, rounded. Both clamped to the schema's 16-2048px. */
export function displaySize(width: number, height: number, target: number = IMAGE_SIZES.M): { w: number; h: number } {
  const clamp = (n: number) => Math.min(MAX_PX, Math.max(MIN_PX, n));
  return { w: clamp(target), h: clamp(Math.round((height / width) * target)) };
}

function looksLikeSvgText(bytes: Uint8Array): boolean {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^\uFEFF/, '').trimStart();
  // XML declarations, comments and doctypes may come first; any <svg in the first bytes counts.
  return text.startsWith('<?xml') || /<svg[\s>/]/i.test(text);
}

/** Identifies an image's kind from its magic bytes (or SVG's leading text), never from `Content-Type`. */
export function sniffKind(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  if (looksLikeSvgText(bytes)) return 'svg';
  return null;
}

async function encode(canvas: OffscreenCanvas | HTMLCanvasElement, useOffscreen: boolean, type: string, quality: number): Promise<Blob> {
  if (useOffscreen) {
    return (canvas as OffscreenCanvas).convertToBlob({ type, quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new ImageError('That image couldn’t be read.'))), type, quality);
  });
}

/**
 * Draws an SVG into a PNG, in the browser: loaded through an `<img>` element (so it cannot run script or load
 * external resources, and only the rendered pixels are kept), then drawn on a canvas like the raster path.
 * Always encodes PNG, since SVG usually carries transparency.
 */
export async function rasteriseSvg(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.size > MAX_SVG_SOURCE_BYTES) {
    throw new ImageError('That SVG is too large (over 5 MB).');
  }

  let url: string;
  try {
    url = URL.createObjectURL(new Blob([await file.arrayBuffer()], { type: 'image/svg+xml' }));
  } catch {
    // A platform failure making the object URL (e.g. jsdom, which has no real `createObjectURL`) is just
    // another way the SVG couldn't be drawn, not a crash to leak to the caller.
    throw new ImageError('That SVG couldn’t be drawn.');
  }
  try {
    const img = new Image();
    img.src = url;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), SVG_DECODE_TIMEOUT_MS);
    });
    try {
      await Promise.race([img.decode(), timeout]);
    } catch {
      throw new ImageError('That SVG couldn’t be drawn.');
    } finally {
      clearTimeout(timer!);
    }

    // An SVG with no intrinsic size (e.g. only a viewBox) decodes with naturalWidth/Height at 0.
    const naturalWidth = img.naturalWidth || 512;
    const naturalHeight = img.naturalHeight || 512;
    const longest = Math.max(naturalWidth, naturalHeight);
    const scale = longest > MAX_PX ? MAX_PX / longest : longest < MIN_SVG_PX ? MIN_SVG_PX / longest : 1;
    const width = Math.round(naturalWidth * scale);
    const height = Math.round(naturalHeight * scale);

    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
    if (!useOffscreen) {
      (canvas as HTMLCanvasElement).width = width;
      (canvas as HTMLCanvasElement).height = height;
    }
    const ctx = canvas.getContext('2d') as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
    if (!ctx) throw new ImageError('That image couldn’t be read.');
    ctx.drawImage(img, 0, 0, width, height);

    const blob = await encode(canvas, useOffscreen, 'image/png', JPEG_QUALITY);
    if (blob.size > MAX_ENCODED_BYTES) {
      throw new ImageError('Even after shrinking, the image is larger than 5 MB.');
    }
    return { blob, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Re-encodes `file` for upload: draws SVG into a PNG (`rasteriseSvg`, since an SVG drawn as an image can't run
 * script), shrinks a raster image to at most 2048px on the longest side, and picks PNG (any transparency) or
 * JPEG at 0.85 quality otherwise.
 */
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const prefix = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

  if (looksLikeSvgText(prefix) || file.type === 'image/svg+xml') {
    return rasteriseSvg(file);
  }
  // Only the bytes decide: a file that claims to be an image but isn't one of the four raster formats is refused.
  const kind = sniffKind(prefix);
  if (!(kind === 'png' || kind === 'jpeg' || kind === 'webp' || kind === 'gif')) {
    throw new ImageError('That file isn’t a PNG, JPEG, WebP or GIF image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageError('That image is too large (over 30 MB).');
  }

  let bitmap: ImageBitmap;
  try {
    // EXIF orientation applied explicitly; an animated GIF keeps only its first frame.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageError('That image couldn’t be read.');
  }
  try {
    const s = Math.min(1, MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * s);
    const height = Math.round(bitmap.height * s);

    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const canvas: OffscreenCanvas | HTMLCanvasElement = useOffscreen
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
    if (!useOffscreen) {
      (canvas as HTMLCanvasElement).width = width;
      (canvas as HTMLCanvasElement).height = height;
    }
    const ctx = canvas.getContext('2d') as (OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) | null;
    if (!ctx) throw new ImageError('That image couldn’t be read.');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const { data } = ctx.getImageData(0, 0, width, height);
    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        hasAlpha = true;
        break;
      }
    }
    const type = hasAlpha ? 'image/png' : 'image/jpeg';
    const blob = await encode(canvas, useOffscreen, type, JPEG_QUALITY);
    if (blob.size > MAX_ENCODED_BYTES) {
      throw new ImageError('Even after shrinking, the image is larger than 5 MB.');
    }
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
