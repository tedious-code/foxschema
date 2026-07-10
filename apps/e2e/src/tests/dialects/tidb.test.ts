import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'tidb';

// Skipped unless E2E_TIDB_SOURCE_* and _TARGET_* env vars point at a live TiDB
// instance. TiDB speaks the MySQL protocol, so it exercises the inherited MySQL
// provider + DDL strategy end to end.
describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!
  );
});
