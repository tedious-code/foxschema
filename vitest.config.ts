import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const aliases = [
  { find: '@foxschema/sql', replacement: pkg('./packages/sql/src/index.ts') },
  { find: '@foxschema/db', replacement: pkg('./packages/db/src/index.ts') },
  { find: '@foxschema/web/auth', replacement: pkg('./apps/web/src/backend/modules/auth/auth.service.ts') },
  { find: '@foxschema/web/connection-store', replacement: pkg('./apps/web/src/backend/modules/connections/connection-store.service.ts') },
  { find: '@foxschema/web/migration-history', replacement: pkg('./apps/web/src/backend/modules/migration/migration-history.service.ts') },
  { find: '@foxschema/web/app-settings', replacement: pkg('./apps/web/src/backend/modules/admin/app-settings.service.ts') },
  { find: '@foxschema/web/store', replacement: pkg('./apps/web/src/backend/database/store.ts') },
];

// Root test runner for the whole workspace. CLI Ink TUI screens are isolated in
// their own project with fileParallelism off — under full-suite parallel load,
// ink-text-input / SelectInput stdin races flake even when the same tests pass
// in isolation (see apps/cli/src/tui/__tests__/README.md).
export default defineConfig({
  resolve: { alias: aliases },
  test: {
    projects: [
      {
        resolve: { alias: aliases },
        test: {
          name: 'unit',
          include: [
            'packages/**/*.test.ts',
            'apps/web/**/*.test.ts',
            'apps/cli/src/**/*.test.ts',
            'scripts/security/**/*.test.mjs',
          ],
          exclude: ['apps/cli/src/tui/**'],
          testTimeout: 15_000,
        },
      },
      {
        // React components, in jsdom. Kept as its own project so the default
        // `unit` run stays a pure-node suite — component tests need a DOM,
        // which is an order of magnitude slower to spin up per file.
        resolve: { alias: aliases },
        test: {
          name: 'web-ui',
          include: ['apps/web/src/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./apps/web/src/frontend/test/setup.ts'],
          testTimeout: 15_000,
        },
      },
      {
        resolve: { alias: aliases },
        test: {
          name: 'cli-tui',
          include: ['apps/cli/src/tui/**/*.test.{ts,tsx}'],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
