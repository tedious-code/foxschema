import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const aliases = [
  { find: '@foxschema/sql', replacement: pkg('./packages/sql/src/index.ts') },
  { find: '@foxschema/db', replacement: pkg('./packages/db/src/index.ts') },
  { find: '@foxschema/shared', replacement: pkg('./packages/shared/src/index.ts') },
  { find: '@foxschema/server', replacement: pkg('./packages/server/src/index.ts') },
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
