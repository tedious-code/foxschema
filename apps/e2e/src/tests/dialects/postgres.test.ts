import { describe } from 'vitest';
import { hasConfig, getSourceConfig, getTargetConfig } from '../../helpers/db-config.js';
import { runDialectFlow } from './shared-flow.js';

const DIALECT = 'postgres';

describe.skipIf(!hasConfig(DIALECT))(`Compare flow: ${DIALECT}`, () => {
  runDialectFlow(
    DIALECT,
    () => getSourceConfig(DIALECT)!,
    () => getTargetConfig(DIALECT)!,
    {
      // The demo_a→demo_b migrate adds fn_order_total and widens customers, so
      // History has something to show. A routine must not report Table growth
      // — that regression is the reason these assertions exist.
      historyObjects: [
        {
          name: 'fn_order_total',
          expectSource: true,
          expectGrowth: false,
          expectTimeline: /v\d+\s*·\s*ADD/i,
        },
        { name: 'customers', expectGrowth: true },
      ],
    }
  );
});
