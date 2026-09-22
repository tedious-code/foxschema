/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The frontend's `PROVIDER_SETTINGS` is a real copy of the core one. Pin them.
 *
 * Almost everything in `shared/lib/` is a thin re-export of `@foxschema/sql`.
 * This file is not: it re-implements each dialect's connection metadata and
 * `buildConnectionString` so the credential form can build a connection string
 * in the browser without pulling the driver runtime in. That duplication is
 * deliberate and is documented in `docs/ARCHITECTURE.md`.
 *
 * Deliberate duplication still drifts. When this test was written the two
 * registries had already disagreed on `postgres.schemaRequired` — core says a
 * schema is required, the browser form says it is not — and nothing anywhere
 * would have said so. The "adding a dialect" checklist has a step for updating
 * this copy; a checklist step is exactly the kind of thing that gets missed.
 *
 * What this pins:
 *   - the same set of dialects exists on both sides;
 *   - label, defaultPort, defaultSchema and schemaRequired agree;
 *   - buildConnectionString produces the same string for a representative
 *     option set.
 *
 * KNOWN_DIVERGENCES records what is already out of step, so this test can be
 * green today without pretending the drift is not there. Each entry is a
 * question for a human, not a licence to add more. The list should shrink.
 */
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_SETTINGS as CORE_SETTINGS,
  type ConnectionOptions as CoreConnectionOptions,
} from '@foxschema/sql';
import { PROVIDER_SETTINGS as FRONTEND_SETTINGS } from './provider-settings';

/**
 * Fields that already disagree, with the reason they have not been reconciled.
 *
 * `postgres.schemaRequired` is a product question: the browser form lets a
 * Postgres connection be saved with no schema, the core settings say one is
 * required. Making them agree changes behaviour in the connection modal, so it
 * is not something to decide inside a parity test.
 */
const KNOWN_DIVERGENCES = new Set<string>([
  // core: true (a schema is required) · frontend: false (the form allows none)
  'postgres.schemaRequired',
  // core: undefined · frontend: '' — both falsy, no behavioural difference.
  'db2.defaultSchema',
]);

const COMPARED_FIELDS = ['label', 'defaultPort', 'defaultSchema', 'schemaRequired'] as const;

/**
 * One option set that exercises the parts of a connection string that differ
 * between engines: credentials that need escaping, a non-default port, TLS, and
 * a schema.
 */
const SAMPLE: CoreConnectionOptions = {
  host: 'db.example.test',
  port: 15432,
  database: 'analytics',
  schema: 'reporting',
  username: 'svc_report',
  password: 'p@ss:word/with+specials',
  ssl: { enabled: true },
};

describe('frontend PROVIDER_SETTINGS matches @foxschema/sql', () => {
  it('covers the same dialects', () => {
    expect(Object.keys(FRONTEND_SETTINGS).sort()).toEqual(Object.keys(CORE_SETTINGS).sort());
  });

  for (const dialect of Object.keys(CORE_SETTINGS)) {
    describe(dialect, () => {
      for (const field of COMPARED_FIELDS) {
        const key = `${dialect}.${field}`;
        const known = KNOWN_DIVERGENCES.has(key);

        it(`${field} agrees${known ? ' (known divergence)' : ''}`, () => {
          const core = CORE_SETTINGS[dialect] as unknown as Record<string, unknown>;
          const frontend = FRONTEND_SETTINGS[dialect] as unknown as Record<string, unknown>;
          if (known) {
            // Pinned as-is: if someone reconciles these, this flips and the
            // entry should come out of KNOWN_DIVERGENCES.
            expect(
              String(core[field]),
              `${key} is listed in KNOWN_DIVERGENCES but now agrees — remove the entry`,
            ).not.toBe(String(frontend[field]));
            return;
          }
          expect(String(frontend[field]), `${key} drifted from @foxschema/sql`).toBe(
            String(core[field]),
          );
        });
      }

      it('buildConnectionString produces the same string', () => {
        const core = CORE_SETTINGS[dialect];
        const frontend = FRONTEND_SETTINGS[dialect];
        expect(
          frontend.buildConnectionString(SAMPLE),
          `${dialect}.buildConnectionString drifted from @foxschema/sql`,
        ).toBe(core.buildConnectionString(SAMPLE));
      });
    });
  }
});
