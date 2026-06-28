import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Root test runner for the whole workspace: the pure engine tests in
// packages/* plus the backend tests in apps/web. The @foxschema/core alias
// resolves to package source so tests run without a build step.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@foxschema/core', replacement: pkg('./packages/core/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/**/*.test.ts'],
  },
});
