import type { LayoutKind } from '../shared/types';

export type TopicKind = 'root' | 'box' | 'line' | 'small';

export interface NodeStyle {
  kind: TopicKind;
  fontSize: number;
  padX: number;
  padY: number;
  maxW: number;
  lineHeight: number;
}

export interface BranchColor {
  stroke: string;
  fill: string;
}

export function styleFor(depth: number, kind: LayoutKind = 'map'): NodeStyle {
  if (depth === 0) return { kind: 'root', fontSize: 28, padX: 26, padY: 15, maxW: 300, lineHeight: 36 };
  if (depth === 1) return { kind: 'box', fontSize: 20, padX: 16, padY: 9, maxW: 230, lineHeight: 26 };
  if (kind === 'org') return { kind: 'small', fontSize: 17, padX: 11, padY: 7, maxW: 200, lineHeight: 22 };
  return { kind: 'line', fontSize: 17, padX: 5, padY: 4, maxW: 250, lineHeight: 22 };
}

export const ROOT_COLOR: BranchColor = { stroke: '#1e1e1e', fill: '#ffec99' };

export const PALETTE: BranchColor[] = [
  { stroke: '#e03131', fill: '#ffc9c9' },
  { stroke: '#1971c2', fill: '#a5d8ff' },
  { stroke: '#2f9e44', fill: '#b2f2bb' },
  { stroke: '#f08c00', fill: '#ffec99' },
  { stroke: '#9c36b5', fill: '#eebefa' },
  { stroke: '#0c8599', fill: '#99e9f2' },
];

export const GAP = { hRoot: 70, hDeep: 36, vRoot: 26, vDeep: 10 } as const;

/** Org chart spacing: root → first row, between columns, per-level indent, between stacked rows. */
export const ORG = { rootGap: 56, colGap: 40, indent: 28, rowGap: 10 } as const;
