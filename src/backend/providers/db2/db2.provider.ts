import { ConnectionFactory } from "../../cores/connection-factory";
import { ConnectionOptions, SchemaProvider } from "../../interfaces/schema-provider.interface";

import {
  DbProcedure,
  DbSchema,
  DbSequence,
  DbTrigger,
  DbTable,
  DbColumn,
  DbPrimaryKey,
  DbForeignKey,
  DbUniqueConstraint,
  DbIndex,
  DbIndexColumn,
  DbView,
  TableSchema,
} from "../../interfaces/schema.interface";
import { 
  Db2TableRaw,
  Db2ColumnRaw,
  Db2PrimaryKeyRaw,
  Db2ForeignKeyRaw,
  Db2UniqueConstraintRaw,
  Db2IndexRaw,
  Db2IndexColumnRaw,
  Db2ViewRaw,
  Db2TriggerRaw,
  Db2ProcedureRaw,
  Db2SequenceRaw 
} from "./db2.interface";

export class Db2Provider implements SchemaProvider {
  readonly provider = 'db2';

  async testConnection(options: ConnectionOptions): Promise<boolean> {
    let connection: any;

    try {
      connection = await ConnectionFactory.create(this.provider, options);
      const sql = `SELECT 1 FROM SYSIBM.SYSDUMMY1;`;

      await new Promise<void>((resolve, reject) => {
        connection.query(sql, [], (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error testing DB2 connection:', error);
      throw new Error(message);
    } finally {
      await ConnectionFactory.close(this.provider, connection);
    }
  }

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ SCHEMANAME: string }>(
      this.provider,
      options,
      `SELECT TRIM(SCHEMANAME) AS SCHEMANAME
       FROM SYSCAT.SCHEMATA
       WHERE SCHEMANAME NOT LIKE 'SYS%' AND SCHEMANAME NOT IN ('NULLID', 'SQLJ')
       ORDER BY SCHEMANAME`
    );
    return rows.map((r) => r.SCHEMANAME);
  }

  async getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]> {
    const dbSchema = await this.loadSchema(options, schema);
    const result: TableSchema[] = [];

    for (const table of Object.values(dbSchema.tables)) {
      const pkSet = new Set(table.primaryKey);
      result.push({
        name: table.name,
        objectType: 'TABLE',
        columns: Object.values(table.columns).map((c) => ({
          name: c.name,
          type: this.formatType(c),
          nullable: c.nullable,
          defaultValue: c.defaultValue,
          primaryKey: pkSet.has(c.name),
        })),
        // The 'P' index backs the primary key constraint — not a standalone index
        indices: table.indexes
          .filter((i) => i.uniqueRule !== 'P')
          .map((i) => ({ name: i.name, columns: i.columns, unique: i.uniqueRule !== 'D' })),
        foreignKeys: table.foreignKeys.map((fk) => ({
          name: fk.name,
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          // DB2 FKs reference the parent's PK/unique key; PK columns cover the common case
          referencedColumns: dbSchema.tables[fk.referencedTable]?.primaryKey ?? [],
        })),
      });
    }

    for (const viewList of Object.values(dbSchema.views)) {
      for (const v of viewList) {
        result.push({ name: v.name, objectType: 'VIEW', definition: v.definition, columns: [], indices: [], foreignKeys: [] });
      }
    }
    for (const list of Object.values(dbSchema.functions)) {
      for (const f of list) {
        result.push({ name: f.name, objectType: 'FUNCTION', definition: f.definition, columns: [], indices: [], foreignKeys: [] });
      }
    }
    for (const list of Object.values(dbSchema.procedures)) {
      for (const p of list) {
        result.push({ name: p.name, objectType: 'PROCEDURE', definition: p.definition, columns: [], indices: [], foreignKeys: [] });
      }
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  private formatType(c: DbColumn): string {
    const type = c.type.trim().toUpperCase();
    if ((type === 'DECIMAL' || type === 'NUMERIC') && c.length) {
      return `${type}(${c.length},${c.scale ?? 0})`;
    }
    if (['CHARACTER', 'CHAR', 'VARCHAR', 'GRAPHIC', 'VARGRAPHIC', 'CLOB', 'BLOB', 'DBCLOB', 'BINARY', 'VARBINARY'].includes(type) && c.length) {
      return `${type}(${c.length})`;
    }
    return type;
  }

  async loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
    const schemaName = schema.toUpperCase();
    const conn = await ConnectionFactory.create(this.provider, options);

    try {
      const [
        rawTables,
        rawColumns,
        rawPrimaryKeys,
        rawForeignKeys,
        rawUniqueConstraints,
        rawIndexes,
        rawIndexColumns,
        rawViews,
        rawTriggers,
        rawProcedures,
        rawSequences
      ] = await Promise.all([
        ConnectionFactory.executeOnConnection<Db2TableRaw>(
          this.provider, conn,
          `SELECT TABSCHEMA, TABNAME FROM SYSCAT.TABLES WHERE TABSCHEMA = ? AND TYPE = 'T' ORDER BY TABNAME`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2ColumnRaw>(
          this.provider, conn,
          `SELECT TABNAME, COLNAME, COLNO, TYPENAME, LENGTH, SCALE, NULLS, DEFAULT FROM SYSCAT.COLUMNS WHERE TABSCHEMA = ? ORDER BY TABNAME, COLNO`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2PrimaryKeyRaw>(
          this.provider, conn,
          `SELECT TC.TABNAME, TC.CONSTNAME, K.COLNAME, K.COLSEQ 
           FROM SYSCAT.TABCONST TC 
           JOIN SYSCAT.KEYCOLUSE K ON TC.CONSTNAME = K.CONSTNAME AND TC.TABSCHEMA = K.TABSCHEMA 
           WHERE TC.TYPE = 'P' AND TC.TABSCHEMA = ? 
           ORDER BY TC.TABNAME, K.COLSEQ`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2ForeignKeyRaw>(
          this.provider, conn,
          `SELECT R.TABNAME, R.CONSTNAME, K.COLNAME, R.REFTABSCHEMA, R.REFTABNAME 
           FROM SYSCAT.REFERENCES R 
           JOIN SYSCAT.KEYCOLUSE K ON R.CONSTNAME = K.CONSTNAME AND R.TABSCHEMA = K.TABSCHEMA 
           WHERE R.TABSCHEMA = ? 
           ORDER BY R.TABNAME`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2UniqueConstraintRaw>(
          this.provider, conn,
          `SELECT TABNAME, CONSTNAME FROM SYSCAT.TABCONST WHERE TYPE = 'U' AND TABSCHEMA = ?`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2IndexRaw>(
          this.provider, conn,
          `SELECT INDSCHEMA, INDNAME, TABNAME, UNIQUERULE FROM SYSCAT.INDEXES WHERE TABSCHEMA = ? ORDER BY TABNAME`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2IndexColumnRaw>(
          this.provider, conn,
          `SELECT IC.INDNAME, IC.COLNAME, IC.COLORDER, IC.COLSEQ 
           FROM SYSCAT.INDEXCOLUSE IC
           JOIN SYSCAT.INDEXES I ON IC.INDNAME = I.INDNAME AND IC.INDSCHEMA = I.INDSCHEMA
           WHERE I.TABSCHEMA = ? 
           ORDER BY IC.INDNAME, IC.COLSEQ`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2ViewRaw>(
          this.provider, conn,
          `SELECT VIEWSCHEMA, VIEWNAME, TEXT FROM SYSCAT.VIEWS WHERE VIEWSCHEMA = ?`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2TriggerRaw>(
          this.provider, conn,
          `SELECT TRIGSCHEMA, TRIGNAME, TABNAME, TEXT FROM SYSCAT.TRIGGERS WHERE TRIGSCHEMA = ?`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2ProcedureRaw>(
          this.provider, conn,
          `SELECT ROUTINESCHEMA, ROUTINENAME, ROUTINETYPE, TEXT FROM SYSCAT.ROUTINES WHERE ROUTINESCHEMA = ?`,
          [schemaName]
        ),
        ConnectionFactory.executeOnConnection<Db2SequenceRaw>(
          this.provider, conn,
          `SELECT SEQSCHEMA, SEQNAME FROM SYSCAT.SEQUENCES WHERE SEQSCHEMA = ?`,
          [schemaName]
        )
      ]);

      // Initialize the target schema properties as arrays matching Record<string, T[]>
      const tables: Record<string, DbTable> = {};
      const columns: Record<string, DbColumn[]> = {};
      const functions: Record<string, DbProcedure[]> = {};
      const procedures: Record<string, DbProcedure[]> = {};
      const triggers: Record<string, DbTrigger[]> = {};
      const sequences: Record<string, DbSequence[]> = {};
      const primaryKeys: Record<string, DbPrimaryKey[]> = {};
      const foreignKeys: Record<string, DbForeignKey[]> = {};
      const uniqueConstraints: Record<string, DbUniqueConstraint[]> = {};
      const indexes: Record<string, DbIndex[]> = {};
      const indexColumns: Record<string, DbIndexColumn[]> = {};
      const views: Record<string, DbView[]> = {};
      // 1. Initialize Tables Map
      for (const t of rawTables) {
        tables[t.TABNAME] = {
          name: t.TABNAME,
          columns: {},
          primaryKey: [],
          foreignKeys: [],
          uniqueConstraints: [],
          indexes: []
        };
        // Setup initial container keys for the root lists
        columns[t.TABNAME] = [];
        primaryKeys[t.TABNAME] = [];
        foreignKeys[t.TABNAME] = [];
        uniqueConstraints[t.TABNAME] = [];
        indexes[t.TABNAME] = [];
      }

      // 2. Process Columns
      for (const col of rawColumns) {
        const mappedColumn: DbColumn = {
          name: col.COLNAME,
          type: col.TYPENAME,
          length: col.LENGTH,
          scale: col.SCALE,
          nullable: col.NULLS === 'Y',
          defaultValue: col.DEFAULT ?? undefined
        };

        if (tables[col.TABNAME]) {
          tables[col.TABNAME].columns[col.COLNAME] = mappedColumn;
        }
        if (!columns[col.TABNAME]) columns[col.TABNAME] = [];
        columns[col.TABNAME].push(mappedColumn);
      }

      // 3. Process Primary Keys
      for (const pk of rawPrimaryKeys) {
        const mappedPk: DbPrimaryKey = {
          name: pk.COLNAME,
          constName: pk.CONSTNAME,
          column: pk.COLNAME,
          colSeq: pk.COLSEQ
        };

        if (tables[pk.TABNAME]) {
          tables[pk.TABNAME].primaryKey.push(pk.COLNAME);
        }
        if (!primaryKeys[pk.TABNAME]) primaryKeys[pk.TABNAME] = [];
        primaryKeys[pk.TABNAME].push(mappedPk);
      }

      // 4. Process Foreign Keys
      const tempFkGroups = new Map<string, { table: string; cols: string[]; rSchema: string; rTable: string }>();
      for (const fk of rawForeignKeys) {
        if (!tempFkGroups.has(fk.CONSTNAME)) {
          tempFkGroups.set(fk.CONSTNAME, {
            table: fk.TABNAME,
            cols: [],
            rSchema: fk.REFTABSCHEMA,
            rTable: fk.REFTABNAME
          });
        }
        tempFkGroups.get(fk.CONSTNAME)!.cols.push(fk.COLNAME);
      }

      for (const [constName, info] of tempFkGroups.entries()) {
        const mappedFk: DbForeignKey = {
          name: constName,
          columns: info.cols,
          referencedSchema: info.rSchema,
          referencedTable: info.rTable
        };

        if (tables[info.table]) {
          tables[info.table].foreignKeys.push(mappedFk);
        }
        if (!foreignKeys[info.table]) foreignKeys[info.table] = [];
        foreignKeys[info.table].push(mappedFk);
      }

      // 5. Process Unique Constraints
      for (const uc of rawUniqueConstraints) {
        const mappedUc: DbUniqueConstraint = {
          name: uc.CONSTNAME,
          columns: []
        };

        if (tables[uc.TABNAME]) {
          tables[uc.TABNAME].uniqueConstraints.push(mappedUc);
        }
        if (!uniqueConstraints[uc.TABNAME]) uniqueConstraints[uc.TABNAME] = [];
        uniqueConstraints[uc.TABNAME].push(mappedUc);
      }

      // 6. Process Index Columns
      for (const col of rawIndexColumns) {
        if (!indexColumns[col.INDNAME]) indexColumns[col.INDNAME] = [];
        indexColumns[col.INDNAME].push({
          name: col.INDNAME,
          colName: col.COLNAME,
          colOrder: col.COLORDER,
          colSeq: col.COLSEQ
        });
      }

      // 7. Process Indexes
      for (const idx of rawIndexes) {
        const relatedCols = indexColumns[idx.INDNAME]?.map(c => c.colName) || [];
        const mappedIdx: DbIndex = {
          name: idx.INDNAME,
          uniqueRule: idx.UNIQUERULE,
          columns: relatedCols
        };

        if (tables[idx.TABNAME]) {
          tables[idx.TABNAME].indexes.push(mappedIdx);
        }
        if (!indexes[idx.TABNAME]) indexes[idx.TABNAME] = [];
        indexes[idx.TABNAME].push(mappedIdx);
      }
      for (const vw of rawViews) {     
        const mappedView: DbView = {
          name: vw.VIEWNAME,
          schema: vw.VIEWSCHEMA,
          definition: vw.TEXT,
          columns: {},
          indexes: []
        };
        if (!views[vw.VIEWNAME]) views[vw.VIEWNAME] = [];
        views[vw.VIEWNAME].push(mappedView);
      }

      // 8. Process Triggers
      for (const trg of rawTriggers) {
        const mappedTrigger: DbTrigger = {
          name: trg.TRIGNAME,
          schema: trg.TRIGSCHEMA,
          tableName: trg.TABNAME,
          event: 'UNKNOWN',
          timing: 'UNKNOWN',
          definition: trg.TEXT
        };
        if (!triggers[trg.TRIGNAME]) triggers[trg.TRIGNAME] = [];
        triggers[trg.TRIGNAME].push(mappedTrigger);
      }

      // 9. Process Procedures & Functions
      for (const proc of rawProcedures) {
        const mappedRoutine: DbProcedure = {
          name: proc.ROUTINENAME,
          schema: proc.ROUTINESCHEMA,
          routineType: proc.ROUTINETYPE === 'P' ? 'PROCEDURE' : 'FUNCTION',
          definition: proc.TEXT ?? undefined
        };

        if (proc.ROUTINETYPE === 'P') {
          if (!procedures[proc.ROUTINENAME]) procedures[proc.ROUTINENAME] = [];
          procedures[proc.ROUTINENAME].push(mappedRoutine);
        } else {
          if (!functions[proc.ROUTINENAME]) functions[proc.ROUTINENAME] = [];
          functions[proc.ROUTINENAME].push(mappedRoutine);
        }
      }

      // 10. Process Sequences
      for (const seq of rawSequences) {
        const mappedSeq: DbSequence = {
          name: seq.SEQNAME,
          schema: seq.SEQSCHEMA
        };

        if (!sequences[seq.SEQNAME]) sequences[seq.SEQNAME] = [];
        sequences[seq.SEQNAME].push(mappedSeq);
      }

      return {
        tables,
        columns,
        functions,
        procedures,
        triggers,
        sequences,
        primaryKeys,
        foreignKeys,
        uniqueConstraints,
        indexes,
        indexColumns,
        views
      };

    } finally {
      await ConnectionFactory.close(this.provider, conn);
    }
  }
}