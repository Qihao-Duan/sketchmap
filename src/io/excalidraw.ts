import type { BranchPath, MapLayout, TopicBox } from '../layout/map';
import { countDescendants } from '../model/tree';
import { hashSeed, storedImageKey } from '../render/renderMap';
import {
  ASIDE_INK, DECOR_STROKE, HIGHLIGHTER, INK, LINK_COLOR, PRIORITY_COLORS, badgeSize, branchStrokeWidth, topicStrokeWidth,
} from '../layout/styles';
import { bytesToBase64, imageFetchSignal } from './exportImage';

/** Our own loose type: the export only needs the fields it sets, and convertToExcalidrawElements fills in the rest. */
export interface Skeleton {
  type: 'rectangle' | 'ellipse' | 'line' | 'text' | 'image';
  id: string;
  x: number;
  y: number;
  [prop: string]: unknown;
}

/**
 * The skeletons, plus where to centre the text elements that Excalidraw measures itself: after conversion,
 * x = centre.x − width / 2 (and y = centre.y − height / 2 when y is given).
 */
export interface SkeletonScene {
  elements: Skeleton[];
  centres: Map<string, { x: number; y?: number }>;
}

/** Excalifont (spec §9). */
const EXCALIFONT = 5;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** An Excalidraw file id for one of our image keys: `img/<folder>/<file>.<ext>` → `<folder>-<file>`. */
export function fileIdFor(key: string): string {
  const [, folder, file] = key.split('/');
  return `${folder}-${file.replace(/\.[a-z]+$/, '')}`;
}

/**
 * The points along one of our branch paths. `M x y C x1 y1 x2 y2 x y` (map, logic, org root) is sampled at five
 * points and drawn curved; `M x y L … L …` (an org elbow) keeps its corners and is drawn straight.
 */
export function pathPoints(d: string): { points: Array<[number, number]>; curved: boolean } {
  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  if (d.includes('C')) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = nums;
    const at = (t: number): [number, number] => {
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      return [r1(a * x0 + b * x1 + c * x2 + e * x3), r1(a * y0 + b * y1 + c * y2 + e * y3)];
    };
    return { points: [0, 0.25, 0.5, 0.75, 1].map(at), curved: true };
  }
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return { points, curved: false };
}

/** What the `.excalidraw` file can't carry, in the order the editor lists it. */
export function excalidrawLosses(layout: MapLayout): string[] {
  const lost: string[] = [];
  if (layout.boxes.some((b) => b.node.note?.trim())) lost.push('notes');
  if (layout.boxes.some((b) => new Set(b.segments.flat().flatMap((s) => (s.href ? [s.href] : []))).size > 1)) {
    lost.push('links after the first in a topic');
  }
  if (layout.boxes.some((b) => b.node.collapsed && b.node.children.length > 0)) lost.push('topics inside folded branches');
  return lost;
}

function branch(b: BranchPath): Skeleton {
  const { points, curved } = pathPoints(b.d);
  const [x0, y0] = points[0];
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    type: 'line', id: `${b.to}:branch`, x: x0, y: y0,
    points: points.map(([x, y]) => [r1(x - x0), r1(y - y0)]),
    width: r1(Math.max(...xs) - Math.min(...xs)), height: r1(Math.max(...ys) - Math.min(...ys)),
    strokeColor: b.color.stroke, strokeWidth: branchStrokeWidth(b.fromDepth, b.toEmphasis),
    strokeStyle: b.toEmphasis === 'aside' ? 'dashed' : 'solid', roughness: 1,
    roundness: curved ? { type: 2 } : null, seed: hashSeed(`${b.to}:branch`),
  };
}

function topic(t: TopicBox, fileIds: ReadonlyMap<string, string>, out: Skeleton[], centres: SkeletonScene['centres']) {
  const groupIds = [`topic:${t.id}`];
  const seed = hashSeed(t.id);
  const em = t.node.emphasis;
  const key = em === 'key';
  const aside = em === 'aside';
  const { kind, fontSize, lineHeight, padX } = t.style;
  const strokeStyle = aside ? 'dashed' : 'solid';
  const outline = aside ? ASIDE_INK : t.color.stroke;
  const centred = kind !== 'line';
  const textLeft = t.x + padX + t.badgeW;
  const lineLeft = (i: number) => (centred ? textLeft + (t.textW - t.lineWidths[i]) / 2 : textLeft);
  const part = (p: Skeleton) => out.push({ roughness: 1, groupIds, ...p });

  if (kind === 'line') {
    part({
      type: 'line', id: `${t.id}:shape`, x: t.x, y: t.y + t.h, points: [[0, 0], [t.w, 0]], width: t.w, height: 0,
      strokeColor: outline, strokeWidth: topicStrokeWidth(kind, em), strokeStyle, roundness: null, seed,
    });
  } else {
    part({
      type: 'rectangle', id: `${t.id}:shape`, x: t.x, y: t.y, width: t.w, height: t.h, strokeColor: outline,
      backgroundColor: aside || kind === 'small' ? 'transparent' : t.color.fill, fillStyle: key ? 'solid' : 'hachure',
      strokeWidth: topicStrokeWidth(kind, em), strokeStyle, roundness: { type: 3 }, seed,
    });
  }

  // Only keys of the stored-image form, as on the canvas: a hand-edited map can't point the export elsewhere.
  const imageKey = storedImageKey(t);
  if (imageKey && t.image) {
    const box = { x: t.x + t.image.x, y: t.y + t.image.y, width: t.image.w, height: t.image.h };
    const fileId = fileIds.get(imageKey);
    if (fileId) {
      part({ type: 'image', id: `${t.id}:image`, ...box, fileId, status: 'saved', scale: [1, 1], strokeColor: 'transparent', seed: seed + 5 });
    }
    part({
      type: 'rectangle', id: `${t.id}:frame`, ...box, strokeColor: t.color.stroke, backgroundColor: 'transparent',
      strokeWidth: DECOR_STROKE.frame, roundness: null, seed: seed + 6,
    });
  }

  // Highlight swipes sit above the box (and any image), just behind the text, as in renderMap.
  if (em === 'highlight') {
    t.lines.forEach((line, i) => {
      if (!line.trim()) return;
      const by = t.y + t.textTop + i * lineHeight + lineHeight / 2 + fontSize * 0.34;
      const top = by - fontSize * 0.8;
      part({
        type: 'rectangle', id: `${t.id}:highlight${i}`, x: r1(lineLeft(i) - 4), y: r1(top),
        width: r1(t.lineWidths[i] + 8), height: r1(fontSize * 1.08), strokeColor: 'transparent',
        backgroundColor: HIGHLIGHTER, fillStyle: 'solid', roundness: null, seed: seed + 40 + i,
      });
    });
  }

  if (t.lines.join('').trim()) {
    const shown = t.segments.flat().filter((s) => s.text.trim());
    const href = shown.find((s) => s.href)?.href ?? null;
    const allLink = shown.length > 0 && shown.every((s) => s.href);
    part({
      type: 'text', id: `${t.id}:text`, x: textLeft, y: t.y + t.textTop, text: t.lines.join('\n'),
      fontSize, fontFamily: EXCALIFONT, textAlign: centred ? 'center' : 'left', verticalAlign: 'top',
      lineHeight: lineHeight / fontSize, strokeColor: allLink ? LINK_COLOR : aside ? ASIDE_INK : INK, link: href,
      seed: seed + 1,
    });
    if (centred) centres.set(`${t.id}:text`, { x: textLeft + t.textW / 2 });
  }

  if (t.node.priority) {
    const d = badgeSize(fontSize);
    const cx = lineLeft(0) - t.badgeW + d / 2;
    const cy = t.y + t.textTop + lineHeight / 2;
    const color = PRIORITY_COLORS[t.node.priority];
    part({
      type: 'ellipse', id: `${t.id}:badge`, x: cx - d / 2, y: cy - d / 2, width: d, height: d, strokeColor: color,
      backgroundColor: color, fillStyle: 'solid', strokeWidth: DECOR_STROKE.badge, seed: seed + 50,
    });
    part({
      type: 'text', id: `${t.id}:badge-text`, x: cx, y: cy, text: String(t.node.priority), fontSize: Math.round(d * 0.62),
      fontFamily: EXCALIFONT, textAlign: 'center', verticalAlign: 'middle', strokeColor: '#ffffff', seed: seed + 51,
    });
    centres.set(`${t.id}:badge-text`, { x: cx, y: cy });
  }

  if (t.depth > 0 && t.node.collapsed && t.node.children.length > 0) {
    const { x: cx, y: cy } = t.fold;
    part({
      type: 'ellipse', id: `${t.id}:fold`, x: cx - 10, y: cy - 10, width: 20, height: 20, strokeColor: t.color.stroke,
      backgroundColor: t.color.fill, fillStyle: 'solid', strokeWidth: DECOR_STROKE.foldCounter, seed: seed + 9,
    });
    part({
      type: 'text', id: `${t.id}:fold-text`, x: cx, y: cy, text: String(countDescendants(t.node)), fontSize: 12,
      fontFamily: EXCALIFONT, textAlign: 'center', verticalAlign: 'middle', strokeColor: INK, seed: seed + 10,
    });
    centres.set(`${t.id}:fold-text`, { x: cx, y: cy });
  }
}

/**
 * The map as Excalidraw skeletons, in drawing order: branches first, then each topic's parts (grouped, so a topic
 * moves as one in Excalidraw). Mirrors renderMap's geometry; notes, link underlines and editor-only controls are left out.
 */
export function toExcalidrawSkeleton(layout: MapLayout, fileIds: ReadonlyMap<string, string>): SkeletonScene {
  const elements: Skeleton[] = layout.branches.map(branch);
  const centres: SkeletonScene['centres'] = new Map();
  for (const t of layout.boxes) topic(t, fileIds, elements, centres);
  return { elements, centres };
}

/** Excalidraw's own media type for scene files. */
export const EXCALIDRAW_MIME = 'application/vnd.excalidraw+json';
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface BinaryFile { id: string; mimeType: string; dataURL: string; created: number; lastRetrieved: number }

/** Fetches each stored topic image once; a failed or non-image response leaves that image out. */
async function loadFiles(layout: MapLayout, fetchImpl: typeof fetch) {
  const keys = new Set<string>();
  for (const b of layout.boxes) {
    const key = storedImageKey(b);
    if (key) keys.add(key);
  }
  const files: Record<string, BinaryFile> = {};
  const fileIds = new Map<string, string>();
  const now = Date.now();
  await Promise.all([...keys].map(async (key) => {
    try {
      const res = await fetchImpl(`/${key}`, { signal: imageFetchSignal() });
      const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      if (!res.ok || !IMAGE_MIMES.has(mimeType)) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const id = fileIdFor(key);
      files[id] = { id, mimeType, dataURL: `data:${mimeType};base64,${bytesToBase64(bytes)}`, created: now, lastRetrieved: now };
      fileIds.set(key, id);
    } catch {
      // Left out, as the SVG export does (including a timed-out fetch); the frame still marks where it was.
    }
  }));
  // Every stored key we tried to fetch but isn't in fileIds failed or timed out.
  const missingImages = keys.size - fileIds.size;
  return { files, fileIds, missingImages };
}

/**
 * The `.excalidraw` file for the laid-out map (spec §9), plus how many stored images it could not keep. The
 * pinned library is loaded here, on demand, so it never weighs on the editor or the embed.
 */
export async function buildExcalidraw(
  layout: MapLayout,
  opts: {
    fetchImpl?: typeof fetch;
    source?: string;
    loadLibrary?: () => Promise<typeof import('@excalidraw/excalidraw')>;
  } = {},
): Promise<{ json: string; missingImages: number }> {
  const fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const loadLibrary = opts.loadLibrary ?? (() => import('@excalidraw/excalidraw'));
  const [{ convertToExcalidrawElements }, { files, fileIds, missingImages }] = await Promise.all([
    loadLibrary().catch(() => {
      throw new Error('Sketchmap was updated since this page was opened. Reload the page, then export again.');
    }),
    loadFiles(layout, fetchImpl),
  ]);
  const { elements: skeletons, centres } = toExcalidrawSkeleton(layout, fileIds);
  const converted = convertToExcalidrawElements(
    skeletons as unknown as Parameters<typeof convertToExcalidrawElements>[0],
    { regenerateIds: false },
  );
  const elements = converted.map((e) => {
    const c = centres.get(e.id);
    if (!c) return e;
    return { ...e, x: c.x - e.width / 2, ...(c.y === undefined ? {} : { y: c.y - e.height / 2 }) };
  });
  const json = JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: opts.source ?? location.origin,
    elements,
    appState: { viewBackgroundColor: '#ffffff' },
    files,
  }, null, 2);
  return { json, missingImages };
}
