/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Whether ROLLBACK can undo work that already ran on a connection.
 *
 * Two questions, not one:
 *
 * - **DML** (`dialectSupportsTransactionalRollback`): data-migrate INSERT/
 *   UPDATE/DELETE. Redis/MongoDB/ClickHouse expose no-op begin/rollback;
 *   callers must not set rolledBack=true after those resolve. MySQL/Oracle
 *   *do* roll back DML — keep them true here.
 * - **DDL** (`dialectSupportsTransactionalDdlRollback`): schema Sync
 *   MigrationModule. MySQL/MariaDB/TiDB and Oracle auto-commit each DDL
 *   statement, so ROLLBACK after a mid-plan failure leaves earlier CREATE/
 *   ALTER/DROP applied. Claiming rolledBack=true there makes the UI say
 *   "target is unchanged" while the schema is partially migrated.
 */

/** True when adapter.rollback can undo ordinary DML on this dialect. */
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

/**
 * True when a failed multi-step schema migration can undo DDL already run
 * in the same transaction. False for no-op adapters *and* for engines whose
 * DDL auto-commits outside the transaction.
 */
export function dialectSupportsTransactionalDdlRollback(dialect: string): boolean {
  if (!dialectSupportsTransactionalRollback(dialect)) return false;
  switch (dialect.trim().toLowerCase()) {
    case 'mysql':
    case 'mariadb':
    case 'tidb':
    case 'oracle':
      return false;
    default:
      return true;
  }
}
