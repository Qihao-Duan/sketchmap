import type { LayoutKind, MapNode } from '../shared/types';
import { visibleChildren } from '../model/tree';
import { GAP, PALETTE, ROOT_COLOR, styleFor, type BranchColor, type NodeStyle } from './styles';
import { wrapText, type Measure } from './wrap';

export type Side = 1 | -1 | 0;

export interface TopicBox {
  id: string;
  node: MapNode;
  parentId: string | null;
  depth: number;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  style: NodeStyle;
  lines: string[];
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
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  boxes: TopicBox[];
  byId: Map<string, TopicBox>;
  branches: BranchPath[];
  bounds: Bounds;
}

export interface Measured {
  style: NodeStyle;
  lines: string[];
  w: number;
  h: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function measureTopic(node: MapNode, depth: number, measure: Measure, kind: LayoutKind = 'map'): Measured {
  const style = styleFor(depth, kind);
  const lines = wrapText(node.text || ' ', style.fontSize, style.maxW, measure);
  const textW = Math.max(style.fontSize * 1.6, ...lines.map((l) => measure(l, style.fontSize)));
  return {
    style,
    lines,
    w: Math.ceil(textW + style.padX * 2),
    h: Math.ceil(lines.length * style.lineHeight + style.padY * 2),
  };
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
    const box: TopicBox = {
      id: n.id, node: n, parentId, depth, side, x, y, w: m.w, h: m.h, style: m.style, lines: m.lines, color,
      fold: { x: 0, y: 0 },
    };
    const [ox, oy] = anchorOut(box, fs);
    box.fold = { x: ox + fs * 11, y: oy };
    boxes.push(box);
    byId.set(n.id, box);
    return box;
  };

  const place = (n: MapNode, depth: number, edgeX: number, centerY: number, side: 1 | -1, color: BranchColor, parent: TopicBox) => {
    const m = measured.get(n.id)!;
    const box = add(n, depth, side > 0 ? edgeX : edgeX - m.w, centerY - m.h / 2, side, color, parent.id);
    branches.push({ from: parent.id, to: n.id, d: branchPath(anchorOut(parent, side), anchorIn(box)), color, fromDepth: parent.depth });
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
  if (kind === 'logic') {
    right.push(...kids);
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

  return { boxes, byId, branches, bounds: boundsOf(boxes) };
}
