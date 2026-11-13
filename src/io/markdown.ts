import { MARKERS, type MapNode } from '../shared/types';
import { newNodeId } from '../model/ids';

const MAX_TEXT = 5000; // schema limit for topic text
/** Deepest topic level an outline can create (root = 0). Layout, render and schema all recurse per level. */
export const MAX_OUTLINE_DEPTH = 64;
const BULLET = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ').trim();

const PRIORITY_MARK = { 1: '🔴', 2: '🟠', 3: '🔵' } as const;
const PRIORITY_FROM_MARK: Record<string, 1 | 2 | 3> = { '🔴': 1, '🟠': 2, '🔵': 3 };
const KEY_WITH_STARS = 'Key on topics whose text contains **';

/** One topic as one Markdown line: priority emoji, marker, then the text, bold for Key (spec §9). */
function topicLine(n: MapNode): string {
  let t = oneLine(n.text);
  // Text that already contains ** can't be wrapped unambiguously: it stays as is, and markdownLosses says so.
  if (n.emphasis === 'key' && t && !t.includes('**')) t = `**${t}**`;
  if (n.emoji) t = `${n.emoji} ${t}`;
  if (n.priority) t = `${PRIORITY_MARK[n.priority]} ${t}`;
  return t.trimEnd();
}

/** Reads back what `topicLine` writes: a leading 🔴/🟠/🔵, a leading marker and a space, and a whole item in **…** (spec §9). */
export function readDecorations(raw: string): Pick<MapNode, 'text' | 'priority' | 'emoji' | 'emphasis'> {
  let text = raw;
  const out: Pick<MapNode, 'priority' | 'emoji' | 'emphasis'> = {};
  const p = /^(🔴|🟠|🔵)\s*/u.exec(text);
  if (p) {
    out.priority = PRIORITY_FROM_MARK[p[1]];
    text = text.slice(p[0].length);
  }
  const marker = MARKERS.find((m) => text === m || text.startsWith(`${m} `));
  if (marker) {
    out.emoji = marker;
    text = text.slice(marker.length).replace(/^ /, '');
  }
  const bold = /^\*\*([\s\S]+)\*\*$/.exec(text);
  if (bold && bold[1].trim() && !bold[1].includes('**')) {
    out.emphasis = 'key';
    text = bold[1];
  }
  return { text, ...out };
}

/**
 * What Markdown can't carry, for the "not kept" notice (spec §9): Highlight, Aside, notes and images. Images are
 * listed here even when `toMarkdown` is asked to inline them (`imageBase`): pasting that text back into the Outline
 * panel and applying it turns `![](…)` into inert text, never back into a topic image (spec §9 ruling).
 */
export function markdownLosses(root: MapNode): string[] {
  const found = new Set<string>();
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.emphasis === 'highlight') found.add('Highlight');
    if (n.emphasis === 'aside') found.add('Aside');
    if (n.note?.trim()) found.add('notes');
    if (n.image) found.add('images');
    if (n.emphasis === 'key' && n.text.includes('**')) found.add(KEY_WITH_STARS);
    stack.push(...n.children);
  }
  return ['Highlight', 'Aside', 'notes', 'images', KEY_WITH_STARS].filter((x) => found.has(x));
}

/** `# Root`, then nested `- ` bullets, 2 spaces per level. Pastes into Notion as a nested list.
 * With `imageBase` set, a topic that has an image gets ` ![](${imageBase}/${key})` appended to its line (spec §9). */
export function toMarkdown(root: MapNode, opts: { imageBase?: string } = {}): string {
  const line = (node: MapNode): string => {
    const text = topicLine(node);
    return opts.imageBase && node.image ? `${text} ![](${opts.imageBase}/${node.image.key})` : text;
  };
  const out = [`# ${line(root)}`];
  const walk = (node: MapNode, depth: number) => {
    for (const c of node.children) {
      out.push(`${'  '.repeat(depth)}- ${line(c)}`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return `${out.join('\n')}\n`;
}

export interface ParsedOutline {
  root: MapNode;
  /** True when several top-level items were wrapped in a generated "Outline" root. */
  synthetic: boolean;
}

/** Headings and indented bullets (any indent width; a tab counts as 4 spaces) → a topic tree. */
export function parseOutline(text: string): ParsedOutline | null {
  const items: Array<{ depth: number; text: string }> = [];
  let headingDepth = -1;
  let indents: number[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const heading = /^\s*(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      if (!heading[2].trim()) continue;
      headingDepth = heading[1].length - 1;
      indents = [];
      items.push({ depth: headingDepth, text: heading[2].trim() });
      continue;
    }
    const body = raw.trimStart().replace(BULLET, '').trim();
    if (!body) continue;
    const indent = /^[\t ]*/.exec(raw)![0].replace(/\t/g, '    ').length;
    while (indents.length && indent < indents[indents.length - 1]) indents.pop();
    if (!indents.length || indent >= indents[indents.length - 1] + 2) indents.push(indent);
    items.push({ depth: headingDepth + indents.length, text: body });
  }
  if (!items.length) return null;

  const base = items.reduce((m, i) => Math.min(m, i.depth), Infinity);
  for (const i of items) i.depth -= base;
  const synthetic = !(items[0].depth === 0 && items.filter((i) => i.depth === 0).length === 1);
  const make = (t: string): MapNode => {
    const { text: body, ...rest } = readDecorations(t);
    return { id: newNodeId(), text: body.slice(0, MAX_TEXT), children: [], ...rest };
  };
  const root = synthetic ? make('Outline') : make(items.shift()!.text);

  const chain: MapNode[] = [root];
  for (const it of items) {
    const depth = Math.max(1, Math.min(it.depth + (synthetic ? 1 : 0), chain.length, MAX_OUTLINE_DEPTH));
    const node = make(it.text);
    chain.length = depth;
    chain[depth - 1].children.push(node);
    chain[depth] = node;
  }
  return { root, synthetic };
}
