/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { dialectSupportsTransactionalRollback } from './dialect-transaction-support';

describe('dialectSupportsTransactionalRollback', () => {
  it('is false for adapters whose rollback is a documented no-op', () => {
    expect(dialectSupportsTransactionalRollback('redis')).toBe(false);
    expect(dialectSupportsTransactionalRollback('Redis')).toBe(false);
    expect(dialectSupportsTransactionalRollback('mongodb')).toBe(false);
    expect(dialectSupportsTransactionalRollback('clickhouse')).toBe(false);
  });

  it('is true for dialects with real transactions', () => {
    expect(dialectSupportsTransactionalRollback('postgres')).toBe(true);
    expect(dialectSupportsTransactionalRollback('sqlite')).toBe(true);
    expect(dialectSupportsTransactionalRollback('sqlserver')).toBe(true);
  });
});
