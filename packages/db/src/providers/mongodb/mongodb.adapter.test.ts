/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mongoDbAdapter } from './mongodb.adapter.js';

describe('mongodb adapter handle isolation', () => {
  afterEach(async () => {
    await mongoDbAdapter.closeAll();
    vi.restoreAllMocks();
  });

  it('setCurrentSchema does not poison the next acquire for the same credential', async () => {
    const connect = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const MongoClient = vi.fn(function (this: any) {
      this.connect = connect;
      this.close = close;
      this.db = vi.fn();
    });
    // Force the lazy loader to use our stub instead of the real driver.
    (mongoDbAdapter as any).mod = { MongoClient };

    const first = await mongoDbAdapter.acquire(
      'mongodb://localhost:27017',
      { database: 'prod' } as any,
      true
    );
    expect(first.database).toBe('prod');
    await mongoDbAdapter.setCurrentSchema(first, 'staging');
    expect(first.database).toBe('staging');

    const second = await mongoDbAdapter.acquire(
      'mongodb://localhost:27017',
      { database: 'prod' } as any,
      true
    );
    // Same pooled client, but the cached database name must still be prod.
    expect(second.database).toBe('prod');
    expect(second.client).toBe(first.client);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
