/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Whether ROLLBACK can undo work that already ran on a connection.
 *
 * Two questions, not one, and the answers differ for five engines:
 *
 * - **DML** — data-migrate INSERT/UPDATE/DELETE.
 * - **DDL** — schema Sync's MigrationModule: CREATE/ALTER/DROP.
 *
 * MySQL, MariaDB, TiDB, Oracle and CockroachDB roll back DML perfectly well
 * and cannot roll back DDL at all. Answering one question with the other is a
 * real bug in both directions: claim DDL rollback and the UI says "the target
 * is unchanged" over a half-migrated schema; deny DML rollback and it tells
 * someone their row changes are unconfirmed when the engine already undid them.
 *
 * ## Why a table
 *
 * This was two switch statements, one per question, both ending
 * `default: return true`. They were easy to confuse and duly were: the edit
 * adding CockroachDB matched the first switch, so the case landed under DML —
 * wrong — and DDL was left with the explanatory comment and no case, returning
 * false only by short-circuiting through that mistake. One row per dialect puts
 * both answers on the same line, where they cannot be edited apart.
 */

/** What a dialect can undo. Absent from the table below means "both". */
export interface RollbackSupport {
  /** ROLLBACK undoes INSERT/UPDATE/DELETE. */
  dml: boolean;
  /** ROLLBACK undoes CREATE/ALTER/DROP run earlier in the same transaction. */
  ddl: boolean;
}

const BOTH: RollbackSupport = { dml: true, ddl: true };

/**
 * The engines that cannot undo something. Everything else gets {@link BOTH}.
 *
 * Keyed by the lower-cased dialect name, matching how callers name engines.
 */
const ROLLBACK_SUPPORT: Record<string, RollbackSupport> = {
  // No-op begin/rollback: the adapter resolves without doing anything, so a
  // caller must not report a rollback it never got. Neither kind is undone.
  redis: { dml: false, ddl: false },
  mongodb: { dml: false, ddl: false },
  clickhouse: { dml: false, ddl: false },

  // DDL auto-commits as each statement runs, so ROLLBACK after a mid-plan
  // failure leaves the earlier CREATE/ALTER/DROP applied. DML is unaffected.
  mysql: { dml: true, ddl: false },
  mariadb: { dml: true, ddl: false },
  tidb: { dml: true, ddl: false },
  oracle: { dml: true, ddl: false },

  // CockroachDB advertises transactional DDL and was trusted for it. It does
  // not deliver, and the server says so out loud — on v26.3.0
  // `autocommit_before_ddl` defaults to `on`:
  //
  //     BEGIN
  //     NOTICE: auto-committing transaction before processing DDL due to
  //             autocommit_before_ddl setting
  //     ...
  //     COMMIT
  //     WARNING: there is no transaction in progress   (SQLSTATE 25P01)
  //
  // Every DDL statement commits on its own and the explicit transaction is gone
  // before the second one runs, so by the time anything fails there is nothing
  // left to roll back.
  //
  // Measured, not inferred: the e2e compare plan for demo_a → demo_b is 18
  // statements. Statement 18 fails ("cannot alter type of column qty because
  // view v_order_summary depends on it"), and demo_b.order_items.qty — DEFAULT
  // 0 in the seed — comes back with no default at all, left that way by the
  // DROP DEFAULT the plan runs first. ROLLBACK returned without error and the
  // column stayed changed, under a banner reading "All changes were rolled
  // back — the target is unchanged".
  cockroachdb: { dml: true, ddl: false },
};

/** What this dialect can undo. */
export function rollbackSupport(dialect: string): RollbackSupport {
  return ROLLBACK_SUPPORT[dialect.trim().toLowerCase()] ?? BOTH;
}

/** True when adapter.rollback can undo ordinary DML on this dialect. */
export function dialectSupportsTransactionalRollback(dialect: string): boolean {
  return rollbackSupport(dialect).dml;
}

/**
 * True when a failed multi-step schema migration can undo DDL already run in
 * the same transaction.
 *
 * Never true where DML rollback is not: an adapter whose rollback does nothing
 * cannot undo DDL either. The table is checked for that in its own test rather
 * than the check being repeated here, so a new row cannot quietly claim it.
 */
export function dialectSupportsTransactionalDdlRollback(dialect: string): boolean {
  return rollbackSupport(dialect).ddl;
}

/** Exported for the invariant test; not part of the runtime contract. */
export const ROLLBACK_SUPPORT_TABLE: Readonly<Record<string, RollbackSupport>> =
  ROLLBACK_SUPPORT;
