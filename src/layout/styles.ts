import type { Emphasis, LayoutKind } from '../shared/types';

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

function baseStyle(depth: number, kind: LayoutKind): NodeStyle {
  if (depth === 0) return { kind: 'root', fontSize: 28, padX: 26, padY: 15, maxW: 300, lineHeight: 36 };
  if (depth === 1) return { kind: 'box', fontSize: 20, padX: 16, padY: 9, maxW: 230, lineHeight: 26 };
  if (kind === 'org') return { kind: 'small', fontSize: 17, padX: 11, padY: 7, maxW: 200, lineHeight: 22 };
  return { kind: 'line', fontSize: 17, padX: 5, padY: 4, maxW: 250, lineHeight: 22 };
}

/**
 * Style by depth and layout, adjusted for importance (spec §6): Key text is 2 px larger and turns an
 * underlined or small topic into a box; Aside text is 2 px smaller.
 */
export function styleFor(depth: number, kind: LayoutKind = 'map', emphasis?: Emphasis): NodeStyle {
  const base = baseStyle(depth, kind);
  if (emphasis === 'key') {
    if (base.kind === 'line' || base.kind === 'small') {
      return { kind: 'box', fontSize: base.fontSize + 2, padX: 13, padY: 7, maxW: base.maxW, lineHeight: base.lineHeight + 2 };
    }
    return { ...base, fontSize: base.fontSize + 2, lineHeight: base.lineHeight + 2 };
  }
  if (emphasis === 'aside') return { ...base, fontSize: base.fontSize - 2, lineHeight: base.lineHeight - 2 };
  return base;
}

export const INK = '#1e1e1e';
/** Aside topics: dashed grey outline and grey text. */
export const ASIDE_INK = '#868e96';
/** Highlight: the highlighter swipe behind the text. */
export const HIGHLIGHTER = '#ffe066';
export const PRIORITY_COLORS: Record<1 | 2 | 3, string> = { 1: '#e03131', 2: '#f08c00', 3: '#1971c2' };
/** Diameter of the priority badge for a text size. */
export const badgeSize = (fontSize: number): number => Math.round(fontSize * 1.05);
/** Gap after the priority badge, and the slot after the text that holds the note icon. */
export const DECOR = { badgeGap: 6, noteW: 24 } as const;

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

/** Links in topic text (spec §6). */
export const LINK_COLOR = '#1971c2';
