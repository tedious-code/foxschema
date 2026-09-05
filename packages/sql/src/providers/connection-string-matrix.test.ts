/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every dialect can build a connection string. All sixteen of them.
 *
 * `buildConnectionString` is the first thing `ConnectionFactory.create` calls,
 * before any driver is touched — so a dialect that throws here fails with a
 * message about settings from a line that looks like it is about the driver,
 * and it fails for *every* connection to that engine, not an edge case.
 *
 * Until now only redis and mongodb had coverage (`nosql-settings.test.ts`),
 * because they were the two that had been broken and noticed. The other
 * fourteen were untested. This is the matrix: cheap, no I/O, and it grows
 * automatically when a dialect is registered, so a new engine cannot ship
 * without at least this much.
 *
 * What it deliberately does *not* assert is the exact string per engine — that
 * is each provider's own business and is pinned where it matters (see the
 * redis/mongodb cases). This pins the contract they all share.
 */
import { describe, expect, it } from 'vitest';
import { PROVIDER_SETTINGS, getProviderSettings } from './provider-settings.js';
import type { ConnectionOptions } from '../interfaces/schema-provider.interface.js';

const DIALECTS = Object.keys(PROVIDER_SETTINGS).sort();

/** Dialects whose "database" is a path on disk, not a host and port. */
const FILE_DIALECTS = new Set(['sqlite', 'duckdb']);

function optionsFor(dialect: string): ConnectionOptions {
  if (FILE_DIALECTS.has(dialect)) {
    return { file: '/tmp/fox-example.db', database: '/tmp/fox-example.db' } as ConnectionOptions;
  }
  return {
    host: 'db.example.internal',
    port: PROVIDER_SETTINGS[dialect]!.defaultPort || undefined,
    database: 'appdb',
    username: 'app_user',
    password: 'pw-with-specials-:@/?#[]',
    schema: 'app_schema',
  } as ConnectionOptions;
}

describe('the matrix covers every registered dialect', () => {
  it('finds them all, so the checks below are not vacuous', () => {
    // A broken registry read would make every assertion pass by iterating none.
    expect(DIALECTS.length).toBeGreaterThanOrEqual(16);
    for (const required of ['postgres', 'mysql', 'oracle', 'db2', 'sqlserver', 'redis', 'mongodb']) {
      expect(DIALECTS, required).toContain(required);
    }
  });
});

describe.each(DIALECTS)('%s', (dialect) => {
  const settings = getProviderSettings(dialect);

  it('builds a non-empty connection string', () => {
    const built = settings.buildConnectionString(optionsFor(dialect));
    expect(typeof built, dialect).toBe('string');
    expect(built.trim().length, dialect).toBeGreaterThan(0);
  });

  it('resolves case-insensitively, because saved connections vary', () => {
    // A dialect is stored as typed; `getAdapter` lowercases and this must agree.
    expect(getProviderSettings(dialect.toUpperCase()).dialect).toBe(dialect);
  });

  it('describes itself well enough for the connection form', () => {
    expect(settings.label, dialect).toBeTruthy();
    expect(settings.dialect, dialect).toBe(dialect);
    expect(Number.isInteger(settings.defaultPort), dialect).toBe(true);
    // 0 is legitimate for a file-backed store; a negative port is not.
    expect(settings.defaultPort, dialect).toBeGreaterThanOrEqual(0);
  });

  it('does not leak the password into a value meant for display', () => {
    // The connection string legitimately carries credentials; `label` is what
    // the UI renders, and it must never be built from the options.
    expect(settings.label).not.toMatch(/pw-with-specials/);
  });

  it('survives a bare minimum of options without throwing', () => {
    // A half-filled connection form is the normal state while typing. Throwing
    // here turns an incomplete form into an error dialog.
    const bare = FILE_DIALECTS.has(dialect)
      ? ({ file: '/tmp/x.db' } as ConnectionOptions)
      : ({ host: 'localhost' } as ConnectionOptions);
    expect(() => settings.buildConnectionString(bare), dialect).not.toThrow();
  });
});
