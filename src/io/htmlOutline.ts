import type { MapNode } from '../shared/types';
import { newNodeId } from '../model/ids';
import { MAX_OUTLINE_DEPTH, type ParsedOutline } from './markdown';

const MAX_TEXT = 5000;
const LIST = /^(UL|OL)$/;
const BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|PRE)$/;
const SKIP = /^(STYLE|SCRIPT|TEMPLATE)$/;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const bare = (s: string) => s.replace(/\s+/g, '');

/** Text of the given nodes as lines: <p>/<div>/<br> break lines; source whitespace collapses like a browser shows it. */
function textLines(nodes: Node[]): string[] {
  const lines = [''];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      lines[lines.length - 1] += n.textContent ?? '';
      return;
    }
    if (!(n instanceof Element) || SKIP.test(n.tagName)) return;
    if (n.tagName === 'BR') {
      lines.push('');
      return;
    }
    const block = BLOCK.test(n.tagName);
    if (block) lines.push('');
    n.childNodes.forEach(walk);
    if (block) lines.push('');
  };
  nodes.forEach(walk);
  return lines.map(squash).filter(Boolean);
}

/**
 * Nested <ul>/<ol> lists, as XMind and Notion put on the clipboard → a topic tree.
 * Returns null when there is no list, or when text exists outside the lists (the caller then uses text/plain).
 */
export function parseHtmlOutline(html: string): ParsedOutline | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const lists = Array.from(doc.body.querySelectorAll('ul, ol')).filter((l) => !l.parentElement?.closest('li'));
  if (!lists.length) return null;
  // A list nested straight inside another list (no <li> between) is counted twice here, so it also falls back.
  if (bare(lists.map((l) => l.textContent ?? '').join('')) !== bare(doc.body.textContent ?? '')) return null;

  const items = (list: Element) => Array.from(list.children).filter((c) => c.tagName === 'LI');
  let tooDeep = false;
  // An <li> with no text of its own, but with child items, contributes its children at its own level
  // (a Markdown round trip would otherwise write it as `- `, which parseOutline skips, orphaning its children).
  const toNode = (li: Element, depth: number): MapNode[] => {
    if (depth > MAX_OUTLINE_DEPTH) {
      tooDeep = true;
      return [];
    }
    const own = Array.from(li.childNodes).filter((c) => !(c instanceof Element && LIST.test(c.tagName)));
    const children = Array.from(li.children)
      .filter((c) => LIST.test(c.tagName))
      .flatMap(items)
      .flatMap((c) => toNode(c, depth + 1));
    const text = textLines(own).join('\n').slice(0, MAX_TEXT);
    if (text) return [{ id: newNodeId(), text, children }];
    return children.length ? children : [];
  };

  const tops = lists.flatMap(items);
  // Top items sit at depth 0 when there is one (it becomes the root), else at depth 1 under "Outline".
  const roots = tops.flatMap((li) => toNode(li, tops.length === 1 ? 0 : 1));
  // Deeper than MAX_OUTLINE_DEPTH: give up, so the caller uses text/plain, whose parser clamps the depth.
  if (tooDeep || !roots.length) return null;
  if (roots.length === 1) return { root: roots[0], synthetic: false };
  return { root: { id: newNodeId(), text: 'Outline', children: roots }, synthetic: true };
}
