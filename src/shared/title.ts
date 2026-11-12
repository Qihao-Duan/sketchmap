import type { MapNode } from './types';
import { parseRich } from './rich';

/** Title for listings: first line of the root's plain text (links show their labels). */
export function plainTitle(root: MapNode): string {
  const first = parseRich(root.text).plain.split('\n')[0].trim();
  return (first || 'Untitled map').slice(0, 120);
}
