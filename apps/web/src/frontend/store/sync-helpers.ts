import { SqlGeneratorModule, type SchemaMapping } from '../lib/sql-generator';
import { withConnectionString } from '../lib/provider-settings';
import type { SchemaCompareResult, TableDiff } from '../lib/types';
import type { ConnectionRef } from '../api/schemaApi';
import type { ConnectionConfig } from './sync-types';

// Comparison runs server-side (/api/compare); SQL generation stays client-side
// because it re-runs interactively as deploy checkboxes toggle, with no DB round-trip.
export const sqlGeneratorModule = new SqlGeneratorModule();

/**
 * A side's request payload: a saved connection (connectionId, resolved+decrypted
 * server-side) or an inline ad-hoc option. Keeps passwords off the wire for saved ones.
 */
export function buildRef(cfg: ConnectionConfig): ConnectionRef {
  if (cfg.connectionId) return { connectionId: cfg.connectionId, schema: cfg.schema };
  return {
    dialect: cfg.dialect,
    option: withConnectionString(cfg.dialect, { ...cfg.option, schema: cfg.schema }),
    schema: cfg.schema,
  };
}

/**
 * Build the diffs to deploy from the object selection, applying per-role member
 * opt-outs: a role member explicitly set to false is dropped from the role's
 * diffs, so it won't appear in the generated GRANT/REVOKE.
 */
export function buildIncludedDiffs(
  tables: TableDiff[],
  selection: Record<string, boolean>,
  memberSelection: Record<string, Record<string, boolean>>
): TableDiff[] {
  return tables
    .filter((t) => selection[t.tableName])
    .map((t) => {
      if (t.objectType !== 'ROLE') return t;
      const sel = memberSelection[t.tableName] ?? {};
      return { ...t, columnDiffs: t.columnDiffs.filter((c) => sel[c.name] !== false) };
    });
}

/** The SQL-generation mapping derived from the active source/target configs. */
export function buildMapping(s: {
  sourceConfig: ConnectionConfig;
  targetConfig: ConnectionConfig;
  nonDestructive: boolean;
  targetServerVersion?: string;
}): SchemaMapping {
  return {
    sourceSchema: s.sourceConfig.schema,
    sourceDialect: s.sourceConfig.dialect,
    targetSchema: s.targetConfig.schema,
    nonDestructive: s.nonDestructive,
    targetServerVersion: s.targetServerVersion,
  };
}

/** Regenerate the preview migration script for a selection + per-role member opt-outs. */
export function regenerateSql(
  s: {
    compareResult: SchemaCompareResult | null;
    sourceConfig: ConnectionConfig;
    targetConfig: ConnectionConfig;
    nonDestructive: boolean;
  },
  selection: Record<string, boolean>,
  memberSelection: Record<string, Record<string, boolean>>
): string {
  if (!s.compareResult) return '';
  const includedDiffs = buildIncludedDiffs(s.compareResult.tables, selection, memberSelection);
  return sqlGeneratorModule.generateMigrationSql(includedDiffs, s.targetConfig.dialect, buildMapping(s));
}
