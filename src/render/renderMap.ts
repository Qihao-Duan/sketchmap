import rough from 'roughjs';
import { IMAGE_KEY_RE } from '../shared/types';
import type { MapLayout, TopicBox } from '../layout/map';
import { countDescendants } from '../model/tree';
import { FONT_STACK } from './fonts';
import { ASIDE_INK, badgeSize, HIGHLIGHTER, INK, LINK_COLOR, PRIORITY_COLORS } from '../layout/styles';

const SVGNS = 'http://www.w3.org/2000/svg';
export const SELECT_COLOR = '#4263eb';

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
    const em = b.toEmphasis;
    const width = (b.fromDepth === 0 ? 2.4 : 1.6) * (em === 'key' ? 1.45 : em === 'aside' ? 0.8 : 1);
    branches.appendChild(
      rc.path(b.d, {
        stroke: b.color.stroke, strokeWidth: width, roughness: 1, bowing: 0.8, seed: hashSeed(`${b.to}:branch`),
        ...(em === 'aside' ? { strokeLineDash: [6, 5] } : {}),
      }),
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

  const em = t.node.emphasis;
  const key = em === 'key';
  const aside = em === 'aside';
  const r = Math.min(26, Math.min(t.w, t.h) * 0.3);
  const { stroke, fill } = t.color;
  const outline = aside ? ASIDE_INK : stroke;
  const weight = key ? 1.5 : 1;
  const dash = aside ? { strokeLineDash: [5, 4] } : {};
  // Key: solid fill. Aside: no fill. Otherwise hachure, as by depth.
  const boxFill = (gap: number, fillWeight: number) =>
    key ? { fill, fillStyle: 'solid' } : aside ? {} : { fill, fillStyle: 'hachure', hachureGap: gap, fillWeight, hachureAngle: -41 };
  const shape = roundedRect(t.x, t.y, t.w, t.h, r);
  if (t.style.kind === 'root') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 2.2 * weight, roughness: 1, ...boxFill(7, 1.1), ...dash, seed }));
  } else if (t.style.kind === 'box') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 1.8 * weight, roughness: 1, ...boxFill(8, 0.9), ...dash, seed }));
  } else if (t.style.kind === 'small') {
    g.appendChild(rc.path(shape, { stroke: outline, strokeWidth: 1.4 * weight, roughness: 1, ...dash, seed }));
  } else {
    g.appendChild(rc.line(t.x, t.y + t.h, t.x + t.w, t.y + t.h, { stroke: outline, strokeWidth: 1.6 * weight, roughness: 1, ...dash, seed }));
  }

  const { fontSize, lineHeight, padX } = t.style;
  const centred = t.style.kind !== 'line';
  const ink = aside ? ASIDE_INK : INK;
  const textLeft = t.x + padX + t.badgeW;
  /** Left edge of line i; centred lines sit in the middle of the text block. */
  const lineLeft = (i: number) => (centred ? textLeft + (t.textW - t.lineWidths[i]) / 2 : textLeft);

  // Only keys of the stored-image form: a hand-edited map can't point the canvas or an export at another site.
  if (t.image && t.node.image && IMAGE_KEY_RE.test(t.node.image.key)) {
    el(doc, 'image', {
      class: 'topic-image', href: `/${t.node.image.key}`, x: t.x + t.image.x, y: t.y + t.image.y,
      width: t.image.w, height: t.image.h, preserveAspectRatio: 'xMidYMid slice',
    }, g);
    g.appendChild(rc.rectangle(t.x + t.image.x, t.y + t.image.y, t.image.w, t.image.h, {
      stroke: t.color.stroke, strokeWidth: 1.2, roughness: 0.9, seed: seed + 6,
    }));
  }

  t.lines.forEach((line, i) => {
    const lx = lineLeft(i);
    const lw = t.lineWidths[i];
    const by = t.y + t.textTop + i * lineHeight + lineHeight / 2 + fontSize * 0.34;
    if (em === 'highlight' && line.trim()) {
      const top = by - fontSize * 0.8;
      const bot = by + fontSize * 0.28;
      el(doc, 'g', { class: 'swipe' }, g).appendChild(
        rc.polygon([[lx - 5, top + 2], [lx + lw + 5, top - 1], [lx + lw + 3, bot + 1], [lx - 3, bot + 3]], {
          fill: HIGHLIGHTER, fillStyle: 'solid', stroke: 'none', roughness: 1.4, seed: seed + 40 + i,
        }),
      );
    }
    const text = el(doc, 'text', {
      x: centred ? lx + lw / 2 : lx,
      y: by,
      'font-size': fontSize,
      'font-family': FONT_STACK,
      'text-anchor': centred ? 'middle' : 'start',
      fill: ink,
      // Excalifont has one weight: Key text gets a thin outline in its own ink.
      ...(key ? { stroke: ink, 'stroke-width': 0.6, 'paint-order': 'stroke', 'stroke-linejoin': 'round' } : {}),
    }, g);
    const segs = t.segments[i];
    if (segs.every((s) => !s.href)) {
      text.textContent = line;
    } else {
      for (const s of segs) {
        if (!s.href) {
          el(doc, 'tspan', {}, text).textContent = s.text;
          continue;
        }
        const a = el(doc, 'a', { href: s.href, target: '_blank', rel: 'noopener noreferrer' }, text);
        el(doc, 'tspan', { fill: LINK_COLOR, ...(key ? { stroke: LINK_COLOR } : {}) }, a).textContent = s.text;
        if (s.text.trim()) {
          el(doc, 'g', { class: 'link-line' }, g).appendChild(
            rc.line(lx + s.x + 1, by + 4, lx + s.x + s.w - 1, by + 4, { stroke: LINK_COLOR, strokeWidth: 1.2, roughness: 0.5, seed: seed + 20 + i }),
          );
        }
      }
    }
  });

  if (t.node.priority) {
    const d = badgeSize(fontSize);
    const cx = lineLeft(0) - t.badgeW + d / 2;
    const cy = t.y + t.textTop + lineHeight / 2;
    const color = PRIORITY_COLORS[t.node.priority];
    const badge = el(doc, 'g', { class: 'badge' }, g);
    badge.appendChild(rc.circle(cx, cy, d, { fill: color, fillStyle: 'solid', stroke: color, strokeWidth: 1.2, roughness: 0.8, seed: seed + 50 }));
    el(doc, 'text', {
      x: cx, y: cy + d * 0.22, 'font-size': Math.round(d * 0.62), 'font-weight': 800,
      'font-family': 'system-ui, sans-serif', 'text-anchor': 'middle', fill: '#ffffff',
    }, badge).textContent = String(t.node.priority);
    el(doc, 'title', {}, badge).textContent = `Priority ${t.node.priority}`;
  }

  const note = t.node.note?.trim();
  if (note) {
    const ix = textLeft + t.textW + 8;
    const iy = t.y + t.textTop + (t.lines.length * lineHeight) / 2;
    const icon = el(doc, 'g', { class: 'note-icon' }, g);
    // A transparent target, so hovering anywhere on the little page shows the note.
    el(doc, 'rect', { x: ix - 4, y: iy - 11, width: 20, height: 22, fill: 'transparent', 'pointer-events': 'all' }, icon);
    icon.appendChild(rc.rectangle(ix, iy - 8, 12, 15, { stroke: INK, strokeWidth: 1, roughness: 0.8, seed: seed + 3 }));
    icon.appendChild(rc.line(ix + 3, iy - 3, ix + 9, iy - 3, { stroke: INK, strokeWidth: 1, roughness: 0.5, seed: seed + 4 }));
    icon.appendChild(rc.line(ix + 3, iy + 1, ix + 9, iy + 1, { stroke: INK, strokeWidth: 1, roughness: 0.5, seed: seed + 5 }));
    el(doc, 'title', {}, icon).textContent = note.length > 1000 ? `${note.slice(0, 1000)}…` : note;
  }

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
