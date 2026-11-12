// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH } from './markdown';
import { parseHtmlOutline } from './htmlOutline';

const shape = (n: MapNode): unknown => ({ t: n.text, c: n.children.map(shape) });

describe('parseHtmlOutline', () => {
  it('reads an XMind-style fragment, keeping multi-line topics', () => {
    const html = `<meta charset='utf-8'><html><head></head><body><div xmind-vk-document-fragment-id="1-2"><ul><li><p>Topic</p><ul>` +
      `<li><p>Child A</p><ul><li><p>Grandchild</p></li></ul></li><li><p>Line one</p><p>Line two</p></li></ul></li></ul></div></body></html>`;
    const parsed = parseHtmlOutline(html)!;
    expect(parsed.synthetic).toBe(false);
    expect(shape(parsed.root)).toEqual({
      t: 'Topic',
      c: [{ t: 'Child A', c: [{ t: 'Grandchild', c: [] }] }, { t: 'Line one\nLine two', c: [] }],
    });
    expect(parsed.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('reads a Notion-style list with several top-level items under an "Outline" root', () => {
    const parsed = parseHtmlOutline('<ul><li>Alpha<ul><li>Alpha 1</li></ul></li><li>Beta</li></ul>')!;
    expect(parsed.synthetic).toBe(true);
    expect(shape(parsed.root)).toEqual({ t: 'Outline', c: [{ t: 'Alpha', c: [{ t: 'Alpha 1', c: [] }] }, { t: 'Beta', c: [] }] });
  });

  it('turns <br> into a line break inside a topic', () => {
    expect(shape(parseHtmlOutline('<ul><li>first<br>second</li></ul>')!.root)).toEqual({ t: 'first\nsecond', c: [] });
  });

  it('collapses source whitespace and ignores indentation between tags', () => {
    const html = '<ul>\n  <li>\n    <p>A long\n      topic</p>\n    <ul>\n      <li><div><span>Child</span> <b>bold</b></div></li>\n    </ul>\n  </li>\n</ul>\n';
    expect(shape(parseHtmlOutline(html)!.root)).toEqual({ t: 'A long topic', c: [{ t: 'Child bold', c: [] }] });
  });

  it('gives up when there is no list or when text sits outside the lists', () => {
    expect(parseHtmlOutline('<p>Just a paragraph</p>')).toBeNull();
    expect(parseHtmlOutline('<p>Intro</p><ul><li>A</li></ul>')).toBeNull();
    expect(parseHtmlOutline('<ul><li>   </li></ul>')).toBeNull();
  });

  it('gives up on lists nested deeper than MAX_OUTLINE_DEPTH, so paste falls back to the plain text', () => {
    const deep = (n: number): string => (n === 0 ? '' : `<ul><li>x${deep(n - 1)}</li></ul>`);
    expect(parseHtmlOutline(deep(MAX_OUTLINE_DEPTH + 1))).not.toBeNull();
    expect(parseHtmlOutline(deep(MAX_OUTLINE_DEPTH + 2))).toBeNull();
  });

  it('cuts topic text to 5000 characters', () => {
    expect(parseHtmlOutline(`<ul><li>${'x'.repeat(6000)}</li></ul>`)!.root.text).toHaveLength(5000);
  });
});
