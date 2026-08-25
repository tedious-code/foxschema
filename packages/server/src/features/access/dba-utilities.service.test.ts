/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Server Insights probes (Utilities → Server Insights) against a real SQLite file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { probeDbaUtility } from './dba-utilities.service';
import { ConnectionFactory } from '@foxschema/db';

const dbPath = join(tmpdir(), `fox-dba-util-test-${process.pid}.db`);
const option = { connectionString: dbPath };

describe('probeDbaUtility against a real SQLite file', () => {
  beforeAll(async () => {
    // A killed run leaves the file behind and PIDs get recycled — start clean.
    rmSync(dbPath, { force: true });
    // better-sqlite3 ships no type declarations (the sqlite adapter loads it
    // untyped via createRequire too) — suppress for this seeding-only usage.
    // @ts-expect-error no type declarations for better-sqlite3
    const mod = (await import('better-sqlite3')) as { default: new (path: string) => { exec(sql: string): void; close(): void } };
    const Database = mod.default;
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, status TEXT);
      CREATE INDEX idx_orders_customer ON orders (customer_id);
      INSERT INTO orders (customer_id, status) VALUES (1, 'open'), (2, 'shipped'), (3, 'open');
    `);
    db.close();
  });

  afterAll(async () => {
    await ConnectionFactory.closeAll().catch(() => {});
    rmSync(dbPath, { force: true });
  });

  it('system info reports the database file size and SQLite version', async () => {
    const probed = await probeDbaUtility({ dialect: 'sqlite', option, kind: 'system' });
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;
    expect(probed.value.kind).toBe('system');
    expect(probed.value.mode).toBe('estimated');
    expect(probed.value.system?.storageUsedBytes).toBeGreaterThan(0);
    expect(probed.value.system?.serverVersion).toMatch(/^3\./);
  });

  it('object sizes list tables and indexes with dbstat byte counts', async () => {
    const probed = await probeDbaUtility({ dialect: 'sqlite', option, kind: 'sizes' });
    expect(probed.ok).toBe(true);
    if (!probed.ok) return;

    const sizes = probed.value.sizes ?? [];
    const table = sizes.find((s) => s.objectName === 'orders');
    expect(table).toMatchObject({ objectType: 'table', tableName: 'orders' });
    expect(table?.totalBytes).toBeGreaterThan(0);

    const index = sizes.find((s) => s.objectName === 'idx_orders_customer');
    expect(index).toMatchObject({ objectType: 'index', tableName: 'orders' });
    expect(index?.totalBytes).toBeGreaterThan(0);
  });

  it.each(['pool', 'sessions'] as const)(
    '%s is unsupported for an embedded engine',
    async (kind) => {
      const probed = await probeDbaUtility({ dialect: 'sqlite', option, kind });
      expect(probed.ok).toBe(false);
      if (probed.ok) return;
      expect(probed.failure.status).toBe(400);
      expect(probed.failure.support.query).toBe(false);
      expect(probed.failure.error).toMatch(/embedded/i);
    }
  );

  it('a connection failure surfaces as a 500 with the dialect hint attached', async () => {
    const probed = await probeDbaUtility({
      dialect: 'sqlite',
      option: { connectionString: join(tmpdir(), 'fox-dba-util-missing-dir', 'nope.db') },
      kind: 'system',
    });
    expect(probed.ok).toBe(false);
    if (probed.ok) return;
    expect(probed.failure.status).toBe(500);
    expect(probed.failure.error).toMatch(/—/);
  });
});
