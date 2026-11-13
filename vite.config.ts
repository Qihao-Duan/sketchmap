import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
import { mayHandOverLocalKey } from './src/auth/localKey';

// The browser tests set SKETCHMAP_STATE so their servers keep maps in their own folder, never in the
// developer's local storage (.wrangler/state). Those servers also skip the debugger port, which two
// servers starting together would fight over.
const testState = process.env.SKETCHMAP_STATE;

// On the developer's own machine `npm run dev` signs the page in by itself: it reads the local key from
// .dev.vars and hands it to the page, which remembers it as if it had been typed (src/main.tsx). A build
// always gets null here, so the deployed site and `npm run preview` ask for the key; so do the browser
// tests' servers, and a dev server opened to other machines with --host.
function localOwnerKey(): Plugin {
  return {
    name: 'sketchmap:local-owner-key',
    config(config, { command, isPreview }) {
      const allowed = mayHandOverLocalKey({ command, isPreview, host: config.server?.host, testServer: !!testState });
      return { define: { __LOCAL_OWNER_KEY__: JSON.stringify(allowed ? readLocalOwnerKey() : null) } };
    },
  };
}

function readLocalOwnerKey(): string | null {
  if (!existsSync('.dev.vars') || typeof parseEnv !== 'function') return null;
  return parseEnv(readFileSync('.dev.vars', 'utf8')).OWNER_KEY?.trim() || null;
}

export default defineConfig({
  plugins: [react(), localOwnerKey(), cloudflare(testState ? { persistState: { path: testState }, inspectorPort: false } : {})],
});
