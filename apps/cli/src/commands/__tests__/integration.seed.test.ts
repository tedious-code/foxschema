import { describe, it, expect } from 'vitest';
import type { ConnectionOptions } from '@foxschema/core';
import { compareModule, loadScopedTables } from '../../runtime/engine';

/**
 * Live integration tests against the advanced seed matrix (demo_c / demo_d) that
 * `scripts/seed/seed-advanced.sh` loads into the docker databases. They drive the
 * exact engine layer the `fox compare` / `fox migrate` commands use
 * (loadScopedTables + compareModule.compare), so they catch provider/compare
 * regressions that the mocked command tests can't.
 *
 * Gated behind FOX_IT_DB=1 so the default `vitest run` (and CI) stay DB-free:
 *
 *   docker compose up -d && bash scripts/seed/seed-advanced.sh all
 *   FOX_IT_DB=1 npx vitest run apps/cli/src/commands/__tests__/integration.seed.test.ts
 */
const RUN = process.env.FOX_IT_DB === '1';

const pg = (database: string): ConnectionOptions =>
  ({ host: 'localhost', port: 5432, username: 'foxuser', password: 'foxpass', database }) as ConnectionOptions;
const mysql = (database: string): ConnectionOptions =>
  ({ host: 'localhost', port: 3306, username: 'foxuser', password: 'foxpass', database }) as ConnectionOptions;

const statusOf = (tables: any[], name: string) =>
  tables.find((t) => t.tableName === name)?.status;

describe.skipIf(!RUN)('integration: advanced seed (demo_c / demo_d)', () => {
  it('same-dialect Postgres demo_c → demo_d produces the expected diff classes', async () => {
    const [source, target] = await Promise.all([
      loadScopedTables('postgres', pg('foxdb'), 'demo_c'),
      loadScopedTables('postgres', pg('foxdb'), 'demo_d'),
    ]);
    const result = await compareModule.compare(source, target, { source: 'postgres', target: 'postgres' });

    // Drift exists (added + removed + modified > 0).
    expect(result.summary.added + result.summary.removed + result.summary.modified).toBeGreaterThan(0);
    // Representative cases from the matrix (see scripts/seed/advanced/postgres.sql).
    expect(statusOf(result.tables, 'T_DEPRECATED_CACHE')).toBe('REMOVED'); // B13
    expect(statusOf(result.tables, 'T_ONLY_IN_C')).toBe('ADDED');          // B10
    expect(statusOf(result.tables, 'MV_DAILY_SALES')).toBe('ADDED');       // B6 (matview)
    expect(statusOf(result.tables, 'T_CHECKS')).toBe('UNCHANGED');         // B11 (identical)
  });

  it('cross-dialect Postgres → MySQL treats the portable type matrix as UNCHANGED', async () => {
    const [source, target] = await Promise.all([
      loadScopedTables('postgres', pg('foxdb'), 'demo_c'),
      loadScopedTables('mysql', mysql('demo_c'), 'demo_c'),
    ]);
    const result = await compareModule.compare(source, target, { source: 'postgres', target: 'mysql' });

    // t_all_types is canonically identical across engines — the type-mapping layer
    // must not false-flag it (this is the bug that the MariaDB 'NULL'-default fix guarded).
    expect(statusOf(result.tables, 'T_ALL_TYPES')).toBe('UNCHANGED');
  });
});
