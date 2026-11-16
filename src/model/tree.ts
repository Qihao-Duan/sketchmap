import type { BranchSide, MapNode, MindMap } from '../shared/types';
import { newMapId, newNodeId } from './ids';

export interface Found {
  node: MapNode;
  parent: MapNode | null;
  index: number;
  depth: number;
}

export function findNode(root: MapNode, id: string): Found | null {
  const stack: Found[] = [{ node: root, parent: null, index: 0, depth: 0 }];
  while (stack.length) {
    const f = stack.pop()!;
    if (f.node.id === id) return f;
    f.node.children.forEach((c, i) => stack.push({ node: c, parent: f.node, index: i, depth: f.depth + 1 }));
  }
  return null;
}

export function newNode(text = ''): MapNode {
  return { id: newNodeId(), text, children: [] };
}

export function createMap(title = 'Central topic', now = new Date().toISOString()): MindMap {
  return { id: newMapId(), title, layout: 'map', version: 0, updatedAt: now, root: { id: newNodeId(), text: title, children: [] } };
}

/**
 * Once the sides are fixed, writes down the side of every main branch that has none of its own, so that
 * it stays there whatever happens to the branch before it. Returns whether anything was written.
 */
export function settleSides(root: MapNode): boolean {
  const sides = fixedSides(root);
  if (!sides) return false;
  let changed = false;
  root.children.forEach((c, i) => {
    if (c.side) return;
    c.side = sides[i];
    changed = true;
  });
  return changed;
}

/**
 * For a map rewritten from text (the Outline panel), whose topics are all new: gives each main branch of
 * `to` the side that a main branch of `from` with the same text had, matching repeated texts in order.
 * `texts`, one per main branch of `from`, is the text to match each on when that is not the stored one
 * (what the outline makes of it). Nothing when the sides of `from` were balanced automatically.
 */
export function carrySides(from: MapNode, to: MapNode, texts?: readonly string[]): void {
  const sides = fixedSides(from);
  if (!sides) return;
  const byText = new Map<string, BranchSide[]>();
  from.children.forEach((c, i) => {
    const text = texts?.[i] ?? c.text;
    const list = byText.get(text);
    if (list) list.push(sides[i]);
    else byText.set(text, [sides[i]]);
  });
  for (const c of to.children) {
    const side = byText.get(c.text)?.shift();
    if (side) c.side = side;
  }
}

/**
 * Once the sides are fixed by hand, a new main branch gets a side of its own: the side with fewer
 * branches (right when equal), so new branches don't pile up on one side.
 */
function lighterSide(root: MapNode): BranchSide | undefined {
  const sides = fixedSides(root);
  if (!sides) return undefined;
  const right = sides.filter((s) => s === 'right').length;
  return right <= sides.length - right ? 'right' : 'left';
}

export function addChild(root: MapNode, parentId: string, child: MapNode): boolean {
  const f = findNode(root, parentId);
  if (!f) return false;
  delete f.node.collapsed;
  const side = f.parent ? undefined : lighterSide(root);
  if (side) child.side = side;
  f.node.children.push(child);
  return true;
}

export function addSiblingAfter(root: MapNode, id: string, sibling: MapNode): boolean {
  const f = findNode(root, id);
  if (!f) return false;
  if (!f.parent) return addChild(root, id, sibling);
  // A new main branch appears next to the one it was made from: on that one's side.
  const side = f.depth === 1 ? fixedSides(root)?.[f.index] : undefined;
  if (side) sibling.side = side;
  f.parent.children.splice(f.index + 1, 0, sibling);
  return true;
}

/** Removes a topic and its branch. Returns the id to select next, or null when nothing was removed. */
export function removeNode(root: MapNode, id: string): string | null {
  const f = findNode(root, id);
  if (!f || !f.parent) return null;
  const siblings = f.parent.children;
  siblings.splice(f.index, 1);
  return (siblings[f.index] ?? siblings[f.index - 1] ?? f.parent).id;
}

export function isInBranch(branchRoot: MapNode, id: string): boolean {
  return findNode(branchRoot, id) !== null;
}

/** Calls `visit` for every topic, parents before children. */
export function eachNode(root: MapNode, visit: (node: MapNode) => void): void {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    visit(node);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
}

/**
 * Of the topics in `ids`, those that are not inside another one of them, in drawing order: the branches a
 * multi-selection really stands for. The root is never one of them (it can't be moved or removed), and a
 * selected root does not hide the topics below it.
 */
export function topMost(root: MapNode, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  const out: string[] = [];
  const walk = (node: MapNode) => {
    for (const child of node.children) {
      if (wanted.has(child.id)) out.push(child.id);
      else walk(child);
    }
  };
  walk(root);
  return out;
}

/** Takes the given top-most topics out of their parents and returns them, in the order given. */
function detach(root: MapNode, tops: string[]): MapNode[] {
  const gone = new Set(tops);
  const taken = new Map<string, MapNode>();
  const prune = (node: MapNode) => {
    if (node.children.some((c) => gone.has(c.id))) {
      for (const c of node.children) if (gone.has(c.id)) taken.set(c.id, c);
      node.children = node.children.filter((c) => !gone.has(c.id));
    }
    node.children.forEach(prune);
  };
  prune(root);
  return tops.map((id) => taken.get(id)!);
}

/**
 * Removes several topics with their branches. Returns the id to select next, chosen the way removeNode
 * does it for the removed branch that holds `anchorId` (the next sibling still there, else the previous
 * one, else the parent), or null when nothing was removed.
 */
export function removeNodes(root: MapNode, ids: Iterable<string>, anchorId: string): string | null {
  const tops = topMost(root, ids);
  if (!tops.length) return null;
  const from = tops.find((id) => isInBranch(findNode(root, id)!.node, anchorId)) ?? tops[0];
  const f = findNode(root, from)!;
  const parent = f.parent!;
  const before = parent.children.map((c) => c.id);
  detach(root, tops);
  const left = new Set(parent.children.map((c) => c.id));
  const next = before.slice(f.index + 1).find((id) => left.has(id)) ?? before.slice(0, f.index).reverse().find((id) => left.has(id));
  return next ?? parent.id;
}

/** `into`: as the last children of the target. `before` / `after`: next to it, under its parent. */
export type Place = 'into' | 'before' | 'after';

export interface MoveTo {
  where?: Place;
  /** The side to put the topics on, when they end up as main branches (map layout). */
  side?: BranchSide;
  /** The side each main branch is shown on now: what the others keep once `side` fixes the sides. */
  shown?: Readonly<Record<string, BranchSide>>;
}

/**
 * Moves several topics (with their branches), in drawing order: as the last children of `targetId`,
 * or just before or after it. Returns false, changing nothing, when the target is one of them or
 * inside one of their branches, when a place next to the central topic is asked for, and when the
 * topics are there already (and on that side).
 *
 * `side` only counts where the topics end up as main branches: they get that side, and every other
 * main branch keeps the side it is shown on, so nothing else moves. A topic that ends up deeper loses
 * its side.
 */
export function moveNodes(root: MapNode, ids: Iterable<string>, targetId: string, to: MoveTo = {}): boolean {
  const where = to.where ?? 'into';
  const tops = topMost(root, ids);
  const target = findNode(root, targetId);
  if (!tops.length || !target) return false;
  if (tops.some((id) => isInBranch(findNode(root, id)!.node, targetId))) return false;
  const parent = where === 'into' ? target.node : target.parent;
  if (!parent) return false;
  const main = parent.id === root.id;
  const side = main ? to.side : undefined;

  const gone = new Set(tops);
  const stay = parent.children.filter((c) => !gone.has(c.id));
  const at = where === 'into' ? stay.length : stay.indexOf(target.node) + (where === 'after' ? 1 : 0);
  const order = [...stay.slice(0, at).map((c) => c.id), ...tops, ...stay.slice(at).map((c) => c.id)];
  const samePlace = order.length === parent.children.length && order.every((id, i) => parent.children[i].id === id);
  const sameSide = !side || tops.every((id) => (findNode(root, id)!.node.side ?? to.shown?.[id]) === side);
  if (samePlace && sameSide) return false;

  const moved = detach(root, tops);
  if (where === 'into') delete parent.collapsed;
  parent.children.splice(at, 0, ...moved);
  if (!main) {
    for (const node of moved) delete node.side;
  } else if (side) {
    for (const c of parent.children) {
      const keep = c.side ?? to.shown?.[c.id];
      if (keep) c.side = keep;
    }
    for (const node of moved) node.side = side;
  }
  return true;
}

export function setText(root: MapNode, id: string, text: string): boolean {
  const f = findNode(root, id);
  if (!f) return false;
  f.node.text = text;
  return true;
}

export function toggleCollapsed(root: MapNode, id: string): boolean {
  const f = findNode(root, id);
  if (!f || !f.parent || f.node.children.length === 0) return false;
  if (f.node.collapsed) delete f.node.collapsed;
  else f.node.collapsed = true;
  return true;
}

export function countDescendants(node: MapNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

export function visibleChildren(node: MapNode): MapNode[] {
  return node.collapsed ? [] : node.children;
}

/**
 * The side of each main branch, in order, once any of them was put on a side by hand; null while none
 * was, which leaves the map layout to balance the two sides itself. A main branch without a side of its
 * own goes where the branch before it is (a new sibling appears next to its neighbour); before any, right.
 */
export function fixedSides(root: MapNode): BranchSide[] | null {
  if (!root.children.some((c) => c.side)) return null;
  let side: BranchSide = 'right';
  return root.children.map((c) => (side = c.side ?? side));
}

/** Every topic's text, one per line: used to decide which font subsets to load. */
export function allText(root: MapNode): string {
  const out: string[] = [];
  const walk = (n: MapNode) => {
    out.push(n.text);
    n.children.forEach(walk);
  };
  walk(root);
  return out.join('\n');
}
