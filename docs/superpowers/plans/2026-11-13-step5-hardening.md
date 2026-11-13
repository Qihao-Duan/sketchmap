# Step 5: hardening — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps left open after delivery steps 1–4: the editor and list page survive blocked browser storage, saving resumes the moment the connection is back, reads retry once on a transient failure, exports include an edit still being typed, scripts and fonts are cached for a year, the browser tests stop writing into the developer's local storage, and the untested paths (pasting and dropping images, `.xmind` with images) get tests.

**Architecture:** Five small, independent changes. No new features, no schema change, no new dependency.
- **Browser:** a `browserStorage()` helper, `Autosaver.retryNow()` wired to the `online` event, one retry for GET requests in the API client, and `exportAs` committing an open edit first.
- **Worker:** `serveAsset` adds `Cache-Control: public, max-age=31536000, immutable` to content-hashed bundles and font subsets.
- **Tests:** the Playwright servers run on their own ports with their own storage folders, wiped at each start.

**Base:** main at 62b14c2 (step 4 complete).

**Tech Stack:** React 19, TypeScript, Cloudflare Workers, Vitest (node, jsdom, Workers pool), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md` — §8 (Worker), §10 (failure handling and tests).

## Global Constraints

- No new dependencies. No schema or API change. The production CSP is unchanged.
- The Notion embed (`/m/…`) must keep working without any browser storage: it reads none today and must read none after this step.
- Only GET requests are retried automatically, and only once, after a network error or a 5xx answer. Writes (POST, PUT, DELETE) are never repeated by the client; saving keeps its existing backoff in `Autosaver`.
- `Cache-Control: public, max-age=31536000, immutable` is set only on a 200 answer whose path is content-hashed (`/assets/<name>-<8 chars>.<ext>`, `/fonts/(Excalifont|Xiaolai)/<Family>-Regular-<32 hex>.woff2`) and whose content type is not `text/html`. HTML and `/api/*` answers keep their headers.
- The browser tests never read or write `.wrangler/state` (the developer's local maps).
- Commit trailer `Co-Authored-By: <your model> <noreply@anthropic.com>` as its own paragraph, never on the subject line.

## Measured before planning (2026-11-13)

- **Speed on large maps (no task in this plan).** In the real editor (`vite dev`, headless Chromium, this machine), the time from an arrow-key press to the next painted frame is 33 ms at 100 and 300 topics (the floor of the two-frame measurement), 68 ms at 1000 and 118 ms at 2000, the same in dark mode. A full redraw outside the editor costs 9 + 23 ms at 200 topics and 89 + 58 ms at 3000. Ruling: no second drawing path now; Task 5 records the numbers in the README.
- **Cache headers.** On the production build (`vite preview`), fonts, hashed scripts and HTML all answer `cache-control: public, max-age=0, must-revalidate`, so every embed load re-asks for every file. All 209 Xiaolai and 7 Excalifont files are named `<Family>-Regular-<32 hex>.woff2`.
- **The intermittent `internal error` in test logs.** Captured once in six full Playwright runs: `Error: internal error; reference = …` thrown by `env.MAPS.list` inside the preview server's `listMaps`, in the first second of a run. Not reproduced by 60 rounds of concurrent list/create/delete against either or both local servers, nor by 10 cold starts with simultaneous first storage access. Cause not established. This plan removes the one known irregularity (two servers sharing one storage folder, Task 4) and makes reads tolerate one transient failure (Task 1); neither is proven to be the fix.
- **Test leftovers.** The developer's local storage holds 849 blobs, mostly maps the browser tests created and never deleted.

---

### Task 1: Blocked storage, back-online retry, one retry for reads

**Files:**
- Create: `src/storage.ts`, `src/storage.test.ts`
- Modify: `src/auth/ownerKey.ts`, `src/editor/EditorPage.tsx`, `src/editor/autosave.ts`, `src/api/client.ts`
- Test: `src/auth/ownerKey.test.ts`, `src/editor/autosave.test.ts`, `src/api/client.test.ts`, `src/editor/EditorPage.test.tsx`

**Interfaces — produces:**
- `export function createBrowserStorage(read?: () => Storage): Storage` and `export function browserStorage(): Storage` in `src/storage.ts`.
- `Autosaver.retryNow(): void`.
- `export const GET_RETRY_DELAY_MS = 400` and a fourth `createApi` parameter `sleep?: (ms: number) => Promise<void>`.

**Why.** Reading `localStorage` itself throws a `SecurityError` when the browser blocks site data. Today `getOwnerKey(storage = localStorage)` and `Editor({ storage = localStorage })` evaluate that default outside any `try`, so the list page and the editor crash before drawing anything. Separately, a failed save waits out a backoff of up to 60 s even when the connection is back, and a single failed read shows an error at once.

- [ ] **Step 1: Failing tests for the storage helper** — `src/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createBrowserStorage } from './storage';

const real = (): Storage => {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  };
};

describe('createBrowserStorage', () => {
  it('uses the browser storage when it can be read', () => {
    const store = real();
    expect(createBrowserStorage(() => store)).toBe(store);
  });

  it('falls back to a working in-memory store when reading the storage throws', () => {
    const s = createBrowserStorage(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    expect(s.getItem('k')).toBeNull();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    expect(s.length).toBe(1);
    expect(s.key(0)).toBe('k');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('falls back when the storage object exists but refuses reads', () => {
    const broken = { ...real(), getItem: () => { throw new DOMException('denied', 'SecurityError'); } } as Storage;
    const s = createBrowserStorage(() => broken);
    expect(s).not.toBe(broken);
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
  });

  it('keeps a full storage that can still be read (the stored owner key must stay reachable)', () => {
    const full = { ...real(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } } as Storage;
    expect(createBrowserStorage(() => full)).toBe(full);
  });
});
```

Run: `npx vitest run src/storage.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement `src/storage.ts`**

```ts
/** A store that lasts only as long as the page: the stand-in when the browser blocks site data. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

/**
 * `localStorage`, or an in-memory stand-in when the browser refuses it: with site data blocked, reading
 * `localStorage` itself throws. Only reading is probed, so a storage that is merely full stays in use and
 * what it already holds (the owner key) stays reachable.
 */
export function createBrowserStorage(read: () => Storage = () => localStorage): Storage {
  try {
    const storage = read();
    storage.getItem('sketchmap:probe');
    return storage;
  } catch {
    return memoryStorage();
  }
}

let shared: Storage | undefined;

/** The one storage every page uses. With the stand-in, the owner key, drafts and panel state last until the page is closed or reloaded. */
export function browserStorage(): Storage {
  shared ??= createBrowserStorage();
  return shared;
}
```

- [ ] **Step 3: Use it.**
  - `src/auth/ownerKey.ts`: the three defaults `= localStorage` become `= browserStorage()`.
  - `src/editor/EditorPage.tsx`: `storage = localStorage` in `Editor`'s parameters becomes `storage = browserStorage()`. In `discardDraft`, wrap `storage.removeItem(draftKey(initial.id))` in `try { … } catch { /* nothing to remove */ }`.
  - Add to `src/auth/ownerKey.test.ts` (follow the file's style): with the default storage, `setOwnerKey('k')` then `getOwnerKey()` returns `'k'`; `clearOwnerKey()` then `getOwnerKey()` returns `null`.
  - Run `grep -rn "localStorage" src | grep -v "\.test\.\|src/test/\|src/storage.ts"` — Expected: no matches.
  - Run `npx vitest run src/auth src/editor src/list` — Expected: PASS. (`src/test/setup.ts` installs a working `localStorage` for jsdom tests, and `browserStorage()` reads the same global, so tests that seed `localStorage` directly still see their data.)

- [ ] **Step 4: Failing tests for `retryNow`** — add to `src/editor/autosave.test.ts`, using its `setup`/`ok`/`mapWith` helpers and fake timers:

```ts
  it('retryNow saves at once when a retry is waiting out its backoff', async () => {
    let fail = true;
    const t = setup(async (map) => {
      if (fail) throw new ApiError(0, 'offline');
      return { map: { ...map, version: 2 }, etag: '"e2"' };
    });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000); // first try fails; the next is 2 s away
    expect(t.statuses.at(-1)).toBe('retrying');
    expect(t.deps.save).toHaveBeenCalledTimes(1);
    fail = false;
    t.saver.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.save).toHaveBeenCalledTimes(2);
    expect(t.statuses.at(-1)).toBe('saved');
  });

  it('retryNow does nothing unless a retry is waiting', async () => {
    const t = setup(ok(1));
    t.saver.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.save).not.toHaveBeenCalled();
    t.saver.schedule(mapWith('a')); // pending: its own 1 s delay stays
    t.saver.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.save).not.toHaveBeenCalled();
  });

  it('retryNow leaves a conflict alone', async () => {
    const t = setup(async () => {
      throw new ApiError(409, 'conflict');
    });
    t.saver.schedule(mapWith('a'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.statuses.at(-1)).toBe('conflict');
    t.saver.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.deps.save).toHaveBeenCalledTimes(1);
  });
```

Run: `npx vitest run src/editor/autosave.test.ts` — Expected: FAIL (`retryNow` is not a function).

- [ ] **Step 5: Implement.** In `src/editor/autosave.ts`, after `flush()`:

```ts
  /** The connection is back: try now instead of waiting out the backoff. */
  retryNow(): void {
    if (this.status === 'retrying' && !this.inFlight) this.arm(0);
  }
```

In `src/editor/EditorPage.tsx`, in the effect that already listens for `visibilitychange` and `beforeunload` (its dependency is `[saver]`), add `const onOnline = () => saver.retryNow();`, `window.addEventListener('online', onOnline);` and the matching `removeEventListener` in the cleanup. Update that effect's comment to mention it.

Add one test to `src/editor/EditorPage.test.tsx` (follow its `fakeApi`, `mount`, `advance` helpers; the status badge is `[data-testid="save-status"]`): `saveMap` rejects with `new ApiError(0, 'offline')` on its first call and resolves afterwards; make one change (e.g. `keydown({ key: 'Tab' })`, type a text into the inline editor, commit with Enter, the way neighbouring tests do), `advance(1000)`, expect the badge to read `Not saved, retrying` (check `STATUS_TEXT.retrying` in `EditorChrome.tsx` for the exact text); then `act(() => void window.dispatchEvent(new Event('online')))`, `advance(0)`, and expect `saveMap` to have been called twice and the badge to read `Saved`.

- [ ] **Step 6: Failing tests for the read retry** — add to `src/api/client.test.ts` (follow how the file builds a fetch stub and calls `createApi`):

```ts
  const noSleep = async () => {};

  it('tries a failed read once more: after a network error, and after a server error', async () => {
    const map = { id: 'abcdefghijklmnopqrstu' };
    for (const first of [() => Promise.reject(new TypeError('failed to fetch')), async () => new Response('{"error":"Internal error"}', { status: 500 })]) {
      let calls = 0;
      const fetchImpl = (async () => (++calls === 1 ? first() : new Response(JSON.stringify(map), { headers: { ETag: '"e1"' } }))) as typeof fetch;
      const waits: number[] = [];
      const api = createApi(() => null, fetchImpl, '', async (ms) => void waits.push(ms));
      await expect(api.getMap('abcdefghijklmnopqrstu')).resolves.toEqual({ map, etag: '"e1"' });
      expect(calls).toBe(2);
      expect(waits).toEqual([GET_RETRY_DELAY_MS]);
    }
  });

  it('gives up after the second failed read, with the second error', async () => {
    let calls = 0;
    const fetchImpl = (async () => new Response(JSON.stringify({ error: `boom ${++calls}` }), { status: 503 })) as typeof fetch;
    const api = createApi(() => 'k', fetchImpl, '', noSleep);
    await expect(api.listMaps()).rejects.toMatchObject({ status: 503, message: 'boom 2' });
    expect(calls).toBe(2);
  });

  it('does not retry a read the server refused (4xx), nor any write', async () => {
    let calls = 0;
    const notFound = (async () => (calls++, new Response('{"error":"Not found"}', { status: 404 }))) as typeof fetch;
    await expect(createApi(() => null, notFound, '', noSleep).getMap('x')).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);

    calls = 0;
    const down = (async () => (calls++, new Response('{"error":"Internal error"}', { status: 500 }))) as typeof fetch;
    const api = createApi(() => 'k', down, '', noSleep);
    const map = { id: 'abcdefghijklmnopqrstu' } as never;
    await expect(api.saveMap(map, '"e"')).rejects.toMatchObject({ status: 500 });
    await expect(api.createMap()).rejects.toMatchObject({ status: 500 });
    await expect(api.deleteMap('x')).rejects.toMatchObject({ status: 500 });
    await expect(api.uploadImage('x', new Blob(['i']))).rejects.toMatchObject({ status: 500 });
    expect(calls).toBe(4);
  });
```

Import `GET_RETRY_DELAY_MS` from `./client`. Existing tests in this file that make a GET fail (the "error responses" and "network failures" tests) now see two fetch calls and would wait 400 ms: pass `noSleep` as the fourth argument there and adjust any call-count assertion.

Run: `npx vitest run src/api/client.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 7: Implement in `src/api/client.ts`.**
  - Add `export const GET_RETRY_DELAY_MS = 400;`.
  - Give `createApi` a fourth parameter: `sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),`.
  - Rename the existing inner `request` to `once` (body unchanged) and add:

```ts
  /** A read that failed on the network or with a server error is tried once more: reads are safe to repeat, writes are not. */
  async function request(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const read = !init.method || init.method === 'GET';
    try {
      return await once(path, init, auth);
    } catch (e) {
      if (!read || !(e instanceof ApiError) || (e.status !== 0 && e.status < 500)) throw e;
      await sleep(GET_RETRY_DELAY_MS);
      return once(path, init, auth);
    }
  }
```

- [ ] **Step 8: Run everything.** `npm test` and `npm run typecheck` — Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/storage.ts src/storage.test.ts src/auth/ownerKey.ts src/auth/ownerKey.test.ts src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/editor/autosave.ts src/editor/autosave.test.ts src/api/client.ts src/api/client.test.ts
git commit -m "fix: blocked storage no longer crashes the app; saving resumes when back online; reads retry once" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: Exports include an edit still being typed

**Files:**
- Modify: `src/editor/EditorPage.tsx`, `src/app.css`
- Test: `src/editor/EditorPage.test.tsx`

**Why.** The SVG, PNG and Excalidraw buttons keep the keyboard focus where it is (`onMouseDown` prevents the focus change), so text still open in the inline editor, or a note typed less than 0.8 s ago, is not in the map yet when the export runs. The other toolbar buttons already call `endEdit()` first; the export buttons do not.

- [ ] **Step 1: Failing tests** — add to `src/editor/EditorPage.test.tsx`, in the block that tests the Excalidraw button (it already mocks `buildExcalidraw` and `download`):
  1. *An open edit is committed first.* Mount, `keydown({ key: 'F2' })`, `type(textarea.inline-editor, 'Changed')`, then `click('Excalidraw')`. Expect: `vi.mocked(buildExcalidraw).mock.calls.at(-1)![0].byId.get('root000001')!.lines.join(' ')` contains `Changed`; `container.querySelector('textarea.inline-editor')` is `null`; `download` was called with the file name `Changed.excalidraw` (the title follows the root's text) — if the title is only updated by the server echo in this test setup, assert on the layout and the closed editor only, and say so in the report.
  2. *A note still waiting for its pause is included.* Mount, focus the Note box (`textarea[aria-label="Note"]`), `type(note, 'Remember')`, do not advance the timers, `click('Excalidraw')`. Expect the status banner (`[role="status"]`) to read `Downloaded. Not kept in .excalidraw: notes.` (the note reached the map, so `excalidrawLosses` reports it).
  3. *SVG takes the same path.* Spy on `buildSvg`: extend the existing `vi.mock('../io/exportImage', …)` factory with `buildSvg: vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>')` — check first that no existing test in the file relies on the real `buildSvg`; if one does, give the mock a default implementation that calls `actual.buildSvg` and override it only in this test. Then: `keydown({ key: 'F2' })`, `type(…, 'Changed')`, `click('SVG')`, and expect `buildSvg`'s first argument's `byId.get('root000001')!.lines.join(' ')` to contain `Changed`.

Run: `npx vitest run src/editor/EditorPage.test.tsx` — Expected: the three new tests FAIL (the layout passed to the export still has the old text; the notice is absent).

- [ ] **Step 2: Implement in `src/editor/EditorPage.tsx`.** Add `import { flushSync } from 'react-dom';`. In `exportAs`, right after `if (exporting) return;`:

```ts
    // An inline edit still open, or a note still waiting for its pause, goes into the map first, so the
    // file shows what is on screen. flushSync makes the refs below reflect that commit before they are read.
    flushSync(endEdit);
    const current = layoutRef.current;
    const title = stateRef.current.map.title;
```

and use `current` and `title` in the rest of the function wherever it now reads `layout` and `state.map.title` (the three `buildExcalidraw(layout)`, `excalidrawLosses(layout)`, `buildSvg(layout, visibleText(layout))` uses and the two `fileName(state.map.title, …)` uses). `endEdit` is defined above `exportAs` already; it blurs the focused element when an edit is open or the focus is inside `.details`.

- [ ] **Step 3: The rejected-save badge.** In `src/app.css`, the rule `.save-badge.retrying, .save-badge.conflict, .save-badge.unauthorized { color: var(--warn); }` gains `, .save-badge.rejected` in its selector list (a save the server refused is shown in the warning colour like the other failures).

- [ ] **Step 4: Run** `npx vitest run src/editor` then `npm test` and `npm run typecheck` — Expected: all PASS, including the existing export tests (disabled buttons while exporting, the error banner).

- [ ] **Step 5: Commit**

```bash
git add src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/app.css
git commit -m "fix(editor): exports include an edit or note still being typed" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Scripts, styles and fonts are cached for a year

**Files:**
- Modify: `worker/assets.ts`
- Test: `worker/test/assets.spec.ts`, `e2e/prod.spec.ts`
- Modify: `README.md` (the "Check the deploy" block), spec §8

**Interfaces — produces:** `export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';` in `worker/assets.ts`.

**Why.** Every file is answered with `cache-control: public, max-age=0, must-revalidate`, so each time a Notion page with an embed opens, the browser asks the Worker again for the script, the stylesheet and every font subset the map uses. Their names change whenever their content changes, so they can be kept for a year.

- [ ] **Step 1: Failing Worker tests** — add to `worker/test/assets.spec.ts`, using its `withAssets(contentType, extraHeaders)` stub and `get(path, env)` helper:

```ts
describe('long-lived caching for content-hashed files', () => {
  const REVALIDATE = 'public, max-age=0, must-revalidate';
  const FONT = '/fonts/Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2';

  it('caches hashed bundles and font subsets for a year', async () => {
    for (const [path, type] of [
      ['/assets/index-D4btxGR0.js', 'text/javascript'],
      ['/assets/index-Bq3_x-9Z.css', 'text/css'],
      ['/assets/file-open-002ab408-BHUWm0Sh.js', 'text/javascript'],
      [FONT, 'font/woff2'],
      ['/fonts/Xiaolai/Xiaolai-Regular-019d66dcad46dc156b162d267f981c20.woff2', 'font/woff2'],
    ]) {
      const res = await get(path, withAssets(type, { 'Cache-Control': REVALIDATE }));
      expect(res.headers.get('Cache-Control'), path).toBe(IMMUTABLE_CACHE);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('leaves pages, unhashed files and the licence text alone', async () => {
    for (const [path, type] of [
      ['/', 'text/html; charset=utf-8'],
      ['/m/abcdefghijklmnopqrstu', 'text/html'],
      ['/assets/plain.js', 'text/javascript'],
      ['/fonts/OFL.txt', 'text/plain'],
      ['/fonts/Other/Other-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2', 'font/woff2'],
    ]) {
      const res = await get(path, withAssets(type, { 'Cache-Control': REVALIDATE }));
      expect(res.headers.get('Cache-Control'), path).toBe(REVALIDATE);
    }
  });

  it('does not cache the page that answers for a bundle that no longer exists', async () => {
    // not_found_handling: single-page-application answers a missing file with index.html and status 200.
    const res = await get('/assets/gone-AAAAAAAA.js', withAssets('text/html; charset=utf-8', { 'Cache-Control': REVALIDATE }));
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });

  it('does not cache an error answer', async () => {
    const ASSETS = { fetch: async () => new Response('nope', { status: 404, headers: { 'Content-Type': 'text/javascript', 'Cache-Control': REVALIDATE } }) } as unknown as Fetcher;
    const res = await get('/assets/index-D4btxGR0.js', { ...(env as unknown as Env), ASSETS });
    expect(res.headers.get('Cache-Control')).toBe(REVALIDATE);
  });
});
```

Import `IMMUTABLE_CACHE` next to `contentSecurityPolicy`. Run: `npm run test:worker` — Expected: the new tests FAIL.

- [ ] **Step 2: Implement in `worker/assets.ts`.** Above `serveAsset`:

```ts
/** A year, and never re-checked: for files whose name changes whenever their content does. */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
/** Vite's bundles (`<name>-<8-character hash>.<ext>`) and the font subsets (`<Family>-Regular-<md5>.woff2`). */
const CONTENT_HASHED = /^\/(assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+|fonts\/(Excalifont|Xiaolai)\/\2-Regular-[0-9a-f]{32}\.woff2)$/;
```

In `serveAsset`, after the loop that sets the security headers and before the `theme` lines:

```ts
  // Only real files: a bundle name that no longer exists is answered with the HTML page (single-page
  // fallback), and that must not be kept for a year.
  const contentType = upstream.headers.get('Content-Type') ?? '';
  if (upstream.status === 200 && CONTENT_HASHED.test(pathname) && !contentType.includes('text/html')) {
    res.headers.set('Cache-Control', IMMUTABLE_CACHE);
  }
```

Run: `npm run test:worker` and `npm run typecheck` — Expected: PASS.

- [ ] **Step 3: Production-build check** — in `e2e/prod.spec.ts`, at the end of the existing test, add:

```ts
  // Hashed bundles and font subsets are kept for a year; pages are always fetched fresh.
  await page.goto('/');
  const script = (await page.locator('script[type="module"][src]').first().getAttribute('src'))!;
  expect((await page.request.get(script)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  const font = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname).find((p) => p.startsWith('/fonts/')));
  expect(font).toBeTruthy();
  expect((await page.request.get(font!)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect((await page.request.get('/')).headers()['cache-control'] ?? '').not.toContain('immutable');
```

(The list page heading is drawn in Excalifont, so at least one `/fonts/` request has happened by then. If the resource list is empty because the font came from cache, reload once with `page.reload()` before reading it and say so in the report.) Playwright cannot run in a worktree; the controller runs it.

- [ ] **Step 4: Docs.**
  - `README.md`, in the "Check the deploy" code block, add two lines:

```bash
curl -s https://sketchmap.<account>.workers.dev/ | grep -o '/assets/index-[^"]*\.js' | head -1    # the script's path
curl -sI https://sketchmap.<account>.workers.dev/assets/index-XXXXXXXX.js | grep -i cache-control   # public, max-age=31536000, immutable
```

  and after the sentence about the Content-Security-Policy, add: "Scripts, styles and fonts are cached by the browser for a year (their names change when their content does); pages and map data are fetched fresh every time."
  - Spec §8: add a bullet where static files or headers are described: "Content-hashed files (`/assets/*-<hash>.*`, the font subsets) are served with `Cache-Control: public, max-age=31536000, immutable`; HTML and `/api/*` are not cached."

- [ ] **Step 5: Commit**

```bash
git add worker/assets.ts worker/test/assets.spec.ts e2e/prod.spec.ts README.md docs/superpowers/specs/2026-11-12-sketchmap-design.md
git commit -m "feat(worker): cache content-hashed scripts, styles and fonts for a year" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: Browser tests on their own storage; tests for the untested paths

**Files:**
- Modify: `vite.config.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`
- Test: `e2e/smoke.spec.ts` (new tests), `src/io/exportImage.test.ts`, `src/editor/Canvas.test.tsx`

**Why.** The Playwright servers use `.wrangler/state`, the same folder as `npm run dev`: every run leaves its maps in the developer's local list (849 blobs so far), and the dev and preview servers write to one storage at the same time. Pasting or dropping an image and importing an `.xmind` file that carries an image have unit tests only.

- [ ] **Step 1: Storage and ports for the test servers.**
  - `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// The browser tests set SKETCHMAP_STATE so their servers keep maps in their own folder, never in the
// developer's local storage (.wrangler/state). Those servers also skip the debugger port, which two
// servers starting together would fight over.
const testState = process.env.SKETCHMAP_STATE;

export default defineConfig({
  plugins: [react(), cloudflare(testState ? { persistState: { path: testState }, inspectorPort: false } : {})],
});
```

  - `playwright.config.ts`: the `dev` project's `baseURL` becomes `http://localhost:5183` and the `prod` project's `http://localhost:4183`. The two `webServer` entries become:

```ts
    {
      command: 'rm -rf .wrangler/e2e-dev && npm run dev -- --port 5183 --strictPort',
      url: 'http://localhost:5183',
      env: { SKETCHMAP_STATE: '.wrangler/e2e-dev' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'rm -rf .wrangler/e2e-prod && npm run preview -- --port 4183 --strictPort',
      url: 'http://localhost:4183',
      env: { SKETCHMAP_STATE: '.wrangler/e2e-prod' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
```

  with a comment above them: the test servers use their own ports and storage, started empty each run, so a run never touches the maps of a `npm run dev` the developer has open.
  - `e2e/smoke.spec.ts` has two hard-coded `http://localhost:5173/m/${id}` iframe addresses (the Notion-like embed tests). Replace each with an address built from the test's `baseURL` fixture: add `baseURL` to the test's destructured arguments and use `` `${baseURL}/m/${id}` ``.
  - Verify, from the main checkout only (a worktree has no `.dev.vars`; if you are in a worktree, skip the verification and say so): `ls .wrangler/state/v3/r2/sketchmap-maps/blobs | wc -l` before and after `npx playwright test` gives the same number, and `.wrangler/e2e-dev` and `.wrangler/e2e-prod` exist afterwards and contain an `r2` folder somewhere beneath them. If `persistState.path` turns out to resolve differently from what this plan assumes (it is given relative to the project root), adapt the paths, keep them under the git-ignored `.wrangler/`, and report what you found.

- [ ] **Step 2: New browser tests** — append to `e2e/smoke.spec.ts` (it imports `PNG_2x2`, `makeZip`, `openNewMap` already):

```ts
test('an image pasted from the clipboard, or dropped on a topic, lands on that topic', async ({ page }) => {
  await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);
  const ids = await page.locator('g.topic').evaluateAll((els) => els.map((el) => [el.textContent ?? '', el.getAttribute('data-id')!] as const));
  const alpha = ids.find(([text]) => text.includes('Alpha'))![1];
  const root = ids.find(([text]) => !text.includes('Alpha'))![1];

  const send = (kind: 'paste' | 'drop', topicId: string) => page.evaluate(({ kind, topicId, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pic.png', { type: 'image/png' }));
    if (kind === 'paste') {
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    } else {
      const hit = document.querySelector(`g.topic[data-id="${topicId}"] rect.hit`)!;
      hit.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, { kind, topicId, b64: PNG_2x2.toString('base64') });

  await send('paste', alpha); // Alpha is the selected topic after Enter
  await expect(page.locator(`image.topic-image[data-id="${alpha}"]`)).toHaveCount(1);
  await send('drop', root); // a drop goes to the topic under it, not to the selection
  await expect(page.locator(`image.topic-image[data-id="${root}"]`)).toHaveCount(1);
  await expect(page.locator('image.topic-image')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an .xmind file with an image imports the image too', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Owner key').fill('dev-owner-key');
  await page.getByRole('button', { name: 'Continue' }).click();
  const xmind = await makeZip([
    { name: 'content.json', data: JSON.stringify([{
      id: 's', class: 'sheet', title: 'S',
      rootTopic: { id: 'r', title: 'With a picture', children: { attached: [{ id: 'a', title: 'Photo', image: { src: 'xap:resources/pic.png' } }] } },
    }]) },
    { name: 'resources/pic.png', data: new Uint8Array(PNG_2x2), deflate: false },
  ]);
  await page.locator('input[aria-label="XMind file"]').setInputFiles({ name: 'pic.xmind', mimeType: 'application/octet-stream', buffer: Buffer.from(xmind) });
  await expect(page.locator('.import-result')).toContainText('2 topics');
  await page.locator('.import-result a').click();
  await page.waitForURL(/\/e\//);
  const image = page.locator('image.topic-image');
  await expect(image).toHaveCount(1);
  const href = (await image.getAttribute('href'))!;
  expect(href).toMatch(/^\/img\/[A-Za-z0-9_-]{21}\/[A-Za-z0-9_-]{10}\.png$/);
  expect((await page.request.get(href)).status()).toBe(200);
});
```

  If `PNG_2x2` is not a `Buffer` (check `e2e/fixtures/pixel.ts`), convert it accordingly. If the `.import-result` wording for the topic count differs from `2 topics`, match the wording the existing `.xmind` test asserts.

- [ ] **Step 3: Unit tests left open earlier.**
  - `src/io/exportImage.test.ts` (follow how the file stubs the font fetch for `buildSvg`): a map whose topic text is `See [docs](https://example.com/d) now` exports an SVG that contains an `<a` element with `href="https://example.com/d"` whose text is `docs`, and `visibleText(layout)` contains `docs` and does not contain `https://`.
  - `src/editor/Canvas.test.tsx`, next to the existing drag test for the photo and frame ghosts: while a topic that has an image is being dragged, a re-render must not remove its ghosts. Stub `document.elementFromPoint` (with `vi.spyOn`, or by assigning and restoring it in `finally` if jsdom does not define it) to return another topic's `rect.hit`, move the pointer again so the drop target changes and the canvas re-renders (the other topic's group gains the class `drop`), then expect `g.ghost-photo` and `g.ghost-frame` to still be present and the dragged topic's image to exist exactly once in `g.photos-world`.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: PASS. Playwright is run by the controller.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts playwright.config.ts e2e/smoke.spec.ts src/io/exportImage.test.ts src/editor/Canvas.test.tsx
git commit -m "test: browser tests on their own storage and ports; cover pasted, dropped and imported images" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: Other browsers, and the README (done by the controller)

- [ ] **Step 1:** Install Playwright's WebKit and Firefox builds, add two Playwright projects that run `e2e/smoke.spec.ts` in them against the dev server, run them, and sort each failure into: a real defect (fix it, or record it in the README if the fix is out of proportion), a test that drives the browser in a Chromium-only way (mark it Chromium-only with the reason), or a limit of the test browser.
- [ ] **Step 2:** Rewrite `README.md` by subject instead of by build step (what it is; run and deploy; Notion; editing; topics; import and export; dark mode; limits). Every fact stays; the "Known limitations" section gains the measured large-map numbers, what the other-browser runs showed, and what remains unchecked.
- [ ] **Step 3:** Spec §10: add the read retry, the back-online retry and blocked storage to "Failure handling"; add the other-browser projects to "Tests".
