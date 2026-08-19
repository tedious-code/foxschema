import { describe, expect, it } from 'vitest';
import {
  buildIndexDefragSql,
  buildIndexFragmentationCustomTemplate,
  buildIndexFragmentationQuery,
  dialectSupportsIndexFragmentation,
  fragmentationSeverity,
  isSafeIndexFragmentationCustomSql,
  normalizeIndexFragmentationRows,
  splitSchemaTable,
} from './dialect-index-fragmentation.js';

describe('dialectSupportsIndexFragmentation', () => {
  it('marks SQL Server as physical with query + defrag', () => {
    expect(dialectSupportsIndexFragmentation('sqlserver')).toMatchObject({
      mode: 'physical',
      query: true,
      defrag: true,
    });
    expect(dialectSupportsIndexFragmentation('azuresql').mode).toBe('physical');
  });

  it('enables a probe for every registered dialect', () => {
    for (const d of [
      'sqlserver',
      'azuresql',
      'postgres',
      'cockroachdb',
      'yugabytedb',
      'mysql',
      'mariadb',
      'tidb',
      'db2',
      'oracle',
      'sqlite',
      'duckdb',
      'clickhouse',
      'redshift',
    ]) {
      const s = dialectSupportsIndexFragmentation(d);
      expect(s.query, d).toBe(true);
      expect(s.mode, d).not.toBe('unsupported');
      expect(s.customSqlHint, d).toMatch(/index_name/i);
    }
  });
});

describe('splitSchemaTable', () => {
  it('splits qualified names and applies default schema', () => {
    expect(splitSchemaTable('dbo.Orders')).toEqual({ schema: 'dbo', table: 'Orders' });
    expect(splitSchemaTable('"public"."users"')).toEqual({ schema: 'public', table: 'users' });
    expect(splitSchemaTable('users', 'public')).toEqual({ schema: 'public', table: 'users' });
  });
});

describe('buildIndexFragmentationQuery', () => {
  it('builds SQL Server OBJECT_ID probe', () => {
    const q = buildIndexFragmentationQuery({
      dialect: 'sqlserver',
      schema: 'dbo',
      table: 'Orders',
    });
    expect('error' in q).toBe(false);
    if ('error' in q) return;
    expect(q.mode).toBe('physical');
    expect(q.params).toEqual(['dbo.Orders']);
    expect(q.sql).toMatch(/dm_db_index_physical_stats/i);
    expect(q.sql).toMatch(/OBJECT_ID\(\?\)/);
  });

  it('asks pgstatindex for leaf_fragmentation, not pgstattuple', () => {
    /**
     * The bug this pins, verified against PostgreSQL 17:
     *
     *   SELECT leaf_fragmentation FROM pgstattuple('i'::regclass::oid)
     *     ERROR: column "leaf_fragmentation" does not exist
     *   SELECT leaf_fragmentation FROM pgstatindex('i')
     *     0
     *
     * `pgstattuple` reports *table* statistics. Naming it here failed twice
     * over: without the extension Postgres says the function does not exist —
     * which is what users hit — and installing the extension, the obvious fix,
     * then failed on the missing column. The probe could never have worked.
     */
    const q = buildIndexFragmentationQuery({
      dialect: 'postgres',
      table: 'public.users',
    });
    expect('error' in q).toBe(false);
    if ('error' in q) return;
    expect(q.params).toEqual(['public', 'users']);
    expect(q.sql).toMatch(/pgstatindex\(/);
    expect(q.sql).not.toMatch(/FROM pgstattuple\(/);
  });

  it('does not let an unmeasured index reach the grid as NaN', () => {
    // pgstatindex returns NaN for an index with no leaf pages yet. That is
    // "nothing measured", not a number, and "NaN%" in a column reads as a bug.
    const q = buildIndexFragmentationQuery({ dialect: 'postgres', table: 'public.users' });
    if ('error' in q) throw new Error(q.error);
    expect(q.sql).toMatch(/NULLIF\(/);
    expect(q.sql).toMatch(/'NaN'::float8/);
  });

  it('builds probes for formerly unsupported dialects', () => {
    const sqlite = buildIndexFragmentationQuery({ dialect: 'sqlite', table: 'orders' });
    expect('error' in sqlite).toBe(false);
    if (!('error' in sqlite)) {
      expect(sqlite.mode).toBe('estimated');
      expect(sqlite.sql).toMatch(/sqlite_master/i);
      expect(sqlite.params).toEqual(['orders']);
    }

    const duck = buildIndexFragmentationQuery({
      dialect: 'duckdb',
      schema: 'main',
      table: 't',
    });
    expect('error' in duck).toBe(false);
    if (!('error' in duck)) {
      expect(duck.sql).toMatch(/duckdb_indexes/i);
      expect(duck.params).toEqual(['t', 'main']);
    }

    const ch = buildIndexFragmentationQuery({
      dialect: 'clickhouse',
      schema: 'default',
      table: 'events',
    });
    expect('error' in ch).toBe(false);
    if (!('error' in ch)) {
      expect(ch.sql).toMatch(/data_skipping_indices/i);
    }

    const rs = buildIndexFragmentationQuery({ dialect: 'redshift', table: 'fact' });
    expect('error' in rs).toBe(false);
    if (!('error' in rs)) {
      expect(rs.sql).toMatch(/WHERE 1 = 0/i);
    }
  });

  it('requires schema for MySQL and DB2', () => {
    expect(buildIndexFragmentationQuery({ dialect: 'mysql', table: 't' })).toEqual({
      error: 'MySQL-family fragmentation probe needs a schema (database) name.',
    });
    expect(buildIndexFragmentationQuery({ dialect: 'db2', table: 'T' })).toEqual({
      error: 'DB2 fragmentation probe needs a schema name.',
    });
  });
});

describe('normalizeIndexFragmentationRows', () => {
  it('accepts mixed casings and clamps percents', () => {
    expect(
      normalizeIndexFragmentationRows([
        { INDEX_NAME: 'ix1', Fragmentation_Percent: 12.5, PAGE_COUNT: 9 },
        { index_name: 'ix2', avg_fragmentation_in_percent: 150 },
        { name: '', fragmentation_percent: 1 },
      ])
    ).toEqual([
      { indexName: 'ix1', fragmentationPercent: 12.5, pageCount: 9 },
      { indexName: 'ix2', fragmentationPercent: 100, pageCount: null },
    ]);
  });
});

describe('fragmentationSeverity / defrag SQL', () => {
  it('bands severity', () => {
    expect(fragmentationSeverity(null)).toBe('unknown');
    expect(fragmentationSeverity(5)).toBe('ok');
    expect(fragmentationSeverity(15)).toBe('warn');
    expect(fragmentationSeverity(40)).toBe('critical');
  });

  it('suggests REORGANIZE vs REBUILD on SQL Server', () => {
    expect(
      buildIndexDefragSql({
        dialect: 'sqlserver',
        schema: 'dbo',
        table: 'Orders',
        indexName: 'IX_A',
        fragmentationPercent: 12,
      })
    ).toEqual(['ALTER INDEX [IX_A] ON [dbo].[Orders] REORGANIZE;']);
    expect(
      buildIndexDefragSql({
        dialect: 'sqlserver',
        schema: 'dbo',
        table: 'Orders',
        indexName: 'IX_A',
        fragmentationPercent: 40,
      })
    ).toEqual(['ALTER INDEX [IX_A] ON [dbo].[Orders] REBUILD;']);
  });

  it('suggests OPTIMIZE TABLE on MySQL', () => {
    expect(
      buildIndexDefragSql({
        dialect: 'mysql',
        schema: 'app',
        table: 'users',
        indexName: 'ix_email',
      })
    ).toEqual(['OPTIMIZE TABLE `app`.`users`;']);
  });

  it('suggests REINDEX on SQLite and OPTIMIZE on ClickHouse', () => {
    expect(
      buildIndexDefragSql({
        dialect: 'sqlite',
        table: 'orders',
        indexName: 'ix_orders_customer',
      })
    ).toEqual(['REINDEX "ix_orders_customer";', '-- Or whole DB: VACUUM;']);
    expect(
      buildIndexDefragSql({
        dialect: 'clickhouse',
        schema: 'default',
        table: 'events',
        indexName: 'idx_ts',
      })
    ).toEqual(['OPTIMIZE TABLE `default`.`events` FINAL;']);
  });
});

describe('custom SQL safety', () => {
  it('allows SELECT / WITH and rejects writes / multi-statements', () => {
    expect(isSafeIndexFragmentationCustomSql('SELECT 1 AS index_name, 0 AS fragmentation_percent')).toBe(
      true
    );
    expect(isSafeIndexFragmentationCustomSql('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(true);
    expect(isSafeIndexFragmentationCustomSql('DELETE FROM t')).toMatch(/SELECT/i);
    expect(
      isSafeIndexFragmentationCustomSql('SELECT 1; DROP TABLE t')
    ).toMatch(/single statement/i);
  });

  it('rejects data-modifying CTEs that still end in SELECT', () => {
    expect(
      isSafeIndexFragmentationCustomSql(
        `WITH wiped AS (
          DELETE FROM orders
          RETURNING 'idx'::text AS index_name, 0::float AS fragmentation_percent
        )
        SELECT * FROM wiped`
      )
    ).toMatch(/read-only/i);
  });

  it('builds a non-empty custom template per major dialect', () => {
    for (const d of [
      'sqlserver',
      'postgres',
      'mysql',
      'db2',
      'oracle',
      'sqlite',
      'duckdb',
      'clickhouse',
      'redshift',
    ]) {
      expect(buildIndexFragmentationCustomTemplate({ dialect: d, schema: 's', table: 't' })).toMatch(
        /index_name/i
      );
    }
  });
});
