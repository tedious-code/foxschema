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
      { find: '@foxschema/web/auth', replacement: pkg('./apps/web/src/backend/modules/auth.module.ts') },
      { find: '@foxschema/web/connection-store', replacement: pkg('./apps/web/src/backend/modules/connection-store.module.ts') },
      { find: '@foxschema/web/migration-history', replacement: pkg('./apps/web/src/backend/modules/migration-history.module.ts') },
      { find: '@foxschema/web/app-settings', replacement: pkg('./apps/web/src/backend/modules/app-settings.module.ts') },
      { find: '@foxschema/web/store', replacement: pkg('./apps/web/src/backend/database/store.ts') },
    ],
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/**/*.test.ts', 'apps/cli/**/*.test.{ts,tsx}'],
  },
});
