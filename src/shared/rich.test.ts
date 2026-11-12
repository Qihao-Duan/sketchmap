import { describe, expect, it } from 'vitest';
import { escapeLabel, linkRange, linkWhole, normalizeHref, parseRich, shortUrl } from './rich';

describe('parseRich', () => {
  it('reads [label](url) links, with offsets into the plain text', () => {
    expect(parseRich('Read [the docs](https://example.com/docs) now')).toEqual({
      plain: 'Read the docs now',
      links: [{ start: 5, end: 13, href: 'https://example.com/docs', label: 'the docs' }],
    });
  });

  it('turns bare http(s) URLs into links labelled with the host and path, at most 28 characters', () => {
    const r = parseRich('see https://github.com/excalidraw/excalidraw/issues/123, ok');
    expect(r.links).toEqual([{ start: 4, end: 32, href: 'https://github.com/excalidraw/excalidraw/issues/123', label: 'github.com/excalidraw/excal…' }]);
    expect(r.plain).toBe('see github.com/excalidraw/excal…, ok');
  });

  it('keeps balanced parentheses in a URL and drops trailing punctuation', () => {
    expect(parseRich('(https://en.wikipedia.org/wiki/Map_(disambiguation)).').links[0].href).toBe('https://en.wikipedia.org/wiki/Map_(disambiguation)');
    expect(parseRich('[w](https://en.wikipedia.org/wiki/Map_(x))').links[0].href).toBe('https://en.wikipedia.org/wiki/Map_(x)');
  });

  it('leaves non-web links as the text that was typed', () => {
    expect(parseRich('[x](javascript:alert(1)) and ftp://a.b')).toEqual({ plain: '[x](javascript:alert(1)) and ftp://a.b', links: [] });
  });

  it('reads \\[, \\] and \\\\ as literal characters, also inside labels', () => {
    expect(parseRich('a \\[b\\] c \\\\ d')).toEqual({ plain: 'a [b] c \\ d', links: [] });
    expect(parseRich('[x \\] y](https://a.com)').links[0].label).toBe('x ] y');
  });

  it('uses the short URL as the label of an empty [](url) link, and allows newlines in labels', () => {
    expect(parseRich('[](https://a.com/p/)').plain).toBe('a.com/p');
    expect(parseRich('[two\nlines](https://a.com)').links[0]).toMatchObject({ start: 0, end: 9, label: 'two\nlines' });
  });

  it('never lets quotes, angle brackets, backticks, control or bidi characters into an href', () => {
    for (const text of ['[a](https://x.com"onmouseover=alert(1))', 'https://x.com/<b>', 'https://x.com/a`b', 'https://x.com/\u0000a', 'https://x.com/\u202Egnp.exe']) {
      for (const l of parseRich(text).links) expect(l.href).toMatch(/^https?:\/\/[^\s"<>`\u0000-\u001f\u202e]*$/);
    }
    expect(parseRich('[a](https://x.com"onmouseover=alert(1))').links.map((l) => l.href)).toEqual(['https://x.com']);
    expect(normalizeHref('https://x.com/"a')).toBeNull();
  });

  it('does not take a URL glued to a word for a bare link', () => {
    expect(parseRich('xhttps://a.com').links).toEqual([]);
  });
});

describe('link helpers', () => {
  it('shortUrl keeps host and path, drops the scheme and a trailing slash', () => {
    expect(shortUrl('https://www.example.com/')).toBe('www.example.com');
    expect(shortUrl('http://a.com/b/c?q=1')).toBe('a.com/b/c');
  });

  it('escapeLabel escapes brackets and backslashes', () => {
    expect(escapeLabel('a [b] \\ c')).toBe('a \\[b\\] \\\\ c');
  });

  it('normalizeHref accepts web addresses, adds https:// when missing, and rejects the rest', () => {
    expect(normalizeHref(' example.com/docs ')).toBe('https://example.com/docs');
    expect(normalizeHref('http://a.com')).toBe('http://a.com');
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('mailto:a@b.c')).toBeNull();
    expect(normalizeHref('two words')).toBeNull();
    expect(normalizeHref('https://a.com/x)y')).toBeNull(); // would not survive [label](href)
    expect(normalizeHref('')).toBeNull();
  });

  it('linkWhole wraps the whole plain text, or with null removes every link', () => {
    expect(linkWhole('Read [docs](https://a.com) [now]', 'https://b.com')).toBe('[Read docs \\[now\\]](https://b.com)');
    expect(linkWhole('Read [docs](https://a.com)', null)).toBe('Read docs');
    expect(parseRich(linkWhole('Plan', 'https://b.com')).links[0]).toMatchObject({ href: 'https://b.com', label: 'Plan' });
  });

  it('linkRange wraps a range and puts the caret after the new link', () => {
    expect(linkRange('Read the docs', 9, 13, 'https://a.com')).toEqual({ text: 'Read the [docs](https://a.com)', caret: 30 });
  });
});
