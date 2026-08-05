import { describe, it, expect } from 'vitest';
import { tokenizeType, canonicalEquals } from './type-mapping';
import { resolveDialect } from './dialect-registry';

const db2 = resolveDialect('db2');
const pg = resolveDialect('postgres');
const mysql = resolveDialect('mysql');
const mssql = resolveDialect('sqlserver');
const oracle = resolveDialect('oracle');

/** Translate a native type from one dialect to another. */
const xlate = (from: ReturnType<typeof resolveDialect>, to: ReturnType<typeof resolveDialect>, raw: string) =>
  to.renderType(from.parseType(raw));

describe('tokenizeType', () => {
  it('splits a sized type', () => {
    expect(tokenizeType('VARCHAR(255)')).toMatchObject({ name: 'varchar', length: 255 });
  });
  it('splits precision/scale', () => {
    expect(tokenizeType('DECIMAL(10,2)')).toMatchObject({ name: 'decimal', precision: 10, scale: 2 });
  });
  it('keeps a multi-word name with args in the middle', () => {
    expect(tokenizeType('timestamp(6) without time zone')).toMatchObject({ name: 'timestamp without time zone', length: 6 });
  });
  it('recognizes (max)', () => {
    expect(tokenizeType('nvarchar(max)')).toMatchObject({ name: 'nvarchar', lengthIsMax: true });
  });
});

describe('cross-dialect type translation', () => {
  it('DB2 → Postgres', () => {
    expect(xlate(db2, pg, 'VARCHAR(255)').sql).toBe('varchar(255)');
    expect(xlate(db2, pg, 'INTEGER').sql).toBe('integer');
    expect(xlate(db2, pg, 'DECIMAL(10,2)').sql).toBe('numeric(10,2)');
    expect(xlate(db2, pg, 'CLOB').sql).toBe('text');
    expect(xlate(db2, pg, 'TIMESTAMP').sql).toBe('timestamp');
    // DBCLOB has no direct Postgres type → mapped to text (no warning needed, text covers it)
    expect(xlate(db2, pg, 'DBCLOB(1048576)').sql).toBe('text');
  });

  it('MySQL → Postgres', () => {
    expect(xlate(mysql, pg, 'int').sql).toBe('integer');
    expect(xlate(mysql, pg, 'tinyint(1)').sql).toBe('boolean');
    expect(xlate(mysql, pg, 'datetime').sql).toBe('timestamp');
    expect(xlate(mysql, pg, 'longtext').sql).toBe('text');
    expect(xlate(mysql, pg, 'int unsigned').sql).toBe('integer');
  });

  it('SQL Server → Postgres', () => {
    expect(xlate(mssql, pg, 'bit').sql).toBe('boolean');
    expect(xlate(mssql, pg, 'nvarchar(max)').sql).toBe('text');
    expect(xlate(mssql, pg, 'datetime2').sql).toBe('timestamp');
    expect(xlate(mssql, pg, 'uniqueidentifier').sql).toBe('uuid');
  });

  it('Oracle → Postgres', () => {
    expect(xlate(oracle, pg, 'VARCHAR2(100)').sql).toBe('varchar(100)');
    expect(xlate(oracle, pg, 'NUMBER(10,0)').sql).toBe('integer');
    expect(xlate(oracle, pg, 'NUMBER(10,2)').sql).toBe('numeric(10,2)');
    expect(xlate(oracle, pg, 'CLOB').sql).toBe('text');
  });

  it('attaches a warning when the target has no exact equivalent', () => {
    // Postgres uuid → Oracle has no uuid type
    const r = xlate(pg, oracle, 'uuid');
    expect(r.sql).toBe('VARCHAR2(36)');
    expect(r.warning).toMatch(/uuid/i);
  });

  it('round-trips a type back to an equivalent canonical form', () => {
    const canonical = db2.parseType('VARCHAR(255)');
    const back = pg.parseType(pg.renderType(canonical).sql);
    expect(canonicalEquals(canonical, back)).toBe(true);
  });
});

describe('canonicalEquals', () => {
  it('treats DB2 VARCHAR(255) and Postgres character varying(255) as equal', () => {
    expect(canonicalEquals(db2.parseType('VARCHAR(255)'), pg.parseType('character varying(255)'))).toBe(true);
  });
  it('treats DB2 INTEGER and MySQL int as equal', () => {
    expect(canonicalEquals(db2.parseType('INTEGER'), mysql.parseType('int'))).toBe(true);
  });
  it('distinguishes different lengths', () => {
    expect(canonicalEquals(pg.parseType('varchar(100)'), pg.parseType('varchar(200)'))).toBe(false);
  });
  it('distinguishes integer from decimal', () => {
    expect(canonicalEquals(pg.parseType('integer'), pg.parseType('numeric(10,2)'))).toBe(false);
  });
});
