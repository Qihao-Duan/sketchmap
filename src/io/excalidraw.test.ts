import { describe, expect, it } from 'vitest';
import { layoutMap } from '../layout';
import { ASIDE_INK, HIGHLIGHTER, INK, LINK_COLOR, PALETTE, PRIORITY_COLORS, ROOT_COLOR, branchStrokeWidth, topicStrokeWidth } from '../layout/styles';
import type { Measure } from '../layout/wrap';
import type { LayoutKind, MapNode } from '../shared/types';
import { excalidrawLosses, fileIdFor, pathPoints, toExcalidrawSkeleton, type Skeleton } from './excalidraw';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text, children, ...extra });
const KEY = 'img/AAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBB.png';
const scene = (root: MapNode, kind: LayoutKind = 'map', fileIds = new Map<string, string>()) => {
  const layout = layoutMap(root, kind, measure);
  return { layout, ...toExcalidrawSkeleton(layout, fileIds) };
};
const byId = (els: Skeleton[], id: string) => els.find((e) => e.id === id)!;

describe('pathPoints', () => {
  it('samples a cubic branch into five points, drawn curved', () => {
    const { points, curved } = pathPoints('M0 0 C50 0 50 100 100 100');
    expect(curved).toBe(true);
    expect(points).toEqual([[0, 0], [29.7, 15.6], [50, 50], [70.3, 84.4], [100, 100]]);
  });
  it('keeps an org elbow as straight corner points', () => {
    expect(pathPoints('M10 20 L10 -35.5 L60 -35.5')).toEqual({ points: [[10, 20], [10, -35.5], [60, -35.5]], curved: false });
  });
});

describe('toExcalidrawSkeleton', () => {
  it('draws the root as a hachured rounded rectangle and a depth-1 topic as a box in its branch colour', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('a', 'Alpha')]));
    const root = byId(elements, 'r:shape');
    const box = layout.byId.get('r')!;
    expect(root).toMatchObject({
      type: 'rectangle', x: box.x, y: box.y, width: box.w, height: box.h, strokeColor: ROOT_COLOR.stroke,
      backgroundColor: ROOT_COLOR.fill, fillStyle: 'hachure', strokeStyle: 'solid', roundness: { type: 3 },
      strokeWidth: topicStrokeWidth('root'), groupIds: ['topic:r'],
    });
    expect(byId(elements, 'a:shape')).toMatchObject({ type: 'rectangle', strokeColor: PALETTE[0].stroke, backgroundColor: PALETTE[0].fill });
  });

  it('underlines a depth-2 topic in the map layout, and boxes it (unfilled) in the org layout', () => {
    const tree = n('r', 'Root', [n('a', 'Alpha', [n('b', 'Beta')])]);
    const { layout, elements } = scene(tree);
    const b = layout.byId.get('b')!;
    expect(byId(elements, 'b:shape')).toMatchObject({ type: 'line', x: b.x, y: b.y + b.h, points: [[0, 0], [b.w, 0]], width: b.w, height: 0 });
    const org = scene(tree, 'org').elements;
    expect(byId(org, 'b:shape')).toMatchObject({ type: 'rectangle', backgroundColor: 'transparent', strokeWidth: topicStrokeWidth('small') });
  });

  it('gives Key a solid fill and heavier stroke, and Aside a dashed grey outline with grey text and no fill', () => {
    const { elements } = scene(n('r', 'Root', [n('k', 'Key', [], { emphasis: 'key' }), n('s', 'Side', [], { emphasis: 'aside' })]));
    expect(byId(elements, 'k:shape')).toMatchObject({ fillStyle: 'solid', strokeWidth: topicStrokeWidth('box', 'key') });
    expect(byId(elements, 's:shape')).toMatchObject({ strokeStyle: 'dashed', strokeColor: ASIDE_INK, backgroundColor: 'transparent' });
    expect(byId(elements, 's:text')).toMatchObject({ strokeColor: ASIDE_INK });
    expect(byId(elements, 's:branch')).toMatchObject({ strokeStyle: 'dashed', strokeWidth: branchStrokeWidth(0, 'aside') });
  });

  it('writes the shown text (link labels, marker) as one Excalifont text element, centred in a box and left-aligned on a line', () => {
    const { layout, elements, centres } = scene(n('r', 'See [docs](https://example.com/d) now', [n('a', 'A', [n('b', 'Beta')])], { emoji: '✅' }));
    const r = layout.byId.get('r')!;
    const text = byId(elements, 'r:text');
    expect(text).toMatchObject({
      type: 'text', text: r.lines.join('\n'), fontFamily: 5, fontSize: r.style.fontSize, textAlign: 'center',
      verticalAlign: 'top', lineHeight: r.style.lineHeight / r.style.fontSize, y: r.y + r.textTop,
      strokeColor: INK, link: 'https://example.com/d', groupIds: ['topic:r'],
    });
    expect(text.text).toContain('✅ See docs now');
    expect(centres.get('r:text')).toEqual({ x: r.x + r.style.padX + r.badgeW + r.textW / 2 });
    const b = layout.byId.get('b')!;
    expect(byId(elements, 'b:text')).toMatchObject({ textAlign: 'left', x: b.x + b.style.padX });
    expect(centres.has('b:text')).toBe(false);
  });

  it('colours a topic that is entirely one link in the link colour', () => {
    const { elements } = scene(n('r', 'Root', [n('a', '[Alpha](https://a.example)')]));
    expect(byId(elements, 'a:text')).toMatchObject({ strokeColor: LINK_COLOR, link: 'https://a.example' });
  });

  it('puts a highlighter swipe behind each non-blank line, before the text', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('h', 'Highlighted words', [], { emphasis: 'highlight' })]));
    const swipes = elements.filter((e) => e.id.startsWith('h:highlight'));
    expect(swipes).toHaveLength(layout.byId.get('h')!.lines.length);
    expect(swipes[0]).toMatchObject({ type: 'rectangle', backgroundColor: HIGHLIGHTER, fillStyle: 'solid', strokeColor: 'transparent' });
    expect(elements.indexOf(swipes[0])).toBeLessThan(elements.indexOf(byId(elements, 'h:text')));
  });

  it('draws a priority badge as a filled circle with a centred white number', () => {
    const { elements, centres } = scene(n('r', 'Root', [n('p', 'Urgent', [], { priority: 1 })]));
    expect(byId(elements, 'p:badge')).toMatchObject({ type: 'ellipse', backgroundColor: PRIORITY_COLORS[1], fillStyle: 'solid', strokeWidth: 1.2 });
    expect(byId(elements, 'p:badge-text')).toMatchObject({ type: 'text', text: '1', strokeColor: '#ffffff', fontFamily: 5 });
    const c = centres.get('p:badge-text')!;
    const badge = byId(elements, 'p:badge');
    expect(c.x).toBeCloseTo(badge.x + (badge.width as number) / 2);
    expect(c.y).toBeCloseTo(badge.y + (badge.height as number) / 2);
  });

  it('shows a folded branch as a counter circle and leaves its hidden topics out', () => {
    const { elements } = scene(n('r', 'Root', [n('f', 'Folded', [n('x', 'Hidden'), n('y', 'Hidden too')], { collapsed: true })]));
    expect(byId(elements, 'f:fold')).toMatchObject({ type: 'ellipse', width: 20, height: 20, strokeWidth: 1.3 });
    expect(byId(elements, 'f:fold-text')).toMatchObject({ type: 'text', text: '2' });
    expect(elements.some((e) => e.id.startsWith('x:'))).toBe(false);
  });

  it('adds an image element only for a fetched file, and always its frame', () => {
    const img = { key: KEY, w: 120, h: 80 };
    const tree = n('r', 'Root', [n('i', 'Pic', [], { image: img })]);
    const without = scene(tree).elements;
    expect(without.some((e) => e.id === 'i:image')).toBe(false);
    expect(byId(without, 'i:frame')).toMatchObject({ type: 'rectangle', width: 120, height: 80, backgroundColor: 'transparent', strokeWidth: 1.2 });
    const { layout, elements } = scene(tree, 'map', new Map([[KEY, fileIdFor(KEY)]]));
    const t = layout.byId.get('i')!;
    expect(byId(elements, 'i:image')).toMatchObject({
      type: 'image', fileId: fileIdFor(KEY), status: 'saved', x: t.x + t.image!.x, y: t.y + t.image!.y, width: 120, height: 80,
    });
  });

  it('ignores an image key that is not one of ours', () => {
    const bad = 'https://evil.example/x.png';
    const { elements } = scene(n('r', 'Root', [n('i', 'Pic', [], { image: { key: bad, w: 120, h: 80 } })]), 'map', new Map([[bad, 'x']]));
    expect(elements.some((e) => e.id === 'i:image' || e.id === 'i:frame')).toBe(false);
  });

  it('draws each branch as a line in its colour and width, starting at the path start', () => {
    const { layout, elements } = scene(n('r', 'Root', [n('a', 'Alpha')]));
    const b = layout.branches[0];
    const line = byId(elements, 'a:branch');
    const { points } = pathPoints(b.d);
    expect(line).toMatchObject({ type: 'line', x: points[0][0], y: points[0][1], strokeColor: b.color.stroke, strokeWidth: branchStrokeWidth(0), roundness: { type: 2 } });
    expect((line.points as number[][])[0]).toEqual([0, 0]);
    expect(line.width).toBeCloseTo(Math.abs(points[4][0] - points[0][0]));
    expect(elements.indexOf(line)).toBeLessThan(elements.indexOf(byId(elements, 'r:shape'))); // branches under topics
  });

  it('skips the text element of an image-only topic', () => {
    const { elements } = scene(n('r', 'Root', [n('i', '', [], { image: { key: KEY, w: 120, h: 80 } })]));
    expect(elements.some((e) => e.id === 'i:text')).toBe(false);
  });

  it('uses stable seeds, so two exports of the same map draw the same strokes', () => {
    const tree = n('r', 'Root', [n('a', 'Alpha')]);
    expect(scene(tree).elements).toEqual(scene(tree).elements);
    expect(typeof byId(scene(tree).elements, 'r:shape').seed).toBe('number');
  });
});

describe('excalidrawLosses', () => {
  it('lists notes, second links and folded topics, and nothing for a plain map', () => {
    const plain = layoutMap(n('r', 'Root', [n('a', 'Alpha')]), 'map', measure);
    expect(excalidrawLosses(plain)).toEqual([]);
    const lossy = layoutMap(n('r', 'Root', [
      n('a', 'Alpha', [], { note: 'a note' }),
      n('b', '[one](https://1.example) and [two](https://2.example)'),
      n('f', 'Folded', [n('x', 'Hidden')], { collapsed: true }),
    ]), 'map', measure);
    expect(excalidrawLosses(lossy)).toEqual(['notes', 'links after the first in a topic', 'topics inside folded branches']);
  });
});

describe('fileIdFor', () => {
  it('turns an image key into a stable, path-free id', () => {
    expect(fileIdFor(KEY)).toBe('AAAAAAAAAAAAAAAAAAAAA-BBBBBBBBBB');
  });
});
