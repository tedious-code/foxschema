import { TableDiff } from '../interfaces';
import { TableSchema, DbObjectType } from '../interfaces';
import type { SqlDialect, ColumnSpec } from './sql-dialect.interface';
import { resolveDialect } from './dialect-registry';

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
  /** Dialect the source objects were read from. Enables cross-dialect type translation. */
  sourceDialect?: string;
  /** Dialect the migration deploys into. Defaults to the dialect passed to generate*(). */
  targetDialect?: string;
  /**
   * Non-destructive (additive) mode: emit ADD/MODIFY but never DROP. Objects,
   * columns and indexes that exist only in the target are left untouched instead
   * of being removed. Safer — the target keeps its extra structure.
   */
  nonDestructive?: boolean;
}

const PROCEDURAL_TYPES: ReadonlySet<DbObjectType> = new Set(['VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER']);

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

  /** True when source and target dialects are both known and genuinely different. */
  private isCrossDialect(mapping?: SchemaMapping): boolean {
    if (!mapping?.sourceDialect || !mapping?.targetDialect) return false;
    return resolveDialect(mapping.sourceDialect) !== resolveDialect(mapping.targetDialect);
  }

  /**
   * Translate a native column type from the source dialect into the target
   * dialect. No-op (returns the raw type) for same-dialect migrations or when
   * the source dialect is unknown — so existing behavior is unchanged.
   */
  private translateType(rawType: string, mapping?: SchemaMapping): { sql: string; warning?: string } {
    if (!this.isCrossDialect(mapping)) return { sql: rawType };
    const source = resolveDialect(mapping!.sourceDialect!);
    const target = resolveDialect(mapping!.targetDialect!);
    return target.renderType(source.parseType(rawType));
  }

  /**
   * Procedural objects (views/functions/procedures/triggers) carry dialect-
   * specific bodies that can't be reliably auto-translated. Cross-dialect we emit
   * the original as a commented-out review block so the rest of the plan still runs.
   */
  /** Ensure a SQL definition ends with a semicolon — Postgres stores bodies without one. */
  private ensureSemicolon(def: string): string {
    const t = def.trim();
    return t.endsWith(';') ? t : t + ';';
  }

  /**
   * Build DROP FUNCTION/PROCEDURE with the full parameter-type signature so the
   * correct overload is dropped even when multiple overloads share the same name.
   * Falls back to the bare name when parameters are unavailable.
   */
  private dropRoutineSql(type: 'FUNCTION' | 'PROCEDURE', tableName: string, params?: import('../interfaces').RoutineParameter[]): string {
    const kw = type === 'FUNCTION' ? 'FUNCTION' : 'PROCEDURE';
    if (!params) return `DROP ${kw} IF EXISTS ${tableName};`;
    // Only IN/INOUT params appear in the call signature for DROP purposes
    const sig = params.filter((p) => p.mode === 'IN' || p.mode === 'INOUT').map((p) => p.type).join(', ');
    return `DROP ${kw} IF EXISTS ${tableName}(${sig});`;
  }

  private manualReviewBlock(obj: TableDiff, mapping?: SchemaMapping): string[] {
    const src = (mapping?.sourceDialect ?? '').toUpperCase();
    const tgt = (mapping?.targetDialect ?? '').toUpperCase();
    const lines = [
      `-- ============================================================`,
      `-- MANUAL REVIEW REQUIRED: ${obj.objectType} ${this.bareName(obj.tableName)}`,
      `-- Body is ${src} SQL and was NOT auto-translated to ${tgt}.`,
      `-- Review and adapt before running:`,
    ];
    const body = (obj.sourceTable?.definition ?? obj.definition ?? '').trim();
    for (const ln of (body ? body.split('\n') : ['(no definition available)'])) lines.push(`--   ${ln}`);
    lines.push(`-- ============================================================`);
    return lines;
  }

  private renderColumn(c: ColumnSpec & { name: string }, dialect: SqlDialect, mapping?: SchemaMapping, warnings?: string[]): string {
    const translated = this.translateType(c.type, mapping);
    if (translated.warning) warnings?.push(`${c.name}: ${translated.warning}`);
    let def = `${c.name} ${translated.sql}`;
    def += dialect.identityClause(c);
    if (!c.nullable) def += ` NOT NULL`;
    if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
    return def;
  }

  private renderCreateTable(table: TableSchema, dialect: SqlDialect, mapping?: SchemaMapping, warnings?: string[]): string {
    const lines = table.columns.map((c) => `  ${this.renderColumn(c, dialect, mapping, warnings)}`);

    const pkCols = this.primaryKeyColumns(table);
    if (pkCols.length > 0) {
      const constraintName = table.primaryKey?.name ? `CONSTRAINT ${this.bareName(table.primaryKey.name)} ` : '';
      lines.push(`  ${constraintName}PRIMARY KEY (${pkCols.join(', ')})`);
    }

    return `CREATE TABLE ${this.qualify(table.name, mapping)} (\n${lines.join(',\n')}\n);`;
  }

  private renderCreateSequence(table: TableSchema): string {
    const s = table.sequence ?? {};
    let sql = `CREATE SEQUENCE IF NOT EXISTS ${table.name}`;
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
      const typeWarnings: string[] = [];
      const createTable = this.renderCreateTable(source, dialect, mapping, typeWarnings);
      for (const w of typeWarnings) statements.push(`-- review: ${w}`);

      // Postgres serial columns reference a backing sequence in their DEFAULT
      // (nextval('…_seq'::regclass)). That sequence must exist before the table
      // that uses it, or a cross-schema CREATE fails with
      // 'relation "<name>_id_seq" does not exist'. Create it first and tie its
      // lifecycle to the column so it drops with the table.
      const seqOwned: string[] = [];
      if (dialect.serialSequenceFromDefault) {
        const seen = new Set<string>();
        for (const c of source.columns) {
          const seq = dialect.serialSequenceFromDefault(c.defaultValue ?? '');
          if (!seq || seen.has(seq)) continue;
          seen.add(seq);
          statements.push(`CREATE SEQUENCE IF NOT EXISTS ${this.qualify(seq, mapping)};`);
          seqOwned.push(`ALTER SEQUENCE ${this.qualify(seq, mapping)} OWNED BY ${name}.${c.name};`);
        }
      }
      statements.push(createTable);
      statements.push(...seqOwned);

      for (const idx of source.indices) {
        const uniqueStr = idx.unique ? ' UNIQUE' : '';
        // Index name must be bare — it's created in the (qualified) table's schema.
        // A schema-qualified index name is a syntax error in Postgres/MySQL/SQL Server.
        statements.push(`CREATE${uniqueStr} INDEX ${this.bareName(idx.name)} ON ${name} (${idx.columns.join(', ')});`);
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
    } else if (PROCEDURAL_TYPES.has(obj.objectType) && this.isCrossDialect(mapping)) {
      statements.push(...this.manualReviewBlock(obj, mapping));
    } else if (obj.definition) {
      if (obj.objectType === 'VIEW') {
        // obj.definition is just the SELECT body — wrap it into a full CREATE statement.
        statements.push(`CREATE OR REPLACE VIEW ${name} AS\n${this.ensureSemicolon(obj.definition)}`);
      } else {
        statements.push(this.ensureSemicolon(obj.definition));
      }
    }
    return statements;
  }

  private alterObjectStatements(obj: TableDiff, dialect: SqlDialect, mapping?: SchemaMapping): string[] {
    const statements: string[] = [];
    const tableName = this.qualify(obj.tableName, mapping);

    if (obj.objectType === 'TABLE') {
      // Some dialects (Postgres) reject ALTER/DROP COLUMN on tables that a view
      // depends on. The dialect provides drop/recreate blocks to handle this at
      // apply-time. ADD COLUMN never triggers this — only MODIFIED/REMOVED columns.
      const hasStructuralColumnChanges = obj.columnDiffs.some(
        (c) => c.status === 'MODIFIED' || (c.status === 'REMOVED' && !mapping?.nonDestructive)
      );
      const dropViewsBlock = hasStructuralColumnChanges
        ? (dialect.dropDependentViewsBlock?.(tableName) ?? null)
        : null;
      if (dropViewsBlock) statements.push(dropViewsBlock);

      // Drop FK constraints FIRST — before indexes and column drops. Dropping a
      // column cascades to any FK whose source columns include it, so an explicit
      // DROP CONSTRAINT afterwards fails with "does not exist". Dropping indexes
      // also requires the column to still exist if the FK holds a reference.
      if (!mapping?.nonDestructive) {
        for (const fk of obj.foreignKeyDiffs.filter((f) => f.status === 'REMOVED' || f.status === 'MODIFIED')) {
          if (fk.name) statements.push(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${this.bareName(fk.name)};`);
        }
      }

      // Drop obsolete indexes BEFORE column changes. Dropping a column cascades to
      // any index on it (Postgres/others), so an explicit DROP INDEX afterwards would
      // fail with "index does not exist". Doing it first also frees columns being retyped.
      // Non-destructive: keep target-only indexes (REMOVED); MODIFIED are still
      // dropped here and recreated below (that's a change, not a removal).
      for (const idx of obj.indexDiffs.filter((i) => i.status === 'MODIFIED' || (i.status === 'REMOVED' && !mapping?.nonDestructive))) {
        statements.push(`DROP INDEX ${this.qualify(idx.name, mapping)};`);
      }

      for (const col of obj.columnDiffs.filter((c) => c.status === 'ADDED')) {
        if (!col.source) continue;
        const translated = this.translateType(col.source.type, mapping);
        if (translated.warning) statements.push(`-- review: ${col.name}: ${translated.warning}`);
        // A serial column added to an existing table needs its sequence first.
        const seq = dialect.serialSequenceFromDefault?.(col.source.defaultValue ?? '');
        if (seq) statements.push(`CREATE SEQUENCE IF NOT EXISTS ${this.qualify(seq, mapping)};`);
        let colDef = `${col.name} ${translated.sql}`;
        if (!col.source.nullable) colDef += ` NOT NULL`;
        if (col.source.defaultValue) colDef += ` DEFAULT ${col.source.defaultValue}`;
        statements.push(dialect.addColumnStatement(tableName, colDef));
      }

      for (const col of obj.columnDiffs.filter((c) => c.status === 'MODIFIED')) {
        if (!col.source) continue;
        const translated = this.translateType(col.source.type, mapping);
        if (translated.warning) statements.push(`-- review: ${col.name}: ${translated.warning}`);
        statements.push(...dialect.modifyColumnStatements(tableName, col.name, { ...col.source, type: translated.sql }));

        // The compare flags a column as MODIFIED when only its DEFAULT differs, but
        // the type/nullability statements above don't carry the default — apply it
        // explicitly so the migration actually converges.
        const srcDef = col.source.defaultValue;
        const tgtDef = col.target?.defaultValue;
        if ((srcDef ?? '') !== (tgtDef ?? '')) {
          if (this.isCrossDialect(mapping) && srcDef) {
            // A default expression is source-dialect SQL; don't risk emitting it
            // verbatim into another dialect — flag it for review instead.
            statements.push(`-- review: ${col.name}: default '${srcDef}' is ${(mapping?.sourceDialect ?? '').toUpperCase()} syntax — set it manually for ${(mapping?.targetDialect ?? '').toUpperCase()}`);
          } else {
            // A new serial/sequence default needs its backing sequence to exist first.
            const seqForDefault = dialect.serialSequenceFromDefault?.(srcDef ?? '');
            if (seqForDefault) statements.push(`CREATE SEQUENCE IF NOT EXISTS ${this.qualify(seqForDefault, mapping)};`);
            statements.push(...dialect.setDefaultStatements(tableName, col.name, srcDef));
          }
        }
      }

      if (!mapping?.nonDestructive) {
        for (const col of obj.columnDiffs.filter((c) => c.status === 'REMOVED')) {
          statements.push(dialect.dropColumnStatement(tableName, col.name));
        }
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

      for (const idx of obj.indexDiffs.filter((i) => i.status === 'ADDED' || i.status === 'MODIFIED')) {
        const srcIdx = idx.source;
        if (!srcIdx) continue;
        const uniqueStr = srcIdx.unique ? ' UNIQUE' : '';
        // Bare index name (its schema follows the qualified table) — a qualified
        // index name is a syntax error in Postgres/MySQL/SQL Server.
        statements.push(`CREATE${uniqueStr} INDEX ${this.bareName(idx.name)} ON ${tableName} (${srcIdx.columns.join(', ')});`);
      }

      // Add new / recreate modified FK constraints (after all column changes are done).
      for (const fk of obj.foreignKeyDiffs.filter((f) => f.status === 'ADDED' || f.status === 'MODIFIED')) {
        const info = fk.source;
        if (!info) continue;
        statements.push(
          `ALTER TABLE ${tableName} ADD CONSTRAINT ${this.bareName(fk.name)} FOREIGN KEY (${info.columns.join(', ')}) REFERENCES ${this.qualify(info.referencedTable, mapping)} (${info.referencedColumns.join(', ')});`
        );
      }

      for (const trg of (obj.triggerDiffs ?? []).filter((t) => t.status === 'MODIFIED' || (t.status === 'REMOVED' && !mapping?.nonDestructive))) {
        statements.push(`DROP TRIGGER ${this.qualify(trg.name, mapping)};`);
      }
      for (const trg of (obj.triggerDiffs ?? []).filter((t) => t.status === 'ADDED' || t.status === 'MODIFIED')) {
        if (trg.source?.definition) statements.push(trg.source.definition.trim());
      }

      // Recreate any views dropped by the dialect's dropDependentViewsBlock above.
      if (dropViewsBlock) {
        const recreateBlock = dialect.recreateDependentViewsBlock?.(tableName);
        if (recreateBlock) statements.push(recreateBlock);
      }
    } else if (obj.objectType === 'SEQUENCE' && obj.sourceTable) {
      const s = obj.sourceTable.sequence ?? {};
      let alter = `ALTER SEQUENCE ${tableName}`;
      if (s.dataType) alter += ` AS ${s.dataType}`;
      if (s.increment !== undefined) alter += ` INCREMENT BY ${s.increment}`;
      if (s.minValue !== undefined) alter += ` MINVALUE ${s.minValue}`;
      if (s.maxValue !== undefined) alter += ` MAXVALUE ${s.maxValue}`;
      alter += s.cycle ? ` CYCLE` : ` NO CYCLE`;
      if (s.cache !== undefined) alter += s.cache > 0 ? ` CACHE ${s.cache}` : ` NO CACHE`;
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
    } else if (PROCEDURAL_TYPES.has(obj.objectType) && this.isCrossDialect(mapping)) {
      statements.push(...this.manualReviewBlock(obj, mapping));
    } else if (obj.definition) {
      const src = obj.sourceTable;
      if (obj.objectType === 'VIEW') {
        statements.push(`DROP VIEW IF EXISTS ${tableName};`);
        statements.push(`CREATE OR REPLACE VIEW ${tableName} AS\n${this.ensureSemicolon(obj.definition)}`);
      } else {
        if (obj.objectType === 'FUNCTION') statements.push(this.dropRoutineSql('FUNCTION', tableName, src?.parameters));
        else if (obj.objectType === 'PROCEDURE') statements.push(this.dropRoutineSql('PROCEDURE', tableName, src?.parameters));
        else if (obj.objectType === 'TRIGGER') statements.push(`DROP TRIGGER IF EXISTS ${tableName};`);
        statements.push(this.ensureSemicolon(obj.definition));
      }
    }

    return statements;
  }

  generateMigrationPlan(diffs: TableDiff[], dialectStr: string, mapping?: SchemaMapping): MigrationStep[] {
    const dialect = resolveDialect(dialectStr);
    // Pin the target dialect into the mapping so the render helpers can detect a
    // cross-dialect migration and translate column types accordingly.
    const m: SchemaMapping = { ...mapping, targetDialect: mapping?.targetDialect ?? dialectStr };
    const steps: MigrationStep[] = [];

    // Non-destructive mode never drops objects that exist only in the target.
    if (!m.nonDestructive) {
      for (const obj of diffs.filter((d) => d.status === 'REMOVED')) {
        steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'DROP', statements: this.dropObjectStatements(obj, m) });
      }
    }
    for (const obj of diffs.filter((d) => d.status === 'ADDED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'CREATE', statements: this.createObjectStatements(obj, dialect, m) });
    }

    for (const obj of diffs.filter((d) => d.status === 'MODIFIED')) {
      steps.push({ objectName: obj.tableName, objectType: obj.objectType, action: 'ALTER', statements: this.alterObjectStatements(obj, dialect, m) });
    }

    // Collect MODIFIED objects whose statements were entirely skipped (all changes
    // were removals, suppressed by non-destructive mode). Callers can surface these
    // as informational notes rather than silently hiding them.
    const skippedInNonDestructive: string[] = m.nonDestructive
      ? steps.filter((s) => s.action === 'ALTER' && s.statements.length === 0).map((s) => s.objectName)
      : [];

    const actionable = steps
      .filter((s) => s.statements.length > 0)
      .map((s) => ({ ...s, statements: s.statements.map((st) => this.remapSchema(st, m)) }));

    // Attach skipped list so generateMigrationSql can report it.
    (actionable as any).__skipped = skippedInNonDestructive;
    return actionable;
  }

  generateMigrationSql(diffs: TableDiff[], dialectStr: string, mapping?: SchemaMapping): string {
    let sql = `-- =========================================================================\n`;
    sql += `-- FoxSchema Generated Migration Script\n`;
    sql += `-- Dialect: ${dialectStr.toUpperCase()}\n`;
    if (mapping?.targetSchema) {
      sql += `-- Target Schema: ${mapping.targetSchema.toUpperCase()}\n`;
    }
    const crossDialect = this.isCrossDialect({ ...mapping, targetDialect: mapping?.targetDialect ?? dialectStr });
    if (crossDialect) {
      sql += `-- Cross-dialect: ${(mapping?.sourceDialect ?? '').toUpperCase()} -> ${dialectStr.toUpperCase()}\n`;
      sql += `-- Column types were translated; review any '-- review:' notes and MANUAL REVIEW blocks below.\n`;
    }
    if (mapping?.nonDestructive) {
      sql += `-- Non-destructive mode: ADD/MODIFY only — nothing in the target is dropped.\n`;
    }
    sql += `-- Created At: ${new Date().toISOString()}\n`;
    sql += `-- =========================================================================\n\n`;

    const steps = this.generateMigrationPlan(diffs, dialectStr, mapping);
    const skipped: string[] = (steps as any).__skipped ?? [];

    if (steps.length === 0) {
      if (skipped.length > 0) {
        // Objects were selected but all their changes were removals — suppressed by non-destructive mode.
        sql += `-- Nothing to apply: every selected change is a removal and non-destructive mode is ON.\n`;
        sql += `-- The following objects have target-only columns / indexes / constraints that won't be dropped:\n`;
        for (const name of skipped) sql += `--   ${name}\n`;
        sql += `--\n-- To remove these differences: disable non-destructive mode and re-run.`;
        return sql;
      }
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
