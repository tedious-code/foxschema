/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generated DDL, executed by a real SQL engine.
 *
 * Every other generator test asserts on strings, which only ever proves the
 * output matches what somebody expected it to be. This hands the output to
 * SQLite and lets the engine judge it: if the statement will not parse, the
 * test fails with the engine's own error.
 *
 * It lives in `apps/web` rather than `packages/sql` on purpose — the sql
 * package is pure and may not import Node built-ins (`purity.test.ts` enforces
 * it), and this needs `node:sqlite`.
 *
 * SQLite is the only engine reachable without credentials, so it is the only
 * one covered here. It still catches the whole class of "the identifier was
 * never quoted" bugs, which is dialect-independent.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CompareModule, SqlGeneratorModule } from '@foxschema/sql';
import type { TableSchema } from '@foxschema/sql';

const gen = new SqlGeneratorModule();

/** DDL for creating `tables` from nothing, as the migration flow would emit it. */
async function createSql(tables: TableSchema[]): Promise<string[]> {
  const result = await new CompareModule().compare(tables, [], {
    source: 'sqlite',
    target: 'sqlite',
  });
  return gen.generateMigrationPlan(result.tables, 'sqlite').flatMap((step) => step.statements);
}

/** Runs every statement, surfacing the engine's complaint with the statement. */
function runAll(statements: string[]): void {
  const db = new DatabaseSync(':memory:');
  try {
    for (const statement of statements) {
      try {
        db.exec(statement);
      } catch (err) {
        throw new Error(
          `SQLite rejected:\n${statement}\n\n${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } finally {
    db.close();
  }
}

const table = (over: Partial<TableSchema> & { name: string }): TableSchema => ({
  objectType: 'TABLE',
  columns: [],
  indices: [],
  foreignKeys: [],
  ...over,
});

describe('generated DDL actually parses', () => {
  it('creates an ordinary table', async () => {
    // The control: if this ever fails, the harness is wrong, not the generator.
    await expect(
      createSql([
        table({
          name: 'customers',
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
            { name: 'email', type: 'VARCHAR(255)', nullable: true, primaryKey: false },
          ],
        }),
      ]).then(runAll)
    ).resolves.toBeUndefined();
  });

  it('creates a table whose name and columns contain spaces', async () => {
    // Northwind ships `Order Details`; this is not a hypothetical name. Before
    // identifiers were quoted, this produced `CREATE TABLE Order Details (...)`,
    // which no engine accepts.
    const sql = await createSql([
      table({
        name: 'Order Details',
        columns: [
          { name: 'order id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'unit price', type: 'DECIMAL(10,2)', nullable: true, primaryKey: false },
        ],
        primaryKey: { name: 'pk order details', columns: ['order id'] },
      }),
    ]);
    runAll(sql);
  });

  it('creates a table whose columns are reserved words', async () => {
    // `select` and `order` are syntax errors bare; `key` and `user` are fine in
    // SQLite but reserved in MySQL, so all four are quoted for every dialect.
    const sql = await createSql([
      table({
        name: 'order',
        columns: [
          { name: 'select', type: 'VARCHAR(10)', nullable: true, primaryKey: false },
          { name: 'order', type: 'INTEGER', nullable: true, primaryKey: false },
          { name: 'key', type: 'INTEGER', nullable: true, primaryKey: false },
          { name: 'user', type: 'TEXT', nullable: true, primaryKey: false },
        ],
      }),
    ]);
    runAll(sql);
  });

  it('creates a table with punctuation and non-ASCII letters in names', async () => {
    const sql = await createSql([
      table({
        name: 'naïve-table',
        columns: [
          { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'café', type: 'TEXT', nullable: true, primaryKey: false },
          { name: 'a.b', type: 'TEXT', nullable: true, primaryKey: false },
        ],
      }),
    ]);
    runAll(sql);
  });

  it('creates a table whose name contains the quote character itself', async () => {
    // The escaping case: a name holding `"` must double it, or the quoting
    // that was meant to fix the statement is what breaks it.
    const sql = await createSql([
      table({
        name: 'we"ird',
        columns: [{ name: 'i"d', type: 'INTEGER', nullable: false, primaryKey: false }],
      }),
    ]);
    runAll(sql);
  });

  it('indexes and foreign keys on awkward names still parse', async () => {
    const sql = await createSql([
      table({
        name: 'parent table',
        columns: [{ name: 'parent id', type: 'INTEGER', nullable: false, primaryKey: true }],
        primaryKey: { columns: ['parent id'] },
      }),
      table({
        name: 'child table',
        columns: [
          { name: 'child id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'parent id', type: 'INTEGER', nullable: true, primaryKey: false },
        ],
        primaryKey: { columns: ['child id'] },
        indices: [{ name: 'idx child parent', columns: ['parent id'], unique: false }],
        foreignKeys: [
          {
            name: 'fk child parent',
            columns: ['parent id'],
            referencedTable: 'parent table',
            referencedColumns: ['parent id'],
          },
        ],
      }),
    ]);
    runAll(sql);
  });

  it('alters a table with awkward names', async () => {
    // ADD / DROP COLUMN go through per-dialect hooks rather than the CREATE
    // path, so they need their own proof.
    const before = table({
      name: 'my table',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'old col', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    });
    const after = table({
      name: 'my table',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
        { name: 'new col', type: 'TEXT', nullable: true, primaryKey: false },
      ],
    });

    runAll(await createSql([before]));

    const diff = await new CompareModule().compare([after], [before], {
      source: 'sqlite',
      target: 'sqlite',
    });
    const alter = gen.generateMigrationPlan(diff.tables, 'sqlite').flatMap((s) => s.statements);
    expect(alter.length).toBeGreaterThan(0);

    // Same database: create the original, then apply the migration to it.
    const db = new DatabaseSync(':memory:');
    try {
      for (const statement of await createSql([before])) db.exec(statement);
      for (const statement of alter) {
        try {
          db.exec(statement);
        } catch (err) {
          throw new Error(
            `SQLite rejected:\n${statement}\n\n${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      const columns = db
        .prepare(`PRAGMA table_info("my table")`)
        .all()
        .map((row) => String((row as { name: unknown }).name));
      expect(columns).toContain('new col');
      expect(columns).not.toContain('old col');
    } finally {
      db.close();
    }
  });
});
