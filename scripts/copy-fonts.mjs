// Copies the pinned Excalidraw font files into public/fonts/ so Vite serves them at /fonts/.
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

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

// Browsers keep these files for a year by name (worker/assets.ts), and the names are not content hashes.
// So the content of every file is checked against scripts/font-hashes.json: a file that changes under an
// unchanged name must be served from a new path before its hash is recorded.
const HASHES = new URL('./font-hashes.json', import.meta.url);
const update = process.argv.includes('--update-hashes');
const actual = {};
for (const family of ['Excalifont', 'Xiaolai']) {
  const dir = new URL(`${family}/`, DEST);
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.woff2'))) {
    actual[`${family}/${name}`] = createHash('sha256').update(await readFile(new URL(name, dir))).digest('hex');
  }
}
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const recorded = await readFile(HASHES, 'utf8').then(
  (text) => JSON.parse(text),
  () => ({}),
);
const changed = Object.keys(actual).filter((k) => k in recorded && recorded[k] !== actual[k]);
if (changed.length) {
  console.error('Font files with changed content:');
  for (const k of changed) console.error(`  ${k}`);
  console.error(
    'These font files changed content under an unchanged name. Browsers keep fonts for a year by name (worker/assets.ts), so serve the new files from a new path before recording their hashes.',
  );
  process.exit(1);
}
const added = Object.keys(actual).filter((k) => !(k in recorded));
const gone = Object.keys(recorded).filter((k) => !(k in actual));
if (update) {
  await writeFile(HASHES, `${JSON.stringify(sortKeys(actual), null, 2)}\n`);
  console.log(`recorded ${Object.keys(actual).length} font hashes in scripts/font-hashes.json`);
} else if (added.length || gone.length) {
  for (const k of added) console.error(`  not recorded: ${k}`);
  for (const k of gone) console.error(`  missing on disk: ${k}`);
  console.error('The font file list changed. Run "node scripts/copy-fonts.mjs --update-hashes" to record it.');
  process.exit(1);
}
