// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { layoutMap } from '../layout';
import type { Measure } from '../layout/wrap';
import type { MapNode } from '../shared/types';
import { buildExcalidraw, fileIdFor } from './excalidraw';
import { fileName } from './exportImage';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode => ({ id, text, children, ...extra });
const KEY = 'img/AAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBB.png';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(() => {
  // jsdom has no FontFace; the library constructs (but never loads) font faces while measuring text.
  globalThis.FontFace ??= class {
    constructor(public family: string, public source: string, public descriptors?: object) {}
  } as unknown as typeof FontFace;
});

const okFetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url === `/${KEY}`) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  return new Response('nope', { status: 404 });
}) as typeof fetch;

describe('buildExcalidraw', () => {
  it('writes a scene Excalidraw itself restores, with our ids, Excalifont text and the image in files', async () => {
    const root = n('r', 'Root', [n('a', 'Alpha', [n('b', 'Beta')]), n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } })]);
    const layout = layoutMap(root, 'map', measure);
    const { json, missingImages } = await buildExcalidraw(layout, { fetchImpl: okFetch, source: 'https://sketchmap.test' });
    expect(missingImages).toBe(0);
    const file = JSON.parse(json);
    expect(file).toMatchObject({ type: 'excalidraw', version: 2, source: 'https://sketchmap.test', appState: { viewBackgroundColor: '#ffffff' } });

    const { restore } = await import('@excalidraw/excalidraw');
    const restored = restore(file, null, null);
    const ids = restored.elements.map((e) => e.id);
    expect(ids).toEqual(file.elements.map((e: { id: string }) => e.id)); // nothing dropped on load
    expect(ids).toEqual(expect.arrayContaining(['r:shape', 'r:text', 'a:branch', 'b:shape', 'i:image', 'i:frame']));

    const text = restored.elements.find((e) => e.id === 'a:text')!;
    expect(text).toMatchObject({ type: 'text', text: 'Alpha', fontFamily: 5 });
    const id = fileIdFor(KEY);
    expect(restored.elements.find((e) => e.id === 'i:image')).toMatchObject({ type: 'image', fileId: id });
    expect(restored.files[id]).toMatchObject({ id, mimeType: 'image/png' });
    expect(restored.files[id].dataURL).toMatch(/^data:image\/png;base64,/);
  });

  it('centres box text on the topic after Excalidraw measures it', async () => {
    const layout = layoutMap(n('r', 'Root words'), 'map', measure);
    const r = layout.byId.get('r')!;
    const { json } = await buildExcalidraw(layout, { fetchImpl: okFetch });
    const file = JSON.parse(json);
    const text = file.elements.find((e: { id: string }) => e.id === 'r:text');
    expect(text.x + text.width / 2).toBeCloseTo(r.x + r.style.padX + r.badgeW + r.textW / 2, 5);
  });

  it('drops an image that fails to load, keeping its frame, never fetches a foreign key, and counts it missing', async () => {
    const calls: string[] = [];
    const failing = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response('gone', { status: 404 });
    }) as typeof fetch;
    const root = n('r', 'Root', [
      n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } }),
      n('x', 'Evil', [], { image: { key: 'https://evil.example/x.png', w: 120, h: 80 } }),
    ]);
    const { json, missingImages } = await buildExcalidraw(layoutMap(root, 'map', measure), { fetchImpl: failing });
    const file = JSON.parse(json);
    const ids = file.elements.map((e: { id: string }) => e.id);
    expect(ids).toContain('i:frame');
    expect(ids).not.toContain('i:image');
    expect(file.files).toEqual({});
    expect(calls).toEqual([`/${KEY}`]);
    expect(missingImages).toBe(1);
  });

  it('refuses a response that is not an image type it knows, and counts it missing', async () => {
    const html = (async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })) as typeof fetch;
    const root = n('r', 'Root', [n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } })]);
    const { json, missingImages } = await buildExcalidraw(layoutMap(root, 'map', measure), { fetchImpl: html });
    expect(JSON.parse(json).files).toEqual({});
    expect(missingImages).toBe(1);
  });

  it('gives each image fetch an AbortSignal, so a stalled request times out instead of locking the export', async () => {
    const inits: (RequestInit | undefined)[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      inits.push(init);
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }) as typeof fetch;
    const root = n('r', 'Root', [n('i', 'Pic', [], { image: { key: KEY, w: 120, h: 80 } })]);
    await buildExcalidraw(layoutMap(root, 'map', measure), { fetchImpl });
    expect(inits).toHaveLength(1);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('clears with a reload message when the dynamic import of the library rejects (e.g. a stale chunk after a redeploy)', async () => {
    const root = n('r', 'Root');
    const layout = layoutMap(root, 'map', measure);
    const loadLibrary = () => Promise.reject(new Error('Failed to fetch dynamically imported module: …'));
    await expect(buildExcalidraw(layout, { fetchImpl: okFetch, loadLibrary }))
      .rejects.toThrow('Sketchmap was updated since this page was opened. Reload the page, then export again.');
  });
});

describe('fileName', () => {
  it('names the download .excalidraw', () => {
    expect(fileName('My map', 'excalidraw')).toBe('My map.excalidraw');
  });
});
