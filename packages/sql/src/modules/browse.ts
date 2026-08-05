import type { SchemaCompareResult, TableDiff } from '../interfaces';
import type { TableSchema } from '../interfaces';

/**
 * Build a "browse" result from a single loaded schema — no comparison. Every
 * object becomes an UNCHANGED TableDiff with its columns/indexes/foreign keys/
 * triggers populated, so the existing tree, search, and detail UI (all driven by
 * SchemaCompareResult) work unchanged when the user just wants to inspect/search
 * one database. The chosen `side` decides whether each object's data lands on the
 * source or target slot of the diff (both are scanned by search, so either works).
 */
export function buildBrowseResult(tables: TableSchema[], side: 'source' | 'target'): SchemaCompareResult {
  const isSource = side === 'source';

  const tableDiffs: TableDiff[] = tables.map((t) => {
    const columnDiffs = t.columns.map((c) => ({
      name: c.name,
      status: 'UNCHANGED' as const,
      ...(isSource ? { source: c } : { target: c }),
    }));
    const indexDiffs = t.indices.map((i) => ({
      name: i.name,
      status: 'UNCHANGED' as const,
      ...(isSource ? { source: i } : { target: i }),
    }));
    const foreignKeyDiffs = t.foreignKeys.map((f) => ({
      name: f.name,
      status: 'UNCHANGED' as const,
      ...(isSource ? { source: f } : { target: f }),
    }));
    const triggerDiffs = (t.triggers ?? []).map((tr) => ({
      name: tr.name,
      status: 'UNCHANGED' as const,
      ...(isSource ? { source: tr } : { target: tr }),
    }));

    return {
      tableName: t.name,
      objectType: t.objectType,
      status: 'UNCHANGED' as const,
      definition: t.definition,
      columnDiffs,
      indexDiffs,
      foreignKeyDiffs,
      triggerDiffs,
      ...(isSource ? { sourceTable: t } : { targetTable: t }),
    };
  });

  return {
    tables: tableDiffs.sort((a, b) => a.tableName.localeCompare(b.tableName)),
    summary: { added: 0, removed: 0, modified: 0, unchanged: tableDiffs.length },
  };
}
