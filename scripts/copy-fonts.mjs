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
