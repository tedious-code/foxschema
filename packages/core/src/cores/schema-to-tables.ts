import { DbSchema, DbTable, TableSchema, DbRole, DbRoleMember } from '../interfaces';

/**
 * Map roles into the `TableSchema` shape the compare engine consumes. Members
 * are modeled as "columns" (name = grantee, type = USER/GROUP/ROLE) so a member
 * being added/removed surfaces the role as MODIFIED — mirrors the DB2 provider.
 */
export function rolesToTableSchemas(roles: DbRole[]): TableSchema[] {
  return roles.map((role) => ({
    name: role.name,
    objectType: 'ROLE' as const,
    columns: role.members.map((m) => ({ name: m.grantee, type: m.granteeType, nullable: true, primaryKey: false })),
    indices: [],
    foreignKeys: [],
  }));
}

/** Fold flat (role, member) rows into DbRole[], preserving roles with no members. */
export function groupRoleRows(
  rows: { role_name: string; member: string | null }[],
  memberType = 'USER'
): DbRole[] {
  const byRole = new Map<string, DbRoleMember[]>();
  for (const r of rows) {
    const members = byRole.get(r.role_name) ?? [];
    if (r.member) members.push({ grantee: r.member, granteeType: memberType });
    byRole.set(r.role_name, members);
  }
  return [...byRole.entries()].map(([name, members]) => ({ name, members }));
}

/** Client-facing notice when a provider can't read roles (usually a privilege issue). */
export function roleSkippedWarning(dialect: string, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return `Roles could not be read for ${dialect} — the connected user may lack privileges on the role catalog. (${msg})`;
}

/**
 * Convert the internal `DbSchema` (the rich, catalog-shaped model each provider
 * builds in `loadSchema`) into the flat `TableSchema[]` the compare engine and
 * blueprint consume. Mirrors the DB2 provider's `getTables` transform but is
 * dialect-agnostic: column types must already be formatted into `DbColumn.type`
 * and index `uniqueRule` must use the shared codes `'P'` (primary), `'U'`
 * (unique), `'D'` (duplicates / non-unique).
 *
 * DB2 keeps its own copy (it adds MQT + roles); Postgres and MySQL share this.
 */
export function dbSchemaToTableSchemas(dbSchema: DbSchema): TableSchema[] {
  const result: TableSchema[] = [];

  // Triggers belong to their table; group them by owning table name.
  const triggersByTable = new Map<string, { name: string; timing?: string; event?: string; definition?: string }[]>();
  for (const list of Object.values(dbSchema.triggers)) {
    for (const t of list) {
      const owned = triggersByTable.get(t.tableName) ?? [];
      owned.push({ name: t.name, timing: t.timing, event: t.event, definition: t.definition });
      triggersByTable.set(t.tableName, owned);
    }
  }

  // PK columns from the table model, falling back to the primary ('P') index.
  const pkColumnsOf = (table?: DbTable): string[] => {
    if (!table) return [];
    if (table.primaryKey.length > 0) return table.primaryKey;
    return table.indexes.find((i) => i.uniqueRule === 'P')?.columns ?? [];
  };

  for (const table of Object.values(dbSchema.tables)) {
    const pkColumns = pkColumnsOf(table);
    const pkSet = new Set(pkColumns);
    result.push({
      name: table.name,
      objectType: table.isMqt ? 'MQT' : 'TABLE',
      tablespace: table.tablespace,
      triggers: triggersByTable.get(table.name) ?? [],
      primaryKey: pkColumns.length > 0
        ? { name: dbSchema.primaryKeys[table.name]?.[0]?.constName, columns: pkColumns }
        : undefined,
      columns: Object.values(table.columns).map((c) => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        defaultValue: c.defaultValue,
        primaryKey: pkSet.has(c.name),
        identity: c.identity,
        identityGeneration: c.identityGeneration,
      })),
      // The primary ('P') index backs the PK constraint — not a standalone index.
      indices: table.indexes
        .filter((i) => i.uniqueRule !== 'P')
        .map((i) => ({ name: i.name, columns: i.columns, unique: i.uniqueRule !== 'D' })),
      foreignKeys: table.foreignKeys.map((fk) => ({
        name: fk.name,
        columns: fk.columns,
        referencedTable: fk.referencedTable,
        // FKs reference the parent's PK/unique key; PK columns cover the common case.
        referencedColumns: pkColumnsOf(dbSchema.tables[fk.referencedTable]),
      })),
    });
  }

  for (const viewList of Object.values(dbSchema.views)) {
    for (const v of viewList) {
      result.push({
        name: v.name,
        objectType: 'VIEW',
        definition: v.definition,
        columns: Object.values(v.columns).map((c) => ({
          name: c.name,
          type: c.type,
          nullable: c.nullable,
          defaultValue: c.defaultValue,
          primaryKey: false,
          identity: c.identity,
          identityGeneration: c.identityGeneration,
        })),
        indices: [],
        foreignKeys: [],
      });
    }
  }

  for (const list of Object.values(dbSchema.functions)) {
    for (const f of list) {
      result.push({
        name: f.name,
        objectType: 'FUNCTION',
        definition: f.definition,
        columns: [],
        indices: [],
        foreignKeys: [],
        parameters: f.parameters ?? [],
        functionKind: f.functionType === 'T' ? 'table' : 'scalar',
      });
    }
  }

  for (const list of Object.values(dbSchema.procedures)) {
    for (const p of list) {
      result.push({
        name: p.name,
        objectType: 'PROCEDURE',
        definition: p.definition,
        columns: [],
        indices: [],
        foreignKeys: [],
        parameters: p.parameters ?? [],
      });
    }
  }

  for (const list of Object.values(dbSchema.sequences)) {
    for (const s of list) {
      result.push({
        name: s.name,
        objectType: 'SEQUENCE',
        columns: [], indices: [], foreignKeys: [],
        sequence: {
          dataType: s.dataType,
          start: s.startValue,
          increment: s.increment,
          minValue: s.minValue,
          maxValue: s.maxValue,
          cycle: s.cycle,
          cache: s.cache,
        },
      });
    }
  }

  for (const list of Object.values(dbSchema.userTypes)) {
    for (const u of list) {
      result.push({
        name: u.name,
        objectType: 'TYPE',
        columns: [], indices: [], foreignKeys: [],
        userType: { sourceType: u.sourceType, metaType: u.metaType, attributes: u.attributes },
      });
    }
  }

  // Triggers whose owning table is outside this schema remain standalone objects.
  for (const list of Object.values(dbSchema.triggers)) {
    for (const t of list) {
      if (!dbSchema.tables[t.tableName]) {
        result.push({ name: t.name, objectType: 'TRIGGER', definition: t.definition, columns: [], indices: [], foreignKeys: [] });
      }
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}
