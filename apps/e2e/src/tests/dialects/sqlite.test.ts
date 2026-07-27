import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'sqlite';

// SQLite adapter is SELECT-only for execute paths used by migration deploy —
// cover connect + compare here; DDL/apply is exercised via SQL Editor blueprint
// tests against local sqlite3-seeded files.
describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!,
    { skipMigration: true }
  );
});
