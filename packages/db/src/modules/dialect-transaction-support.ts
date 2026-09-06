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
 *   ALTER/DROP applied. CockroachDB belongs with them for a different reason
 *   (below). Claiming rolledBack=true there makes the UI say "target is
 *   unchanged" while the schema is partially migrated.
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
    // CockroachDB advertises transactional DDL, and it was trusted here for
    // that reason. It does not deliver it, and the server says so out loud —
    // on v26.3.0 `autocommit_before_ddl` defaults to `on`:
    //
    //     BEGIN
    //     NOTICE: auto-committing transaction before processing DDL due to
    //             autocommit_before_ddl setting
    //     ...
    //     COMMIT
    //     WARNING: there is no transaction in progress   (SQLSTATE 25P01)
    //
    // Every DDL statement commits on its own and the explicit transaction is
    // gone before the second one runs, so by the time anything fails there is
    // nothing left to roll back.
    //
    // The e2e compare plan for demo_a → demo_b is 18 statements. Statement 18
    // fails ("cannot alter type of column qty because view v_order_summary
    // depends on it"), and demo_b.order_items.qty — DEFAULT 0 in the seed —
    // comes back with no default at all, from the `DROP DEFAULT` that
    // modifyColumnStatements emits first. ROLLBACK returned without error and
    // the column stayed changed, under a banner reading "All changes were
    // rolled back — the target is unchanged".
    case 'cockroachdb':
      return false;
    default:
      return true;
  }
}
