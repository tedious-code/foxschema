/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Apply data-migrate row ops on one dedicated connection with optional
 * transaction wrapping (same patterns as Schema Sync MigrationModule).
 */
import { ConnectionFactory, getAdapter, type ConnectionOptions } from '@foxschema/db';

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
 */
export async function executeDataMigrateOps(
  dialect: string,
  option: ConnectionOptions,
  schema: string | undefined,
  ops: DataMigrateExecOp[],
  opts: { useTransaction: boolean; continueOnError: boolean },
  onEvent?: (e: DataMigrateExecEvent) => void
): Promise<DataMigrateExecResult> {
  const adapter = getAdapter(dialect);
  const conn = await ConnectionFactory.create(dialect, option, { pooled: false });
  const results: DataMigrateExecResult['results'] = [];
  let failCount = 0;
  let rolledBack = false;

  const emit = (e: DataMigrateExecEvent) => onEvent?.(e);

  try {
    if (schema?.trim()) {
      await adapter.setCurrentSchema(conn, schema.trim());
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
                error: 'Stopped after earlier failure (transaction rolled back)',
              });
              emit({
                type: 'op',
                index: j,
                op: skipped.op,
                key: skipped.key,
                status: 'SKIPPED',
                error: 'Stopped after earlier failure (transaction rolled back)',
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
          rolledBack = true;
        } catch (rollbackErr) {
          console.error('Data migrate rollback failed:', rollbackErr);
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
    await ConnectionFactory.close(dialect, conn);
  }
}
