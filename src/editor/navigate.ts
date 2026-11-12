import type { MapLayout } from '../layout/map';
import type { Direction } from './keymap';

/** Nearest topic in a direction, by position, so it behaves the same in every layout. */
export function navigate(layout: MapLayout, fromId: string, dir: Direction): string | null {
  const cur = layout.byId.get(fromId);
  if (!cur) return null;
  const cx = cur.x + cur.w / 2;
  const cy = cur.y + cur.h / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const b of layout.boxes) {
    if (b.id === fromId) continue;
    const dx = b.x + b.w / 2 - cx;
    const dy = b.y + b.h / 2 - cy;
    const [main, side] = dir === 'right' ? [dx, dy] : dir === 'left' ? [-dx, dy] : dir === 'down' ? [dy, dx] : [-dy, dx];
    if (main <= 2) continue;
    const score = main + Math.abs(side) * (Math.abs(side) > main * 1.8 ? 6 : 2.2);
    if (score < bestScore) {
      bestScore = score;
      best = b.id;
    }
  }
  return best;
}
