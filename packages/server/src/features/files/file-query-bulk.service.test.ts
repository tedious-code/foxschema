import { describe, expect, it } from 'vitest';
import {
  buildCreateTableSql,
  bulkChunkSize,
  bulkRowsPerStatement,
  inferColumnTypes,
  sqlTypeForDialect,
} from './file-query-bulk.service';

describe('file-query bulk helpers', () => {
  it('maps types per dialect', () => {
    expect(sqlTypeForDialect('postgres', 'INTEGER')).toBe('BIGINT');
    expect(sqlTypeForDialect('postgres', 'REAL')).toBe('DOUBLE PRECISION');
    expect(sqlTypeForDialect('mysql', 'REAL')).toBe('DOUBLE');
    expect(sqlTypeForDialect('sqlserver', 'TEXT')).toBe('NVARCHAR(MAX)');
    expect(sqlTypeForDialect('oracle', 'INTEGER')).toBe('NUMBER(19)');
    expect(sqlTypeForDialect('clickhouse', 'REAL')).toBe('Float64');
    expect(sqlTypeForDialect('sqlite', 'TEXT')).toBe('TEXT');
  });

  it('uses smaller chunks for param-limited engines', () => {
    expect(bulkChunkSize('postgres')).toBe(200);
    expect(bulkChunkSize('sqlserver')).toBe(50);
    expect(bulkChunkSize('oracle')).toBe(50);
    expect(bulkChunkSize('mysql')).toBe(100);
  });

  it('infers column types from matrix samples', () => {
    const types = inferColumnTypes(
      ['id', 'price', 'name'],
      [
        ['1', '1.5', 'Ada'],
        ['2', '2.0', 'Grace'],
      ]
    );
    expect(types).toEqual(['INTEGER', 'REAL', 'TEXT']);
  });

  it('builds dialect-quoted CREATE TABLE', () => {
    const pg = buildCreateTableSql('postgres', 't', ['id', 'name'], ['INTEGER', 'TEXT']);
    expect(pg).toContain('"t"');
    expect(pg).toContain('"id" BIGINT');
    const my = buildCreateTableSql('mysql', 't', ['id'], ['INTEGER']);
    expect(my).toContain('`t`');
    expect(my).toContain('`id` BIGINT');
  });
});

describe('bulkRowsPerStatement', () => {
  it('keeps the old batch size when the engine limit is not the constraint', () => {
    expect(bulkRowsPerStatement('postgres', 10)).toBe(200);
    expect(bulkRowsPerStatement('mysql', 10)).toBe(100);
    expect(bulkRowsPerStatement('sqlserver', 10)).toBe(50);
  });

  it("stays under SQL Server's parameter limit for a wide file", () => {
    // 50 rows × 60 columns = 3,000 bound parameters; SQL Server allows 2,100.
    for (const dialect of ['sqlserver', 'azuresql']) {
      const rows = bulkRowsPerStatement(dialect, 60);
      expect(rows * 60).toBeLessThanOrEqual(2_100);
      expect(rows).toBeGreaterThan(0);
    }
  });

  it('sends Oracle one row per VALUES list', () => {
    // Multi-row VALUES only arrived in Oracle 23ai.
    expect(bulkRowsPerStatement('oracle', 5)).toBe(1);
  });

  it('never returns zero, however wide the file', () => {
    expect(bulkRowsPerStatement('sqlserver', 5_000)).toBe(1);
  });
});
