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
