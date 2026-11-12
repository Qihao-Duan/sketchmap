import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH, parseOutline, toMarkdown } from './markdown';

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
});

describe('parseOutline', () => {
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
});
