import { describe, expect, it } from 'vitest';
import {
  hasTopLevelOrderBy,
  isPageableStatement,
  trimPageProbe,
  wrapSqlForPage,
} from './sql-page-wrap';

describe('sql-page-wrap', () => {
  it('wraps postgres-style with LIMIT/OFFSET and +1 probe', () => {
    expect(wrapSqlForPage('SELECT 1;', 'postgres', 40, 20)).toBe(
      'SELECT * FROM (SELECT 1) AS fox_page LIMIT 21 OFFSET 40'
    );
  });

  it('wraps db2 without a leading-underscore alias (SQL20521N)', () => {
    const sql = wrapSqlForPage('select * from USER order by id DESC', 'db2', 0, 200);
    expect(sql).toBe(
      'SELECT * FROM (select * from USER order by id DESC) AS fox_page OFFSET 0 ROWS FETCH FIRST 201 ROWS ONLY'
    );
    expect(sql).not.toMatch(/_fox_page/);
  });

  it('wraps sqlserver without ORDER BY using dummy ORDER BY + OFFSET FETCH', () => {
    const sql = wrapSqlForPage('SELECT id FROM t', 'sqlserver', 0, 10);
    expect(sql).toContain('OFFSET 0 ROWS FETCH NEXT 11 ROWS ONLY');
    expect(sql).toContain('ORDER BY (SELECT NULL)');
  });

  it('uses T-SQL OFFSET/FETCH for azuresql (not MySQL LIMIT)', () => {
    const sql = wrapSqlForPage('SELECT id FROM t', 'azuresql', 20, 10);
    expect(sql).toContain('OFFSET 20 ROWS FETCH NEXT 11 ROWS ONLY');
    expect(sql).not.toMatch(/\bLIMIT\b/i);
  });

  it('appends OFFSET/FETCH when T-SQL query already has top-level ORDER BY', () => {
    const sql = wrapSqlForPage('SELECT id FROM t ORDER BY id', 'sqlserver', 10, 5);
    expect(sql).toBe('SELECT id FROM t ORDER BY id OFFSET 10 ROWS FETCH NEXT 6 ROWS ONLY');
  });

  it('appends OFFSET/FETCH for azuresql ORDER BY queries', () => {
    const sql = wrapSqlForPage(
      'SELECT id, name FROM dbo.users ORDER BY name;',
      'azuresql',
      0,
      50
    );
    expect(sql).toBe(
      'SELECT id, name FROM dbo.users ORDER BY name OFFSET 0 ROWS FETCH NEXT 51 ROWS ONLY'
    );
  });

  it('hasTopLevelOrderBy ignores ORDER BY inside subqueries/strings', () => {
    expect(hasTopLevelOrderBy('SELECT id FROM t ORDER BY id')).toBe(true);
    expect(hasTopLevelOrderBy('SELECT * FROM (SELECT id FROM t ORDER BY id) x')).toBe(false);
    expect(hasTopLevelOrderBy("SELECT 'ORDER BY' AS s FROM t")).toBe(false);
    expect(hasTopLevelOrderBy('SELECT id FROM t -- ORDER BY id')).toBe(false);
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
