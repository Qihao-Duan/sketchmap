import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  projects: [
    // Day-to-day e2e against the Vite dev server.
    { name: 'dev', testIgnore: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:5173' } },
    // The built app on the built Worker (vite preview): the real headers, including the production CSP.
    { name: 'prod', testMatch: /prod\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 180_000 },
  ],
});
