import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'clickhouse';

describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  // ClickHouse DDL from the migrate planner still emits PostgreSQL-style
  // PRIMARY KEY clauses that MergeTree rejects — cover connect + compare.
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!,
    { skipMigration: true }
  );
});
