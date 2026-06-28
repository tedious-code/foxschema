import { TableDiff } from '../interfaces';
import { TableSchema, DbObjectType } from '../interfaces';
import type { SqlDialect, ColumnSpec } from './sql-dialect.interface';
import { db2SqlDialect } from '../providers/db2/db2.sql-dialect';
import { postgresSqlDialect } from '../providers/postgres/postgres.sql-dialect';
import { mysqlSqlDialect, mariadbSqlDialect } from '../providers/mysql/mysql.sql-dialect';
import { sqlServerSqlDialect } from '../providers/sqlServer/sqlserver.sql-dialect';
import { oracleSqlDialect } from '../providers/oracle/oracle.sql-dialect';
import { sqliteSqlDialect } from '../providers/sqlLite/sqlite.sql-dialect';

export interface MigrationStep {
  objectName: string;
  objectType: DbObjectType;
  action: 'DROP' | 'CREATE' | 'ALTER';
  /** Individual executable statements, in order. Trailing semicolons are display-only. */
  statements: string[];
}

export interface SchemaMapping {
  /** Schema the objects were read from (e.g. MY). */
  sourceSchema?: string;
  /** Schema the migration deploys into (e.g. HUY). */
  targetSchema?: string;
}

const DIALECT_MAP: Record<string, SqlDialect> = {
  DB2: db2SqlDialect,
  POSTGRES: postgresSqlDialect,
  MYSQL: mysqlSqlDialect,
  MARIADB: mariadbSqlDialect,
  SQLSERVER: sqlServerSqlDialect,
  ORACLE: oracleSqlDialect,
  SQLITE: sqliteSqlDialect,
};

function resolveDialect(dialect: string): SqlDialect {
  return DIALECT_MAP[dialect.toUpperCase()] ?? db2SqlDialect;
}

export class SqlGeneratorModule {
  /**
   * Source catalog definitions qualify names with the source schema (HUY.GPX_FILE);
   * deploying into a different schema requires rewriting those qualifiers.
   */
  private remapSchema(statement: string, mapping?: SchemaMapping): string {
    const src = mapping?.sourceSchema?.trim();
    const tgt = mapping?.targetSchema?.trim();
    if (!src || !tgt || src.toUpperCase() === tgt.toUpperCase()) return statement;

    const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return statement
      .replace(new RegExp(`"${escaped}"\\.`, 'gi'), `"${tgt}".`)
      .replace(new RegExp(`\\b${escaped}\\.`, 'gi'), `${tgt}.`);
  }

  /** Drops any leading "schema." prefix from an object name. */
  private bareName(name: string): string {
    return name.replace(/^"?[^".]+"?\./, '');
  }

  /**
   * Re-qualifies an object's own name to the target schema: strips whatever
   * schema it was read under (often the connection user's, e.g. HUY) and
   * prefixes the chosen target schema so DDL never lands in the wrong place.
   */
  private qualify(name: string, mapping?: SchemaMapping): string {
    const bare = this.bareName(name);
    const tgt = mapping?.targetSchema?.trim();
    return tgt ? `${tgt}.${bare}` : bare;
  }

  /** PK columns from the named constraint, falling back to per-column flags. */
  private primaryKeyColumns(table: TableSchema): string[] {
    if (table.primaryKey?.columns?.length) return table.primaryKey.columns;
    return table.columns.filter((c) => c.primaryKey).map((c) => c.name);
  }

  private renderColumn(c: ColumnSpec & { name: string }, dialect: SqlDialect): string {
    let def = `${c.name} ${c.type}`;
    def += dialect.identityClause(c);
    if (!c.nullable) def += ` NOT NULL`;
    if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
    return def;
  }

  private renderCreateTable(table: TableSchema, dialect: SqlDialect, mapping?: SchemaMapping): string {
    const lines = table.columns.map((c) => `  ${this.renderColumn(c, dialect)}`);

    const pkCols = this.primaryKeyColumns(table);
    if (pkCols.length > 0) {
      const constraintName = table.primaryKey?.name ? `CONSTRAINT ${this.bareName(table.primaryKey.name)} ` : '';
      lines.push(`  ${constraintName}PRIMARY KEY (${pkCols.join(', ')})`);
    }

    return `CREATE TABLE ${this.qualify(table.name, mapping)} (\n${lines.join(',\n')}\n);`;
  }

  private renderCreateSequence(table: TableSchema): string {
    const s = table.sequence ?? {};
    let sql = `CREATE SEQUENCE ${table.name}`;
    if (s.dataType) sql += ` AS ${s.dataType}`;
    if (s.start !== undefined) sql += ` START WITH ${s.start}`;
    if (s.increment !== undefined) sql += ` INCREMENT BY ${s.increment}`;
    if (s.minValue !== undefined) sql += ` MINVALUE ${s.minValue}`;
    if (s.maxValue !== undefined) sql += ` MAXVALUE ${s.maxValue}`;
    sql += s.cycle ? ` CYCLE` : ` NO CYCLE`;
    if (s.cache !== undefined) sql += s.cache > 0 ? ` CACHE ${s.cache}` : ` NO CACHE`;
    return sql + `;`;
  }

  private renderCreateType(table: TableSchema): string {
    const u = table.userType ?? {};
    if (u.attributes && u.attributes.length > 0) {
      const attrs = u.attributes.map((a) => `  ${a.name} ${a.type}`).join(',\n');
      return `CREATE TYPE ${table.name} AS (\n${attrs}\n) MODE DB2SQL;`;
    }
    return `CREATE TYPE ${table.name} AS ${u.sourceType ?? 'VARCHAR(255)'} WITH COMPARISONS;`;
  }

  generateObjectDdl(table: TableSchema, dialectStr = 'db2'): string {
    const dialect = resolveDialect(dialectStr);
    if (table.objectType === 'SEQUENCE') return this.renderCreateSequence(table);
    if (table.objectType === 'TYPE') return this.renderCreateType(table);
    if (table.objectType !== 'TABLE' && table.objectType !== 'MQT') {
      return table.definition || `-- No definition available for ${table.objectType} ${table.name}`;
    }

    let sql = this.renderCreateTable(table, dialect) + `\n`;

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

  private dropObjectStatements(obj: TableDiff, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const name = this.qualify(obj.tableName, mapping);
    if (obj.objectType === 'TABLE') {
      for (const fk of obj.targetTable?.foreignKeys ?? []) {
        statements.push(`ALTER TABLE ${name} DROP CONSTRAINT ${this.bareName(fk.name)};`);
      }
      statements.push(`DROP TABLE ${name};`);
    } else if (obj.objectType === 'VIEW') {
      statements.push(`DROP VIEW ${name};`);
    } else if (obj.objectType === 'FUNCTION') {
      statements.push(`DROP FUNCTION ${name};`);
    } else if (obj.objectType === 'PROCEDURE') {
      statements.push(`DROP PROCEDURE ${name};`);
    } else if (obj.objectType === 'TRIGGER') {
      statements.push(`DROP TRIGGER ${name};`);
    } else if (obj.objectType === 'SEQUENCE') {
      statements.push(`DROP SEQUENCE ${name};`);
    } else if (obj.objectType === 'TYPE') {
      statements.push(`DROP TYPE ${name};`);
    } else if (obj.objectType === 'ROLE') {
      statements.push(`DROP ROLE ${this.bareName(obj.tableName)};`);
    }
    return statements;
  }

  private createObjectStatements(obj: TableDiff, dialect: SqlDialect, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const source = obj.sourceTable;
    const name = this.qualify(obj.tableName, mapping);

    if (obj.objectType === 'TABLE' && source) {
      statements.push(this.renderCreateTable(source, dialect, mapping));

      for (const idx of source.indices) {
        const uniqueStr = idx.unique ? ' UNIQUE' : '';
        statements.push(`CREATE${uniqueStr} INDEX ${this.qualify(idx.name, mapping)} ON ${name} (${idx.columns.join(', ')});`);
      }

      for (const fk of source.foreignKeys) {
        statements.push(
          `ALTER TABLE ${name} ADD CONSTRAINT ${this.bareName(fk.name)} \n  FOREIGN KEY (${fk.columns.join(', ')}) REFERENCES ${this.qualify(fk.referencedTable, mapping)} (${fk.referencedColumns.join(', ')});`
        );
      }

      for (const trg of source.triggers ?? []) {
        if (trg.definition) statements.push(trg.definition.trim());
      }
    } else if (obj.objectType === 'SEQUENCE' && source) {
      statements.push(this.renderCreateSequence({ ...source, name }));
    } else if (obj.objectType === 'TYPE' && source) {
      statements.push(this.renderCreateType({ ...source, name }));
    } else if (obj.objectType === 'ROLE') {
      const roleName = this.bareName(obj.tableName);
      statements.push(`CREATE ROLE ${roleName};`);
      for (const m of obj.columnDiffs) {
        const info = m.source ?? m.target;
        if (info) statements.push(`GRANT ROLE ${roleName} TO ${info.type} ${m.name};`);
      }
    } else if (obj.definition) {
      statements.push(obj.definition);
    }
    return statements;
  }

  private alterObjectStatements(obj: TableDiff, dialect: SqlDialect, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const tableName = this.qualify(obj.tableName, mapping);

    if (obj.objectType === 'TABLE') {
      for (const col of obj.columnDiffs.filter((c) => c.status === 'ADDED')) {
        if (!col.source) continue;
        let colDef = `${col.name} ${col.source.type}`;
        if (!col.source.nullable) colDef += ` NOT NULL`;
        if (col.source.defaultValue) colDef += ` DEFAULT ${col.source.defaultValue}`;
        statements.push(dialect.addColumnStatement(tableName, colDef));
      }

      for (const col of obj.columnDiffs.filter((c) => c.status === 'MODIFIED')) {
        if (!col.source) continue;
        statements.push(...dialect.modifyColumnStatements(tableName, col.name, col.source));
      }

      for (const col of obj.columnDiffs.filter((c) => c.status === 'REMOVED')) {
        statements.push(dialect.dropColumnStatement(tableName, col.name));
      }

      const srcPk = obj.sourceTable ? this.primaryKeyColumns(obj.sourceTable) : [];
      const tgtPk = obj.targetTable ? this.primaryKeyColumns(obj.targetTable) : [];
      if (JSON.stringify(srcPk) !== JSON.stringify(tgtPk)) {
        if (tgtPk.length > 0) {
          const pkName = obj.targetTable?.primaryKey?.name
            ? this.bareName(obj.targetTable.primaryKey.name)
            : undefined;
          statements.push(...dialect.dropPrimaryKeyStatements(tableName, pkName));
        }
        if (srcPk.length > 0) {
          const pkName = obj.sourceTable?.primaryKey?.name;
          const constraint = pkName ? `CONSTRAINT ${this.bareName(pkName)} ` : '';
          statements.push(`ALTER TABLE ${tableName} ADD ${constraint}PRIMARY KEY (${srcPk.join(', ')});`);
        }
      }

      for (const idx of obj.indexDiffs.filter((i) => i.status === 'REMOVED' || i.status === 'MODIFIED')) {
        statements.push(`DROP INDEX ${this.qualify(idx.name, mapping)};`);
      }

      for (const idx of obj.indexDiffs.filter((i) => i.status === 'ADDED' || i.status === 'MODIFIED')) {
        const srcIdx = idx.source;
        if (!srcIdx) continue;
        const uniqueStr = srcIdx.unique ? ' UNIQUE' : '';
        statements.push(`CREATE${uniqueStr} INDEX ${this.qualify(idx.name, mapping)} ON ${tableName} (${srcIdx.columns.join(', ')});`);
      }

      for (const trg of (obj.triggerDiffs ?? []).filter((t) => t.status === 'REMOVED' || t.status === 'MODIFIED')) {
        statements.push(`DROP TRIGGER ${this.qualify(trg.name, mapping)};`);
      }
      for (const trg of (obj.triggerDiffs ?? []).filter((t) => t.status === 'ADDED' || t.status === 'MODIFIED')) {
        if (trg.source?.definition) statements.push(trg.source.definition.trim());
      }
    } else if (obj.objectType === 'SEQUENCE' && obj.sourceTable) {
      const s = obj.sourceTable.sequence ?? {};
      let alter = `ALTER SEQUENCE ${tableName}`;
      if (s.increment !== undefined) alter += ` INCREMENT BY ${s.increment}`;
      if (s.minValue !== undefined) alter += ` MINVALUE ${s.minValue}`;
      if (s.maxValue !== undefined) alter += ` MAXVALUE ${s.maxValue}`;
      alter += s.cycle ? ` CYCLE` : ` NO CYCLE`;
      statements.push(alter + `;`);
    } else if (obj.objectType === 'TYPE' && obj.sourceTable) {
      statements.push(`DROP TYPE ${tableName};`);
      statements.push(this.renderCreateType({ ...obj.sourceTable, name: tableName }));
    } else if (obj.objectType === 'ROLE') {
      const roleName = this.bareName(obj.tableName);
      for (const m of obj.columnDiffs) {
        if (m.status === 'ADDED' && m.source) {
          statements.push(`GRANT ROLE ${roleName} TO ${m.source.type} ${m.name};`);
        } else if (m.status === 'REMOVED' && m.target) {
          statements.push(`REVOKE ROLE ${roleName} FROM ${m.target.type} ${m.name};`);
        }
      }
    } else if (obj.definition) {
      if (obj.objectType === 'VIEW') statements.push(`DROP VIEW IF EXISTS ${tableName};`);
      else if (obj.objectType === 'FUNCTION') statements.push(`DROP FUNCTION IF EXISTS ${tableName};`);
      else if (obj.objectType === 'PROCEDURE') statements.push(`DROP PROCEDURE IF EXISTS ${tableName};`);
      else if (obj.objectType === 'TRIGGER') statements.push(`DROP TRIGGER IF EXISTS ${tableName};`);
      statements.push(obj.definition);
    }

    return statements;
  }

  generateMigrationPlan(diffs: TableDiff[], dialectStr: string, mapping?: SchemaMapping): MigrationStep[] {
    const dialect = resolveDialect(dialectStr);
    const steps: MigrationStep[] = [];

    for (const obj of diffs.filter((d) => d.status === 'REMOVED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'DROP', statements: this.dropObjectStatements(obj, mapping) });
    }
    for (const obj of diffs.filter((d) => d.status === 'ADDED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'CREATE', statements: this.createObjectStatements(obj, dialect, mapping) });
    }
    for (const obj of diffs.filter((d) => d.status === 'MODIFIED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'ALTER', statements: this.alterObjectStatements(obj, dialect, mapping) });
    }

    return steps
      .filter((s) => s.statements.length > 0)
      .map((s) => ({ ...s, statements: s.statements.map((st) => this.remapSchema(st, mapping)) }));
  }

  generateMigrationSql(diffs: TableDiff[], dialectStr: string, mapping?: SchemaMapping): string {
    let sql = `-- =========================================================================\n`;
    sql += `-- FoxSchema Generated Migration Script\n`;
    sql += `-- Dialect: ${dialectStr.toUpperCase()}\n`;
    if (mapping?.targetSchema) {
      sql += `-- Target Schema: ${mapping.targetSchema.toUpperCase()}\n`;
    }
    sql += `-- Created At: ${new Date().toISOString()}\n`;
    sql += `-- =========================================================================\n\n`;

    const steps = this.generateMigrationPlan(diffs, dialectStr, mapping);
    if (steps.length === 0) {
      return sql + `-- No schema changes detected. Target database is in sync with source.`;
    }

    const sections: Array<{ action: MigrationStep['action']; title: string }> = [
      { action: 'DROP', title: 'DROP REMOVED OBJECTS' },
      { action: 'CREATE', title: 'CREATE ADDED OBJECTS' },
      { action: 'ALTER', title: 'ALTER MODIFIED OBJECTS' },
    ];

    for (const section of sections) {
      const sectionSteps = steps.filter((s) => s.action === section.action);
      if (sectionSteps.length === 0) continue;

      sql += `-- -------------------------------------------------------------------------\n`;
      sql += `-- ${section.title}\n`;
      sql += `-- -------------------------------------------------------------------------\n`;
      for (const step of sectionSteps) {
        sql += `-- ${step.action} ${step.objectType}: ${step.objectName}\n`;
        sql += step.statements.join('\n') + `\n\n`;
      }
    }

    return sql;
  }
}
