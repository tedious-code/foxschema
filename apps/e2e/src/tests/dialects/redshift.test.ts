import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'redshift';

describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  // Local service is Postgres-shaped; Redshift-specific DDL (e.g. DISTSTYLE /
  // SORTKEY expectations in the planner) still fails migrate on the stand-in.
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!,
    { skipMigration: true }
  );
});
