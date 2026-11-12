# Step 3c: `.xmind` import — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the map list, "Import .xmind" turns an XMind file into a new Sketchmap map, and says what it could not bring over. XMind 2020+ files (`content.json`) and XMind 8 files (`content.xml`) are both read.

**Architecture:**
- `src/io/zip.ts` reads the few entries we need from the zip container, with the browser's built-in `DecompressionStream('deflate-raw')`. It has no new dependency, which keeps the CSP unchanged, and caps sizes against zip bombs.
- `src/io/xmind.ts` converts the XMind topic tree into `MapNode`s. It keeps what the spec lists and counts everything it drops, for the summary.
- The list page creates the map (`POST`), then saves the imported tree into it (`PUT`, validated by the existing schema and the 2 MB limit). The Worker needs no change.

**Tech Stack:** React 19, TypeScript, Web Streams (`DecompressionStream`/`CompressionStream`), DOMParser (XML), Vitest (node, plus jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md`, §9 ".xmind in", §10 (".xmind import from fixture files"), and §11 step 3.

## Evidence about the format (checked 2026-11-12)

**Real files inspected, with text masked:**
- the user's `hi.xmind`, made by XMind 24.03 ("Vana")
- 32 files bundled inside `/Applications/Xmind.app` (demo plus templates). These are XMind's own content: used only as local probes, never committed.

**Observed:**
- **Container.** A zip with `content.json`, `metadata.json` (`dataStructureVersion: "2"`), `manifest.json` and `Thumbnails/`, sometimes `resources/`.
  - Newer files also carry a `content.xml`. Its root topic's title is XMind's "can't be opened normally, do not save" warning stub. **When `content.json` exists it is the truth; `content.xml` must be ignored.**
- **`content.json`** is an array of sheets: `{ id, class: "sheet", title, rootTopic, relationships?, … }`.
- **Topic fields seen:**

| Field | Shape |
|---|---|
| `id` | |
| `title` | string |
| `titleUnedited` | |
| `attributedTitle` | `[{ text }]`; spans only carried `text` |
| `structureClass` | on the root, e.g. `org.xmind.ui.map.clockwise`, `org.xmind.ui.logic.right`, `org.xmind.ui.org-chart.down` |
| `children` | `{ attached?, detached?, summary? }` |
| `branch` | `"folded"` |
| `markers` | `[{ markerId }]`, with ids seen: `priority-1`…`priority-5`, `star-red`, `flag-blue`, `people-*`, `symbol-question`, `smiley-smile`, `c_symbol_money` |
| `image` | `{ src: "xap:resources/<hash>.png", width?, height?, align? }` |
| `href` | an https URL was seen |
| `labels` | |
| `boundaries` | |

- **XMind 8 XML.** The stub has the real namespace and structure: `<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><topic structure-class="…"><title>…`.

**Not observed, from XMind's documented format, so UNVERIFIED:**
- `notes: { plain: { content } }`. No sample had a note.
- XMind 8 `<notes><plain>`, `<children><topics type="attached">`, `branch="folded"` and `<marker-refs><marker-ref marker-id>`.
- The marker ids `task-done`, `symbol-exclam` and `symbol-wrong`.

Tests use synthetic fixtures with these shapes. The controller also runs the importer over all the real files above as a scratch check.

## Global Constraints

**What `.xmind` import keeps (spec §9):**
- XMind 2020+ (`content.json`): titles, attached children, plain-text notes, `href` (which becomes a link on the whole text), folded state, and priority markers (`priority-1` … `priority-9`, where 3 and above become ③).
- XMind 8 (`content.xml`): titles, children and notes.
- Styles, relationships, boundaries and floating topics are dropped, and the import summary says so.

**Rulings:**
- Images from `resources/` are deferred to step 4, which builds image storage. They are counted as "images (they arrive in step 4)".
- Only the first sheet is imported; the others are counted.
- Labels and summary topics are dropped and counted.
- One non-priority marker per topic is mapped into our set when the meaning is clear: `star-*` ⭐, `flag-*` 📌, `people-*` 👤, `symbol-question` ❓, `task-done` ✅, `symbol-exclam` ⚠️, `symbol-wrong` ❌. Others are counted as "other markers".
- An `href` that isn't http(s) is counted as "links to other topics or files". This covers `xmind:#…` topic links and `xap:` attachments.
- Topic text is escaped with `escapeLabel`, so XMind text is never read as our link syntax. Text is cut at 5000 characters, notes at 50,000.
- Nesting deeper than `MAX_OUTLINE_DEPTH` (64) is dropped and counted.
- A map whose JSON would exceed 90% of `LIMITS.mapJsonBytes` is refused with a clear message.
- Zip entries over 20 MB uncompressed are refused, as are encrypted entries and ZIP64.
- The layout comes from the root's `structureClass`: `org-chart` gives `org`, `logic` or `tree` gives `logic`, anything else gives `map`.

**Keep everything passing:** 277 unit tests, 14 Worker tests, 9 e2e tests, plus typecheck.

**Commits:** the subject line comes from the task. The co-author trailer goes only in a separate final `-m` paragraph.

## File map

| File | Role |
|---|---|
| `src/io/zip.ts` (new) | `readZip` |
| `src/io/zip.test.ts` (new) | |
| `src/test/zipFixture.ts` (new) | `makeZip` for tests and e2e, built on `CompressionStream` with no Node imports |
| `src/io/xmind.ts` (new) | `fromXmindJson`, `fromXmindXml`, `importXmind`, `XmindError` |
| `src/io/xmind.test.ts` (new, node) | |
| `src/io/xmindXml.test.ts` (new, jsdom) | |
| `src/list/ListPage.tsx`, `src/list/ListPage.test.tsx`, `src/app.css` | Import UI |
| `e2e/smoke.spec.ts`, `README.md` | e2e and docs |

**Order:** 1 → 2 → 3 → 4.

---

### Task 1: Read zip entries in the browser

**Files:**
- Create: `src/io/zip.ts`, `src/io/zip.test.ts`, `src/test/zipFixture.ts`

**Interfaces (produces):**
- `class ZipError extends Error`
- `readZip(bytes: Uint8Array, names: string[], maxBytes = 20_000_000): Promise<Map<string, Uint8Array>>`. It returns only the requested names that exist.
- `makeZip(entries: Array<{ name: string; data: string | Uint8Array; deflate?: boolean }>): Promise<Uint8Array>`, for tests only. With `deflate: false` an entry is stored, so jsdom tests need no streams.

- [ ] **Step 1: Write the fixture and the failing tests.**

`src/test/zipFixture.ts`:

```ts
/** Test helper: a minimal zip archive (CRC fields left 0; readZip doesn't check them). Stored or deflated entries. */
export async function makeZip(entries: Array<{ name: string; data: string | Uint8Array; deflate?: boolean }>): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const stored = e.deflate === false;
    const body = stored ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const name = enc.encode(e.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
```

`src/io/zip.test.ts` runs in the default node environment, which has `CompressionStream`, `DecompressionStream` and `Blob.stream`:

```ts
import { describe, expect, it } from 'vitest';
import { makeZip } from '../test/zipFixture';
import { readZip, ZipError } from './zip';

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

describe('readZip', () => {
  it('reads stored and deflated entries by name, ignoring the rest', async () => {
    const zip = await makeZip([
      { name: 'content.json', data: '[{"a":1}]' },
      { name: 'metadata.json', data: '{}', deflate: false },
      { name: 'Thumbnails/thumbnail.png', data: new Uint8Array([1, 2, 3]) },
    ]);
    const got = await readZip(zip, ['content.json', 'metadata.json', 'content.xml']);
    expect([...got.keys()].sort()).toEqual(['content.json', 'metadata.json']);
    expect(text(got.get('content.json'))).toBe('[{"a":1}]');
    expect(text(got.get('metadata.json'))).toBe('{}');
  });

  it('refuses something that is not a zip, and entries over the size cap', async () => {
    await expect(readZip(new TextEncoder().encode('not a zip at all'), ['content.json'])).rejects.toBeInstanceOf(ZipError);
    const zip = await makeZip([{ name: 'content.json', data: 'x'.repeat(5000) }]);
    await expect(readZip(zip, ['content.json'], 1000)).rejects.toBeInstanceOf(ZipError);
  });

  it('stops inflating as soon as the output passes the cap (zip bomb)', async () => {
    const zip = await makeZip([{ name: 'content.json', data: '0'.repeat(200_000) }]);
    // Lie in the central directory about the size so only the streaming cap can catch it.
    const v = new DataView(zip.buffer, zip.byteOffset);
    const cdStart = v.getUint32(zip.length - 22 + 16, true);
    v.setUint32(cdStart + 24, 10, true);
    await expect(readZip(zip, ['content.json'], 1000)).rejects.toBeInstanceOf(ZipError);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run `npx vitest run src/io/zip.test.ts`. Expected: FAIL, because `./zip` does not exist.

- [ ] **Step 3: Implement `src/io/zip.ts`.**

```ts
export class ZipError extends Error {}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Inflates raw-deflate data, giving up as soon as the output passes `max` bytes. */
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array> {
  const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new ZipError('A file inside the archive is too large.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Reads the named entries of a zip archive (stored or deflated). Entries that aren't there are left out of the result.
 * Refuses encrypted entries, ZIP64, and anything over `maxBytes` uncompressed.
 */
export async function readZip(bytes: Uint8Array, names: string[], maxBytes = 20_000_000): Promise<Map<string, Uint8Array>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === EOCD) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError('This is not a zip archive.');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const wanted = new Set(names);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== CENTRAL) throw new ZipError('The archive is damaged.');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const localAt = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.has(name)) continue;
    if (flags & 1) throw new ZipError('Encrypted archives are not supported.');
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError('ZIP64 archives are not supported.');
    if (usize > maxBytes) throw new ZipError('A file inside the archive is too large.');
    if (localAt + 30 > bytes.length || v.getUint32(localAt, true) !== LOCAL) throw new ZipError('The archive is damaged.');
    const dataAt = localAt + 30 + v.getUint16(localAt + 26, true) + v.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + csize);
    if (method === 0) out.set(name, data.slice());
    else if (method === 8) out.set(name, await inflate(data, maxBytes));
    else throw new ZipError('This archive uses an unsupported compression method.');
  }
  return out;
}
```

- [ ] **Step 4: Run the tests and the typecheck.** Run `npx vitest run src/io/zip.test.ts && npm run typecheck`. Expected: PASS.

  If `DecompressionStream('deflate-raw')` or `CompressionStream` is missing from TypeScript's DOM lib, check `lib` in `tsconfig.app.json`. They are in the standard DOM lib for TS 5.9. Report it if not.

- [ ] **Step 5: Commit.**

```bash
git add src/io/zip.ts src/io/zip.test.ts src/test/zipFixture.ts
git commit -m "feat(io): read zip entries in the browser with DecompressionStream, capped against zip bombs" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: XMind → Sketchmap conversion

**Files:**
- Create: `src/io/xmind.ts`, `src/io/xmind.test.ts`, `src/io/xmindXml.test.ts`

**Interfaces:**
- Consumes:
  - `readZip`, `ZipError` (Task 1)
  - `escapeLabel`, `linkWhole`, `normalizeHref` (`src/shared/rich.ts`)
  - `newNodeId` (`src/model/ids.ts`)
  - `MAX_OUTLINE_DEPTH` (`src/io/markdown.ts`)
  - `LIMITS`, `LayoutKind`, `MapNode` (`src/shared/types.ts`)
- Produces:
  - `XmindImport { root: MapNode; layout: LayoutKind; topics: number; dropped: string[] }`, where `dropped` holds readable phrases such as "2 relationships"
  - `class XmindError extends Error`
  - `fromXmindJson(content: unknown): XmindImport`
  - `fromXmindXml(xml: string): XmindImport`, which needs DOMParser
  - `importXmind(bytes: Uint8Array): Promise<XmindImport>`

- [ ] **Step 1: Write the failing tests.**

`src/io/xmind.test.ts` (node environment):

```ts
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { makeZip } from '../test/zipFixture';
import { fromXmindJson, importXmind, XmindError } from './xmind';

const shape = (n: MapNode): unknown => ({ t: n.text, c: n.children.map(shape) });
// Shaped like real XMind 2020+ content.json (see the plan's evidence section); the content is made up.
const sheet = (rootTopic: object, extra: object = {}) => ({ id: 's1', class: 'sheet', title: 'Sheet 1', rootTopic, ...extra });
const content = [
  sheet(
    {
      id: 'r', class: 'topic', title: 'Plan [draft]', structureClass: 'org.xmind.ui.org-chart.down',
      children: {
        attached: [
          {
            id: 'a', title: 'Site', href: 'https://example.com/plan', notes: { plain: { content: 'Call Ana\n' } },
            markers: [{ markerId: 'priority-4' }, { markerId: 'star-red' }, { markerId: 'people-blue' }],
            branch: 'folded', labels: ['x'],
            children: { attached: [{ id: 'a1', title: 'Hidden child' }] },
          },
          { id: 'b', title: 'Spec', href: 'xmind:#a', image: { src: 'xap:resources/abc.png' }, markers: [{ markerId: 'c_symbol_money' }] },
        ],
        detached: [{ id: 'f', title: 'Floating', children: { attached: [{ id: 'f1', title: 'Under it' }] } }],
        summary: [{ id: 'm', title: 'Summary' }],
      },
      boundaries: [{ id: 'bd', range: '(0,1)' }],
    },
    { relationships: [{ id: 'r1' }, { id: 'r2' }] },
  ),
  sheet({ id: 'r2', title: 'Second sheet' }),
];

describe('fromXmindJson', () => {
  it('keeps titles, attached children, notes, http links, fold state, priority and a mapped marker', () => {
    const got = fromXmindJson(content);
    expect(got.layout).toBe('org');
    expect(shape(got.root)).toEqual({ t: 'Plan \\[draft\\]', c: [{ t: '[Site](https://example.com/plan)', c: [{ t: 'Hidden child', c: [] }] }, { t: 'Spec', c: [] }] });
    const a = got.root.children[0];
    expect(a).toMatchObject({ note: 'Call Ana', priority: 3, emoji: '⭐', collapsed: true });
    expect(got.root.children[1]).not.toHaveProperty('priority');
    expect(got.topics).toBe(4);
    expect(got.root.id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });

  it('lists what it could not bring over', () => {
    expect(fromXmindJson(content).dropped).toEqual([
      '1 more sheet',
      '2 relationships',
      '1 boundary',
      '2 floating topics',
      '1 summary topic',
      '1 label',
      '2 other markers',
      '1 link to another topic or file',
      '1 image (images arrive in step 4)',
    ]);
  });

  it('maps the layout and caps priority at ③', () => {
    expect(fromXmindJson([sheet({ id: 'r', title: 'R', structureClass: 'org.xmind.ui.logic.right' })]).layout).toBe('logic');
    expect(fromXmindJson([sheet({ id: 'r', title: 'R', structureClass: 'org.xmind.ui.map.clockwise' })]).layout).toBe('map');
    const p = fromXmindJson([sheet({ id: 'r', title: 'R', markers: [{ markerId: 'priority-1' }] })]);
    expect(p.root.priority).toBe(1);
  });

  it('refuses content that is not an XMind sheet list', () => {
    expect(() => fromXmindJson({ nope: true })).toThrow(XmindError);
    expect(() => fromXmindJson([])).toThrow(XmindError);
  });
});

describe('importXmind', () => {
  const zipped = (files: Array<{ name: string; data: string }>) => makeZip(files);

  it('reads content.json and ignores the content.xml warning stub next to it', async () => {
    const stub = '<?xml version="1.0"?><xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><topic><title>Warning: This file can not be opened normally</title></topic></sheet></xmap-content>';
    const got = await importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(content) }, { name: 'content.xml', data: stub }]));
    expect(got.root.text).toBe('Plan \\[draft\\]');
  });

  it('explains files it cannot read', async () => {
    await expect(importXmind(new TextEncoder().encode('hello'))).rejects.toThrow(/not an XMind file/);
    await expect(importXmind(await zipped([{ name: 'other.txt', data: 'x' }]))).rejects.toThrow(/No mind map/);
    await expect(importXmind(await zipped([{ name: 'content.json', data: '{broken' }]))).rejects.toThrow(XmindError);
  });

  it('refuses a map too big to save', async () => {
    const many = Array.from({ length: 4000 }, (_, i) => ({ id: `t${i}`, title: 'x'.repeat(500) }));
    const big = [sheet({ id: 'r', title: 'Big', children: { attached: many } })];
    await expect(importXmind(await zipped([{ name: 'content.json', data: JSON.stringify(big) }]))).rejects.toThrow(/too big/);
  });
});
```

`src/io/xmindXml.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { MapNode } from '../shared/types';
import { makeZip } from '../test/zipFixture';
import { fromXmindXml, importXmind } from './xmind';

const shape = (n: MapNode): unknown => ({ t: n.text, c: n.children.map(shape) });
// XMind 8 content.xml (documented format; namespace and nesting match the stub found in real files).
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:xlink="http://www.w3.org/1999/xlink" version="2.0">
  <sheet id="s"><topic id="r" structure-class="org.xmind.ui.logic.right"><title>Old map</title>
    <children><topics type="attached">
      <topic id="a" branch="folded"><title>First</title><notes><plain>A note</plain></notes>
        <children><topics type="attached"><topic id="a1"><title>Deep</title></topic></topics></children></topic>
      <topic id="b"><title>Second</title></topic>
    </topics><topics type="detached"><topic id="f"><title>Floating</title></topic></topics></children>
  </topic><title>Sheet 1</title></sheet>
</xmap-content>`;

describe('fromXmindXml (XMind 8)', () => {
  it('keeps titles, attached children, notes and fold state', () => {
    const got = fromXmindXml(xml);
    expect(shape(got.root)).toEqual({ t: 'Old map', c: [{ t: 'First', c: [{ t: 'Deep', c: [] }] }, { t: 'Second', c: [] }] });
    expect(got.root.children[0]).toMatchObject({ note: 'A note', collapsed: true });
    expect(got.layout).toBe('logic');
    expect(got.dropped).toEqual(['1 floating topic']);
  });

  it('is used when an archive has no content.json', async () => {
    const got = await importXmind(await makeZip([{ name: 'content.xml', data: xml, deflate: false }]));
    expect(got.root.text).toBe('Old map');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run `npx vitest run src/io/xmind.test.ts src/io/xmindXml.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/io/xmind.ts`.** Write it to satisfy the tests and the Global Constraints, with this structure:

```ts
import { newNodeId } from '../model/ids';
import { escapeLabel, linkWhole, normalizeHref } from '../shared/rich';
import { LIMITS, type LayoutKind, type MapNode } from '../shared/types';
import { MAX_OUTLINE_DEPTH } from './markdown';
import { readZip, ZipError } from './zip';

export class XmindError extends Error {}

export interface XmindImport {
  root: MapNode;
  layout: LayoutKind;
  /** Topics imported, the root included. */
  topics: number;
  /** What could not be brought over, as readable phrases for the import summary ("2 relationships"). */
  dropped: string[];
}

const MAX_TEXT = 5000;
const MAX_NOTE = 50_000;
/** XMind marker → our marker (ids seen in real files, except task-done/symbol-exclam/symbol-wrong, which are documented). */
const MARKER_MAP: Array<[RegExp, string]> = [
  [/^star-/, '⭐'], [/^flag-/, '📌'], [/^people-/, '👤'], [/^symbol-question$/, '❓'],
  [/^task-done$/, '✅'], [/^symbol-exclam$/, '⚠️'], [/^symbol-wrong$/, '❌'],
];

/** Counts what an import drops, then words it ("1 boundary", "2 boundaries"). */
class Dropped { … }
```

**`Dropped`'s phrases:**
- The phrases and their order are fixed by the test.
- Plurals: "sheet/sheets", "relationship(s)", "boundary/boundaries", "floating topic(s)", "summary topic(s)", "label(s)", "other marker(s)", "link(s) to another topic or file" (plural "links to other topics or files"), and "image(s) (images arrive in step 4)".
- The first one reads "N more sheet(s)".

**Conversion rules (one function per format, sharing a `build` helper for the node fields):**
- **Text:** `escapeLabel(title)`, cut to 5000 characters.
- **Link:** if `href` starts with http(s) and `normalizeHref` accepts it, `text = linkWhole(text, href)`. Any other `href` counts as one link.
- **Note:** `notes.plain.content` (JSON) or `<notes><plain>` (XML), trimmed at the end and cut to 50,000 characters. Leave it out when empty.
- **Priority:** the first `priority-N` gives `Math.min(3, N)`.
- **Emoji:** the first marker that matches `MARKER_MAP`. Every other non-priority marker counts as an "other marker".
- **Collapsed:** `branch === 'folded'`, or the XML attribute `branch="folded"`. Set it only when the topic has children.
- **Children:** recurse into `children.attached` (JSON), or `<children><topics type="attached">` (XML).
  - Floating topics: count every topic in `detached` and its subtree.
  - Summary topics: count each one in `summary`.
  - Count `labels` entries, `image` (one each), and `boundaries` entries.
  - Below depth `MAX_OUTLINE_DEPTH`, stop recursing and count the dropped topics as "N topics nested too deep". That phrase goes last; it is not in the fixture.
- **Layout:** from the root's `structureClass` (JSON) or the root `<topic structure-class>` (XML).
- **Sheets:** use the first sheet. Count the others, and count the relationships on the first sheet.
  - JSON: `relationships`.
  - XML: `<relationships><relationship>`, inside `<sheet>`.
- **Ids:** every node gets a fresh `newNodeId()`.
- **XML:** parse with `new DOMParser().parseFromString(xml, 'application/xml')`. A `parsererror` element means an `XmindError`. Find elements by `localName`, because of the default namespace.
- **`importXmind`:**
  - Use `readZip(bytes, ['content.json', 'content.xml'])`.
  - A `ZipError` becomes `XmindError('This is not an XMind file (it is not a zip archive).')`, but a "too large" error keeps its message.
  - If there is `content.json`, use it; `JSON.parse` failing gives `XmindError('The XMind file is damaged.')`.
  - Otherwise use `content.xml`. With neither, throw `XmindError('No mind map found in this file.')`.
  - Finally, if `JSON.stringify(root).length > LIMITS.mapJsonBytes * 0.9`, throw `XmindError('This map is too big to import (over 2 MB).')`.

- [ ] **Step 4: Run the tests and the typecheck.** Run `npx vitest run src/io && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/io/xmind.ts src/io/xmind.test.ts src/io/xmindXml.test.ts
git commit -m "feat(io): convert XMind 2020+ and XMind 8 maps, listing what is not brought over" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: "Import .xmind" on the map list

**Files:**
- Modify: `src/list/ListPage.tsx`, `src/list/ListPage.test.tsx`, `src/app.css`

**Interfaces:**
- Consumes `importXmind`, `XmindError` (Task 2) and the existing `api.createMap(title)`, `api.saveMap(map, etag)` and `api.deleteMap(id)`.
- Markup:
  - a button "Import .xmind", which clicks a hidden `input[type=file][accept=".xmind"][aria-label="XMind file"]`
  - while working, the button reads "Importing…" and is disabled
  - the result is a `p[role="status"].import-result`, with an "Open it" link to `/e/<id>`

- [ ] **Step 1: Write the failing test.** Add to `src/list/ListPage.test.tsx`, after setting the owner key the way the file's other tests do:

```tsx
  it('imports an .xmind file as a new map and says what it left out', async () => {
    localStorage.setItem('sketchmap:ownerKey', 'k'); // use whatever key name the existing tests use
    const calls = stubApi();
    const saved: unknown[] = [];
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init = {}) => {
      if (init.method === 'PUT') {
        saved.push(JSON.parse(String(init.body)));
        return Response.json(JSON.parse(String(init.body)), { headers: { ETag: '"e2"' } });
      }
      return base(url, init);
    });
    await render();
    const xmind = await makeZip([{ name: 'content.json', deflate: false, data: JSON.stringify([
      { id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Trip', children: { attached: [{ id: 'a', title: 'Pack' }] } }, relationships: [{ id: 'x' }] },
    ]) }]);
    const input = container.querySelector('input[aria-label="XMind file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([xmind], 'trip.xmind')] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {});
    expect(calls.map(([m]) => m)).toContain('POST');
    expect(saved[0]).toMatchObject({ root: { text: 'Trip', children: [{ text: 'Pack' }] }, layout: 'map' });
    const status = container.querySelector('.import-result')!;
    expect(status.textContent).toContain('2 topics');
    expect(status.textContent).toContain('1 relationship');
    expect(status.querySelector('a')!.getAttribute('href')).toBe(`/e/${id}`);
  });
```

Also import `makeZip` from `'../test/zipFixture'`. Adapt the owner-key setup and the `stubApi` reuse to how the file's existing tests do it, without changing what this test asserts.

- [ ] **Step 2: Run the test and watch it fail.** Run `npx vitest run src/list`. Expected: FAIL, because there is no file input.

- [ ] **Step 3: Implement it in `ListPage.tsx`.**

```tsx
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{ id: string; title: string; topics: number; dropped: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File) => {
    setImporting(true);
    setError(undefined);
    setImported(null);
    let createdId: string | null = null;
    try {
      const result = await importXmind(new Uint8Array(await file.arrayBuffer()));
      const { map, etag } = await api.createMap();
      createdId = map.id;
      await api.saveMap({ ...map, root: result.root, layout: result.layout }, etag);
      setImported({ id: map.id, title: result.root.text.split('\n')[0] || 'Untitled map', topics: result.topics, dropped: result.dropped });
      refresh();
    } catch (e) {
      if (createdId) void api.deleteMap(createdId).catch(() => {});
      if (e instanceof XmindError) setError(e.message);
      else fail(e);
    } finally {
      setImporting(false);
    }
  };
```

- The title in the status should use the plain text. Strip link syntax with `parseRich(result.root.text).plain`.

Header, next to "New map":

```tsx
        <button type="button" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? 'Importing…' : 'Import .xmind'}</button>
        <input
          ref={fileRef}
          type="file"
          accept=".xmind"
          aria-label="XMind file"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
```

After the error line:

```tsx
      {imported && (
        <p role="status" className="import-result">
          Imported “{imported.title}”: {imported.topics} topics.
          {imported.dropped.length > 0 && <> Not brought over: {imported.dropped.join(', ')}.</>} <a href={`/e/${imported.id}`}>Open it</a>
        </p>
      )}
```

Imports to add: `useRef`, and `importXmind`, `XmindError` from `'../io/xmind'`.

**`app.css`:** append `.import-result { margin: 12px 0 0; padding: 10px 12px; background: var(--accent-soft); border-radius: 10px; } .import-result a { color: var(--accent); font-weight: 600; }`.

**A jsdom note:** if `File.prototype.arrayBuffer` is missing in jsdom, read the file with `new Response(file).arrayBuffer()` instead. Choose whichever works in both jsdom and browsers, and say which in the report.

- [ ] **Step 4: Run the tests and the typecheck.** Run `npx vitest run src/list && npm test && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/list/ListPage.tsx src/list/ListPage.test.tsx src/app.css
git commit -m "feat(list): import an .xmind file as a new map, with a summary of what was left out" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: End-to-end import, README

**Files:**
- Modify: `e2e/smoke.spec.ts`, `README.md`

- [ ] **Step 1: Add the e2e test.** Import `makeZip` from `'../src/test/zipFixture'`. Playwright runs in Node, which has `CompressionStream`.

```ts
test('an .xmind file imports as a new map, with links, notes and priority, and shows in the view', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  const xmind = await makeZip([{ name: 'content.json', data: JSON.stringify([{
    id: 's', class: 'sheet', title: 'S', rootTopic: { id: 'r', title: 'Imported trip', structureClass: 'org.xmind.ui.logic.right', children: { attached: [
      { id: 'a', title: 'Booking', href: 'https://example.com/book', markers: [{ markerId: 'priority-2' }], notes: { plain: { content: 'Ask about breakfast' } } },
      { id: 'b', title: 'Packing', branch: 'folded', children: { attached: [{ id: 'b1', title: 'Socks' }] } },
    ] } },
  }]) }]);
  await page.locator('input[aria-label="XMind file"]').setInputFiles({ name: 'trip.xmind', mimeType: 'application/octet-stream', buffer: Buffer.from(xmind) });
  await expect(page.locator('.import-result')).toContainText('4 topics');
  await page.locator('.import-result a').click();
  await page.waitForURL(/\/e\//);
  await expect(page.getByRole('button', { name: 'Logic chart' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('g.topic')).toHaveCount(3); // Socks is folded away
  await expect(page.locator('g.topic a', { hasText: 'Booking' })).toHaveAttribute('href', 'https://example.com/book');
  await expect(page.locator('g.topic g.badge text')).toHaveText('2');
  await expect(page.locator('g.topic g.note-icon title')).toHaveText('Ask about breakfast');
  const id = page.url().split('/e/')[1];
  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(3);
});
```

- [ ] **Step 2: Run it.** Run `npx playwright test`. Expected: 10 passed, with 9 in dev and 1 in prod.

- [ ] **Step 3: Update `README.md`.** Add an ".xmind import" part to the step-3 section:
  - "Import .xmind" on the map list turns an XMind file into a new map.
  - XMind 2020+ keeps titles, attached children, notes, links (`http(s)` hrefs become a link on the whole topic), folded branches, priority markers (3 and above become ③), and star/flag/person/question markers.
  - XMind 8 keeps titles, children and notes.
  - Relationships, boundaries, floating and summary topics, labels, other markers, links to files or topics, styles, and other sheets are left out. The summary after import lists them.
  - Images are left out until step 4.

  Under "Not yet checked", add: "XMind notes and XMind 8 files are imported from the documented format; no real sample with notes or from XMind 8 was available."

- [ ] **Step 4: Run everything.** Run `npm test && npm run typecheck && npm run test:worker && npx playwright test`. Everything must pass.

- [ ] **Step 5: Commit.**

```bash
git add e2e/smoke.spec.ts README.md
git commit -m "test(e2e): import an .xmind file end to end; README" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage (§9 ".xmind in"):**

| Spec item | Task |
|---|---|
| 2020+: titles, attached children, notes, `href`, folded state, priority markers | 2 |
| XMind 8: titles, children, notes | 2 (fold state too) |
| Styles, relationships, boundaries and floating topics dropped, and the summary says so | 2 (counting), 3 (shown) |
| §10 "`.xmind` import from fixture files" | 2 (synthetic fixtures shaped like the real files); the controller adds a scratch run over the real files |
| Images from `resources/` | Deferred to step 4 (ruling), counted in the summary |

**Types:** these names are used consistently across tasks: `readZip`/`ZipError`, `makeZip`, `XmindImport`/`XmindError`/`fromXmindJson`/`fromXmindXml`/`importXmind`, the aria-label "XMind file", and `.import-result`.
