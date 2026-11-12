import type { MapNode, MindMap } from '../shared/types';
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

export function addChild(root: MapNode, parentId: string, child: MapNode): boolean {
  const f = findNode(root, parentId);
  if (!f) return false;
  delete f.node.collapsed;
  f.node.children.push(child);
  return true;
}

export function addSiblingAfter(root: MapNode, id: string, sibling: MapNode): boolean {
  const f = findNode(root, id);
  if (!f) return false;
  if (!f.parent) return addChild(root, id, sibling);
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

/** Makes `id` (with its branch) the last child of `targetId`. Refuses the root and moves into its own branch. */
export function moveNode(root: MapNode, id: string, targetId: string): boolean {
  if (id === targetId) return false;
  const f = findNode(root, id);
  if (!f || !f.parent || isInBranch(f.node, targetId)) return false;
  const target = findNode(root, targetId);
  if (!target) return false;
  f.parent.children.splice(f.index, 1);
  delete target.node.collapsed;
  target.node.children.push(f.node);
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
