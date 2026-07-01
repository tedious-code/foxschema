import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'mysql';

describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!
  );
});
