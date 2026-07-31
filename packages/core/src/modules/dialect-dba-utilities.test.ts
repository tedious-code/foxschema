/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildDbaUtilityQuery,
  dialectSupportsDbaUtility,
  formatBytes,
  normalizeConnectionPoolRows,
  normalizeObjectSizeRows,
  normalizeSystemInfoRows,
  normalizeUserSessionRows,
} from './dialect-dba-utilities';

describe('dialect-dba-utilities', () => {
  it('reports support for major dialects and kinds', () => {
    expect(dialectSupportsDbaUtility('postgres', 'pool').query).toBe(true);
    expect(dialectSupportsDbaUtility('mysql', 'sessions').query).toBe(true);
    expect(dialectSupportsDbaUtility('sqlserver', 'system').query).toBe(true);
    expect(dialectSupportsDbaUtility('sqlite', 'sizes').query).toBe(true);
    expect(dialectSupportsDbaUtility('sqlite', 'pool').query).toBe(false);
    expect(dialectSupportsDbaUtility('duckdb', 'sessions').query).toBe(false);
  });

  it('builds pool / sessions / system / sizes queries', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlserver', 'sqlite'] as const) {
      for (const kind of ['pool', 'sessions', 'system', 'sizes'] as const) {
        const support = dialectSupportsDbaUtility(dialect, kind);
        const q = buildDbaUtilityQuery({ dialect, kind, schema: 'public' });
        if (!support.query) {
          expect('error' in q).toBe(true);
        } else {
          expect('sql' in q).toBe(true);
          if ('sql' in q) expect(q.sql.length).toBeGreaterThan(20);
        }
      }
    }
  });

  it('normalizes pool / sessions / system / sizes rows', () => {
    expect(
      normalizeConnectionPoolRows([
        { max_connections: 100, current_connections: 12, active_connections: 3 },
      ])
    ).toMatchObject({
      maxConnections: 100,
      currentConnections: 12,
      activeConnections: 3,
      availableConnections: 88,
    });

    expect(
      normalizeUserSessionRows([{ session_id: '1', user_name: 'alice', state: 'active' }])
    ).toEqual([
      expect.objectContaining({ sessionId: '1', userName: 'alice', state: 'active' }),
    ]);

    expect(
      normalizeSystemInfoRows([
        {
          cpu_count: 8,
          memory_total_bytes: 16_000_000_000,
          memory_available_bytes: 4_000_000_000,
          storage_used_bytes: 1_000,
          server_version: 'PostgreSQL 16',
        },
      ])
    ).toMatchObject({
      cpuCount: 8,
      memoryUsedBytes: 12_000_000_000,
      serverVersion: 'PostgreSQL 16',
    });

    expect(
      normalizeObjectSizeRows([
        {
          schema_name: 'public',
          object_name: 'users',
          object_type: 'table',
          total_bytes: 4096,
          row_count: 10,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        schemaName: 'public',
        objectName: 'users',
        objectType: 'table',
        totalBytes: 4096,
        rowCount: 10,
      }),
    ]);
  });

  it('formats bytes', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('builds DB2 sizes with total >= data and index rows', () => {
    const q = buildDbaUtilityQuery({ dialect: 'db2', kind: 'sizes', schema: 'CARTER' });
    expect('sql' in q).toBe(true);
    if (!('sql' in q)) return;
    expect(q.sql).toMatch(/FPAGES/);
    expect(q.sql).toMatch(/NLEAF/);
    expect(q.sql).toMatch(/PAGESIZE/);
    expect(q.sql).toMatch(/'index'/);
    expect(q.params).toEqual(['CARTER', 'CARTER']);
  });
});
