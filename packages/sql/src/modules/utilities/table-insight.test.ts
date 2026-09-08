/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildTableInsightQuery,
  dialectSupportsTableInsight,
  tableInsightDialectIds,
} from './table-insight';

describe('table insight probes', () => {
  it('offers a catalog probe for every registered dialect', () => {
    const ids = tableInsightDialectIds();
    expect(ids.length).toBeGreaterThan(8);
    for (const dialect of ids) {
      const support = dialectSupportsTableInsight(dialect);
      expect(support.query).toBe(true);
      const q = buildTableInsightQuery({ dialect, schema: 'public', table: 'orders' });
      expect(q).toHaveProperty('sql');
      if ('sql' in q) {
        expect(q.sql).not.toMatch(/count\s*\(\s*distinct/i);
        expect(q.sql.toLowerCase()).not.toContain('count(distinct');
      }
    }
  });

  it('fails closed without a table name', () => {
    expect(buildTableInsightQuery({ dialect: 'postgres', table: '  ' })).toEqual({
      error: 'table is required.',
    });
  });

  it('uses pg_stats on postgres and sqlite_stat1 on sqlite', () => {
    const pg = buildTableInsightQuery({ dialect: 'postgres', schema: 'app', table: 't' });
    expect(pg).toMatchObject({ params: ['app', 't'] });
    if ('sql' in pg) expect(pg.sql.toLowerCase()).toContain('pg_stats');
    const lite = buildTableInsightQuery({ dialect: 'sqlite', table: 't' });
    if ('sql' in lite) expect(lite.sql.toLowerCase()).toContain('sqlite_stat1');
  });
});
