import type { MapLayout } from '../layout/map';
import { facesFor } from '../render/fonts';
import { renderMap } from '../render/renderMap';

const SVGNS = 'http://www.w3.org/2000/svg';
const PAD = 40;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** @font-face rules with the needed woff2 subsets inlined, so the file looks right anywhere. */
export async function fontCssFor(
  text: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  base = '/fonts/',
): Promise<string> {
  const rules = await Promise.all(
    facesFor(text).map(async (f) => {
      const res = await fetchImpl(base + f.file);
      if (!res.ok) throw new Error(`Font ${f.file} could not be loaded (HTTP ${res.status})`);
      const b64 = bytesToBase64(new Uint8Array(await res.arrayBuffer()));
      return `@font-face{font-family:"${f.family}";src:url(data:font/woff2;base64,${b64}) format("woff2");unicode-range:${f.unicodeRange}}`;
    }),
  );
  return rules.join('\n');
}

/** Text of the laid-out (visible) topics only, so a folded branch's hidden text never pulls in font subsets the export doesn't draw. */
export function visibleText(layout: MapLayout): string {
  return layout.boxes.map((b) => b.lines.join('\n')).join('\n');
}

export async function buildSvg(
  layout: MapLayout,
  text: string,
  opts: { fetchImpl?: typeof fetch; background?: string } = {},
): Promise<string> {
  const doc = document.implementation.createDocument(SVGNS, 'svg', null);
  const svg = doc.documentElement as unknown as SVGSVGElement;
  const { x, y, w, h } = layout.bounds;
  const width = Math.ceil(w + PAD * 2);
  const height = Math.ceil(h + PAD * 2);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `${x - PAD} ${y - PAD} ${width} ${height}`);

  const style = doc.createElementNS(SVGNS, 'style');
  style.textContent = await fontCssFor(text, opts.fetchImpl);
  svg.appendChild(style);
  const bg = doc.createElementNS(SVGNS, 'rect');
  for (const [k, v] of Object.entries({ x: x - PAD, y: y - PAD, width, height, fill: opts.background ?? '#ffffff' })) bg.setAttribute(k, String(v));
  svg.appendChild(bg);
  const world = doc.createElementNS(SVGNS, 'g') as SVGGElement;
  svg.appendChild(world);

  renderMap(svg, world, layout, { selectedId: null });
  world.querySelectorAll('rect.hit, g.fold:not(.folded)').forEach((n) => n.remove()); // editor-only bits
  return new XMLSerializer().serializeToString(svg);
}

export async function svgToPng(svgText: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('The browser could not draw the SVG.'));
      img.src = url;
    });
    if (typeof img.decode === 'function') await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function fileName(title: string, ext: 'svg' | 'png'): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return `${base || 'mindmap'}.${ext}`;
}
