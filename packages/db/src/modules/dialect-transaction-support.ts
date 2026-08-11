/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Some adapters expose begin/commit/rollback as intentional no-ops (Redis has
 * no rollback-capable MULTI story for our migrate path; standalone Mongo
 * rejects transactions; ClickHouse transactions are experimental). Callers
 * must not set rolledBack=true after those no-ops — earlier writes stay applied.
 */
export function dialectSupportsTransactionalRollback(dialect: string): boolean {
  switch (dialect.trim().toLowerCase()) {
    case 'redis':
    case 'mongodb':
    case 'clickhouse':
      return false;
    default:
      return true;
  }
}
