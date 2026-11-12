# Sketchmap Step 1 ("Usable in Notion") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working app on Cloudflare where you build a hand-drawn mindmap in an editor tab, embed its view link in a Notion page, and see your edits there after reloading Notion.

**Architecture:**
- **Client:** a Vite + React single-page app with three routes:
  - `/` — map list
  - `/e/:id` — editor
  - `/m/:id` — read-only view for Notion
- **Server:** one Cloudflare Worker serves the built files and a small JSON API, and stores maps in R2.
- **Where the logic lives:** pure modules for model, layout and text, tested with Vitest. A rough.js SVG renderer is shared by the editor and the view.

**Tech Stack:**

| Area | Packages |
|---|---|
| Client | React 19.3.1, Vite 8.3.8, `@vitejs/plugin-react` 6.3.0 |
| Cloudflare | `@cloudflare/vite-plugin` 1.69.0, wrangler 4.160.1, Cloudflare R2 |
| Language | TypeScript 5.9.3 |
| Libraries | immer 11.2.10, roughjs 4.6.6, nanoid 6.0.2, zod 4.6.7 |
| Tests | vitest 4.1.12, `@cloudflare/vitest-plugin` 1.8.0, jsdom 31.0.0, `@playwright/test` 1.65.0 |
| Fonts only | `@excalidraw/excalidraw` 0.18.1 (dev dependency) |

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md`. Read §2–§8, §10 and §11 before starting.

## Facts verified while writing this plan (2026-11-12)

- **Test package rename:** `@cloudflare/vitest-pool-workers` is deprecated. Its README says it was renamed to `@cloudflare/vitest-plugin`; the API is unchanged and it needs Vitest ≥ 4.1. Use the new name; the spec's mention of the old one is superseded.
- **R2 behaviour,** checked by running it in Miniflare:
  - `put(key, value, { onlyIf: { etagMatches } })` returns `null` when the etag is stale.
  - `list({ include: ['customMetadata'] })` returns each object's custom metadata. So spec §8's `index.json` fallback is **not needed**.
  - **`put` replaces the object's custom metadata.** Every save must resend `title`, `updatedAt` and `version`.
- **R2 consistency:** R2 is strongly consistent, while KV can take 60 s or more to show a change (Cloudflare docs).
- **Vite plugin and assets:** with the Cloudflare Vite plugin, `assets.directory` must not be set, because the plugin fills it in. `assets.not_found_handling: "single-page-application"` serves `index.html` for navigation requests that match no file.

## Global Constraints

Values copied from the spec unless a source is given.

- **IDs:** maps use `nanoid(21)`, topics use `nanoid(10)`.
- **Size limit:** a map's JSON is capped at **2 MB** (2 000 000 bytes) → HTTP 413.
- **Undo:** up to **200** steps.
- **Autosave:** sent **1 s** after the last change. After a failure, retry backoff runs 2, 4, 8 … up to **60 s**.
- **Fonts:** layout waits at most **2.5 s** for fonts, then falls back to system fonts.
- **Layout `map`:**
  - root in the centre
  - first-level branches fill the right side until about half the total height is used; the rest go left in reverse order (clockwise)
  - horizontal gaps: **70 px** from the root, **36 px** deeper
  - vertical gaps: **26 px** between first-level branches, **10 px** deeper
- **Topic styles:**

  | Depth | Kind | Font size |
  |---|---|---|
  | 0 | `root` | 28 px |
  | 1 | `box` | 20 px |
  | 2+ | `line` (underlined) | 17 px |

- **Branch colours:** the stroke/fill pairs below, in this order. The root uses stroke `#1e1e1e` and fill `#ffec99`.

  | # | Stroke | Fill |
  |---|---|---|
  | 1 | `#e03131` | `#ffc9c9` |
  | 2 | `#1971c2` | `#a5d8ff` |
  | 3 | `#2f9e44` | `#b2f2bb` |
  | 4 | `#f08c00` | `#ffec99` |
  | 5 | `#9c36b5` | `#eebefa` |
  | 6 | `#0c8599` | `#99e9f2` |

- **Dark mode:** the drawing gets `filter: invert(93%) hue-rotate(180deg)`.
- **Fonts:** `"Excalifont", "Xiaolai"`, then system fonts, self-hosted from `/fonts/`. Ship `public/fonts/OFL.txt`.
- **Auth:** writes and listing need `Authorization: Bearer <OWNER_KEY>`, compared in constant time. A wrong or missing key → 401 `{"error":"Unauthorized"}`.
- **Response headers:**

  | Responses | Headers |
  |---|---|
  | Every API response | `Cache-Control: no-store` *(our addition, so the Notion embed never sees a cached map)* |
  | HTML for `/` and `/e/*` | `Content-Security-Policy: frame-ancestors 'none'` |
  | `/m/*` | no framing headers at all |
  | All responses | `X-Content-Type-Options: nosniff` |

- **Saving:** `PUT` needs `If-Match` (otherwise 428); a stale etag → 409. The server sets `version = old + 1`, `updatedAt = now` and `title = plainTitle(root)`.
- **Not in step 1:**
  - images
  - links and rich text, markers, notes, importance and priority styles
  - `logic` and `org` layouts
  - Markdown and `.xmind` import/export, `.excalidraw` export

  The data model already allows these fields. Step 1 code must keep them intact (validate and pass them through) but does not draw or edit them.

## File Structure

```
package.json, tsconfig.app.json, tsconfig.worker.json, vite.config.ts, vitest.config.ts,
vitest.worker.config.ts, wrangler.jsonc, index.html, .dev.vars (local secret, gitignored), playwright.config.ts
scripts/gen-font-faces.mjs      one-off: reads Excalidraw's font index files → src/render/fontFaces.generated.ts
scripts/copy-fonts.mjs          copies woff2 files from node_modules into public/fonts/ (run before dev/build)
src/shared/types.ts             MindMap, MapNode, MapSummary, LIMITS
src/shared/schema.ts            zod validation: parseMindMap()
src/shared/title.ts             plainTitle()
src/model/ids.ts                newMapId(), newNodeId()
src/model/tree.ts               pure tree edits (used inside immer drafts)
src/editor/store.ts             editor reducer: selection, editing, undo/redo
src/layout/styles.ts            styleFor(depth), PALETTE, ROOT_COLOR
src/layout/wrap.ts              wrapText()
src/layout/map.ts               computeLayout() for the balanced map
src/render/fontFaces.generated.ts  (generated) list of {family, file, unicodeRange}
src/render/fonts.ts             installFontFaces(), ensureFonts(), canvasMeasure()
src/render/renderMap.ts         rough.js → SVG
src/api/client.ts               typed API calls, ApiError
src/auth/ownerKey.ts            owner key in localStorage
src/auth/KeyPrompt.tsx          asks for the key once
src/editor/autosave.ts          Autosaver: debounce, retry, conflict, local draft
src/editor/keymap.ts            keyboard → command (pure)
src/editor/navigate.ts          spatial arrow-key navigation (pure)
src/editor/viewport.ts          fit / zoom math (pure)
src/editor/Canvas.tsx           SVG canvas: pan/zoom, select, drag-to-move
src/editor/InlineEditor.tsx     textarea over a topic
src/editor/EditorPage.tsx       wires everything for /e/:id
src/view/ViewPage.tsx           /m/:id
src/list/ListPage.tsx           /
src/io/exportImage.ts           SVG and PNG export
src/main.tsx, src/router.ts, src/app.css
worker/index.ts                 fetch entry: routes
worker/http.ts                  json(), error helpers
worker/auth.ts                  isOwner()
worker/maps.ts                  R2 map CRUD handlers
worker/assets.ts                serves the SPA with security headers
worker/test/*.spec.ts           Worker tests (Miniflare R2)
e2e/smoke.spec.ts, e2e/embed.html
README.md                       deploy + Notion check
```

---

### Task 1: Scaffold the toolchain

**Files:**
- Create: `package.json`, `tsconfig.app.json`, `tsconfig.worker.json`, `vite.config.ts`, `vitest.config.ts`, `vitest.worker.config.ts`, `wrangler.jsonc`, `index.html`, `.dev.vars`, `src/main.tsx`, `worker/index.ts`, `worker/test/smoke.spec.ts`

**Interfaces:**
- Produces:
  - `worker/index.ts` exports `interface Env { MAPS: R2Bucket; OWNER_KEY: string; ASSETS: Fetcher }`
  - `worker/index.ts` default-exports a `fetch` handler
  - npm scripts `dev`, `build`, `typecheck`, `test`, `test:worker`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sketchmap",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "npm run build && vite preview",
    "deploy": "npm run build && wrangler deploy",
    "typecheck": "tsc -p tsconfig.app.json && tsc -p tsconfig.worker.json",
    "test": "vitest run",
    "test:worker": "vitest run --config vitest.worker.config.ts"
  }
}
```

- [ ] **Step 2: Install pinned dependencies**

```bash
npm i react@19.3.1 react-dom@19.3.1 roughjs@4.6.6 immer@11.2.10 nanoid@6.0.2 zod@4.6.7
npm i -D vite@8.3.8 @vitejs/plugin-react@6.3.0 @cloudflare/vite-plugin@1.69.0 wrangler@4.160.1 \
  typescript@5.9.3 vitest@4.1.12 @cloudflare/vitest-plugin@1.8.0 @cloudflare/workers-types@5.20261112.1 \
  jsdom@31.0.0 @types/react@19 @types/react-dom@19
```

Expected: both commands finish without `ERESOLVE` errors. If npm reports a peer-dependency conflict, stop and report it. Do not use `--force` or `--legacy-peer-deps`.

- [ ] **Step 3: Create the TypeScript configs**

`tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`tsconfig.worker.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"]
  },
  "include": ["worker", "src/shared", "src/model/ids.ts"]
}
```

- [ ] **Step 4: Create the Vite, Vitest and Wrangler configs**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), cloudflare()],
});
```

`vitest.config.ts` (unit tests for `src/`):

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: true,
  },
});
```

`vitest.worker.config.ts` (Worker tests inside the Workers runtime, with an in-memory R2):

```ts
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-11-01',
        r2Buckets: ['MAPS'],
        bindings: { OWNER_KEY: 'test-owner-key' },
      },
    }),
  ],
  test: { include: ['worker/test/**/*.spec.ts'] },
});
```

`wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "sketchmap",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-11-01",
  "assets": {
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  },
  "r2_buckets": [{ "binding": "MAPS", "bucket_name": "sketchmap-maps" }]
}
```

`.dev.vars` (local-only secret; `.gitignore` already lists it):

```
OWNER_KEY=dev-owner-key
```

- [ ] **Step 5: Create the minimal app and Worker**

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sketchmap</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx` (replaced in Task 16):

```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<p>Sketchmap</p>);
```

`worker/index.ts` (extended in Tasks 6–7):

```ts
export interface Env {
  MAPS: R2Bucket;
  OWNER_KEY: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6: Write the Worker smoke test**

`worker/test/smoke.spec.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';

describe('worker smoke', () => {
  it('answers unknown API paths with JSON 404', async () => {
    const res = await worker.fetch(new Request('http://x/api/nope'), env as unknown as Env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });
});
```

- [ ] **Step 7: Run everything once**

```bash
npm run test:worker
npm test
npm run typecheck
npm run build
```

Expected:
- `test:worker` reports `1 passed`.
- `npm test` exits 0 with "No test files found".
- `typecheck` prints no errors.
- `build` writes `dist/client/index.html` and a `dist/sketchmap/wrangler.json`. If the folder name differs, note the actual path in the commit message.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.app.json tsconfig.worker.json vite.config.ts vitest.config.ts \
  vitest.worker.config.ts wrangler.jsonc index.html src/main.tsx worker/
git commit -m "chore: scaffold Vite + React + Cloudflare Worker toolchain"
```

`.dev.vars` is gitignored on purpose; do not commit it.

---

### Task 2: Shared types, validation and title

**Files:**
- Create: `src/shared/types.ts`, `src/shared/schema.ts`, `src/shared/title.ts`
- Test: `src/shared/schema.test.ts`, `src/shared/title.test.ts`

**Interfaces:**
- Produces:
  - types `MindMap`, `MapNode`, `MapSummary`, `LayoutKind`, `Emphasis`
  - `LIMITS = { mapJsonBytes: 2_000_000 }`
  - `parseMindMap(value: unknown): MindMap`, which throws `MapValidationError` (with `.message`)
  - `plainTitle(root: MapNode): string`

- [ ] **Step 1: Write the failing tests**

`src/shared/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseMindMap, MapValidationError } from './schema';

const valid = {
  id: 'abcdefghijklmnopqrstu',
  title: 'Plan',
  layout: 'map',
  version: 3,
  updatedAt: '2026-11-12T10:00:00.000Z',
  root: {
    id: 'root000001',
    text: 'Plan',
    children: [
      {
        id: 'child00001',
        text: 'A',
        children: [],
        collapsed: true,
        note: 'n',
        emoji: '💡',
        emphasis: 'key',
        priority: 2,
        image: { key: 'img/abcdefghijklmnopqrstu/x1.png', w: 200, h: 120 },
        color: '#e03131',
      },
    ],
  },
};

describe('parseMindMap', () => {
  it('accepts a valid map and keeps every optional field', () => {
    expect(parseMindMap(structuredClone(valid))).toEqual(valid);
  });

  it('rejects unknown fields on a topic', () => {
    const bad = structuredClone(valid) as any;
    bad.root.children[0].script = 'x';
    expect(() => parseMindMap(bad)).toThrow(MapValidationError);
  });

  it('rejects a map id that is not 21 url-safe characters', () => {
    expect(() => parseMindMap({ ...structuredClone(valid), id: 'short' })).toThrow(MapValidationError);
  });

  it('rejects a priority outside 1..3', () => {
    const bad = structuredClone(valid) as any;
    bad.root.children[0].priority = 4;
    expect(() => parseMindMap(bad)).toThrow(MapValidationError);
  });

  it('rejects an unknown layout', () => {
    expect(() => parseMindMap({ ...structuredClone(valid), layout: 'radial' })).toThrow(MapValidationError);
  });
});
```

`src/shared/title.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { plainTitle } from './title';

const node = (text: string) => ({ id: 'r', text, children: [] });

describe('plainTitle', () => {
  it('uses the first line of the root text, trimmed', () => {
    expect(plainTitle(node('  Weekly plan \nsecond line'))).toBe('Weekly plan');
  });
  it('falls back to "Untitled map" for empty text', () => {
    expect(plainTitle(node('   '))).toBe('Untitled map');
  });
  it('caps the title at 120 characters', () => {
    expect(plainTitle(node('x'.repeat(300)))).toHaveLength(120);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/shared`
Expected: FAIL, "Cannot find module './schema'" and "./title".

- [ ] **Step 3: Implement**

`src/shared/types.ts`:

```ts
export type LayoutKind = 'map' | 'logic' | 'org';
export type Emphasis = 'key' | 'highlight' | 'aside';

export interface MapNode {
  id: string;
  text: string;
  children: MapNode[];
  collapsed?: boolean;
  note?: string;
  emoji?: string;
  emphasis?: Emphasis;
  priority?: 1 | 2 | 3;
  image?: { key: string; w: number; h: number };
  color?: string;
}

export interface MindMap {
  id: string;
  title: string;
  layout: LayoutKind;
  version: number;
  updatedAt: string;
  root: MapNode;
}

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export const LIMITS = { mapJsonBytes: 2_000_000 } as const;
```

`src/shared/schema.ts`:

```ts
import { z } from 'zod';
import type { MapNode, MindMap } from './types';

export class MapValidationError extends Error {}

const nodeId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const mapNodeSchema: z.ZodType<MapNode> = z.lazy(() =>
  z.strictObject({
    id: nodeId,
    text: z.string().max(5000),
    children: z.array(mapNodeSchema),
    collapsed: z.boolean().optional(),
    note: z.string().max(50_000).optional(),
    emoji: z.string().max(16).optional(),
    emphasis: z.enum(['key', 'highlight', 'aside']).optional(),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    image: z
      .strictObject({
        key: z.string().regex(/^img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/),
        w: z.number().int().min(16).max(2048),
        h: z.number().int().min(16).max(2048),
      })
      .optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
);

const mindMapSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
  title: z.string().max(5000),
  layout: z.enum(['map', 'logic', 'org']),
  version: z.number().int().min(0),
  updatedAt: z.string().min(1),
  root: mapNodeSchema,
});

export function parseMindMap(value: unknown): MindMap {
  const result = mindMapSchema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new MapValidationError(`${first.path.join('.') || 'map'}: ${first.message}`);
  }
  return result.data;
}
```

`src/shared/title.ts`:

```ts
import type { MapNode } from './types';

/** Title for listings: first line of the root text. Step 3 will strip link syntax here. */
export function plainTitle(root: MapNode): string {
  const first = root.text.split('\n')[0].trim();
  return (first || 'Untitled map').slice(0, 120);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/shared && npm run typecheck`
Expected: 8 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared
git commit -m "feat(shared): map types, zod validation and title helper"
```

---

### Task 3: IDs and pure tree edits

**Files:**
- Create: `src/model/ids.ts`, `src/model/tree.ts`
- Test: `src/model/tree.test.ts`

**Interfaces:**
- Consumes: `MapNode`, `MindMap` from `src/shared/types.ts`
- Produces:
  - from `ids.ts`: `newMapId(): string` (21 chars) and `newNodeId(): string` (10 chars)
  - from `tree.ts`, every function mutating in place, so it can run inside an immer draft:
    - `findNode(root, id): Found | null`, where `Found = { node, parent, index, depth }`
    - `newNode(text?)` and `createMap(title?, now?)`
    - `addChild(root, parentId, child): boolean`
    - `addSiblingAfter(root, id, sibling): boolean`
    - `removeNode(root, id): string | null` — returns the id to select next
    - `moveNode(root, id, targetId): boolean`
    - `setText(root, id, text): boolean`
    - `toggleCollapsed(root, id): boolean`
    - `isInBranch(branchRoot, id): boolean`
    - `countDescendants(node): number`
    - `visibleChildren(node): MapNode[]`
    - `allText(root): string`

- [ ] **Step 1: Write the failing tests**

`src/model/tree.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import {
  addChild, addSiblingAfter, allText, countDescendants, createMap, findNode, isInBranch,
  moveNode, newNode, removeNode, setText, toggleCollapsed, visibleChildren,
} from './tree';

const n = (id: string, text: string, children: MapNode[] = []): MapNode => ({ id, text, children });
const sample = () => n('r', 'Root', [n('a', 'A', [n('a1', 'A1'), n('a2', 'A2')]), n('b', 'B')]);

describe('tree', () => {
  it('createMap makes a 21-char map id, a 10-char root id and version 0', () => {
    const m = createMap('Plan', '2026-11-12T00:00:00.000Z');
    expect(m.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(m.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(m).toMatchObject({ title: 'Plan', layout: 'map', version: 0, root: { text: 'Plan', children: [] } });
  });

  it('findNode reports parent, index and depth', () => {
    const f = findNode(sample(), 'a2')!;
    expect([f.parent!.id, f.index, f.depth]).toEqual(['a', 1, 2]);
    expect(findNode(sample(), 'nope')).toBeNull();
  });

  it('addChild appends and unfolds the parent', () => {
    const t = sample();
    toggleCollapsed(t, 'a');
    addChild(t, 'a', newNode('A3'));
    expect(t.children[0].collapsed).toBeUndefined();
    expect(t.children[0].children.map((c) => c.text)).toEqual(['A1', 'A2', 'A3']);
  });

  it('addSiblingAfter inserts right after; on the root it adds a child', () => {
    const t = sample();
    addSiblingAfter(t, 'a1', n('x', 'X'));
    expect(t.children[0].children.map((c) => c.id)).toEqual(['a1', 'x', 'a2']);
    addSiblingAfter(t, 'r', n('y', 'Y'));
    expect(t.children.map((c) => c.id)).toEqual(['a', 'b', 'y']);
  });

  it('removeNode picks next sibling, else previous, else parent; never removes the root', () => {
    const t = sample();
    expect(removeNode(t, 'a1')).toBe('a2');
    expect(removeNode(t, 'a2')).toBe('a');
    expect(removeNode(t, 'b')).toBe('a');
    expect(removeNode(t, 'r')).toBeNull();
  });

  it('moveNode moves a branch under a target and refuses moves into itself', () => {
    const t = sample();
    expect(moveNode(t, 'a', 'a1')).toBe(false);
    expect(moveNode(t, 'a', 'a')).toBe(false);
    expect(moveNode(t, 'r', 'b')).toBe(false);
    expect(moveNode(t, 'a', 'b')).toBe(true);
    expect(t.children.map((c) => c.id)).toEqual(['b']);
    expect(t.children[0].children[0].id).toBe('a');
  });

  it('toggleCollapsed only folds non-root topics that have children', () => {
    const t = sample();
    expect(toggleCollapsed(t, 'r')).toBe(false);
    expect(toggleCollapsed(t, 'b')).toBe(false);
    expect(toggleCollapsed(t, 'a')).toBe(true);
    expect(visibleChildren(t.children[0])).toEqual([]);
    expect(toggleCollapsed(t, 'a')).toBe(true);
    expect(t.children[0].collapsed).toBeUndefined();
  });

  it('setText, countDescendants, isInBranch, allText', () => {
    const t = sample();
    expect(setText(t, 'b', 'Bee')).toBe(true);
    expect(countDescendants(t)).toBe(4);
    expect(isInBranch(t.children[0], 'a2')).toBe(true);
    expect(isInBranch(t.children[0], 'b')).toBe(false);
    expect(allText(t)).toBe('Root\nA\nA1\nA2\nBee');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/model`
Expected: FAIL, "Cannot find module './tree'".

- [ ] **Step 3: Implement**

`src/model/ids.ts`:

```ts
import { nanoid } from 'nanoid';

export const newMapId = (): string => nanoid(21);
export const newNodeId = (): string => nanoid(10);
```

`src/model/tree.ts`:

```ts
import type { MapNode, MindMap } from '../shared/types';
import { newMapId, newNodeId } from './ids';

export interface Found {
  node: MapNode;
  parent: MapNode | null;
  index: number;
  depth: number;
}

export function findNode(root: MapNode, id: string): Found | null {
  const stack: Found[] = [{ node: root, parent: null, index: 0, depth: 0 }];
  while (stack.length) {
    const f = stack.pop()!;
    if (f.node.id === id) return f;
    f.node.children.forEach((c, i) => stack.push({ node: c, parent: f.node, index: i, depth: f.depth + 1 }));
  }
  return null;
}

export function newNode(text = ''): MapNode {
  return { id: newNodeId(), text, children: [] };
}

export function createMap(title = 'Central topic', now = new Date().toISOString()): MindMap {
  return { id: newMapId(), title, layout: 'map', version: 0, updatedAt: now, root: { id: newNodeId(), text: title, children: [] } };
}

export function addChild(root: MapNode, parentId: string, child: MapNode): boolean {
  const f = findNode(root, parentId);
  if (!f) return false;
  delete f.node.collapsed;
  f.node.children.push(child);
  return true;
}

export function addSiblingAfter(root: MapNode, id: string, sibling: MapNode): boolean {
  const f = findNode(root, id);
  if (!f) return false;
  if (!f.parent) return addChild(root, id, sibling);
  f.parent.children.splice(f.index + 1, 0, sibling);
  return true;
}

/** Removes a topic and its branch. Returns the id to select next, or null when nothing was removed. */
export function removeNode(root: MapNode, id: string): string | null {
  const f = findNode(root, id);
  if (!f || !f.parent) return null;
  const siblings = f.parent.children;
  siblings.splice(f.index, 1);
  return (siblings[f.index] ?? siblings[f.index - 1] ?? f.parent).id;
}

export function isInBranch(branchRoot: MapNode, id: string): boolean {
  return findNode(branchRoot, id) !== null;
}

/** Makes `id` (with its branch) the last child of `targetId`. Refuses the root and moves into its own branch. */
export function moveNode(root: MapNode, id: string, targetId: string): boolean {
  if (id === targetId) return false;
  const f = findNode(root, id);
  if (!f || !f.parent || isInBranch(f.node, targetId)) return false;
  const target = findNode(root, targetId);
  if (!target) return false;
  f.parent.children.splice(f.index, 1);
  delete target.node.collapsed;
  target.node.children.push(f.node);
  return true;
}

export function setText(root: MapNode, id: string, text: string): boolean {
  const f = findNode(root, id);
  if (!f) return false;
  f.node.text = text;
  return true;
}

export function toggleCollapsed(root: MapNode, id: string): boolean {
  const f = findNode(root, id);
  if (!f || !f.parent || f.node.children.length === 0) return false;
  if (f.node.collapsed) delete f.node.collapsed;
  else f.node.collapsed = true;
  return true;
}

export function countDescendants(node: MapNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

export function visibleChildren(node: MapNode): MapNode[] {
  return node.collapsed ? [] : node.children;
}

/** Every topic's text, one per line: used to decide which font subsets to load. */
export function allText(root: MapNode): string {
  const out: string[] = [];
  const walk = (n: MapNode) => {
    out.push(n.text);
    n.children.forEach(walk);
  };
  walk(root);
  return out.join('\n');
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/model && npm run typecheck`
Expected: 8 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/model
git commit -m "feat(model): ids and pure tree edits"
```

---

### Task 4: Editor state with undo/redo

**Files:**
- Create: `src/editor/store.ts`
- Test: `src/editor/store.test.ts`

**Interfaces:**
- Consumes: `src/model/tree.ts` (Task 3) and `MindMap`
- Produces:
  - `HISTORY_LIMIT = 200`
  - `interface EditorState { map; selectedId; editing: { id; isNew } | null; past; future; revision }`
  - type `EditorAction`
  - `initEditor(map)` and `editorReducer(state, action)`
  - `revision` increases on every change the user makes to the map; autosave (Task 11) watches it.

- [ ] **Step 1: Write the failing tests**

`src/editor/store.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MindMap } from '../shared/types';
import { editorReducer as reduce, HISTORY_LIMIT, initEditor, type EditorState } from './store';

const base = (): MindMap => ({
  id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't',
  root: { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
});
const texts = (s: EditorState) => s.map.root.children.map((c) => c.text);

describe('editorReducer', () => {
  it('addChild creates an empty topic, selects it and opens it for editing', () => {
    let s = reduce(initEditor(base()), { type: 'select', id: 'a' });
    s = reduce(s, { type: 'addChild' });
    const created = s.map.root.children[0].children[1];
    expect(created.text).toBe('');
    expect(s.selectedId).toBe(created.id);
    expect(s.editing).toEqual({ id: created.id, isNew: true });
    expect(s.revision).toBe(1);
  });

  it('committing a new topic keeps one undo step; undo removes the topic entirely', () => {
    let s = reduce(initEditor(base()), { type: 'addSibling' }); // on root → child
    s = reduce(s, { type: 'commitEdit', text: 'B  ' });
    expect(texts(s)).toEqual(['A', 'B']);
    expect(s.past).toHaveLength(1);
    s = reduce(s, { type: 'undo' });
    expect(texts(s)).toEqual(['A']);
    s = reduce(s, { type: 'redo' });
    expect(texts(s)).toEqual(['A', 'B']);
  });

  it('an empty new topic disappears on commit or cancel and selection returns to the parent', () => {
    let s = reduce(reduce(initEditor(base()), { type: 'select', id: 'a' }), { type: 'addChild' });
    s = reduce(s, { type: 'commitEdit', text: '   ' });
    expect(s.map.root.children[0].children).toHaveLength(1);
    expect([s.selectedId, s.editing, s.past.length]).toEqual(['a', null, 0]);
    s = reduce(reduce(s, { type: 'addChild' }), { type: 'cancelEdit' });
    expect(s.map.root.children[0].children).toHaveLength(1);
  });

  it('editing an existing topic creates its own undo step; unchanged text creates none', () => {
    let s = reduce(initEditor(base()), { type: 'startEdit', id: 'a' });
    s = reduce(s, { type: 'commitEdit', text: 'A' });
    expect(s.past).toHaveLength(0);
    s = reduce(reduce(s, { type: 'startEdit', id: 'a' }), { type: 'commitEdit', text: 'Alpha' });
    expect([texts(s), s.past.length]).toEqual([['Alpha'], 1]);
  });

  it('delete selects the neighbour and ignores the root', () => {
    let s = reduce(initEditor(base()), { type: 'delete' });
    expect(s.map.root.children).toHaveLength(1);
    s = reduce(reduce(s, { type: 'select', id: 'a1' }), { type: 'delete' });
    expect(s.selectedId).toBe('a');
  });

  it('move and toggleFold are undoable; invalid ones change nothing', () => {
    let s = initEditor(base());
    expect(reduce(s, { type: 'move', id: 'a', targetId: 'a1' })).toBe(s);
    s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(s.map.root.children[0].collapsed).toBe(true);
    s = reduce(s, { type: 'undo' });
    expect(s.map.root.children[0].collapsed).toBeUndefined();
  });

  it('keeps at most HISTORY_LIMIT undo steps', () => {
    let s = initEditor(base());
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) s = reduce(s, { type: 'toggleFold', id: 'a' });
    expect(s.past).toHaveLength(HISTORY_LIMIT);
  });

  it('serverSaved updates version fields only; replaceMap resets history', () => {
    let s = reduce(initEditor(base()), { type: 'toggleFold', id: 'a' });
    s = reduce(s, { type: 'serverSaved', map: { ...base(), version: 7, updatedAt: 'later', title: 'T' } });
    expect([s.map.version, s.map.updatedAt, s.map.title, s.past.length]).toEqual([7, 'later', 'T', 1]);
    expect(s.map.root.children[0].collapsed).toBe(true);
    const before = s.revision;
    s = reduce(s, { type: 'replaceMap', map: base(), dirty: false });
    expect([s.past.length, s.revision]).toEqual([0, before]);
    expect(reduce(s, { type: 'replaceMap', map: base(), dirty: true }).revision).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/store.test.ts`
Expected: FAIL, "Cannot find module './store'".

- [ ] **Step 3: Implement**

`src/editor/store.ts`:

```ts
import { produce } from 'immer';
import type { MindMap } from '../shared/types';
import * as T from '../model/tree';

export const HISTORY_LIMIT = 200;

export interface EditorState {
  map: MindMap;
  selectedId: string;
  editing: { id: string; isNew: boolean } | null;
  past: MindMap[];
  future: MindMap[];
  /** Goes up on every user change to `map`; autosave watches it. */
  revision: number;
}

export type EditorAction =
  | { type: 'select'; id: string }
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'toggleFold'; id?: string }
  | { type: 'startEdit'; id?: string }
  | { type: 'commitEdit'; text: string }
  | { type: 'cancelEdit' }
  | { type: 'move'; id: string; targetId: string }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'serverSaved'; map: MindMap }
  | { type: 'replaceMap'; map: MindMap; dirty: boolean };

export function initEditor(map: MindMap): EditorState {
  return { map, selectedId: map.root.id, editing: null, past: [], future: [], revision: 0 };
}

function commit(state: EditorState, next: MindMap, patch: Partial<EditorState> = {}): EditorState {
  const past = [...state.past, state.map].slice(-HISTORY_LIMIT);
  return { ...state, ...patch, map: next, past, future: [], revision: state.revision + 1 };
}

/** Throws away a just-created topic by restoring the map from before it existed. */
function dropNewTopic(state: EditorState): EditorState {
  const prev = state.past[state.past.length - 1];
  const f = state.editing ? T.findNode(state.map.root, state.editing.id) : null;
  if (!prev) return { ...state, editing: null };
  return {
    ...state, map: prev, past: state.past.slice(0, -1), editing: null,
    selectedId: f?.parent?.id ?? prev.root.id, revision: state.revision + 1,
  };
}

function keepSelection(map: MindMap, id: string): string {
  return T.findNode(map.root, id) ? id : map.root.id;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'select':
      return T.findNode(state.map.root, action.id) ? { ...state, selectedId: action.id } : state;

    case 'addChild':
    case 'addSibling': {
      const created = T.newNode();
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = action.type === 'addChild'
          ? T.addChild(d.root, state.selectedId, created)
          : T.addSiblingAfter(d.root, state.selectedId, created);
      });
      return ok ? commit(state, next, { selectedId: created.id, editing: { id: created.id, isNew: true } }) : state;
    }

    case 'delete': {
      let nextSel: string | null = null;
      const next = produce(state.map, (d) => {
        nextSel = T.removeNode(d.root, state.selectedId);
      });
      return nextSel ? commit(state, next, { selectedId: nextSel, editing: null }) : state;
    }

    case 'toggleFold': {
      const id = action.id ?? state.selectedId;
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.toggleCollapsed(d.root, id);
      });
      return ok ? commit(state, next) : state;
    }

    case 'startEdit': {
      const id = action.id ?? state.selectedId;
      return T.findNode(state.map.root, id) ? { ...state, selectedId: id, editing: { id, isNew: false } } : state;
    }

    case 'commitEdit': {
      const ed = state.editing;
      if (!ed) return state;
      const text = action.text.replace(/\s+$/, '');
      if (!text.trim()) return ed.isNew ? dropNewTopic(state) : { ...state, editing: null };
      const current = T.findNode(state.map.root, ed.id);
      if (!current || current.node.text === text) return { ...state, editing: null };
      const next = produce(state.map, (d) => {
        T.setText(d.root, ed.id, text);
      });
      // A new topic already has the undo step from addChild/addSibling: fold the text into it.
      if (ed.isNew) return { ...state, map: next, editing: null, revision: state.revision + 1 };
      return commit(state, next, { editing: null });
    }

    case 'cancelEdit':
      return state.editing?.isNew ? dropNewTopic(state) : { ...state, editing: null };

    case 'move': {
      let ok = false;
      const next = produce(state.map, (d) => {
        ok = T.moveNode(d.root, action.id, action.targetId);
      });
      return ok ? commit(state, next, { selectedId: action.id }) : state;
    }

    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return {
        ...state, map: prev, past: state.past.slice(0, -1), future: [state.map, ...state.future],
        editing: null, selectedId: keepSelection(prev, state.selectedId), revision: state.revision + 1,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state, map: next, past: [...state.past, state.map].slice(-HISTORY_LIMIT), future: state.future.slice(1),
        editing: null, selectedId: keepSelection(next, state.selectedId), revision: state.revision + 1,
      };
    }

    case 'serverSaved':
      return {
        ...state,
        map: { ...state.map, version: action.map.version, updatedAt: action.map.updatedAt, title: action.map.title },
      };

    case 'replaceMap':
      return { ...initEditor(action.map), revision: state.revision + (action.dirty ? 1 : 0) };
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor/store.test.ts && npm run typecheck`
Expected: 8 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/store.ts src/editor/store.test.ts
git commit -m "feat(editor): reducer with selection, editing and 200-step undo"
```

---

### Task 5: Text wrapping and the balanced map layout

**Files:**
- Create: `src/layout/styles.ts`, `src/layout/wrap.ts`, `src/layout/map.ts`
- Test: `src/layout/wrap.test.ts`, `src/layout/map.test.ts`

**Interfaces:**
- Consumes: `visibleChildren` (Task 3) and `MapNode`
- Produces:
  - `type Measure = (text: string, fontSize: number) => number`
  - `styleFor(depth): NodeStyle`, where `NodeStyle = { kind: 'root'|'box'|'line', fontSize, padX, padY, maxW, lineHeight }`
  - `PALETTE: BranchColor[]`, `ROOT_COLOR`, and `GAP` (`hRoot`, `hDeep`, `vRoot`, `vDeep`)
  - `wrapText(text, fontSize, maxW, measure): string[]`
  - `computeLayout(root, measure): MapLayout`, where `MapLayout = { boxes: TopicBox[]; byId: Map<string, TopicBox>; branches: BranchPath[]; bounds: Bounds }`
  - `TopicBox = { id, node, parentId, depth, side: 1|-1|0, x, y, w, h, style, lines, color }`
  - `BranchPath = { from, to, d, color, fromDepth }`
  - `anchorOut(box, side)` and `anchorIn(box)`

- [ ] **Step 1: Write the failing tests**

`src/layout/wrap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { wrapText, type Measure } from './wrap';

const measure: Measure = (t, size) => t.length * size * 0.5; // 10 px per char at size 20

describe('wrapText', () => {
  it('breaks Latin text between words', () => {
    expect(wrapText('alpha beta gamma delta', 20, 110, measure)).toEqual(['alpha beta', 'gamma delta']);
  });
  it('breaks CJK text between characters', () => {
    expect(wrapText('中文也是手写体', 20, 30, measure)).toEqual(['中文也', '是手写', '体']);
  });
  it('keeps explicit line breaks', () => {
    expect(wrapText('one\ntwo', 20, 500, measure)).toEqual(['one', 'two']);
  });
  it('never splits a single long word', () => {
    expect(wrapText('supercalifragilistic', 20, 50, measure)).toEqual(['supercalifragilistic']);
  });
});
```

`src/layout/map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from './map';
import { PALETTE, ROOT_COLOR } from './styles';
import type { Measure } from './wrap';

const measure: Measure = (t, size) => t.length * size * 0.5;
const n = (id: string, text: string, children: MapNode[] = [], extra: Partial<MapNode> = {}): MapNode =>
  ({ id, text, children, ...extra });

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randomTree(rand: () => number, depth = 0, counter = { v: 0 }): MapNode {
  const kids = depth >= 4 ? 0 : Math.floor(rand() * (depth === 0 ? 7 : 4));
  const words = 1 + Math.floor(rand() * 12);
  return {
    id: `n${counter.v++}`,
    text: Array.from({ length: words }, () => 'word').join(' '),
    children: Array.from({ length: kids }, () => randomTree(rand, depth + 1, counter)),
    ...(rand() < 0.1 ? { collapsed: true } : {}),
  };
}

describe('computeLayout (balanced map)', () => {
  it('centres the root on the origin', () => {
    const l = computeLayout(n('r', 'Root'), measure);
    const r = l.byId.get('r')!;
    expect([r.x + r.w / 2, r.y + r.h / 2, r.side]).toEqual([0, 0, 0]);
  });

  it('fills the right side first, then the left in reverse (clockwise)', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A'), n('b', 'B'), n('c', 'C'), n('d', 'D')]), measure);
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => l.byId.get(id)!);
    expect([a.side, b.side, c.side, d.side]).toEqual([1, 1, -1, -1]);
    expect(a.y).toBeLessThan(b.y);
    expect(d.y).toBeLessThan(c.y);
    expect(a.x).toBeGreaterThan(0);
    expect(c.x + c.w).toBeLessThan(0);
  });

  it('keeps 70 px between the root and first-level topics, 36 px deeper', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')])]), measure);
    const [r, a, a1] = ['r', 'a', 'a1'].map((id) => l.byId.get(id)!);
    expect(a.x - (r.x + r.w)).toBe(70);
    expect(a1.x - (a.x + a.w)).toBe(36);
  });

  it('hides the children of a folded topic', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')], { collapsed: true })]), measure);
    expect(l.byId.has('a1')).toBe(false);
    expect(l.branches).toHaveLength(1);
  });

  it('colours first-level branches from the palette and children inherit', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')]), n('b', 'B')]), measure);
    expect(l.byId.get('r')!.color).toEqual(ROOT_COLOR);
    expect(l.byId.get('a')!.color).toEqual(PALETTE[0]);
    expect(l.byId.get('a1')!.color).toEqual(PALETTE[0]);
    expect(l.byId.get('b')!.color).toEqual(PALETTE[1]);
  });

  it('draws one branch per non-root topic, as a cubic path', () => {
    const l = computeLayout(n('r', 'Root', [n('a', 'A', [n('a1', 'A1')])]), measure);
    expect(l.branches.map((b) => [b.from, b.to])).toEqual([['r', 'a'], ['a', 'a1']]);
    expect(l.branches[0].d).toMatch(/^M-?[\d.]+ -?[\d.]+ C/);
  });

  it('never overlaps topics in 200 random maps, and bounds contain them all', () => {
    const rand = mulberry32(42);
    for (let k = 0; k < 200; k++) {
      const l = computeLayout(randomTree(rand), measure);
      const bs = l.boxes;
      for (let i = 0; i < bs.length; i++) {
        const a = bs[i];
        expect(a.x).toBeGreaterThanOrEqual(l.bounds.x);
        expect(a.y + a.h).toBeLessThanOrEqual(l.bounds.y + l.bounds.h);
        for (let j = i + 1; j < bs.length; j++) {
          const b = bs[j];
          const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
          expect(overlap, `${a.id} overlaps ${b.id} in tree ${k}`).toBe(false);
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/layout`
Expected: FAIL, "Cannot find module './wrap'" and "./map".

- [ ] **Step 3: Implement**

`src/layout/styles.ts`:

```ts
export type TopicKind = 'root' | 'box' | 'line';

export interface NodeStyle {
  kind: TopicKind;
  fontSize: number;
  padX: number;
  padY: number;
  maxW: number;
  lineHeight: number;
}

export interface BranchColor {
  stroke: string;
  fill: string;
}

export function styleFor(depth: number): NodeStyle {
  if (depth === 0) return { kind: 'root', fontSize: 28, padX: 26, padY: 15, maxW: 300, lineHeight: 36 };
  if (depth === 1) return { kind: 'box', fontSize: 20, padX: 16, padY: 9, maxW: 230, lineHeight: 26 };
  return { kind: 'line', fontSize: 17, padX: 5, padY: 4, maxW: 250, lineHeight: 22 };
}

export const ROOT_COLOR: BranchColor = { stroke: '#1e1e1e', fill: '#ffec99' };

export const PALETTE: BranchColor[] = [
  { stroke: '#e03131', fill: '#ffc9c9' },
  { stroke: '#1971c2', fill: '#a5d8ff' },
  { stroke: '#2f9e44', fill: '#b2f2bb' },
  { stroke: '#f08c00', fill: '#ffec99' },
  { stroke: '#9c36b5', fill: '#eebefa' },
  { stroke: '#0c8599', fill: '#99e9f2' },
];

export const GAP = { hRoot: 70, hDeep: 36, vRoot: 26, vDeep: 10 } as const;
```

`src/layout/wrap.ts`:

```ts
export type Measure = (text: string, fontSize: number) => number;

const CJK = '\\u2E80-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFFEF\\u3000-\\u303F';
const TOKEN = new RegExp(`[${CJK}]|[^\\s${CJK}]+|\\s+`, 'g');

/** Greedy wrap: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapText(text: string, fontSize: number, maxW: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = para.match(TOKEN) ?? [];
    let line = '';
    for (const tok of tokens) {
      const candidate = line + tok;
      if (line.trim() && measure(candidate.trimEnd(), fontSize) > maxW) {
        out.push(line.trimEnd());
        line = /^\s+$/.test(tok) ? '' : tok;
      } else {
        line = candidate;
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}
```

`src/layout/map.ts`:

```ts
import type { MapNode } from '../shared/types';
import { visibleChildren } from '../model/tree';
import { GAP, PALETTE, ROOT_COLOR, styleFor, type BranchColor, type NodeStyle } from './styles';
import { wrapText, type Measure } from './wrap';

export type Side = 1 | -1 | 0;

export interface TopicBox {
  id: string;
  node: MapNode;
  parentId: string | null;
  depth: number;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  style: NodeStyle;
  lines: string[];
  color: BranchColor;
}

export interface BranchPath {
  from: string;
  to: string;
  d: string;
  color: BranchColor;
  fromDepth: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLayout {
  boxes: TopicBox[];
  byId: Map<string, TopicBox>;
  branches: BranchPath[];
  bounds: Bounds;
}

interface Measured {
  style: NodeStyle;
  lines: string[];
  w: number;
  h: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

function measureTopic(node: MapNode, depth: number, measure: Measure): Measured {
  const style = styleFor(depth);
  const lines = wrapText(node.text || ' ', style.fontSize, style.maxW, measure);
  const textW = Math.max(style.fontSize * 1.6, ...lines.map((l) => measure(l, style.fontSize)));
  return {
    style,
    lines,
    w: Math.ceil(textW + style.padX * 2),
    h: Math.ceil(lines.length * style.lineHeight + style.padY * 2),
  };
}

/** Where a branch leaves a topic towards `side`; underlined topics connect at the underline. */
export function anchorOut(b: TopicBox, side: 1 | -1): [number, number] {
  const y = b.style.kind === 'line' ? b.y + b.h : b.y + b.h / 2;
  return [side > 0 ? b.x + b.w : b.x, y];
}

export function anchorIn(b: TopicBox): [number, number] {
  const y = b.style.kind === 'line' ? b.y + b.h : b.y + b.h / 2;
  return [b.side >= 0 ? b.x : b.x + b.w, y];
}

function branchPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x2 - x1) / 2;
  return `M${r1(x1)} ${r1(y1)} C${r1(x1 + mx)} ${r1(y1)} ${r1(x2 - mx)} ${r1(y2)} ${r1(x2)} ${r1(y2)}`;
}

export function computeLayout(root: MapNode, measure: Measure): MapLayout {
  const measured = new Map<string, Measured>();
  const blockH = new Map<string, number>();
  const vGap = (depth: number) => (depth === 0 ? GAP.vRoot : GAP.vDeep);
  const hGap = (depth: number) => (depth === 0 ? GAP.hRoot : GAP.hDeep);

  const measureAll = (n: MapNode, depth: number) => {
    measured.set(n.id, measureTopic(n, depth, measure));
    visibleChildren(n).forEach((c) => measureAll(c, depth + 1));
  };
  measureAll(root, 0);

  // Height of a topic's whole branch block.
  const block = (n: MapNode, depth: number): number => {
    const kids = visibleChildren(n);
    const own = measured.get(n.id)!.h;
    const total = kids.reduce((s, c) => s + block(c, depth + 1), 0) + vGap(depth) * Math.max(0, kids.length - 1);
    const h = Math.max(own, total);
    blockH.set(n.id, h);
    return h;
  };

  const boxes: TopicBox[] = [];
  const byId = new Map<string, TopicBox>();
  const branches: BranchPath[] = [];
  const add = (n: MapNode, depth: number, x: number, y: number, side: Side, color: BranchColor, parentId: string | null) => {
    const m = measured.get(n.id)!;
    const box: TopicBox = { id: n.id, node: n, parentId, depth, side, x, y, w: m.w, h: m.h, style: m.style, lines: m.lines, color };
    boxes.push(box);
    byId.set(n.id, box);
    return box;
  };

  const place = (n: MapNode, depth: number, edgeX: number, centerY: number, side: 1 | -1, color: BranchColor, parent: TopicBox) => {
    const m = measured.get(n.id)!;
    const box = add(n, depth, side > 0 ? edgeX : edgeX - m.w, centerY - m.h / 2, side, color, parent.id);
    branches.push({ from: parent.id, to: n.id, d: branchPath(anchorOut(parent, side), anchorIn(box)), color, fromDepth: parent.depth });
    const kids = visibleChildren(n);
    if (!kids.length) return;
    const total = kids.reduce((s, c) => s + blockH.get(c.id)!, 0) + vGap(depth) * (kids.length - 1);
    const nextEdge = side > 0 ? box.x + box.w + hGap(depth) : box.x - hGap(depth);
    let y = centerY - total / 2;
    for (const c of kids) {
      const bh = blockH.get(c.id)!;
      place(c, depth + 1, nextEdge, y + bh / 2, side, color, box);
      y += bh + vGap(depth);
    }
  };

  const rm = measured.get(root.id)!;
  const rootBox = add(root, 0, -rm.w / 2, -rm.h / 2, 0, ROOT_COLOR, null);
  const kids = visibleChildren(root);
  kids.forEach((c) => block(c, 1));
  const total = kids.reduce((s, c) => s + blockH.get(c.id)!, 0);
  const right: MapNode[] = [];
  const left: MapNode[] = [];
  let acc = 0;
  for (const c of kids) {
    if (right.length === 0 || acc < total / 2) {
      right.push(c);
      acc += blockH.get(c.id)!;
    } else {
      left.push(c);
    }
  }
  left.reverse(); // clockwise reading order, as in XMind

  const column = (list: MapNode[], side: 1 | -1) => {
    const colH = list.reduce((s, c) => s + blockH.get(c.id)!, 0) + GAP.vRoot * Math.max(0, list.length - 1);
    let y = -colH / 2;
    for (const c of list) {
      const bh = blockH.get(c.id)!;
      const edge = side > 0 ? rm.w / 2 + GAP.hRoot : -rm.w / 2 - GAP.hRoot;
      place(c, 1, edge, y + bh / 2, side, PALETTE[kids.indexOf(c) % PALETTE.length], rootBox);
      y += bh + GAP.vRoot;
    }
  };
  column(right, 1);
  column(left, -1);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { boxes, byId, branches, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/layout && npm run typecheck`
Expected: 11 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/layout
git commit -m "feat(layout): text wrapping and balanced map layout"
```

---

### Task 6: Worker API — owner key and map storage in R2

**Files:**
- Create: `worker/http.ts`, `worker/auth.ts`, `worker/maps.ts`
- Modify: `worker/index.ts` (replace the whole file)
- Test: `worker/test/maps.spec.ts`

**Interfaces:**
- Consumes:
  - `parseMindMap` and `MapValidationError` (Task 2)
  - `plainTitle` (Task 2), `LIMITS` (Task 2)
  - `newMapId` and `newNodeId` (Task 3)
- Produces the HTTP API (spec §8). The client in Task 10 relies on these exact shapes:

| Method & path | Auth | Success | Errors |
|---|---|---|---|
| `GET /api/maps` | owner | `200 MapSummary[]`, newest first | 401 |
| `POST /api/maps` with body `{title?}` | owner | `201 MindMap` + `ETag` | 401 |
| `GET /api/maps/:id` | public | `200 MindMap` + `ETag` | 404 |
| `PUT /api/maps/:id` with body `MindMap` and header `If-Match` | owner | `200 MindMap` (server sets version, updatedAt, title) + new `ETag` | 400 / 401 / 404 / 409 (with current `ETag`) / 413 / 428 |
| `DELETE /api/maps/:id` | owner | `204` | 401 |

  Every API response carries `Cache-Control: no-store`. Error bodies look like `{ "error": string }`.
- Also exported: `handleApi(request, env): Promise<Response>` from `worker/index.ts`.

- [ ] **Step 1: Write the failing tests**

`worker/test/maps.spec.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';
import type { MapSummary, MindMap } from '../../src/shared/types';

const E = env as unknown as Env;
const KEY = 'test-owner-key';

function call(path: string, init: RequestInit = {}, key: string | null = KEY) {
  const headers = new Headers(init.headers);
  if (key !== null) headers.set('Authorization', `Bearer ${key}`);
  return worker.fetch(new Request(`http://x${path}`, { ...init, headers }), E);
}
async function create(title = 'Plan') {
  const res = await call('/api/maps', { method: 'POST', body: JSON.stringify({ title }) });
  return { res, map: (await res.json()) as MindMap, etag: res.headers.get('ETag')! };
}
const put = (map: MindMap, etag: string | null, key: string | null = KEY) =>
  call(`/api/maps/${map.id}`, { method: 'PUT', body: JSON.stringify(map), headers: etag ? { 'If-Match': etag } : {} }, key);

describe('maps API', () => {
  it('refuses to create or list without the right owner key', async () => {
    expect((await call('/api/maps', { method: 'POST' }, null)).status).toBe(401);
    expect((await call('/api/maps', { method: 'POST' }, 'wrong')).status).toBe(401);
    expect((await call('/api/maps', { method: 'POST' }, 'x'.repeat(KEY.length))).status).toBe(401);
    const res = await call('/api/maps', {}, null);
    expect([res.status, await res.json()]).toEqual([401, { error: 'Unauthorized' }]);
  });

  it('creates a map with version 1, an ETag and no-store caching', async () => {
    const { res, map, etag } = await create('Weekly plan');
    expect(res.status).toBe(201);
    expect(etag).toBeTruthy();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(map).toMatchObject({ title: 'Weekly plan', layout: 'map', version: 1, root: { text: 'Weekly plan', children: [] } });
    expect(map.id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it('lets anyone read a map by id, and 404s unknown or malformed ids', async () => {
    const { map, etag } = await create();
    const res = await call(`/api/maps/${map.id}`, {}, null);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe(etag);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(map);
    expect((await call('/api/maps/aaaaaaaaaaaaaaaaaaaaa', {}, null)).status).toBe(404);
    expect((await call('/api/maps/not-an-id', {}, null)).status).toBe(404);
  });

  it('saves with If-Match: bumps version, recomputes title, returns a new ETag', async () => {
    const { map, etag } = await create();
    const edited: MindMap = { ...map, title: 'ignored', root: { ...map.root, text: 'Renamed\nsecond line', children: [{ id: 'child00001', text: 'A', children: [] }] } };
    const res = await put(edited, etag);
    expect(res.status).toBe(200);
    const saved = (await res.json()) as MindMap;
    expect([saved.version, saved.title, saved.root.children.length]).toEqual([2, 'Renamed', 1]);
    expect(res.headers.get('ETag')).not.toBe(etag);
  });

  it('answers 428 without If-Match and 409 with a stale ETag', async () => {
    const { map, etag } = await create();
    expect((await put(map, null)).status).toBe(428);
    const first = await put(map, etag);
    expect(first.status).toBe(200);
    const stale = await put(map, etag);
    expect(stale.status).toBe(409);
    expect(stale.headers.get('ETag')).toBe(first.headers.get('ETag'));
  });

  it('rejects invalid bodies, mismatched ids and maps over 2 MB', async () => {
    const { map, etag } = await create();
    const bad = await call(`/api/maps/${map.id}`, { method: 'PUT', body: '{"nope":1}', headers: { 'If-Match': etag } });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/id|layout|root/);
    expect((await put({ ...map, id: 'bbbbbbbbbbbbbbbbbbbbb' }, etag)).status).toBe(400);
    const huge = { ...map, root: { ...map.root, note: 'x'.repeat(10) } } as MindMap & { pad?: string };
    const body = JSON.stringify(huge).replace('"layout"', `"pad":"${'x'.repeat(2_000_001)}","layout"`);
    const big = await call(`/api/maps/${map.id}`, { method: 'PUT', body, headers: { 'If-Match': etag } });
    expect(big.status).toBe(413);
  });

  it('lists maps newest first and deletes them', async () => {
    const a = await create('Alpha');
    const b = await create('Beta');
    const list = (await (await call('/api/maps')).json()) as MapSummary[];
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([a.map.id, b.map.id]));
    const times = list.map((s) => s.updatedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(list.find((s) => s.id === b.map.id)?.title).toBe('Beta');
    expect((await call(`/api/maps/${a.map.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/maps/${a.map.id}`, {}, null)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test:worker`
Expected: FAIL. `maps.spec.ts` tests fail with status 404 instead of 401/201, because the routes don't exist yet.

- [ ] **Step 3: Implement**

`worker/http.ts`:

```ts
export const API_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(API_HEADERS)) headers.set(k, v);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function errorResponse(status: number, error: string, headers?: HeadersInit): Response {
  return json({ error }, { status, headers });
}
```

`worker/auth.ts`:

```ts
const encoder = new TextEncoder();

/** True when the request carries `Authorization: Bearer <ownerKey>`, compared in constant time. */
export function isOwner(request: Request, ownerKey: string): boolean {
  const match = /^Bearer (.+)$/.exec(request.headers.get('Authorization') ?? '');
  if (!match || !ownerKey) return false;
  const given = encoder.encode(match[1]);
  const expected = encoder.encode(ownerKey);
  if (given.byteLength !== expected.byteLength) {
    crypto.subtle.timingSafeEqual(expected, expected); // keep timing similar
    return false;
  }
  return crypto.subtle.timingSafeEqual(given, expected);
}
```

`worker/maps.ts`:

```ts
import type { Env } from './index';
import { API_HEADERS, errorResponse, json } from './http';
import { MapValidationError, parseMindMap } from '../src/shared/schema';
import { plainTitle } from '../src/shared/title';
import { LIMITS, type MapSummary, type MindMap } from '../src/shared/types';
import { newMapId, newNodeId } from '../src/model/ids';

const ID_RE = /^[A-Za-z0-9_-]{21}$/;
const objectKey = (id: string) => `maps/${id}.json`;
// R2 `put` replaces custom metadata, so every write sends all three fields.
const metadata = (m: MindMap) => ({ title: m.title, updatedAt: m.updatedAt, version: String(m.version) });
const CONFLICT = 'The map changed since you loaded it';

export async function listMaps(env: Env): Promise<Response> {
  const out: MapSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.MAPS.list({ prefix: 'maps/', include: ['customMetadata'], cursor });
    for (const o of page.objects) {
      out.push({
        id: o.key.slice('maps/'.length, -'.json'.length),
        title: o.customMetadata?.title ?? 'Untitled map',
        updatedAt: o.customMetadata?.updatedAt ?? o.uploaded.toISOString(),
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return json(out);
}

export async function createMap(request: Request, env: Env): Promise<Response> {
  let text = 'Central topic';
  try {
    const body = (await request.json()) as { title?: unknown };
    if (typeof body?.title === 'string' && body.title.trim()) text = body.title.trim().slice(0, 200);
  } catch {
    // an empty or non-JSON body just means "default title"
  }
  const root = { id: newNodeId(), text, children: [] };
  const map: MindMap = { id: newMapId(), title: plainTitle(root), layout: 'map', version: 1, updatedAt: new Date().toISOString(), root };
  const obj = await env.MAPS.put(objectKey(map.id), JSON.stringify(map), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: metadata(map),
  });
  return json(map, { status: 201, headers: { ETag: obj!.httpEtag } });
}

export async function getMap(id: string, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return errorResponse(404, 'Not found');
  const obj = await env.MAPS.get(objectKey(id));
  if (!obj) return errorResponse(404, 'Not found');
  return new Response(obj.body, {
    headers: { ...API_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ETag: obj.httpEtag },
  });
}

export async function saveMap(id: string, request: Request, env: Env): Promise<Response> {
  if (!ID_RE.test(id)) return errorResponse(404, 'Not found');
  const ifMatch = request.headers.get('If-Match');
  if (!ifMatch) return errorResponse(428, 'If-Match header required');
  const etag = ifMatch.replace(/^W\//, '').replace(/"/g, '');

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > LIMITS.mapJsonBytes) return errorResponse(413, 'Map is larger than 2 MB');
  let incoming: MindMap;
  try {
    incoming = parseMindMap(JSON.parse(body));
  } catch (e) {
    return errorResponse(400, e instanceof MapValidationError ? e.message : 'Body must be JSON');
  }
  if (incoming.id !== id) return errorResponse(400, 'Map id does not match the URL');

  const current = await env.MAPS.head(objectKey(id));
  if (!current) return errorResponse(404, 'Not found');
  if (current.etag !== etag) return errorResponse(409, CONFLICT, { ETag: current.httpEtag });

  const saved: MindMap = {
    ...incoming,
    version: Number(current.customMetadata?.version ?? '0') + 1,
    updatedAt: new Date().toISOString(),
    title: plainTitle(incoming.root),
  };
  const obj = await env.MAPS.put(objectKey(id), JSON.stringify(saved), {
    onlyIf: { etagMatches: etag },
    httpMetadata: { contentType: 'application/json' },
    customMetadata: metadata(saved),
  });
  if (!obj) return errorResponse(409, CONFLICT); // someone saved between head() and put()
  return json(saved, { headers: { ETag: obj.httpEtag } });
}

export async function deleteMap(id: string, env: Env): Promise<Response> {
  if (ID_RE.test(id)) await env.MAPS.delete(objectKey(id));
  return new Response(null, { status: 204, headers: API_HEADERS });
}
```

`worker/index.ts` (whole file):

```ts
import { isOwner } from './auth';
import { errorResponse } from './http';
import { createMap, deleteMap, getMap, listMaps, saveMap } from './maps';

export interface Env {
  MAPS: R2Bucket;
  OWNER_KEY: string;
  ASSETS: Fetcher;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean); // ['api', 'maps', id?]
  if (parts[1] !== 'maps' || parts.length > 3) return errorResponse(404, 'Not found');
  const id = parts[2];
  const method = request.method;
  if (!id) {
    if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
    if (method === 'GET') return listMaps(env);
    if (method === 'POST') return createMap(request, env);
    return errorResponse(405, 'Method not allowed');
  }
  if (method === 'GET') return getMap(id, env);
  if (!isOwner(request, env.OWNER_KEY)) return errorResponse(401, 'Unauthorized');
  if (method === 'PUT') return saveMap(id, request, env);
  if (method === 'DELETE') return deleteMap(id, env);
  return errorResponse(405, 'Method not allowed');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker && npm run typecheck`
Expected: 8 tests pass (7 here plus the Task 1 smoke test) and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): owner-key auth and map CRUD on R2 with ETag conflicts"
```

---

### Task 7: Worker — serve the app with security headers

**Files:**
- Create: `worker/assets.ts`
- Modify: `worker/index.ts` (the last line of `fetch`)
- Test: `worker/test/assets.spec.ts`

**Interfaces:**
- Consumes: `Env` (Task 6)
- Produces:
  - `securityHeaders(pathname, contentType): Record<string, string>`
  - `serveAsset(request, env): Promise<Response>`
- Rules (spec §7):
  - HTML for any path except `/m/*` gets `Content-Security-Policy: frame-ancestors 'none'`.
  - `/m/*` never carries `X-Frame-Options` or a CSP.
  - Everything gets `X-Content-Type-Options: nosniff`.

- [ ] **Step 1: Write the failing test**

`worker/test/assets.spec.ts`:

```ts
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../index';

function withAssets(contentType: string, extra: Record<string, string> = {}): Env {
  const ASSETS = {
    fetch: async () => new Response('body', { headers: { 'Content-Type': contentType, ...extra } }),
  } as unknown as Fetcher;
  return { ...(env as unknown as Env), ASSETS };
}
const get = (path: string, e: Env) => worker.fetch(new Request(`http://x${path}`), e);

describe('asset responses', () => {
  it('forbids framing the list page and the editor', async () => {
    for (const path of ['/', '/e/abcdefghijklmnopqrstu']) {
      const res = await get(path, withAssets('text/html; charset=utf-8'));
      expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('lets the view page be framed anywhere, even if a framing header slipped in', async () => {
    const res = await get('/m/abcdefghijklmnopqrstu', withAssets('text/html', { 'X-Frame-Options': 'DENY' }));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(await res.text()).toBe('body');
  });

  it('leaves scripts and fonts without a CSP but adds nosniff', async () => {
    const res = await get('/assets/index.js', withAssets('text/javascript'));
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm run test:worker`
Expected: FAIL. `Content-Security-Policy` is `null` for `/`.

- [ ] **Step 3: Implement**

`worker/assets.ts`:

```ts
import type { Env } from './index';

export function securityHeaders(pathname: string, contentType: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  const isHtml = (contentType ?? '').includes('text/html');
  if (isHtml && !pathname.startsWith('/m/')) headers['Content-Security-Policy'] = "frame-ancestors 'none'";
  return headers;
}

export async function serveAsset(request: Request, env: Pick<Env, 'ASSETS'>): Promise<Response> {
  const upstream = await env.ASSETS.fetch(request);
  const res = new Response(upstream.body, upstream); // copy so headers are mutable
  const { pathname } = new URL(request.url);
  if (pathname.startsWith('/m/')) {
    res.headers.delete('X-Frame-Options');
    res.headers.delete('Content-Security-Policy');
  }
  for (const [k, v] of Object.entries(securityHeaders(pathname, upstream.headers.get('Content-Type')))) res.headers.set(k, v);
  return res;
}
```

In `worker/index.ts`, import `serveAsset` and replace `return env.ASSETS.fetch(request);` with:

```ts
    return serveAsset(request, env);
```

Add `import { serveAsset } from './assets';` at the top.

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker && npm run typecheck`
Expected: 11 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat(worker): serve the SPA with framing rules per route"
```

---

### Task 8: Self-hosted Excalifont and Xiaolai

**Files:**
- Create: `scripts/gen-font-faces.mjs`, `scripts/copy-fonts.mjs`, `src/render/fonts.ts`
- Generated and committed: `src/render/fontFaces.generated.ts`, `public/fonts/OFL.txt`
- Modify: `package.json` (add `@excalidraw/excalidraw` and the `fonts`, `predev` and `prebuild` scripts), `.gitignore`
- Test: `src/render/fonts.test.ts`

**Interfaces:**
- Produces:
  - `FONT_FACES: FontFaceEntry[]`, where `FontFaceEntry = { family: 'Excalifont'|'Xiaolai', file, unicodeRange }`
  - `FONT_STACK` (CSS font-family string) and `FONT_TIMEOUT_MS = 2500`
  - `fontFaceCss(base?)` and `installFontFaces(doc?)`
  - `ensureFonts(text, fonts?, timeoutMs?): Promise<boolean>`
  - `canvasMeasure(): Measure`
  - `parseRanges(range)` and `facesFor(text): FontFaceEntry[]`

- [ ] **Step 1: Install the font source and add scripts**

```bash
npm i -D @excalidraw/excalidraw@0.18.1
```

In `package.json`, add these to `"scripts"`:

```json
"fonts": "node scripts/copy-fonts.mjs",
"predev": "npm run fonts",
"prebuild": "npm run fonts",
```

Append to `.gitignore`:

```
public/fonts/Excalifont/
public/fonts/Xiaolai/
```

- [ ] **Step 2: Write the generator and run it once**

`scripts/gen-font-faces.mjs`:

```js
// Reads Excalidraw's font index files at the pinned tag and writes the @font-face table plus the licence file.
// Re-run only when upgrading @excalidraw/excalidraw.
import { mkdir, writeFile } from 'node:fs/promises';

const TAG = 'v0.18.1';
const FAMILIES = ['Excalifont', 'Xiaolai'];
const faces = [];
const copyrights = [];
let licence = '';

for (const family of FAMILIES) {
  const url = `https://raw.githubusercontent.com/excalidraw/excalidraw/${TAG}/packages/excalidraw/fonts/${family}/index.ts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const src = await res.text();
  const files = Object.fromEntries([...src.matchAll(/import (_\d+) from "\.\/([^"]+\.woff2)";/g)].map((m) => [m[1], m[2]]));
  const ranges = [...src.matchAll(/uri:\s*(_\d+),\s*descriptors:\s*\{\s*unicodeRange:\s*"([^"]+)"/g)];
  if (!ranges.length || ranges.length !== Object.keys(files).length) {
    throw new Error(`${family}: ${Object.keys(files).length} files but ${ranges.length} ranges`);
  }
  for (const [, ref, range] of ranges) faces.push({ family, file: `${family}/${files[ref]}`, unicodeRange: range.replace(/\s+/g, '') });
  const copyright = /copyright: (.+)/.exec(src)?.[1]?.trim();
  if (copyright) copyrights.push(`${family}: ${copyright}`);
  if (!licence) licence = /license: ([\s\S]+?)\nlicenseURL:/.exec(src)?.[1]?.trim() ?? '';
}
if (!licence.includes('SIL OPEN FONT LICENSE Version 1.1')) throw new Error('OFL text not found in the font headers');

await writeFile(
  new URL('../src/render/fontFaces.generated.ts', import.meta.url),
  `// Generated by scripts/gen-font-faces.mjs from Excalidraw ${TAG}. Do not edit by hand.\n` +
    `export interface FontFaceEntry {\n  family: 'Excalifont' | 'Xiaolai';\n  file: string;\n  unicodeRange: string;\n}\n\n` +
    `export const FONT_FACES: FontFaceEntry[] = ${JSON.stringify(faces, null, 2)};\n`,
);
await mkdir(new URL('../public/fonts/', import.meta.url), { recursive: true });
await writeFile(new URL('../public/fonts/OFL.txt', import.meta.url), `${copyrights.join('\n')}\n\n${licence}\n`);
console.log(`wrote ${faces.length} font faces and public/fonts/OFL.txt`);
```

Run: `node scripts/gen-font-faces.mjs`
Expected: `wrote 216 font faces and public/fonts/OFL.txt`, which is 7 Excalifont faces plus 209 Xiaolai faces.

- [ ] **Step 3: Write the copy script and run it**

`scripts/copy-fonts.mjs`:

```js
// Copies the pinned Excalidraw font files into public/fonts/ so Vite serves them at /fonts/.
import { access, cp, mkdir } from 'node:fs/promises';

const SRC = new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url);
const DEST = new URL('../public/fonts/', import.meta.url);
await access(SRC).catch(() => {
  throw new Error('Run `npm install` first: @excalidraw/excalidraw@0.18.1 provides the font files.');
});
await mkdir(DEST, { recursive: true });
for (const family of ['Excalifont', 'Xiaolai']) {
  await cp(new URL(`${family}/`, SRC), new URL(`${family}/`, DEST), { recursive: true });
}
console.log('fonts copied to public/fonts/');
```

Run: `npm run fonts && ls public/fonts/Excalifont | wc -l && ls public/fonts/Xiaolai | wc -l`
Expected: `7` and `209`.

- [ ] **Step 4: Write the failing tests**

`src/render/fonts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FONT_FACES } from './fontFaces.generated';
import { ensureFonts, facesFor, fontFaceCss, parseRanges } from './fonts';

describe('font faces', () => {
  it('has 7 Excalifont and 209 Xiaolai subsets, all with parseable ranges', () => {
    expect(FONT_FACES.filter((f) => f.family === 'Excalifont')).toHaveLength(7);
    expect(FONT_FACES.filter((f) => f.family === 'Xiaolai')).toHaveLength(209);
    for (const f of FONT_FACES) expect(parseRanges(f.unicodeRange).length).toBeGreaterThan(0);
  });

  it('parses single code points and ranges', () => {
    expect(parseRanges('U+20-7e,U+131')).toEqual([[0x20, 0x7e], [0x131, 0x131]]);
  });

  it('picks only the subsets a text needs', () => {
    const latin = facesFor('Hello');
    expect(latin.map((f) => f.family)).toEqual(['Excalifont']);
    const chinese = facesFor('中文');
    expect(chinese.length).toBeGreaterThan(0);
    expect(chinese.every((f) => f.family === 'Xiaolai')).toBe(true);
  });

  it('emits one @font-face rule per subset, served from /fonts/', () => {
    const css = fontFaceCss();
    expect(css.match(/@font-face/g)).toHaveLength(216);
    expect(css).toContain('url("/fonts/Excalifont/');
    expect(css).toContain('font-display:swap');
  });

  it('ensureFonts gives up after the timeout and reports success otherwise', async () => {
    const never = { load: () => new Promise(() => {}) } as unknown as FontFaceSet;
    expect(await ensureFonts('Hi', never, 20)).toBe(false);
    const ok = { load: async () => [] } as unknown as FontFaceSet;
    expect(await ensureFonts('Hi', ok, 20)).toBe(true);
  });
});
```

- [ ] **Step 5: Run to see it fail**

Run: `npx vitest run src/render/fonts.test.ts`
Expected: FAIL, "Cannot find module './fonts'".

- [ ] **Step 6: Implement**

`src/render/fonts.ts`:

```ts
import { FONT_FACES, type FontFaceEntry } from './fontFaces.generated';
import type { Measure } from '../layout/wrap';

export const FONT_STACK = '"Excalifont", "Xiaolai", "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
export const FONT_TIMEOUT_MS = 2500;

export function parseRanges(range: string): Array<[number, number]> {
  return range.split(',').map((part) => {
    const m = /^U\+([0-9a-f]+)(?:-([0-9a-f]+))?$/i.exec(part.trim());
    if (!m) throw new Error(`Unsupported unicode-range part: ${part}`);
    const start = parseInt(m[1], 16);
    return [start, m[2] ? parseInt(m[2], 16) : start];
  });
}

const parsed = new Map<FontFaceEntry, Array<[number, number]>>();
const rangesOf = (f: FontFaceEntry) => {
  let r = parsed.get(f);
  if (!r) parsed.set(f, (r = parseRanges(f.unicodeRange)));
  return r;
};

/** Subsets whose unicode-range covers at least one character of `text`. */
export function facesFor(text: string): FontFaceEntry[] {
  const points = [...new Set([...text].map((c) => c.codePointAt(0)!))];
  return FONT_FACES.filter((f) => rangesOf(f).some(([a, b]) => points.some((p) => p >= a && p <= b)));
}

export function fontFaceCss(base = '/fonts/'): string {
  return FONT_FACES.map(
    (f) =>
      `@font-face{font-family:"${f.family}";src:url("${base}${f.file}") format("woff2");unicode-range:${f.unicodeRange};font-display:swap}`,
  ).join('\n');
}

let installed = false;
export function installFontFaces(doc: Document = document): void {
  if (installed) return;
  installed = true;
  const style = doc.createElement('style');
  style.dataset.sketchmapFonts = '';
  style.textContent = fontFaceCss();
  doc.head.appendChild(style);
}

/** Loads the subsets `text` needs. Resolves true when loaded, false on failure or after `timeoutMs`. */
export function ensureFonts(
  text: string,
  fonts: FontFaceSet | undefined = typeof document === 'undefined' ? undefined : document.fonts,
  timeoutMs = FONT_TIMEOUT_MS,
): Promise<boolean> {
  if (!fonts) return Promise.resolve(false);
  const sample = text || 'Aa';
  const load = Promise.all([fonts.load('20px Excalifont', sample), fonts.load('20px Xiaolai', sample)]).then(
    () => true,
    () => false,
  );
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([load, timeout]);
}

/** Text width via canvas, cached. Create a new one after fonts finish loading so the cache is fresh. */
export function canvasMeasure(): Measure {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const cache = new Map<string, number>();
  return (text, size) => {
    const key = `${size}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = `${size}px ${FONT_STACK}`;
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/render/fonts.test.ts && npm run typecheck`
Expected: 5 tests pass and typecheck is clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore scripts src/render/fonts.ts src/render/fonts.test.ts \
  src/render/fontFaces.generated.ts public/fonts/OFL.txt
git commit -m "feat(render): self-host Excalifont and Xiaolai subsets with OFL licence"
```

---

### Task 9: rough.js SVG renderer

**Files:**
- Create: `src/render/renderMap.ts`
- Test: `src/render/renderMap.test.ts`

**Interfaces:**
- Consumes:
  - `MapLayout`, `TopicBox` and `anchorOut` (Task 5)
  - `countDescendants` (Task 3)
  - `FONT_STACK` (Task 8)
- Produces:
  - `renderMap(svg: SVGSVGElement, world: SVGGElement, layout: MapLayout, opts: RenderOptions): void`, where `RenderOptions = { selectedId?: string|null; dropTargetId?: string|null }`
  - `hashSeed(s: string): number`
- Markup contract, which the Canvas (Task 13), the view (Task 15) and the e2e tests rely on:
  - each topic is `<g class="topic [selected] [drop]" data-id="…">`, whose first child is `<rect class="hit">`
  - each fold toggle is `<g class="fold [folded]" data-fold="…">`
  - branches live in `<g class="branches">`, topics in `<g class="topics">`

- [ ] **Step 1: Write the failing test**

`src/render/renderMap.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { hashSeed, renderMap } from './renderMap';

const measure = (t: string, size: number) => t.length * size * 0.5;
const tree: MapNode = {
  id: 'r', text: 'Root',
  children: [
    { id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] },
    { id: 'b', text: 'Folded', collapsed: true, children: [{ id: 'b1', text: 'x', children: [] }, { id: 'b2', text: 'y', children: [] }] },
  ],
};

function draw(selectedId: string | null = null) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(world);
  renderMap(svg, world, computeLayout(tree, measure), { selectedId });
  return world;
}

describe('renderMap', () => {
  it('draws one topic group per visible topic and one path per branch', () => {
    const world = draw();
    const ids = [...world.querySelectorAll('g.topic')].map((g) => g.getAttribute('data-id'));
    expect(ids).toEqual(['r', 'a', 'a1', 'b']);
    expect(world.querySelector('g.branches')!.children).toHaveLength(3);
    expect(world.querySelector('g.topic')!.firstElementChild!.getAttribute('class')).toBe('hit');
  });

  it('writes each wrapped line as its own text element in the hand-drawn font', () => {
    const t = draw().querySelector('g.topic[data-id="a1"] text')!;
    expect(t.textContent).toBe('A1');
    expect(t.getAttribute('font-family')).toContain('Excalifont');
  });

  it('is deterministic: same layout, same strokes', () => {
    expect(draw().innerHTML).toBe(draw().innerHTML);
  });

  it('marks the selected topic and shows how many topics a fold hides', () => {
    const world = draw('a');
    expect(world.querySelector('g.topic[data-id="a"]')!.getAttribute('class')).toContain('selected');
    const fold = world.querySelector('g.fold[data-fold="b"]')!;
    expect(fold.getAttribute('class')).toContain('folded');
    expect(fold.querySelector('text')!.textContent).toBe('2');
    expect(world.querySelector('g.fold[data-fold="a"]')!.getAttribute('class')).toBe('fold');
  });

  it('hashSeed is stable and positive', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
    expect(hashSeed('')).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/render/renderMap.test.ts`
Expected: FAIL, "Cannot find module './renderMap'".

- [ ] **Step 3: Implement**

`src/render/renderMap.ts`:

```ts
import rough from 'roughjs';
import { anchorOut, type MapLayout, type TopicBox } from '../layout/map';
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
    const side = t.side === -1 ? -1 : 1;
    const [ox, oy] = anchorOut(t, side);
    const cx = ox + side * 11;
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/render && npm run typecheck`
Expected: 10 tests pass (5 font + 5 renderer) and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/renderMap.ts src/render/renderMap.test.ts
git commit -m "feat(render): rough.js SVG renderer with stable seeds and fold toggles"
```

---

### Task 10: API client and owner key

**Files:**
- Create: `src/api/client.ts`, `src/auth/ownerKey.ts`, `src/auth/KeyPrompt.tsx`
- Test: `src/api/client.test.ts`, `src/auth/ownerKey.test.ts`

**Interfaces:**
- Consumes: the HTTP API from Task 6
- Produces:
  - `class ApiError extends Error { status: number; etag: string | null }`. Status `0` means a network failure.
  - `interface Saved { map: MindMap; etag: string }`
  - `createApi(getKey, fetchImpl?, base?): ApiClient`, where `ApiClient` has:
    - `listMaps(): Promise<MapSummary[]>`
    - `createMap(title?): Promise<Saved>`
    - `getMap(id): Promise<Saved>`
    - `saveMap(map, etag): Promise<Saved>`
    - `deleteMap(id): Promise<void>`
  - `getOwnerKey(storage?)`, `setOwnerKey(key, storage?)` and `clearOwnerKey(storage?)`
  - the React component `<KeyPrompt onSubmit={(key) => …} error?={string} />`

- [ ] **Step 1: Write the failing tests**

`src/auth/ownerKey.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from './ownerKey';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('owner key storage', () => {
  it('stores a trimmed key, reads it back and clears it', () => {
    const s = memoryStorage();
    expect(getOwnerKey(s)).toBeNull();
    setOwnerKey('  secret  ', s);
    expect(getOwnerKey(s)).toBe('secret');
    clearOwnerKey(s);
    expect(getOwnerKey(s)).toBeNull();
  });
  it('returns null instead of throwing when storage is blocked', () => {
    const blocked = { getItem: () => { throw new Error('denied'); } };
    expect(getOwnerKey(blocked)).toBeNull();
  });
});
```

`src/api/client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MindMap } from '../shared/types';
import { ApiError, createApi } from './client';

const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'T', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'T', children: [] } };

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe('api client', () => {
  it('reads maps without the owner key and returns the ETag', async () => {
    const f = fakeFetch(() => Response.json(map, { headers: { ETag: '"e1"' } }));
    const res = await createApi(() => 'k', f.impl).getMap(map.id);
    expect(res).toEqual({ map, etag: '"e1"' });
    expect(f.calls[0].url).toBe(`/api/maps/${map.id}`);
    expect(header(f.calls[0].init, 'Authorization')).toBeNull();
  });

  it('saves with the owner key, If-Match and a JSON body', async () => {
    const f = fakeFetch(() => Response.json({ ...map, version: 2 }, { headers: { ETag: '"e2"' } }));
    const res = await createApi(() => 'k', f.impl).saveMap(map, '"e1"');
    const init = f.calls[0].init;
    expect([init.method, header(init, 'Authorization'), header(init, 'If-Match'), header(init, 'Content-Type')])
      .toEqual(['PUT', 'Bearer k', '"e1"', 'application/json']);
    expect(JSON.parse(init.body as string)).toEqual(map);
    expect(res.etag).toBe('"e2"');
  });

  it('turns error responses into ApiError with status, message and current ETag', async () => {
    const f = fakeFetch(() => Response.json({ error: 'The map changed since you loaded it' }, { status: 409, headers: { ETag: '"e9"' } }));
    const err = await createApi(() => 'k', f.impl).saveMap(map, '"e1"').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect([err.status, err.message, err.etag]).toEqual([409, 'The map changed since you loaded it', '"e9"']);
  });

  it('reports network failures as status 0', async () => {
    const impl = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    const err = await createApi(() => 'k', impl).listMaps().catch((e) => e);
    expect([err instanceof ApiError, err.status]).toEqual([true, 0]);
  });

  it('creates and deletes maps with the owner key', async () => {
    const f = fakeFetch((_u, init) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(map, { status: 201, headers: { ETag: '"e1"' } })));
    const api = createApi(() => 'k', f.impl);
    await api.createMap('Plan');
    await api.deleteMap(map.id);
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ title: 'Plan' });
    expect(f.calls.map((c) => [c.init.method, header(c.init, 'Authorization')])).toEqual([['POST', 'Bearer k'], ['DELETE', 'Bearer k']]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/api src/auth`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/auth/ownerKey.ts`:

```ts
const STORAGE_KEY = 'sketchmap:owner-key';

export function getOwnerKey(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    return storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setOwnerKey(key: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, key.trim());
  } catch {
    // blocked storage: the key works for this page only
  }
}

export function clearOwnerKey(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
```

`src/api/client.ts`:

```ts
import type { MapSummary, MindMap } from '../shared/types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public etag: string | null = null) {
    super(message);
  }
}

export interface Saved {
  map: MindMap;
  etag: string;
}

export interface ApiClient {
  listMaps(): Promise<MapSummary[]>;
  createMap(title?: string): Promise<Saved>;
  getMap(id: string): Promise<Saved>;
  saveMap(map: MindMap, etag: string): Promise<Saved>;
  deleteMap(id: string): Promise<void>;
}

export function createApi(
  getKey: () => string | null,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  base = '',
): ApiClient {
  async function request(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const headers = new Headers(init.headers);
    const key = auth ? getKey() : null;
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    let res: Response;
    try {
      res = await fetchImpl(base + path, { ...init, headers });
    } catch {
      throw new ApiError(0, 'Network error: you seem to be offline');
    }
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, message, res.headers.get('ETag'));
    }
    return res;
  }
  const saved = async (res: Response): Promise<Saved> => ({ map: (await res.json()) as MindMap, etag: res.headers.get('ETag') ?? '' });
  const mapPath = (id: string) => `/api/maps/${encodeURIComponent(id)}`;

  return {
    listMaps: async () => (await (await request('/api/maps')).json()) as MapSummary[],
    createMap: async (title) => saved(await request('/api/maps', { method: 'POST', body: JSON.stringify(title ? { title } : {}) })),
    getMap: async (id) => saved(await request(mapPath(id), {}, false)),
    saveMap: async (map, etag) =>
      saved(await request(mapPath(map.id), { method: 'PUT', body: JSON.stringify(map), headers: { 'If-Match': etag } })),
    deleteMap: async (id) => {
      await request(mapPath(id), { method: 'DELETE' });
    },
  };
}
```

`src/auth/KeyPrompt.tsx`:

```tsx
import { useState } from 'react';

export function KeyPrompt({ onSubmit, error }: { onSubmit: (key: string) => void; error?: string }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="key-prompt"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <h1>Enter your owner key</h1>
      <p>This browser asks once. It’s the secret you set with <code>wrangler secret put OWNER_KEY</code>.</p>
      <label htmlFor="owner-key">Owner key</label>
      <input id="owner-key" type="password" autoComplete="current-password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit">Continue</button>
    </form>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/api src/auth && npm run typecheck`
Expected: 7 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/api src/auth
git commit -m "feat(client): typed API client, ApiError and owner-key storage"
```

---

### Task 11: Autosave with retry, conflicts and a local draft

**Files:**
- Create: `src/editor/autosave.ts`
- Test: `src/editor/autosave.test.ts`

**Interfaces:**
- Consumes: `ApiError` and `Saved` (Task 10)
- Produces:
  - `type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'conflict' | 'unauthorized'`
  - `SAVE_DELAY_MS = 1000` and `MAX_BACKOFF_MS = 60000`
  - `draftKey(id)` and `readDraft(storage, id): Draft | null`, where `Draft = { map, etag, savedAt }`
  - `class Autosaver` with:
    - `constructor(deps, initialEtag, onStatus, onSaved)`
    - `schedule(map)` and `flush()`
    - `resume(etag, map?)`, `discard(etag, mapId)` and `dispose()`
    - the property `currentEtag`
  - `deps: AutosaveDeps = { save(map, etag): Promise<Saved>; storage; setTimer; clearTimer; now }`

- [ ] **Step 1: Write the failing test**

`src/editor/autosave.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../shared/types';
import { ApiError, type Saved } from '../api/client';
import { Autosaver, draftKey, readDraft, type AutosaveDeps, type SaveStatus } from './autosave';

const mapWith = (text: string): MindMap => ({ id: 'abcdefghijklmnopqrstu', title: text, layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text, children: [] } });

function setup(save: (map: MindMap, etag: string) => Promise<Saved>) {
  const store = new Map<string, string>();
  const statuses: SaveStatus[] = [];
  const saved: Saved[] = [];
  const deps: AutosaveDeps = {
    save: vi.fn(save),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
  const saver = new Autosaver(deps, '"e0"', (s) => statuses.push(s), (s) => saved.push(s));
  return { saver, deps, store, statuses, saved };
}
const ok = (n: number) => async (map: MindMap): Promise<Saved> => ({ map: { ...map, version: n }, etag: `"e${n}"` });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Autosaver', () => {
  it('writes a draft at once and saves the latest map 1 s after the last change', async () => {
    const t = setup(ok(1));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(600);
    t.saver.schedule(mapWith('ab'));
    expect(readDraft(t.deps.storage, 'abcdefghijklmnopqrstu')!.map.root.text).toBe('ab');
    await vi.advanceTimersByTimeAsync(999);
    expect(t.deps.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.deps.save).toHaveBeenCalledTimes(1);
    expect(vi.mocked(t.deps.save).mock.calls[0]).toEqual([mapWith('ab'), '"e0"']);
    expect(t.store.has(draftKey('abcdefghijklmnopqrstu'))).toBe(false);
    expect(t.statuses).toEqual(['pending', 'saving', 'saved']);
    expect(t.saver.currentEtag).toBe('"e1"');
  });

  it('uses the ETag from the previous save for the next one', async () => {
    let n = 0;
    const t = setup(async (map) => ({ map, etag: `"e${++n}"` }));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    t.saver.schedule(mapWith('b'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(t.deps.save).mock.calls.map((c) => c[1])).toEqual(['"e0"', '"e1"']);
  });

  it('retries network failures after 2 s, 4 s, 8 s … and keeps the draft meanwhile', async () => {
    let calls = 0;
    const t = setup(async (map) => {
      calls++;
      if (calls <= 3) throw new ApiError(0, 'offline');
      return { map, etag: '"ok"' };
    });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000); // 1st attempt fails
    expect(t.statuses.at(-1)).toBe('retrying');
    await vi.advanceTimersByTimeAsync(2000); // 2nd fails
    await vi.advanceTimersByTimeAsync(4000); // 3rd fails
    expect(t.store.size).toBe(1);
    await vi.advanceTimersByTimeAsync(7999);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1); // 4th succeeds after 8 s
    expect([calls, t.statuses.at(-1), t.store.size]).toEqual([4, 'saved', 0]);
  });

  it('stops on a conflict and continues after resume() with the server ETag', async () => {
    let first = true;
    const t = setup(async (map, etag) => {
      if (first) { first = false; throw new ApiError(409, 'changed', '"server"'); }
      return { map, etag: `${etag}+1` };
    });
    t.saver.schedule(mapWith('mine'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.statuses.at(-1)).toBe('conflict');
    t.saver.schedule(mapWith('mine2'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.deps.save).toHaveBeenCalledTimes(1);
    t.saver.resume('"server"');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(t.deps.save).mock.calls[1]).toEqual([mapWith('mine2'), '"server"']);
    expect(t.statuses.at(-1)).toBe('saved');
  });

  it('discard() drops pending changes and the draft, e.g. after loading a newer version', async () => {
    const t = setup(ok(1));
    t.saver.schedule(mapWith('a'));
    t.saver.discard('"fresh"', 'abcdefghijklmnopqrstu');
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.deps.save).not.toHaveBeenCalled();
    expect([t.store.size, t.saver.currentEtag, t.statuses.at(-1)]).toEqual([0, '"fresh"', 'saved']);
  });

  it('reports a rejected owner key as unauthorized', async () => {
    const t = setup(async () => { throw new ApiError(401, 'Unauthorized'); });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.statuses.at(-1)).toBe('unauthorized');
  });

  it('saves again when edits arrive during a save', async () => {
    let release!: () => void;
    let n = 0;
    const t = setup((map) => new Promise<Saved>((res) => { n++; release = () => res({ map, etag: `"e${n}"` }); }));
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    t.saver.schedule(mapWith('ab'));
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.mocked(t.deps.save).mock.calls.map((c) => c[0].root.text)).toEqual(['a', 'ab']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.statuses.at(-1)).toBe('saved');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/autosave.test.ts`
Expected: FAIL, "Cannot find module './autosave'".

- [ ] **Step 3: Implement**

`src/editor/autosave.ts`:

```ts
import type { MindMap } from '../shared/types';
import { ApiError, type Saved } from '../api/client';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'retrying' | 'conflict' | 'unauthorized';
export const SAVE_DELAY_MS = 1000;
export const MAX_BACKOFF_MS = 60_000;

export interface AutosaveDeps {
  save(map: MindMap, etag: string): Promise<Saved>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  now(): number;
}

export interface Draft {
  map: MindMap;
  etag: string;
  savedAt: number;
}

export const draftKey = (id: string) => `sketchmap:draft:${id}`;

export function readDraft(storage: Pick<Storage, 'getItem'>, id: string): Draft | null {
  try {
    const raw = storage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export class Autosaver {
  private etag: string;
  private latest: MindMap | null = null;
  private timer: unknown = null;
  private inFlight = false;
  private failures = 0;
  private status: SaveStatus = 'saved';

  constructor(
    private deps: AutosaveDeps,
    initialEtag: string,
    private onStatus: (status: SaveStatus) => void,
    private onSaved: (saved: Saved) => void,
  ) {
    this.etag = initialEtag;
  }

  get currentEtag(): string {
    return this.etag;
  }

  /** Call after every change: keeps a local draft now and saves 1 s after the last call. */
  schedule(map: MindMap): void {
    this.latest = map;
    try {
      this.deps.storage.setItem(draftKey(map.id), JSON.stringify({ map, etag: this.etag, savedAt: this.deps.now() }));
    } catch {
      // storage full or blocked: the server save still runs
    }
    if (this.status === 'conflict' || this.status === 'unauthorized') return;
    this.setStatus('pending');
    this.arm(SAVE_DELAY_MS);
  }

  /** Save right away, for example before the page closes. */
  async flush(): Promise<void> {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = null;
    await this.run();
  }

  /** Continue after a conflict was resolved or a new key was entered. */
  resume(etag: string, map?: MindMap): void {
    this.etag = etag;
    this.failures = 0;
    if (map) this.latest = map;
    this.status = 'pending';
    if (this.latest) this.arm(0);
    else this.setStatus('saved');
  }

  dispose(): void {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  /** Drop pending changes and the local draft, e.g. after loading the newer server version. */
  discard(etag: string, mapId: string): void {
    this.dispose();
    this.etag = etag;
    this.latest = null;
    this.failures = 0;
    try {
      this.deps.storage.removeItem(draftKey(mapId));
    } catch {
      // ignore
    }
    this.setStatus('saved');
  }

  private arm(ms: number) {
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.run();
    }, ms);
  }

  private async run(): Promise<void> {
    if (this.inFlight || !this.latest) return;
    const map = this.latest;
    this.inFlight = true;
    this.setStatus('saving');
    try {
      const saved = await this.deps.save(map, this.etag);
      this.etag = saved.etag;
      this.failures = 0;
      if (this.latest === map) {
        this.latest = null;
        try {
          this.deps.storage.removeItem(draftKey(map.id));
        } catch {
          // ignore
        }
        this.setStatus('saved');
      } else {
        this.setStatus('pending'); // edits arrived while saving
        this.arm(SAVE_DELAY_MS);
      }
      this.onSaved(saved);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) this.setStatus('conflict');
      else if (e instanceof ApiError && e.status === 401) this.setStatus('unauthorized');
      else {
        this.failures += 1;
        this.setStatus('retrying');
        this.arm(Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.failures));
      }
    } finally {
      this.inFlight = false;
    }
  }

  private setStatus(status: SaveStatus) {
    if (status === this.status) return;
    this.status = status;
    this.onStatus(status);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor/autosave.test.ts && npm run typecheck`
Expected: 7 tests pass and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/autosave.ts src/editor/autosave.test.ts
git commit -m "feat(editor): autosave with 1 s debounce, backoff retry, conflict stop and local draft"
```

---

### Task 12: Keyboard commands, arrow navigation and zoom math

**Files:**
- Create: `src/editor/keymap.ts`, `src/editor/navigate.ts`, `src/editor/viewport.ts`
- Test: `src/editor/keymap.test.ts`, `src/editor/navigate.test.ts`, `src/editor/viewport.test.ts`

**Interfaces:**
- Consumes: `MapLayout` and `Bounds` (Task 5)
- Produces:
  - `type Direction = 'up'|'down'|'left'|'right'`
  - `type Command` — one of `addChild`, `addSibling`, `delete`, `edit` (with optional `initial` character), `fold`, `undo`, `redo`, or `navigate` (with a `dir`)
  - `keyToCommand(e: KeyInput): Command | null`
  - `navigate(layout, fromId, dir): string | null`
  - `interface View { tx; ty; k }`, `MIN_ZOOM = 0.2` and `MAX_ZOOM = 3`
  - `fitView(bounds, width, height, opts?)`, `zoomAt(view, factor, sx, sy)` and `toScreen(view, x, y)`
  - `ensureVisible(view, box, width, height, margin?)`

- [ ] **Step 1: Write the failing tests**

`src/editor/keymap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { keyToCommand, type KeyInput } from './keymap';

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });

describe('keyToCommand', () => {
  it.each([
    [k('Tab'), { type: 'addChild' }],
    [k('Enter'), { type: 'addSibling' }],
    [k('Delete'), { type: 'delete' }],
    [k('Backspace'), { type: 'delete' }],
    [k(' '), { type: 'edit' }],
    [k('F2'), { type: 'edit' }],
    [k('/'), { type: 'fold' }],
    [k('/', { metaKey: true }), { type: 'fold' }],
    [k('z', { metaKey: true }), { type: 'undo' }],
    [k('z', { ctrlKey: true }), { type: 'undo' }],
    [k('Z', { metaKey: true, shiftKey: true }), { type: 'redo' }],
    [k('y', { ctrlKey: true }), { type: 'redo' }],
    [k('ArrowLeft'), { type: 'navigate', dir: 'left' }],
    [k('ArrowDown'), { type: 'navigate', dir: 'down' }],
    [k('q'), { type: 'edit', initial: 'q' }],
  ])('%o → %o', (input, expected) => {
    expect(keyToCommand(input)).toEqual(expected);
  });

  it('ignores IME composition, Alt combos, Shift+Tab and unknown keys', () => {
    expect(keyToCommand(k('Process', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('a', { isComposing: true }))).toBeNull();
    expect(keyToCommand(k('ArrowUp', { altKey: true }))).toBeNull();
    expect(keyToCommand(k('Tab', { shiftKey: true }))).toBeNull();
    expect(keyToCommand(k('Escape'))).toBeNull();
    expect(keyToCommand(k('c', { metaKey: true }))).toBeNull();
  });
});
```

`src/editor/navigate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { navigate } from './navigate';

const measure = (t: string, size: number) => t.length * size * 0.5;
const n = (id: string, children: MapNode[] = []): MapNode => ({ id, text: id.toUpperCase(), children });
// right: a (a1, a2); left: b
const layout = computeLayout(n('root', [n('a', [n('a1'), n('a2')]), n('b')]), measure);

describe('navigate', () => {
  it('moves outward, inward and between siblings by position', () => {
    expect(navigate(layout, 'root', 'right')).toBe('a');
    expect(navigate(layout, 'root', 'left')).toBe('b');
    expect(navigate(layout, 'a', 'right')).toBe('a1');
    expect(navigate(layout, 'a1', 'down')).toBe('a2');
    expect(navigate(layout, 'a2', 'up')).toBe('a1');
    expect(navigate(layout, 'a1', 'left')).toBe('a');
  });
  it('returns null when nothing lies in that direction', () => {
    expect(navigate(layout, 'b', 'left')).toBeNull();
    expect(navigate(layout, 'missing', 'left')).toBeNull();
  });
});
```

`src/editor/viewport.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/keymap.test.ts src/editor/navigate.test.ts src/editor/viewport.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/editor/keymap.ts`:

```ts
export type Direction = 'up' | 'down' | 'left' | 'right';

export type Command =
  | { type: 'addChild' }
  | { type: 'addSibling' }
  | { type: 'delete' }
  | { type: 'edit'; initial?: string }
  | { type: 'fold' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'navigate'; dir: Direction };

export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Keys while a topic is selected and no text box is open. */
export function keyToCommand(e: KeyInput): Command | null {
  if (e.isComposing) return null;
  if (e.metaKey || e.ctrlKey) {
    const key = e.key.toLowerCase();
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y') return { type: 'redo' };
    if (e.key === '/') return { type: 'fold' };
    return null;
  }
  if (e.altKey) return null;
  if (e.key in ARROWS) return { type: 'navigate', dir: ARROWS[e.key] };
  switch (e.key) {
    case 'Tab':
      return e.shiftKey ? null : { type: 'addChild' };
    case 'Enter':
      return { type: 'addSibling' };
    case 'Delete':
    case 'Backspace':
      return { type: 'delete' };
    case ' ':
    case 'F2':
      return { type: 'edit' };
    case '/':
      return { type: 'fold' };
  }
  return e.key.length === 1 ? { type: 'edit', initial: e.key } : null;
}
```

`src/editor/navigate.ts`:

```ts
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
```

`src/editor/viewport.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: every editor test passes (store 8, autosave 7, keymap 16, navigate 2, viewport 4) and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/keymap.ts src/editor/navigate.ts src/editor/viewport.ts src/editor/*.test.ts
git commit -m "feat(editor): key commands, spatial navigation and viewport math"
```

---

### Task 13: Canvas and inline text editor components

**Files:**
- Create: `src/editor/Canvas.tsx`, `src/editor/InlineEditor.tsx`, `src/app.css`
- Test: `src/editor/Canvas.test.tsx`, `src/editor/InlineEditor.test.tsx`

**Interfaces:**
- Consumes:
  - `MapLayout` and `TopicBox` (Task 5)
  - `renderMap` and its markup contract (Task 9)
  - `View`, `fitView`, `zoomAt` and `ensureVisible` (Task 12)
  - `isInBranch` (Task 3)
- Produces:
  - `<Canvas>` with these props:
    - `layout`, `selectedId`, `interactive: boolean`
    - `onToggleFold(id)`, and optionally `onSelect(id)`, `onEdit(id)`, `onMove(id, targetId)`
    - optionally `onViewChange(view)`, `rightInset`, `fitMaxK`, and `ref`
  - `ref` exposes `CanvasHandle = { fit(); zoomBy(factor); view(): View; ensureVisible(id); svg(): SVGSVGElement | null }`
  - `<InlineEditor box view initialText selectAll onCommit(text) onCancel() onTab(text) />`
- Behaviour:
  - **Click** a topic to select it. **Two presses on the same topic within 420 ms** start editing; this is tracked by hand, because the SVG is redrawn between clicks, which breaks the browser's `dblclick`.
  - **Drag** more than 6 px to move a topic. The ghost copy lives in a separate overlay layer, so redraws don't remove it.
  - **Background:** drag to pan. ⌘/Ctrl + wheel zooms.
  - **Plain wheel:** pans in the editor (`interactive`); in the view it is left alone, so the Notion page scrolls.

- [ ] **Step 1: Write the failing tests**

`src/editor/InlineEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../layout/map';
import { InlineEditor } from './InlineEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const box = computeLayout({ id: 'r', text: 'Root', children: [] }, (t, s) => t.length * s * 0.5).byId.get('r')!;
let container: HTMLDivElement;

function mount(props: Partial<Parameters<typeof InlineEditor>[0]> = {}) {
  const handlers = { onCommit: vi.fn(), onCancel: vi.fn(), onTab: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<InlineEditor box={box} view={{ tx: 0, ty: 0, k: 1 }} initialText="Root" selectAll {...handlers} {...props} />));
  return { ta: container.querySelector('textarea')!, ...handlers };
}
function type(ta: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (ta: HTMLElement, init: KeyboardEventInit) => act(() => void ta.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));

afterEach(() => container.remove());

describe('InlineEditor', () => {
  it('focuses with the text selected and commits on Enter, once', () => {
    const t = mount();
    expect(document.activeElement).toBe(t.ta);
    type(t.ta, 'New text');
    key(t.ta, { key: 'Enter' });
    act(() => t.ta.blur());
    expect(t.onCommit).toHaveBeenCalledTimes(1);
    expect(t.onCommit).toHaveBeenCalledWith('New text');
  });
  it('keeps Shift+Enter as a line break, cancels on Escape and hands Tab over', () => {
    const t = mount();
    key(t.ta, { key: 'Enter', shiftKey: true });
    expect(t.onCommit).not.toHaveBeenCalled();
    key(t.ta, { key: 'Escape' });
    expect(t.onCancel).toHaveBeenCalledTimes(1);
    const u = mount();
    type(u.ta, 'Parent');
    key(u.ta, { key: 'Tab' });
    expect(u.onTab).toHaveBeenCalledWith('Parent');
  });
  it('ignores keys while an IME is composing', () => {
    const t = mount();
    key(t.ta, { key: 'Enter', isComposing: true });
    expect(t.onCommit).not.toHaveBeenCalled();
  });
  it('commits on blur', () => {
    const t = mount();
    act(() => t.ta.blur());
    expect(t.onCommit).toHaveBeenCalledWith('Root');
  });
});
```

`src/editor/Canvas.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapNode } from '../shared/types';
import { computeLayout } from '../layout/map';
import { Canvas } from './Canvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tree: MapNode = { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] };
const layout = computeLayout(tree, (t, s) => t.length * s * 0.5);
let container: HTMLDivElement;

function mount(interactive = true) {
  const h = { onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn() };
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Canvas layout={layout} selectedId={null} interactive={interactive} {...h} />));
  return h;
}
const press = (el: Element, type: string, x = 10, y = 10) =>
  act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })));
const hit = (id: string) => container.querySelector(`g.topic[data-id="${id}"] rect.hit`)!;

afterEach(() => container.remove());

describe('Canvas', () => {
  it('draws the map and selects a topic on press', () => {
    const h = mount();
    expect(container.querySelectorAll('g.topic')).toHaveLength(3);
    press(hit('a'), 'pointerdown');
    press(hit('a'), 'pointerup');
    expect(h.onSelect).toHaveBeenCalledWith('a');
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('opens the editor on a second press within 420 ms', () => {
    const h = mount();
    for (let i = 0; i < 2; i++) {
      press(hit('a1'), 'pointerdown');
      press(hit('a1'), 'pointerup');
    }
    expect(h.onEdit).toHaveBeenCalledWith('a1');
  });

  it('toggles a fold without selecting', () => {
    const h = mount();
    press(container.querySelector('[data-fold="a"] rect')!, 'pointerdown');
    expect(h.onToggleFold).toHaveBeenCalledWith('a');
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it('pans when dragging the background', () => {
    mount();
    const svg = container.querySelector('svg')!;
    const world = container.querySelector('g.world')!;
    press(svg, 'pointerdown', 100, 100);
    press(svg, 'pointermove', 140, 130);
    press(svg, 'pointerup', 140, 130);
    expect(world.getAttribute('transform')).toBe('translate(40 30) scale(1)');
  });

  it('does not select topics in view-only mode, but still folds', () => {
    const h = mount(false);
    press(hit('a'), 'pointerdown');
    expect(h.onSelect).not.toHaveBeenCalled();
    press(container.querySelector('[data-fold="a"] rect')!, 'pointerdown');
    expect(h.onToggleFold).toHaveBeenCalledWith('a');
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/editor/Canvas.test.tsx src/editor/InlineEditor.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/editor/InlineEditor.tsx`:

```tsx
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { TopicBox } from '../layout/map';
import type { View } from './viewport';

interface Props {
  box: TopicBox;
  view: View;
  initialText: string;
  selectAll: boolean;
  onCommit(text: string): void;
  onCancel(): void;
  onTab(text: string): void;
}

export function InlineEditor({ box, view, initialText, selectAll, onCommit, onCancel, onTab }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initialText);
  const done = useRef(false);

  useLayoutEffect(() => {
    const ta = ref.current!;
    ta.focus();
    if (selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [selectAll]);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  const { fontSize, lineHeight, padX, padY, kind } = box.style;
  const k = view.k;
  const width = Math.max(box.w * k, 140);
  const lines = Math.max(1, value.split('\n').length);
  const style: CSSProperties = {
    left: view.tx + box.x * k + (kind === 'line' ? 0 : (box.w * k - width) / 2),
    top: view.ty + box.y * k,
    width,
    minHeight: box.h * k,
    height: lines * lineHeight * k + padY * 2 * k + 4,
    fontSize: fontSize * k,
    lineHeight: `${lineHeight * k}px`,
    padding: `${padY * k}px ${padX * k}px`,
    textAlign: kind === 'line' ? 'left' : 'center',
  };

  return (
    <textarea
      ref={ref}
      className="inline-editor"
      aria-label="Topic text"
      placeholder="Topic"
      spellCheck={false}
      value={value}
      style={style}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          finish(() => onCommit(value));
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(onCancel);
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(() => onTab(value));
        }
      }}
      onBlur={() => finish(() => onCommit(value))}
    />
  );
}
```

`src/editor/Canvas.tsx`:

```tsx
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent, type Ref } from 'react';
import type { MapLayout } from '../layout/map';
import { isInBranch } from '../model/tree';
import { renderMap } from '../render/renderMap';
import { ensureVisible, fitView, zoomAt, type View } from './viewport';

export interface CanvasHandle {
  fit(): void;
  zoomBy(factor: number): void;
  view(): View;
  ensureVisible(id: string): void;
  svg(): SVGSVGElement | null;
}

interface Props {
  layout: MapLayout;
  selectedId: string | null;
  interactive: boolean;
  onToggleFold(id: string): void;
  onSelect?(id: string): void;
  onEdit?(id: string): void;
  onMove?(id: string, targetId: string): void;
  onViewChange?(view: View): void;
  rightInset?: number;
  fitMaxK?: number;
  ref?: Ref<CanvasHandle>;
}

type Gesture =
  | { kind: 'pan'; x: number; y: number; tx: number; ty: number }
  | { kind: 'topic'; id: string; x: number; y: number; moved: boolean; dbl: boolean; ghost: SVGGElement | null };

export function Canvas({ layout, selectedId, interactive, onToggleFold, onSelect, onEdit, onMove, onViewChange, rightInset = 0, fitMaxK, ref }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const viewRef = useRef<View>({ tx: 0, ty: 0, k: 1 });
  const fitted = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const lastDown = useRef({ id: '', t: 0 });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dropRef = useRef<string | null>(null);

  const size = (): [number, number] => {
    const r = svgRef.current?.getBoundingClientRect();
    return [r?.width ?? 0, r?.height ?? 0];
  };
  const applyView = (v: View) => {
    viewRef.current = v;
    const t = `translate(${v.tx} ${v.ty}) scale(${v.k})`;
    worldRef.current?.setAttribute('transform', t);
    overlayRef.current?.setAttribute('transform', t);
    onViewChange?.(v);
  };
  const fit = () => {
    const [w, h] = size();
    if (w > 0) applyView(fitView(layout.bounds, w, h, { rightInset, maxK: fitMaxK }));
  };

  useLayoutEffect(() => {
    renderMap(svgRef.current!, worldRef.current!, layout, { selectedId, dropTargetId: dropTarget });
    if (!fitted.current && size()[0] > 0) {
      fitted.current = true;
      fit();
    } else {
      applyView(viewRef.current);
    }
  }, [layout, selectedId, dropTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (factor) => {
      const [w, h] = size();
      applyView(zoomAt(viewRef.current, factor, w / 2, h / 2));
    },
    view: () => viewRef.current,
    ensureVisible: (id) => {
      const b = layout.byId.get(id);
      const [w, h] = size();
      if (b && w > 0) applyView(ensureVisible(viewRef.current, b, w, h));
    },
    svg: () => svgRef.current,
  }));

  // Wheel needs a non-passive listener so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        applyView(zoomAt(viewRef.current, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
      } else if (interactive) {
        e.preventDefault();
        applyView({ ...viewRef.current, tx: viewRef.current.tx - e.deltaX, ty: viewRef.current.ty - e.deltaY });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [interactive]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDrop = (id: string | null) => {
    if (dropRef.current !== id) {
      dropRef.current = id;
      setDropTarget(id);
    }
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const fold = target.closest('[data-fold]');
    if (fold) {
      onToggleFold(fold.getAttribute('data-fold')!);
      return;
    }
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const topic = interactive ? target.closest('g.topic') : null;
    if (!topic) {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
      return;
    }
    const id = topic.getAttribute('data-id')!;
    const now = Date.now();
    const dbl = lastDown.current.id === id && now - lastDown.current.t < 420;
    lastDown.current = { id, t: dbl ? 0 : now };
    onSelect?.(id);
    gesture.current = { kind: 'topic', id, x: e.clientX, y: e.clientY, moved: false, dbl, ghost: null };
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.kind === 'pan') {
      applyView({ ...viewRef.current, tx: g.tx + dx, ty: g.ty + dy });
      return;
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) < 6 || layout.byId.get(g.id)?.parentId == null) return;
      g.moved = true;
      const source = worldRef.current?.querySelector(`g.topic[data-id="${g.id}"]`);
      if (source) {
        g.ghost = source.cloneNode(true) as SVGGElement;
        g.ghost.setAttribute('opacity', '0.55');
        g.ghost.style.pointerEvents = 'none';
        overlayRef.current?.appendChild(g.ghost);
      }
    }
    g.ghost?.setAttribute('transform', `translate(${dx / viewRef.current.k} ${dy / viewRef.current.k})`);
    const under = document.elementFromPoint?.(e.clientX, e.clientY)?.closest('g.topic');
    const tid = under?.getAttribute('data-id') ?? null;
    const moving = layout.byId.get(g.id)!.node;
    setDrop(tid && tid !== g.id && !isInBranch(moving, tid) ? tid : null);
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.kind !== 'topic') return;
    if (g.moved) {
      g.ghost?.remove();
      const target = dropRef.current;
      setDrop(null);
      if (target) onMove?.(g.id, target);
    } else if (g.dbl) {
      onEdit?.(g.id);
    }
  };

  return (
    <div className="canvas">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Mind map"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g ref={worldRef} className="world" />
        <g ref={overlayRef} className="overlay" />
      </svg>
    </div>
  );
}
```

`src/app.css` (the canvas and editor part; Tasks 14–16 append to it):

```css
:root {
  --paper: #fbfaf6; --surface: #ffffff; --surface-2: #f4f2ec; --ink: #1e1e1e; --ink-2: #5f5b53; --line: #e3e0d8;
  --accent: #3b5bdb; --accent-ink: #ffffff; --accent-soft: #e9edff; --dots: #dedad0; --warn: #c2410c;
  --shadow: 0 1px 2px rgba(40, 36, 28, 0.06), 0 8px 24px rgba(40, 36, 28, 0.08);
  --canvas-filter: none;
  --hand: "Excalifont", "Xiaolai", "Segoe UI Emoji", "Apple Color Emoji", sans-serif;
  --ui: system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #151517; --surface: #1e1e21; --surface-2: #26262a; --ink: #ebe8e2; --ink-2: #a8a49b; --line: #34343a;
    --accent: #9fb1ff; --accent-ink: #11131c; --accent-soft: #252b45; --dots: #2b2b30; --warn: #fb923c;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.45), 0 10px 28px rgba(0, 0, 0, 0.4);
    --canvas-filter: invert(93%) hue-rotate(180deg);
    color-scheme: dark;
  }
}
html, body, #root { height: 100%; margin: 0; }
body { background: var(--paper); color: var(--ink); font-family: var(--ui); font-size: 14px; }
.canvas {
  position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none;
  background-color: var(--paper); background-image: radial-gradient(var(--dots) 1px, transparent 1.3px); background-size: 22px 22px;
}
.canvas svg { width: 100%; height: 100%; display: block; filter: var(--canvas-filter); user-select: none; -webkit-user-select: none; }
.canvas .topic { cursor: pointer; }
.canvas .topic.drop .hit { stroke: #4263eb; stroke-width: 2.5; stroke-dasharray: 5 5; }
.canvas .fold { cursor: pointer; }
.canvas .fold:not(.folded) { opacity: 0; transition: opacity 0.12s; }
.canvas .topic:hover .fold, .canvas .topic.selected .fold { opacity: 1; }
.inline-editor {
  position: absolute; z-index: 4; box-sizing: border-box; margin: 0; resize: none; overflow: hidden; outline: none;
  border: 1.5px dashed var(--accent); border-radius: 6px; background: var(--surface); color: var(--ink);
  font-family: var(--hand); box-shadow: var(--shadow);
}
@media (prefers-reduced-motion: reduce) { .canvas .fold:not(.folded) { transition: none; } }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: every editor test passes, including 4 InlineEditor and 5 Canvas tests, and typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add src/editor/Canvas.tsx src/editor/InlineEditor.tsx src/editor/Canvas.test.tsx src/editor/InlineEditor.test.tsx src/app.css
git commit -m "feat(editor): SVG canvas with select, double-press edit, drag-to-move, pan/zoom; inline editor"
```

---

### Task 14: The editor page (`/e/:id`)

**Files:**
- Create: `src/editor/EditorChrome.tsx`, `src/editor/EditorPage.tsx`
- Modify: `src/app.css` (append)
- Test: `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Consumes everything from Tasks 3–13.
- Produces:
  - `EditorPage({ id })` — the route component. It asks for the owner key if missing, loads the map, then shows the editor.
  - `Editor({ initial, etag, api, measureFactory?, storage? })`, exported for tests
  - from `EditorChrome.tsx`: `SaveBadge`, `Toolbar`, `ConflictDialog`, `DraftBanner` and `STATUS_TEXT`
- Behaviour (spec §4, §10):
  - Keyboard shortcuts are listened for on `window`. They are ignored while a text box, button, link or dialog has focus.
  - Every user change is autosaved. The save badge shows `Saved`, `Saving…`, `Not saved, retrying`, or a conflict or key problem.
  - A local draft that differs from the server copy shows a "Restore / Discard" banner.
  - A 409 shows a dialog: "Load the newer version" or "Keep mine and overwrite".
  - A 401 asks for the owner key again, then resumes saving.
  - "Copy Notion embed link" copies `https://<host>/m/<id>`.

- [ ] **Step 1: Write the failing test**

`src/editor/EditorPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiClient } from '../api/client';
import type { MindMap } from '../shared/types';
import { draftKey } from './autosave';
import { Editor } from './EditorPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const map: MindMap = { id: 'abcdefghijklmnopqrstu', title: 'Root', layout: 'map', version: 1, updatedAt: 't', root: { id: 'root000001', text: 'Root', children: [] } };
const measure = () => (t: string, s: number) => t.length * s * 0.5;
let container: HTMLDivElement;

function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listMaps: vi.fn(), createMap: vi.fn(), deleteMap: vi.fn(),
    getMap: vi.fn(async () => ({ map, etag: '"server"' })),
    saveMap: vi.fn(async (m: MindMap) => ({ map: { ...m, version: m.version + 1, title: m.root.text }, etag: '"e2"' })),
    ...overrides,
  };
}
function mount(api: ApiClient) {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Editor initial={map} etag='"e1"' api={api} measureFactory={measure} />));
}
const keydown = (init: KeyboardEventInit, target: EventTarget = window) =>
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
function type(ta: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const topics = () => container.querySelectorAll('g.topic').length;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const click = (text: string) => act(async () => {
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!.click();
  await vi.advanceTimersByTimeAsync(0); // let the async handler finish
});

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { container.remove(); vi.useRealTimers(); });

describe('Editor', () => {
  it('Tab adds a child, typing + Enter names it, and it autosaves 1 s later', async () => {
    const api = fakeApi();
    mount(api);
    keydown({ key: 'Tab' });
    const ta = container.querySelector('textarea.inline-editor') as HTMLTextAreaElement;
    type(ta, 'Child');
    keydown({ key: 'Enter' }, ta);
    expect(topics()).toBe(2);
    await advance(1000);
    expect(api.saveMap).toHaveBeenCalledTimes(1);
    const [saved, etag] = vi.mocked(api.saveMap).mock.calls[0];
    expect([saved.root.children[0].text, etag]).toEqual(['Child', '"e1"']);
    expect(container.querySelector('[data-testid="save-status"]')!.textContent).toBe('Saved');
  });

  it('Delete removes the selected topic and ⌘Z brings it back', async () => {
    mount(fakeApi());
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Temp');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    keydown({ key: 'Delete' });
    expect(topics()).toBe(1);
    keydown({ key: 'z', metaKey: true });
    expect(topics()).toBe(2);
  });

  it('on a conflict, "Load the newer version" replaces the map and stops saving mine', async () => {
    const api = fakeApi({ saveMap: vi.fn(async () => { throw new ApiError(409, 'changed', '"x"'); }) });
    mount(api);
    keydown({ key: 'Tab' });
    type(container.querySelector('textarea')!, 'Mine');
    keydown({ key: 'Enter' }, container.querySelector('textarea')!);
    await advance(1000);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await click('Load the newer version');
    expect(api.getMap).toHaveBeenCalledWith(map.id);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(topics()).toBe(1);
    await advance(5000);
    expect(api.saveMap).toHaveBeenCalledTimes(1);
  });

  it('offers to restore a local draft that differs from the server copy', async () => {
    const draftMap = { ...map, root: { ...map.root, children: [{ id: 'draft00001', text: 'From draft', children: [] }] } };
    localStorage.setItem(draftKey(map.id), JSON.stringify({ map: draftMap, etag: '"old"', savedAt: 1 }));
    const api = fakeApi();
    mount(api);
    expect(container.textContent).toContain('unsaved changes');
    await click('Restore');
    expect(topics()).toBe(2);
    await advance(1000);
    expect(vi.mocked(api.saveMap).mock.calls[0][0].root.children[0].text).toBe('From draft');
    expect(vi.mocked(api.saveMap).mock.calls[0][1]).toBe('"e1"');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/editor/EditorPage.test.tsx`
Expected: FAIL, "Cannot find module './EditorPage'".

- [ ] **Step 3: Implement the chrome**

`src/editor/EditorChrome.tsx`:

```tsx
import type { MouseEvent, ReactNode } from 'react';
import type { SaveStatus } from './autosave';

export const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Saving…',
  saving: 'Saving…',
  retrying: 'Not saved, retrying',
  conflict: 'Not saved: conflict',
  unauthorized: 'Not saved: owner key needed',
};

export function SaveBadge({ status }: { status: SaveStatus }) {
  return (
    <span className={`save-badge ${status}`} data-testid="save-status" role="status">
      {STATUS_TEXT[status]}
    </span>
  );
}

// Buttons don't take focus on mouse click, so keyboard shortcuts keep working afterwards.
const noFocus = (e: MouseEvent) => e.preventDefault();

export interface ToolbarProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  canDelete: boolean;
  onAddChild(): void;
  onAddSibling(): void;
  onDelete(): void;
  onUndo(): void;
  onRedo(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onFit(): void;
  extra?: ReactNode;
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div className="float toolbar" role="toolbar" aria-label="Map tools">
      <button type="button" onMouseDown={noFocus} onClick={p.onAddChild} title="Add child topic (Tab)">+ Child</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onAddSibling} title="Add sibling topic (Enter)">+ Sibling</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onDelete} disabled={!p.canDelete} title="Delete topic (Delete)">Delete</button>
      <span className="sep" />
      <button type="button" onMouseDown={noFocus} onClick={p.onUndo} disabled={!p.canUndo} title="Undo (⌘/Ctrl Z)">Undo</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onRedo} disabled={!p.canRedo} title="Redo (⌘/Ctrl Shift Z)">Redo</button>
      <span className="sep" />
      <button type="button" onMouseDown={noFocus} onClick={p.onZoomOut} aria-label="Zoom out">−</button>
      <span className="zoom">{Math.round(p.zoom * 100)}%</span>
      <button type="button" onMouseDown={noFocus} onClick={p.onZoomIn} aria-label="Zoom in">+</button>
      <button type="button" onMouseDown={noFocus} onClick={p.onFit}>Fit</button>
      {p.extra}
    </div>
  );
}

export function ConflictDialog({ onLoadNewer, onKeepMine, error }: { onLoadNewer(): void; onKeepMine(): void; error?: string }) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <h2 id="conflict-title">This map changed somewhere else</h2>
        <p>Another tab or device saved a newer version after you opened this one. Your latest changes are kept in this browser until you choose.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button type="button" className="primary" onClick={onLoadNewer}>Load the newer version</button>
        <button type="button" onClick={onKeepMine}>Keep mine and overwrite</button>
      </div>
    </div>
  );
}

export function DraftBanner({ savedAt, onRestore, onDiscard }: { savedAt: number; onRestore(): void; onDiscard(): void }) {
  return (
    <div className="banner" role="status">
      <span>This browser has unsaved changes from {new Date(savedAt).toLocaleString()}.</span>
      <button type="button" onClick={onRestore}>Restore</button>
      <button type="button" onClick={onDiscard}>Discard</button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the page**

`src/editor/EditorPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError, createApi, type ApiClient } from '../api/client';
import { KeyPrompt } from '../auth/KeyPrompt';
import { getOwnerKey, setOwnerKey } from '../auth/ownerKey';
import { computeLayout } from '../layout/map';
import type { Measure } from '../layout/wrap';
import { allText } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import type { MindMap } from '../shared/types';
import { Autosaver, draftKey, readDraft, type Draft, type SaveStatus } from './autosave';
import { Canvas, type CanvasHandle } from './Canvas';
import { ConflictDialog, DraftBanner, SaveBadge, Toolbar } from './EditorChrome';
import { InlineEditor } from './InlineEditor';
import { keyToCommand, type Command } from './keymap';
import { navigate } from './navigate';
import { editorReducer, initEditor } from './store';
import type { View } from './viewport';

const IGNORE_KEYS_IN = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

export interface EditorProps {
  initial: MindMap;
  etag: string;
  api: ApiClient;
  measureFactory?: () => Measure;
  storage?: Storage;
}

export function Editor({ initial, etag, api, measureFactory = canvasMeasure, storage = localStorage }: EditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initial, initEditor);
  const factory = useRef(measureFactory);
  const [measure, setMeasure] = useState<Measure>(() => factory.current());
  const layout = useMemo(() => computeLayout(state.map.root, measure), [state.map.root, measure]);
  const canvas = useRef<CanvasHandle>(null);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 });
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [conflict, setConflict] = useState(false);
  const [dialogError, setDialogError] = useState<string>();
  const [askKey, setAskKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editInitial, setEditInitial] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(() => {
    const d = readDraft(storage, initial.id);
    return d && JSON.stringify(d.map.root) !== JSON.stringify(initial.root) ? d : null;
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const statusRef = useRef(status);
  statusRef.current = status;
  const modalRef = useRef(false);
  modalRef.current = conflict || askKey;

  const saver = useMemo(
    () =>
      new Autosaver(
        {
          save: (m, e) => api.saveMap(m, e),
          storage,
          setTimer: (fn, ms) => window.setTimeout(fn, ms),
          clearTimer: (h) => window.clearTimeout(h as number),
          now: () => Date.now(),
        },
        etag,
        (s) => {
          setStatus(s);
          if (s === 'conflict') setConflict(true);
          if (s === 'unauthorized') setAskKey(true);
        },
        (saved) => dispatch({ type: 'serverSaved', map: saved.map }),
      ),
    [api, etag, storage],
  );
  useEffect(() => () => saver.dispose(), [saver]);

  // Autosave every user change (server echoes don't bump `revision`).
  const lastRevision = useRef(state.revision);
  useEffect(() => {
    if (state.revision === lastRevision.current) return;
    lastRevision.current = state.revision;
    saver.schedule(state.map);
  }, [state.revision, state.map, saver]);

  // Try to save when the tab is hidden or closed; warn if something is still unsaved.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (statusRef.current === 'saved') return;
      void saver.flush();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [saver]);

  // Load font subsets when new characters appear, then measure again with the real font.
  const chars = useMemo(() => [...new Set(allText(state.map.root))].sort().join(''), [state.map.root]);
  useEffect(() => {
    let alive = true;
    void ensureFonts(chars).then(() => {
      if (alive) setMeasure(() => factory.current());
    });
    return () => {
      alive = false;
    };
  }, [chars]);

  useEffect(() => {
    canvas.current?.ensureVisible(state.selectedId);
  }, [state.selectedId, layout]);

  useEffect(() => {
    document.title = `${state.map.title || 'Untitled map'} · Sketchmap`;
  }, [state.map.title]);

  const run = useCallback((cmd: Command) => {
    const s = stateRef.current;
    switch (cmd.type) {
      case 'edit':
        setEditInitial(cmd.initial ?? null);
        dispatch({ type: 'startEdit' });
        return;
      case 'fold':
        dispatch({ type: 'toggleFold' });
        return;
      case 'navigate': {
        const id = navigate(layoutRef.current, s.selectedId, cmd.dir);
        if (id) dispatch({ type: 'select', id });
        return;
      }
      default:
        dispatch({ type: cmd.type });
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stateRef.current.editing || modalRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (IGNORE_KEYS_IN.has(t.tagName) || t.isContentEditable)) return;
      const cmd = keyToCommand(e);
      if (!cmd) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const commit = (text: string) => {
    setEditInitial(null);
    dispatch({ type: 'commitEdit', text });
  };
  const cancel = () => {
    setEditInitial(null);
    dispatch({ type: 'cancelEdit' });
  };
  const tab = (text: string) => {
    commit(text);
    dispatch({ type: 'addChild' });
  };

  const loadNewer = async () => {
    try {
      const fresh = await api.getMap(initial.id);
      dispatch({ type: 'replaceMap', map: fresh.map, dirty: false });
      saver.discard(fresh.etag, initial.id);
      setConflict(false);
      setDialogError(undefined);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    }
  };
  const keepMine = async () => {
    try {
      const fresh = await api.getMap(initial.id);
      saver.resume(fresh.etag, stateRef.current.map);
      setConflict(false);
      setDialogError(undefined);
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : String(e));
    }
  };
  const restoreDraft = () => {
    if (!draft) return;
    dispatch({ type: 'replaceMap', map: { ...draft.map, id: initial.id }, dirty: true });
    setDraft(null);
  };
  const discardDraft = () => {
    storage.removeItem(draftKey(initial.id));
    setDraft(null);
  };
  const copyLink = () => {
    const url = `${location.origin}/m/${initial.id}`;
    navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => window.prompt('Copy this link into a Notion /embed block:', url),
    );
  };

  const editing = state.editing;
  const editBox = editing ? layout.byId.get(editing.id) : undefined;

  return (
    <div className="editor">
      <header className="editor-bar">
        <a href="/">All maps</a>
        <h1 className="map-title">{state.map.title || 'Untitled map'}</h1>
        <SaveBadge status={status} />
        <button type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy Notion embed link'}</button>
        <a href={`/m/${initial.id}`} target="_blank" rel="noopener">Open view ↗</a>
      </header>
      {draft && <DraftBanner savedAt={draft.savedAt} onRestore={restoreDraft} onDiscard={discardDraft} />}
      <main className="editor-stage">
        <Canvas
          ref={canvas}
          layout={layout}
          selectedId={state.selectedId}
          interactive
          onSelect={(id) => dispatch({ type: 'select', id })}
          onEdit={(id) => {
            setEditInitial(null);
            dispatch({ type: 'startEdit', id });
          }}
          onMove={(id, targetId) => dispatch({ type: 'move', id, targetId })}
          onToggleFold={(id) => dispatch({ type: 'toggleFold', id })}
          onViewChange={setView}
        />
        {editing && editBox && (
          <InlineEditor
            key={editing.id}
            box={editBox}
            view={view}
            initialText={editInitial ?? editBox.node.text}
            selectAll={editInitial === null}
            onCommit={commit}
            onCancel={cancel}
            onTab={tab}
          />
        )}
        <Toolbar
          zoom={view.k}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          canDelete={state.selectedId !== state.map.root.id}
          onAddChild={() => dispatch({ type: 'addChild' })}
          onAddSibling={() => dispatch({ type: 'addSibling' })}
          onDelete={() => dispatch({ type: 'delete' })}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onZoomIn={() => canvas.current?.zoomBy(1.2)}
          onZoomOut={() => canvas.current?.zoomBy(1 / 1.2)}
          onFit={() => canvas.current?.fit()}
        />
      </main>
      {conflict && <ConflictDialog onLoadNewer={loadNewer} onKeepMine={keepMine} error={dialogError} />}
      {askKey && (
        <div className="dialog-backdrop">
          <KeyPrompt
            error="The owner key was rejected. Enter it again to keep saving."
            onSubmit={(key) => {
              setOwnerKey(key);
              setAskKey(false);
              saver.resume(saver.currentEtag);
            }}
          />
        </div>
      )}
    </div>
  );
}

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; map: MindMap; etag: string };

export function EditorPage({ id }: { id: string }) {
  const api = useMemo(() => createApi(() => getOwnerKey()), []);
  const [hasKey, setHasKey] = useState(() => !!getOwnerKey());
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!hasKey) return;
    let alive = true;
    setLoad({ status: 'loading' });
    api.getMap(id).then(
      ({ map, etag }) => alive && setLoad({ status: 'ready', map, etag }),
      (e) => alive && setLoad(e instanceof ApiError && e.status === 404 ? { status: 'missing' } : { status: 'error', message: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, id, hasKey, attempt]);

  if (!hasKey) {
    return (
      <div className="center">
        <KeyPrompt
          onSubmit={(key) => {
            setOwnerKey(key);
            setHasKey(true);
          }}
        />
      </div>
    );
  }
  if (load.status === 'loading') return <p className="center muted">Loading…</p>;
  if (load.status === 'missing') return <div className="center"><p>This map doesn’t exist or was deleted. <a href="/">All maps</a></p></div>;
  if (load.status === 'error') {
    return (
      <div className="center">
        <p role="alert">Couldn’t load the map: {load.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  return <Editor initial={load.map} etag={load.etag} api={api} />;
}
```

- [ ] **Step 5: Append the editor styles to `src/app.css`**

```css
.editor { height: 100%; display: flex; flex-direction: column; }
.editor-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--surface); }
.editor-bar .map-title { font: 400 22px/1.2 var(--hand); margin: 0 auto 0 0; }
.editor-bar a, .editor-bar button, .float button, .banner button {
  font: 600 13px/1 var(--ui); color: var(--ink); background: none; border: 1px solid transparent; border-radius: 8px;
  padding: 8px 10px; cursor: pointer; text-decoration: none;
}
.editor-bar a:hover, .editor-bar button:hover, .float button:hover:not(:disabled), .banner button:hover { background: var(--surface-2); }
.save-badge { font-size: 12px; font-weight: 700; padding: 4px 8px; border-radius: 999px; background: var(--surface-2); color: var(--ink-2); }
.save-badge.retrying, .save-badge.conflict, .save-badge.unauthorized { color: var(--warn); }
.editor-stage { position: relative; flex: 1; min-height: 0; }
.float { position: absolute; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
.toolbar { left: 12px; bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 5px; max-width: calc(100% - 24px); }
.toolbar button:disabled { opacity: 0.4; cursor: default; }
.toolbar .sep { width: 1px; align-self: stretch; background: var(--line); margin: 4px 3px; }
.toolbar .zoom { font: 600 12px var(--ui); color: var(--ink-2); min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; }
.banner { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 8px 16px; background: var(--accent-soft); border-bottom: 1px solid var(--line); }
.dialog-backdrop { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(0, 0, 0, 0.35); z-index: 10; padding: 16px; }
.dialog, .key-prompt { background: var(--surface); color: var(--ink); border-radius: 14px; padding: 24px; max-width: 420px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 12px; }
.dialog h2, .key-prompt h1 { margin: 0; font-size: 18px; }
.key-prompt input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
.key-prompt button, .dialog button.primary { background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 8px; padding: 9px 12px; font-weight: 700; cursor: pointer; }
.dialog button:not(.primary) { background: none; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; color: var(--ink); cursor: pointer; }
.center { min-height: 100%; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
.muted { color: var(--ink-2); }
.error { color: var(--warn); }
button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: all editor tests pass, including the 4 new Editor tests, and typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add src/editor/EditorChrome.tsx src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/app.css
git commit -m "feat(editor): editor page with keyboard commands, autosave, conflict and draft handling"
```

---

### Task 15: The read-only view for Notion (`/m/:id`)

**Files:**
- Create: `src/view/ViewPage.tsx`
- Modify: `src/app.css` (append)
- Test: `src/view/ViewPage.test.tsx`

**Interfaces:**
- Consumes:
  - `Canvas` (Task 13), with `interactive={false}`
  - `createApi` (Task 10); this page sends no key
  - `computeLayout`, `ensureFonts` and `canvasMeasure`
- Produces:
  - `MapView({ map, measureFactory? })`
  - `ViewPage({ id })`
- Behaviour (spec §7):
  - The map is fitted to the frame (zoom at most 100%) and fitted again once fonts load and on resize.
  - Drag pans the map and ⌘/Ctrl + wheel zooms it. A plain wheel scrolls the Notion page.
  - Folding changes only this viewer's screen and is never saved.
  - A "View only" pill sits next to an "Edit in a tab ↗" link to `/e/:id` with `target="_blank"`.
  - A missing map shows "This map doesn’t exist or was deleted."

- [ ] **Step 1: Write the failing test**

`src/view/ViewPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MindMap } from '../shared/types';
import { MapView, ViewPage } from './ViewPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const map: MindMap = {
  id: 'abcdefghijklmnopqrstu', title: 'Plan', layout: 'map', version: 3, updatedAt: 't',
  root: { id: 'r', text: 'Plan', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
};
const measure = () => (t: string, s: number) => t.length * s * 0.5;
let container: HTMLDivElement;
const render = async (ui: ReactNode) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(ui));
};
const press = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));

afterEach(() => {
  container.remove();
  vi.unstubAllGlobals();
});

describe('MapView', () => {
  it('shows the map read-only with a View only pill and an edit link in a new tab', async () => {
    await render(<MapView map={map} measureFactory={measure} />);
    expect(container.querySelectorAll('g.topic')).toHaveLength(3);
    expect(container.textContent).toContain('View only');
    const link = container.querySelector('a.edit-link')!;
    expect([link.getAttribute('href'), link.getAttribute('target')]).toEqual([`/e/${map.id}`, '_blank']);
    press(container.querySelector('g.topic[data-id="a"] rect.hit')!);
    expect(container.querySelector('g.topic.selected')).toBeNull();
  });

  it('folds branches locally without touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await render(<MapView map={map} measureFactory={measure} />);
    press(container.querySelector('[data-fold="a"] rect')!);
    expect(container.querySelectorAll('g.topic')).toHaveLength(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('ViewPage', () => {
  it('loads the map without an owner key', async () => {
    const fetchSpy = vi.fn(async () => Response.json(map, { headers: { ETag: '"e"' } }));
    vi.stubGlobal('fetch', fetchSpy);
    await render(<ViewPage id={map.id} />);
    await act(async () => {});
    expect(container.querySelectorAll('g.topic').length).toBeGreaterThan(0);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('explains when a map does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Not found' }, { status: 404 })));
    await render(<ViewPage id={map.id} />);
    await act(async () => {});
    expect(container.textContent).toContain('This map doesn’t exist or was deleted.');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/view`
Expected: FAIL, "Cannot find module './ViewPage'".

- [ ] **Step 3: Implement**

`src/view/ViewPage.tsx`:

```tsx
import { produce } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { Canvas, type CanvasHandle } from '../editor/Canvas';
import { computeLayout } from '../layout/map';
import type { Measure } from '../layout/wrap';
import { allText, toggleCollapsed } from '../model/tree';
import { canvasMeasure, ensureFonts } from '../render/fonts';
import type { MindMap } from '../shared/types';

export function MapView({ map, measureFactory = canvasMeasure }: { map: MindMap; measureFactory?: () => Measure }) {
  const [local, setLocal] = useState(map); // folding only changes this viewer's screen
  useEffect(() => setLocal(map), [map]);
  const factory = useRef(measureFactory);
  const [measure, setMeasure] = useState<Measure>(() => factory.current());
  const [fontsReady, setFontsReady] = useState(false);
  const canvas = useRef<CanvasHandle>(null);
  const layout = useMemo(() => computeLayout(local.root, measure), [local.root, measure]);

  useEffect(() => {
    let alive = true;
    void ensureFonts(allText(map.root)).then(() => {
      if (!alive) return;
      setMeasure(() => factory.current());
      setFontsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [map]);

  useEffect(() => {
    if (fontsReady) canvas.current?.fit(); // real font widths are known now
  }, [fontsReady, layout]);

  useEffect(() => {
    const onResize = () => canvas.current?.fit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggle = (id: string) =>
    setLocal((m) =>
      produce(m, (d) => {
        toggleCollapsed(d.root, id);
      }),
    );

  return (
    <div className="view">
      <Canvas ref={canvas} layout={layout} selectedId={null} interactive={false} onToggleFold={toggle} fitMaxK={1} />
      <div className="view-bar">
        <span className="pill">View only</span>
        <a className="edit-link" href={`/e/${map.id}`} target="_blank" rel="noopener">Edit in a tab ↗</a>
      </div>
    </div>
  );
}

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; map: MindMap };

export function ViewPage({ id }: { id: string }) {
  const api = useMemo(() => createApi(() => null), []);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    api.getMap(id).then(
      ({ map }) => {
        if (!alive) return;
        document.title = `${map.title} · Sketchmap`;
        setLoad({ status: 'ready', map });
      },
      (e) => alive && setLoad(e instanceof ApiError && e.status === 404 ? { status: 'missing' } : { status: 'error', message: String(e?.message ?? e) }),
    );
    return () => {
      alive = false;
    };
  }, [api, id, attempt]);

  if (load.status === 'loading') return <p className="center muted">Loading map…</p>;
  if (load.status === 'missing') return <p className="center muted">This map doesn’t exist or was deleted.</p>;
  if (load.status === 'error') {
    return (
      <div className="center">
        <p role="alert">Couldn’t load the map: {load.message}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </div>
    );
  }
  return <MapView map={load.map} />;
}
```

- [ ] **Step 4: Append the view styles to `src/app.css`**

```css
.view { position: relative; height: 100%; }
.view-bar { position: absolute; right: 10px; top: 10px; display: flex; gap: 6px; align-items: center; }
.pill { font: 700 11px/1 var(--ui); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-2); background: var(--surface); border: 1px solid var(--line); border-radius: 999px; padding: 6px 9px; }
.edit-link { font: 700 13px/1 var(--ui); background: var(--accent); color: var(--accent-ink); border-radius: 8px; padding: 8px 10px; text-decoration: none; }
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/view && npm run typecheck`
Expected: 4 tests pass and typecheck is clean.

- [ ] **Step 6: Commit**

```bash
git add src/view src/app.css
git commit -m "feat(view): read-only map view for the Notion embed"
```

---

### Task 16: Map list, routing and app entry

**Files:**
- Create: `src/router.ts`, `src/list/ListPage.tsx`
- Modify: `src/main.tsx` (replace the whole file), `src/app.css` (append)
- Test: `src/router.test.ts`, `src/list/ListPage.test.tsx`

**Interfaces:**
- Consumes: `createApi`, `ApiError` (Task 10), the owner-key helpers and `KeyPrompt` (Task 10), `EditorPage` (Task 14), `ViewPage` (Task 15) and `installFontFaces` (Task 8)
- Produces:
  - `parseRoute(pathname): Route`, where `Route` is one of:
    - `{ name: 'list' }`
    - `{ name: 'editor'; id }`
    - `{ name: 'view'; id }`
    - `{ name: 'notFound' }`
  - `ListPage({ go? })`, where `go(url)` defaults to `location.assign`
- Behaviour:
  - Pages are lazy-loaded, so `/m/:id` never downloads the editor code.
  - The list page asks for the owner key, lists maps newest first, and creates a map, then opens it.
  - It copies the Notion embed link, and deletes a map only after an in-page "Delete for good?" confirmation (no `confirm()` dialogs).
  - The footer credits the fonts and links `/fonts/OFL.txt` (spec §6).

- [ ] **Step 1: Write the failing tests**

`src/router.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseRoute } from './router';

const id = 'abcdefghijklmnopqrstu';
describe('parseRoute', () => {
  it.each([
    ['/', { name: 'list' }],
    [`/e/${id}`, { name: 'editor', id }],
    [`/m/${id}`, { name: 'view', id }],
    [`/m/${id}/`, { name: 'view', id }],
    ['/m/short', { name: 'notFound' }],
    ['/x', { name: 'notFound' }],
  ])('%s', (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });
});
```

`src/list/ListPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ListPage } from './ListPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const id = 'abcdefghijklmnopqrstu';
let container: HTMLDivElement;
const render = async (go = vi.fn()) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => createRoot(container).render(<ListPage go={go} />));
  await act(async () => {});
  return go;
};
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
const click = (text: string) => act(async () => { button(text).click(); });

function stubApi() {
  const calls: Array<[string, string]> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push([method, url]);
    if (method === 'POST') return Response.json({ id, title: 'Central topic', layout: 'map', version: 1, updatedAt: 't', root: { id: 'r', text: 'Central topic', children: [] } }, { status: 201 });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return Response.json([{ id, title: 'Weekly plan', updatedAt: '2026-11-12T10:00:00.000Z' }]);
  }));
  return calls;
}

beforeEach(() => localStorage.clear());
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

describe('ListPage', () => {
  it('asks for the owner key first', async () => {
    stubApi();
    await render();
    expect(container.querySelector('#owner-key')).not.toBeNull();
  });

  it('lists maps and opens a new one after creating it', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    const go = await render();
    expect(container.textContent).toContain('Weekly plan');
    expect(container.querySelector(`a[href="/e/${id}"]`)).not.toBeNull();
    await click('New map');
    expect(calls).toContainEqual(['POST', '/api/maps']);
    expect(go).toHaveBeenCalledWith(`/e/${id}`);
  });

  it('deletes only after the in-page confirmation', async () => {
    localStorage.setItem('sketchmap:owner-key', 'k');
    const calls = stubApi();
    await render();
    await click('Delete…');
    expect(calls.some(([m]) => m === 'DELETE')).toBe(false);
    await click('Delete');
    expect(calls).toContainEqual(['DELETE', `/api/maps/${id}`]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/router.test.ts src/list`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/router.ts`:

```ts
export type Route = { name: 'list' } | { name: 'editor'; id: string } | { name: 'view'; id: string } | { name: 'notFound' };

export function parseRoute(pathname: string): Route {
  if (pathname === '/' || pathname === '') return { name: 'list' };
  const m = /^\/(e|m)\/([A-Za-z0-9_-]{21})\/?$/.exec(pathname);
  if (m) return { name: m[1] === 'e' ? 'editor' : 'view', id: m[2] };
  return { name: 'notFound' };
}
```

`src/list/ListPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, createApi } from '../api/client';
import { KeyPrompt } from '../auth/KeyPrompt';
import { clearOwnerKey, getOwnerKey, setOwnerKey } from '../auth/ownerKey';
import type { MapSummary } from '../shared/types';

export function ListPage({ go = (url: string) => location.assign(url) }: { go?: (url: string) => void }) {
  const api = useMemo(() => createApi(() => getOwnerKey()), []);
  const [hasKey, setHasKey] = useState(() => !!getOwnerKey());
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      clearOwnerKey();
      setHasKey(false);
      setError('That owner key was rejected. Check it and try again.');
    } else {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refresh = useCallback(() => {
    api.listMaps().then(setMaps, fail);
  }, [api, fail]);

  useEffect(() => {
    if (hasKey) refresh();
  }, [hasKey, refresh]);

  useEffect(() => {
    document.title = 'Your maps · Sketchmap';
  }, []);

  if (!hasKey) {
    return (
      <div className="center">
        <KeyPrompt
          error={error}
          onSubmit={(key) => {
            setOwnerKey(key);
            setError(undefined);
            setHasKey(true);
          }}
        />
      </div>
    );
  }

  const create = async () => {
    try {
      const { map } = await api.createMap();
      go(`/e/${map.id}`);
    } catch (e) {
      fail(e);
    }
  };
  const remove = async (id: string) => {
    try {
      await api.deleteMap(id);
      setConfirmId(null);
      refresh();
    } catch (e) {
      fail(e);
    }
  };
  const copy = (id: string) => {
    navigator.clipboard?.writeText(`${location.origin}/m/${id}`).then(() => setCopiedId(id), () => setError('Copy was blocked by the browser.'));
  };

  return (
    <div className="list">
      <header>
        <h1>Your maps</h1>
        <button type="button" className="primary" onClick={create}>New map</button>
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {maps === null ? (
        <p className="muted">Loading…</p>
      ) : maps.length === 0 ? (
        <p className="muted">No maps yet. Start one with “New map”.</p>
      ) : (
        <ul className="maps">
          {maps.map((m) => (
            <li key={m.id}>
              <a className="title" href={`/e/${m.id}`}>{m.title}</a>
              <span className="muted">{new Date(m.updatedAt).toLocaleString()}</span>
              <button type="button" onClick={() => copy(m.id)}>{copiedId === m.id ? 'Link copied' : 'Copy Notion embed link'}</button>
              {confirmId === m.id ? (
                <>
                  <span>Delete for good?</span>
                  <button type="button" className="danger" onClick={() => remove(m.id)}>Delete</button>
                  <button type="button" onClick={() => setConfirmId(null)}>Keep</button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmId(m.id)}>Delete…</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="muted credits">
        Handwriting fonts: Excalifont and Xiaolai, under the <a href="/fonts/OFL.txt">SIL Open Font License 1.1</a>.
      </footer>
    </div>
  );
}
```

`src/main.tsx` (whole file):

```tsx
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { installFontFaces } from './render/fonts';
import { parseRoute } from './router';
import './app.css';

const ListPage = lazy(() => import('./list/ListPage').then((m) => ({ default: m.ListPage })));
const EditorPage = lazy(() => import('./editor/EditorPage').then((m) => ({ default: m.EditorPage })));
const ViewPage = lazy(() => import('./view/ViewPage').then((m) => ({ default: m.ViewPage })));

installFontFaces();

function App() {
  const route = parseRoute(location.pathname);
  return (
    <Suspense fallback={<p className="center muted">Loading…</p>}>
      {route.name === 'list' && <ListPage />}
      {route.name === 'editor' && <EditorPage id={route.id} />}
      {route.name === 'view' && <ViewPage id={route.id} />}
      {route.name === 'notFound' && (
        <div className="center">
          <p>Page not found. <a href="/">All maps</a></p>
        </div>
      )}
    </Suspense>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Append the list styles to `src/app.css`**

```css
.list { max-width: 760px; margin: 0 auto; padding: 32px 16px; box-sizing: border-box; }
.list header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.list h1 { font: 400 34px/1.1 var(--hand); margin: 0; }
.maps { list-style: none; padding: 0; margin: 20px 0 0; display: flex; flex-direction: column; gap: 8px; }
.maps li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.maps .title { font: 400 20px/1.2 var(--hand); color: var(--ink); text-decoration: none; margin-right: auto; overflow-wrap: anywhere; }
.list button { font: 600 13px/1 var(--ui); border: 1px solid var(--line); background: var(--surface); color: var(--ink); border-radius: 8px; padding: 8px 10px; cursor: pointer; }
.list button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.list button.danger { color: var(--warn); }
.credits { margin-top: 32px; font-size: 12px; }
.credits a { color: inherit; }
```

- [ ] **Step 5: Run everything and try it in the browser**

```bash
npm test && npm run test:worker && npm run typecheck && npm run build
npm run dev
```

Expected: all unit and Worker tests pass, and the build succeeds. Then, with `npm run dev`:
1. Open the printed URL and enter `dev-owner-key` (from `.dev.vars`).
2. Click **New map**, press Tab and type, then Enter.
3. Watch the badge go `Saving…` → `Saved`, and reload: the topic is still there.
4. Open `/m/<id>` in another tab: it shows the map with "View only".

Note anything that doesn't match in the commit message, but do not commit broken behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/router.ts src/router.test.ts src/list src/main.tsx src/app.css
git commit -m "feat(app): map list, routing with lazy pages, app entry"
```

---

### Task 17: Export to SVG and PNG

**Files:**
- Create: `src/io/exportImage.ts`
- Modify: `src/editor/EditorPage.tsx` (add two toolbar buttons)
- Test: `src/io/exportImage.test.ts`

**Interfaces:**
- Consumes: `renderMap` (Task 9), `facesFor` (Task 8) and `MapLayout` (Task 5)
- Produces:
  - `bytesToBase64(bytes)` and `fontCssFor(text, fetchImpl?, base?): Promise<string>`
  - `buildSvg(layout, text, opts?): Promise<string>` — a standalone SVG embedding only the font subsets the text uses (spec §9)
  - `svgToPng(svgText, scale = 2): Promise<Blob>`
  - `download(blob, filename)` and `fileName(title, ext)`

- [ ] **Step 1: Write the failing test**

`src/io/exportImage.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { computeLayout } from '../layout/map';
import { buildSvg, bytesToBase64, fileName } from './exportImage';

const layout = computeLayout(
  { id: 'r', text: 'Root', children: [{ id: 'a', text: 'A', children: [{ id: 'a1', text: 'A1', children: [] }] }] },
  (t, s) => t.length * s * 0.5,
);

describe('export', () => {
  it('builds a standalone SVG with only the needed font subset embedded', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
    const svg = await buildSvg(layout, 'Root\nA\nA1', { fetchImpl });
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchImpl).mock.calls[0][0]).toMatch(/^\/fonts\/Excalifont\//);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('src:url(data:font/woff2;base64,AQID)');
    expect(svg.match(/class="topic"/g)).toHaveLength(3);
    expect(svg).not.toContain('class="hit"');
    const { x, y } = layout.bounds;
    expect(svg).toContain(`viewBox="${x - 40} ${y - 40} `);
  });

  it('fails clearly when a font file cannot be fetched', async () => {
    const fetchImpl = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(buildSvg(layout, 'Root', { fetchImpl })).rejects.toThrow(/Font .*404/);
  });

  it('encodes bytes and makes safe file names', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2]))).toBe('AAEC');
    expect(fileName('  Plan: Q4/Q1?  ', 'png')).toBe('Plan- Q4-Q1-.png');
    expect(fileName('   ', 'svg')).toBe('mindmap.svg');
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/io`
Expected: FAIL, "Cannot find module './exportImage'".

- [ ] **Step 3: Implement**

`src/io/exportImage.ts`:

```ts
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
```

- [ ] **Step 4: Add the buttons to the editor**

In `src/editor/EditorPage.tsx`:

1. Add the imports:

```ts
import { buildSvg, download, fileName, svgToPng } from '../io/exportImage';
```

2. Add this state next to the other `useState` calls:

```ts
  const [exportError, setExportError] = useState<string>();
```

3. Add this function next to `copyLink`:

```ts
  const exportAs = async (kind: 'svg' | 'png') => {
    try {
      setExportError(undefined);
      const svg = await buildSvg(layout, allText(state.map.root));
      const blob = kind === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      download(blob, fileName(state.map.title, kind));
    } catch (e) {
      setExportError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
```

4. Pass this prop to `<Toolbar … />`:

```tsx
          extra={
            <>
              <span className="sep" />
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('svg')}>SVG</button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exportAs('png')}>PNG</button>
            </>
          }
```

5. Directly under the `{draft && …}` line, add:

```tsx
      {exportError && <div className="banner" role="alert">{exportError}</div>}
```

- [ ] **Step 5: Run the tests, then check the files by eye**

Run: `npx vitest run src/io src/editor && npm run typecheck`
Expected: 3 export tests pass, the editor tests still pass, and typecheck is clean.

Then run `npm run dev`, open a map with a Chinese topic, and click **SVG** and **PNG**. Open both files: the text must be handwritten (Excalifont and Xiaolai), not a system font. If the PNG shows a system font, report it. It means the browser rasterised before the embedded fonts decoded; the fix would be to wait for `img.decode()` before drawing.

- [ ] **Step 6: Commit**

```bash
git add src/io src/editor/EditorPage.tsx
git commit -m "feat(io): SVG and PNG export with embedded font subsets"
```

---

### Task 18: End-to-end smoke test (Playwright)

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json` (add the `test:e2e` script), `tsconfig.app.json` (no change needed; `e2e/` is outside `src`)

**Interfaces:**
- Consumes: the whole app in `npm run dev` (Worker + local R2 in Miniflare, `OWNER_KEY` from `.dev.vars`)
- Produces: one browser test of the step-1 promise — create, edit, autosave, reload, and view inside a Notion-like sandboxed iframe

- [ ] **Step 1: Install Playwright and add the config**

```bash
npm i -D @playwright/test@1.65.0
npx playwright install chromium
```

Add to `package.json` `"scripts"`:

```json
"test:e2e": "playwright test"
```

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 2: Write the test**

`e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

// The same sandbox Notion puts on a generic /embed iframe (observed on a public notion.site page, 2026-11-12).
const NOTION_SANDBOX =
  'allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-storage-access-by-user-activation allow-popups-to-escape-sandbox';

test('create a map, edit it, reload it, and see it inside a Notion-like embed', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'New map' }).click();
  await page.waitForURL(/\/e\/[A-Za-z0-9_-]{21}$/);
  const id = page.url().split('/e/')[1];
  await expect(page.locator('g.topic')).toHaveCount(1);

  await page.locator('svg[aria-label="Mind map"]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Tab');
  await page.keyboard.type('First idea');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('中文也可以');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(3);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.locator('g.topic')).toHaveCount(3);
  await expect(page.locator('g.topic text', { hasText: '中文也可以' })).toBeVisible();

  await page.setContent(
    `<iframe src="http://localhost:5173/m/${id}" sandbox="${NOTION_SANDBOX}" style="width:900px;height:500px;border:0"></iframe>`,
  );
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('g.topic')).toHaveCount(3);
  await expect(frame.getByText('View only')).toBeVisible();
  await expect(frame.getByRole('link', { name: 'Edit in a tab ↗' })).toHaveAttribute('target', '_blank');
});
```

- [ ] **Step 3: Run it**

Run: `npm run test:e2e`
Expected: `1 passed`. If the iframe stays blank, open `http://localhost:5173/m/<id>` directly and check the browser console before changing any code.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e package.json package-lock.json
git commit -m "test(e2e): create-edit-reload-embed smoke test"
```

---

### Task 19: Deploy and check inside a real Notion page (with the owner)

This task needs the owner at the keyboard. Logging in to Cloudflare is interactive, and the Notion check is manual. An agent prepares the README and the commands, and the owner runs them. In Claude Code, the owner can run a command by typing `! <command>` in the prompt.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Sketchmap (working name)

XMind-style mindmaps with Excalidraw's hand-drawn look, embedded in Notion. Design: `docs/superpowers/specs/2026-11-12-sketchmap-design.md`.

## Run locally

```bash
npm install
echo "OWNER_KEY=dev-owner-key" > .dev.vars   # local-only secret
npm run dev                                  # opens on http://localhost:5173
```

Tests: `npm test` (unit), `npm run test:worker` (API on a local R2), `npm run test:e2e` (browser).

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler r2 bucket create sketchmap-maps
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"   # your owner key
npx wrangler secret put OWNER_KEY      # paste the key; keep it in your password manager
npm run deploy                         # prints https://sketchmap.<account>.workers.dev
```

## Put a map in Notion

1. Open the app, enter your owner key once, create a map.
2. Click **Copy Notion embed link** (it looks like `https://…/m/<id>`).
3. In Notion type `/embed`, paste the link, and drag the frame's edge to set its height.
4. Edit with **Edit in a tab ↗**. Notion shows your changes the next time the page loads.

The embed is view-only by design. Anyone who can see the Notion page, or who has the link, can view the map.
Only someone with the owner key can change it.

## Fonts

Excalifont and Xiaolai are used under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
````

- [ ] **Step 2: Deploy (owner)**

Run the commands in the README's "Deploy to Cloudflare" section.
Expected: `npm run deploy` ends with the `workers.dev` URL.

- [ ] **Step 3: Check the live headers (owner or agent)**

```bash
URL=https://sketchmap.<account>.workers.dev
curl -sI "$URL/e/abcdefghijklmnopqrstu" | grep -i "content-security-policy"
curl -sI "$URL/m/abcdefghijklmnopqrstu" | grep -ci "frame-ancestors\|x-frame-options"
curl -s -o /dev/null -w '%{http_code}\n' "$URL/api/maps"
```

Expected:
- The first command prints `content-security-policy: frame-ancestors 'none'`.
- The second prints `0`.
- The third prints `401`.

- [ ] **Step 4: The step-1 acceptance check in Notion (owner)**

1. Create a map with a few topics, including one Chinese topic.
2. Embed its view link in a Notion page in the **browser**. The map must load, look hand-drawn, pan, and zoom with ⌘/Ctrl + wheel. A plain wheel must scroll the Notion page.
3. Click **Edit in a tab ↗**, add a topic, and wait for **Saved**. Reload the Notion page: the new topic must be there.
4. Open the same Notion page in the **Notion desktop app** and record whether the embed loads.

Write the result for spec §12, open question 2, into the README under a new heading "Known limitations".

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: README with local dev, deploy and Notion embedding"
```
