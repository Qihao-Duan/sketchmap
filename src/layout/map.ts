import type { Emphasis, LayoutKind, MapNode } from '../shared/types';
import { parseRich } from '../shared/rich';
import { fixedSides, visibleChildren } from '../model/tree';
import { badgeSize, DECOR, GAP, IMAGE_GAP, PALETTE, ROOT_COLOR, styleFor, type BranchColor, type NodeStyle } from './styles';
import { wrapWithOffsets, type Measure } from './wrap';

export type Side = 1 | -1 | 0;

/** A run of one line's text: plain, or part of a link. x and w are measured from the line's left edge. */
export interface Segment {
  text: string;
  x: number;
  w: number;
  href?: string;
}

export interface Measured {
  style: NodeStyle;
  /** Wrapped lines; a marker emoji starts the first one. */
  lines: string[];
  lineWidths: number[];
  /** Each line cut at link boundaries. */
  segments: Segment[][];
  /** Width of the text block: the widest line, at least 1.6 em. */
  textW: number;
  /** Space left of the text for the priority badge; 0 without a priority. */
  badgeW: number;
  /** Space right of the text for the note icon; 0 without a note. */
  noteW: number;
  /** The image block, above the text, relative to the box's top-left. Absent without an image. */
  image?: { x: number; y: number; w: number; h: number };
  /** Offset from the box top to the top of the first text line: padY without an image, further down with one. */
  textTop: number;
  w: number;
  h: number;
}

export interface TopicBox extends Measured {
  id: string;
  node: MapNode;
  parentId: string | null;
  depth: number;
  side: Side;
  x: number;
  y: number;
  color: BranchColor;
  /** Centre of the fold toggle: just beyond where branches leave this topic. */
  fold: { x: number; y: number };
}

export interface BranchPath {
  from: string;
  to: string;
  d: string;
  color: BranchColor;
  fromDepth: number;
  /** Importance of the topic this branch leads into: Key branches are wider, Aside ones thinner and dashed. */
  toEmphasis?: Emphasis;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  kind: LayoutKind;
  boxes: TopicBox[];
  byId: Map<string, TopicBox>;
  branches: BranchPath[];
  bounds: Bounds;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

type Range = { start: number; end: number; href: string };

/** Cuts one wrapped line at link boundaries. `start` is the line's offset in the displayed text. */
function splitLine(text: string, start: number, links: Range[], fontSize: number, measure: Measure): Segment[] {
  const cuts = new Set([0, text.length]);
  for (const l of links) {
    const a = l.start - start;
    const b = l.end - start;
    if (b > 0 && a < text.length) {
      cuts.add(Math.max(0, a));
      cuts.add(Math.min(text.length, b));
    }
  }
  const points = [...cuts].sort((p, q) => p - q);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const piece = text.slice(points[i], points[i + 1]);
    if (!piece) continue;
    const at = start + points[i];
    const link = links.find((l) => at >= l.start && at < l.end);
    out.push({ text: piece, x: measure(text.slice(0, points[i]), fontSize), w: measure(piece, fontSize), ...(link && { href: link.href }) });
  }
  return out.length ? out : [{ text, x: 0, w: measure(text, fontSize) }];
}

export function measureTopic(node: MapNode, depth: number, measure: Measure, kind: LayoutKind = 'map'): Measured {
  const style = styleFor(depth, kind, node.emphasis);
  const rich = parseRich(node.text);
  const prefix = node.emoji ? `${node.emoji} ` : '';
  const display = prefix + rich.plain;
  // An image with nothing else to show is image-only: no text line. A marker, priority badge or note needs a line to sit on.
  const noText = !!node.image && !display.trim() && !node.priority && !node.note?.trim();
  // Where the text wraps: the width set on this topic by hand, else the width that goes with its level.
  const wrapped = noText ? [] : wrapWithOffsets(display || ' ', style.fontSize, node.wrap ?? style.maxW, measure);
  const lines = wrapped.map((l) => l.text);
  const lineWidths = lines.map((l) => measure(l, style.fontSize));
  const links = rich.links.map((l) => ({ start: l.start + prefix.length, end: l.end + prefix.length, href: l.href }));
  const segments = wrapped.map((l) => splitLine(l.text, l.start, links, style.fontSize, measure));
  const textW = lines.length ? lineWidths.reduce((m, lw) => Math.max(m, lw), style.fontSize * 1.6) : 0;
  const badgeW = node.priority ? badgeSize(style.fontSize) + DECOR.badgeGap : 0;
  const noteW = node.note?.trim() ? DECOR.noteW : 0;

  const img = node.image;
  const textTop = img ? style.padY + img.h + (lines.length ? IMAGE_GAP : 0) : style.padY;
  const w = Math.ceil((img ? Math.max(badgeW + textW + noteW, img.w) : badgeW + textW + noteW) + style.padX * 2);
  const h = img
    ? Math.ceil(textTop + lines.length * style.lineHeight + style.padY)
    : Math.ceil(lines.length * style.lineHeight + style.padY * 2);
  const image = img ? { x: style.kind === 'line' ? style.padX : (w - img.w) / 2, y: style.padY, w: img.w, h: img.h } : undefined;

  return { style, lines, lineWidths, segments, textW, badgeW, noteW, image, textTop, w, h };
}

export function boundsOf(boxes: TopicBox[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Where a branch leaves a topic towards `side`; underlined topics connect at the underline. */
export function anchorOut(b: TopicBox, side: 1 | -1): [number, number] {
  const y = b.style.kind === 'line' ? b.y + b.h : b.y + b.h / 2;
  return [side > 0 ? b.x + b.w : b.x, y];
}

export function anchorIn(b: TopicBox): [number, number] {
  const y = b.style.kind === 'line' ? b.y + b.h : b.y + b.h / 2;
  return [b.side >= 0 ? b.x : b.x + b.w, y];
}

function branchPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x2 - x1) / 2;
  return `M${r1(x1)} ${r1(y1)} C${r1(x1 + mx)} ${r1(y1)} ${r1(x2 - mx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}`;
}

export function computeLayout(root: MapNode, measure: Measure, kind: 'map' | 'logic' = 'map'): MapLayout {
  const measured = new Map<string, Measured>();
  const blockH = new Map<string, number>();
  const vGap = (depth: number) => (depth === 0 ? GAP.vRoot : GAP.vDeep);
  const hGap = (depth: number) => (depth === 0 ? GAP.hRoot : GAP.hDeep);

  const measureAll = (n: MapNode, depth: number) => {
    measured.set(n.id, measureTopic(n, depth, measure, kind));
    visibleChildren(n).forEach((c) => measureAll(c, depth + 1));
  };
  measureAll(root, 0);

  // Height of a topic's whole branch block.
  const block = (n: MapNode, depth: number): number => {
    const kids = visibleChildren(n);
    const own = measured.get(n.id)!.h;
    const total = kids.reduce((s, c) => s + block(c, depth + 1), 0) + vGap(depth) * Math.max(0, kids.length - 1);
    const h = Math.max(own, total);
    blockH.set(n.id, h);
    return h;
  };

  const boxes: TopicBox[] = [];
  const byId = new Map<string, TopicBox>();
  const branches: BranchPath[] = [];
  const add = (n: MapNode, depth: number, x: number, y: number, side: Side, color: BranchColor, parentId: string | null) => {
    const m = measured.get(n.id)!;
    const fs: 1 | -1 = side === -1 ? -1 : 1;
    const box: TopicBox = { ...m, id: n.id, node: n, parentId, depth, side, x, y, color, fold: { x: 0, y: 0 } };
    const [ox, oy] = anchorOut(box, fs);
    box.fold = { x: ox + fs * 11, y: oy };
    boxes.push(box);
    byId.set(n.id, box);
    return box;
  };

  const place = (n: MapNode, depth: number, edgeX: number, centerY: number, side: 1 | -1, color: BranchColor, parent: TopicBox) => {
    const m = measured.get(n.id)!;
    const box = add(n, depth, side > 0 ? edgeX : edgeX - m.w, centerY - m.h / 2, side, color, parent.id);
    branches.push({
      from: parent.id, to: n.id, d: branchPath(anchorOut(parent, side), anchorIn(box)), color, fromDepth: parent.depth,
      ...(n.emphasis && { toEmphasis: n.emphasis }),
    });
    const kids = visibleChildren(n);
    if (!kids.length) return;
    const total = kids.reduce((s, c) => s + blockH.get(c.id)!, 0) + vGap(depth) * (kids.length - 1);
    const nextEdge = side > 0 ? box.x + box.w + hGap(depth) : box.x - hGap(depth);
    let y = centerY - total / 2;
    for (const c of kids) {
      const bh = blockH.get(c.id)!;
      place(c, depth + 1, nextEdge, y + bh / 2, side, color, box);
      y += bh + vGap(depth);
    }
  };

  const rm = measured.get(root.id)!;
  const rootBox = add(root, 0, -rm.w / 2, -rm.h / 2, 0, ROOT_COLOR, null);
  const kids = visibleChildren(root);
  kids.forEach((c) => block(c, 1));
  const total = kids.reduce((s, c) => s + blockH.get(c.id)!, 0);
  const right: MapNode[] = [];
  const left: MapNode[] = [];
  const sides = kind === 'map' && kids.length ? fixedSides(root) : null;
  if (kind === 'logic') {
    right.push(...kids);
  } else if (sides) {
    // Put there by hand: nothing changes sides because a branch grew.
    kids.forEach((c, i) => (sides[i] === 'left' ? left : right).push(c));
    left.reverse();
  } else {
    let acc = 0;
    for (const c of kids) {
      if (right.length === 0 || acc < total / 2) {
        right.push(c);
        acc += blockH.get(c.id)!;
      } else {
        left.push(c);
      }
    }
    left.reverse(); // clockwise reading order, as in XMind
  }

  const column = (list: MapNode[], side: 1 | -1) => {
    const colH = list.reduce((s, c) => s + blockH.get(c.id)!, 0) + GAP.vRoot * Math.max(0, list.length - 1);
    let y = -colH / 2;
    for (const c of list) {
      const bh = blockH.get(c.id)!;
      const edge = side > 0 ? rm.w / 2 + GAP.hRoot : -rm.w / 2 - GAP.hRoot;
      place(c, 1, edge, y + bh / 2, side, PALETTE[kids.indexOf(c) % PALETTE.length], rootBox);
      y += bh + GAP.vRoot;
    }
  };
  column(right, 1);
  column(left, -1);

  return { kind, boxes, byId, branches, bounds: boundsOf(boxes) };
}
