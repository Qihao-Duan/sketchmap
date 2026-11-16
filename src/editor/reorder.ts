import type { MapLayout, TopicBox } from '../layout/map';
import { GAP, ORG } from '../layout/styles';
import { eachNode, visibleChildren, type Place } from '../model/tree';
import type { BranchSide } from '../shared/types';
import type { Direction } from './keymap';

/** Where moved topics go: onto a topic (as its last children), or just before or after it. */
export interface Drop {
  targetId: string;
  where: Place;
  /** Map layout, a place among the main branches: the side of the central topic it is on. */
  side?: BranchSide;
}

/**
 * A drop found under the pointer, with the line to draw for it: where the topics will go next to a topic,
 * or which side of the central topic they will be on. None when they simply go onto the target.
 */
export interface DropAt extends Drop {
  line?: { x1: number; y1: number; x2: number; y2: number };
}

/** A press reaches this far beyond a topic's box (the `hit` rectangle the canvas draws). */
const HIT_PAD = 4;
/** Half the side of the square around a fold toggle that takes a press (as the canvas draws it). */
const FOLD_REACH = 11;
/** How far from a topic, in the gap between two of them, a drop still counts as next to it. */
const REACH = { below: 14, beside: 22 } as const;

/** How far from the central topic the line is drawn that shows which side a branch dropped on it goes to. */
const ROOT_SIDE_GAP = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The main branches of an org chart stand side by side; everywhere else siblings are listed one below the other. */
const sideBySide = (layout: MapLayout, b: TopicBox) => layout.kind === 'org' && b.depth === 1;

/** The side a main branch is shown on in the map layout; no other topic, and no other layout, has one. */
function sideOf(layout: MapLayout, b: TopicBox): BranchSide | undefined {
  if (layout.kind !== 'map' || b.depth !== 1) return undefined;
  return b.side === -1 ? 'left' : 'right';
}

/**
 * The place next to topic `b`: `first` is the one that comes first on screen (above it, or left of it in
 * an org chart's first row). The left side of the map layout runs from the bottom up, so there the place
 * above a topic is the one after it in order.
 */
function beside(layout: MapLayout, b: TopicBox, first: boolean): DropAt {
  const side = sideOf(layout, b);
  const bottomUp = side === 'left';
  const where: Place = first !== bottomUp ? 'before' : 'after';
  let line: DropAt['line'];
  if (sideBySide(layout, b)) {
    const x = first ? b.x - ORG.colGap / 2 : b.x + b.w + ORG.colGap / 2;
    line = { x1: x, y1: b.y, x2: x, y2: b.y + b.h };
  } else {
    const gap = layout.kind === 'org' ? ORG.rowGap : b.depth === 1 ? GAP.vRoot : GAP.vDeep;
    const y = first ? b.y - gap / 2 : b.y + b.h + gap / 2;
    line = { x1: b.x, y1: y, x2: b.x + b.w, y2: y };
  }
  return { targetId: b.id, where, ...(side && { side }), line };
}

/**
 * Where topics dragged to the point (x, y), in map units, would go, or null when that is no place for them.
 *
 * On a topic: its middle half takes them as children (so does its fold toggle); the quarter at its top
 * and at its bottom (left and right, for the first row of an org chart) are the places just before and
 * after it. Close to a topic, in the gap between two, the nearer one counts. The central topic only takes
 * children: in the map layout, on the side of the half pointed at. The moved topics and everything in
 * their branches are no place to drop.
 */
export function dropAt(layout: MapLayout, x: number, y: number, moving: readonly string[]): DropAt | null {
  const blocked = new Set<string>();
  for (const id of moving) {
    const node = layout.byId.get(id)?.node;
    if (node) eachNode(node, (n) => void blocked.add(n.id));
  }
  /**
   * The place that comes after topic `b` on screen. In the list of an org chart the row under a topic that
   * shows children is its first child, so there it is the place before that child (the first one not being
   * dragged); a line under the topic that put the dragged topics under its whole branch would mislead.
   */
  const after = (b: TopicBox): DropAt => {
    if (layout.kind === 'org' && b.depth > 1) {
      const child = visibleChildren(b.node).find((c) => !blocked.has(c.id));
      const first = child && layout.byId.get(child.id);
      if (first) return beside(layout, first, true);
    }
    return beside(layout, b, false);
  };

  let under: TopicBox | null = null;
  let underDist = Infinity;
  for (const b of layout.boxes) {
    if (x < b.x - HIT_PAD || x > b.x + b.w + HIT_PAD || y < b.y - HIT_PAD || y > b.y + b.h + HIT_PAD) continue;
    const dist = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (dist < underDist) {
      under = b;
      underDist = dist;
    }
  }
  if (under) {
    if (blocked.has(under.id)) return null;
    if (under.parentId == null) {
      if (layout.kind !== 'map') return { targetId: under.id, where: 'into' };
      // The half pointed at is the side the branch goes to; a line along that side of the central topic says which.
      const side: BranchSide = x < under.x + under.w / 2 ? 'left' : 'right';
      const edge = side === 'left' ? under.x - ROOT_SIDE_GAP : under.x + under.w + ROOT_SIDE_GAP;
      return { targetId: under.id, where: 'into', side, line: { x1: edge, y1: under.y, x2: edge, y2: under.y + under.h } };
    }
    const across = sideBySide(layout, under);
    const size = across ? under.w : under.h;
    const pos = across ? x - under.x : y - under.y;
    // A quarter at each end, so half the topic still takes children; bounded for very small and very tall topics.
    const edge = across ? clamp(size * 0.25, 10, 24) : clamp(size * 0.25, 5, 14);
    if (pos < edge) return beside(layout, under, true);
    if (pos > size - edge) return after(under);
    return { targetId: under.id, where: 'into' };
  }

  // The fold toggle (the counter badge, when folded) sits just beyond the topic and is part of it.
  for (const b of layout.boxes) {
    if (b.parentId == null || b.node.children.length === 0) continue;
    if (Math.abs(x - b.fold.x) > FOLD_REACH || Math.abs(y - b.fold.y) > FOLD_REACH) continue;
    return blocked.has(b.id) ? null : { targetId: b.id, where: 'into' };
  }

  let near: TopicBox | null = null;
  let nearDist = Infinity;
  let nearFirst = false;
  for (const b of layout.boxes) {
    if (b.parentId == null || blocked.has(b.id)) continue;
    const across = sideBySide(layout, b);
    let dist: number;
    let first: boolean;
    if (across) {
      if (y < b.y - HIT_PAD || y > b.y + b.h + HIT_PAD) continue;
      first = x < b.x;
      dist = first ? b.x - x : x - (b.x + b.w);
    } else {
      if (x < b.x - HIT_PAD || x > b.x + b.w + HIT_PAD) continue;
      first = y < b.y;
      dist = first ? b.y - y : y - (b.y + b.h);
    }
    if (dist <= (across ? REACH.beside : REACH.below) && dist < nearDist) {
      near = b;
      nearDist = dist;
      nearFirst = first;
    }
  }
  if (!near) return null;
  return nearFirst ? beside(layout, near, true) : after(near);
}

/**
 * The move that takes topic `id` one place in a direction among its siblings, as they are shown: up and
 * down where they are listed one below the other, left and right in the first row of an org chart. Null
 * when there is no place in that direction.
 *
 * In the map layout a main branch stays on its side going up or down; left and right take it to the other
 * side of the central topic, at about the height it is at.
 */
export function stepSibling(layout: MapLayout, id: string, dir: Direction): Drop | null {
  const b = layout.byId.get(id);
  if (!b || b.parentId == null) return null;
  const sideways = dir === 'left' || dir === 'right';
  const place = (o: TopicBox, first: boolean): Drop => {
    const { line: _line, ...drop } = beside(layout, o, first);
    return drop;
  };

  const side = sideOf(layout, b);
  if (side && sideways) {
    if (side === dir) return null;
    const centre = b.y + b.h / 2;
    const there = layout.boxes.filter((o) => o.depth === 1 && o.side === -b.side).sort((p, q) => p.y - q.y);
    if (!there.length) return { targetId: b.parentId, where: 'into', side: dir };
    const below = there.find((o) => o.y + o.h / 2 > centre);
    return below ? place(below, true) : place(there[there.length - 1], false);
  }

  const across = sideBySide(layout, b);
  if (across !== sideways) return null;
  const first = dir === 'up' || dir === 'left';
  const at = (o: TopicBox) => (across ? o.x : o.y);
  let next: TopicBox | null = null;
  for (const o of layout.boxes) {
    if (o.id === id || o.parentId !== b.parentId || o.side !== b.side) continue;
    const ahead = first ? at(o) < at(b) : at(o) > at(b);
    if (ahead && (!next || (first ? at(o) > at(next) : at(o) < at(next)))) next = o;
  }
  return next ? place(next, first) : null;
}

/** Map layout: the side every main branch is shown on now. Other layouts have no sides. */
export function shownSides(layout: MapLayout): Record<string, BranchSide> | undefined {
  if (layout.kind !== 'map') return undefined;
  const out: Record<string, BranchSide> = {};
  for (const b of layout.boxes) {
    const side = sideOf(layout, b);
    if (side) out[b.id] = side;
  }
  return out;
}
