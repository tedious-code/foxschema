/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/conditions.ts).
 */
import {
  applyPredicate,
  getPath,
  type TriggerCondition,
} from '../common/index.js';
import { assertReadOnly, type SqlProbe } from './scheduler/sql-precondition.js';

/**
 * Evaluating "only run when…" before a run exists.
 *
 * Conditions are asked at admission — the single point every trigger kind
 * funnels through — so a failed one means no run record at all, not a run that
 * starts and immediately decides it had nothing to do.
 */

export interface ConditionContext {
  /** The trigger's payload, for `payload` checks. */
  payload: unknown;
  sql?: SqlProbe;
  fetch?: typeof fetch;
}

export interface ConditionOutcome {
  met: boolean;
  /** Which condition refused, for the log line that explains the silence. */
  failed?: string;
  /**
   * Data a passing condition asked to hand on (`passAs`), merged into the
   * run's payload so the workflow does not fetch what was just fetched.
   */
  collected: Record<string, unknown>;
}

function describe(condition: TriggerCondition): string {
  if (condition.check === 'payload') {
    return `payload ${condition.path} ${condition.op}`;
  }
  if (condition.check === 'sql') return `sql ${condition.expect.op}`;
  return `http ${condition.request.method ?? 'GET'} ${condition.expect.op}`;
}

/**
 * `rowCount` is synthetic so the common question — "is there anything?" —
 * needs no `count(*)` wrapper, while a real column of that name still wins.
 */
function sqlSubject(
  rows: Record<string, unknown>[],
  path?: string,
): unknown {
  if (path === undefined) return rows.length;
  if (path === 'rowCount' && !(rows[0] && 'rowCount' in rows[0])) {
    return rows.length;
  }
  return getPath(rows[0] ?? {}, path);
}

export async function evaluateConditions(
  conditions: TriggerCondition[],
  context: ConditionContext,
): Promise<ConditionOutcome> {
  const collected: Record<string, unknown> = {};

  for (const condition of conditions) {
    if (condition.check === 'payload') {
      const value = getPath(context.payload, condition.path);
      if (!applyPredicate(condition.op, value, condition.value)) {
        return { met: false, failed: describe(condition), collected };
      }
      continue;
    }

    if (condition.check === 'sql') {
      if (!context.sql) {
        // Refusing beats guessing. Treating an unevaluable gate as "met" runs
        // the workflow the gate exists to hold back; treating it as "unmet"
        // silently stops a schedule forever. Both are worse than an error.
        throw new Error(
          'sql condition configured but no SQL probe is wired into the scheduler',
        );
      }
      assertReadOnly(condition.query);
      const rows = await context.sql({
        credentialId: condition.credentialId,
        engine: condition.engine,
        sql: condition.query,
        timeoutMs: condition.timeoutMs,
        maxRows: condition.maxRows,
      });
      const subject = sqlSubject(rows, condition.expect.path);
      if (!applyPredicate(condition.expect.op, subject, condition.expect.value)) {
        return { met: false, failed: describe(condition), collected };
      }
      if (condition.passAs) collected[condition.passAs] = rows;
      continue;
    }

    const doFetch = context.fetch ?? globalThis.fetch;
    if (!doFetch) {
      throw new Error('http condition configured but no fetch is available');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), condition.timeoutMs);
    let response: Response;
    try {
      response = await doFetch(condition.request.url, {
        method: condition.request.method ?? 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    // Body is read as text and parsed opportunistically: a health endpoint
    // answering `ok` is as valid a gate as one answering JSON.
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* not JSON; the text is the body */
    }
    const subject =
      condition.expect.path === undefined
        ? response.status
        : getPath({ status: response.status, body }, condition.expect.path);
    if (!applyPredicate(condition.expect.op, subject, condition.expect.value)) {
      return { met: false, failed: describe(condition), collected };
    }
    if (condition.passAs) collected[condition.passAs] = body;
  }

  return { met: true, collected };
}
