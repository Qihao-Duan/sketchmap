import { describe, expect, it } from 'vitest';
import { wrapText, type Measure } from './wrap';

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
