/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { connectionDatabaseNames } from './catalog-databases';

describe('connectionDatabaseNames', () => {
  it('treats MySQL schemas as databases', () => {
    expect(
      connectionDatabaseNames({
        dialect: 'mysql',
        database: 'app',
        schemas: ['app', 'reporting', 'mysql'],
      })
    ).toEqual(['app', 'mysql', 'reporting']);
  });

  it('treats MariaDB and TiDB the same way', () => {
    expect(
      connectionDatabaseNames({
        dialect: 'tidb',
        database: 'app',
        schemas: ['other'],
      })
    ).toEqual(['app', 'other']);
  });

  it('does not promote Postgres schemas to databases', () => {
    // public is a schema. GRANT CONNECT ON DATABASE public is nonsense.
    expect(
      connectionDatabaseNames({
        dialect: 'postgres',
        database: 'app',
        schemas: ['public', 'reporting', 'app'],
      })
    ).toEqual(['app']);
  });

  it('does not promote SQL Server, Oracle, or Db2 schemas either', () => {
    for (const dialect of ['sqlserver', 'oracle', 'db2', 'azuresql']) {
      expect(
        connectionDatabaseNames({
          dialect,
          database: 'FOXDB',
          schemas: ['dbo', 'sales'],
        }),
        dialect
      ).toEqual(['FOXDB']);
    }
  });

  it('is empty when the connection has no database name and schemas are not databases', () => {
    expect(connectionDatabaseNames({ dialect: 'postgres', schemas: ['public'] })).toEqual([]);
  });
});
