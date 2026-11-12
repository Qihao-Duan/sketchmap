# Step 3b: links and a strict CSP — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Topic text can hold clickable links:
- `[label](https://…)`, and bare `https://…` URLs.
- They are drawn blue with a sketchy underline.
- They open in a new tab: a ⌘/Ctrl-click in the editor, or a plain click in the Notion view.
- They are made with ⌘/Ctrl K or by pasting a URL over selected words, and listed in the details panel.

Before any of that ships, every HTML page gets a strict Content-Security-Policy.

**Architecture:**
- **One parser.** `parseRich(text)` in `src/shared/rich.ts` is the only parser of link syntax. The layout, the renderer, the details panel, the map title (shared with the Worker) and pasting all use it.
- **Layout and renderer.** Layout wraps the *plain* text with character offsets and cuts each line into segments at link boundaries. The renderer draws segments as `<tspan>`s inside SVG `<a>` elements.
- **Opening links.** The Canvas opens links itself with `window.open(…, 'noopener,noreferrer')` and never lets the browser navigate. That way a drag never opens a link, and the editor's plain click still selects.
- **The CSP** comes from the Worker for HTML responses. Production allows same-origin scripts only. Dev also allows Vite's inline React-refresh preamble and the HMR websocket. A new Playwright project runs the production build under `vite preview` and fails on any CSP violation.

**Tech Stack:** React 19, TypeScript 5.9, roughjs 4.6, Cloudflare Workers via `@cloudflare/vite-plugin` (`run_worker_first: true`), Vitest 4 (jsdom, plus the Workers pool), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-sketchmap-design.md`
- §3 "Rich text in `text`"
- §4 (⌘/Ctrl K, paste a URL over selected words, opening links, the details panel's links list)
- §6 Links
- §8 (the href must be http(s))
- §10 (`parseRich` and wrapping-with-offsets unit tests; the ⌘K e2e)
- §11 step 3

## Global Constraints

**Link syntax (spec §3):**
- A link is written `[label](https://…)`. Only `http` and `https` URLs count; anything else stays plain text exactly as typed.
- A bare `http(s)://…` becomes a link automatically. Its label is shortened to the host and path, at most 28 characters.
- `\[`, `\]` and `\\` stand for a literal bracket or backslash. Everything else is plain text, and newlines are allowed. No bold or italics.

**Opening links (spec §4):**
- Editor: a plain click selects the topic, and ⌘/Ctrl-click opens the link in a new tab.
- View page: a plain click opens the link.
- The details panel lists every link in the topic as a normal link.

**Making links (spec §4):**
- ⌘/Ctrl K while editing wraps the selected words as a link. With nothing selected, it wraps the whole text (ruling).
- ⌘/Ctrl K while not editing makes the whole topic a link. The prompt also offers "Remove link" when the topic already has one (ruling).
- Pasting a URL over selected words turns those words into a link.

**Looks (spec §6):** links are blue `#1971c2` with a rough underline, as an SVG `<a target="_blank" rel="noopener noreferrer">`.

**CSP (ruling; the spec, step-1 deferral and ledger say "strict CSP before links"):**
- Production: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`, plus `frame-ancestors 'none'` everywhere except `/m/*`.
- Dev: the same, except `script-src 'self' 'unsafe-inline'` and `connect-src 'self' ws: wss:`.
- **Unchanged:** `/m/*` still sends no framing restriction (spec §7).

**Rulings:**
- Rich-text parsing lives in `src/shared/rich.ts`, not `src/model/`, because the Worker's title code (`src/shared/title.ts`) needs it, and the Worker's tsconfig includes only `src/shared` (plus one model file).
- The map title (§3, "plain text of the root topic") uses `parseRich(...).plain`.

**Keep everything passing:** 223 unit tests, 12 Worker tests and 4 e2e tests, plus `npm run typecheck`.

**Commits:** the subject line comes from the task. The co-author trailer goes only in a separate final `-m` paragraph.

## File map

| File | Change |
|---|---|
| `worker/assets.ts`, `worker/env.d.ts` (new), `worker/test/assets.spec.ts` | CSP |
| `playwright.config.ts`, `e2e/helpers.ts` (new), `e2e/prod.spec.ts` (new), `e2e/smoke.spec.ts` | prod e2e project |
| `src/shared/rich.ts` (new), `src/shared/rich.test.ts` (new), `src/shared/title.ts`, `src/shared/title.test.ts` | parser and helpers |
| `src/layout/wrap.ts`, `src/layout/wrap.test.ts`, `src/layout/map.ts`, `src/layout/styles.ts`, `src/layout/map.test.ts` | offsets and segments |
| `src/render/renderMap.ts`, `src/render/renderMap.test.ts` | drawing links |
| `src/editor/Canvas.tsx`, `src/editor/Canvas.test.tsx` | opening links |
| `src/editor/InlineEditor.tsx`, `src/editor/InlineEditor.test.tsx` | ⌘K while editing, paste over selection |
| `src/editor/keymap.ts`, `src/editor/keymap.test.ts`, `src/editor/store.ts`, `src/editor/store.test.ts`, `src/editor/LinkPrompt.tsx` (new), `src/editor/DetailsPanel.tsx`, `src/editor/EditorPage.tsx`, `src/editor/EditorPage.test.tsx`, `src/app.css` | ⌘K while not editing, the links list |
| `src/io/htmlOutline.ts`, `src/io/htmlOutline.test.ts`, `README.md`, `e2e/smoke.spec.ts` | pasted HTML links, docs, e2e |

**Task order:**
- 1 (CSP) and 2 (parser) are independent.
- 3 needs 2. 4 needs 3. 5 needs 2. 6 needs 2, 3 and 5.
- 7 needs everything.

---

### Task 1: Strict Content-Security-Policy, checked against the production build

**Files:**
- Create: `worker/env.d.ts`, `e2e/helpers.ts`, `e2e/prod.spec.ts`
- Modify: `worker/assets.ts`, `worker/test/assets.spec.ts`, `playwright.config.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Produces `contentSecurityPolicy(pathname: string, dev: boolean): string` and `securityHeaders(pathname, contentType, dev = import.meta.env.DEV)`.
- Produces `openNewMap(page)` in `e2e/helpers.ts`, moved from `smoke.spec.ts`.

- [ ] **Step 1: Write the failing Worker tests.** In `worker/test/assets.spec.ts`:
  - Change the import to `import worker, { type Env } from '../index';` plus `import { contentSecurityPolicy } from '../assets';`.
  - Replace the first two tests with:

```ts
  it('sends a strict CSP that also forbids framing on the list page and the editor', async () => {
    for (const path of ['/', '/e/abcdefghijklmnopqrstu']) {
      const res = await get(path, withAssets('text/html; charset=utf-8'));
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    }
  });

  it('lets the view page be framed anywhere, with the same CSP otherwise', async () => {
    const res = await get('/m/abcdefghijklmnopqrstu', withAssets('text/html', { 'X-Frame-Options': 'DENY' }));
    const csp = res.headers.get('Content-Security-Policy')!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain('frame-ancestors');
    expect(res.headers.get('X-Frame-Options')).toBeNull();
    expect(await res.text()).toBe('body');
  });
```

  - Append:

```ts
describe('contentSecurityPolicy', () => {
  it('production: same-origin scripts only', () => {
    expect(contentSecurityPolicy('/e/x', false)).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it("dev: also Vite's inline React-refresh preamble and the HMR websocket; the view stays frameable", () => {
    const csp = contentSecurityPolicy('/m/x', true);
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('frame-ancestors');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm run test:worker`
Expected: FAIL. `contentSecurityPolicy` is not exported, and the CSP is only `frame-ancestors 'none'`.

- [ ] **Step 3: Implement.** Create `worker/env.d.ts`:

```ts
// Vite replaces import.meta.env.DEV in the Worker bundle too: true under `vite dev`, false in `vite build`.
interface ImportMetaEnv {
  readonly DEV: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

In `worker/assets.ts`, replace `securityHeaders` with:

```ts
/**
 * Content-Security-Policy for the app's HTML. Production allows only same-origin scripts; `vite dev` also needs its
 * inline React-refresh preamble and the HMR websocket. Inline style attributes are allowed: React and the renderer set
 * them. `/m/*` may be framed anywhere (the Notion embed); every other page may not be framed at all.
 */
export function contentSecurityPolicy(pathname: string, dev: boolean): string {
  const directives = [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ];
  if (!pathname.startsWith('/m/')) directives.push("frame-ancestors 'none'");
  return directives.join('; ');
}

export function securityHeaders(pathname: string, contentType: string | null, dev = import.meta.env.DEV): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if ((contentType ?? '').includes('text/html')) headers['Content-Security-Policy'] = contentSecurityPolicy(pathname, dev);
  return headers;
}
```

`serveAsset` stays as it is. For `/m/*` it deletes upstream framing headers before applying ours.

- [ ] **Step 4: Run the Worker tests and the typecheck**

Run: `npm run test:worker && npm run typecheck`
Expected: PASS.

If `import.meta.env` is still untyped for the worker tsconfig, check that `worker/env.d.ts` is included. `tsconfig.worker.json` includes `worker`, so it should be.

If the Workers test pool crashes because `import.meta.env` is undefined at runtime, change the default to `dev = import.meta.env?.DEV === true`, and make `env` optional in `env.d.ts`. Step 5 then proves that dev still gets `true`.

- [ ] **Step 5: Verify both modes by hand. Both checks are mandatory; paste their output into your report.**

```bash
npx vite dev --port 5199 --strictPort &   # wait until it answers
curl -sI http://localhost:5199/e/abc | grep -i content-security    # expect the dev CSP ('unsafe-inline' in script-src)
kill %1
npm run build && (npx vite preview --port 5198 --strictPort &)
curl -sI http://localhost:5198/e/abc | grep -i content-security    # expect script-src 'self'; with no 'unsafe-inline'
pkill -f "vite preview --port 5198"
```

**If the dev server shows the production CSP:** `import.meta.env.DEV` is not replaced in the dev Worker, and the Vite dev page would break on its inline script. Stop and report BLOCKED with the output.

- [ ] **Step 6: Move `openNewMap` into `e2e/helpers.ts`.**
  - Move the function (and its `Page` type import) from `e2e/smoke.spec.ts` into a new `e2e/helpers.ts` as `export async function openNewMap(page: Page): Promise<string>`.
  - Import it in `smoke.spec.ts`.
  - Change nothing else in the step-1 tests.

- [ ] **Step 7: Add a production Playwright project.** Replace `playwright.config.ts` with:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  projects: [
    // Day-to-day e2e against the Vite dev server.
    { name: 'dev', testIgnore: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:5173' } },
    // The built app on the built Worker (vite preview): the real headers, including the production CSP.
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  ],
});
```

Create `e2e/prod.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { openNewMap } from './helpers';

test('the production build works under its strict CSP: editor, PNG export and view', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => {
    if (m.text().startsWith('CSP violation')) violations.push(m.text());
  });

  const res = await page.goto('/');
  expect(res!.headers()['content-security-policy']).toContain("script-src 'self';");
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Alpha');
  await page.keyboard.press('Enter');
  await expect(page.locator('g.topic')).toHaveCount(2);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.goto(`/m/${id}`);
  await expect(page.locator('g.topic')).toHaveCount(2);
  expect(violations).toEqual([]);
});
```

- [ ] **Step 8: Run all e2e tests**

Run: `npx playwright test`
Expected: 5 passed: 4 in `dev` and 1 in `prod`.
- `vite preview` reads `.dev.vars` for the local owner key, so `openNewMap` works there too.
- If the PNG export trips the CSP, report the exact violation. Do not loosen the policy without a written reason.

- [ ] **Step 9: Commit**

```bash
git add worker/assets.ts worker/env.d.ts worker/test/assets.spec.ts playwright.config.ts e2e/helpers.ts e2e/prod.spec.ts e2e/smoke.spec.ts
git commit -m "feat(worker): strict Content-Security-Policy, checked against the production build" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 2: `parseRich` and the link helpers

**Files:**
- Create: `src/shared/rich.ts`, `src/shared/rich.test.ts`
- Modify: `src/shared/title.ts`, `src/shared/title.test.ts`

**Interfaces (produces), all in `src/shared/rich.ts`:**

| Export | Signature or shape |
|---|---|
| `RichLink` | `{ start: number; end: number; href: string; label: string }`. Offsets into `plain`. |
| `parseRich` | `(text: string) => { plain: string; links: RichLink[] }` |
| `shortUrl` | `(href: string) => string` |
| `escapeLabel` | `(s: string) => string` |
| `normalizeHref` | `(input: string) => string \| null` |
| `linkWhole` | `(text: string, href: string \| null) => string` |
| `linkRange` | `(text: string, start: number, end: number, href: string) => { text: string; caret: number }` |

- [ ] **Step 1: Write the failing tests.** Create `src/shared/rich.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { escapeLabel, linkRange, linkWhole, normalizeHref, parseRich, shortUrl } from './rich';

describe('parseRich', () => {
  it('reads [label](url) links, with offsets into the plain text', () => {
    expect(parseRich('Read [the docs](https://example.com/docs) now')).toEqual({
      plain: 'Read the docs now',
      links: [{ start: 5, end: 13, href: 'https://example.com/docs', label: 'the docs' }],
    });
  });

  it('turns bare http(s) URLs into links labelled with the host and path, at most 28 characters', () => {
    const r = parseRich('see https://github.com/excalidraw/excalidraw/issues/123, ok');
    expect(r.links).toEqual([{ start: 4, end: 32, href: 'https://github.com/excalidraw/excalidraw/issues/123', label: 'github.com/excalidraw/excal…' }]);
    expect(r.plain).toBe('see github.com/excalidraw/excal…, ok');
  });

  it('keeps balanced parentheses in a URL and drops trailing punctuation', () => {
    expect(parseRich('(https://en.wikipedia.org/wiki/Map_(disambiguation)).').links[0].href).toBe('https://en.wikipedia.org/wiki/Map_(disambiguation)');
    expect(parseRich('[w](https://en.wikipedia.org/wiki/Map_(x))').links[0].href).toBe('https://en.wikipedia.org/wiki/Map_(x)');
  });

  it('leaves non-web links as the text that was typed', () => {
    expect(parseRich('[x](javascript:alert(1)) and ftp://a.b')).toEqual({ plain: '[x](javascript:alert(1)) and ftp://a.b', links: [] });
  });

  it('reads \\[, \\] and \\\\ as literal characters, also inside labels', () => {
    expect(parseRich('a \\[b\\] c \\\\ d')).toEqual({ plain: 'a [b] c \\ d', links: [] });
    expect(parseRich('[x \\] y](https://a.com)').links[0].label).toBe('x ] y');
  });

  it('uses the short URL as the label of an empty [](url) link, and allows newlines in labels', () => {
    expect(parseRich('[](https://a.com/p/)').plain).toBe('a.com/p');
    expect(parseRich('[two\nlines](https://a.com)').links[0]).toMatchObject({ start: 0, end: 9, label: 'two\nlines' });
  });

  it('does not take a URL glued to a word for a bare link', () => {
    expect(parseRich('xhttps://a.com').links).toEqual([]);
  });
});

describe('link helpers', () => {
  it('shortUrl keeps host and path, drops the scheme and a trailing slash', () => {
    expect(shortUrl('https://www.example.com/')).toBe('www.example.com');
    expect(shortUrl('http://a.com/b/c?q=1')).toBe('a.com/b/c');
  });

  it('escapeLabel escapes brackets and backslashes', () => {
    expect(escapeLabel('a [b] \\ c')).toBe('a \\[b\\] \\\\ c');
  });

  it('normalizeHref accepts web addresses, adds https:// when missing, and rejects the rest', () => {
    expect(normalizeHref(' example.com/docs ')).toBe('https://example.com/docs');
    expect(normalizeHref('http://a.com')).toBe('http://a.com');
    expect(normalizeHref('javascript:alert(1)')).toBeNull();
    expect(normalizeHref('mailto:a@b.c')).toBeNull();
    expect(normalizeHref('two words')).toBeNull();
    expect(normalizeHref('https://a.com/x)y')).toBeNull(); // would not survive [label](href)
    expect(normalizeHref('')).toBeNull();
  });

  it('linkWhole wraps the whole plain text, or with null removes every link', () => {
    expect(linkWhole('Read [docs](https://a.com) [now]', 'https://b.com')).toBe('[Read docs \\[now\\]](https://b.com)');
    expect(linkWhole('Read [docs](https://a.com)', null)).toBe('Read docs');
    expect(parseRich(linkWhole('Plan', 'https://b.com')).links[0]).toMatchObject({ href: 'https://b.com', label: 'Plan' });
  });

  it('linkRange wraps a range and puts the caret after the new link', () => {
    expect(linkRange('Read the docs', 9, 13, 'https://a.com')).toEqual({ text: 'Read the [docs](https://a.com)', caret: 30 });
  });
});
```

**`src/shared/title.test.ts`:** append a test in that file's style:

```ts
  it('uses the plain text of links', () => {
    expect(plainTitle({ id: 'r', text: '[Plan](https://a.com) for https://b.com/x', children: [] })).toBe('Plan for b.com/x');
  });
```

Adapt the import or `describe` wrapper to the file's existing style.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/shared`
Expected: FAIL. `./rich` does not exist, and the title keeps the link syntax.

- [ ] **Step 3: Implement `src/shared/rich.ts`.**

```ts
/** A link inside topic text; start and end are offsets into the plain text. */
export interface RichLink {
  start: number;
  end: number;
  href: string;
  label: string;
}

const URL_BODY = String.raw`(?:[^\s()]|\([^\s()]*\))+`;
// [label](http(s)://…): the label may hold escapes and newlines; the URL may hold one level of balanced parentheses.
const LINK = new RegExp(String.raw`\[((?:\\[\\\[\]]|[^\\\]])*)\]\((https?:\/\/${URL_BODY})\)`, 'iy');
const BARE = new RegExp(String.raw`https?:\/\/${URL_BODY}`, 'iy');
const LABEL_MAX = 28;

const unescapeLabel = (s: string) => s.replace(/\\([\\[\]])/g, '$1');

/** Drops trailing punctuation, and a closing parenthesis that has no opening one in the URL. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"]+$/, '');
  const count = (c: string) => u.split(c).length - 1;
  while (u.endsWith(')') && count('(') < count(')')) u = u.slice(0, -1).replace(/[.,;:!?'"]+$/, '');
  return u;
}

/** Host and path of a URL, at most 28 characters (spec §3). */
export function shortUrl(href: string): string {
  let s: string;
  try {
    const u = new URL(href);
    s = u.host + u.pathname;
  } catch {
    s = href.replace(/^https?:\/\//i, '');
  }
  s = s.replace(/\/$/, '');
  return s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s;
}

/**
 * Topic text → what is shown, plus its links (spec §3). `[label](https://…)` and bare http(s) URLs are links;
 * `\[`, `\]` and `\\` are literal characters; everything else is plain text.
 */
export function parseRich(text: string): { plain: string; links: RichLink[] } {
  let plain = '';
  const links: RichLink[] = [];
  const add = (label: string, href: string) => {
    links.push({ start: plain.length, end: plain.length + label.length, href, label });
    plain += label;
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && /[\\[\]]/.test(text[i + 1] ?? '')) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(text);
      if (m) {
        add(unescapeLabel(m[1]) || shortUrl(m[2]), m[2]);
        i += m[0].length;
        continue;
      }
    }
    if ((c === 'h' || c === 'H') && (i === 0 || !/[\w/]/.test(text[i - 1]))) {
      BARE.lastIndex = i;
      const m = BARE.exec(text);
      if (m) {
        const href = trimUrl(m[0]);
        add(shortUrl(href), href);
        i += href.length;
        continue;
      }
    }
    plain += c;
    i += 1;
  }
  return { plain, links };
}

export const escapeLabel = (s: string): string => s.replace(/[\\[\]]/g, '\\$&');

/** A web address someone typed or pasted → an http(s) href that survives `[label](href)`, or null. */
export function normalizeHref(input: string): string | null {
  const s = input.trim();
  if (!s || /\s/.test(s)) return null;
  const href = /^[a-z][\w+.-]*:/i.test(s) ? s : `https://${s}`;
  if (!/^https?:\/\//i.test(href)) return null;
  try {
    new URL(href);
  } catch {
    return null;
  }
  const back = parseRich(`[x](${href})`).links;
  return back.length === 1 && back[0].href === href ? href : null;
}

/** The whole topic as one link to `href`; with `href` null, the topic's text with every link removed. */
export function linkWhole(text: string, href: string | null): string {
  const label = escapeLabel(parseRich(text).plain);
  return href ? `[${label}](${href})` : label;
}

/** Wraps text[start, end) as a link to `href`; `caret` is the position just after the new link. */
export function linkRange(text: string, start: number, end: number, href: string): { text: string; caret: number } {
  const link = `[${escapeLabel(text.slice(start, end))}](${href})`;
  return { text: text.slice(0, start) + link + text.slice(end), caret: start + link.length };
}
```

**`src/shared/title.ts`:** import `parseRich` from `./rich`, then:
- change the first line of `plainTitle` to `const first = parseRich(root.text).plain.split('\n')[0].trim();`
- update the doc comment to `/** Title for listings: first line of the root's plain text (links show their labels). */`

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/shared && npm run typecheck && npm run test:worker`
Expected: PASS. The Worker also compiles `src/shared/rich.ts`, which uses only `URL` and `RegExp`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/rich.ts src/shared/rich.test.ts src/shared/title.ts src/shared/title.test.ts
git commit -m "feat(shared): parseRich for links in topic text, plus link helpers" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 3: Layout wraps plain text with offsets; the renderer draws links

**Files:**
- Modify: `src/layout/wrap.ts`, `src/layout/wrap.test.ts`, `src/layout/map.ts`, `src/layout/styles.ts`, `src/layout/map.test.ts`, `src/render/renderMap.ts`, `src/render/renderMap.test.ts`

**Interfaces:**
- Consumes `parseRich` (Task 2).
- Produces:
  - `WrappedLine { text: string; start: number }` and `wrapWithOffsets(text, fontSize, maxW, measure): WrappedLine[]`
  - `Segment { text: string; x: number; w: number; href?: string }`
  - `Measured.segments: Segment[][]`, one array per line, with x measured from the line's left edge
  - `LINK_COLOR = '#1971c2'` in `styles.ts`
- **Markup:** `text > a[href][target="_blank"][rel="noopener noreferrer"] > tspan[fill="#1971c2"]`, plus one `g.link-line` (the rough underline) per link segment.

- [ ] **Step 1: Write the failing tests.**

**`src/layout/wrap.test.ts`:** change the import to `import { wrapText, wrapWithOffsets, type Measure } from './wrap';` and append:

```ts
describe('wrapWithOffsets', () => {
  it("gives each line its offset in the text, across wraps and explicit breaks", () => {
    expect(wrapWithOffsets('alpha beta gamma delta\nzeta', 20, 110, measure)).toEqual([
      { text: 'alpha beta', start: 0 },
      { text: 'gamma delta', start: 11 },
      { text: 'zeta', start: 23 },
    ]);
  });
  it('agrees with wrapText, including CJK', () => {
    const w = wrapWithOffsets('中文也是手写体', 20, 30, measure);
    expect(w.map((l) => l.text)).toEqual(wrapText('中文也是手写体', 20, 30, measure));
    expect(w.map((l) => l.start)).toEqual([0, 3, 6]);
  });
});
```

**`src/layout/map.test.ts`:** append:

```ts
describe('links in topics', () => {
  const at = (text: string) => layoutMap(n('r', 'Root', [n('a', 'A', [n('x', text)])]), 'map', measure).byId.get('x')!;

  it('lays out the plain text and cuts the line at link boundaries', () => {
    const t = at('Read [the docs](https://example.com/docs) now');
    expect(t.lines).toEqual(['Read the docs now']);
    expect(t.segments[0]).toEqual([
      { text: 'Read ', x: 0, w: measure('Read ', 17) },
      { text: 'the docs', x: measure('Read ', 17), w: measure('the docs', 17), href: 'https://example.com/docs' },
      { text: ' now', x: measure('Read the docs', 17), w: measure(' now', 17) },
    ]);
  });

  it('keeps the link on every line it wraps onto, after a marker prefix too', () => {
    const t = layoutMap(n('r', 'Root', [n('a', 'A', [n('x', `[${'word '.repeat(8)}end](https://x.com/y)`, [], { emoji: '💡' })])]), 'map', measure).byId.get('x')!;
    expect(t.lines.length).toBeGreaterThan(1);
    expect(t.segments[0][0]).toEqual({ text: '💡 ', x: 0, w: measure('💡 ', 17) });
    for (const line of t.segments) expect(line.filter((s) => s.text.trim()).every((s) => s.href === 'https://x.com/y' || s.text === '💡 ')).toBe(true);
  });

  it('gives a line without links a single plain segment', () => {
    expect(at('Plain').segments).toEqual([[{ text: 'Plain', x: 0, w: measure('Plain', 17) }]]);
  });
});
```

**`src/render/renderMap.test.ts`:** append inside `describe('renderMap', …)`:

```ts
  it('draws links as blue <a> elements that open in a new tab, each with a sketchy underline', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const world = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(world);
    const linked: MapNode = { id: 'r', text: 'Root', children: [{ id: 'l', text: 'Read [the docs](https://example.com/docs) now', children: [] }] };
    renderMap(svg, world, computeLayout(linked, measure), { selectedId: null });
    const topic = world.querySelector('g.topic[data-id="l"]')!;
    const a = topic.querySelector('text a')!;
    expect(a.getAttribute('href')).toBe('https://example.com/docs');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.querySelector('tspan')!.getAttribute('fill')).toBe('#1971c2');
    expect(topic.querySelector('text')!.textContent).toBe('Read the docs now');
    expect(topic.querySelectorAll('g.link-line')).toHaveLength(1);
    expect(world.querySelector('g.topic[data-id="r"] text a')).toBeNull();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/layout src/render`
Expected: the new tests fail.

- [ ] **Step 3: Implement `wrapWithOffsets` in `src/layout/wrap.ts`.** Replace `wrapText` with:

```ts
export interface WrappedLine {
  text: string;
  /** Offset of the line's first character in the wrapped text, so ranges (links) can be mapped onto lines. */
  start: number;
}

/** Greedy wrap with offsets: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapWithOffsets(text: string, fontSize: number, maxW: number, measure: Measure): WrappedLine[] {
  const out: WrappedLine[] = [];
  let paraStart = 0;
  for (const para of text.split('\n')) {
    let line = '';
    let lineStart = paraStart;
    let pos = paraStart;
    for (const tok of para.match(TOKEN) ?? []) {
      const candidate = line + tok;
      if (line.trim() && measure(candidate.trimEnd(), fontSize) > maxW) {
        out.push({ text: line.trimEnd(), start: lineStart });
        const space = /^\s+$/.test(tok);
        line = space ? '' : tok;
        lineStart = space ? pos + tok.length : pos;
      } else {
        if (!line) lineStart = pos;
        line = candidate;
      }
      pos += tok.length;
    }
    out.push({ text: line.trimEnd(), start: lineStart });
    paraStart += para.length + 1;
  }
  return out;
}

/** Greedy wrap: Latin breaks between words, CJK between characters, `\n` always breaks. */
export function wrapText(text: string, fontSize: number, maxW: number, measure: Measure): string[] {
  return wrapWithOffsets(text, fontSize, maxW, measure).map((l) => l.text);
}
```

- [ ] **Step 4: Implement the segments in `src/layout/map.ts` and `src/layout/styles.ts`.**

**`styles.ts`:** append:

```ts
/** Links in topic text (spec §6). */
export const LINK_COLOR = '#1971c2';
```

**`map.ts`:** add the imports `import { parseRich } from '../shared/rich';` and `wrapWithOffsets` from `./wrap`.

**`Segment` and the new field:** add the type, and add `segments` to `Measured` after `lineWidths`:

```ts
/** A run of one line's text: plain, or part of a link. x and w are measured from the line's left edge. */
export interface Segment {
  text: string;
  x: number;
  w: number;
  href?: string;
}
```

```ts
  /** Each line cut at link boundaries. */
  segments: Segment[][];
```

**`splitLine`:** add above `measureTopic`:

```ts
type Range = { start: number; end: number; href: string };

/** Cuts one wrapped line at link boundaries. `start` is the line's offset in the displayed text. */
function splitLine(text: string, start: number, links: Range[], fontSize: number, measure: Measure): Segment[] {
  const cuts = new Set([0, text.length]);
  for (const l of links) {
    const a = l.start - start;
    const b = l.end - start;
    if (b > 0 && a < text.length) {
      cuts.add(Math.max(0, a));
      cuts.add(Math.min(text.length, b));
    }
  }
  const points = [...cuts].sort((p, q) => p - q);
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const piece = text.slice(points[i], points[i + 1]);
    if (!piece) continue;
    const at = start + points[i];
    const link = links.find((l) => at >= l.start && at < l.end);
    out.push({ text: piece, x: measure(text.slice(0, points[i]), fontSize), w: measure(piece, fontSize), ...(link && { href: link.href }) });
  }
  return out.length ? out : [{ text, x: 0, w: measure(text, fontSize) }];
}
```

**`measureTopic`:** replace the `display`, `lines` and `lineWidths` lines with:

```ts
  const rich = parseRich(node.text);
  const prefix = node.emoji ? `${node.emoji} ` : '';
  const display = prefix + rich.plain;
  const wrapped = wrapWithOffsets(display || ' ', style.fontSize, style.maxW, measure);
  const lines = wrapped.map((l) => l.text);
  const lineWidths = lines.map((l) => measure(l, style.fontSize));
  const links = rich.links.map((l) => ({ start: l.start + prefix.length, end: l.end + prefix.length, href: l.href }));
  const segments = wrapped.map((l) => splitLine(l.text, l.start, links, style.fontSize, measure));
```

Also add `segments` to the returned object.

- [ ] **Step 5: Draw links in `src/render/renderMap.ts`.**
  - Add `LINK_COLOR` to the styles import.
  - In the `t.lines.forEach` loop, replace `text.textContent = line;` with:

```ts
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
```

`lx` is the line's left edge; for centred lines it already accounts for centring.

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/layout src/render src/io src/editor && npm run typecheck`
Expected: PASS. Existing layout and renderer tests are unchanged, because a topic without links yields one plain segment per line.

- [ ] **Step 7: Commit**

```bash
git add src/layout/wrap.ts src/layout/wrap.test.ts src/layout/map.ts src/layout/styles.ts src/layout/map.test.ts src/render/renderMap.ts src/render/renderMap.test.ts
git commit -m "feat(render): links in topics, wrapped with offsets and drawn as blue underlined <a>" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 4: The canvas opens links: a click in the view, ⌘/Ctrl-click in the editor

**Files:**
- Modify: `src/editor/Canvas.tsx`
- Test: `src/editor/Canvas.test.tsx`

**Interfaces:**
- Consumes the `<a href>` markup from Task 3.
- Behaviour:
  - Links open only through `window.open(href, '_blank', 'noopener,noreferrer')`, and only for http(s).
  - The browser's own `<a>` navigation is always prevented. A click with `detail === 0`, which comes from keyboard activation, opens the link.
  - A press that moves 6 px or more is a pan or drag, so it does not open the link.
  - A pointercancel never opens a link.

- [ ] **Step 1: Write the failing tests.** Append to `src/editor/Canvas.test.tsx`:

```tsx
describe('links', () => {
  const linked = computeLayout({ id: 'r', text: 'See [docs](https://example.com/d)', children: [] }, (t, s) => t.length * s * 0.5);
  function mountLinked(interactive: boolean) {
    const h = { onSelect: vi.fn(), onEdit: vi.fn(), onMove: vi.fn(), onToggleFold: vi.fn() };
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => createRoot(container).render(<Canvas layout={linked} selectedId={null} interactive={interactive} {...h} />));
    return h;
  }
  const at = (el: Element, type: string, x: number, y: number, mods: MouseEventInit = {}) =>
    act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, ...mods })));
  const link = () => container.querySelector('g.topic a tspan')!;

  it('the view opens a link on a plain click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mountLinked(false);
    at(link(), 'pointerdown', 10, 10);
    at(link(), 'pointerup', 11, 10);
    expect(open).toHaveBeenCalledWith('https://example.com/d', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('the view does not open a link when the press turns into a pan', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mountLinked(false);
    at(link(), 'pointerdown', 10, 10);
    at(link(), 'pointerup', 60, 40);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('the editor selects on a plain click and opens on ⌘/Ctrl-click', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const h = mountLinked(true);
    at(link(), 'pointerdown', 10, 10);
    at(link(), 'pointerup', 10, 10);
    expect(h.onSelect).toHaveBeenCalledWith('r');
    expect(open).not.toHaveBeenCalled();
    h.onSelect.mockClear();
    at(link(), 'pointerdown', 10, 10, { metaKey: true });
    at(link(), 'pointerup', 10, 10, { metaKey: true });
    expect(open).toHaveBeenCalledWith('https://example.com/d', '_blank', 'noopener,noreferrer');
    expect(h.onSelect).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('never lets the browser follow a link by itself; keyboard activation opens it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    mountLinked(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    act(() => void link().dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    act(() => void link().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/editor/Canvas.test.tsx`
Expected: the four new tests fail.

- [ ] **Step 3: Implement in `src/editor/Canvas.tsx`.**

**`Gesture` type:** extend it. `pan` gains `link`, and there is a new `link` kind:

```ts
  | { kind: 'pan'; x: number; y: number; tx: number; ty: number; link: string | null }
  | { kind: 'topic'; id: string; x: number; y: number; moved: boolean; dbl: boolean; ghost: SVGGElement | null }
  | { kind: 'link'; x: number; y: number; href: string };
```

**`openLink`:** add above the component:

```ts
/** Opens a topic's link in a new tab, without giving that page a handle on this one. */
function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) window.open(href, '_blank', 'noopener,noreferrer');
}
```

**`onPointerDown`:**
- After the fold check, before `setPointerCapture`, add:

```ts
    const href = target.closest('a')?.getAttribute('href') ?? null;
    if (href && interactive && (e.metaKey || e.ctrlKey)) {
      gesture.current = { kind: 'link', x: e.clientX, y: e.clientY, href };
      return;
    }
```

- Give the pan gesture its link: `gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty, link: interactive ? null : href };`.

**`onPointerMove`:** after `if (!g) return;` and the `buttons === 0` recovery, add `if (g.kind === 'link') return;`.

**Ending a gesture:** replace `onPointerUp` with:

```ts
  const endGesture = (e: PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const still = Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6;
    if (g.kind === 'link') {
      if (still && !cancelled) openLink(g.href);
      return;
    }
    if (g.kind === 'pan') {
      if (g.link && still && !cancelled) openLink(g.link);
      return;
    }
    if (g.moved) {
      g.ghost?.remove();
      const target = dropRef.current;
      setDrop(null);
      if (target) onMove?.(g.id, target);
    } else if (g.dbl) {
      onEdit?.(g.id);
    }
  };
```

**`releaseGesture`:** if it switches on `g.kind`, make sure the `link` kind is handled. It needs no cleanup.

**The `<svg>`:**
- `onPointerUp={(e) => endGesture(e, false)}`
- `onPointerCancel={(e) => endGesture(e, true)}`
- add:

```tsx
        onClick={(e) => {
          // Links open from the pointer handlers above, or here from the keyboard; never by the browser's own navigation.
          const a = (e.target as Element).closest('a');
          if (!a) return;
          e.preventDefault();
          if (e.detail === 0) openLink(a.getAttribute('href') ?? '');
        }}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/editor src/view && npm run typecheck`
Expected: PASS. The existing Canvas tests still pass: pointerup handling for topics is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/editor/Canvas.tsx src/editor/Canvas.test.tsx
git commit -m "feat(editor): open topic links (click in the view, Cmd/Ctrl-click in the editor), never by navigation" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 5: While editing: ⌘/Ctrl K links the selected words; pasting a URL over a selection links it

**Files:**
- Modify: `src/editor/InlineEditor.tsx`, `src/app.css`
- Test: `src/editor/InlineEditor.test.tsx`

**Interfaces:**
- Consumes `normalizeHref` and `linkRange` (Task 2).
- **Markup:**
  - The link field is `input[aria-label="Link URL"]`, absolutely positioned below the textarea.
  - Its error is `p[role="alert"]` with the text "Use a web address starting with http:// or https://".

- [ ] **Step 1: Write the failing tests.** Append inside `describe('InlineEditor', …)`:

```tsx
  it('⌘/Ctrl K links the selected words: type a web address, Enter, and the editor keeps going', () => {
    const { ta, onCommit, onCancel } = mount({ initialText: 'Read the docs', selectAll: false });
    act(() => ta.setSelectionRange(9, 13));
    key(ta, { key: 'k', metaKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    expect(document.activeElement).toBe(url);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'example.com/docs');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(container.querySelector('input[aria-label="Link URL"]')).toBeNull();
    expect(ta.value).toBe('Read the [docs](https://example.com/docs)');
    expect(document.activeElement).toBe(ta);
    expect(onCommit).not.toHaveBeenCalled();
    key(ta, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Read the [docs](https://example.com/docs)');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('⌘/Ctrl K with nothing selected links the whole text; a bad address shows an error and changes nothing', () => {
    const { ta } = mount({ initialText: 'Plan', selectAll: false });
    key(ta, { key: 'k', ctrlKey: true });
    const url = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(url, 'javascript:alert(1)');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('http://');
    expect(ta.value).toBe('Plan');
    act(() => {
      setter.call(url, 'https://a.com');
      url.dispatchEvent(new Event('input', { bubbles: true }));
    });
    key(url, { key: 'Enter' });
    expect(ta.value).toBe('[Plan](https://a.com)');
  });

  it('Escape in the link field closes only the field', () => {
    const { ta, onCancel } = mount({ initialText: 'Plan', selectAll: true });
    key(ta, { key: 'k', metaKey: true });
    key(container.querySelector('input[aria-label="Link URL"]')!, { key: 'Escape' });
    expect(container.querySelector('input[aria-label="Link URL"]')).toBeNull();
    expect(document.activeElement).toBe(ta);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('pasting a web address over selected words links them; other pastes are left alone', () => {
    const { ta } = mount({ initialText: 'Read the docs', selectAll: false });
    const paste = (text: string) => {
      const ev = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      act(() => void ta.dispatchEvent(ev));
      return ev;
    };
    act(() => ta.setSelectionRange(9, 13));
    expect(paste('https://example.com/docs').defaultPrevented).toBe(true);
    expect(ta.value).toBe('Read the [docs](https://example.com/docs)');
    act(() => ta.setSelectionRange(0, 4));
    expect(paste('not a url').defaultPrevented).toBe(false);
    act(() => ta.setSelectionRange(3, 3));
    expect(paste('https://b.com').defaultPrevented).toBe(false); // no selection: a normal paste (a bare URL)
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/editor/InlineEditor.test.tsx`
Expected: the new tests fail.

- [ ] **Step 3: Implement in `src/editor/InlineEditor.tsx`.**

**Import:** `import { linkRange, normalizeHref } from '../shared/rich';`.

**State and refs:** add inside the component:

```tsx
  const [link, setLink] = useState<{ start: number; end: number; error: boolean } | null>(null);
  const [url, setUrl] = useState('');
  const urlRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  /** True while focus moves between the textarea and the link field on purpose, so neither blur ends the edit. */
  const moving = useRef(false);
  const caret = useRef<number | null>(null);

  const focusQuietly = (el: HTMLElement | null) => {
    moving.current = true;
    el?.focus();
    moving.current = false;
  };
  useLayoutEffect(() => {
    if (link) focusQuietly(urlRef.current);
  }, [link === null]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (caret.current === null) return;
    focusQuietly(ref.current);
    ref.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  const applyLink = (start: number, end: number, href: string) => {
    const next = linkRange(valueRef.current, start, end, href);
    caret.current = next.caret;
    setValue(next.text);
  };
```

The repo has no ESLint, so drop the `eslint-disable-line` comment.

**Textarea `onKeyDown`:** after `e.stopPropagation();`, add:

```tsx
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const ta = e.currentTarget;
          const [start, end] = ta.selectionStart === ta.selectionEnd ? [0, ta.value.length] : [ta.selectionStart, ta.selectionEnd];
          setUrl('');
          setLink({ start, end, error: false });
          return;
        }
```

**Textarea `onBlur`:** replace it with:

```tsx
      onBlur={(e) => {
        if (moving.current || e.relatedTarget === urlRef.current) return;
        finish(() => onCommit(valueRef.current));
      }}
```

**Textarea `onPaste`:** add:

```tsx
      onPaste={(e) => {
        const ta = e.currentTarget;
        if (ta.selectionStart === ta.selectionEnd) return;
        const pasted = e.clipboardData.getData('text/plain').trim();
        const href = /^https?:\/\/\S+$/i.test(pasted) ? normalizeHref(pasted) : null;
        if (!href) return;
        e.preventDefault();
        applyLink(ta.selectionStart, ta.selectionEnd, href);
      }}
```

**The link field:** return a fragment, with the textarea followed by:

```tsx
      {link && (
        <>
          <input
            ref={urlRef}
            className="inline-link"
            aria-label="Link URL"
            placeholder="Paste or type a link, then Enter"
            value={url}
            style={{ left: style.left, top: (style.top as number) + (style.height as number) + 6, width }}
            onChange={(e) => {
              setUrl(e.target.value);
              setLink({ ...link, error: false });
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                const href = normalizeHref(url);
                if (!href) {
                  setLink({ ...link, error: true });
                  return;
                }
                focusQuietly(ref.current);
                setLink(null);
                applyLink(link.start, link.end, href);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                focusQuietly(ref.current);
                setLink(null);
              }
            }}
            onBlur={(e) => {
              if (moving.current || e.relatedTarget === ref.current) return;
              setLink(null);
              finish(() => onCommit(valueRef.current));
            }}
          />
          {link.error && (
            <p className="inline-link-error error" role="alert" style={{ left: style.left, top: (style.top as number) + (style.height as number) + 44 }}>
              Use a web address starting with http:// or https://
            </p>
          )}
        </>
      )}
```

The `style` object already has numeric `left`, `top` and `height`. Keep them numeric.

- [ ] **Step 4: Add the styles to `src/app.css`.** Append:

```css
.inline-link { position: absolute; z-index: 5; box-sizing: border-box; font: 13px var(--ui); padding: 6px 8px; border: 1.5px solid var(--accent); border-radius: 6px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow); outline: none; }
.inline-link-error { position: absolute; z-index: 5; margin: 0; font-size: 12px; background: var(--surface); padding: 2px 6px; border-radius: 6px; }
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/editor && npm run typecheck`
Expected: PASS, including every existing InlineEditor and EditorPage test.

- [ ] **Step 6: Commit**

```bash
git add src/editor/InlineEditor.tsx src/editor/InlineEditor.test.tsx src/app.css
git commit -m "feat(editor): Cmd/Ctrl K links the selected words while editing; pasting a URL over a selection links it" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 6: ⌘/Ctrl K on a selected topic links the whole topic; the details panel lists links

**Files:**
- Create: `src/editor/LinkPrompt.tsx`
- Modify: `src/editor/keymap.ts`, `src/editor/store.ts`, `src/editor/DetailsPanel.tsx`, `src/editor/EditorPage.tsx`, `src/app.css`
- Test: `src/editor/keymap.test.ts`, `src/editor/store.test.ts`, `src/editor/EditorPage.test.tsx`

**Interfaces:**
- Consumes `linkWhole`, `normalizeHref` and `parseRich` (Task 2).
- Produces:
  - `Command { type: 'link' }`, from ⌘/Ctrl K
  - `EditorAction { type: 'setLink'; id: string; href: string | null }`
  - `LinkPrompt({ hasLink, onApply(href | null), onClose })`, rendered as `aside[aria-label="Link"]`, with `input[aria-label="Link URL"]` and the buttons "Link", "Remove link" and "Cancel"
  - The details panel's `ul.links` list, and a plain-text title

- [ ] **Step 1: Write the failing tests.**

**`keymap.test.ts`:** add the rows `[k('k', { metaKey: true }), { type: 'link' }]` and `[k('K', { ctrlKey: true }), { type: 'link' }]`.

**`store.test.ts`:** append:

```ts
describe('setLink', () => {
  it('links a whole topic, removes the link with null, one undo step each; no change changes nothing', () => {
    let s = initEditor(base());
    s = reduce(s, { type: 'setLink', id: 'a', href: 'https://a.com' });
    expect(s.map.root.children[0].text).toBe('[A](https://a.com)');
    s = reduce(s, { type: 'setLink', id: 'a', href: null });
    expect(s.map.root.children[0].text).toBe('A');
    expect(s.past).toHaveLength(2);
    expect(reduce(s, { type: 'setLink', id: 'a', href: null })).toBe(s);
    expect(reduce(s, { type: 'setLink', id: 'gone', href: 'https://a.com' })).toBe(s);
  });
});
```

**`EditorPage.test.tsx`:** add inside `describe('Editor', …)`:

```tsx
  it('⌘K on the selected topic links it; Remove link takes it off; each is one undo step', async () => {
    mount(fakeApi());
    keydown({ key: 'k', metaKey: true });
    const input = () => container.querySelector('[aria-label="Link"] input[aria-label="Link URL"]') as HTMLInputElement;
    typeInput(input(), 'example.com');
    keydown({ key: 'Enter' }, input());
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
    expect(container.querySelector('g.topic a')!.getAttribute('href')).toBe('https://example.com');
    const listed = container.querySelector('[aria-label="Topic details"] .links a')!;
    expect(listed.textContent).toBe('Root ↗');
    expect(listed.getAttribute('rel')).toBe('noopener noreferrer');
    keydown({ key: 'k', metaKey: true });
    await click('Remove link');
    expect(container.querySelector('g.topic a')).toBeNull();
    keydown({ key: 'z', metaKey: true });
    expect(container.querySelector('g.topic a')).not.toBeNull();
  });

  it('⌘K refuses a non-web address and Escape closes the prompt', () => {
    mount(fakeApi());
    keydown({ key: 'k', ctrlKey: true });
    const input = container.querySelector('input[aria-label="Link URL"]') as HTMLInputElement;
    typeInput(input, 'javascript:alert(1)');
    keydown({ key: 'Enter' }, input);
    expect(container.querySelector('[aria-label="Link"] [role="alert"]')!.textContent).toContain('http://');
    expect(container.querySelector('g.topic a')).toBeNull();
    keydown({ key: 'Escape' }, input);
    expect(container.querySelector('[aria-label="Link"]')).toBeNull();
  });

  it('the details panel shows the plain title of a linked topic', () => {
    mount(fakeApi(), { ...map, root: { ...map.root, text: '[Plan](https://a.com) ahead' } });
    expect(container.querySelector('[aria-label="Topic details"] .topic-title')!.textContent).toBe('Plan ahead');
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/editor`
Expected: the new tests fail.

- [ ] **Step 3: Implement.**

**`keymap.ts`:**
- Add `| { type: 'link' }` to `Command`.
- In the meta/ctrl branch, after the `y` line, add `if (key === 'k') return { type: 'link' };`.

**`store.ts`:**
- Import `linkWhole` from `'../shared/rich'`.
- Add `| { type: 'setLink'; id: string; href: string | null }` to `EditorAction`.
- Add the case, before `case 'undo'`:

```ts
    case 'setLink': {
      if (state.editing) return state;
      const f = T.findNode(state.map.root, action.id);
      if (!f) return state;
      const text = linkWhole(f.node.text, action.href);
      if (text === f.node.text || text.length > 5000) return state;
      return commit(state, produce(state.map, (d) => void T.setText(d.root, action.id, text)));
    }
```

**`LinkPrompt.tsx`:**

```tsx
import { useState } from 'react';
import { normalizeHref } from '../shared/rich';

export interface LinkPromptProps {
  /** The topic already has a link: offer to remove it. */
  hasLink: boolean;
  /** An http(s) address to link the whole topic to, or null to remove its links. */
  onApply(href: string | null): void;
  onClose(): void;
}

/** ⌘/Ctrl K on a selected topic: link the whole topic. */
export function LinkPrompt({ hasLink, onApply, onClose }: LinkPromptProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const apply = () => {
    const href = normalizeHref(url);
    if (href) onApply(href);
    else setError(true);
  };
  return (
    <aside
      className="float link-prompt"
      aria-label="Link"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <label className="field">
        <span className="flabel">Link the whole topic to</span>
        <input
          autoFocus
          aria-label="Link URL"
          placeholder="https://…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            }
          }}
        />
      </label>
      {error && <p role="alert" className="error">Use a web address starting with http:// or https://</p>}
      <div className="row">
        <button type="button" className="primary" onClick={apply}>Link</button>
        {hasLink && <button type="button" onClick={() => onApply(null)}>Remove link</button>}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </aside>
  );
}
```

**`DetailsPanel.tsx`:**
- Import `parseRich` from `'../shared/rich'`.
- Compute `const rich = parseRich(node.text);`.
- Change the title to `(node.emoji ? `${node.emoji} ` : '') + (rich.plain.split('\n')[0].trim() || 'Untitled topic')`.
- After the Note `<label>`, add:

```tsx
      {rich.links.length > 0 && (
        <div className="field">
          <span className="flabel">Links in this topic</span>
          <ul className="links">
            {rich.links.map((l, i) => (
              <li key={`${i}-${l.href}`}>
                <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>
                <span>{l.href}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted hint">While editing a topic, select words and press ⌘/Ctrl K, or paste a link over them.</p>
```

**`EditorPage.tsx`:**
- Import `LinkPrompt` and `parseRich`.
- Add the state `const [linkFor, setLinkFor] = useState<string | null>(null);`.
- Change `modalRef.current = conflict || askKey || outlineOpen || linkFor !== null;`.
- In `run`'s switch, before `default:`, add:

```ts
      case 'link':
        setLinkFor(s.selectedId);
        return;
```

- Render inside `<main className="editor-stage">`, after the OutlinePanel block:

```tsx
        {linkFor && findNode(state.map.root, linkFor) && (
          <LinkPrompt
            key={`link-${linkFor}`}
            hasLink={parseRich(findNode(state.map.root, linkFor)!.node.text).links.length > 0}
            onApply={(href) => {
              dispatch({ type: 'setLink', id: linkFor, href });
              setLinkFor(null);
            }}
            onClose={() => setLinkFor(null)}
          />
        )}
```

**`app.css`:** append:

```css
.details .links { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.details .links a { color: var(--accent); font-weight: 600; overflow-wrap: anywhere; }
.details .links span { display: block; font-size: 11.5px; color: var(--ink-2); overflow-wrap: anywhere; }
.details .hint { font-size: 11.5px; margin: 0; }
.link-prompt { left: 50%; top: 12px; transform: translateX(-50%); width: min(380px, calc(100% - 24px)); box-sizing: border-box; padding: 14px; display: flex; flex-direction: column; gap: 8px; z-index: 6; }
.link-prompt input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); color: var(--ink); }
.link-prompt .row { display: flex; flex-wrap: wrap; gap: 6px; }
.link-prompt button { border: 1px solid var(--line); }
.link-prompt button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/editor/LinkPrompt.tsx src/editor/keymap.ts src/editor/keymap.test.ts src/editor/store.ts src/editor/store.test.ts src/editor/DetailsPanel.tsx src/editor/EditorPage.tsx src/editor/EditorPage.test.tsx src/app.css
git commit -m "feat(editor): Cmd/Ctrl K links a whole topic; the details panel lists a topic's links" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

### Task 7: Pasted HTML links, README, end-to-end test

**Files:**
- Modify: `src/io/htmlOutline.ts`, `src/io/htmlOutline.test.ts`, `README.md`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes `escapeLabel` and `normalizeHref` (Task 2), the markup from Tasks 3 and 4, and the flows from Tasks 5 and 6.

- [ ] **Step 1: Write the failing test.** In `src/io/htmlOutline.test.ts`, add:

```ts
  it('keeps web links from pasted lists as [label](url), and drops other links to their text', () => {
    const parsed = parseHtmlOutline('<ul><li>Read <a href="https://example.com/docs">the [docs]</a> and <a href="javascript:x()">this</a></li></ul>')!;
    expect(parsed.root.text).toBe('Read [the \\[docs\\]](https://example.com/docs) and this');
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/io/htmlOutline.test.ts`
Expected: FAIL. Today the link's text is kept, but its URL is lost.

- [ ] **Step 3: Implement.** In `src/io/htmlOutline.ts`:
  - Import `escapeLabel` and `normalizeHref` from `'../shared/rich'`.
  - In `textLines`'s `walk`, right after the `SKIP` check and before the `BR` check, add:

```ts
    if (n.tagName === 'A') {
      const href = normalizeHref(n.getAttribute('href') ?? '');
      const label = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (href && /^https?:\/\//i.test(n.getAttribute('href') ?? '') && label) {
        lines[lines.length - 1] += `[${escapeLabel(label)}](${href})`;
        return;
      }
    }
```

  The extra `/^https?:/` check stops `normalizeHref` from turning a scheme-less relative link into `https://…`.

- [ ] **Step 4: Add the end-to-end test.** Append to `e2e/smoke.spec.ts`:

```ts
test('a link made with Cmd/Ctrl K survives a reload and opens from the view', async ({ page, context }) => {
  await context.route('https://example.com/**', (r) => r.fulfill({ body: 'ok', contentType: 'text/plain' }));
  const id = await openNewMap(page);
  await page.keyboard.press('Tab');
  await page.keyboard.type('Read the docs');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('example.com/docs');
  await page.keyboard.press('Enter'); // applies the link
  await page.keyboard.press('Enter'); // commits the topic
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.locator('g.topic a', { hasText: 'docs' })).toHaveAttribute('href', 'https://example.com/docs');
  await page.goto(`/m/${id}`);
  const popup = context.waitForEvent('page');
  await page.locator('g.topic a', { hasText: 'docs' }).click();
  await (await popup).waitForURL('https://example.com/docs');
});
```

- [ ] **Step 5: Update `README.md`.** Add a "Links" part to the step-3 section, in the README's style:
  - Write links as `[label](https://…)` in a topic, or paste a bare `https://…` address.
  - While editing, select words and press ⌘/Ctrl K, or paste a link over them.
  - On a selected topic, ⌘/Ctrl K links the whole topic, with "Remove link" to take it off.
  - Links open with ⌘/Ctrl-click in the editor and with a plain click in the Notion view. The Details panel lists them.

  Add one line under the deployment/security notes: "Every page is served with a strict Content-Security-Policy (same-origin scripts only); `npx playwright test` checks it against the production build."

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run test:worker && npx playwright test`
Expected: all pass. e2e has 6 tests: 5 dev and 1 prod.

- [ ] **Step 7: Commit**

```bash
git add src/io/htmlOutline.ts src/io/htmlOutline.test.ts README.md e2e/smoke.spec.ts
git commit -m "feat(io): keep links from pasted HTML lists; e2e for Cmd/Ctrl K links; README" -m "Co-Authored-By: <your model> <noreply@anthropic.com>"
```

---

## Self-review notes

**Spec coverage:**

| Spec item | Task |
|---|---|
| §3 parseRich (links, bare URLs, ≤ 28-char labels, escapes, http(s) only) | 2 |
| §3 title is the plain text | 2 |
| §4 ⌘K while editing | 5 |
| §4 ⌘K while not editing | 6 |
| §4 paste a URL over selected words | 5 |
| §4 opening links | 4 |
| §4 details panel's links list | 6 |
| §6 link looks | 3 |
| §8 href must be http(s) | 2 (parse), 5–7 (input) |
| §10 parseRich, wrapping with offsets, ⌘K e2e | 2, 3, 7 |
| Strict CSP, deferred since step 1 | 1 |
| Deferred step-2 item: links from pasted HTML | 7 |

**Not in this plan:**
- Search: there is no search feature yet.
- The `.xmind` `href` import: plan 3c.
- The step-3a deferral "export buttons should flush a pending note": still deferred.
- The step-3a deferral "check Notion's HTML clipboard for bold": a manual check, which needs the user's Notion.

**Types:** these names are used consistently across tasks:
- `RichLink`, `parseRich`, `shortUrl`, `escapeLabel`, `normalizeHref`, `linkWhole` and `linkRange`
- `WrappedLine`, `wrapWithOffsets` and `Segment` (`segments`)
- `LINK_COLOR`
- `Command 'link'` and `EditorAction 'setLink'`
- `LinkPrompt`, and the aria-labels "Link" and "Link URL"
