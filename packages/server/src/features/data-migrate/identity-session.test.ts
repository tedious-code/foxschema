/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { DIALECT_MAP } from '@foxschema/sql';
import { identitySessionSql } from './identity-session';

describe('identitySessionSql', () => {
  it('opens and closes the session on SQL Server and Azure SQL', () => {
    for (const dialect of ['sqlserver', 'azuresql']) {
      const out = identitySessionSql(dialect, 'dbo.customers');
      expect(out.ok, dialect).toBe(true);
      if (!out.ok) return;
      expect(out.sessionSql, dialect).toEqual({
        before: 'SET IDENTITY_INSERT [dbo].[customers] ON',
        after: 'SET IDENTITY_INSERT [dbo].[customers] OFF',
      });
    }
  });

  it('quotes a name that would otherwise change the statement', () => {
    // The table name reaches the server from the client, and a session
    // statement cannot bind it as a parameter — so quoting is the only defence.
    const out = identitySessionSql('sqlserver', 'dbo.eviltable] ON; DROP TABLE users--');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sessionSql?.before).toBe(
      'SET IDENTITY_INSERT [dbo].[eviltable]] ON; DROP TABLE users--] ON'
    );
    // The injected bracket is doubled, so it stays inside the identifier.
    expect(out.sessionSql?.before.match(/\bON\b/g)).toHaveLength(2);
  });

  it('asks for nothing when no table was named', () => {
    const out = identitySessionSql('sqlserver', '   ');
    expect(out).toEqual({ ok: true, sessionSql: undefined });
  });

  it.each(Object.keys(DIALECT_MAP).filter((d) => !['SQLSERVER', 'AZURESQL'].includes(d)))(
    '%s needs no session change',
    (dialect) => {
      // Every other engine either takes the value plainly or gets an overriding
      // clause inside the INSERT. Emitting a session statement for one of them
      // would be a syntax error at the database.
      const out = identitySessionSql(dialect, 'public.customers');
      expect(out).toEqual({ ok: true, sessionSql: undefined });
    }
  );

  it('refuses a name that is not a table', () => {
    for (const bad of ['a.b.c.d', '.', '..']) {
      const out = identitySessionSql('sqlserver', bad);
      expect(out.ok, bad).toBe(false);
    }
  });

  it('handles a bare table name', () => {
    const out = identitySessionSql('sqlserver', 'customers');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.sessionSql?.before).toBe('SET IDENTITY_INSERT [customers] ON');
  });
});
