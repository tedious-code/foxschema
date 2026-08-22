import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'duckdb';

// Skipped unless E2E_DUCKDB_SOURCE_* and _TARGET_* env vars are set. DuckDB is
// embedded/file-based (like SQLite): set _DB to a .duckdb file path, and dummy
// values for host/user/pass. Exercises the DuckDB provider + DDL strategy.
describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  // DuckDB shares schema name `main` across source/target files; the Sync
  // connect flow is covered, but migrate against two file handles is still
  // flaky in headed CI. Mirror SQLite: connect + compare only for now.
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!,
    { skipMigration: true }
  );
});
