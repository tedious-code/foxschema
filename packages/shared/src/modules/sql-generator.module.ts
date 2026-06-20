import { TableDiff } from '../interfaces/diff.types.interface';
import { TableSchema, DbObjectType } from '../interfaces/schema.interface';

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

  private renderColumn(c: TableSchema['columns'][number]): string {
    let def = `${c.name} ${c.type}`;
    if (!c.nullable) def += ` NOT NULL`;
    if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
    if (c.identity) def += ` GENERATED ${c.identityGeneration ?? 'ALWAYS'} AS IDENTITY`;
    return def;
  }

  private renderCreateTable(table: TableSchema, mapping?: SchemaMapping): string {
    const lines = table.columns.map((c) => `  ${this.renderColumn(c)}`);

    const pkCols = this.primaryKeyColumns(table);
    if (pkCols.length > 0) {
      const constraintName = table.primaryKey?.name ? `CONSTRAINT ${this.bareName(table.primaryKey.name)} ` : '';
      lines.push(`  ${constraintName}PRIMARY KEY (${pkCols.join(', ')})`);
    }

    return `CREATE TABLE ${this.qualify(table.name, mapping)} (\n${lines.join(',\n')}\n);`;
  }

  /**
   * Renders the full DDL of a single object as it exists on one side,
   * used for side-by-side source/target diff display.
   */
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
    // Structured type: render member attributes
    if (u.attributes && u.attributes.length > 0) {
      const attrs = u.attributes.map((a) => `  ${a.name} ${a.type}`).join(',\n');
      return `CREATE TYPE ${table.name} AS (\n${attrs}\n) MODE DB2SQL;`;
    }
    // Distinct type
    return `CREATE TYPE ${table.name} AS ${u.sourceType ?? 'VARCHAR(255)'} WITH COMPARISONS;`;
  }

  generateObjectDdl(table: TableSchema): string {
    if (table.objectType === 'SEQUENCE') return this.renderCreateSequence(table);
    if (table.objectType === 'TYPE') return this.renderCreateType(table);
    // MQTs have columns but no separately-captured query — render their column
    // structure like a table so the DDL diff is meaningful.
    if (table.objectType !== 'TABLE' && table.objectType !== 'MQT') {
      return table.definition || `-- No definition available for ${table.objectType} ${table.name}`;
    }

    let sql = this.renderCreateTable(table) + `\n`;

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

  private createObjectStatements(obj: TableDiff, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const source = obj.sourceTable;
    const name = this.qualify(obj.tableName, mapping);

    if (obj.objectType === 'TABLE' && source) {
      statements.push(this.renderCreateTable(source, mapping));

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

  private alterObjectStatements(obj: TableDiff, dialectUpper: string, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const tableName = this.qualify(obj.tableName, mapping);

    if (obj.objectType === 'TABLE') {
      const colsAdded = obj.columnDiffs.filter((c) => c.status === 'ADDED');
      for (const col of colsAdded) {
        if (!col.source) continue;
        let colDef = `${col.name} ${col.source.type}`;
        if (!col.source.nullable) colDef += ` NOT NULL`;
        if (col.source.defaultValue) colDef += ` DEFAULT ${col.source.defaultValue}`;

        if (dialectUpper === 'POSTGRES') {
          statements.push(`ALTER TABLE ${tableName} ADD COLUMN ${colDef};`);
        } else {
          statements.push(`ALTER TABLE ${tableName} ADD ${colDef};`);
        }
      }

      const colsMod = obj.columnDiffs.filter((c) => c.status === 'MODIFIED');
      for (const col of colsMod) {
        if (!col.source) continue;
        if (dialectUpper === 'POSTGRES') {
          statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${col.name} TYPE ${col.source.type};`);
          if (col.source.nullable) {
            statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${col.name} DROP NOT NULL;`);
          } else {
            statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${col.name} SET NOT NULL;`);
          }
        } else if (dialectUpper === 'DB2') {
          statements.push(`ALTER TABLE ${tableName} ALTER COLUMN ${col.name} SET DATA TYPE ${col.source.type};`);
        } else {
          statements.push(`ALTER TABLE ${tableName} MODIFY COLUMN ${col.name} ${col.source.type};`);
        }
      }

      const colsRem = obj.columnDiffs.filter((c) => c.status === 'REMOVED');
      for (const col of colsRem) {
        if (dialectUpper === 'POSTGRES' || dialectUpper === 'DB2') {
          statements.push(`ALTER TABLE ${tableName} DROP COLUMN ${col.name};`);
        } else {
          statements.push(`ALTER TABLE ${tableName} DROP ${col.name};`);
        }
      }

      // Primary key change: drop the old constraint, add the new one
      const srcPk = obj.sourceTable ? this.primaryKeyColumns(obj.sourceTable) : [];
      const tgtPk = obj.targetTable ? this.primaryKeyColumns(obj.targetTable) : [];
      if (JSON.stringify(srcPk) !== JSON.stringify(tgtPk)) {
        if (tgtPk.length > 0) {
          if (dialectUpper === 'POSTGRES') {
            statements.push(`ALTER TABLE ${tableName} DROP CONSTRAINT ${this.bareName(obj.targetTable?.primaryKey?.name ?? `${this.bareName(obj.tableName)}_pkey`)};`);
          } else {
            statements.push(`ALTER TABLE ${tableName} DROP PRIMARY KEY;`);
          }
        }
        if (srcPk.length > 0) {
          const pkName = obj.sourceTable?.primaryKey?.name;
          const constraint = pkName ? `CONSTRAINT ${this.bareName(pkName)} ` : '';
          statements.push(`ALTER TABLE ${tableName} ADD ${constraint}PRIMARY KEY (${srcPk.join(', ')});`);
        }
      }

      const idxRem = obj.indexDiffs.filter((i) => i.status === 'REMOVED' || i.status === 'MODIFIED');
      for (const idx of idxRem) {
        statements.push(`DROP INDEX ${this.qualify(idx.name, mapping)};`);
      }

      const idxAdd = obj.indexDiffs.filter((i) => i.status === 'ADDED' || i.status === 'MODIFIED');
      for (const idx of idxAdd) {
        const srcIdx = idx.source;
        if (!srcIdx) continue;
        const uniqueStr = srcIdx.unique ? ' UNIQUE' : '';
        statements.push(`CREATE${uniqueStr} INDEX ${this.qualify(idx.name, mapping)} ON ${tableName} (${srcIdx.columns.join(', ')});`);
      }

      // Triggers: drop removed/changed, recreate added/changed from source
      const trgDrop = (obj.triggerDiffs ?? []).filter((t) => t.status === 'REMOVED' || t.status === 'MODIFIED');
      for (const trg of trgDrop) {
        statements.push(`DROP TRIGGER ${this.qualify(trg.name, mapping)};`);
      }
      const trgCreate = (obj.triggerDiffs ?? []).filter((t) => t.status === 'ADDED' || t.status === 'MODIFIED');
      for (const trg of trgCreate) {
        if (trg.source?.definition) statements.push(trg.source.definition.trim());
      }
    } else if (obj.objectType === 'SEQUENCE' && obj.sourceTable) {
      // Sequence attributes can be altered in place (RESTART aside)
      const s = obj.sourceTable.sequence ?? {};
      let alter = `ALTER SEQUENCE ${tableName}`;
      if (s.increment !== undefined) alter += ` INCREMENT BY ${s.increment}`;
      if (s.minValue !== undefined) alter += ` MINVALUE ${s.minValue}`;
      if (s.maxValue !== undefined) alter += ` MAXVALUE ${s.maxValue}`;
      alter += s.cycle ? ` CYCLE` : ` NO CYCLE`;
      statements.push(alter + `;`);
    } else if (obj.objectType === 'TYPE' && obj.sourceTable) {
      // Distinct types can't be altered — drop and recreate
      statements.push(`DROP TYPE ${tableName};`);
      statements.push(this.renderCreateType({ ...obj.sourceTable, name: tableName }));
    } else if (obj.objectType === 'ROLE') {
      // Role membership changes: grant added members, revoke removed ones.
      const roleName = this.bareName(obj.tableName);
      for (const m of obj.columnDiffs) {
        if (m.status === 'ADDED' && m.source) {
          statements.push(`GRANT ROLE ${roleName} TO ${m.source.type} ${m.name};`);
        } else if (m.status === 'REMOVED' && m.target) {
          statements.push(`REVOKE ROLE ${roleName} FROM ${m.target.type} ${m.name};`);
        }
      }
    } else if (obj.definition) {
      // Re-create views/funcs/procs by dropping first
      if (obj.objectType === 'VIEW') {
        statements.push(`DROP VIEW IF EXISTS ${tableName};`);
      } else if (obj.objectType === 'FUNCTION') {
        statements.push(`DROP FUNCTION IF EXISTS ${tableName};`);
      } else if (obj.objectType === 'PROCEDURE') {
        statements.push(`DROP PROCEDURE IF EXISTS ${tableName};`);
      } else if (obj.objectType === 'TRIGGER') {
        statements.push(`DROP TRIGGER IF EXISTS ${tableName};`);
      }
      statements.push(obj.definition);
    }

    return statements;
  }

  /**
   * Ordered, per-object execution plan: drops first, then creates, then alters.
   * Each step carries the statements for exactly one object so progress and
   * failures can be reported object by object.
   */
  generateMigrationPlan(diffs: TableDiff[], dialect: string, mapping?: SchemaMapping): MigrationStep[] {
    const dialectUpper = dialect.toUpperCase();
    const steps: MigrationStep[] = [];

    for (const obj of diffs.filter((d) => d.status === 'REMOVED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'DROP', statements: this.dropObjectStatements(obj, mapping) });
    }
    for (const obj of diffs.filter((d) => d.status === 'ADDED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'CREATE', statements: this.createObjectStatements(obj, mapping) });
    }
    for (const obj of diffs.filter((d) => d.status === 'MODIFIED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'ALTER', statements: this.alterObjectStatements(obj, dialectUpper, mapping) });
    }

    return steps
      .filter((s) => s.statements.length > 0)
      .map((s) => ({ ...s, statements: s.statements.map((st) => this.remapSchema(st, mapping)) }));
  }

  generateMigrationSql(diffs: TableDiff[], dialect: string, mapping?: SchemaMapping): string {
    let sql = `-- =========================================================================\n`;
    sql += `-- FoxSchema Generated Migration Script\n`;
    sql += `-- Dialect: ${dialect.toUpperCase()}\n`;
    if (mapping?.targetSchema) {
      sql += `-- Target Schema: ${mapping.targetSchema.toUpperCase()}\n`;
    }
    sql += `-- Created At: ${new Date().toISOString()}\n`;
    sql += `-- =========================================================================\n\n`;

    const steps = this.generateMigrationPlan(diffs, dialect, mapping);
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
