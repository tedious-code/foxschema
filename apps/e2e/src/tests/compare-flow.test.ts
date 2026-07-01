/**
 * Full compare + migrate + history test for Postgres (convenience shortcut).
 * The dialect-specific suite in dialects/postgres.test.ts does the same thing
 * but through the shared flow. This file exists as a quick sanity check that
 * can be run alone: `npx vitest run src/tests/compare-flow.test.ts`
 *
 * Env vars (all required):
 *   E2E_POSTGRES_SOURCE_HOST / PORT / DB / USER / PASS / SCHEMA
 *   E2E_POSTGRES_TARGET_HOST / PORT / DB / USER / PASS / SCHEMA
 */
import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../helpers/db-config.js';
import { runDialectFlow } from './dialects/shared-flow.js';

const DIALECT = 'postgres';

describe.skipIf(!hasConfig(DIALECT))('Full flow: Postgres compare → migrate → history', () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!
  );
});
