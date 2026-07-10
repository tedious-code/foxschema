import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'cockroachdb';

// Skipped unless E2E_COCKROACHDB_SOURCE_* and _TARGET_* env vars point at a live
// CockroachDB instance — same gating as the other variant dialects (redshift,
// azuresql). CockroachDB is Postgres wire-compatible, so it exercises the
// inherited Postgres provider + DDL strategy end to end.
describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!
  );
});
