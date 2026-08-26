import { describe, expect, it } from 'vitest';
import { dialectSupportsIndex } from './index-support.js';
import { DIALECT_MAP } from './registry.js';

describe('dialectSupportsIndex', () => {
  it('marks ClickHouse and Redshift as unsupported for traditional indexes', () => {
    for (const d of ['clickhouse', 'redshift']) {
      expect(dialectSupportsIndex(d)).toMatchObject({
        create: false,
        drop: false,
        unique: false,
        acceptDuplicates: false,
        columnOrder: false,
        filter: false,
      });
    }
  });

  it('supports unique, duplicates, and ASC/DESC on traditional dialects', () => {
    for (const d of [
      'postgres',
      'mysql',
      'mariadb',
      'tidb',
      'sqlite',
      'sqlserver',
      'azuresql',
      'oracle',
      'db2',
      'duckdb',
      'cockroachdb',
      'yugabytedb',
    ]) {
      expect(dialectSupportsIndex(d), d).toMatchObject({
        create: true,
        drop: true,
        unique: true,
        acceptDuplicates: true,
        columnOrder: true,
      });
    }
  });

  it('supports filtered/partial WHERE only on dialects that allow it', () => {
    for (const d of [
      'postgres',
      'cockroachdb',
      'yugabytedb',
      'sqlserver',
      'azuresql',
      'sqlite',
    ]) {
      expect(dialectSupportsIndex(d).filter, d).toBe(true);
    }
    for (const d of [
      'mysql',
      'mariadb',
      'tidb',
      'oracle',
      'db2',
      'duckdb',
      'clickhouse',
      'redshift',
    ]) {
      expect(dialectSupportsIndex(d).filter, d).toBe(false);
    }
  });

  it('covers every registry dialect id', () => {
    for (const key of Object.keys(DIALECT_MAP)) {
      const support = dialectSupportsIndex(key);
      expect(support.create || support.hint.length > 0, key).toBe(true);
      expect(typeof support.columnOrder, key).toBe('boolean');
      expect(typeof support.filter, key).toBe('boolean');
    }
  });
});
