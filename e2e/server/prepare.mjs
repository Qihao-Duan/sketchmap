// Run before a browser-test server starts. Writes that server's own Worker settings into a folder under
// .wrangler/ (never committed): a copy of wrangler.jsonc, and beside it the local variables the tests need.
// So the tests don't depend on the developer's .dev.vars, and they can switch Google sign-in on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const [out, ...flags] = process.argv.slice(2);
if (!out) throw new Error('usage: node e2e/server/prepare.mjs <output folder> [--google]');
/** With --google the server offers Google sign-in (to one test account); without, only the owner key. */
const google = flags.includes('--google');

let config;
try {
  config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
} catch (e) {
  throw new Error(`e2e/server/prepare.mjs reads wrangler.jsonc as plain JSON; if it now has comments, strip them here first. (${e.message})`);
}
delete config.$schema;
// Paths in the copy still point at the real project.
config.main = resolve(config.main);

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'wrangler.jsonc'), JSON.stringify(config, null, 2));
writeFileSync(
  resolve(out, '.dev.vars'),
  [
    // Test values only: none of these opens anything outside the test servers.
    'OWNER_KEY=dev-owner-key',
    ...(google ? ['GOOGLE_CLIENT_ID=e2e-client.apps.googleusercontent.com', 'GOOGLE_CLIENT_SECRET=e2e-client-secret', 'OWNER_EMAILS=owner@e2e.example'] : []),
    '',
  ].join('\n'),
);
console.log(`wrote ${dirname(resolve(out, 'wrangler.jsonc'))}`);
