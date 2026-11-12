import { describe, expect, it } from 'vitest';
import { FONT_FACES } from './fontFaces.generated';
import { ensureFonts, facesFor, fontFaceCss, parseRanges } from './fonts';

describe('font faces', () => {
  it('has 7 Excalifont and 209 Xiaolai subsets, all with parseable ranges', () => {
    expect(FONT_FACES.filter((f) => f.family === 'Excalifont')).toHaveLength(7);
    expect(FONT_FACES.filter((f) => f.family === 'Xiaolai')).toHaveLength(209);
    for (const f of FONT_FACES) expect(parseRanges(f.unicodeRange).length).toBeGreaterThan(0);
  });

  it('parses single code points and ranges', () => {
    expect(parseRanges('U+20-7e,U+131')).toEqual([[0x20, 0x7e], [0x131, 0x131]]);
  });

  it('picks only the subsets a text needs', () => {
    const latin = facesFor('Hello');
    expect(latin.map((f) => f.family)).toEqual(['Excalifont']);
    const chinese = facesFor('中文');
    expect(chinese.length).toBeGreaterThan(0);
    expect(chinese.every((f) => f.family === 'Xiaolai')).toBe(true);
  });

  it('emits one @font-face rule per subset, served from /fonts/', () => {
    const css = fontFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(216);
    expect(css).toContain('url("/fonts/Excalifont/');
    expect(css).toContain('font-display:swap');
  });

  it('ensureFonts gives up after the timeout and reports success otherwise', async () => {
    const never = { load: () => new Promise(() => {}) } as unknown as FontFaceSet;
    expect(await ensureFonts('Hi', never, 20)).toBe(false);
    const ok = { load: async () => [] } as unknown as FontFaceSet;
    expect(await ensureFonts('Hi', ok, 20)).toBe(true);
  });
});
