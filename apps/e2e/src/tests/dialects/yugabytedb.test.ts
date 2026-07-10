import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'yugabytedb';

// Skipped unless E2E_YUGABYTEDB_SOURCE_* and _TARGET_* env vars point at a live
// YugabyteDB instance. YugabyteDB's YSQL reuses the PostgreSQL query layer, so
// it exercises the inherited Postgres provider + DDL strategy end to end.
describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!
  );
});
