import type { MapNode } from './types';

/** Title for listings: first line of the root text. Step 3 will strip link syntax here. */
export function plainTitle(root: MapNode): string {
  const first = root.text.split('\n')[0].trim();
  return (first || 'Untitled map').slice(0, 120);
}
