/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which engines genuinely require a schema before their catalog can be read.
 *
 * `schemaRequired` is not a display hint. `POST /schema/load`
 * (`packages/server/src/features/schema/schema.routes.ts`) reads it and refuses
 * the request outright when it is true and no schema is set, so getting it
 * wrong for an engine makes every schema-less connection to that engine
 * unusable — while the connection itself saves fine, because the form marks the
 * field optional from the same flag.
 *
 * That is exactly what happened to PostgreSQL: this registry said `true`, the
 * browser's copy of it said `false`, and the two were never reconciled. These
 * tests pin the answer so the flag cannot drift back silently.
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_SETTINGS, getProviderSettings } from './provider-settings.js';

describe('PostgreSQL does not require a schema', () => {
  /**
   * `search_path` defaults to `public`, so an unqualified name resolves without
   * anyone setting a schema. `packages/db/src/providers/postgres/postgres.provider.ts`
   * already falls back to `'public'` when none is given — the whole stack below
   * the flag handles it. Requiring one rejects a connection that works.
   */
  it('is optional for postgres', () => {
    expect(getProviderSettings('postgres').schemaRequired).toBe(false);
  });

  it('is optional for every PostgreSQL-wire dialect, consistently', () => {
    // CockroachDB and YugabyteDB speak the same wire protocol and default to
    // the same `public` schema. They already answered `false` while postgres
    // answered `true`, which is what gave the inconsistency away.
    for (const dialect of ['postgres', 'cockroachdb', 'yugabytedb']) {
      expect(getProviderSettings(dialect).schemaRequired, `${dialect} should not require a schema`).toBe(
        false
      );
    }
  });

  it('still advertises public as the default schema', () => {
    // Optional is not the same as absent: the form still pre-fills `public`.
    expect(getProviderSettings('postgres').defaultSchema).toBe('public');
  });
});

describe('the engines that do require a schema still do', () => {
  /**
   * Guard against the change above being applied too broadly. These three have
   * no usable default: Db2 and ClickHouse need a schema/database to qualify a
   * name, and Redshift is a fork whose catalog queries are schema-scoped.
   */
  it.each(['db2', 'clickhouse', 'redshift'])('%s requires a schema', (dialect) => {
    expect(getProviderSettings(dialect).schemaRequired).toBe(true);
  });
});

describe('the flag is set deliberately for every dialect', () => {
  it('is a boolean everywhere, never left undefined', () => {
    // `settings.schemaRequired && !schema` treats undefined as false, so a
    // missing flag silently means "optional" rather than failing loudly.
    const missing = Object.entries(PROVIDER_SETTINGS)
      .filter(([, s]) => typeof s.schemaRequired !== 'boolean')
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });
});
