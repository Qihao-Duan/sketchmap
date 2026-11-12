import { FONT_FACES, type FontFaceEntry } from './fontFaces.generated';
import type { Measure } from '../layout/wrap';

export const FONT_STACK = '"Excalifont", "Xiaolai", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export const FONT_TIMEOUT_MS = 2500;

export function parseRanges(range: string): Array<[number, number]> {
  return range.split(',').map((part) => {
    const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!m) throw new Error(`Unsupported unicode-range part: ${part}`);
    const start = parseInt(m[1], 16);
    return [start, m[2] ? parseInt(m[2], 16) : start];
  });
}

const parsed = new Map<FontFaceEntry, Array<[number, number]>>();
const rangesOf = (f: FontFaceEntry) => {
  let r = parsed.get(f);
  if (!r) parsed.set(f, (r = parseRanges(f.unicodeRange)));
  return r;
};

/** Subsets whose unicode-range covers at least one character of `text`. */
export function facesFor(text: string): FontFaceEntry[] {
  const points = [...new Set([...text].map((c) => c.codePointAt(0)!))];
  return FONT_FACES.filter((f) => rangesOf(f).some(([a, b]) => points.some((p) => p >= a && p <= b)));
}

export function fontFaceCss(base = '/fonts/'): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face{font-family:"${f.family}";src:url("${base}${f.file}") format("woff2");unicode-range:${f.unicodeRange};font-display:swap}`,
  ).join('\n');
}

let installed = false;
export function installFontFaces(doc: Document = document): void {
  if (installed) return;
  installed = true;
  const style = doc.createElement('style');
  style.dataset.sketchmapFonts = '';
  style.textContent = fontFaceCss();
  doc.head.appendChild(style);
}

/** Loads the subsets `text` needs. Resolves true when loaded, false on failure or after `timeoutMs`. */
export function ensureFonts(
  text: string,
  fonts: FontFaceSet | undefined = typeof document === 'undefined' ? undefined : document.fonts,
  timeoutMs = FONT_TIMEOUT_MS,
): Promise<boolean> {
  if (!fonts) return Promise.resolve(false);
  const sample = text || 'Aa';
  const load = Promise.all([fonts.load('20px Excalifont', sample), fonts.load('20px Xiaolai', sample)]).then(
    () => true,
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([load, timeout]);
}

/** Text width via canvas, cached. Create a new one after fonts finish loading so the cache is fresh. */
export function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const cache = new Map<string, number>();
  return (text, size) => {
    const key = `${size}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = `${size}px ${FONT_STACK}`;
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}
