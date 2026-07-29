import { describe, expect, it } from 'vitest';
import {
  tableNameParts,
  buildTablePreview,
  buildForeignKeyDrilldown,
  foreignKeyLinksFor,
  foreignKeyLinksForSql,
  composePeekSql,
  isSafePeekClause,
} from './tablePreview';
import type { ForeignKeyInfo, TableSchema } from './types';

describe('tableNameParts', () => {
  it('splits schema-qualified names', () => {
    expect(tableNameParts('public.users')).toEqual(['public', 'users']);
    expect(tableNameParts('users')).toEqual(['users']);
  });

  it('keeps a dot inside a quoted segment', () => {
    expect(tableNameParts('"we.ird"."tbl"')).toEqual(['we.ird', 'tbl']);
    expect(tableNameParts('"say""hi"')).toEqual(['say"hi']);
  });
});

describe('buildTablePreview', () => {
  it('quotes per dialect and adds no LIMIT (the server pages)', () => {
    expect(buildTablePreview('public.users', 'postgres')).toEqual({
      sql: 'SELECT * FROM "public"."users"',
      params: [],
    });
    expect(buildTablePreview('users', 'mysql').sql).toBe('SELECT * FROM `users`');
    expect(buildTablePreview('users', 'sqlserver').sql).toBe('SELECT * FROM [users]');
  });
});

describe('buildForeignKeyDrilldown', () => {
  const fk: ForeignKeyInfo = {
    name: 'fk_o_c',
    columns: ['customer_id'],
    referencedTable: 'customers',
    referencedColumns: ['id'],
  };

  it('binds the value instead of inlining it', () => {
    const q = buildForeignKeyDrilldown(fk, [7], 'postgres');
    expect(q).toEqual({ sql: 'SELECT * FROM "customers" WHERE "id" = $1', params: [7] });
  });

  it('binds a hostile string safely', () => {
    const q = buildForeignKeyDrilldown(fk, ["x' OR 1=1 --"], 'sqlite');
    expect(q!.sql).toBe('SELECT * FROM "customers" WHERE "id" = ?');
    expect(q!.params).toEqual(["x' OR 1=1 --"]);
  });

  it('ANDs a composite key in order', () => {
    const composite: ForeignKeyInfo = {
      name: 'fk',
      columns: ['a', 'b'],
      referencedTable: 'p',
      referencedColumns: ['x', 'y'],
    };
    const q = buildForeignKeyDrilldown(composite, [1, 'two'], 'postgres');
    expect(q!.sql).toBe('SELECT * FROM "p" WHERE "x" = $1 AND "y" = $2');
    expect(q!.params).toEqual([1, 'two']);
  });

  it('refuses to build a link with no parent columns or a null value', () => {
    const noCols: ForeignKeyInfo = { ...fk, referencedColumns: [] };
    expect(buildForeignKeyDrilldown(noCols, [1], 'postgres')).toBeNull();
    expect(buildForeignKeyDrilldown(fk, [null], 'postgres')).toBeNull();
  });
});

describe('foreignKeyLinksFor', () => {
  const table = {
    name: 'orders',
    objectType: 'TABLE',
    columns: [],
    indices: [],
    foreignKeys: [
      { name: 'fk1', columns: ['customer_id'], referencedTable: 'customers', referencedColumns: ['id'] },
      { name: 'fk2', columns: ['a', 'b'], referencedTable: 'p', referencedColumns: ['x', 'y'] },
    ],
  } as unknown as TableSchema;

  it('matches column names case-insensitively (Oracle/Db2 fold to upper)', () => {
    const links = foreignKeyLinksFor(table, ['ID', 'CUSTOMER_ID', 'A', 'B']);
    expect(links.map((l) => l.fk.name)).toEqual(['fk1', 'fk2']);
    expect(links[0]!.columnIndex).toBe(1);
    expect(links[1]!.valueIndexes).toEqual([2, 3]);
  });

  it('skips a composite FK whose columns are not all selected', () => {
    const links = foreignKeyLinksFor(table, ['customer_id', 'a']);
    expect(links.map((l) => l.fk.name)).toEqual(['fk1']);
  });

  it('returns nothing when the table has no FKs', () => {
    expect(foreignKeyLinksFor(undefined, ['a'])).toEqual([]);
  });
});

describe('composePeekSql', () => {
  it('ANDs a WHERE onto a base SELECT', () => {
    const q = composePeekSql('SELECT * FROM "t"', [], { where: 'ARCHIVED = false' });
    expect(q).toEqual({
      sql: 'SELECT * FROM "t" WHERE (ARCHIVED = false)',
      params: [],
    });
  });

  it('ANDs onto an existing FK WHERE and keeps bound params', () => {
    const q = composePeekSql('SELECT * FROM "TECHNICIAN" WHERE "ID" = $1', [34], {
      where: 'ARCHIVED = false',
      orderBy: 'CREATEDAT DESC',
    });
    expect(q).toEqual({
      sql: 'SELECT * FROM "TECHNICIAN" WHERE "ID" = $1 AND (ARCHIVED = false) ORDER BY CREATEDAT DESC',
      params: [34],
    });
  });

  it('omits user WHERE when cleared so the base peek returns all matching rows', () => {
    const base = 'SELECT * FROM "TECHNICIAN" WHERE "ID" = $1';
    const filtered = composePeekSql(base, [34], { where: 'ARCHIVED = false' });
    expect(filtered).toEqual({
      sql: 'SELECT * FROM "TECHNICIAN" WHERE "ID" = $1 AND (ARCHIVED = false)',
      params: [34],
    });
    const cleared = composePeekSql(base, [34], { where: '   ' });
    expect(cleared).toEqual({ sql: base, params: [34] });
    const rootCleared = composePeekSql('SELECT * FROM "t"', [], { where: '' });
    expect(rootCleared).toEqual({ sql: 'SELECT * FROM "t"', params: [] });
  });

  it('rejects multi-statement and comment filters', () => {
    expect(isSafePeekClause('a = 1; DROP TABLE t')).toBe(false);
    expect(composePeekSql('SELECT * FROM t', [], { where: '1=1; --' })).toEqual({
      error: 'WHERE must be a single predicate (no ; or comments)',
    });
  });
});

describe('foreignKeyLinksForSql', () => {
  const orders = {
    name: 'orders',
    objectType: 'TABLE',
    columns: [],
    indices: [],
    foreignKeys: [
      {
        name: 'fk1',
        columns: ['customer_id'],
        referencedTable: 'customers',
        referencedColumns: ['id'],
      },
    ],
  } as unknown as TableSchema;

  it('links result FK columns from the statement’s FROM table', () => {
    const links = foreignKeyLinksForSql(
      'SELECT id, customer_id FROM orders',
      [orders],
      ['id', 'customer_id']
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.columnIndex).toBe(1);
    expect(links[0]!.fk.referencedTable).toBe('customers');
  });

  it('returns nothing when schema is missing the table', () => {
    expect(
      foreignKeyLinksForSql('SELECT * FROM orders', [], ['customer_id'])
    ).toEqual([]);
  });
});
