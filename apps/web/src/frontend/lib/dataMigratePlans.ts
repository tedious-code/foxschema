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
  /**
   * How the destination's identity column is declared ('ALWAYS' / 'BY DEFAULT').
   * Only consulted when includeIdentity is on — it decides whether the INSERT
   * needs an overriding clause for the destination engine.
   */
  identityGeneration?: string;
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
    identityGeneration,
    ignoreColumns = [],
  } = opts;

  const ignoreLower = new Set(ignoreColumns.map((c) => c.toLowerCase()));
  const sourceKeys = keyColumnsForGrid(keyNames, sourceColumns);
  const destKeys = keyColumnsForGrid(keyNames, destColumns);
  const plans: DataMigratePlanItem[] = [];
  const errors: string[] = [];

  // When Include identity is off, omit identity/autoincrement columns entirely
  // so the destination generates them. buildPeekInsert only skips *empty*
  // identity values (Peek UX fills those blank) — source migrate rows always
  // carry real IDs, so we must strip here or IDs are preserved contrary to UI.
  const insertIgnore = new Set(ignoreLower);
  if (!includeIdentity) {
    for (const name of identityColumns) insertIgnore.add(name.toLowerCase());
  }

  for (const op of ops) {
    if (op.op === 'insert') {
      if (!op.sourceRow) {
        errors.push(`insert ${op.keyLabel}: missing source row`);
        continue;
      }
      const stripped = stripIgnoredColumns(sourceColumns, op.sourceRow, insertIgnore);
      const built = buildPeekInsert({
        tableName,
        dialect,
        values: rowToValues(stripped.columns, stripped.row),
        // Identity already stripped when !includeIdentity; when on, keep values
        // and let buildPeekInsert shape the statement for the engine.
        identityColumns: undefined,
        writeIdentityGeneration: includeIdentity ? identityGeneration : undefined,
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

/** One row in a pre-apply backup snapshot (used to reverse successful ops). */
export interface DataMigrateSnapshotRow {
  _op: ClassifiedRowDiff['op'];
  _key: string;
  [col: string]: unknown;
}

export interface DataMigrateSnapshot {
  version: 1;
  tableName: string;
  dialect: string;
  columns: string[];
  keyColumns: string[];
  /** True when INSERT preserved source identity values (required to DELETE inserts on restore). */
  includeIdentity: boolean;
  rows: DataMigrateSnapshotRow[];
}

/**
 * Pre-apply backup of destination state for every op about to run.
 *
 * - update / delete: full destination row (restore = UPDATE back / INSERT back)
 * - insert: source row keyed for DELETE on restore (only reliable when includeIdentity)
 */
export function buildDestSnapshotJson(opts: {
  tableName: string;
  dialect: string;
  destColumns: string[];
  sourceColumns: string[];
  keyNames: string[];
  includeIdentity: boolean;
  ops: ClassifiedRowDiff[];
}): string {
  const {
    tableName,
    dialect,
    destColumns,
    sourceColumns,
    keyNames,
    includeIdentity,
    ops,
  } = opts;
  const rows: DataMigrateSnapshotRow[] = [];

  for (const o of ops) {
    if (o.op === 'update' || o.op === 'delete') {
      const row = o.destRow ?? [];
      const obj: DataMigrateSnapshotRow = { _op: o.op, _key: o.keyLabel };
      destColumns.forEach((c, i) => {
        obj[c] = row[i] ?? null;
      });
      rows.push(obj);
      continue;
    }
    // insert — capture source values so restore can DELETE by key when IDs were preserved
    if (!o.sourceRow) continue;
    const obj: DataMigrateSnapshotRow = { _op: 'insert', _key: o.keyLabel };
    sourceColumns.forEach((c, i) => {
      obj[c] = o.sourceRow![i] ?? null;
    });
    rows.push(obj);
  }

  const snapshot: DataMigrateSnapshot = {
    version: 1,
    tableName,
    dialect,
    columns: destColumns,
    keyColumns: keyNames,
    includeIdentity,
    rows,
  };
  return JSON.stringify(snapshot, null, 2);
}

function parseSnapshot(json: string): DataMigrateSnapshot | { error: string } {
  try {
    const raw = JSON.parse(json) as Partial<DataMigrateSnapshot> & {
      columns?: string[];
      rows?: DataMigrateSnapshotRow[];
    };
    if (!raw || !Array.isArray(raw.rows) || !Array.isArray(raw.columns)) {
      return { error: 'Snapshot is missing rows/columns' };
    }
    // Legacy snapshots (pre-Backup) only had columns + update/delete rows.
    return {
      version: 1,
      tableName: raw.tableName || '',
      dialect: raw.dialect || 'sqlite',
      columns: raw.columns,
      keyColumns: raw.keyColumns?.length ? raw.keyColumns : guessKeyColumns(raw.rows),
      includeIdentity: raw.includeIdentity !== false,
      rows: raw.rows,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function guessKeyColumns(rows: DataMigrateSnapshotRow[]): string[] {
  // Fall back to a single `id` column when older snapshots omit keyColumns.
  for (const r of rows) {
    if ('id' in r) return ['id'];
  }
  return [];
}

function snapshotRowValues(
  columns: string[],
  row: DataMigrateSnapshotRow
): unknown[] {
  return columns.map((c) => row[c] ?? null);
}

/**
 * Build reverse DML for ops that succeeded — undo a partial migrate from Backup.
 *
 * insert → DELETE by key · update → UPDATE to dest snapshot · delete → INSERT dest row
 */
export function buildRestorePlansFromSnapshot(opts: {
  snapshotJson: string;
  /** Successful migrate results to reverse (FAILED/SKIPPED are ignored). */
  successfulOps: Array<{ op: ClassifiedRowDiff['op']; key: string }>;
  tableName?: string;
  dialect?: string;
}): { plans: DataMigratePlanItem[]; errors: string[] } {
  const parsed = parseSnapshot(opts.snapshotJson);
  if ('error' in parsed) return { plans: [], errors: [parsed.error] };

  const tableName = (opts.tableName || parsed.tableName || '').trim();
  const dialect = (opts.dialect || parsed.dialect || 'sqlite').trim();
  if (!tableName) return { plans: [], errors: ['Snapshot has no table name'] };

  const keyNames = parsed.keyColumns;
  if (!keyNames.length) {
    return { plans: [], errors: ['Snapshot has no key columns — cannot restore'] };
  }

  const byKey = new Map(parsed.rows.map((r) => [`${r._op}:${r._key}`, r]));
  const plans: DataMigratePlanItem[] = [];
  const errors: string[] = [];

  // Reverse in opposite order so FK-friendly batches undo last-write-first.
  const toReverse = [...opts.successfulOps].reverse();

  for (const item of toReverse) {
    const snap = byKey.get(`${item.op}:${item.key}`);
    if (!snap) {
      errors.push(`restore ${item.op} ${item.key}: no snapshot row`);
      continue;
    }

    if (item.op === 'insert') {
      if (!parsed.includeIdentity) {
        errors.push(
          `restore insert ${item.key}: skipped — Backup cannot DELETE inserts when Include identity was off (generated IDs unknown)`
        );
        continue;
      }
      const columns = parsed.columns.length ? parsed.columns : Object.keys(snap).filter((k) => !k.startsWith('_'));
      const row = snapshotRowValues(columns, snap);
      const keyColumns = keyColumnsForGrid(keyNames, columns);
      const built = buildPeekDelete({
        tableName,
        dialect,
        columns,
        row,
        keyColumns,
      });
      if ('error' in built) {
        errors.push(`restore insert ${item.key}: ${built.error}`);
        continue;
      }
      plans.push({ op: 'delete', keyLabel: item.key, plan: built });
      continue;
    }

    if (item.op === 'update') {
      const columns = parsed.columns;
      const destRow = snapshotRowValues(columns, snap);
      const keyColumns = keyColumnsForGrid(keyNames, columns);
      // buildPeekUpdate only SETs columns that differ from originalRow. Fabricate
      // a dirty "current" so every non-key column is written back to the snapshot.
      const pretendCurrent = columns.map((c, i) => {
        const isKey = keyNames.some((k) => k.toLowerCase() === c.toLowerCase());
        if (isKey) return destRow[i];
        return destRow[i] === null ? '__fox_restore__' : null;
      });
      const built = buildPeekUpdate({
        tableName,
        dialect,
        columns,
        originalRow: pretendCurrent,
        draftRow: destRow,
        keyColumns,
      });
      if ('error' in built) {
        errors.push(`restore update ${item.key}: ${built.error}`);
        continue;
      }
      plans.push({ op: 'update', keyLabel: item.key, plan: built });
      continue;
    }

    // delete → re-insert the dest row we removed
    const columns = parsed.columns;
    const values = rowToValues(columns, snapshotRowValues(columns, snap));
    const built = buildPeekInsert({
      tableName,
      dialect,
      values,
      identityColumns: undefined,
      writeIdentityGeneration: 'BY DEFAULT',
    });
    if ('error' in built) {
      errors.push(`restore delete ${item.key}: ${built.error}`);
      continue;
    }
    plans.push({ op: 'insert', keyLabel: item.key, plan: built });
  }

  return { plans, errors };
}
