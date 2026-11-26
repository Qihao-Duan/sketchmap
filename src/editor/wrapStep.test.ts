import { describe, expect, it } from 'vitest';
import type { LayoutKind, MapNode } from '../shared/types';
import type { Measure } from '../layout/wrap';
import { steppedWrap } from './wrapStep';

const measure: Measure = (t, s) => t.length * s * 0.5;
/** 24 words: at 17 px (8.5 px a character) a deeper topic, which wraps at 250 px, holds six of them to a line. */
const long = Array.from({ length: 24 }, () => 'word').join(' ');
const topic = (text: string, extra: Partial<MapNode> = {}): MapNode => ({ id: 't', text, children: [], ...extra });
const step = (node: MapNode, how: 'wider' | 'narrower', depth = 2, kind: LayoutKind = 'map') => steppedWrap(node, depth, kind, how, measure);

describe('steppedWrap', () => {
  it('goes a quarter wider or narrower, in whole tens, from the width that goes with the topic’s level', () => {
    expect(step(topic(long), 'wider')).toBe(310);
    expect(step(topic(long), 'narrower')).toBe(200);
    // The central topic wraps at 300 px, a main branch at 230 px, a deeper topic of an org chart at 200 px.
    expect(step(topic(long), 'wider', 0)).toBe(380);
    expect(step(topic(long), 'wider', 1)).toBe(290);
    expect(step(topic(long), 'wider', 2, 'org')).toBe(250);
  });

  it('goes on from a width set by hand, and back to where it came from', () => {
    expect(step(topic(long, { wrap: 310 }), 'wider')).toBe(390);
    expect(step(topic(long, { wrap: 390 }), 'narrower')).toBe(310);
    expect(step(topic(long, { wrap: 310 }), 'narrower')).toBe(250);
  });

  it('takes as many steps as it needs for a word to change its line, so that every press shows', () => {
    // Three words of 170 px: one to a line at 250 px and at 310 px, two to a line (349 px) from 390 px on.
    const wide = topic(['a', 'b', 'c'].map((c) => c.repeat(20)).join(' '));
    expect(step(wide, 'wider')).toBe(390);
    // Two words of 77 px together: on one line down to 80 px, on two at 60 px.
    expect(step(topic('Two words'), 'narrower')).toBe(60);
  });

  it('leads nowhere when no width a map may hold changes a line', () => {
    // One line cannot get wider, one word cannot get narrower.
    expect(step(topic('Two words'), 'wider')).toBeNull();
    expect(step(topic('Short'), 'narrower')).toBeNull();
    expect(step(topic('Short'), 'wider')).toBeNull();
    // At the least and at the most.
    expect(step(topic(long, { wrap: 60 }), 'narrower')).toBeNull();
    expect(step(topic(Array.from({ length: 600 }, () => 'word').join(' '), { wrap: 1600 }), 'wider')).toBeNull();
  });

  it('stops at the least and at the most', () => {
    // 8 characters, 68 px: one line at 70 px, two at 60 px.
    expect(step(topic('abc defg', { wrap: 70 }), 'narrower')).toBe(60);
    expect(step(topic(Array.from({ length: 600 }, () => 'word').join(' '), { wrap: 1500 }), 'wider')).toBe(1600);
  });

  it('leads nowhere for a topic without text (an image alone)', () => {
    const image = { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 };
    expect(step(topic('', { image }), 'wider')).toBeNull();
    expect(step(topic('', { image }), 'narrower')).toBeNull();
  });
});
