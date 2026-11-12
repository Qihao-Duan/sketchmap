import type { MapNode } from '../shared/types';
import { visibleChildren } from '../model/tree';
import { boundsOf, measureTopic, type BranchPath, type MapLayout, type TopicBox } from './map';
import { ORG, PALETTE, ROOT_COLOR, type BranchColor } from './styles';
import type { Measure } from './wrap';

const r1 = (v: number) => Math.round(v * 10) / 10;

interface Row {
  node: MapNode;
  depth: number;
  parentId: string;
}

/** Org chart: root on top, first-level branches side by side, deeper levels as indented vertical lists. */
export function computeOrgLayout(root: MapNode, measure: Measure): MapLayout {
  const boxes: TopicBox[] = [];
  const byId = new Map<string, TopicBox>();
  const branches: BranchPath[] = [];

  const place = (n: MapNode, depth: number, x: number, y: number, color: BranchColor, parentId: string | null): TopicBox => {
    const m = measureTopic(n, depth, measure, 'org');
    const box: TopicBox = {
      id: n.id, node: n, parentId, depth, side: 0, x, y, w: m.w, h: m.h, style: m.style, lines: m.lines, color,
      fold: { x: x + m.w + 11, y: y + m.h / 2 },
    };
    boxes.push(box);
    byId.set(n.id, box);
    return box;
  };

  const rm = measureTopic(root, 0, measure, 'org');
  place(root, 0, -rm.w / 2, 0, ROOT_COLOR, null);

  // Each first-level branch becomes one column: its topics in reading order, indented by depth.
  const columns = visibleChildren(root).map((first) => {
    const rows: Row[] = [];
    const walk = (n: MapNode, depth: number, parentId: string) => {
      rows.push({ node: n, depth, parentId });
      visibleChildren(n).forEach((c) => walk(c, depth + 1, n.id));
    };
    walk(first, 1, root.id);
    const width = rows.reduce((m, r) => Math.max(m, (r.depth - 1) * ORG.indent + measureTopic(r.node, r.depth, measure, 'org').w), 0);
    return { rows, width };
  });

  const total = columns.reduce((s, c) => s + c.width, 0) + ORG.colGap * Math.max(0, columns.length - 1);
  const top = rm.h + ORG.rootGap;
  let x = -total / 2;
  columns.forEach((col, i) => {
    const color = PALETTE[i % PALETTE.length];
    let y = top;
    for (const row of col.rows) {
      const box = place(row.node, row.depth, x + (row.depth - 1) * ORG.indent, y, color, row.parentId);
      const p = byId.get(row.parentId)!;
      if (row.depth === 1) {
        const cx = box.x + box.w / 2;
        const mid = (p.y + p.h + box.y) / 2;
        branches.push({
          from: p.id, to: box.id, color, fromDepth: 0,
          d: `M0 ${r1(p.y + p.h)} C0 ${r1(mid)} ${r1(cx)} ${r1(mid)} ${r1(cx)} ${r1(box.y)}`,
        });
      } else {
        const px = p.x + ORG.indent / 2;
        const cy = box.y + box.h / 2;
        branches.push({
          from: p.id, to: box.id, color, fromDepth: p.depth,
          d: `M${r1(px)} ${r1(p.y + p.h)} L${r1(px)} ${r1(cy)} L${r1(box.x)} ${r1(cy)}`,
        });
      }
      y += box.h + ORG.rowGap;
    }
    x += col.width + ORG.colGap;
  });

  return { boxes, byId, branches, bounds: boundsOf(boxes) };
}
