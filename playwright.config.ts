import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  projects: [
    // Day-to-day e2e against the Vite dev server.
    { name: 'dev', testIgnore: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:5183' } },
    // The built app on the built Worker (vite preview): the real headers, including the production CSP.
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:4183' } },
    // The same browser tests in Playwright's WebKit (Safari's engine) and Firefox builds.
    { name: 'webkit', testIgnore: /prod\.spec\.ts/, use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:5183' } },
    { name: 'firefox', testIgnore: /prod\.spec\.ts/, use: { ...devices['Desktop Firefox'], baseURL: 'http://localhost:5183' } },
  ],
  // The test servers use their own ports, storage and settings (written by e2e/server/prepare.mjs), started
  // empty each run, so a run never touches the maps of an `npm run dev` the developer has open and needs no
  // .dev.vars of the developer's. The dev server offers Google sign-in (to one test account); the production
  // build offers only the owner key, so both sign-in pages are met in a real browser.
  webServer: [
    {
      command: 'rm -rf .wrangler/e2e-dev && node e2e/server/prepare.mjs .wrangler/e2e-dev/config --google && npm run dev -- --port 5183 --strictPort',
      url: 'http://localhost:5183',
      env: { SKETCHMAP_STATE: '.wrangler/e2e-dev' },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'rm -rf .wrangler/e2e-prod && node e2e/server/prepare.mjs .wrangler/e2e-prod/config && npm run preview -- --port 4183 --strictPort',
      url: 'http://localhost:4183',
      env: { SKETCHMAP_STATE: '.wrangler/e2e-prod' },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
