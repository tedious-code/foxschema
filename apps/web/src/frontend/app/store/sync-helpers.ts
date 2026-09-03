import { SqlGeneratorModule, type SchemaMapping } from '@/shared/lib/sql-generator';
import { withConnectionString } from '@/shared/lib/provider-settings';
import type { SchemaCompareResult, TableDiff } from '@/shared/lib/types';
import type { ConnectionRef } from '@/shared/api/schemaApi';
import type { ConnectionConfig } from './sync-types';
import { applySelectionToDiff } from '@/shared/lib/column-selection';

/**
 * Every deploy opt-in and opt-out, passed as one object.
 *
 * These were positional parameters. Six maps of the same type in a row is a
 * silent-swap waiting to happen — the compiler cannot tell `memberSelection`
 * from `indexSelection`, and getting them the wrong way round produces a script
 * that looks plausible and deploys the wrong things.
 */
export interface DeploySelections {
  selection: Record<string, boolean>;
  memberSelection: Record<string, Record<string, boolean>>;
  indexSelection: Record<string, Record<string, boolean>>;
  columnSelection?: Record<string, Record<string, boolean>>;
  triggerSelection?: Record<string, Record<string, boolean>>;
}

// Comparison runs server-side (/api/compare); SQL generation stays client-side
// because it re-runs interactively as deploy checkboxes toggle, with no DB round-trip.
export const sqlGeneratorModule = new SqlGeneratorModule();

/**
 * A side's request payload: a saved connection (connectionId, resolved+decrypted
 * server-side) or an inline ad-hoc option. Keeps passwords off the wire for saved ones.
 */
export function buildRef(cfg: ConnectionConfig): ConnectionRef {
  if (cfg.connectionId) {
    // For a saved connection stored without its password, forward the session password
    // the user typed (kept in-memory on the config), so the server can connect with it.
    const password = cfg.option?.password || undefined;
    return { connectionId: cfg.connectionId, schema: cfg.schema, password };
  }
  return {
    dialect: cfg.dialect,
    option: withConnectionString(cfg.dialect, { ...cfg.option, schema: cfg.schema }),
    schema: cfg.schema,
  };
}

/**
 * Build the diffs to deploy from the object selection, applying per-role member
 * opt-outs (a role member explicitly set to false is dropped from the role's
 * diffs, so it won't appear in the generated GRANT/REVOKE) and per-index opt-ins
 * (an index change is only included once explicitly checked — see
 * sync-types.ts's indexSelection doc comment for why the polarity is reversed).
 *
 * Tables that are UNCHANGED in the tree (e.g. index rename-only) are still
 * included when the user opts into one or more of their index changes — the
 * generator only sees those indexes, promoted to MODIFIED for ALTER emission.
 */
export function buildIncludedDiffs(tables: TableDiff[], sel: DeploySelections): TableDiff[] {
  const { selection, memberSelection, indexSelection, columnSelection, triggerSelection } = sel;
  const hasIndexOptIn = (tableName: string) =>
    Object.values(indexSelection[tableName] ?? {}).some((v) => v === true);

  /** The index keys actually going into the script, so column rules can see them. */
  const includedIndexKeys = (tableName: string): Set<string> =>
    new Set(
      Object.entries(indexSelection[tableName] ?? {})
        .filter(([, v]) => v === true)
        .map(([k]) => k.toUpperCase())
    );

  return tables
    .filter((t) => selection[t.tableName] || hasIndexOptIn(t.tableName))
    .map((t) => {
      const idxSel = indexSelection[t.tableName] ?? {};
      const indexDiffs = t.indexDiffs.filter((i) => i.status === 'UNCHANGED' || idxSel[i.name] === true);
      const objectSelected = !!selection[t.tableName];

      if (objectSelected) {
        if (t.objectType !== 'ROLE') {
          // Column and trigger opt-outs apply to real objects; a role's
          // "columns" are its members and have their own selection below.
          //
          // `siblings` is every table in the compare, not just the selected
          // ones: a foreign key on a child names columns on the parent, and the
          // parent cannot see that from its own diff.
          return applySelectionToDiff(
            { ...t, indexDiffs },
            {
              columnSelection: columnSelection?.[t.tableName],
              triggerSelection: triggerSelection?.[t.tableName],
              includedIndexes: includedIndexKeys(t.tableName),
              siblings: tables,
            }
          );
        }
        const memberSel = memberSelection[t.tableName] ?? {};
        return {
          ...t,
          indexDiffs,
          columnDiffs: t.columnDiffs.filter((c) => memberSel[c.name] !== false),
        };
      }

      // Index-only opt-in (rename-only UNCHANGED tables, or indexes checked without
      // Deploy): emit ALTER with just the opted index changes.
      const optedIndexes = indexDiffs.filter((i) => i.status !== 'UNCHANGED');
      return {
        ...t,
        status: 'MODIFIED' as const,
        columnDiffs: t.columnDiffs.filter((c) => c.status === 'UNCHANGED'),
        foreignKeyDiffs: t.foreignKeyDiffs.filter((f) => f.status === 'UNCHANGED'),
        triggerDiffs: (t.triggerDiffs ?? []).filter((tr) => tr.status === 'UNCHANGED'),
        indexDiffs: optedIndexes,
      };
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

/** Regenerate the preview migration script for a selection + per-role member opt-outs + per-index opt-ins. */
export function regenerateSql(
  s: {
    compareResult: SchemaCompareResult | null;
    sourceConfig: ConnectionConfig;
    targetConfig: ConnectionConfig;
    nonDestructive: boolean;
  },
  sel: DeploySelections
): string {
  if (!s.compareResult) return '';
  const includedDiffs = buildIncludedDiffs(s.compareResult.tables, sel);
  return sqlGeneratorModule.generateMigrationSql(
    includedDiffs,
    s.targetConfig.dialect,
    buildMapping(s),
    s.compareResult.tables
  );
}
