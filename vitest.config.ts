import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const aliases = [
  { find: '@foxschema/core', replacement: pkg('./packages/core/src/index.ts') },
  { find: '@foxschema/web/auth', replacement: pkg('./apps/web/src/backend/modules/auth.module.ts') },
  { find: '@foxschema/web/connection-store', replacement: pkg('./apps/web/src/backend/modules/connection-store.module.ts') },
  { find: '@foxschema/web/migration-history', replacement: pkg('./apps/web/src/backend/modules/migration-history.module.ts') },
  { find: '@foxschema/web/app-settings', replacement: pkg('./apps/web/src/backend/modules/app-settings.module.ts') },
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
          include: ['packages/**/*.test.ts', 'apps/web/**/*.test.ts', 'apps/cli/src/**/*.test.ts'],
          exclude: ['apps/cli/src/tui/**'],
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
