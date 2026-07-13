import { ConnectionModule, MigrationModule } from '@foxschema/core';
import { CompareModule, SqlGeneratorModule, type ConnectionOptions, type DbObjectType, type TableSchema, type TableDiff } from '@foxschema/core';

// Shared engine singletons — the same modules the web/desktop apps use.
export const connectionModule = new ConnectionModule();
export const compareModule = new CompareModule();
export const sqlGenerator = new SqlGeneratorModule();
export const migrationModule = new MigrationModule();

/** Load a schema's objects, optionally narrowed to a set of object types. */
export async function loadScopedTables(
  dialect: string,
  option: ConnectionOptions,
  schema: string,
  scope?: DbObjectType[]
): Promise<TableSchema[]> {
  const provider = connectionModule.getProvider(dialect);
  if (!provider.getTables) {
    throw new Error(`The "${dialect}" provider can't list objects.`);
  }
  const tables = await provider.getTables(option, schema);
  return scope && scope.length ? tables.filter((t) => scope.includes(t.objectType)) : tables;
}

const SCOPE_ALIASES: Record<string, DbObjectType> = {
  table: 'TABLE', tables: 'TABLE',
  mqt: 'MQT', mqts: 'MQT',
  view: 'VIEW', views: 'VIEW',
  function: 'FUNCTION', functions: 'FUNCTION', func: 'FUNCTION',
  procedure: 'PROCEDURE', procedures: 'PROCEDURE', proc: 'PROCEDURE',
  trigger: 'TRIGGER', triggers: 'TRIGGER',
  sequence: 'SEQUENCE', sequences: 'SEQUENCE', seq: 'SEQUENCE',
  type: 'TYPE', types: 'TYPE',
  role: 'ROLE', roles: 'ROLE',
};

/**
 * Index changes are opt-IN for migration/DDL generation (`--include-indexes`,
 * off by default) — the CLI equivalent of the web app's per-index "deploy"
 * checkboxes, which also default to excluded. UNCHANGED entries are harmless
 * (no SQL either way) and kept so they don't skew counts.
 */
export function filterIndexDiffs(tables: TableDiff[], includeIndexes: boolean): TableDiff[] {
  if (includeIndexes) return tables;
  return tables.map((t) => ({ ...t, indexDiffs: t.indexDiffs.filter((i) => i.status === 'UNCHANGED') }));
}

/** Parse `--scope tables,views,roles` into DbObjectType[] (empty = all). */
export function parseScope(scope?: string): DbObjectType[] {
  if (!scope) return [];
  return scope
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      const t = SCOPE_ALIASES[s];
      if (!t) throw new Error(`Unknown object type "${s}" in --scope. Try: tables,mqts,views,functions,procedures,triggers,sequences,types,roles.`);
      return t;
    });
}
