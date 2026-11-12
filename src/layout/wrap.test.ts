import { describe, expect, it } from 'vitest';
import { wrapText, wrapWithOffsets, type Measure } from './wrap';

const measure: Measure = (t, size) => t.length * size * 0.5; // 10 px per char at size 20

describe('wrapText', () => {
  it('breaks Latin text between words', () => {
    expect(wrapText('alpha beta gamma delta', 20, 110, measure)).toEqual(['alpha beta', 'gamma delta']);
  });
  it('breaks CJK text between characters', () => {
    expect(wrapText('中文也是手写体', 20, 30, measure)).toEqual(['中文也', '是手写', '体']);
  });
  it('keeps explicit line breaks', () => {
    expect(wrapText('one\ntwo', 20, 500, measure)).toEqual(['one', 'two']);
  });
  it('never splits a single long word', () => {
    expect(wrapText('supercalifragilistic', 20, 50, measure)).toEqual(['supercalifragilistic']);
  });
});

describe('wrapWithOffsets', () => {
  it("gives each line its offset in the text, across wraps and explicit breaks", () => {
    expect(wrapWithOffsets('alpha beta gamma delta\nzeta', 20, 110, measure)).toEqual([
      { text: 'alpha beta', start: 0 },
      { text: 'gamma delta', start: 11 },
      { text: 'zeta', start: 23 },
    ]);
  });
  it('agrees with wrapText, including CJK', () => {
    const w = wrapWithOffsets('中文也是手写体', 20, 30, measure);
    expect(w.map((l) => l.text)).toEqual(wrapText('中文也是手写体', 20, 30, measure));
    expect(w.map((l) => l.start)).toEqual([0, 3, 6]);
  });
});
