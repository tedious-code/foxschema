import { TableDiff } from '../types/diff.types';
import { TableSchema } from '../interfaces/schema.interface';

export class SqlGeneratorModule {
  /**
   * Renders the full DDL of a single object as it exists on one side,
   * used for side-by-side source/target diff display.
   */
  /** PK columns from the named constraint, falling back to per-column flags. */
  private primaryKeyColumns(table: TableSchema): string[] {
    if (table.primaryKey?.columns?.length) return table.primaryKey.columns;
    return table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  }

  private renderCreateTable(table: TableSchema): string {
    const lines = table.columns.map((c) => {
      let def = `  ${c.name} ${c.type}`;
      if (!c.nullable) def += ` NOT NULL`;
      if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
      return def;
    });

    const pkCols = this.primaryKeyColumns(table);
    if (pkCols.length > 0) {
      const constraintName = table.primaryKey?.name ? `CONSTRAINT ${table.primaryKey.name} ` : '';
      lines.push(`  ${constraintName}PRIMARY KEY (${pkCols.join(', ')})`);
    }

    return `CREATE TABLE ${table.name} (\n${lines.join(',\n')}\n);\n`;
  }

  generateObjectDdl(table: TableSchema): string {
    if (table.objectType !== 'TABLE') {
      return table.definition || `-- No definition available for ${table.objectType} ${table.name}`;
    }

    let sql = this.renderCreateTable(table);

    for (const idx of table.indices) {
      const uniqueStr = idx.unique ? ' UNIQUE' : '';
      sql += `CREATE${uniqueStr} INDEX ${idx.name} ON ${table.name} (${idx.columns.join(', ')});\n`;
    }

    for (const fk of table.foreignKeys) {
      sql += `ALTER TABLE ${table.name} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable} (${fk.referencedColumns.join(', ')});\n`;
    }

    for (const trg of table.triggers ?? []) {
      sql += trg.definition
        ? `${trg.definition.trim()}\n`
        : `-- Trigger ${trg.name} (${trg.timing ?? ''} ${trg.event ?? ''}) has no available definition\n`;
    }

    return sql;
  }

  generateMigrationSql(diffs: TableDiff[], dialect: string): string {
    const dialectUpper = dialect.toUpperCase();
    let sql = `-- =========================================================================\n`;
    sql += `-- SchemaSync Lite Generated Migration Script\n`;
    sql += `-- Dialect: ${dialectUpper}\n`;
    sql += `-- Created At: ${new Date().toISOString()}\n`;
    sql += `-- =========================================================================\n\n`;

    const added = diffs.filter((d) => d.status === 'ADDED');
    const modified = diffs.filter((d) => d.status === 'MODIFIED');
    const removed = diffs.filter((d) => d.status === 'REMOVED');

    if (added.length === 0 && modified.length === 0 && removed.length === 0) {
      return sql + `-- No schema changes detected. Target database is in sync with source.`;
    }

    // 1. Drop constraints / objects
    if (removed.length > 0) {
      sql += `-- -------------------------------------------------------------------------\n`;
      sql += `-- DROP REMOVED CONSTRAINTS & SCHEMAS\n`;
      sql += `-- -------------------------------------------------------------------------\n`;
      for (const obj of removed) {
        if (obj.objectType === 'TABLE') {
          if (obj.targetTable?.foreignKeys) {
            for (const fk of obj.targetTable.foreignKeys) {
              sql += `ALTER TABLE ${obj.tableName} DROP CONSTRAINT ${fk.name};\n`;
            }
          }
          sql += `DROP TABLE ${obj.tableName};\n`;
        } else if (obj.objectType === 'VIEW') {
          sql += `DROP VIEW ${obj.tableName};\n`;
        } else if (obj.objectType === 'FUNCTION') {
          sql += `DROP FUNCTION ${obj.tableName};\n`;
        } else if (obj.objectType === 'PROCEDURE') {
          sql += `DROP PROCEDURE ${obj.tableName};\n`;
        } else if (obj.objectType === 'TRIGGER') {
          sql += `DROP TRIGGER ${obj.tableName};\n`;
        }
      }
      sql += `\n`;
    }

    // 2. Create added objects
    if (added.length > 0) {
      sql += `-- -------------------------------------------------------------------------\n`;
      sql += `-- CREATE ADDED OBJECTS\n`;
      sql += `-- -------------------------------------------------------------------------\n`;
      for (const obj of added) {
        const source = obj.sourceTable;
        if (!source) continue;

        if (obj.objectType === 'TABLE') {
          sql += this.renderCreateTable(source);
          sql += `\n`;

          for (const idx of source.indices) {
            const uniqueStr = idx.unique ? ' UNIQUE' : '';
            sql += `CREATE${uniqueStr} INDEX ${idx.name} ON ${obj.tableName} (${idx.columns.join(', ')});\n`;
          }

          for (const fk of source.foreignKeys) {
            sql += `ALTER TABLE ${obj.tableName} ADD CONSTRAINT ${fk.name} \n`;
            sql += `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable} (${fk.referencedColumns.join(', ')});\n`;
          }

          for (const trg of source.triggers ?? []) {
            if (trg.definition) sql += `${trg.definition.trim()}\n`;
          }
        } else if (obj.definition) {
          sql += `${obj.definition}\n`;
        }
        sql += `\n`;
      }
    }

    // 3. Alter modified objects
    if (modified.length > 0) {
      sql += `-- -------------------------------------------------------------------------\n`;
      sql += `-- ALTER MODIFIED OBJECTS\n`;
      sql += `-- -------------------------------------------------------------------------\n`;
      for (const obj of modified) {
        if (obj.objectType === 'TABLE') {
          sql += `-- Modifications for Table: ${obj.tableName}\n`;
          const colsAdded = obj.columnDiffs.filter((c) => c.status === 'ADDED');
          for (const col of colsAdded) {
            if (!col.source) continue;
            let colDef = `${col.name} ${col.source.type}`;
            if (!col.source.nullable) colDef += ` NOT NULL`;
            if (col.source.defaultValue) colDef += ` DEFAULT ${col.source.defaultValue}`;

            if (dialectUpper === 'POSTGRES') {
              sql += `ALTER TABLE ${obj.tableName} ADD COLUMN ${colDef};\n`;
            } else {
              sql += `ALTER TABLE ${obj.tableName} ADD ${colDef};\n`;
            }
          }

          const colsMod = obj.columnDiffs.filter((c) => c.status === 'MODIFIED');
          for (const col of colsMod) {
            if (!col.source) continue;
            if (dialectUpper === 'POSTGRES') {
              sql += `ALTER TABLE ${obj.tableName} ALTER COLUMN ${col.name} TYPE ${col.source.type};\n`;
              if (col.source.nullable) {
                sql += `ALTER TABLE ${obj.tableName} ALTER COLUMN ${col.name} DROP NOT NULL;\n`;
              } else {
                sql += `ALTER TABLE ${obj.tableName} ALTER COLUMN ${col.name} SET NOT NULL;\n`;
              }
            } else if (dialectUpper === 'DB2') {
              sql += `ALTER TABLE ${obj.tableName} ALTER COLUMN ${col.name} SET DATA TYPE ${col.source.type};\n`;
            } else {
              sql += `ALTER TABLE ${obj.tableName} MODIFY COLUMN ${col.name} ${col.source.type};\n`;
            }
          }

          const colsRem = obj.columnDiffs.filter((c) => c.status === 'REMOVED');
          for (const col of colsRem) {
            if (dialectUpper === 'POSTGRES' || dialectUpper === 'DB2') {
              sql += `ALTER TABLE ${obj.tableName} DROP COLUMN ${col.name};\n`;
            } else {
              sql += `ALTER TABLE ${obj.tableName} DROP ${col.name};\n`;
            }
          }

          // Primary key change: drop the old constraint, add the new one
          const srcPk = obj.sourceTable ? this.primaryKeyColumns(obj.sourceTable) : [];
          const tgtPk = obj.targetTable ? this.primaryKeyColumns(obj.targetTable) : [];
          if (JSON.stringify(srcPk) !== JSON.stringify(tgtPk)) {
            if (tgtPk.length > 0) {
              if (dialectUpper === 'POSTGRES') {
                sql += `ALTER TABLE ${obj.tableName} DROP CONSTRAINT ${obj.targetTable?.primaryKey?.name ?? `${obj.tableName}_pkey`};\n`;
              } else {
                sql += `ALTER TABLE ${obj.tableName} DROP PRIMARY KEY;\n`;
              }
            }
            if (srcPk.length > 0) {
              const pkName = obj.sourceTable?.primaryKey?.name;
              const constraint = pkName ? `CONSTRAINT ${pkName} ` : '';
              sql += `ALTER TABLE ${obj.tableName} ADD ${constraint}PRIMARY KEY (${srcPk.join(', ')});\n`;
            }
          }

          const idxRem = obj.indexDiffs.filter((i) => i.status === 'REMOVED' || i.status === 'MODIFIED');
          for (const idx of idxRem) {
            sql += `DROP INDEX ${idx.name};\n`;
          }

          const idxAdd = obj.indexDiffs.filter((i) => i.status === 'ADDED' || i.status === 'MODIFIED');
          for (const idx of idxAdd) {
            const srcIdx = idx.source;
            if (!srcIdx) continue;
            const uniqueStr = srcIdx.unique ? ' UNIQUE' : '';
            sql += `CREATE${uniqueStr} INDEX ${idx.name} ON ${obj.tableName} (${srcIdx.columns.join(', ')});\n`;
          }

          // Triggers: drop removed/changed, recreate added/changed from source
          const trgDrop = (obj.triggerDiffs ?? []).filter((t) => t.status === 'REMOVED' || t.status === 'MODIFIED');
          for (const trg of trgDrop) {
            sql += `DROP TRIGGER ${trg.name};\n`;
          }
          const trgCreate = (obj.triggerDiffs ?? []).filter((t) => t.status === 'ADDED' || t.status === 'MODIFIED');
          for (const trg of trgCreate) {
            if (trg.source?.definition) sql += `${trg.source.definition.trim()}\n`;
          }
        } else if (obj.definition) {
          // Re-create views/funcs/procs by dropping first
          if (obj.objectType === 'VIEW') {
            sql += `DROP VIEW IF EXISTS ${obj.tableName};\n`;
          } else if (obj.objectType === 'FUNCTION') {
            sql += `DROP FUNCTION IF EXISTS ${obj.tableName};\n`;
          } else if (obj.objectType === 'PROCEDURE') {
            sql += `DROP PROCEDURE IF EXISTS ${obj.tableName};\n`;
          } else if (obj.objectType === 'TRIGGER') {
            sql += `DROP TRIGGER IF EXISTS ${obj.tableName};\n`;
          }
          sql += `${obj.definition}\n`;
        }
        sql += `\n`;
      }
    }

    return sql;
  }
}
