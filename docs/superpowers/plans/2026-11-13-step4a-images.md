# Step 4a: images in topics — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A topic can carry one image. You add it from the details panel, by pasting, or by dropping a file on the topic. The browser re-encodes it, the Worker stores it in R2 and serves it at `/img/…`, and it is drawn above the text with a sketchy frame in the editor, the Notion view and both exports. Sizes are S, M and L, and the image can be replaced or removed. Images in `.xmind` files come along too.

**Architecture:**
- **Worker.** One R2 bucket (`MAPS`) holds `maps/<id>.json` and `img/<mapId>/<nanoid>.<ext>`.
  - The Worker gains `POST /api/maps/:id/images` (owner only, at most 5 MB, the type sniffed from magic bytes).
  - It also gains a public `GET /img/<mapId>/<file>`: immutable caching, `nosniff`, and a sandboxing CSP on the image response.
  - Deleting a map also deletes its images.
- **Browser.** It re-encodes every image before upload: the longest side at most 2048 px, PNG when there is transparency, otherwise JPEG at 0.85. SVG is refused.
- **Layout and renderer.** The layout reserves the image block above the text. The renderer draws `<image href="/img/…">` with a rough frame. The SVG/PNG export inlines images as data URIs.

**Tech Stack:** React 19, TypeScript, Cloudflare Workers + R2, Canvas/`createImageBitmap`, Vitest (node, jsdom, Workers pool), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md`
- §3 Images
- §4: "Paste or drop an image", and the details panel's image row
- §6 Images, and dark mode
- §8: `POST /api/maps/:id/images`, `GET /img/:key`, image clean-up
- §9: images in Markdown out; `.xmind` images
- §10: image problems show a toast that says why; e2e "Attach an image"
- §11 step 4

## Global Constraints

**Storage and upload (spec §3):**
- The topic holds `image: { key, w, h }`, where `w`/`h` are the display size in px.
- R2 key: `img/<mapId>/<nanoid>.<ext>`, with `ext ∈ png|jpg|webp|gif`. This is the existing schema regex.
- Before upload, re-encode: the longest side at most 2048 px; PNG if there is any transparency, otherwise JPEG at quality 0.85. SVG is rejected, because it can carry script.
- Display width defaults to 200 px. S, M and L are 120, 200 and 300 px, with the aspect ratio kept. There is no free resize.
- The server rejects uploads over 5 MB, and checks the type from the magic bytes, not from `Content-Type`.

**Serving (spec §8):**
- `GET /img/:key` sends `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff`.
- Ruling: it also sends `Content-Security-Policy: default-src 'none'; sandbox`.
- Removing an image from a topic does NOT delete the file, because undo may need it. Deleting a map deletes all of its images.

**Rendering (spec §6):**
- Images go above the text, with a thin rough frame in the branch colour.
- In dark mode the canvas is inverted, so images get a counter-filter so photos don't come out inverted. Slight fading is fine.

**Errors (spec §10):** a non-image, an oversized file or a failed upload shows a message that says why, and the topic does not change.

**Markdown out (spec §9):** an image becomes `![](https://<host>/img/<key-without-img/>)`. In the URL this is just `${origin}/${key}`, appended to the topic's line.
- Ruling: the Outline panel's text leaves images out, because Markdown in keeps `![](…)` as text, so a Replace would turn images into text. The panel's "not kept" line names images.

**`.xmind` images (spec §9):**
- Non-SVG resources referenced by `image.src = "xap:resources/<name>"` are uploaded through the same path.
- SVG resources are counted as "N SVG images (not supported)". Uploads that fail are counted as "N images could not be added".
- At most 100 images per import; the rest are counted.

**Keep everything passing:** 302 unit tests, 14 Worker tests, 10 e2e tests, plus typecheck.

**Commits:** the subject line comes from the task. The co-author trailer goes only in a separate final `-m` paragraph.

## File map

| File | Change |
|---|---|
| `worker/images.ts` (new) | sniff, upload, serve, delete images |
| `worker/index.ts` | routes |
| `worker/maps.ts` | delete images on map delete |
| `worker/test/images.spec.ts` (new) | |
| `src/api/client.ts` | `uploadImage`; keep a caller's `Content-Type` |
| `src/io/imagePrep.ts` (new) | `prepareImage`, `displaySize`, `ImageError` |
| `src/io/imagePrep.test.ts` (new) | |
| `src/layout/map.ts` | image block in `measureTopic`: `Measured.image` and `Measured.textTop` |
| `src/render/renderMap.ts` | draw the image and frame; text below it |
| `src/io/exportImage.ts` | inline images as data URIs |
| `src/app.css` | dark-mode counter-filter |
| `src/editor/store.ts` | `setImage` and `setImageSize` |
| `src/editor/DetailsPanel.tsx` | Image row |
| `src/editor/Canvas.tsx` | drop a file on a topic |
| `src/editor/EditorPage.tsx` | upload flow, paste an image, error banner |
| `src/editor/InlineEditor.tsx` | sit below the image |
| `src/io/markdown.ts` | image in Markdown out; `markdownLosses` names images |
| `src/io/xmind.ts`, `src/list/ListPage.tsx` | `.xmind` images |
| `e2e/smoke.spec.ts`, `e2e/fixtures/pixel.ts` (new), `README.md` | e2e and docs |

**Order:**
- 1 (Worker) and 2 (client prep and the API) are independent.
- 3 (layout, render, export) is independent of 1 and 2.
- 4 (editor UI) needs 1–3.
- 5 (Markdown and `.xmind`) needs 1–3.
- 6 (e2e and README) needs everything.

---

### Task 1: The Worker stores, serves and cleans up images

**Files:**
- Create: `worker/images.ts`, `worker/test/images.spec.ts`
- Modify: `worker/index.ts`, `worker/maps.ts`

**Interfaces (produces):**
- `sniffImage(bytes: Uint8Array): { ext: 'png'|'jpg'|'webp'|'gif'; type: string } | null`
- `IMAGE_MAX_BYTES`
- `uploadImage(mapId, request, env)`
- `serveImage(pathname, env)`
- `deleteImages(mapId, env)`
- Routes: `POST /api/maps/:id/images` returns 201 `{ key }`. `GET /img/<mapId>/<file>` serves the image.

- [ ] **Step 1: Write the failing tests.** Create `worker/test/images.spec.ts`, using the same `call`/`create` helpers as `worker/test/maps.spec.ts`. Copy them in, because they are not exported.

```ts
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const upload = (id: string, body: BodyInit, key: string | null = KEY, type = 'image/png') =>
  call(`/api/maps/${id}/images`, { method: 'POST', body, headers: { 'Content-Type': type } }, key);

describe('images API', () => {
  it('stores an image under the map, serves it publicly with long caching, and refuses strangers', async () => {
    const { map } = await create();
    expect((await upload(map.id, PNG, null)).status).toBe(401);
    const res = await upload(map.id, PNG);
    expect(res.status).toBe(201);
    const { key } = (await res.json()) as { key: string };
    expect(key).toMatch(new RegExp(`^img/${map.id}/[A-Za-z0-9_-]{10}\\.png$`));
    const img = await worker.fetch(new Request(`http://x/${key}`), E);
    expect(img.status).toBe(200);
    expect(img.headers.get('Content-Type')).toBe('image/png');
    expect(img.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(img.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(img.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(PNG);
  });

  it('checks the type from the bytes, not the header; refuses SVG, text and anything over 5 MB', async () => {
    const { map } = await create();
    expect((await upload(map.id, '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>', KEY, 'image/png')).status).toBe(415);
    expect((await upload(map.id, 'hello', KEY, 'image/jpeg')).status).toBe(415);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await upload(map.id, big)).status).toBe(413);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(((await (await upload(map.id, jpeg, KEY, 'text/plain')).json()) as { key: string }).key).toMatch(/\.jpg$/);
  });

  it('needs an existing map, and serves 404 for unknown or malformed image paths', async () => {
    expect((await upload('abcdefghijklmnopqrstu', PNG)).status).toBe(404);
    for (const p of ['/img/nope', '/img/abcdefghijklmnopqrstu/x.svg', '/img/../maps/x.json', '/img/abcdefghijklmnopqrstu/missing.png']) {
      const r = await worker.fetch(new Request(`http://x${p}`), E);
      expect(r.status, p).toBe(404);
    }
  });

  it('deletes a map’s images with the map, and never lists images as maps', async () => {
    const { map } = await create('With image');
    const { key } = (await (await upload(map.id, PNG)).json()) as { key: string };
    const list = (await (await call('/api/maps')).json()) as Array<{ id: string }>;
    expect(list.every((m) => !m.id.includes('/'))).toBe(true);
    expect((await call(`/api/maps/${map.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await worker.fetch(new Request(`http://x/${key}`), E)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run `npm run test:worker`. Expected: the new tests fail with 404s.

- [ ] **Step 3: Implement `worker/images.ts`.**

```ts
import { newNodeId } from '../src/model/ids';
import { errorResponse, json } from './http';
import type { Env } from './index';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{21}$/;
/** Same pattern as the map schema's image key. */
const KEY_RE = /^img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/;
const NOT_FOUND_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8' };

/** The image type from its first bytes, never from the Content-Type header (spec §8). */
export function sniffImage(b: Uint8Array): { ext: 'png' | 'jpg' | 'webp' | 'gif'; type: string } | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { ext: 'png', type: 'image/png' };
  if (at(0, 0xff, 0xd8, 0xff)) return { ext: 'jpg', type: 'image/jpeg' };
  if (at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return { ext: 'gif', type: 'image/gif' };
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { ext: 'webp', type: 'image/webp' };
  return null;
}

/** POST /api/maps/:id/images (owner only): stores one image under the map and returns its key. */
export async function uploadImage(mapId: string, request: Request, env: Env): Promise<Response> {
  if (!ID_RE.test(mapId)) return errorResponse(404, 'Not found');
  if (Number(request.headers.get('Content-Length') ?? '0') > IMAGE_MAX_BYTES) return errorResponse(413, 'Image is larger than 5 MB');
  if (!(await env.MAPS.head(`maps/${mapId}.json`))) return errorResponse(404, 'Not found');
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > IMAGE_MAX_BYTES) return errorResponse(413, 'Image is larger than 5 MB');
  const kind = sniffImage(bytes);
  if (!kind) return errorResponse(415, 'Only PNG, JPEG, WebP and GIF images can be uploaded');
  const key = `img/${mapId}/${newNodeId()}.${kind.ext}`;
  await env.MAPS.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  return json({ key }, { status: 201 });
}

/** GET /img/<mapId>/<file>: public, cached for a year (keys never change), and inert even if opened directly. */
export async function serveImage(pathname: string, env: Env): Promise<Response> {
  const key = pathname.slice(1);
  if (!KEY_RE.test(key)) return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  const obj = await env.MAPS.get(key);
  if (!obj) return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      ETag: obj.httpEtag,
    },
  });
}

/** Deletes every image stored for a map (spec §8: clean-up on map delete). */
export async function deleteImages(mapId: string, env: Env): Promise<void> {
  let cursor: string | undefined;
  do {
    const page = await env.MAPS.list({ prefix: `img/${mapId}/`, cursor });
    if (page.objects.length) await env.MAPS.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
```

`tsconfig.worker.json` includes only `src/model/ids.ts` from `src/model`, and that is exactly what is imported.

- [ ] **Step 4: Route it.**

**`worker/index.ts`, `handleApi`:** allow 4 path parts. When `parts[3]` is present, it must be `'images'`, otherwise 404. That route needs the owner (401 otherwise), and only POST goes to `uploadImage(id, request, env)`; other methods get 405. The rest is unchanged.

**`fetch`:** before `serveAsset`, add:

```ts
    if (url.pathname.startsWith('/img/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed');
      try {
        return await serveImage(url.pathname, env);
      } catch (e) {
        console.error(e);
        return errorResponse(500, 'Internal error');
      }
    }
```

**`worker/maps.ts`, `deleteMap`:** `if (ID_RE.test(id)) { await env.MAPS.delete(objectKey(id)); await deleteImages(id, env); }`.

- [ ] **Step 5: Run the tests and the typecheck.** Run `npm run test:worker && npm run typecheck`. Expected: PASS, with 18 Worker tests.

- [ ] **Step 6: Commit.**

```bash
git add worker/images.ts worker/index.ts worker/maps.ts worker/test/images.spec.ts
git commit -m "feat(worker): store, serve and clean up topic images in R2" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Browser-side image preparation and the upload API

**Files:**
- Create: `src/io/imagePrep.ts`, `src/io/imagePrep.test.ts`
- Modify: `src/api/client.ts`, `src/api/client.test.ts` (if it exists; otherwise add the test to `imagePrep.test.ts`)

**Interfaces (produces):**
- `class ImageError extends Error`
- `IMAGE_SIZES = { S: 120, M: 200, L: 300 } as const`
- `displaySize(width: number, height: number, target = 200): { w: number; h: number }`. Width = target. Height keeps the aspect ratio, rounded. Both are clamped to 16–2048, as the schema requires.
- `sniffKind(bytes: Uint8Array): 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | null`
- `prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }>`
- `ApiClient.uploadImage(mapId: string, blob: Blob): Promise<{ key: string }>`

**Rules for `prepareImage`:**
- Read the first 512 bytes. If they look like SVG (the text after the BOM and whitespace starts with `<?xml` or `<svg`, or `file.type === 'image/svg+xml'`), throw `ImageError('SVG images aren’t supported (they can carry script).')`.
- If neither `sniffKind` nor `file.type` says png/jpeg/webp/gif, throw `ImageError('That file isn’t an image (PNG, JPEG, WebP or GIF).')`.
- If `file.size > 30 MB`, throw `ImageError('That image is too large (over 30 MB).')`, before decoding.
- Decode with `createImageBitmap(file)`. On failure, throw `ImageError('That image couldn’t be read.')`.
- Scale: `s = Math.min(1, 2048 / Math.max(w, h))`.
- Draw on a canvas: `OffscreenCanvas` if available, otherwise a `<canvas>`.
- Check transparency with `getImageData`: any alpha below 255 means PNG, otherwise JPEG at 0.85.
- If the result is over 5 MB, throw `ImageError('Even after shrinking, the image is larger than 5 MB.')`.
- Return the encoded blob and the scaled pixel size.

**`client.ts`:**
- In `request`, set `Content-Type: application/json` only when the caller has not set a `Content-Type`.
- Add:

```ts
    uploadImage: async (mapId, blob) =>
      (await (await request(`${mapPath(mapId)}/images`, { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' } })).json()) as { key: string },
```

Add `uploadImage(mapId: string, blob: Blob): Promise<{ key: string }>;` to the `ApiClient` interface. Any existing test fakes of `ApiClient` (for example `fakeApi()` in `EditorPage.test.tsx`) now need an `uploadImage: vi.fn()` to typecheck. Add it.

- [ ] **Step 1: Write the failing tests.** `src/io/imagePrep.test.ts`, in jsdom, for `File`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { displaySize, IMAGE_SIZES, ImageError, prepareImage, sniffKind } from './imagePrep';

describe('image preparation', () => {
  it('keeps the aspect ratio at the requested width, within the schema limits', () => {
    expect(displaySize(1000, 500)).toEqual({ w: 200, h: 100 });
    expect(displaySize(300, 900, IMAGE_SIZES.S)).toEqual({ w: 120, h: 360 });
    expect(displaySize(4000, 10)).toEqual({ w: 200, h: 16 });
    expect(displaySize(10, 4000, IMAGE_SIZES.L)).toEqual({ w: 300, h: 2048 });
  });

  it('recognises image types from their bytes', () => {
    expect(sniffKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe('jpeg');
    expect(sniffKind(new TextEncoder().encode('GIF89a...'))).toBe('gif');
    expect(sniffKind(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp');
    expect(sniffKind(new TextEncoder().encode('﻿  <svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg');
    expect(sniffKind(new TextEncoder().encode('hello'))).toBeNull();
  });

  it('refuses SVG and non-images with a message that says why', async () => {
    await expect(prepareImage(new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/SVG images aren’t supported/);
    await expect(prepareImage(new File(['<?xml version="1.0"?><svg/>'], 'x.png', { type: 'image/png' }))).rejects.toThrow(/SVG/);
    await expect(prepareImage(new File(['hello'], 'x.txt', { type: 'text/plain' }))).rejects.toBeInstanceOf(ImageError);
  });
});
```

  The real decoding and encoding is covered by the e2e in Task 6: jsdom has no `createImageBitmap`. The API test is a `createApi` call with a stub `fetchImpl`. It checks that the upload POSTs to `/api/maps/<id>/images` with the blob's `Content-Type` and the `Authorization` header, and returns `{ key }`.

- [ ] **Step 2: Run the tests and watch them fail.** Then implement, and run `npx vitest run src/io src/api && npm test && npm run typecheck`.

- [ ] **Step 3: Commit.**

```bash
git add src/io/imagePrep.ts src/io/imagePrep.test.ts src/api/client.ts src/api/client.test.ts src/editor/EditorPage.test.tsx
git commit -m "feat(io): re-encode images in the browser (≤2048 px, PNG or JPEG), refuse SVG; upload API" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

Add only the files that exist or changed.

---

### Task 3: Layout, rendering and export draw the image

**Files:**
- Modify: `src/layout/map.ts`, `src/render/renderMap.ts`, `src/io/exportImage.ts`, `src/editor/InlineEditor.tsx`, `src/app.css`
- Test: `src/layout/map.test.ts`, `src/render/renderMap.test.ts`, `src/io/exportImage.test.ts`

**Interfaces (produces):**
- `Measured.image?: { x: number; y: number; w: number; h: number }`, relative to the box's top-left.
- `Measured.textTop: number`, the offset from the box top to the top of the first text line (`padY` without an image).
- `IMAGE_GAP = 8`, in `styles.ts`.

**Layout rules (`measureTopic`):**
- With `node.image`:
  - The image block is `image.w × image.h` at `y = padY`.
  - If the topic's text (after the marker prefix) is empty, there are no text lines: `lines = []`, `lineWidths = []`, `segments = []`.
  - `textTop = padY + image.h + (lines.length ? IMAGE_GAP : 0)`.
  - `w = Math.ceil(Math.max(badgeW + textW + noteW, image.w) + 2 * padX)`, where `textW` is 0 when there are no lines.
  - `h = Math.ceil(textTop + lines.length * lineHeight + padY)`.
  - Image x: `padX` for `line` kind, otherwise `(w - image.w) / 2`.
- Without an image, nothing changes: `textTop = padY`, and `w`/`h` are as before.

**Renderer:**
- Place every text baseline, the badge and the note icon from `t.y + t.textTop` instead of `t.y + padY`.
- If `t.image` and `t.node.image`, draw before the text:
  - `el(doc, 'image', { class: 'topic-image', href: `/${t.node.image.key}`, x: t.x + t.image.x, y: t.y + t.image.y, width: t.image.w, height: t.image.h, preserveAspectRatio: 'xMidYMid slice' }, g)`
  - `g.appendChild(rc.rectangle(t.x + t.image.x, t.y + t.image.y, t.image.w, t.image.h, { stroke: t.color.stroke, strokeWidth: 1.2, roughness: 0.9, seed: seed + 6 }))`
- The image key matches `img/<mapId>/<file>`, so the URL is `/` plus the key.

**Export (`buildSvg`):**
- After `renderMap`, for every `image` element whose `href` starts with `/img/`, fetch it with `opts.fetchImpl`.
- Replace the `href` with `data:<content-type>;base64,<…>`, using the existing `bytesToBase64`.
- If a fetch fails, remove that `<image>`, so the export still works, and keep the frame.

**Inline editor:** position the textarea over the text part only.
- `top: view.ty + (box.y + box.textTop - box.style.padY) * k`
- `minHeight: (box.h - (box.textTop - box.style.padY)) * k`

**CSS (`app.css`):**
- In `:root`, add `--image-filter: none;`.
- In the dark-mode `:root` block, add `--image-filter: invert(100%) hue-rotate(180deg);`.
- Append: `.canvas svg image.topic-image { filter: var(--image-filter); }`.

**Tests:**
- `map.test.ts`:
  - A topic with `image: { key: 'img/abcdefghijklmnopqrstu/x.png', w: 200, h: 100 }` and text 'Cat' (map layout, depth 2, line kind) has `image` equal to `{ x: 5, y: 4, w: 200, h: 100 }`, `textTop` of `4 + 100 + 8`, `w ≥ 210`, and `h = textTop + 22 + 4`.
  - The same image with empty text has `lines` equal to `[]`, and `h` equal to `4 + 100 + 4`.
  - The existing decorated no-overlap property test still passes. Optionally add `image` to `decorate()` at a 10% rate.
- `renderMap.test.ts`: the topic group has one `image.topic-image` with `href` equal to `/img/abcdefghijklmnopqrstu/x.png`, x and y at the box offsets, and the text `y` below the image.
- `exportImage.test.ts`: `buildSvg` with a stub `fetchImpl` that serves fonts (as the existing tests do) and `/img/…` (bytes `[1,2,3]`, type `image/png`). The output contains `href="data:image/png;base64,AQID"`. When the image fetch returns 404, the output has no `<image`, but the export still resolves.

- [ ] **Steps:** write the tests, watch them fail, implement, then run `npx vitest run src/layout src/render src/io src/editor src/view && npm run typecheck`, and commit:

```bash
git commit -m "feat(render): draw topic images above the text with a sketchy frame; exports inline them" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: Adding, sizing and removing images in the editor

**Files:**
- Modify: `src/editor/store.ts`, `src/editor/DetailsPanel.tsx`, `src/editor/Canvas.tsx`, `src/editor/EditorPage.tsx`, `src/app.css`
- Test: `src/editor/store.test.ts`, `src/editor/Canvas.test.tsx`, `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Consumes `prepareImage`, `displaySize`, `IMAGE_SIZES`, `ImageError` (Task 2), `api.uploadImage` (Task 2), and `endEdit()` (EditorPage, existing).
- Produces:
  - `EditorAction { type: 'setImage'; id: string; image: { key: string; w: number; h: number } | null }`. One undo step; a no-op while editing or when nothing changes.
  - `{ type: 'setImageSize'; id: string; size: 'S' | 'M' | 'L' }`. The new `w = IMAGE_SIZES[size]` and `h = Math.round(w * h0 / w0)`, clamped to 16–2048. One undo step; a no-op when it is already that width.
  - `DetailsPanel` gains the props `onImageFile(file: File)`, `onImageSize(size)`, `onImageRemove()` and `uploading?: boolean`.
  - `Canvas` gains the prop `onDropFile?(topicId: string | null, file: File): void`.

**The details panel's Image row** goes after the links list and before the hint, as spec §4 orders it:
- No image: a button "Add image…".
- With an image:
  - a group `[aria-label="Image size"]` with buttons S, M and L (`aria-pressed`)
  - a button "Replace…"
  - a button "Remove"
- A hidden `input[type=file][accept="image/png,image/jpeg,image/webp,image/gif"][aria-label="Image file"]` behind Add and Replace. Reset its value after each choice.
- While uploading, the add/replace button reads "Uploading…" and is disabled.
- All buttons use `onMouseDown={noFocus}`.

**`EditorPage`:**

```tsx
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const attachImage = async (id: string, file: File) => {
    setImageBusy(true);
    setImageError(null);
    try {
      const prepared = await prepareImage(file);
      const { key } = await api.uploadImage(initial.id, prepared.blob);
      endEdit();
      dispatch({ type: 'setImage', id, image: { key, ...displaySize(prepared.width, prepared.height) } });
    } catch (e) {
      setImageError(`Image not added: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImageBusy(false);
    }
  };
```

- Show `imageError` as a dismissible `div.banner[role=alert]`, like the Markdown notice.
- `onImageFile` calls `attachImage(selectedNode.id, file)`.
- `onImageSize` and `onImageRemove` call `endEdit()`, then dispatch.
- **Paste:** in the window paste handler, before the outline parsing, take the first `File` in `e.clipboardData.files` whose type starts with `image/`. If there is one, `preventDefault`, then `attachImage(stateRef.current.selectedId, file)` and return. The existing guards (editing, modal, text fields) still apply.
- **Drop:** `Canvas` handles `onDragOver`: if `dataTransfer.types` includes `'Files'`, `preventDefault`. `onDrop` does `preventDefault`, takes the first image file and the topic under the drop point, `(e.target as Element).closest('g.topic')?.getAttribute('data-id') ?? null`, and calls `onDropFile`. EditorPage then calls `attachImage(id ?? selectedId, file)`. Only the editor (`interactive`) accepts drops.

**Tests:**
- `store.test.ts`: `setImage` sets the image, `null` removes it, and undo restores it. `setImageSize('S')` on a 200×100 image gives 120×60. Both are no-ops while editing, and no-ops for the same value.
- `Canvas.test.tsx`:
  - Dropping a file on a topic calls `onDropFile` with that topic's id.
  - Dropping on the background calls it with `null`.
  - Dragover with Files is `preventDefault`ed.
  - Use `new Event('drop')` with a `dataTransfer` defined through `Object.defineProperty`, with `files` and `types`.
- `EditorPage.test.tsx`: stub `prepareImage` with `vi.mock('../io/imagePrep', …)`, keeping the real `displaySize`/`IMAGE_SIZES`, because jsdom can't decode images. `fakeApi.uploadImage` returns `{ key: 'img/abcdefghijklmnopqrstu/k.png' }`.
  - Choosing a file in the Image row draws `g.topic image.topic-image`.
  - S, M and L change its `width`.
  - Remove takes it away, and undo brings it back.
  - A rejected `prepareImage` (ImageError 'SVG images aren’t supported …') shows the banner and adds nothing.
  - Pasting a clipboard with an image file attaches it to the selected topic.

- [ ] **Steps:** tests first, then implement. Run `npx vitest run src/editor && npm test && npm run typecheck`, then commit:

```bash
git commit -m "feat(editor): add, size, replace and remove topic images (panel, paste, drop)" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: Images in Markdown out and in `.xmind` import

**Files:**
- Modify: `src/io/markdown.ts`, `src/io/markdown.test.ts`, `src/io/xmind.ts`, `src/io/xmind.test.ts`, `src/list/ListPage.tsx`, `src/list/ListPage.test.tsx`, `src/editor/EditorPage.tsx`

**Markdown:**
- `toMarkdown(root, opts: { imageBase?: string } = {})` appends ` ![](${imageBase}/${key})` to a topic's line when the topic has an image and `imageBase` is set.
- `markdownLosses` adds `'images'` (ordered after `notes`) when any topic has an image.
- `EditorPage`'s Copy as Markdown passes `{ imageBase: location.origin }`.
- The Outline panel keeps calling `toMarkdown(root)` without images.
- Test: `toMarkdown(n('R', [{ ...n('Cat'), image: { key: 'img/abcdefghijklmnopqrstu/c.png', w: 200, h: 100 } }]), { imageBase: 'https://s.example' })` equals `'# R\n- Cat ![](https://s.example/img/abcdefghijklmnopqrstu/c.png)\n'`. Without `imageBase` it equals `'# R\n- Cat\n'`.

**`.xmind`:**
- `XmindImport` gains `images: Array<{ nodeId: string; resource: string; width?: number; height?: number }>`.
- For each topic whose `image.src` (JSON) is a string starting with `xap:resources/`, record the node's new id, the resource path (`resources/<name>`) and any numeric `width`/`height`.
- `.svg` resources count in `dropped` as "N SVG images (not supported)", replacing the old "images (they arrive in step 4)" phrase.
- Beyond 100 images, the rest count as "N images not imported (over 100)".
- `importXmind` keeps returning the tree. The resources are read later, by the list page.
- Export a helper: `readXmindResources(bytes: Uint8Array, names: string[]): Promise<Map<string, Uint8Array>>`, which calls `readZip`.
- `ListPage.importFile`, after `createMap` and before `saveMap`, handles each recorded image:
  - read its bytes
  - `prepareImage(new Blob([bytes]))`
  - `api.uploadImage(map.id, blob)`
  - set `node.image = { key, ...displaySize(width ?? natural width, height ?? natural height) }` on the node with that id in `result.root`; find it with `findNode` from `src/model/tree.ts`
  - count failures, and add "N images could not be added" to the summary's `dropped`
- XML (XMind 8) images: count them as "N images (XMind 8 images aren’t imported)"; there is no resource mapping for them.
- Tests:
  - `xmind.test.ts`: a fixture with two topics with `xap:resources/a.png` and `xap:resources/b.svg` → `images` has one entry (`resources/a.png`), and `dropped` contains `'1 SVG image (not supported)'`.
  - `ListPage.test.tsx`: mock `prepareImage` as in Task 4. Import a stored zip with `content.json` plus `resources/a.png`. Expect one upload POST to `/api/maps/<id>/images`, and the saved map's topic to have `image.key` equal to the stubbed key.

- [ ] **Steps:** tests first, then implement. Run `npm test && npm run typecheck`, then commit:

```bash
git commit -m "feat(io): images in Markdown out and in .xmind import" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: End-to-end, README

**Files:**
- Create: `e2e/fixtures/pixel.ts`
- Modify: `e2e/smoke.spec.ts`, `README.md`

**`e2e/fixtures/pixel.ts`** exports `PNG_2x2`: a valid 2×2 PNG as a `Buffer`, from a base64 constant. Generate it once (for example with Node's zlib in a scratch script) and paste the base64. It must decode in Chromium.

**The e2e test:** "an image added from the details panel survives a reload, shows in the view and is inlined in the SVG export; deleting the map deletes it".
1. `openNewMap`.
2. In the details panel, `page.locator('input[aria-label="Image file"]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG_2x2 })`.
3. Expect `g.topic image.topic-image` whose `href` matches `^/img/[A-Za-z0-9_-]{21}/[A-Za-z0-9_-]{10}\.(png|jpg)$`. The image has transparency, so expect png.
4. Wait for "Saved", then reload. The image is still there.
5. Fetch `page.request.get(href)` and expect 200 with `image/png`.
6. In `/m/<id>`, the image is visible.
7. Back in the editor, click "SVG", wait for the download, read it, and expect `data:image/png;base64,` inside.
8. Delete the map through the list page: "Delete…" then "Delete".
9. `page.request.get(href)` now returns 404.

Also add an image step to `e2e/prod.spec.ts`'s CSP test: upload `PNG_2x2` and expect no CSP violation. `img-src 'self' data: blob:` covers `/img/`.

**`README.md`:** describe images:
- Add, replace and remove from the details panel; paste an image, or drop it on a topic.
- Sizes S, M and L.
- Images are shrunk to 2048 px and stored in R2.
- SVG is not accepted.
- In dark mode photos are counter-inverted.
- Copy as Markdown links images.
- `.xmind` images come along, except SVG ones.

Under "Not yet checked", add "pasting images from the clipboard in Safari".

- [ ] **Steps:** run `npx playwright test`; all must pass, with 11 e2e tests. Then commit:

```bash
git commit -m "test(e2e): images upload, persist, show in the view, export inline and are deleted with the map; README" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage:**

| Spec item | Task |
|---|---|
| §3 images (key, re-encode, sizes, SVG refused, 5 MB) | 1, 2, 4 |
| §4 paste, drop and the panel row | 4 |
| §6 frame, above the text, dark-mode counter-filter | 3 |
| §8 endpoints and clean-up | 1 |
| §9 Markdown | 5 |
| §9 `.xmind` images | 5 |
| §10 errors | 2, 4 |
| §10 e2e "Attach an image" | 6 |

**Out of scope:** `.excalidraw` export and dark-mode polish beyond images are in plans 4b and 4c.

**Rulings to tell the user:**
- The Outline panel leaves images out.
- `.xmind` SVG resources are not imported.
- Uploading while typing a topic first commits the typing (`endEdit`).
