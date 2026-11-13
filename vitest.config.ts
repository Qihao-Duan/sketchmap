import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    passWithNoTests: true,
    setupFiles: ['src/test/setup.ts'],
    // @excalidraw/excalidraw ships ESM that imports JSON without an import attribute, which Node refuses;
    // letting Vite transform it (only the test that loads it pays for this) makes it importable.
    server: { deps: { inline: [/@excalidraw\/excalidraw/, /open-color/] } },
  },
});
