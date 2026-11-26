export type LayoutKind = 'map' | 'logic' | 'org';
export type Emphasis = 'key' | 'highlight' | 'aside';
/** The side of the central topic a main branch was put on by hand (map layout). */
export type BranchSide = 'left' | 'right';

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
  /**
   * Only on a main branch (a child of the central topic), and only used by the map layout: the side it
   * was put on by hand. While no main branch has one, the layout balances the two sides itself.
   */
  side?: BranchSide;
  /**
   * Where this topic's text wraps, in px, when that was set by hand. Without it the text wraps at the
   * width that goes with the topic's level (`maxW` in the layout's styles). The topic stays as narrow as
   * its text: this is the widest a line may get, not the width of the box.
   */
  wrap?: number;
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

/** The least and the most a topic's text width may be set to by hand, in px (`MapNode.wrap`). */
export const WRAP_MIN_PX = 60;
export const WRAP_MAX_PX = 1600;

/** A stored image's key: `img/<mapId>/<file>.<png|jpg|webp|gif>`. The schema, the Worker and the renderer all check it. */
export const IMAGE_KEY_RE = /^img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/;

/** The marker set: at most one marker per topic (spec §3). */
export const MARKERS = ['💡', '✅', '⚠️', '❓', '⭐', '📌', '🔥', '❌', '📅', '👤'] as const;
