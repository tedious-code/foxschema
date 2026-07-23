import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { clampMaxRows, shapeRows, runStatements } from './sql-execute';
import { ConnectionFactory } from '@foxschema/core';

describe('clampMaxRows', () => {
  it('defaults, clamps, and floors', () => {
    expect(clampMaxRows(undefined)).toBe(200);
    expect(clampMaxRows('abc')).toBe(200);
    expect(clampMaxRows(0)).toBe(1);
    expect(clampMaxRows(-5)).toBe(1);
    expect(clampMaxRows(99999)).toBe(5000);
    expect(clampMaxRows(42.9)).toBe(42);
  });
});

describe('shapeRows', () => {
  it('derives columns from row keys and preserves order', () => {
    const shaped = shapeRows([{ a: 1, b: 'x' }, { a: 2, b: 'y' }], 500);
    expect(shaped).toMatchObject({ columns: ['a', 'b'], rowCount: 2, truncated: false });
    expect(shaped.rows).toEqual([[1, 'x'], [2, 'y']]);
  });

  it('unions keys across rows (drivers that omit null keys)', () => {
    const shaped = shapeRows([{ a: 1 }, { b: 2 }], 500);
    expect(shaped.columns).toEqual(['a', 'b']);
    expect(shaped.rows).toEqual([[1, undefined], [undefined, 2]]);
  });

  it('truncates past maxRows and flags it', () => {
    const raw = Array.from({ length: 10 }, (_, i) => ({ n: i }));
    const shaped = shapeRows(raw, 3);
    expect(shaped).toMatchObject({ rowCount: 3, truncated: true });
    expect(shaped.rows).toHaveLength(3);
  });

  it('serializes BigInt, Date, binary, and nested objects to JSON-safe cells', () => {
    const shaped = shapeRows(
      [{ big: 9007199254740993n, when: new Date('2026-01-02T03:04:05.000Z'), bin: new Uint8Array([0xde, 0xad]), obj: { x: 1 } }],
      500
    );
    expect(shaped.rows[0]).toEqual(['9007199254740993', '2026-01-02T03:04:05.000Z', '0xdead', '{"x":1}']);
    expect(() => JSON.stringify(shaped)).not.toThrow();
  });

  it('treats a non-array driver result (e.g. write OkPacket) as an empty result set', () => {
    const shaped = shapeRows({ affectedRows: 3 }, 500);
    expect(shaped).toMatchObject({ columns: [], rows: [], rowCount: 0, truncated: false });
  });

  it('empty result set yields no column names (documented v1 limitation)', () => {
    expect(shapeRows([], 500).columns).toEqual([]);
  });
});

describe('runStatements against a real SQLite file', () => {
  const dbPath = join(tmpdir(), `fox-sql-exec-test-${process.pid}.db`);

  beforeAll(async () => {
    // better-sqlite3 ships no type declarations (the sqlite adapter loads it
    // untyped via createRequire too) — suppress for this seeding-only usage.
    // @ts-expect-error no type declarations for better-sqlite3
    const mod = (await import('better-sqlite3')) as { default: new (path: string) => { exec(sql: string): void; close(): void } };
    const Database = mod.default;
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);
             INSERT INTO t (id, name) VALUES (1, 'alpha'), (2, 'beta'), (3, NULL);`);
    db.close();
  });

  afterAll(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    rmSync(dbPath, { force: true });
  });

  it('runs statements sequentially, isolating per-statement errors', async () => {
    const results = await runStatements(
      'sqlite',
      { connectionString: dbPath },
      ['SELECT id, name FROM t ORDER BY id;', 'SELECT nope FROM missing_table;', 'SELECT COUNT(*) AS n FROM t;'],
      500
    );
    expect(results).toHaveLength(3);

    expect(results[0]).toMatchObject({ ok: true, columns: ['id', 'name'], rowCount: 3, truncated: false });
    if (results[0].ok) expect(results[0].rows[0]).toEqual([1, 'alpha']);

    expect(results[1].ok).toBe(false);
    if (!results[1].ok) expect(results[1].error).toMatch(/missing_table|no such table/i);

    expect(results[2]).toMatchObject({ ok: true, columns: ['n'] });
    if (results[2].ok) expect(results[2].rows).toEqual([[3]]);
  });

  it('applies the row cap with the truncated flag', async () => {
    const results = await runStatements('sqlite', { connectionString: dbPath }, ['SELECT * FROM t;'], 2);
    expect(results[0]).toMatchObject({ ok: true, rowCount: 2, truncated: true });
  });
});
