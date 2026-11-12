# Sketchmap: design spec

Date: 2026-11-12 · Status: draft for review · "Sketchmap" is a working name.

## 1. What we are building

A web app for **XMind-style mindmaps that look hand-drawn like Excalidraw** and can be **embedded in Notion pages**.

- You build the map with the keyboard: Tab, Enter, Delete, arrow keys. Layout is automatic.
- It is drawn with the same pieces Excalidraw uses: rough.js strokes, the Excalifont handwriting font, the Xiaolai fallback for Chinese text, and Open Color colours.
- In Notion, a view-only embed shows the map. Editing happens in a normal browser tab.

Throwaway references (not part of the codebase):
- Demo: https://claude.ai/artifact/7jGf5CjzYtg3yTbTs6hF5G
- Pitch deck: https://claude.ai/artifact/FkCeEPoYDDRJzYYdzSgGzr

### Decisions already made

| Topic | Decision |
|---|---|
| Core model | A structured mindmap: the tree is the document and the layout is computed. Not a freeform whiteboard. |
| Notion use | View-only embed in Notion. Editing happens in a full tab. |
| Users | One editor (the owner). Anyone who has a map's view link can see that map. No accounts. |
| Extras in v1 | Markdown in/out, `.xmind` import, rich topics (notes, inline links, markers, images), importance levels and priority badges, three layouts. Shipped in four steps (§11). |
| Hosting | Cloudflare: one Worker serves the static assets and the API; R2 stores maps and images. |
| Rendering | Our own renderer built from rough.js and the Excalidraw fonts. We do not wrap the `@excalidraw/excalidraw` editor. |

### Not in scope

- Real-time co-editing
- Multiple users or accounts
- Freehand drawing on the canvas. Use "Export to .excalidraw" for that.
- A native Notion block or integration
- A mobile-optimised editor (touch works, but it isn't polished)

## 2. Architecture

```
src/
  model/     tree types, edits (immer), undo/redo, rich-text parsing     – no DOM, no network
  layout/    tree → positioned topics + branch paths; map | logic | org   – no DOM (text measuring is passed in)
  render/    positioned tree → SVG with rough.js; shared by editor + view
  editor/    React shell: selection, keys, inline text editing, drag, pan/zoom, panels, autosave
  view/      read-only page for the Notion embed (render/ + pan/zoom/fold only)
  io/        markdown in/out, .xmind import, .excalidraw / SVG / PNG export
  api/       typed client for the Worker API
worker/      Cloudflare Worker: API routes, auth, R2 access, security headers
```

- **Rule:** `model/` and `layout/` never touch the DOM or the network, so they can be unit-tested directly.
- **Code-splitting:** `/m/:id` loads only `render/` and `view/`, so the embed stays small.
- **Stack:**
  - React 19, TypeScript and Vite
  - immer for edits
  - rough.js 4.6
  - Vitest for unit tests and Playwright for end-to-end tests
  - wrangler for the Worker
  - `@cloudflare/vitest-plugin` for the Worker tests (the renamed `@cloudflare/vitest-pool-workers`)

### Pages

| Route | What it is |
|---|---|
| `/` | Your maps (title, last edited), plus "New map". Needs the owner key. |
| `/e/:id` | The editor. Needs the owner key. |
| `/m/:id` | The read-only view used as the Notion embed. Public to anyone with the link. |

The owner key is a long random secret, stored as a Worker secret. Each browser asks for it once and then keeps it in `localStorage`.

Map IDs are 21-character nanoids, so view links can't be guessed. Without the key, a visitor can only view maps whose link they have.

## 3. Data model

```ts
type MindMap = {
  id: string;                 // nanoid(21)
  title: string;              // = plain text of the root topic, kept for listing
  layout: "map" | "logic" | "org";
  version: number;            // +1 on every save
  updatedAt: string;          // ISO 8601
  root: MapNode;
};

type MapNode = {
  id: string;                 // nanoid(10), unique within the map
  text: string;               // rich text, see below
  children: MapNode[];
  collapsed?: boolean;
  note?: string;              // plain text, multi-line
  emoji?: string;             // one marker from the marker set, e.g. "💡"
  emphasis?: "key" | "highlight" | "aside";   // importance; absent = normal
  priority?: 1 | 2 | 3;       // numbered priority badge
  image?: { key: string; w: number; h: number };  // R2 key + display size in px
  color?: string;             // optional branch colour override (Open Color hex)
};
```

### Rich text in `text`

`text` stores a small, fixed subset of Markdown, so links survive copy, paste and export unchanged.

- **Link:** `[label](https://…)`. Only `http` and `https` URLs count.
- **Bare URL:** `http(s)://…` becomes a link automatically. Its label is shortened to the host and path, at most 28 characters. A bare URL is always a link; there is no syntax to write one as plain text.
- **Escapes:** `\[`, `\]` and `\\` stand for a literal bracket or backslash.
- Everything else is plain text, and newlines are allowed. No bold or italics in v1.
- One pure function, `parseRich(text)`, returns `{ plain, links: { start, end, href, label }[] }`. Every consumer goes through it: renderer, details panel, search and export.

### Importance and priority

Topics can stand out from the map in two independent ways, both set from the sidebar or the keyboard.

- **Importance** (`emphasis`) changes how the topic itself is drawn. There are four levels, lowest to highest: Aside, Normal (the default), Highlight, Key. Each look is described in §6.
- **Priority** (`priority`) adds a numbered badge before the text: ① red, ② orange, ③ blue, the way XMind's priority markers work.

The two combine freely, and both work together with a marker emoji.

The **marker set** is 💡 ✅ ⚠️ ❓ ⭐ 📌 🔥 ❌ 📅 👤, one marker per topic.

### Images

- **What's stored:** the topic holds only an R2 key and a display size. The file itself lives in R2 under `img/<mapId>/<nanoid>.<ext>`.
- **Before upload**, the browser re-encodes every image:
  - The longest side is scaled down to at most 2048 px.
  - Images with transparency become PNG; everything else becomes JPEG at quality 0.85.
  - SVG files are rejected, because an SVG can carry script.
- **Sizes:** the display width defaults to 200 px. S, M and L presets set 120, 200 and 300 px, the aspect ratio is kept, and v1 has no free drag-resize.
- **Limits:** the server rejects uploads over 5 MB. A map's JSON is capped at 2 MB, which is thousands of topics.

## 4. Editor behaviour

| Input | Action |
|---|---|
| Tab | New child topic, opened for typing |
| Enter | New sibling topic below (on the root it adds a child) |
| Space, F2, double-click, or typing a letter | Edit the text. The editor works with Chinese IME composition, but starting an edit by typing only works for non-IME keys. |
| Delete / Backspace | Remove the topic and its branch. Selection moves to the next sibling, else the previous one, else the parent. |
| Arrow keys | Move to the nearest topic in that direction, spatially, so it works the same in every layout |
| `/` or ⌘/Ctrl / | Fold or unfold the branch |
| ⌘/Ctrl Z, ⇧⌘Z / Ctrl Y | Undo / redo, up to 200 steps |
| ⌘/Ctrl K | While editing: wrap the selected words as a link. Not editing: make the whole topic a link. |
| Alt ↑ / Alt ↓ | Raise or lower importance (Aside ↔ Normal ↔ Highlight ↔ Key) |
| Alt 1 / 2 / 3, Alt 0 | Set priority ①②③, or clear it. Uses `KeyboardEvent.code`, so it also works on macOS, where Option+digit types a symbol. |
| Paste a URL over selected words | Those words become a link |
| Paste multi-line text | Parsed as an outline (headings or nested bullets) and added under the selected topic |
| Paste or drop an image | Attached to the selected topic, or to the topic you dropped it on |
| Drag a topic onto another | Moves the whole branch there. Dropping a topic into its own branch is refused. |
| Wheel, ⌘/Ctrl wheel, drag on background | Pan, zoom, pan |

How the remaining behaviours work:
- **Editing text:**
  - The text is edited in a `<textarea>` placed over the topic, showing the raw text with link syntax.
  - Enter commits, Shift+Enter adds a line break, Esc cancels.
  - A new topic left empty is removed.
- **Opening links:** in the editor, a plain click selects the topic and ⌘/Ctrl-click opens the link in a new tab. In the view page, a plain click opens the link. The details panel lists all links in the topic as normal links too.
- **Details panel**, from top to bottom:
  - the title
  - **Importance**: four buttons, each with a small rough.js preview of the look (Key, Highlight, Normal, Aside)
  - **Priority**: hand-drawn badges ①②③ and "none"
  - **Marker**: the emoji set
  - the note
  - the list of links
  - the image (add, replace, remove, S/M/L)
- **Autosave:** a save is sent 1 s after the last change. The status reads "Saved" or "Saving…", or "Not saved, retrying" while offline. See §8.

## 5. Layouts

All three layouts are pure functions: `layout(tree, measure) → { topics: {id, x, y, w, h, depth, side, color}[], branches: {from, to, path}[] }`.

- **Text measuring:** `measure` uses canvas `measureText` once the fonts have loaded. Tests pass in a fixed-width fake.
- **`map` (default):**
  - The root sits in the centre.
  - First-level branches go right until about half the total height is used, and the rest go left.
  - Reading order runs clockwise, as in XMind.
- **`logic`:** every branch goes to the right.
- **`org`:**
  - Top-down. First-level branches spread out horizontally.
  - **From depth 2, children stack vertically under their parent**, the way XMind's org chart does. This fixes the demo's very wide org chart, which was about 7:1 with six branches.
- **Spacing:** horizontal gaps are 70 px from the root and 36 px deeper; vertical gaps are 26 px and 10 px. The test in §10 checks that no two topics overlap.

## 6. Rendering

- **Output:** SVG, drawn with rough.js 4.6.
- **Stable wobble:** each shape's random seed comes from a hash of its topic ID, so the sketchy lines don't jitter on every redraw.

Styles by depth:

| Depth | Style | Text size |
|---|---|---|
| 0 | Rounded box with hachure fill; ink stroke, yellow fill | 28 px |
| 1 | Rounded box with hachure fill; colours from the branch | 20 px |
| 2+ | Underlined text, as in XMind's default | 17 px |

- In `org`, depth 2+ topics are small unfilled boxes instead of underlined text.
- **Branch colours:** six Open Color stroke and fill pairs, assigned to first-level branches in order and inherited below them.
- **Importance looks:**

| Level | Topic | Branch into it |
|---|---|---|
| Key | Strokes ×1.5; solid fill instead of hachure; text +2 px and heavier (drawn with a thin stroke of the same ink, since Excalifont has only one weight). An underlined topic is promoted to a box. | ×1.45 width |
| Highlight | A yellow `#ffe066` highlighter swipe (a rough, slightly skewed polygon) behind each line of text | unchanged |
| Normal | as in the depth table above | unchanged |
| Aside | Dashed grey `#868e96` outline or underline with no fill; grey text, −2 px | dashed, ×0.8 width |

- **Priority badge:** a solid rough circle (red `#e03131`, orange `#f08c00`, blue `#1971c2`) with a white number, sized to the text, placed before the first line.
- **Links:** blue `#1971c2` with a rough underline, as an SVG `<a target="_blank" rel="noopener noreferrer">`.
- **Images:** above the text, with a thin rough frame in the branch colour.
- **Note icon:** a small page drawn in rough strokes. Hovering it shows the note.
- **Fold control:** a small circle at the branch end. When a branch is folded, the circle shows how many topics are hidden.
- **Dark mode:**
  - Like Excalidraw, the drawing gets `invert(93%) hue-rotate(180deg)`.
  - Images get a counter-filter so photos don't come out inverted. They end up slightly faded, which is fine.
- **Fonts:**
  - Self-hosted. Excalifont's 7 woff2 subsets and Xiaolai's ~210 subsets come from `@excalidraw/excalidraw@0.18.1` and are declared with `unicode-range`, so the browser downloads only the pieces a map uses.
  - Both fonts are OFL-1.1: ship `fonts/OFL.txt` alongside them, and credit them in the app's About.
  - Layout waits up to 2.5 s for the fonts, then falls back to system fonts.

## 7. The Notion embed (`/m/:id`)

- **What you paste into Notion:** the `/m/:id` link, via an `/embed` block.
  - Observed on a public notion.site page: Notion frames an embed directly as an iframe, with scripts, same-origin and popups allowed.
  - You set the height in Notion by dragging.
- **On load:** the page fetches the latest map, fits it to the frame, and shows a "View only" pill and an "Edit in a tab ↗" button.
- **Interaction:**
  - Drag pans the map. ⌘/Ctrl + wheel zooms.
  - A plain mouse wheel scrolls the Notion page, not the map. The embed must not hijack scrolling.
  - Folding in the view changes only that viewer's screen and isn't saved.
  - Clicking a link opens it in a new tab via `window.open`. In the Notion embed this depends on Notion's `allow-popups` sandbox flag.
- **Headers:**
  - `/m/*` sends no `X-Frame-Options` and no `frame-ancestors`, so it can be framed anywhere.
  - `/e/*` and `/` send `frame-ancestors 'none'`. The editor is never framed, which also prevents clickjacking.
- **Updates:** a save is visible on the embed's next load, because R2 reads are strongly consistent (Cloudflare R2 consistency docs). This is why maps are not stored in KV: KV can take "up to 60 seconds or more" to show a change elsewhere (Cloudflare KV docs).

## 8. Backend: Cloudflare Worker + R2

One Worker with static assets serves the built app and `/api/*` on the same origin, so CORS is not needed.

| Method & path | Auth | Does |
|---|---|---|
| `GET /api/maps` | owner | List maps: id, title, updatedAt |
| `POST /api/maps` | owner | Create a map, returns it |
| `GET /api/maps/:id` | none | Read a map (JSON) |
| `PUT /api/maps/:id` | owner | Save. Body: the map. Header `If-Match: <etag>` → `409` if someone else saved first. |
| `DELETE /api/maps/:id` | owner | Delete the map and its images |
| `POST /api/maps/:id/images` | owner | Upload one image (png/jpeg/webp/gif, ≤ 5 MB), returns `{ key }` |
| `GET /img/:key` | none | Serve the image. Headers: `Cache-Control: public, max-age=31536000, immutable` and `X-Content-Type-Options: nosniff` |

- **Storage:**
  - Maps are stored at `maps/<id>.json` in R2, with title and updatedAt in custom metadata.
  - Saves use R2's conditional `put` (`onlyIf` with the etag) for the 409 check.
  - Listing uses R2 `list({ include: ['customMetadata'] })`, which returns each map's metadata (confirmed in Miniflare). Because `put` replaces custom metadata, every save resends title, updatedAt and version.
- **Auth:** `Authorization: Bearer <owner key>`, compared in constant time. Wrong or missing key → 401, with no hint about whether the map exists.
- **Inputs are validated server-side:**
  - The schema is checked with a small zod schema.
  - Link targets are never stored separately: they are derived from topic text by `parseRich`, which yields only http(s) URLs.
  - Size limits are enforced.
  - Image type is checked from the file's magic bytes, not only from the `Content-Type` header.
- **Unused images:** deleting an image from a topic does not delete the file right away, because undo may need it. A clean-up task runs on map delete. A periodic sweep is v2.

## 9. Import and export

- **Markdown out:** `# Root`, then nested `- ` bullets. Links stay in Markdown syntax, and images become `![](https://<host>/img/<key>)`. It pastes straight into Notion as a nested list.
  - A Key topic is written as `**…**` (bold in Notion).
  - Priority is written as a leading 🔴 / 🟠 / 🔵.
  - Highlight and Aside have no Markdown equivalent Notion understands, so they are dropped. The export says so.
- **Markdown in:**
  - Headings and nested bullets with any indent width are accepted; `[ ]` checkbox prefixes are dropped.
  - A single top-level item becomes the root. Otherwise the items go under a root called "Outline".
  - `![](url)` lines are kept as text in v1.
  - A leading 🔴 / 🟠 / 🔵 becomes priority 1/2/3, and an item wrapped entirely in `**…**` becomes Key, so a Markdown round-trip keeps both.
- **`.xmind` in:**
  - XMind 2020+ files (`content.json`): titles, attached children, plain-text notes, `href` (becomes a link on the whole text), folded state, priority markers (`priority-1` … `priority-9`, where 3 and above become ③), and images from `resources/`.
  - XMind 8 files (`content.xml`): titles, children and notes.
  - Floating topics and callouts are attached to the map (floating topics under the root, callouts under their topic); their XMind position is not kept. Styles are not imported. Relationships, boundaries, labels, open task checkboxes and other sheets are dropped, and the import summary lists them.
- **`.excalidraw` out:**
  - Boxes, underlines and branches become rectangles, lines and curved lines; text becomes text elements in Excalifont (fontFamily 5); images become image elements plus `files`.
  - Elements are built through `convertToExcalidrawElements` from `@excalidraw/excalidraw@0.18.1`, loaded only when you export. The arrow-binding format changes after 0.18.1, so this version stays pinned.
- **SVG and PNG out:**
  - SVG: the rendered SVG, with only the font subsets it uses embedded as data URIs.
  - PNG: that SVG rasterised on a canvas at 2×.

## 10. Errors and testing

**Failure handling:**
- **Save fails or you're offline:**
  - The map is kept as a local draft in `localStorage`.
  - Retries back off over 2, 4, 8 … up to 60 s, and the status shows "Not saved, retrying".
  - On reload, the editor offers to restore a draft that's newer than the server copy.
- **409 conflict** (for example, two tabs open): a dialog offers "Load the newer version" or "Keep mine and overwrite".
- **Image problems:** a non-image, an oversized file or a failed upload shows a toast that says why. The topic doesn't change.
- **Unknown map on the view page:** a plain "This map doesn't exist or was deleted" page.
- **Fonts fail to load:** after 2.5 s the map lays out with system fonts.

**Tests:**
- **Unit (Vitest):**
  - model edits and undo, including importance bumps and priority
  - `parseRich`, including escapes and edge cases
  - wrapping with offsets
  - each layout: snapshot of positions plus a no-overlap check across many random trees
  - Markdown round-trip
  - `.xmind` import from fixture files. XMind 2020+ and XMind 8 samples are needed, ideally real ones from you.
- **Worker:** routes, auth, the 409 conflict, size and type limits, and security headers, tested with `@cloudflare/vitest-plugin`.
- **End-to-end (Playwright):**
  - Create a map; Tab, Enter and typing.
  - Link selected words with ⌘K.
  - Attach an image.
  - Reload: everything persisted.
  - `/m/:id` renders inside an `<iframe>` on a local test page.
- **Manual check** for each release: embed `/m/:id` in a real Notion page in the browser and in the desktop app; click a link in the embed (browser and desktop app).

## 11. Delivery in four steps

Each step ends with something usable in Notion.

1. **Usable in Notion:**
   - Worker, R2 and the owner key
   - the map list, the editor (keys, text editing, drag, undo, autosave) and the `map` layout
   - the `/m/:id` embed and SVG/PNG export
   - *Done when:* you can build a map, embed it in a real Notion page, edit it in a tab, and see the change after reloading Notion.
2. **Text in and out:** Markdown in/out, plus the `logic` and `org` layouts (with vertical stacking).
3. **Bring XMind over:**
   - `.xmind` import
   - notes, markers and inline links (`parseRich`, ⌘K, paste-over-selection)
   - importance levels and priority badges, with their sidebar pickers and Alt shortcuts
4. **Richer topics:**
   - images (upload, R2, S/M/L)
   - `.excalidraw` export
   - dark-mode polish

## 12. Open questions

1. Product name: "Sketchmap" is a placeholder.
2. Does a `*.workers.dev` embed load in the **Notion desktop app**? **Answered on 2026-11-12: yes.** It loads in both the Notion web app and the desktop app, so no custom domain is needed.
3. Should folding in the embed be remembered per viewer (in `localStorage`)? It's currently not.
4. Would it help to show the map's last-saved time on the embed?
