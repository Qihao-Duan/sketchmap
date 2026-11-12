import { describe, expect, it } from 'vitest';
import { ensureVisible, fitView, MAX_ZOOM, toScreen, zoomAt } from './viewport';

describe('viewport math', () => {
  it('fitView centres the bounds and caps the zoom', () => {
    const v = fitView({ x: -100, y: -50, w: 200, h: 100 }, 1000, 600);
    expect(v.k).toBe(1.15);
    expect(toScreen(v, 0, 0)).toEqual([500, 300]);
  });
  it('fitView shrinks big maps and leaves room for a right-side panel', () => {
    const v = fitView({ x: 0, y: 0, w: 2000, h: 500 }, 1000, 600, { rightInset: 300 });
    expect(v.k).toBeCloseTo((700 - 112) / 2000);
    expect(toScreen(v, 1000, 250)[0]).toBeCloseTo(350);
  });
  it('zoomAt keeps the point under the cursor still and clamps', () => {
    const v = zoomAt({ tx: 10, ty: 20, k: 1 }, 2, 300, 200);
    expect(toScreen(v, 290, 180)).toEqual([300, 200]);
    expect(zoomAt({ tx: 0, ty: 0, k: 2.9 }, 10, 0, 0).k).toBe(MAX_ZOOM);
  });
  it('ensureVisible pans just enough to bring a box inside the margin', () => {
    const v = ensureVisible({ tx: 0, ty: 0, k: 1 }, { x: 950, y: 10, w: 100, h: 20 }, 1000, 600, 70);
    expect(v.tx).toBe(-120);
    expect(v.ty).toBe(60);
    expect(ensureVisible({ tx: 0, ty: 0, k: 1 }, { x: 200, y: 200, w: 10, h: 10 }, 1000, 600)).toEqual({ tx: 0, ty: 0, k: 1 });
  });
});
