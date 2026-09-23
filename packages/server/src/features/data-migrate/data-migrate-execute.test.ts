/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConnectionFactory } from '@foxschema/db';
import { executeDataMigrateOps } from './data-migrate-execute';
import { getAdapter } from '@foxschema/db';
import * as db from '@foxschema/db';

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

  it('does not claim rollback for Redis when begin/rollback are no-ops', async () => {
    // Mirrors the Redis adapter: transaction hooks resolve without undoing writes.
    const fakeAdapter = {
      setCurrentSchema: vi.fn(async () => {}),
      beginTransaction: vi.fn(async () => {}),
      commitTransaction: vi.fn(async () => {}),
      rollbackTransaction: vi.fn(async () => {}),
      query: vi.fn(async (_c: unknown, sql: string) => {
        if (sql.includes('missing')) throw new Error('boom');
        return [];
      }),
    };
    const getAdapterSpy = vi.spyOn(db, 'getAdapter').mockReturnValue(fakeAdapter as never);
    const createSpy = vi.spyOn(ConnectionFactory, 'create').mockResolvedValue({});
    const closeSpy = vi.spyOn(ConnectionFactory, 'close').mockResolvedValue(undefined);

    try {
      const out = await executeDataMigrateOps(
        'redis',
        {},
        '0',
        [
          { op: 'delete', key: 'id=1', sql: `DELETE FROM cache WHERE id = 1` },
          { op: 'delete', key: 'id=bad', sql: `DELETE FROM missing WHERE id = 2` },
          { op: 'delete', key: 'id=3', sql: `DELETE FROM cache WHERE id = 3` },
        ],
        { useTransaction: true, continueOnError: false }
      );
      expect(fakeAdapter.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(out.rolledBack).toBe(false);
      expect(out.results.map((r) => r.status)).toEqual(['SUCCESS', 'FAILED', 'SKIPPED']);
      expect(out.results[2]?.error).toBe('Stopped after earlier failure');
      expect(out.results[2]?.error).not.toContain('rolled back');
    } finally {
      getAdapterSpy.mockRestore();
      createSpy.mockRestore();
      closeSpy.mockRestore();
    }
  });
});

describe('executeDataMigrateOps session SQL', () => {
  // SQL Server and Azure SQL gate explicit identity values on the session, so
  // the migration has to open that mode and close it again around the ops.
  // These exercise the lifecycle on SQLite: what matters is the ordering and
  // that `after` still runs when the ops fail, neither of which is engine
  // specific.
  let dbPath: string;

  const open = (path: string) => ({ connectionString: path });

  beforeEach(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    dbPath = join(tmpdir(), `fox-session-sql-${process.pid}-${Date.now()}.db`);
    await seedDb(dbPath);
  });

  afterEach(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    rmSync(dbPath, { force: true });
  });

  async function rows<T>(sql: string): Promise<T[]> {
    await ConnectionFactory.closeAll().catch(() => {});
    const conn = await ConnectionFactory.create('sqlite', open(dbPath), { pooled: false });
    try {
      return await getAdapter('sqlite').query<T>(conn, sql, []);
    } finally {
      await ConnectionFactory.close('sqlite', conn);
    }
  }

  it('runs before the ops and after them', async () => {
    const out = await executeDataMigrateOps(
      'sqlite',
      open(dbPath),
      undefined,
      [{ op: 'insert', key: 'id=3', sql: `INSERT INTO session_log (note) VALUES ('op')` }],
      {
        useTransaction: false,
        continueOnError: false,
        sessionSql: {
          before: `CREATE TABLE session_log (note TEXT)`,
          after: `INSERT INTO session_log (note) VALUES ('after')`,
        },
      }
    );

    expect(out.failCount).toBe(0);
    // The op could only succeed if `before` had already created the table, and
    // 'after' is last, so this single list pins the whole order.
    const log = await rows<{ note: string }>(`SELECT note FROM session_log ORDER BY rowid`);
    expect(log.map((r) => r.note)).toEqual(['op', 'after']);
  });

  it('runs after even when every op fails', async () => {
    // Leaving SET IDENTITY_INSERT on would block the next write to a different
    // table on that session, so a failed run must still close it.
    const out = await executeDataMigrateOps(
      'sqlite',
      open(dbPath),
      undefined,
      [{ op: 'insert', key: 'id=bad', sql: `INSERT INTO missing_table (id) VALUES (9)` }],
      {
        useTransaction: false,
        continueOnError: true,
        sessionSql: {
          before: `CREATE TABLE session_log (note TEXT)`,
          after: `INSERT INTO session_log (note) VALUES ('after')`,
        },
      }
    );

    expect(out.failCount).toBe(1);
    const log = await rows<{ note: string }>(`SELECT note FROM session_log`);
    expect(log.map((r) => r.note)).toEqual(['after']);
  });

  it('aborts the migration when the session cannot be prepared', async () => {
    // One clear error beats the same failure repeated once per row.
    await expect(
      executeDataMigrateOps(
        'sqlite',
        open(dbPath),
        undefined,
        [{ op: 'insert', key: 'id=3', sql: `INSERT INTO customers (id, name) VALUES (3, 'New')` }],
        {
          useTransaction: false,
          continueOnError: false,
          sessionSql: { before: `THIS IS NOT SQL`, after: `SELECT 1` },
        }
      )
    ).rejects.toThrow(/Could not prepare the destination session/);

    // The op must not have run.
    expect(await rows(`SELECT id FROM customers WHERE id = 3`)).toEqual([]);
  });
});
