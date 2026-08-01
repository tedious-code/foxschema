import { describe, expect, it } from 'vitest';
import {
  buildCreateTableSql,
  bulkChunkSize,
  inferColumnTypes,
  sqlTypeForDialect,
} from './file-query-bulk.module';

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
