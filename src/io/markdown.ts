import type { MapNode } from '../shared/types';
import { newNodeId } from '../model/ids';

const MAX_TEXT = 5000; // schema limit for topic text
/** Deepest topic level an outline can create (root = 0). Layout, render and schema all recurse per level. */
export const MAX_OUTLINE_DEPTH = 64;
const BULLET = /^(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;
const oneLine = (t: string) => t.replace(/\s*\n\s*/g, ' ').trim();

/** `# Root`, then nested `- ` bullets, 2 spaces per level. Pastes into Notion as a nested list. */
export function toMarkdown(root: MapNode): string {
  const out = [`# ${oneLine(root.text)}`];
  const walk = (node: MapNode, depth: number) => {
    for (const c of node.children) {
      out.push(`${'  '.repeat(depth)}- ${oneLine(c.text)}`);
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
  const make = (t: string): MapNode => ({ id: newNodeId(), text: t.slice(0, MAX_TEXT), children: [] });
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
