// Copies the pinned Excalidraw font files into public/fonts/ so Vite serves them at /fonts/.
import { access, cp, mkdir, readFile } from 'node:fs/promises';

const SRC = new URL('../node_modules/@excalidraw/excalidraw/dist/prod/fonts/', import.meta.url);
const DEST = new URL('../public/fonts/', import.meta.url);
const GENERATED = new URL('../src/render/fontFaces.generated.ts', import.meta.url);
await access(SRC).catch(() => {
  throw new Error('Run `npm install` first: @excalidraw/excalidraw@0.18.1 provides the font files.');
});
await mkdir(DEST, { recursive: true });
for (const family of ['Excalifont', 'Xiaolai']) {
  await cp(new URL(`${family}/`, SRC), new URL(`${family}/`, DEST), { recursive: true });
}
console.log('fonts copied to public/fonts/');

// Guard against font version drift: every file fontFaces.generated.ts references must actually
// exist under public/fonts/, or the export/editor will fail at runtime instead of at build time.
const generated = await readFile(GENERATED, 'utf8');
const files = [...generated.matchAll(/"file":\s*"([^"]+)"/g)].map((m) => m[1]);
const missing = [];
for (const file of files) {
  const exists = await access(new URL(file, DEST)).then(
    () => true,
    () => false,
  );
  if (!exists) missing.push(file);
}
if (missing.length) {
  console.error('fontFaces.generated.ts references font files that are missing from public/fonts/:');
  for (const file of missing) console.error(`  ${file}`);
  process.exit(1);
}
