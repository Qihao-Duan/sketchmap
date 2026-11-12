/** A link inside topic text; start and end are offsets into the plain text. */
export interface RichLink {
  start: number;
  end: number;
  href: string;
  label: string;
}

// URL characters: no whitespace, parentheses (except one balanced level), quotes, angle brackets, backticks,
// control characters or bidi/zero-width marks, so an href can never break out of markup or disguise itself.
const URL_CHAR = String.raw`[^\s()<>"\x60\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]`;
const URL_BODY = String.raw`(?:${URL_CHAR}|\(${URL_CHAR}*\))+`;
// [label](http(s)://…): the label may hold escapes and newlines; the URL may hold one level of balanced parentheses.
const LINK = new RegExp(String.raw`\[((?:\\[\\\[\]]|[^\\\]])*)\]\((https?:\/\/${URL_BODY})\)`, 'iy');
const BARE = new RegExp(String.raw`https?:\/\/${URL_BODY}`, 'iy');
const LABEL_MAX = 28;

const unescapeLabel = (s: string) => s.replace(/\\([\\[\]])/g, '$1');

/** Drops trailing punctuation, and a closing parenthesis that has no opening one in the URL. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"]+$/, '');
  const count = (c: string) => u.split(c).length - 1;
  while (u.endsWith(')') && count('(') < count(')')) u = u.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  return u;
}

/** Host and path of a URL, at most 28 characters (spec §3). */
export function shortUrl(href: string): string {
  let s: string;
  try {
    const u = new URL(href);
    s = u.host + u.pathname;
  } catch {
    s = href.replace(/^https?:\/\//i, '');
  }
  s = s.replace(/\/$/, '');
  return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s;
}

/**
 * Topic text → what is shown, plus its links (spec §3). `[label](https://…)` and bare http(s) URLs are links;
 * `\[`, `\]` and `\\` are literal characters; everything else is plain text.
 */
export function parseRich(text: string): { plain: string; links: RichLink[] } {
  let plain = '';
  const links: RichLink[] = [];
  const add = (label: string, href: string) => {
    links.push({ start: plain.length, end: plain.length + label.length, href, label });
    plain += label;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && /[\\[\]]/.test(text[i + 1] ?? '')) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(text);
      if (m) {
        add(unescapeLabel(m[1]) || shortUrl(m[2]), m[2]);
        i += m[0].length;
        continue;
      }
    }
    if ((c === 'h' || c === 'H') && (i === 0 || !/[\w/]/.test(text[i - 1]))) {
      BARE.lastIndex = i;
      const m = BARE.exec(text);
      if (m) {
        const href = trimUrl(m[0]);
        add(shortUrl(href), href);
        i += href.length;
        continue;
      }
    }
    plain += c;
    i += 1;
  }
  return { plain, links };
}

export const escapeLabel = (s: string): string => s.replace(/[\\[\]]/g, '\\$&');

/** A web address someone typed or pasted → an http(s) href that survives `[label](href)`, or null. */
export function normalizeHref(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const href = /^[a-z][\w+.-]*:/i.test(s) ? s : `https://${s}`;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    new URL(href);
  } catch {
    return null;
  }
  const back = parseRich(`[x](${href})`).links;
  return back.length === 1 && back[0].href === href ? href : null;
}

/** The whole topic as one link to `href`; with `href` null, the topic's text with every link removed. */
export function linkWhole(text: string, href: string | null): string {
  const label = escapeLabel(parseRich(text).plain);
  return href ? `[${label}](${href})` : label;
}

/** Wraps text[start, end) as a link to `href`; `caret` is the position just after the new link. */
export function linkRange(text: string, start: number, end: number, href: string): { text: string; caret: number } {
  const link = `[${escapeLabel(text.slice(start, end))}](${href})`;
  return { text: text.slice(0, start) + link + text.slice(end), caret: start + link.length };
}
