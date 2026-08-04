/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Executes the statements a `-- @node` cell sends over the bridge.
 *
 * This is the trust boundary for `sql` inside a cell: the write policy, the
 * caller's permissions, and the row cap live here, in the API process, not in
 * the worker that runs user code.
 */

import { ConnectionFactory, sqlStatementCategories, type ConnectionOptions } from '@foxschema/core';
import { MAX_CELL_QUERY_ROWS } from './code-cell-bridge';
import type { CellQueryRunner } from './code-cell-execute';
import { CATEGORY_PERMISSION, type Permission } from '../../shared/permissions';

export interface CellQueryPolicy {
  /** Mirrors the editor's Safe mode: false blocks every non-read statement. */
  allowWrites: boolean;
  /**
   * The caller's effective permissions. Checked per statement because a cell
   * builds its SQL at runtime — the route cannot know up front whether a cell
   * will INSERT a row or GRANT a privilege.
   */
  can: (permission: Permission) => boolean;
}

/**
 * Build the bridge runner for one resolved connection.
 *
 * Both checks matter and neither replaces the other: Safe mode is the user's
 * own guard rail, while the permission check is what the role system promises.
 * Without the second, `allowWrites` would be a blanket pass and an editor could
 * run `GRANT` from a cell — escalating past the `editor.grant` boundary that
 * exists precisely to stop that.
 */
export function makeCellQueryRunner(
  resolved: { dialect: string; option: ConnectionOptions },
  policy: CellQueryPolicy
): CellQueryRunner {
  return async (text: string, params: unknown[]) => {
    const sql = text.trim();
    if (!sql) throw new Error('Empty statement');

    // Fail-closed, same classifier as the /sql/execute gate: an unrecognized
    // verb lands in `ddl` rather than slipping through as a read. Batches are
    // classified per statement so a leading SELECT cannot hide a write/GRANT.
    const categories = sqlStatementCategories(sql);
    for (const category of categories) {
      if (category === 'read') continue;
      if (!policy.allowWrites) {
        throw new Error(
          'Safe mode is on — this cell tried to run a write/DDL statement. ' +
            'Turn Safe mode off (or confirm the run) to allow writes from code cells.'
        );
      }
      const permission = CATEGORY_PERMISSION[category];
      if (permission && !policy.can(permission)) {
        throw new Error(
          `Permission denied: this cell tried to run a statement requiring "${permission}".`
        );
      }
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

/**
 * Server Beam router: pick a per-alias runner. Unknown aliases fail closed.
 */
export function makeBeamCellQueryRunner(
  byAlias: Map<string, CellQueryRunner>,
  defaultAlias?: string
): CellQueryRunner {
  return async (text, params, alias) => {
    const key = alias ?? defaultAlias;
    if (!key) {
      throw new Error('Server Beam query missing alias — use sql.on("source") or sql.on("target")');
    }
    const runner = byAlias.get(key);
    if (!runner) {
      const known = [...byAlias.keys()].join(', ') || '(none)';
      throw new Error(`Unknown Server Beam alias "${key}". Known: ${known}`);
    }
    return runner(text, params, key);
  };
}
