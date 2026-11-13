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

/** A stored image's key: `img/<mapId>/<file>.<png|jpg|webp|gif>`. The schema, the Worker and the renderer all check it. */
export const IMAGE_KEY_RE = /^img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/;

/** The marker set: at most one marker per topic (spec §3). */
export const MARKERS = ['💡', '✅', '⚠️', '❓', '⭐', '📌', '🔥', '❌', '📅', '👤'] as const;
