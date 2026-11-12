import rough from 'roughjs';
import type { MapLayout, TopicBox } from '../layout/map';
import { countDescendants } from '../model/tree';
import { FONT_STACK } from './fonts';

const SVGNS = 'http://www.w3.org/2000/svg';
export const SELECT_COLOR = '#4263eb';
const INK = '#1e1e1e';

export interface RenderOptions {
  selectedId?: string | null;
  dropTargetId?: string | null;
}

type RoughSvg = ReturnType<typeof rough.svg>;

/** Stable 1..2^31-1 seed from a string, so strokes don't wobble between redraws. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

function el<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = doc.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  r = Math.min(r, w / 2, h / 2);
  return `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} L${x + r} ${y + h} Q${x} ${y + h} ${x} ${y + h - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

export function renderMap(svg: SVGSVGElement, world: SVGGElement, layout: MapLayout, opts: RenderOptions): void {
  const doc = svg.ownerDocument;
  const rc = rough.svg(svg);
  world.replaceChildren();
  const branches = el(doc, 'g', { class: 'branches' }, world);
  const topics = el(doc, 'g', { class: 'topics' }, world);
  for (const b of layout.branches) {
    branches.appendChild(
      rc.path(b.d, { stroke: b.color.stroke, strokeWidth: b.fromDepth === 0 ? 2.4 : 1.6, roughness: 1, bowing: 0.8, seed: hashSeed(`${b.to}:branch`) }),
    );
  }
  for (const t of layout.boxes) drawTopic(doc, rc, topics, t, opts);
}

function drawTopic(doc: Document, rc: RoughSvg, parent: Element, t: TopicBox, opts: RenderOptions) {
  const cls = ['topic'];
  if (t.id === opts.selectedId) cls.push('selected');
  if (t.id === opts.dropTargetId) cls.push('drop');
  const g = el(doc, 'g', { class: cls.join(' '), 'data-id': t.id }, parent);
  el(doc, 'rect', { class: 'hit', x: t.x - 4, y: t.y - 4, width: t.w + 8, height: t.h + 8, fill: 'transparent', 'pointer-events': 'all' }, g);
  const seed = hashSeed(t.id);

  if (t.id === opts.selectedId) {
    g.appendChild(rc.rectangle(t.x - 7, t.y - 6, t.w + 14, t.h + 12, {
      stroke: SELECT_COLOR, strokeWidth: 1.4, roughness: 0.6, fill: '#fff3bf', fillStyle: 'solid', strokeLineDash: [6, 5], seed: seed + 7,
    }));
  }

  const r = Math.min(26, Math.min(t.w, t.h) * 0.3);
  const { stroke, fill } = t.color;
  if (t.style.kind === 'root') {
    g.appendChild(rc.path(roundedRect(t.x, t.y, t.w, t.h, r), {
      stroke, strokeWidth: 2.2, roughness: 1, fill, fillStyle: 'hachure', hachureGap: 7, fillWeight: 1.1, hachureAngle: -41, seed,
    }));
  } else if (t.style.kind === 'box') {
    g.appendChild(rc.path(roundedRect(t.x, t.y, t.w, t.h, r), {
      stroke, strokeWidth: 1.8, roughness: 1, fill, fillStyle: 'hachure', hachureGap: 8, fillWeight: 0.9, hachureAngle: -41, seed,
    }));
  } else if (t.style.kind === 'small') {
    g.appendChild(rc.path(roundedRect(t.x, t.y, t.w, t.h, r), { stroke, strokeWidth: 1.4, roughness: 1, seed }));
  } else {
    g.appendChild(rc.line(t.x, t.y + t.h, t.x + t.w, t.y + t.h, { stroke, strokeWidth: 1.6, roughness: 1, seed }));
  }

  const { fontSize, lineHeight, padX, padY } = t.style;
  const centred = t.style.kind !== 'line';
  t.lines.forEach((line, i) => {
    const text = el(doc, 'text', {
      x: centred ? t.x + t.w / 2 : t.x + padX,
      y: t.y + padY + i * lineHeight + lineHeight / 2 + fontSize * 0.34,
      'font-size': fontSize,
      'font-family': FONT_STACK,
      'text-anchor': centred ? 'middle' : 'start',
      fill: INK,
    }, g);
    text.textContent = line;
  });

  if (t.depth > 0 && t.node.children.length > 0) {
    const { x: cx, y: oy } = t.fold;
    const folded = !!t.node.collapsed;
    const fg = el(doc, 'g', { class: folded ? 'fold folded' : 'fold', 'data-fold': t.id }, g);
    if (folded) {
      fg.appendChild(rc.circle(cx, oy, 20, { stroke, strokeWidth: 1.3, roughness: 0.7, fill, fillStyle: 'solid', seed: seed + 9 }));
      const count = el(doc, 'text', { x: cx, y: oy + 4, 'font-size': 11.5, 'text-anchor': 'middle', 'font-weight': 700, 'font-family': 'system-ui, sans-serif', fill: INK }, fg);
      count.textContent = String(countDescendants(t.node));
    } else {
      fg.appendChild(rc.circle(cx, oy, 15, { stroke, strokeWidth: 1.2, roughness: 0.6, fill: '#ffffff', fillStyle: 'solid', seed: seed + 9 }));
      fg.appendChild(rc.line(cx - 4, oy, cx + 4, oy, { stroke, strokeWidth: 1.4, roughness: 0.3, seed: seed + 10 }));
    }
    el(doc, 'rect', { x: cx - 11, y: oy - 11, width: 22, height: 22, fill: 'transparent', 'pointer-events': 'all' }, fg);
    el(doc, 'title', {}, fg).textContent = folded ? 'Expand branch' : 'Fold branch';
  }
}
