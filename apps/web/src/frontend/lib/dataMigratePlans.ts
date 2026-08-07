/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turn classified row diffs into bound PeekWritePlan statements for apply.
 */

import {
  buildPeekDelete,
  buildPeekInsert,
  buildPeekUpdate,
  type PeekKeyColumn,
  type PeekWritePlan,
} from './rowDml';
import type { ClassifiedRowDiff } from './resultRowDiff';
import { keyColumnsForGrid } from './resultRowDiff';

export interface DataMigratePlanItem {
  op: ClassifiedRowDiff['op'];
  keyLabel: string;
  plan: PeekWritePlan;
}

function rowToValues(columns: string[], row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < columns.length; i++) {
    out[columns[i]!] = row[i] ?? null;
  }
  return out;
}

/**
 * Align dest-column order to source for UPDATE: original=dest values in source
 * column order; draft=source values.
 */
function alignRowToColumns(
  fromCols: string[],
  fromRow: unknown[],
  toCols: string[]
): unknown[] {
  const idx = new Map(fromCols.map((c, i) => [c.toLowerCase(), i]));
  return toCols.map((c) => {
    const i = idx.get(c.toLowerCase());
    return i === undefined ? null : (fromRow[i] ?? null);
  });
}

function stripIgnoredColumns(
  columns: string[],
  row: unknown[],
  ignoreLower: Set<string>
): { columns: string[]; row: unknown[] } {
  if (ignoreLower.size === 0) return { columns, row };
  const nextCols: string[] = [];
  const nextRow: unknown[] = [];
  for (let i = 0; i < columns.length; i++) {
    const name = columns[i]!;
    if (ignoreLower.has(name.toLowerCase())) continue;
    nextCols.push(name);
    nextRow.push(row[i]);
  }
  return { columns: nextCols, row: nextRow };
}

export function buildDataMigratePlans(opts: {
  tableName: string;
  dialect: string;
  sourceColumns: string[];
  destColumns: string[];
  keyNames: string[];
  ops: ClassifiedRowDiff[];
  /** When true, include identity/autoincrement values on INSERT (preserve source IDs). */
  includeIdentity: boolean;
  identityColumns: Set<string>;
  /**
   * Skip these columns on INSERT/UPDATE (trigger-managed createdAt / updatedBy).
   * Destination triggers can populate them.
   */
  ignoreColumns?: string[];
}): { plans: DataMigratePlanItem[]; errors: string[] } {
  const {
    tableName,
    dialect,
    sourceColumns,
    destColumns,
    keyNames,
    ops,
    includeIdentity,
    identityColumns,
    ignoreColumns = [],
  } = opts;

  const ignoreLower = new Set(ignoreColumns.map((c) => c.toLowerCase()));
  const sourceKeys = keyColumnsForGrid(keyNames, sourceColumns);
  const destKeys = keyColumnsForGrid(keyNames, destColumns);
  const plans: DataMigratePlanItem[] = [];
  const errors: string[] = [];

  for (const op of ops) {
    if (op.op === 'insert') {
      if (!op.sourceRow) {
        errors.push(`insert ${op.keyLabel}: missing source row`);
        continue;
      }
      const stripped = stripIgnoredColumns(sourceColumns, op.sourceRow, ignoreLower);
      const built = buildPeekInsert({
        tableName,
        dialect,
        values: rowToValues(stripped.columns, stripped.row),
        // Empty skip-set when includeIdentity — keep source ID values.
        identityColumns: includeIdentity ? undefined : identityColumns,
      });
      if ('error' in built) {
        errors.push(`insert ${op.keyLabel}: ${built.error}`);
        continue;
      }
      plans.push({ op: 'insert', keyLabel: op.keyLabel, plan: built });
      continue;
    }

    if (op.op === 'update') {
      if (!op.sourceRow || !op.destRow) {
        errors.push(`update ${op.keyLabel}: missing rows`);
        continue;
      }
      // UPDATE runs on dest: WHERE uses dest keys; SET uses source values.
      // Drop trigger/audit columns so we don't overwrite dest trigger output.
      const originalAligned = alignRowToColumns(destColumns, op.destRow, sourceColumns);
      const srcStripped = stripIgnoredColumns(sourceColumns, op.sourceRow, ignoreLower);
      const origStripped = stripIgnoredColumns(sourceColumns, originalAligned, ignoreLower);
      const keysOnSource: PeekKeyColumn[] = keyColumnsForGrid(keyNames, srcStripped.columns);
      const built = buildPeekUpdate({
        tableName,
        dialect,
        columns: srcStripped.columns,
        originalRow: origStripped.row,
        draftRow: srcStripped.row,
        keyColumns: keysOnSource,
      });
      if ('error' in built) {
        errors.push(`update ${op.keyLabel}: ${built.error}`);
        continue;
      }
      plans.push({ op: 'update', keyLabel: op.keyLabel, plan: built });
      continue;
    }

    // delete — from destination
    if (!op.destRow) {
      errors.push(`delete ${op.keyLabel}: missing dest row`);
      continue;
    }
    const built = buildPeekDelete({
      tableName,
      dialect,
      columns: destColumns,
      row: op.destRow,
      keyColumns: destKeys,
    });
    if ('error' in built) {
      errors.push(`delete ${op.keyLabel}: ${built.error}`);
      continue;
    }
    plans.push({ op: 'delete', keyLabel: op.keyLabel, plan: built });
  }

  return { plans, errors };
}

/** JSON snapshot of destination rows that will be affected (pre-apply). */
export function buildDestSnapshotJson(opts: {
  destColumns: string[];
  ops: ClassifiedRowDiff[];
}): string {
  const rows = opts.ops
    .filter((o) => o.op === 'update' || o.op === 'delete')
    .map((o) => {
      const row = o.destRow ?? [];
      const obj: Record<string, unknown> = { _op: o.op, _key: o.keyLabel };
      opts.destColumns.forEach((c, i) => {
        obj[c] = row[i] ?? null;
      });
      return obj;
    });
  return JSON.stringify({ columns: opts.destColumns, rows }, null, 2);
}
