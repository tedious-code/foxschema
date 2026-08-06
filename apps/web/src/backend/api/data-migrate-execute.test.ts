/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConnectionFactory } from '@foxschema/db';
import { executeDataMigrateOps } from './data-migrate-execute';
import { getAdapter } from '@foxschema/db';

async function seedDb(dbPath: string): Promise<void> {
  // @ts-expect-error no type declarations for better-sqlite3
  const mod = (await import('better-sqlite3')) as {
    default: new (path: string) => { exec(sql: string): void; close(): void };
  };
  const db = new mod.default(dbPath);
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO customers (id, name) VALUES (1, 'Bob');
    INSERT INTO customers (id, name) VALUES (2, 'Shared');
  `);
  db.close();
}

describe('executeDataMigrateOps', () => {
  let dbPath: string;

  beforeEach(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    dbPath = join(tmpdir(), `fox-data-migrate-${process.pid}-${Date.now()}.db`);
    await seedDb(dbPath);
  });

  afterEach(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    rmSync(dbPath, { force: true });
  });

  it('atomic transaction rolls back all ops on failure', async () => {
    const out = await executeDataMigrateOps(
      'sqlite',
      { connectionString: dbPath },
      undefined,
      [
        {
          op: 'update',
          key: 'id=1',
          sql: `UPDATE customers SET name = 'Alice' WHERE id = 1`,
        },
        {
          op: 'insert',
          key: 'id=bad',
          sql: `INSERT INTO missing_table (id) VALUES (9)`,
        },
        {
          op: 'insert',
          key: 'id=3',
          sql: `INSERT INTO customers (id, name) VALUES (3, 'New')`,
        },
      ],
      { useTransaction: true, continueOnError: false }
    );
    expect(out.rolledBack).toBe(true);
    expect(out.failCount).toBe(1);
    expect(out.results.map((r) => r.status)).toEqual(['SUCCESS', 'FAILED', 'SKIPPED']);

    await ConnectionFactory.closeAll().catch(() => {});
    const conn = await ConnectionFactory.create('sqlite', { connectionString: dbPath });
    try {
      const rows = await getAdapter('sqlite').query<{ name: string }>(
        conn,
        'SELECT name FROM customers WHERE id = 1',
        []
      );
      expect(rows[0]?.name).toBe('Bob');
    } finally {
      await ConnectionFactory.close('sqlite', conn);
    }
  });

  it('continueOnError keeps going and commits successful ops', async () => {
    const out = await executeDataMigrateOps(
      'sqlite',
      { connectionString: dbPath },
      undefined,
      [
        {
          op: 'update',
          key: 'id=1',
          sql: `UPDATE customers SET name = 'Alice' WHERE id = 1`,
        },
        {
          op: 'insert',
          key: 'id=bad',
          sql: `INSERT INTO missing_table (id) VALUES (9)`,
        },
        {
          op: 'insert',
          key: 'id=3',
          sql: `INSERT INTO customers (id, name) VALUES (3, 'New')`,
        },
      ],
      { useTransaction: false, continueOnError: true }
    );
    expect(out.failCount).toBe(1);
    expect(out.results.map((r) => r.status)).toEqual(['SUCCESS', 'FAILED', 'SUCCESS']);

    await ConnectionFactory.closeAll().catch(() => {});
    const conn = await ConnectionFactory.create('sqlite', { connectionString: dbPath });
    try {
      const rows = await getAdapter('sqlite').query<{ name: string }>(
        conn,
        'SELECT name FROM customers ORDER BY id',
        []
      );
      expect(rows.map((r) => r.name)).toEqual(['Alice', 'Shared', 'New']);
    } finally {
      await ConnectionFactory.close('sqlite', conn);
    }
  });

  it('stop without transaction skips remaining after first failure', async () => {
    const out = await executeDataMigrateOps(
      'sqlite',
      { connectionString: dbPath },
      undefined,
      [
        {
          op: 'insert',
          key: 'id=bad',
          sql: `INSERT INTO missing_table (id) VALUES (9)`,
        },
        {
          op: 'update',
          key: 'id=1',
          sql: `UPDATE customers SET name = 'Alice' WHERE id = 1`,
        },
      ],
      { useTransaction: false, continueOnError: false }
    );
    expect(out.results.map((r) => r.status)).toEqual(['FAILED', 'SKIPPED']);
  });
});
