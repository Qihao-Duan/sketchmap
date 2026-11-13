import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH, markdownLosses, parseOutline, readDecorations, toMarkdown } from './markdown';

const n = (text: string, children: MapNode[] = []): MapNode => ({ id: text, text, children });
const shape = (node: MapNode): unknown => ({ t: node.text, c: node.children.map(shape) });

describe('toMarkdown', () => {
  it('writes the root as a heading and topics as nested bullets, 2 spaces per level', () => {
    const md = toMarkdown(n('Plan', [n('A', [n('A1')]), n('B')]));
    expect(md).toBe('# Plan\n- A\n  - A1\n- B\n');
  });
  it('joins multi-line topic text into one line', () => {
    expect(toMarkdown(n('Root', [n('two\n lines')]))).toBe('# Root\n- two lines\n');
  });
  it('appends an image link when imageBase is set, and leaves it out otherwise', () => {
    const tree = n('R', [{ ...n('Cat'), image: { key: 'img/abcdefghijklmnopqrstu/c.png', w: 200, h: 100 } }]);
    expect(toMarkdown(tree, { imageBase: 'https://s.example' }))
      .toBe('# R\n- Cat ![](https://s.example/img/abcdefghijklmnopqrstu/c.png)\n');
    expect(toMarkdown(tree)).toBe('# R\n- Cat\n');
  });
});

describe('parseOutline', () => {
  it('writes Key as bold and priority and marker as leading emoji, and reads them back', () => {
    const tree = n('Plan', [
      { ...n('Ship'), emphasis: 'key', priority: 1 },
      { ...n('Idea'), emoji: '💡', priority: 3 },
      { ...n('Later'), emphasis: 'aside' },
    ]);
    const md = toMarkdown(tree);
    expect(md).toBe('# Plan\n- 🔴 **Ship**\n- 🔵 💡 Idea\n- Later\n');
    const pick = ({ text, emphasis, priority, emoji }: MapNode) => ({ text, emphasis, priority, emoji });
    expect(parseOutline(md)!.root.children.map(pick)).toEqual([
      { text: 'Ship', emphasis: 'key', priority: 1, emoji: undefined },
      { text: 'Idea', emphasis: undefined, priority: 3, emoji: '💡' },
      { text: 'Later', emphasis: undefined, priority: undefined, emoji: undefined },
    ]);
  });

  it('reads priority emoji, markers and whole-item bold; partial bold stays text', () => {
    expect(readDecorations('🟠 ✅ **Done**')).toEqual({ text: 'Done', priority: 2, emoji: '✅', emphasis: 'key' });
    expect(readDecorations('Not **all** bold')).toEqual({ text: 'Not **all** bold' });
    expect(readDecorations('💡idea')).toEqual({ text: '💡idea' });
  });

  it('lists what Markdown cannot keep', () => {
    const tree = n('R', [{ ...n('a'), emphasis: 'highlight' }, { ...n('b'), note: 'x' }, { ...n('c'), emphasis: 'key' }]);
    expect(markdownLosses(tree)).toEqual(['Highlight', 'notes']);
    expect(markdownLosses(n('R', [{ ...n('a'), emphasis: 'aside' }]))).toEqual(['Aside']);
    expect(markdownLosses(n('R'))).toEqual([]);
  });

  it('lists images, ordered after notes', () => {
    const image = { key: 'img/abcdefghijklmnopqrstu/c.png', w: 200, h: 100 };
    expect(markdownLosses(n('R', [{ ...n('a'), image }]))).toEqual(['images']);
    expect(markdownLosses(n('R', [{ ...n('a'), note: 'x', image }]))).toEqual(['notes', 'images']);
  });

  it('round-trips toMarkdown', () => {
    const tree = n('Plan', [n('A', [n('A1'), n('A2', [n('Deep')])]), n('B')]);
    const parsed = parseOutline(toMarkdown(tree))!;
    expect(parsed.synthetic).toBe(false);
    expect(shape(parsed.root)).toEqual(shape(tree));
    expect(parsed.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('accepts any indent width, tabs, numbers, other bullet marks and checkboxes', () => {
    const text = '- A\n    - A1\n\t\t- A1a\n* B\n1. C\n2) D\n+ E\n• F\n- [ ] todo\n- [x] done';
    const parsed = parseOutline(text)!;
    expect(parsed.synthetic).toBe(true);
    expect(parsed.root.text).toBe('Outline');
    expect(shape(parsed.root)).toEqual({
      t: 'Outline',
      c: [
        { t: 'A', c: [{ t: 'A1', c: [{ t: 'A1a', c: [] }] }] },
        { t: 'B', c: [] }, { t: 'C', c: [] }, { t: 'D', c: [] }, { t: 'E', c: [] }, { t: 'F', c: [] },
        { t: 'todo', c: [] }, { t: 'done', c: [] },
      ],
    });
  });

  it('nests bullets under headings and headings by level', () => {
    const parsed = parseOutline('# Root\n## Section\n- point\n  - detail\n## Other')!;
    expect(shape(parsed.root)).toEqual({
      t: 'Root',
      c: [{ t: 'Section', c: [{ t: 'point', c: [{ t: 'detail', c: [] }] }] }, { t: 'Other', c: [] }],
    });
  });

  it('treats one plain line as a single topic and ignores blank lines and empty bullets', () => {
    expect(shape(parseOutline('\n  Hello world  \n\n')!.root)).toEqual({ t: 'Hello world', c: [] });
    expect(shape(parseOutline('- A\n- \n- B')!.root)).toEqual({ t: 'Outline', c: [{ t: 'A', c: [] }, { t: 'B', c: [] }] });
  });

  it('clamps skipped levels and cuts topic text to 5000 characters', () => {
    const parsed = parseOutline(`- A\n        - jumped\n- ${'x'.repeat(6000)}`)!;
    expect(parsed.root.children[0].children[0].text).toBe('jumped');
    expect(parsed.root.children[1].text).toHaveLength(5000);
  });

  it('treats an indent less than 2 columns deeper as the same level (mixed tabs and spaces)', () => {
    expect(shape(parseOutline('- A\n   - B\n\t- C')!.root)).toEqual({ t: 'A', c: [{ t: 'B', c: [] }, { t: 'C', c: [] }] });
  });

  it('skips blank headings', () => {
    expect(shape(parseOutline('# \n- child')!.root)).toEqual({ t: 'child', c: [] });
    expect(shape(parseOutline('# A\n# \n# B')!.root)).toEqual({ t: 'Outline', c: [{ t: 'A', c: [] }, { t: 'B', c: [] }] });
  });

  it(`caps nesting at ${MAX_OUTLINE_DEPTH} levels, so a pathological paste cannot overflow the stack`, () => {
    const text = Array.from({ length: 5000 }, (_, i) => `${' '.repeat(i * 2)}- L${i}`).join('\n');
    const parsed = parseOutline(text)!;
    let depth = 0;
    for (let node = parsed.root; node.children.length; node = node.children[0]) depth++;
    expect(depth).toBe(MAX_OUTLINE_DEPTH);
    expect(() => toMarkdown(parsed.root)).not.toThrow();
  });

  it('returns null for empty input', () => {
    expect(parseOutline('   \n\n')).toBeNull();
  });

  it('does not throw on 200,000 flat items (no Math.min spread over an unbounded array)', () => {
    const text = Array.from({ length: 200_000 }, (_, i) => `- item ${i}`).join('\n');
    let parsed: ReturnType<typeof parseOutline>;
    expect(() => { parsed = parseOutline(text); }).not.toThrow();
    expect(parsed!.synthetic).toBe(true);
    expect(parsed!.root.children).toHaveLength(200_000);
  });

  it('reads XMind-style plain text: one topic per line, one tab per level, trailing spaces', () => {
    const parsed = parseOutline('Topic\n\tChild A \n\t\tGrandchild\n\tChild B ≥90%\n')!;
    expect(shape(parsed.root)).toEqual({
      t: 'Topic',
      c: [{ t: 'Child A', c: [{ t: 'Grandchild', c: [] }] }, { t: 'Child B ≥90%', c: [] }],
    });
  });

  it('leaves Key text that already contains ** unwrapped, and says Key is not kept for it', () => {
    const tree = n('R', [{ ...n('a ** b'), emphasis: 'key' }]);
    expect(toMarkdown(tree)).toBe('# R\n- a ** b\n');
    expect(parseOutline(toMarkdown(tree))!.root.children[0].text).toBe('a ** b');
    expect(markdownLosses(tree)).toEqual(['Key on topics whose text contains **']);
  });

  it('round-trips a topic that has only a priority or only a marker', () => {
    const tree = n('R', [{ ...n(''), priority: 1 }, { ...n(''), emoji: '💡' }]);
    expect(toMarkdown(tree)).toBe('# R\n- 🔴\n- 💡\n');
    const back = parseOutline(toMarkdown(tree))!.root.children;
    expect(back.map(({ text, priority, emoji }) => ({ text, priority, emoji }))).toEqual([
      { text: '', priority: 1, emoji: undefined },
      { text: '', priority: undefined, emoji: '💡' },
    ]);
  });

  it('keeps a link and a bare URL exactly through toMarkdown and back, on a Key topic', () => {
    const tree = n('R', [{ ...n('Read [x](https://a.com) and https://b.com/c'), emphasis: 'key' }]);
    expect(toMarkdown(tree)).toBe('# R\n- **Read [x](https://a.com) and https://b.com/c**\n');
    const back = parseOutline(toMarkdown(tree))!.root.children[0];
    expect(back.text).toBe('Read [x](https://a.com) and https://b.com/c');
    expect(back.emphasis).toBe('key');
  });
});
