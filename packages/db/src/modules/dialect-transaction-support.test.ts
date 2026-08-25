/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  dialectSupportsTransactionalDdlRollback,
  dialectSupportsTransactionalRollback,
} from './dialect-transaction-support';

describe('dialectSupportsTransactionalRollback', () => {
  it('is false for adapters whose rollback is a documented no-op', () => {
    expect(dialectSupportsTransactionalRollback('redis')).toBe(false);
    expect(dialectSupportsTransactionalRollback('Redis')).toBe(false);
    expect(dialectSupportsTransactionalRollback('mongodb')).toBe(false);
    expect(dialectSupportsTransactionalRollback('clickhouse')).toBe(false);
  });

  it('is true for dialects with real DML transactions (including MySQL/Oracle)', () => {
    // Data-migrate DML still rolls back on these — only DDL auto-commits.
    expect(dialectSupportsTransactionalRollback('mysql')).toBe(true);
    expect(dialectSupportsTransactionalRollback('oracle')).toBe(true);
    expect(dialectSupportsTransactionalRollback('postgres')).toBe(true);
    expect(dialectSupportsTransactionalRollback('sqlite')).toBe(true);
    expect(dialectSupportsTransactionalRollback('sqlserver')).toBe(true);
  });
});

describe('dialectSupportsTransactionalDdlRollback', () => {
  it('is false when DDL auto-commits (MySQL family + Oracle)', () => {
    expect(dialectSupportsTransactionalDdlRollback('mysql')).toBe(false);
    expect(dialectSupportsTransactionalDdlRollback('MariaDB')).toBe(false);
    expect(dialectSupportsTransactionalDdlRollback('tidb')).toBe(false);
    expect(dialectSupportsTransactionalDdlRollback('oracle')).toBe(false);
  });

  it('is false for no-op rollback adapters', () => {
    expect(dialectSupportsTransactionalDdlRollback('redis')).toBe(false);
    expect(dialectSupportsTransactionalDdlRollback('mongodb')).toBe(false);
    expect(dialectSupportsTransactionalDdlRollback('clickhouse')).toBe(false);
  });

  it('is true when schema DDL can participate in a transaction', () => {
    expect(dialectSupportsTransactionalDdlRollback('postgres')).toBe(true);
    expect(dialectSupportsTransactionalDdlRollback('sqlite')).toBe(true);
    expect(dialectSupportsTransactionalDdlRollback('sqlserver')).toBe(true);
    expect(dialectSupportsTransactionalDdlRollback('db2')).toBe(true);
  });
});
