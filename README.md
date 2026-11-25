# Sketchmap (working name)

XMind-style mindmaps with Excalidraw's hand-drawn look, embedded in Notion. You edit a map in a browser tab; the Notion page shows it view-only. Design: `docs/superpowers/specs/2026-11-12-sketchmap-design.md`.

## Run locally

```bash
npm install
echo "OWNER_KEY=dev-owner-key" > .dev.vars   # local-only secret
npm run dev                                  # opens on http://localhost:5173
```

On your own machine the local site signs you in by itself: `npm run dev` reads the key from `.dev.vars` and hands it to the page, so `http://localhost:5173` never asks for it. This applies only to that local server. The deployed site, and `npm run preview`, ask for the owner key once per browser. A dev server opened to other devices with `--host` asks for it too.

Tests: `npm test` (unit), `npm run test:worker` (API on a local R2), `npm run test:e2e` (browser; run `npx playwright install` once first). The browser tests run in Chromium, WebKit and Firefox, and once against the production build. They start their own servers on ports 5183 and 4183 with their own empty storage and their own settings, so they never touch the maps of a `npm run dev` you have open and need no `.dev.vars`.

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
curl -s https://sketchmap.<account>.workers.dev/ | grep -o '/assets/index-[^"]*\.js' | head -1    # the script's path
curl -sI https://sketchmap.<account>.workers.dev/assets/index-XXXXXXXX.js | grep -i cache-control   # public, max-age=31536000, immutable
```

Every page is served with a strict Content-Security-Policy (same-origin scripts only); `npx playwright test` checks it against the production build. Scripts, styles and fonts are cached by the browser for a year: a script or style gets a new name whenever its content changes, and the build fails if a font file ever changes under the same name. Pages and map data are fetched fresh every time.

## Sign in with Google (optional)

Out of the box the owner key is the only way in. You can add **Sign in with Google** for your own Google account: on a new machine you click the button and you are in, with no key to carry. The owner key keeps working beside it.

Set it up once:

1. In the Google Cloud console open **Google Auth Platform → Clients** (`https://console.developers.google.com/auth/clients`) and create or pick a project. If it asks you to register the app first, give it an app name, your email as support and developer contact, and the audience **External**.
2. On the **Audience** page leave the status at **Testing** and add your own Google address as a test user. Testing allows up to 100 listed accounts. Google's seven-day expiry for test users does not apply to a sign-in that asks only for `openid` and `email`, which is all this app asks.
3. **Create client**, type **Web application**. Under **Authorized redirect URIs** add exactly `https://sketchmap.<account>.workers.dev/auth/google/callback` (https, no slash at the end). Google says a change here can take from five minutes to a few hours to apply.
4. Copy the client ID and the client secret. The secret is shown in full only this once.
5. Store three secrets on the Worker. Each command asks for the value, and nothing is written to the repo:

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put OWNER_EMAILS       # your Google address; for several, separate them with commas
   ```

6. Open the site. The sign-in page now shows **Sign in with Google**, with the owner key one click below it.

How it behaves:

- Only the addresses in `OWNER_EMAILS` get in, and only when Google says the address is verified. Any other account is told it isn't allowed.
- Use a Gmail address if you can. Google ties a Gmail address to one account for good; an address at another domain can change hands (a lapsed domain, a recycled mailbox), and whoever then makes a Google account with it would get in.
- A sign-in lasts 30 days in that browser. **Sign out** on the map list removes it from that browser; if the server can't be reached, the page says so and stays signed in. Sign out does not cancel a copy of the sign-in taken from the device: that lasts until it runs out. To end every sign-in at once, change `OWNER_KEY` (then enter the new key where you use it). Taking an address out of `OWNER_EMAILS` ends that address's sign-ins.
- A map made while signed in records your Google account as its owner. Nothing uses that yet; it is there so that each account can have its own maps later without guessing who made what.
- Until all three secrets are set, nothing changes: the site shows the owner-key page as before.
- The local server (`npm run dev`) still signs you in by itself.

## Put a map in Notion

1. Open the app, enter your owner key once, create a map.
2. Click **Copy Notion embed link** (it looks like `https://…/m/<id>`).
3. In Notion type `/embed`, paste the link, and drag the frame's edge to set its height.
4. Edit with **Edit in a tab ↗**. Notion shows your changes the next time the page loads.

The embed is view-only by design. Anyone who can see the Notion page, or who has the link, can view the map.
Only someone with the owner key can change it.

**Theme.** The site has one theme setting: **Light** (the default), **Dark**, or **System** (follows each viewer's own light or dark setting). Pick it with the **Theme** buttons on the map list or in the editor's bottom toolbar. It is saved on the server, so it applies to the list, every editor and every Notion embed, on every device. To give one embed a different look, add `?theme=dark` or `?theme=light` to its link, e.g. `https://…/m/<id>?theme=dark`; that wins over the setting.

Browsers: the editor and the embed need Chrome/Edge 123+, Firefox 120+ or Safari 17.5+ (iOS 17.5+ for the Notion iOS app); older browsers still draw the map but lose the app's colours.

## Editing

- **Keys, with a topic selected.**
  - Tab adds a child and Enter a sibling.
  - Space, F2 or a double-click edits the topic; typing a character starts editing with it.
  - Delete or Backspace removes the topic.
  - The arrow keys move the selection.
  - ⌘/Ctrl with ↑ or ↓ moves the topic one place up or down among its siblings. In an org chart the main branches stand side by side, so there it is ⌘/Ctrl with ← or →. In the mind map layout, ⌘/Ctrl with ← or → takes a main branch to the other side of the central topic.
  - `/` folds or unfolds the branch.
  - ⌘/Ctrl Z undoes; ⌘/Ctrl Shift Z or ⌘/Ctrl Y redoes.
- **While editing text.** Enter finishes, Shift Enter starts a new line, Esc cancels, and Tab finishes and adds a child.
- **Mouse.**
  - Drag a topic onto the middle of another to move it there, as its last child.
  - Drag it to the top or bottom edge of another topic (a quarter of the topic, at most 14 px, or just outside it) to put it just before or after that one; a line shows the place. In an org chart the main branches use the left and right edge, and under a topic that shows children the place is before its first child.
  - In the mind map layout, drop a branch on the left or right half of the central topic to put it on that side. Once you have placed a main branch yourself, every main branch stays on its side; before that, the two sides are balanced automatically, and a branch that grows can push others across.
  - Click on the background (or tap it with a finger) to select nothing. With nothing selected, Tab, Enter, Delete, typing and paste have no topic to act on and do nothing; the toolbar's Child, Sibling and Delete are off, and the Details panel says that no topic is selected. Click a topic to select it, or press an arrow key to go back to the topic that was selected last. Undo, redo and ⌘/Ctrl A still work.
  - Drag on the background with the left button to draw a box: every topic the box touches is selected, and a box that touches none selects nothing. Hold Shift to add to what is already selected.
  - Drag with the right (or middle) button, or use the wheel or a two-finger scroll, to move the canvas. ⌘/Ctrl with the wheel zooms. The right-click menu is off on the canvas for this reason.
- **Several topics at once.**
  - Besides the box, Shift-click adds a topic to the selection or takes it out, and ⌘/Ctrl A selects every topic on screen. Esc or a click on one topic goes back to one selected topic.
  - Delete removes all selected topics, and dragging one of them moves them all to where you drop them. Importance, priority and marker (the panel or Alt ↑ / ↓ / 0–3) go to all of them. Each of these is one undo step.
  - Everything else (Tab, Enter, editing, the note, links, images, paste, fold, ⌘/Ctrl with an arrow) acts on one of them, the current topic: the one the Details panel names.
- **Layout switch.** Pick **Mind map**, **Logic chart** or **Org chart** from the header; the choice is saved with the map.
- **Outline.** The **Outline** button opens the map as a Markdown outline: edit the text (or paste one from elsewhere) and **Replace map with this**, or close without applying.
- **Paste.** An outline or list copied from XMind, Notion or a text editor, pasted anywhere outside a text field, is added under the selected topic. ⌘Z undoes it.
- **Saving.** Changes are saved a second after you stop. If a save fails, the map is kept in this browser, the badge reads "Not saved, retrying", and the save is retried by itself with growing pauses, and straight away when the browser reports that the connection is back. If the browser blocks site data, the app still works, but it asks for the owner key on every page and keeps no local copy of unsaved changes.

## Topic details

- The **Details** button shows or hides the sidebar for the selected topic. The ▸ on the sidebar folds it into a slim **◂ Details** tab at the right edge; click the tab to open it again.
- **Importance:** Key, Highlight, Normal and Aside, with Alt ↑ / Alt ↓.
- **Priority:** ①②③, with Alt 1–3, and Alt 0 to clear.
- **Marker:** the ten markers. Clicking the active marker removes it.
- **Note:** saved as you type. Hover the little page icon on a topic to read it. In the Notion view a click or tap on the icon opens the whole note in a small card; Esc, the ×, or a tap anywhere else closes it.
- **Links.** Write links as `[label](https://…)` in a topic, or paste a bare `https://…` address — a bare URL is always a link (there's no syntax to write one as plain text), shown shortened to its host and path (at most 28 characters) while keeping its full address. Write a literal `[`, `]` or `\` with `\[`, `\]` or `\\`. While editing, select words and press ⌘/Ctrl K, or paste a link over them. On a selected topic, ⌘/Ctrl K links the whole topic, with "Remove link" to take it off (not offered for a topic whose only link is a bare URL, which can't be unlinked). Links open with ⌘/Ctrl-click in the editor and with a plain click in the Notion view. The Details panel lists them.

## Images

- **Add an image** to the selected topic from the Details panel (**Add image…**), by pasting an image, or by dropping an image file on a topic. **Replace…** and **Remove** are in the same row.
- **Resize an image** by dragging the small square on its bottom-right corner, which shows while its topic is the only one selected. A dashed outline and the size in px follow the pointer, and the image changes when you let go (one undo step). **S / M / L** in the Details panel set the width to 120, 200 or 300 px. Either way the picture keeps its own proportions, read from the picture itself, so resizing many times never crops its edges. A side can be 16 to 2048 px.
- To make a topic that is only an image, add the image, then clear the topic's text.
- PNG, JPEG, WebP, GIF and SVG are accepted, judged by the file's contents, not its name. SVG images (including XMind icons) are converted to PNG, drawn in the browser through an `<img>` element so any script they carry never runs. Before upload the browser shrinks the image to at most 2048 px on its longest side and saves it as PNG (if it has transparency) or JPEG; an animated GIF keeps its first frame; an SVG is always saved as PNG. Image files up to 30 MB are accepted (an SVG source up to 5 MB); after shrinking, an upload must be under 5 MB.
- Images are stored in the same R2 bucket under `img/<random>/…` (the address never reveals which map they belong to), served from `/img/…` with long caching, and deleted together with their map. Removing an image from a topic keeps the file, so undo can bring it back.
- Images are drawn above the topic's text with a sketchy frame, in the editor, the Notion view and SVG/PNG exports (exports embed them).

## Dark mode

In dark mode the drawing is inverted the way Excalidraw does it, but images are drawn on their own layer, so photos keep their true colours; the frame is drawn on a third layer above the photos, so it stays on top of the image and still gets the dark-mode inversion. Exports are always light.

## Import and export

- **.xmind import.** **Import .xmind** on the map list turns an XMind file into a new map.
  - XMind 2020+ keeps titles, attached children, notes, links (`http(s)` hrefs become a link on the whole topic), folded branches, priority markers (3 and above become ③), and star/flag/person/question markers. Floating topics are attached under the root instead (their XMind position isn't kept). Callouts are attached under their own topic, and a done task checkbox becomes ✅; open task checkboxes are left out.
  - XMind 8 keeps titles, children and notes.
  - A mind map keeps XMind's split between right and left when the file records it: XMind 2020+ files with the structure `org.xmind.ui.map.unbalanced`, which store how many main branches are on the right. Not checked against XMind itself: the order of the branches on the left.
  - PNG, JPEG, WebP, GIF and SVG images in the file come along (up to 100), with SVG converted to PNG the same way as a direct upload.
  - Relationships, boundaries, summary topics, labels, other markers, links to files or topics, open task checkboxes, and other sheets are left out. The summary after import lists them.
  - Styles (colours, fonts, shapes) are not imported.
- **Copy as Markdown** puts the whole map on the clipboard as a Markdown outline, which pastes into Notion as a nested list. It keeps Key (bold), priority (🔴🟠🔵) and markers, and writes an image as `![](https://<your-site>/img/…)`. It names what it can't keep: Highlight, Aside and notes. The Outline panel leaves images out, and Markdown that comes back in keeps `![](…)` as plain text.
- **SVG and PNG** download the map as drawn, with its fonts and images embedded.
- **Excalidraw export:** downloads a `.excalidraw` file (open it at excalidraw.com, or drag it onto an Excalidraw canvas) with boxes, branches, text in Excalifont, highlight swipes, priority badges and images. Each topic's parts are grouped. Notes aren't included, a topic keeps only its first link, and folded branches stay folded; the editor lists what was left out.
- All three downloads include text or a note you are still typing.

## Known limitations

- Checked on 2026-11-12: the `/m/…` embed loads in Notion in the browser (Chrome) and in the Notion desktop app. Edits made with **Edit in a tab** show up after reloading the Notion page, and a normal mouse wheel over the embed scrolls the page.
- Checked on 2026-11-13 by the browser tests in Playwright's WebKit (Safari's engine) and Firefox builds, as well as Chromium: creating and editing a map, the embed inside a Notion-like sandboxed frame, links, drag-to-move, images (added from the panel, dropped, pasted, imported from `.xmind`), SVG, PNG and Excalidraw export, dark mode and `?theme=`. Those builds are not Safari itself or iOS, and the tests paste with a scripted event, not the real clipboard.
- Not yet checked: Safari itself and iOS; Chinese input (IME) and a real clipboard paste in Safari and Firefox; opening a link from the embed in the Notion desktop and mobile apps; opening the `.excalidraw` export in excalidraw.com. XMind notes and XMind 8 files are imported from the documented format; no real sample with notes or from XMind 8 was available.
- Sign in with Google is tested against a stand-in for Google (the Worker tests play Google's token endpoint, and the browser tests start from the session a sign-in ends in). It has not yet been tried against Google itself, which needs your own OAuth client.
- Reading a note by tapping its icon in the Notion view is checked with the browsers' touch emulation, not yet on a real phone or in the Notion mobile app.
- Dragging the corner of an image with a finger is checked with scripted touch events only, not yet on a real phone or tablet.
- The selection box needs a mouse or trackpad. On a touch screen a finger on the editor's background moves the canvas, as it does in the Notion view, where the left button also still moves the canvas.
- Large maps get slower to edit, because every change redraws the whole map. Measured in headless Chromium on the development machine (2026-11-13), the time from an arrow key to the screen updating was 33 ms at 100 and 300 topics (33 ms is the shortest time this measurement can show), about 68 ms at 1000 and about 118 ms at 2000.
- The Markdown outline keeps topic text, nesting, Key, priority and markers. Line breaks inside a topic, folded state, topic identity, Highlight, Aside, notes and images are not kept, so replacing the map from the outline removes them (undo brings them back).
- Pasting a very large outline (thousands of topics) is slow, and a map over 2 MB cannot be saved; undo the paste if that happens.
- An existing map's title where maps are listed keeps raw link syntax (`[label](https://…)`, a bare URL) until that map is next saved.

## Fonts

Excalifont and Xiaolai are used under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
