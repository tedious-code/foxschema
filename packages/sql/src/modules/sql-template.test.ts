import { describe, expect, it } from 'vitest';
import { sqlTag as sql, renderSqlQuery, placeholderStyleFor } from './sql-template.js';

describe('placeholderStyleFor', () => {
  it('maps each engine family to its placeholder syntax', () => {
    expect(placeholderStyleFor('postgres')).toBe('dollar');
    expect(placeholderStyleFor('redshift')).toBe('dollar');
    expect(placeholderStyleFor('cockroachdb')).toBe('dollar');
    expect(placeholderStyleFor('oracle')).toBe('colon');
    expect(placeholderStyleFor('mysql')).toBe('question');
    expect(placeholderStyleFor('sqlite')).toBe('question');
    expect(placeholderStyleFor('db2')).toBe('question');
  });
});

describe('renderSqlQuery', () => {
  it('binds interpolations instead of inlining them', () => {
    const id = 42;
    const out = renderSqlQuery(sql`SELECT * FROM users WHERE id = ${id}`, 'postgres');
    expect(out.text).toBe('SELECT * FROM users WHERE id = $1');
    expect(out.params).toEqual([42]);
  });

  it('never lets a quote in a value change the statement', () => {
    // The whole point: this is a broken statement under string interpolation.
    const out = renderSqlQuery(sql`SELECT * FROM t WHERE name = ${"O'Brien"}`, 'sqlite');
    expect(out.text).toBe('SELECT * FROM t WHERE name = ?');
    expect(out.params).toEqual(["O'Brien"]);
    expect(out.text).not.toContain("O'Brien");
  });

  it('keeps null / Date / object as bound values, not text', () => {
    const d = new Date('2026-01-02T03:04:05Z');
    const out = renderSqlQuery(sql`INSERT INTO t VALUES (${null}, ${d}, ${{ a: 1 }})`, 'mysql');
    expect(out.text).toBe('INSERT INTO t VALUES (?, ?, ?)');
    expect(out.params).toEqual([null, d, { a: 1 }]);
    expect(out.text).not.toContain('object Object');
  });

  it('numbers placeholders sequentially per dialect', () => {
    const q = sql`SELECT ${1}, ${2}, ${3}`;
    expect(renderSqlQuery(q, 'postgres').text).toBe('SELECT $1, $2, $3');
    expect(renderSqlQuery(q, 'oracle').text).toBe('SELECT :1, :2, :3');
    expect(renderSqlQuery(q, 'mysql').text).toBe('SELECT ?, ?, ?');
  });

  it('expands a bare array into an IN list', () => {
    const out = renderSqlQuery(sql`SELECT * FROM t WHERE id IN ${[1, 2, 3]}`, 'postgres');
    expect(out.text).toBe('SELECT * FROM t WHERE id IN ($1, $2, $3)');
    expect(out.params).toEqual([1, 2, 3]);
  });

  it('builds a parameterized multi-row INSERT from objects', () => {
    const rows = [
      { id: 1, name: "O'Brien" },
      { id: 2, name: 'Ada' },
    ];
    const out = renderSqlQuery(sql`INSERT INTO users ${sql.values(rows)}`, 'postgres');
    expect(out.text).toBe('INSERT INTO users ("id", "name") VALUES ($1, $2), ($3, $4)');
    expect(out.params).toEqual([1, "O'Brien", 2, 'Ada']);
  });

  it('fills missing keys with null so every tuple has equal arity', () => {
    const out = renderSqlQuery(
      sql`INSERT INTO t ${sql.values([{ a: 1 }, { a: 2, b: 'x' }])}`,
      'sqlite'
    );
    expect(out.text).toBe('INSERT INTO t ("a", "b") VALUES (?, ?), (?, ?)');
    expect(out.params).toEqual([1, null, 2, 'x']);
  });

  it('quotes identifiers per dialect and never binds them', () => {
    const q = sql`SELECT * FROM ${sql.id('public', 'users')}`;
    expect(renderSqlQuery(q, 'postgres').text).toBe('SELECT * FROM "public"."users"');
    expect(renderSqlQuery(q, 'mysql').text).toBe('SELECT * FROM `public`.`users`');
    expect(renderSqlQuery(q, 'sqlserver').text).toBe('SELECT * FROM [public].[users]');
    expect(renderSqlQuery(q, 'postgres').params).toEqual([]);
  });

  it('escapes the quote character inside an identifier', () => {
    const out = renderSqlQuery(sql`SELECT * FROM ${sql.id('we"ird')}`, 'postgres');
    expect(out.text).toBe('SELECT * FROM "we""ird"');
  });

  it('composes nested queries with continuous placeholder numbering', () => {
    const where = sql`WHERE tenant = ${'acme'} AND active = ${true}`;
    const out = renderSqlQuery(sql`SELECT * FROM users ${where} LIMIT ${10}`, 'postgres');
    expect(out.text).toBe('SELECT * FROM users WHERE tenant = $1 AND active = $2 LIMIT $3');
    expect(out.params).toEqual(['acme', true, 10]);
  });

  it('passes sql.raw through verbatim', () => {
    const out = renderSqlQuery(sql`SELECT * FROM t ORDER BY ${sql.raw('created_at DESC')}`, 'sqlite');
    expect(out.text).toBe('SELECT * FROM t ORDER BY created_at DESC');
    expect(out.params).toEqual([]);
  });

  it('supports the MERGE-style shape a migration cell would write', () => {
    const values = [{ id: 1, email: 'a@b.c' }];
    const out = renderSqlQuery(
      sql`MERGE INTO ${sql.id('accounts')} AS t
          USING (SELECT ${values[0]!.id} AS id, ${values[0]!.email} AS email) AS s
          ON t.id = s.id
          WHEN MATCHED THEN UPDATE SET email = s.email`,
      'sqlserver'
    );
    expect(out.params).toEqual([1, 'a@b.c']);
    expect(out.text).toContain('MERGE INTO [accounts]');
    expect(out.text).toContain('SELECT ? AS id, ? AS email');
  });
});

describe('sql.values edge cases', () => {
  it('reports an empty batch plainly instead of emitting invalid SQL', () => {
    expect(() => renderSqlQuery(sql`INSERT INTO t ${sql.values([])}`, 'postgres')).toThrow(
      /at least one row/i
    );
  });

  it('reports rows with no columns', () => {
    expect(() => renderSqlQuery(sql`INSERT INTO t ${sql.values([{}])}`, 'postgres')).toThrow(
      /no columns/i
    );
  });
});
