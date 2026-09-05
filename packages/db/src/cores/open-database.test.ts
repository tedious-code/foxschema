/**
 * Fox Schema (@foxschema/db)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The library front door, and the three mistakes it exists to prevent.
 *
 * `openDatabase` wraps pieces that already worked. Its whole value is that a
 * caller can no longer pair a connection with the wrong dialect on close, leak
 * one by forgetting `finally`, or use a handle after closing it. So those are
 * what this tests — not that `query` forwards, which is one line.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const acquire = vi.fn();
const release = vi.fn();
const query = vi.fn();

vi.mock('./connection-factory.js', () => ({
  ConnectionFactory: {
    create: (dialect: string, options: unknown, opts: unknown) => acquire(dialect, options, opts),
    close: (dialect: string, connection: unknown) => release(dialect, connection),
  },
}));
vi.mock('../providers/adapter-registry.js', () => ({
  getAdapter: (dialect: string) => ({
    dialect,
    query: (connection: unknown, sql: string, params: readonly unknown[]) =>
      query(connection, sql, params),
  }),
}));

import { openDatabase, queryOnce } from './open-database.js';

const OPTIONS = { host: 'localhost', database: 'app' };

beforeEach(() => {
  acquire.mockReset().mockResolvedValue({ handle: 'conn-1' });
  release.mockReset().mockResolvedValue(undefined);
  query.mockReset().mockResolvedValue([{ n: 1 }]);
});

describe('the handle carries its own dialect', () => {
  it('closes with the dialect it opened with', async () => {
    // The mistake this prevents: `ConnectionFactory.close(dialect, conn)` takes
    // the dialect as a separate argument, so a caller juggling several
    // connections can release one against another's adapter. Nothing warns.
    const db = await openDatabase('postgres', OPTIONS);
    await db.close();
    expect(release).toHaveBeenCalledWith('postgres', { handle: 'conn-1' });
  });

  it('reports its dialect, so a caller need not track it alongside', () => {
    return openDatabase('mysql', OPTIONS).then((db) => expect(db.dialect).toBe('mysql'));
  });

  it('passes the connection through to the adapter unchanged', async () => {
    const db = await openDatabase('postgres', OPTIONS);
    await db.query('SELECT $1::int AS n', [1]);
    expect(query).toHaveBeenCalledWith({ handle: 'conn-1' }, 'SELECT $1::int AS n', [1]);
  });

  it('defaults params so a no-argument query still reaches the driver', async () => {
    const db = await openDatabase('postgres', OPTIONS);
    await db.query('SELECT 1');
    expect(query).toHaveBeenCalledWith({ handle: 'conn-1' }, 'SELECT 1', []);
  });
});

describe('closing twice is safe', () => {
  it('releases once, however many times close is called', async () => {
    // `close()` on the success path and again in a `finally` is the ordinary
    // shape. A double release corrupts a pool's accounting.
    const db = await openDatabase('postgres', OPTIONS);
    await db.close();
    await db.close();
    await db.close();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('refuses a query after close instead of using a released connection', async () => {
    const db = await openDatabase('postgres', OPTIONS);
    await db.close();
    await expect(db.query('SELECT 1')).rejects.toThrow(/already closed/i);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('queryOnce closes even when the query throws', () => {
  it('releases on the failure path', async () => {
    // The reason it exists: a script that opens, queries and forgets the
    // `finally` leaks a connection on every error.
    query.mockRejectedValueOnce(new Error('syntax error at or near "SELCT"'));
    await expect(queryOnce('postgres', OPTIONS, 'SELCT 1')).rejects.toThrow(/SELCT/);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('releases on the success path and returns the rows', async () => {
    await expect(queryOnce('postgres', OPTIONS, 'SELECT 1')).resolves.toEqual([{ n: 1 }]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not pool a one-shot connection', async () => {
    // Pooling a connection the caller will never reuse keeps a socket open for
    // the pool's idle timeout after a script has finished.
    await queryOnce('postgres', OPTIONS, 'SELECT 1');
    expect(acquire).toHaveBeenCalledWith('postgres', OPTIONS, { pooled: false });
  });

  it('propagates a connect failure rather than reporting empty rows', async () => {
    acquire.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(queryOnce('postgres', OPTIONS, 'SELECT 1')).rejects.toThrow(/ECONNREFUSED/);
    expect(release).not.toHaveBeenCalled();
  });
});
