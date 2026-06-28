import { ConnectionFactory } from '../../cores/connection-factory';
import { dbSchemaToTableSchemas } from '../../cores/schema-to-tables';
import {
  SchemaProvider,
  ConnectionOptions,
  DbSchema,
  DbTable,
  DbColumn,
  DbTrigger,
  DbView,
  DbForeignKey,
  DbIndex,
  TableSchema,
} from '../../interfaces';

// sqlite_master / PRAGMA result shapes
interface SqliteMasterRaw { name: string; sql: string | null; tbl_name?: string; }
interface SqliteColRaw { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number; }
interface SqliteIdxRaw { seq: number; name: string; unique: number; origin: string; partial: number; }
interface SqliteIdxColRaw { seqno: number; cid: number; name: string; }
interface SqliteFkRaw { id: number; seq: number; table: string; from: string; to: string; }

export class SqliteProvider implements SchemaProvider {
  readonly provider = 'sqlite';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    try {
      await ConnectionFactory.executeQuery(this.provider, options, `SELECT 1`);
      return true;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }

  /** SQLite has no schemas — returns the attached database names. */
  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ name: string }>(
      this.provider,
      options,
      `PRAGMA database_list`
    );
    return rows.map((r) => r.name);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    return dbSchemaToTableSchemas(dbSchema);
  }

  async loadSchema(options: ConnectionOptions, _schema: string): Promise<DbSchema> {
    // SQLite has no schema namespaces — all objects are in one flat space.
    // We run all PRAGMA queries against the single open database.
    const exec = <T>(sql: string, params: readonly unknown[] = []) =>
      ConnectionFactory.executeQuery<T>(this.provider, options, sql, params);

    const [rawTables, rawViews, rawTriggers] = await Promise.all([
      exec<SqliteMasterRaw>(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`),
      exec<SqliteMasterRaw>(`SELECT name, sql FROM sqlite_master WHERE type = 'view' ORDER BY name`),
      exec<SqliteMasterRaw>(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY tbl_name, name`),
    ]);

    const tables: Record<string, DbTable> = {};
    const columns: Record<string, DbColumn[]> = {};
    const functions: Record<string, never[]> = {}; // SQLite has no stored functions
    const procedures: Record<string, never[]> = {};
    const triggers: Record<string, DbTrigger[]> = {};
    const sequences: Record<string, never[]> = {};
    const userTypes: Record<string, never[]> = {};
    const primaryKeys: Record<string, never[]> = {};
    const foreignKeys: Record<string, DbForeignKey[]> = {};
    const uniqueConstraints: Record<string, never[]> = {};
    const indexes: Record<string, DbIndex[]> = {};
    const indexColumns: Record<string, never[]> = {};
    const views: Record<string, DbView[]> = {};

    // Per-table introspection (cannot be parallelized easily — PRAGMA takes
    // the table name inline, not as a bind parameter in all SQLite drivers)
    for (const t of rawTables) {
      // table_info — columns
      const rawCols = await exec<SqliteColRaw>(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`);
      // index_list — indexes on this table
      const rawIdxList = await exec<SqliteIdxRaw>(`PRAGMA index_list("${t.name.replace(/"/g, '""')}")`);
      // foreign_key_list — FK references
      const rawFkList = await exec<SqliteFkRaw>(`PRAGMA foreign_key_list("${t.name.replace(/"/g, '""')}")`);

      const pkCols = rawCols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);

      const colMap: Record<string, DbColumn> = {};
      const colList: DbColumn[] = [];
      for (const col of rawCols) {
        const mapped: DbColumn = {
          name: col.name,
          type: col.type || 'TEXT',
          nullable: col.notnull === 0 && col.pk === 0,
          defaultValue: col.dflt_value ?? undefined,
          identity: col.type?.toUpperCase() === 'INTEGER' && pkCols.length === 1 && col.pk === 1,
        };
        colMap[col.name] = mapped;
        colList.push(mapped);
      }

      const tableIdxs: DbIndex[] = [];
      const fkGroups = new Map<number, { table: string; froms: string[] }>();
      for (const fk of rawFkList) {
        const g = fkGroups.get(fk.id) ?? { table: fk.table, froms: [] };
        g.froms.push(fk.from);
        fkGroups.set(fk.id, g);
      }
      const fkList: DbForeignKey[] = [];
      for (const [, info] of fkGroups) {
        fkList.push({ name: `fk_${t.name}_${info.table}`, columns: info.froms, referencedSchema: '', referencedTable: info.table });
      }

      for (const ix of rawIdxList) {
        // Skip auto-created indexes for PRIMARY KEY and UNIQUE constraints (origin='pk'/'u')
        if (ix.origin === 'pk') continue;
        const rawIdxCols = await exec<SqliteIdxColRaw>(`PRAGMA index_info("${ix.name.replace(/"/g, '""')}")`);
        const ixCols = rawIdxCols.sort((a, b) => a.seqno - b.seqno).map((c) => c.name);
        tableIdxs.push({ name: ix.name, uniqueRule: ix.unique ? 'U' : 'D', columns: ixCols });
      }

      tables[t.name] = { name: t.name, columns: colMap, primaryKey: pkCols, foreignKeys: fkList, uniqueConstraints: [], indexes: tableIdxs };
      columns[t.name] = colList;
      primaryKeys[t.name] = [];
      foreignKeys[t.name] = fkList;
      indexes[t.name] = tableIdxs;
    }

    // Views
    for (const vw of rawViews) {
      const rawVwCols = await exec<SqliteColRaw>(`PRAGMA table_info("${vw.name.replace(/"/g, '""')}")`);
      const viewColumns: Record<string, DbColumn> = {};
      for (const col of rawVwCols) {
        viewColumns[col.name] = { name: col.name, type: col.type || 'TEXT', nullable: true, defaultValue: undefined };
      }
      (views[vw.name] ??= []).push({ name: vw.name, schema: '', definition: vw.sql ?? '', columns: viewColumns, indexes: [] });
    }

    // Triggers
    for (const trg of rawTriggers) {
      (triggers[trg.name] ??= []).push({ name: trg.name, schema: '', tableName: trg.tbl_name ?? '', event: '', timing: '', definition: trg.sql ?? '' });
    }

    return {
      tables, columns,
      functions: functions as Record<string, any[]>,
      procedures: procedures as Record<string, any[]>,
      triggers,
      sequences: sequences as Record<string, any[]>,
      userTypes: userTypes as Record<string, any[]>,
      primaryKeys: primaryKeys as Record<string, any[]>,
      foreignKeys,
      uniqueConstraints: uniqueConstraints as Record<string, any[]>,
      indexes,
      indexColumns: indexColumns as Record<string, any[]>,
      views,
    };
  }
}
