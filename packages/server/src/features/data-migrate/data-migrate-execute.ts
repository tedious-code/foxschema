/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Apply data-migrate row ops on one dedicated connection with optional
 * transaction wrapping (same patterns as Schema Sync MigrationModule).
 */
import {
  ConnectionFactory,
  dialectSupportsTransactionalRollback,
  getAdapter,
  type ConnectionOptions,
} from '@foxschema/db';

export type DataMigrateOpKind = 'insert' | 'update' | 'delete';

export interface DataMigrateExecOp {
  op: DataMigrateOpKind;
  key: string;
  sql: string;
  params?: unknown[];
}

export type DataMigrateExecEvent =
  | { type: 'start'; total: number }
  | {
      type: 'op';
      index: number;
      op: DataMigrateOpKind;
      key: string;
      status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
      error?: string;
    }
  | {
      type: 'done';
      success: boolean;
      rolledBack: boolean;
      failCount: number;
      error?: string;
    };

/**
 * Statements that put the connection into a mode the ops need, and take it back
 * out again.
 *
 * SQL Server and Azure SQL will not accept an explicit identity value until the
 * session has `SET IDENTITY_INSERT <table> ON`, and the setting belongs to the
 * session rather than the statement. The connection here is unpooled and used
 * by one migration only, so the mode cannot leak to another caller — `after`
 * still runs, because leaving it on would block a later write to a *different*
 * table on the same session.
 *
 * Built by the caller from the dialect capability table, never from client
 * input: `/data-migrate/execute` accepts DML for its ops and nothing else.
 */
export interface DataMigrateSessionSql {
  /** Runs once before the first op. A failure here aborts the migration. */
  before: string;
  /** Runs after the last op, whether or not the ops succeeded. */
  after: string;
}

export interface DataMigrateExecResult {
  results: Array<{
    op: DataMigrateOpKind;
    key: string;
    status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
    error?: string;
  }>;
  rolledBack: boolean;
  failCount: number;
}

/**
 * - useTransaction + !continueOnError: one transaction, first failure → rollback, rest SKIPPED
 * - continueOnError: each op in its own transaction (failed op rolls back only itself)
 * - !useTransaction + !continueOnError: no outer tx; stop after first failure (rest SKIPPED)
 * - !useTransaction + continueOnError: no tx; keep going on failures
 *
 * Redis / MongoDB / ClickHouse expose no-op begin/rollback. A resolved no-op
 * must not set rolledBack=true — earlier writes stay applied. See
 * `dialectSupportsTransactionalRollback`.
 */
export async function executeDataMigrateOps(
  dialect: string,
  option: ConnectionOptions,
  schema: string | undefined,
  ops: DataMigrateExecOp[],
  opts: {
    useTransaction: boolean;
    continueOnError: boolean;
    sessionSql?: DataMigrateSessionSql;
  },
  onEvent?: (e: DataMigrateExecEvent) => void
): Promise<DataMigrateExecResult> {
  const adapter = getAdapter(dialect);
  const canRollback = dialectSupportsTransactionalRollback(dialect);
  const conn = await ConnectionFactory.create(dialect, option, { pooled: false });
  const results: DataMigrateExecResult['results'] = [];
  let failCount = 0;
  let rolledBack = false;
  let sessionOpen = false;

  const emit = (e: DataMigrateExecEvent) => onEvent?.(e);
  const stoppedAfterFailureMessage = (rolled: boolean) =>
    rolled
      ? 'Stopped after earlier failure (transaction rolled back)'
      : 'Stopped after earlier failure';

  try {
    if (schema?.trim()) {
      await adapter.setCurrentSchema(conn, schema.trim());
    }

    if (opts.sessionSql) {
      try {
        await adapter.query(conn, opts.sessionSql.before, []);
        sessionOpen = true;
      } catch (err) {
        // Every insert would fail the same way a moment later, one error per
        // row. Stop here so the user gets the cause once.
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not prepare the destination session: ${message}`);
      }
    }

    emit({ type: 'start', total: ops.length });

    if (opts.useTransaction && !opts.continueOnError) {
      await adapter.beginTransaction(conn);
      try {
        for (let i = 0; i < ops.length; i++) {
          const item = ops[i]!;
          emit({ type: 'op', index: i, op: item.op, key: item.key, status: 'RUNNING' });
          try {
            await adapter.query(conn, item.sql.replace(/;\s*$/, ''), item.params ?? []);
            results.push({ op: item.op, key: item.key, status: 'SUCCESS' });
            emit({ type: 'op', index: i, op: item.op, key: item.key, status: 'SUCCESS' });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            failCount += 1;
            results.push({ op: item.op, key: item.key, status: 'FAILED', error: message });
            emit({
              type: 'op',
              index: i,
              op: item.op,
              key: item.key,
              status: 'FAILED',
              error: message,
            });
            for (let j = i + 1; j < ops.length; j++) {
              const skipped = ops[j]!;
              results.push({
                op: skipped.op,
                key: skipped.key,
                status: 'SKIPPED',
                error: stoppedAfterFailureMessage(canRollback),
              });
              emit({
                type: 'op',
                index: j,
                op: skipped.op,
                key: skipped.key,
                status: 'SKIPPED',
                error: stoppedAfterFailureMessage(canRollback),
              });
            }
            throw err;
          }
        }
        await adapter.commitTransaction(conn);
        emit({ type: 'done', success: true, rolledBack: false, failCount: 0 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        try {
          await adapter.rollbackTransaction(conn);
          // No-op rollback adapters still resolve — only mark rolled back when
          // the dialect can actually undo committed writes.
          rolledBack = canRollback;
        } catch (rollbackErr) {
          console.error('Data migrate rollback failed:', rollbackErr);
          rolledBack = false;
        }
        emit({
          type: 'done',
          success: false,
          rolledBack,
          failCount,
          error: message,
        });
      }
      return { results, rolledBack, failCount };
    }

    // Per-op transaction (continueOnError) or autocommit (no outer transaction).
    for (let i = 0; i < ops.length; i++) {
      const item = ops[i]!;
      emit({ type: 'op', index: i, op: item.op, key: item.key, status: 'RUNNING' });
      try {
        if (opts.useTransaction || opts.continueOnError) {
          // continueOnError always uses per-op tx; useTransaction+continue also.
          await adapter.beginTransaction(conn);
        }
        await adapter.query(conn, item.sql.replace(/;\s*$/, ''), item.params ?? []);
        if (opts.useTransaction || opts.continueOnError) {
          await adapter.commitTransaction(conn);
        }
        results.push({ op: item.op, key: item.key, status: 'SUCCESS' });
        emit({ type: 'op', index: i, op: item.op, key: item.key, status: 'SUCCESS' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failCount += 1;
        if (opts.useTransaction || opts.continueOnError) {
          try {
            await adapter.rollbackTransaction(conn);
          } catch (rollbackErr) {
            console.error(`Data migrate rollback of ${item.key} failed:`, rollbackErr);
          }
        }
        results.push({ op: item.op, key: item.key, status: 'FAILED', error: message });
        emit({
          type: 'op',
          index: i,
          op: item.op,
          key: item.key,
          status: 'FAILED',
          error: message,
        });

        if (!opts.continueOnError) {
          for (let j = i + 1; j < ops.length; j++) {
            const skipped = ops[j]!;
            results.push({
              op: skipped.op,
              key: skipped.key,
              status: 'SKIPPED',
              error: 'Stopped after earlier failure',
            });
            emit({
              type: 'op',
              index: j,
              op: skipped.op,
              key: skipped.key,
              status: 'SKIPPED',
              error: 'Stopped after earlier failure',
            });
          }
          emit({
            type: 'done',
            success: false,
            rolledBack: false,
            failCount,
            error: message,
          });
          return { results, rolledBack: false, failCount };
        }
      }
    }

    emit({
      type: 'done',
      success: failCount === 0,
      rolledBack: false,
      failCount,
    });
    return { results, rolledBack: false, failCount };
  } finally {
    if (sessionOpen && opts.sessionSql) {
      try {
        await adapter.query(conn, opts.sessionSql.after, []);
      } catch (err) {
        // The connection is closed next, so this only matters as a signal.
        console.error('Data migrate could not restore the destination session:', err);
      }
    }
    await ConnectionFactory.close(dialect, conn);
  }
}
