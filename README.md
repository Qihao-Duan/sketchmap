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

## Known limitations

- Not yet checked: whether the embed loads in the Notion desktop app (to be filled in after the first real Notion test).

## Fonts

Excalifont and Xiaolai are used under the SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
