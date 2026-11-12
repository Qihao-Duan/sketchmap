import type { Bounds } from '../layout/map';

export interface View {
  tx: number;
  ty: number;
  k: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
const clamp = (k: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));

export function fitView(
  bounds: Bounds,
  width: number,
  height: number,
  opts: { pad?: number; maxK?: number; rightInset?: number } = {},
): View {
  const pad = opts.pad ?? 56;
  const maxK = opts.maxK ?? 1.15;
  const w = width - (opts.rightInset ?? 0);
  const k = clamp(Math.min(maxK, (w - pad * 2) / Math.max(bounds.w, 1), (height - pad * 2) / Math.max(bounds.h, 1)));
  return { k, tx: w / 2 - (bounds.x + bounds.w / 2) * k, ty: height / 2 - (bounds.y + bounds.h / 2) * k };
}

export function zoomAt(view: View, factor: number, sx: number, sy: number): View {
  const k = clamp(view.k * factor);
  return { k, tx: sx - (sx - view.tx) * (k / view.k), ty: sy - (sy - view.ty) * (k / view.k) };
}

export function toScreen(view: View, x: number, y: number): [number, number] {
  return [view.tx + x * view.k, view.ty + y * view.k];
}

export function ensureVisible(view: View, box: Bounds, width: number, height: number, margin = 70): View {
  const [sx, sy] = toScreen(view, box.x, box.y);
  const sw = box.w * view.k;
  const sh = box.h * view.k;
  let { tx, ty } = view;
  if (sx < margin) tx += margin - sx;
  else if (sx + sw > width - margin) tx -= sx + sw - (width - margin);
  if (sy < margin) ty += margin - sy;
  else if (sy + sh > height - margin) ty -= sy + sh - (height - margin);
  return tx === view.tx && ty === view.ty ? view : { ...view, tx, ty };
}
