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

### Check the deploy

```bash
curl -sI https://sketchmap.<account>.workers.dev/e/abcdefghijklmnopqrstu | grep -i content-security-policy   # frame-ancestors 'none'
curl -sI https://sketchmap.<account>.workers.dev/m/abcdefghijklmnopqrstu | grep -ci "frame-ancestors\|x-frame-options"   # 0
curl -s -o /dev/null -w '%{http_code}\n' https://sketchmap.<account>.workers.dev/api/maps   # 401
```

Every page is served with a strict Content-Security-Policy (same-origin scripts only); `npx playwright test` checks it against the production build.

## Put a map in Notion

1. Open the app, enter your owner key once, create a map.
2. Click **Copy Notion embed link** (it looks like `https://…/m/<id>`).
3. In Notion type `/embed`, paste the link, and drag the frame's edge to set its height.
4. Edit with **Edit in a tab ↗**. Notion shows your changes the next time the page loads.

The embed is view-only by design. Anyone who can see the Notion page, or who has the link, can view the map.
Only someone with the owner key can change it.

## Step 2: layouts, outline and paste

- **Layout switch.** Pick **Mind map**, **Logic chart** or **Org chart** from the header; the choice is saved with the map.
- **Outline.** The **Outline** button opens the map as a Markdown outline: edit the text (or paste one from elsewhere) and **Replace map with this**, or close without applying.
- **Copy as Markdown** puts the whole map on the clipboard as a Markdown outline, which pastes into Notion as a nested list.
- **Paste.** An outline or list copied from XMind, Notion or a text editor, pasted anywhere outside a text field, is added under the selected topic. ⌘Z undoes it.

## Step 3: topic details

- The **Details** button shows or hides the sidebar for the selected topic.
- **Importance:** Key, Highlight, Normal and Aside, with Alt ↑ / Alt ↓.
- **Priority:** ①②③, with Alt 1–3, and Alt 0 to clear.
- **Marker:** the ten markers. Clicking the active marker removes it.
- **Note:** saved as you type. Hover the little page icon on a topic to read it, in the editor and in the Notion view.
- **Copy as Markdown** keeps Key (bold), priority (🔴🟠🔵) and markers. It names what it can't keep: Highlight, Aside and notes.
- **Links.** Write links as `[label](https://…)` in a topic, or paste a bare `https://…` address — a bare URL is always a link (there's no syntax to write one as plain text), shown shortened to its host and path (at most 28 characters) while keeping its full address. Write a literal `[`, `]` or `\` with `\[`, `\]` or `\\`. While editing, select words and press ⌘/Ctrl K, or paste a link over them. On a selected topic, ⌘/Ctrl K links the whole topic, with "Remove link" to take it off (not offered for a topic whose only link is a bare URL, which can't be unlinked). Links open with ⌘/Ctrl-click in the editor and with a plain click in the Notion view. The Details panel lists them.

## Known limitations

- Checked on 2026-11-12: the `/m/…` embed loads in Notion in the browser (Chrome) and in the Notion desktop app. Edits made with **Edit in a tab** show up after reloading the Notion page, and a normal mouse wheel over the embed scrolls the page.
- Not yet checked: Chinese input (IME) and SVG/PNG export in Safari and Firefox; opening a link from the embed in the Notion desktop and mobile apps.
- The Markdown outline keeps topic text, nesting, Key, priority and markers. Line breaks inside a topic, folded state, topic identity, Highlight, Aside and notes are not kept, so replacing the map from the outline removes them (undo brings them back).
- Pasting a very large outline (thousands of topics) is slow, and a map over 2 MB cannot be saved; undo the paste if that happens.
- An existing map's title where maps are listed keeps raw link syntax (`[label](https://…)`, a bare URL) until that map is next saved.

## Fonts

Excalifont and Xiaolai are used under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
