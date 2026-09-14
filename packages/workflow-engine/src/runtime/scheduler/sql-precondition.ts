/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/scheduler/sql-precondition.ts).
 */
/**
 * A schedule that asks a database whether there is anything to do.
 *
 * Without this, "run when there are new orders" is a workflow that starts
 * every minute, queries, finds nothing, and succeeds — 1,440 empty runs a day
 * burying the handful that mattered. The check belongs *before* the run
 * exists, so an idle schedule leaves no trace.
 *
 * The query is asked, never acted on: the result decides whether to enqueue,
 * and optionally becomes the run's payload so the workflow does not have to
 * fetch the same rows again.
 */

export type SqlEngine = 'postgres' | 'mysql';

/**
 * Runs one read-only query. Injected the same way `fetch` is, so the runtime
 * package stays free of database drivers and a test can answer without a
 * server.
 */
export interface SqlProbe {
  (input: {
    credentialId: string;
    engine: SqlEngine;
    sql: string;
    timeoutMs: number;
    maxRows: number;
  }): Promise<Record<string, unknown>[]>;
}

export interface SqlPrecondition {
  credentialId: string;
  engine: SqlEngine;
  query: string;
  expect: {
    mode: 'nonEmpty' | 'empty' | 'equals' | 'atLeast';
    /** Column of the first row to read for `equals` / `atLeast`. */
    column?: string;
    value?: unknown;
  };
  passRowsAsPayload: boolean;
  timeoutMs: number;
  maxRows: number;
}

/**
 * Reject anything that is not plainly a read.
 *
 * **This is a guard against accident, not a security boundary.** A determined
 * author can still write a data-modifying CTE — PostgreSQL happily runs
 * `WITH t AS (DELETE FROM x RETURNING *) SELECT * FROM t`, and this check
 * would pass it. The real boundary is the credential: point a precondition at
 * a role with SELECT and nothing else. What this catches is the far more
 * likely mistake of pasting an UPDATE into a box that runs every 30 seconds.
 */
export function assertReadOnly(sql: string): void {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();

  if (!/^(select|with)\b/i.test(stripped)) {
    throw new Error(
      'sql precondition must be a SELECT or WITH query — it decides whether to run, it does not change anything',
    );
  }
  // Stacked statements: `SELECT 1; DROP TABLE x` starts with SELECT.
  if (/;\s*\S/.test(stripped.replace(/;\s*$/, ''))) {
    throw new Error(
      'sql precondition must be a single statement — no semicolon-separated statements',
    );
  }
}

/** Does the result meet the expectation? */
export function meetsExpectation(
  rows: Record<string, unknown>[],
  expect: SqlPrecondition['expect'],
): boolean {
  switch (expect.mode) {
    case 'nonEmpty':
      return rows.length > 0;
    case 'empty':
      return rows.length === 0;
    case 'equals':
    case 'atLeast': {
      // Both read one value from the first row. No rows means nothing to
      // compare, which is a failed expectation rather than a thrown error —
      // an empty result is the normal case for a watch query.
      const first = rows[0];
      if (!first) return false;
      const value =
        expect.column !== undefined
          ? first[expect.column]
          : Object.values(first)[0];
      if (expect.mode === 'equals') return value === expect.value;
      return Number(value) >= Number(expect.value);
    }
  }
}

export interface PreconditionOutcome {
  met: boolean;
  rows: Record<string, unknown>[];
}

/**
 * Ask the database. Throws when the precondition cannot be evaluated — a
 * schedule that silently ran because its own check was broken would be a
 * worse failure than one that reports it.
 */
export async function evaluatePrecondition(
  precondition: SqlPrecondition,
  probe: SqlProbe | undefined,
): Promise<PreconditionOutcome> {
  if (!probe) {
    throw new Error(
      'sql precondition configured but no SQL probe is wired into the scheduler',
    );
  }
  assertReadOnly(precondition.query);

  const rows = await probe({
    credentialId: precondition.credentialId,
    engine: precondition.engine,
    sql: precondition.query,
    timeoutMs: precondition.timeoutMs,
    maxRows: precondition.maxRows,
  });
  return { met: meetsExpectation(rows, precondition.expect), rows };
}
