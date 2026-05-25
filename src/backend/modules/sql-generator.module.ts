import { TableDiff } from '../types/diff.types';

export class SqlGeneratorModule {
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
          sql += `CREATE TABLE ${obj.tableName} (\n`;
          const colDefinitions = source.columns.map((c) => {
            let def = `  ${c.name} ${c.type}`;
            if (!c.nullable) def += ` NOT NULL`;
            if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
            if (c.primaryKey) def += ` PRIMARY KEY`;
            return def;
          });
          sql += colDefinitions.join(',\n');
          sql += `\n);\n\n`;

          for (const idx of source.indices) {
            const uniqueStr = idx.unique ? ' UNIQUE' : '';
            sql += `CREATE${uniqueStr} INDEX ${idx.name} ON ${obj.tableName} (${idx.columns.join(', ')});\n`;
          }

          for (const fk of source.foreignKeys) {
            sql += `ALTER TABLE ${obj.tableName} ADD CONSTRAINT ${fk.name} \n`;
            sql += `  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${fk.referencedTable} (${fk.referencedColumns.join(', ')});\n`;
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
        } else if (obj.definition) {
          // Re-create views/funcs/procs by dropping first
          if (obj.objectType === 'VIEW') {
            sql += `DROP VIEW IF EXISTS ${obj.tableName};\n`;
          } else if (obj.objectType === 'FUNCTION') {
            sql += `DROP FUNCTION IF EXISTS ${obj.tableName};\n`;
          } else if (obj.objectType === 'PROCEDURE') {
            sql += `DROP PROCEDURE IF EXISTS ${obj.tableName};\n`;
          }
          sql += `${obj.definition}\n`;
        }
        sql += `\n`;
      }
    }

    return sql;
  }
}
