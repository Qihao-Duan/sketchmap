import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: '2026-11-01',
        r2Buckets: ['MAPS'],
        bindings: { OWNER_KEY: 'test-owner-key' },
      },
    }),
  ],
  test: { include: ['worker/test/**/*.spec.ts'] },
});
