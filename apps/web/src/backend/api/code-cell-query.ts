/**
 * Executes the statements a `-- @node` cell sends over the bridge.
 *
 * This is the trust boundary for `sql` inside a cell: the write policy and the
 * row cap live here, in the API process, not in the worker that runs user code.
 */

import { ConnectionFactory, requiresWritePermission, type ConnectionOptions } from '@foxschema/core';
import { MAX_CELL_QUERY_ROWS } from './code-cell-bridge';
import type { CellQueryRunner } from './code-cell-execute';

/**
 * Build the bridge runner for one resolved connection.
 *
 * `allowWrites` mirrors the editor's Safe mode. A cell cannot be statically
 * analyzed for what SQL it will build at runtime, so the check has to happen
 * here, per statement, at the moment it is submitted.
 */
export function makeCellQueryRunner(
  resolved: { dialect: string; option: ConnectionOptions },
  allowWrites: boolean
): CellQueryRunner {
  return async (text: string, params: unknown[]) => {
    const sql = text.trim();
    if (!sql) throw new Error('Empty statement');

    // Fail-closed, same as the /sql/execute gate: a cell builds its SQL at
    // runtime, so anything not provably a read is treated as a write.
    if (!allowWrites && requiresWritePermission(sql)) {
      throw new Error(
        'Safe mode is on — this cell tried to run a write/DDL statement. ' +
          'Turn Safe mode off (or confirm the run) to allow writes from code cells.'
      );
    }

    const rows = await ConnectionFactory.executeQuery<Record<string, unknown>>(
      resolved.dialect,
      resolved.option,
      sql,
      params
    );
    if (!Array.isArray(rows)) return [];
    // Cap what crosses back into the worker: a cell asking for a 10M-row table
    // would otherwise serialize the whole thing through structured clone.
    return rows.length > MAX_CELL_QUERY_ROWS ? rows.slice(0, MAX_CELL_QUERY_ROWS) : rows;
  };
}
