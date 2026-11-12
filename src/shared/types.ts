export type LayoutKind = 'map' | 'logic' | 'org';
export type Emphasis = 'key' | 'highlight' | 'aside';

export interface MapNode {
  id: string;
  text: string;
  children: MapNode[];
  collapsed?: boolean;
  note?: string;
  emoji?: string;
  emphasis?: Emphasis;
  priority?: 1 | 2 | 3;
  image?: { key: string; w: number; h: number };
  color?: string;
}

export interface MindMap {
  id: string;
  title: string;
  layout: LayoutKind;
  version: number;
  updatedAt: string;
  root: MapNode;
}

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export const LIMITS = { mapJsonBytes: 2_000_000 } as const;

/** The marker set: at most one marker per topic (spec §3). */
export const MARKERS = ['💡', '✅', '⚠️', '❓', '⭐', '📌', '🔥', '❌', '📅', '👤'] as const;
