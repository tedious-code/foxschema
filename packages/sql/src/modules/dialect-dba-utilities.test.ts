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
} from './dialect-dba-utilities.js';

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

describe('DB2 session query columns', () => {
  it('does not select SESSION_DB_PARTITION_NUM', () => {
    // MON_GET_CONNECTION has no such column. DB2 answers SQL0206N, so the
    // Sessions utility failed for every DB2 user until this was corrected.
    const built = buildDbaUtilityQuery({ dialect: 'db2', kind: 'sessions' });
    expect('error' in built).toBe(false);
    const sql = (built as { sql: string }).sql;
    expect(sql).not.toContain('SESSION_DB_PARTITION_NUM');
    // Verified live on DB2 11.5: this returns the database, which is what the
    // column claims to be — a partition number was wrong for it regardless.
    expect(sql).toContain('CURRENT SERVER AS database_name');
  });
});

describe('MariaDB is not a MySQL alias for these probes', () => {
  /**
   * Both bugs verified against MariaDB 11.8:
   *
   *   SELECT @@innodb_buffer_pool_instances;
   *     ERROR 1193 (HY000): Unknown system variable
   *   SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE ...
   *     (empty — performance_schema is off by default)
   *   SELECT VARIABLE_VALUE FROM information_schema.GLOBAL_STATUS WHERE ...
   *     245412
   *
   * The first killed System info outright. The second was worse: no error, a
   * blank connection count in the pool panel.
   */
  const sqlFor = (kind: 'pool' | 'sessions' | 'system' | 'sizes') => {
    const q = buildDbaUtilityQuery({ dialect: 'mariadb', kind, schema: 'foxdb' });
    if ('error' in q) throw new Error(`${kind}: ${q.error}`);
    return q.sql;
  };

  it('does not reference a system variable MariaDB removed in 10.5', () => {
    expect(sqlFor('system')).not.toMatch(/innodb_buffer_pool_instances/);
  });

  it('reads status from information_schema, which MariaDB populates by default', () => {
    for (const kind of ['pool', 'system'] as const) {
      expect(sqlFor(kind), kind).toMatch(/information_schema\.GLOBAL_STATUS/i);
      expect(sqlFor(kind), kind).not.toMatch(/performance_schema\.global_status/i);
    }
  });

  it('still answers every utility kind rather than erroring on an unknown family', () => {
    // Splitting mariadb out of the mysql family is what would break these.
    for (const kind of ['pool', 'sessions', 'system', 'sizes'] as const) {
      expect(sqlFor(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('keeps buffer pool size and uptime, which MariaDB does have', () => {
    const sql = sqlFor('system');
    expect(sql).toMatch(/innodb_buffer_pool_size/);
    expect(sql).toMatch(/'Uptime'/);
  });

  it('leaves MySQL itself on the performance_schema path', () => {
    const q = buildDbaUtilityQuery({ dialect: 'mysql', kind: 'pool' });
    if ('error' in q) throw new Error(q.error);
    expect(q.sql).toMatch(/performance_schema\.global_status/i);
  });
});
