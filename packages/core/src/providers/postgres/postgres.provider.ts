import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas, rolesToTableSchemas, roleSkippedWarning } from '../../cores/schema-to-tables';
import {
  ConnectionOptions,
  SchemaProvider,
  RoleLoadResult,
  DbRole,
  DbRoleMember,
  DbSchema,
  DbTable,
  DbColumn,
  DbProcedure,
  DbTrigger,
  DbSequence,
  DbUserType,
  DbPrimaryKey,
  DbForeignKey,
  DbUniqueConstraint,
  DbIndex,
  DbIndexColumn,
  DbView,
  TableSchema,
  RoutineParameter,
  RoutineParameterMode,
} from '../../interfaces';

// pg_catalog raw shapes (lower-cased column names — pg folds unquoted identifiers)
interface PgTableRaw { table_name: string; relkind: string; tablespace: string | null; definition: string | null; }
interface PgColumnRaw { table_name: string; column_name: string; ordinal: number; data_type: string; not_null: boolean; default_value: string | null; identity: string; relkind: string; collation: string | null; }
interface PgKeyRaw { table_name: string; constraint_name: string; column_name: string; col_seq: number; }
interface PgFkRaw { table_name: string; constraint_name: string; column_name: string; ref_schema: string; ref_table: string; col_seq: number; }
interface PgIndexRaw { table_name: string; index_name: string; is_primary: boolean; is_unique: boolean; column_name: string; col_seq: number; }
interface PgViewRaw { view_name: string; definition: string; }
interface PgTriggerRaw { trigger_name: string; table_name: string; tgtype: number; definition: string; }
interface PgRoutineRaw { name: string; kind: string; returns_set: boolean; definition: string | null; args: string; }
interface PgSequenceRaw { name: string; data_type: string; start_value: string; increment: string; min_value: string; max_value: string; cycle: boolean; cache_size: string; }
interface PgTypeRaw { name: string; typtype: string; source_type: string | null; }
interface PgEnumRaw { type_name: string; label: string; }

export class PostgresProvider implements SchemaProvider {
  readonly provider = 'postgres';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, 'SELECT 1');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error testing postgres connection:', error);
      throw new Error(message);
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ schema_name: string }>(
      this.provider,
      options,
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`
    );
    return rows.map((r) => r.schema_name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  /**
   * Cluster-global roles and their memberships. `pg_roles` is readable by any
   * connected user (passwords are masked), but we still degrade to a warning if
   * the catalog can't be read. Built-in `pg_*` roles are excluded.
   */
  async getRoles(options: ConnectionOptions, _schema: string): Promise<RoleLoadResult> {
    try {
      const rows = await ConnectionFactory.executeQuery<{ role_name: string; member: string | null; member_can_login: boolean | null }>(
        this.provider,
        options,
        `SELECT g.rolname AS role_name, m.rolname AS member, m.rolcanlogin AS member_can_login
         FROM pg_roles g
         LEFT JOIN pg_auth_members am ON am.roleid = g.oid
         LEFT JOIN pg_roles m ON m.oid = am.member
         WHERE g.rolname NOT LIKE 'pg\\_%'
         ORDER BY g.rolname, m.rolname`
      );
      const byRole = new Map<string, DbRoleMember[]>();
      for (const r of rows) {
        const members = byRole.get(r.role_name) ?? [];
        if (r.member) members.push({ grantee: r.member, granteeType: r.member_can_login ? 'USER' : 'ROLE' });
        byRole.set(r.role_name, members);
      }
      const roles: DbRole[] = [...byRole.entries()].map(([name, members]) => ({ name, members }));
      return { roles: rolesToTableSchemas(roles) };
    } catch (error) {
      return { roles: [], warning: roleSkippedWarning(this.provider, error) };
    }
  }

  /** Split a comma-separated argument list while respecting (), so numeric(10,2) stays intact. */
  private splitTopLevel(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /** Parse pg_get_function_arguments output into structured parameters. */
  private parseArguments(args: string): RoutineParameter[] {
    if (!args || !args.trim()) return [];
    const modes: Record<string, RoutineParameterMode> = { IN: 'IN', OUT: 'OUT', INOUT: 'INOUT', VARIADIC: 'IN' };
    return this.splitTopLevel(args).map((raw, i) => {
      let rest = raw.trim();
      let mode: RoutineParameterMode = 'IN';
      const first = rest.split(/\s+/)[0]?.toUpperCase();
      if (first && modes[first]) { mode = modes[first]; rest = rest.slice(rest.split(/\s+/)[0].length).trim(); }
      // Strip DEFAULT / '=' tail — not part of the type signature
      rest = rest.replace(/\s+DEFAULT\s+.*$/i, '').replace(/\s*=\s*.*$/, '').trim();
      const tokens = rest.split(/\s+/);
      // A lone token is an unnamed parameter (type only); otherwise first token is the name.
      const name = tokens.length > 1 ? tokens[0] : '';
      const type = tokens.length > 1 ? tokens.slice(1).join(' ') : rest;
      return { name, type, mode, ordinal: i + 1 };
    });
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const schemaName = schema || options.schema || 'public';
    // Each query runs on its own pooled connection so they parallelize safely —
    // a single pg/mysql connection can't multiplex concurrent queries. Every
    // query qualifies by schema explicitly, so no shared session state is needed.
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    {
      const [
        rawTables,
        rawColumns,
        rawPrimaryKeys,
        rawForeignKeys,
        rawUnique,
        rawIndexes,
        rawViews,
        rawTriggers,
        rawRoutines,
        rawSequences,
        rawTypes,
        rawEnums,
      ] = await Promise.all([
        exec<PgTableRaw>(
          `SELECT c.relname AS table_name, c.relkind, t.spcname AS tablespace,
                  CASE WHEN c.relkind = 'm' THEN pg_get_viewdef(c.oid, true) END AS definition
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_tablespace t ON t.oid = c.reltablespace
           WHERE n.nspname = $1 AND c.relkind IN ('r','p','m')
           ORDER BY c.relname`,
          [schemaName]
        ),
        exec<PgColumnRaw>(
          `SELECT c.relname AS table_name, a.attname AS column_name, a.attnum AS ordinal,
                  format_type(a.atttypid, a.atttypmod) AS data_type,
                  a.attnotnull AS not_null,
                  pg_get_expr(d.adbin, d.adrelid) AS default_value,
                  a.attidentity AS identity,
                  c.relkind,
                  coll.collname AS collation
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           -- attcollation = 0 for non-collatable types (int, timestamp, ...) — no join
           -- match, collation stays null. Collatable types always join (even to the
           -- pseudo-collation named "default" when no explicit COLLATE was set).
           LEFT JOIN pg_collation coll ON coll.oid = a.attcollation
           WHERE n.nspname = $1 AND a.attnum > 0 AND NOT a.attisdropped
                 AND c.relkind IN ('r','p','m','v')
           ORDER BY c.relname, a.attnum`,
          [schemaName]
        ),
        exec<PgKeyRaw>(
          `SELECT cl.relname AS table_name, con.conname AS constraint_name,
                  att.attname AS column_name, ord.n AS col_seq
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
           JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
           WHERE con.contype = 'p' AND n.nspname = $1
           ORDER BY cl.relname, ord.n`,
          [schemaName]
        ),
        exec<PgFkRaw>(
          `SELECT cl.relname AS table_name, con.conname AS constraint_name,
                  att.attname AS column_name,
                  refn.nspname AS ref_schema, refcl.relname AS ref_table,
                  ord.n AS col_seq
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
           JOIN pg_class refcl ON refcl.oid = con.confrelid
           JOIN pg_namespace refn ON refn.oid = refcl.relnamespace
           JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
           WHERE con.contype = 'f' AND n.nspname = $1
           ORDER BY cl.relname, con.conname, ord.n`,
          [schemaName]
        ),
        exec<{ table_name: string; constraint_name: string; column_name: string; col_seq: number }>(
          `SELECT cl.relname AS table_name, con.conname AS constraint_name,
                  att.attname AS column_name, ord.n AS col_seq
           FROM pg_constraint con
           JOIN pg_class cl ON cl.oid = con.conrelid
           JOIN pg_namespace n ON n.oid = cl.relnamespace
           JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(attnum, n) ON true
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.attnum
           WHERE con.contype = 'u' AND n.nspname = $1
           ORDER BY cl.relname, con.conname, ord.n`,
          [schemaName]
        ),
        exec<PgIndexRaw>(
          `SELECT t.relname AS table_name, i.relname AS index_name,
                  ix.indisprimary AS is_primary, ix.indisunique AS is_unique,
                  a.attname AS column_name, k.n AS col_seq
           FROM pg_index ix
           JOIN pg_class i ON i.oid = ix.indexrelid
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n) ON true
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
           WHERE n.nspname = $1
           ORDER BY i.relname, k.n`,
          [schemaName]
        ),
        exec<PgViewRaw>(
          `SELECT c.relname AS view_name, pg_get_viewdef(c.oid, true) AS definition
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relkind = 'v'
           ORDER BY c.relname`,
          [schemaName]
        ),
        exec<PgTriggerRaw>(
          `SELECT tg.tgname AS trigger_name, c.relname AS table_name,
                  tg.tgtype AS tgtype, pg_get_triggerdef(tg.oid) AS definition
           FROM pg_trigger tg
           JOIN pg_class c ON c.oid = tg.tgrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND NOT tg.tgisinternal
           ORDER BY c.relname, tg.tgname`,
          [schemaName]
        ),
        exec<PgRoutineRaw>(
          `SELECT p.proname AS name, p.prokind AS kind, p.proretset AS returns_set,
                  pg_get_functiondef(p.oid) AS definition,
                  pg_get_function_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = $1 AND p.prokind IN ('f','p')
                 AND EXISTS (SELECT 1 FROM pg_language l WHERE l.oid = p.prolang AND l.lanname NOT IN ('internal','c'))
           ORDER BY p.proname`,
          [schemaName]
        ).catch(() =>
          // Fallback without the language guard if the optimized form fails on a server variant
          exec<PgRoutineRaw>(
            `SELECT p.proname AS name, p.prokind AS kind, p.proretset AS returns_set,
                    NULL AS definition,
                    pg_get_function_arguments(p.oid) AS args
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.prokind IN ('f','p')
             ORDER BY p.proname`,
            [schemaName]
          )
        ),
        exec<PgSequenceRaw>(
          `SELECT c.relname AS name, format_type(s.seqtypid, NULL) AS data_type,
                  s.seqstart::text AS start_value, s.seqincrement::text AS increment,
                  s.seqmin::text AS min_value, s.seqmax::text AS max_value,
                  s.seqcycle AS cycle, s.seqcache::text AS cache_size
           FROM pg_sequence s
           JOIN pg_class c ON c.oid = s.seqrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1
           ORDER BY c.relname`,
          [schemaName]
        ),
        exec<PgTypeRaw>(
          `SELECT t.typname AS name, t.typtype AS typtype,
                  CASE WHEN t.typtype = 'd' THEN format_type(t.typbasetype, t.typtypmod) END AS source_type
           FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = $1 AND t.typtype IN ('e','d')
           ORDER BY t.typname`,
          [schemaName]
        ),
        exec<PgEnumRaw>(
          `SELECT t.typname AS type_name, e.enumlabel AS label
           FROM pg_enum e
           JOIN pg_type t ON t.oid = e.enumtypid
           JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = $1
           ORDER BY e.enumsortorder`,
          [schemaName]
        ),
      ]);

      const tables: Record<string, DbTable> = {};
      const columns: Record<string, DbColumn[]> = {};
      const functions: Record<string, DbProcedure[]> = {};
      const procedures: Record<string, DbProcedure[]> = {};
      const triggers: Record<string, DbTrigger[]> = {};
      const sequences: Record<string, DbSequence[]> = {};
      const userTypes: Record<string, DbUserType[]> = {};
      const primaryKeys: Record<string, DbPrimaryKey[]> = {};
      const foreignKeys: Record<string, DbForeignKey[]> = {};
      const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
      const indexes: Record<string, DbIndex[]> = {};
      const indexColumns: Record<string, DbIndexColumn[]> = {};
      const views: Record<string, DbView[]> = {};

      // 1. Tables (matview relkind 'm' surfaced like an MQT)
      for (const t of rawTables) {
        tables[t.table_name] = {
          name: t.table_name,
          columns: {},
          primaryKey: [],
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: [],
          tablespace: t.tablespace ?? undefined,
          isMqt: t.relkind === 'm',
          definition: t.definition ?? undefined,
        };
        columns[t.table_name] = [];
        primaryKeys[t.table_name] = [];
        foreignKeys[t.table_name] = [];
        uniqueConstraints[t.table_name] = [];
        indexes[t.table_name] = [];
      }

      // 2. Columns (also collects view columns, keyed by relation name)
      for (const col of rawColumns) {
        const mapped: DbColumn = {
          name: col.column_name,
          type: col.data_type,
          nullable: !col.not_null,
          defaultValue: col.default_value ?? undefined,
          identity: col.identity === 'a' || col.identity === 'd',
          identityGeneration: col.identity === 'a' ? 'ALWAYS' : col.identity === 'd' ? 'BY DEFAULT' : undefined,
          collation: col.collation ?? undefined,
        };
        if (tables[col.table_name]) tables[col.table_name].columns[col.column_name] = mapped;
        (columns[col.table_name] ??= []).push(mapped);
      }

      // 3. Primary keys
      for (const pk of rawPrimaryKeys) {
        if (tables[pk.table_name]) tables[pk.table_name].primaryKey.push(pk.column_name);
        (primaryKeys[pk.table_name] ??= []).push({
          name: pk.column_name,
          constName: pk.constraint_name,
          column: pk.column_name,
          colSeq: pk.col_seq,
        });
      }

      // 4. Foreign keys (grouped per constraint, columns in key order)
      const fkGroups = new Map<string, { table: string; cols: string[]; rSchema: string; rTable: string }>();
      for (const fk of rawForeignKeys) {
        const g = fkGroups.get(fk.constraint_name) ?? { table: fk.table_name, cols: [], rSchema: fk.ref_schema, rTable: fk.ref_table };
        g.cols.push(fk.column_name);
        fkGroups.set(fk.constraint_name, g);
      }
      for (const [name, info] of fkGroups) {
        const mapped: DbForeignKey = { name, columns: info.cols, referencedSchema: info.rSchema, referencedTable: info.rTable };
        if (tables[info.table]) tables[info.table].foreignKeys.push(mapped);
        (foreignKeys[info.table] ??= []).push(mapped);
      }

      // 5. Unique constraints
      const ucGroups = new Map<string, { table: string; cols: string[] }>();
      for (const uc of rawUnique) {
        const g = ucGroups.get(uc.constraint_name) ?? { table: uc.table_name, cols: [] };
        g.cols.push(uc.column_name);
        ucGroups.set(uc.constraint_name, g);
      }
      for (const [name, info] of ucGroups) {
        const mapped: DbUniqueConstraint = { name, columns: info.cols };
        if (tables[info.table]) tables[info.table].uniqueConstraints.push(mapped);
        (uniqueConstraints[info.table] ??= []).push(mapped);
      }

      // 6. Index columns + 7. indexes
      const idxCols = new Map<string, string[]>();
      const idxMeta = new Map<string, { table: string; isPrimary: boolean; isUnique: boolean }>();
      for (const ic of rawIndexes) {
        const cols = idxCols.get(ic.index_name) ?? [];
        cols.push(ic.column_name);
        idxCols.set(ic.index_name, cols);
        if (!idxMeta.has(ic.index_name)) idxMeta.set(ic.index_name, { table: ic.table_name, isPrimary: ic.is_primary, isUnique: ic.is_unique });
        (indexColumns[ic.index_name] ??= []).push({ name: ic.index_name, colName: ic.column_name, colOrder: 'A', colSeq: ic.col_seq });
      }
      for (const [indName, meta] of idxMeta) {
        const mapped: DbIndex = {
          name: indName,
          uniqueRule: meta.isPrimary ? 'P' : meta.isUnique ? 'U' : 'D',
          columns: idxCols.get(indName) ?? [],
        };
        if (tables[meta.table]) tables[meta.table].indexes.push(mapped);
        (indexes[meta.table] ??= []).push(mapped);
      }

      // Views (columns gathered above by relation name)
      for (const vw of rawViews) {
        const viewColumns: Record<string, DbColumn> = {};
        for (const c of columns[vw.view_name] ?? []) viewColumns[c.name] = c;
        (views[vw.view_name] ??= []).push({
          name: vw.view_name,
          schema: schemaName,
          definition: vw.definition,
          columns: viewColumns,
          indexes: [],
        });
      }

      // 8. Triggers — decode timing/event from the tgtype bitmask
      for (const trg of rawTriggers) {
        const tg = trg.tgtype;
        const timing = (tg & 2) ? 'BEFORE' : (tg & 64) ? 'INSTEAD OF' : 'AFTER';
        const events: string[] = [];
        if (tg & 4) events.push('INSERT');
        if (tg & 8) events.push('DELETE');
        if (tg & 16) events.push('UPDATE');
        if (tg & 32) events.push('TRUNCATE');
        (triggers[trg.trigger_name] ??= []).push({
          name: trg.trigger_name,
          schema: schemaName,
          tableName: trg.table_name,
          event: events.join(' OR ') || 'UNKNOWN',
          timing,
          definition: trg.definition,
        });
      }

      // 9. Functions & procedures
      for (const r of rawRoutines) {
        const mapped: DbProcedure = {
          name: r.name,
          schema: schemaName,
          routineType: r.kind === 'p' ? 'PROCEDURE' : 'FUNCTION',
          definition: r.definition ?? undefined,
          // 'T' marks a set-returning (table) function for the shared transform.
          functionType: r.kind === 'f' && r.returns_set ? 'T' : undefined,
          parameters: this.parseArguments(r.args),
        };
        if (r.kind === 'p') (procedures[r.name] ??= []).push(mapped);
        else (functions[r.name] ??= []).push(mapped);
      }

      // 10. Sequences
      for (const s of rawSequences) {
        (sequences[s.name] ??= []).push({
          name: s.name,
          schema: schemaName,
          dataType: s.data_type,
          startValue: s.start_value,
          increment: s.increment,
          minValue: s.min_value,
          maxValue: s.max_value,
          cycle: s.cycle,
          cache: s.cache_size ? Number(s.cache_size) : undefined,
        });
      }

      // 11. User types (enums + domains)
      const enumLabels = new Map<string, string[]>();
      for (const e of rawEnums) {
        const labels = enumLabels.get(e.type_name) ?? [];
        labels.push(e.label);
        enumLabels.set(e.type_name, labels);
      }
      for (const t of rawTypes) {
        (userTypes[t.name] ??= []).push({
          name: t.name,
          schema: schemaName,
          sourceType: t.source_type ?? undefined,
          metaType: t.typtype === 'e' ? 'E' : 'D',
          attributes: t.typtype === 'e' ? (enumLabels.get(t.name) ?? []).map((l) => ({ name: l, type: '' })) : undefined,
        });
      }

      return {
        tables, columns, functions, procedures, triggers, sequences, userTypes,
        primaryKeys, foreignKeys, uniqueConstraints, indexes, indexColumns, views,
      };
    }
  }
}
