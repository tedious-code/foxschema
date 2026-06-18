import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Root test runner for the whole workspace: the pure engine tests in
// packages/* plus the backend tests in apps/web. The @foxschema/* aliases
// resolve to package source so tests run without a build step.
export default defineConfig({
  resolve: {
    alias: [
      { find: '@foxschema/shared', replacement: pkg('./packages/shared/src/index.ts') },
      { find: '@foxschema/core', replacement: pkg('./packages/core/src/index.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/**/*.test.ts'],
  },
});
