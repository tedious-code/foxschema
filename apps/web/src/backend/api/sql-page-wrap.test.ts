import { describe, expect, it } from 'vitest';
import { isPageableStatement, trimPageProbe, wrapSqlForPage } from './sql-page-wrap';

describe('sql-page-wrap', () => {
  it('wraps postgres-style with LIMIT/OFFSET and +1 probe', () => {
    expect(wrapSqlForPage('SELECT 1;', 'postgres', 40, 20)).toBe(
      'SELECT * FROM (SELECT 1) AS _fox_page LIMIT 21 OFFSET 40'
    );
  });

  it('wraps sqlserver with ORDER BY OFFSET FETCH', () => {
    const sql = wrapSqlForPage('SELECT id FROM t', 'sqlserver', 0, 10);
    expect(sql).toContain('OFFSET 0 ROWS FETCH NEXT 11 ROWS ONLY');
    expect(sql).toContain('ORDER BY (SELECT NULL)');
  });

  it('trimPageProbe drops probe row and sets hasNext', () => {
    const shaped = {
      columns: ['a'],
      rows: [[1], [2], [3]],
      rowCount: 3,
      truncated: false,
    };
    const t = trimPageProbe(shaped, 2);
    expect(t.rows).toEqual([[1], [2]]);
    expect(t.hasNext).toBe(true);
    expect(t.truncated).toBe(true);
  });

  it('isPageableStatement accepts SELECT / WITH…SELECT / VALUES only', () => {
    expect(isPageableStatement('SELECT 1')).toBe(true);
    expect(isPageableStatement('WITH c AS (SELECT 1 AS n) SELECT * FROM c')).toBe(true);
    expect(isPageableStatement('VALUES (1), (2)')).toBe(true);
    expect(isPageableStatement('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isPageableStatement('UPDATE t SET a = 1')).toBe(false);
    expect(isPageableStatement('SET search_path TO public')).toBe(false);
    expect(isPageableStatement('EXPLAIN SELECT 1')).toBe(false);
    expect(isPageableStatement('WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c')).toBe(false);
  });
});
