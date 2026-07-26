import { resolveDialect } from '../../lib/migration-validation';
import type { ColumnInfo, TableSchema } from '../../lib/types';
import type { CanonicalBase, CanonicalType } from '@foxschema/core';

/** Quote an identifier when it is not a plain SQL name. */
export function quoteIdent(name: string, dialect: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  const d = dialect.toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'clickhouse' || d === 'tidb') {
    return '`' + name.replace(/`/g, '``') + '`';
  }
  if (d === 'sqlserver' || d === 'azuresql') {
    return '[' + name.replace(/]/g, ']]') + ']';
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

export type BlueprintColumnOp =
  | { kind: 'add'; column: ColumnInfo }
  | { kind: 'modify'; name: string; previous: ColumnInfo; next: ColumnInfo }
  | { kind: 'drop'; name: string };

function toSpec(c: ColumnInfo) {
  return {
    type: c.type,
    nullable: c.nullable,
    defaultValue: c.defaultValue,
    primaryKey: c.primaryKey,
    identity: c.identity,
    identityGeneration: c.identityGeneration,
    collation: c.collation,
  };
}

/**
 * Auto-increment / identity is only valid on integer (and long/bigint) types.
 * Matches common dialect spellings: int, integer, bigint, long, smallint, serial, …
 * Excludes boolean/bit and decimal with scale.
 */
export function isIntegerAutoIncrementType(type: string): boolean {
  if (isBooleanBitType(type)) return false;
  const t = type.trim().toLowerCase();
  if (!t) return false;
  const base = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // Integers / longs only — not decimal, numeric, boolean, or floats
  return (
    /^(tiny|small|medium|big)?int\d*$/.test(base) ||
    base === 'integer' ||
    base === 'bigint' ||
    base === 'long' ||
    base === 'longint' ||
    base === 'int2' ||
    base === 'int4' ||
    base === 'int8' ||
    base === 'serial' ||
    base === 'bigserial' ||
    base === 'smallserial'
  );
}

/** Boolean / bit family (defaults are dialect-specific literals). */
export function isBooleanBitType(type: string): boolean {
  const t = type.trim().toLowerCase();
  const base = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (base === 'boolean' || base === 'bool' || base === 'bit') return true;
  // MySQL conventional boolean
  if (base === 'tinyint' && /\(\s*1\s*\)/.test(t)) return true;
  return false;
}

export type ColumnTypeKind =
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'text'
  | 'datetime'
  | 'binary'
  | 'other';

/** Classify a native type string for coloring / editors. */
export function classifyColumnType(type: string): ColumnTypeKind {
  if (isBooleanBitType(type)) return 'boolean';
  if (isIntegerAutoIncrementType(type)) return 'integer';
  const t = type.trim().toLowerCase();
  const base = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (
    base === 'decimal' ||
    base === 'numeric' ||
    base === 'number' ||
    base === 'money' ||
    base === 'smallmoney' ||
    base === 'real' ||
    base === 'float' ||
    base === 'double' ||
    base === 'double precision' ||
    base === 'float4' ||
    base === 'float8'
  ) {
    return 'decimal';
  }
  if (
    base === 'date' ||
    base === 'time' ||
    base === 'timestamp' ||
    base === 'timestamptz' ||
    base === 'datetime' ||
    base === 'datetime2' ||
    base === 'smalldatetime' ||
    base === 'datetimeoffset' ||
    base.includes('timestamp') ||
    base.includes('time')
  ) {
    return 'datetime';
  }
  if (
    base === 'char' ||
    base === 'nchar' ||
    base === 'varchar' ||
    base === 'nvarchar' ||
    base === 'character' ||
    base === 'character varying' ||
    base === 'text' ||
    base === 'ntext' ||
    base === 'clob' ||
    base === 'bpchar' ||
    base.endsWith('text')
  ) {
    return 'text';
  }
  if (
    base === 'binary' ||
    base === 'varbinary' ||
    base === 'blob' ||
    base === 'bytea' ||
    base === 'image' ||
    base.endsWith('blob')
  ) {
    return 'binary';
  }
  return 'other';
}

/** Tailwind classes for type-kind badges / row accents. */
export function columnTypeKindClasses(kind: ColumnTypeKind): {
  badge: string;
  bar: string;
  label: string;
} {
  switch (kind) {
    case 'integer':
      return {
        badge: 'bg-sky-950/50 text-sky-300 border-sky-500/40',
        bar: 'border-sky-500',
        label: 'Integer',
      };
    case 'decimal':
      return {
        badge: 'bg-cyan-950/50 text-cyan-300 border-cyan-500/40',
        bar: 'border-cyan-500',
        label: 'Decimal',
      };
    case 'boolean':
      return {
        badge: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
        bar: 'border-emerald-500',
        label: 'Boolean',
      };
    case 'text':
      return {
        badge: 'bg-amber-950/50 text-amber-200 border-amber-500/40',
        bar: 'border-amber-500',
        label: 'Text',
      };
    case 'datetime':
      return {
        badge: 'bg-violet-950/50 text-violet-300 border-violet-500/40',
        bar: 'border-violet-500',
        label: 'Date/time',
      };
    case 'binary':
      return {
        badge: 'bg-rose-950/50 text-rose-300 border-rose-500/40',
        bar: 'border-rose-500',
        label: 'Binary',
      };
    default:
      return {
        badge: 'bg-slate-800 text-slate-400 border-slate-600',
        bar: 'border-slate-500',
        label: 'Other',
      };
  }
}

export type TypeSizeShape =
  | { kind: 'none' }
  | { kind: 'length'; length: number | undefined }
  | { kind: 'decimal'; precision: number | undefined; scale: number | undefined };

/** Parse length or precision/scale from a type string. */
export function parseTypeSize(type: string): TypeSizeShape {
  const kind = classifyColumnType(type);
  const m = type.match(/\(\s*([^)]+)\s*\)/);
  if (kind === 'text' || kind === 'binary') {
    if (!m) return { kind: 'length', length: undefined };
    if (/^max$/i.test(m[1].trim())) return { kind: 'length', length: undefined };
    const n = Number(m[1].trim());
    return { kind: 'length', length: Number.isFinite(n) ? n : undefined };
  }
  if (kind === 'decimal') {
    if (!m) return { kind: 'decimal', precision: undefined, scale: undefined };
    const parts = m[1].split(',').map((p) => p.trim());
    const precision = parts[0] && !Number.isNaN(Number(parts[0])) ? Number(parts[0]) : undefined;
    const scale =
      parts[1] !== undefined && !Number.isNaN(Number(parts[1])) ? Number(parts[1]) : undefined;
    return { kind: 'decimal', precision, scale };
  }
  return { kind: 'none' };
}

/** Rebuild type string with new length or precision/scale. */
export function applyTypeSize(
  type: string,
  size: { length?: number; precision?: number; scale?: number }
): string {
  const base = type.replace(/\s*\([^)]*\)\s*$/, '').trim() || type.trim();
  const shape = parseTypeSize(type);
  if (shape.kind === 'length') {
    if (size.length === undefined || size.length <= 0) return base;
    return `${base}(${Math.floor(size.length)})`;
  }
  if (shape.kind === 'decimal') {
    const p = size.precision;
    if (p === undefined || p <= 0) return base;
    if (size.scale === undefined) return `${base}(${Math.floor(p)})`;
    return `${base}(${Math.floor(p)},${Math.floor(size.scale)})`;
  }
  return type;
}

export type BooleanDefaultOption = { value: string; label: string };

/**
 * Dialect-appropriate default literals for boolean / bit columns.
 * Empty string in UI = no DEFAULT clause.
 */
export function dialectBooleanDefaultOptions(dialectName: string): BooleanDefaultOption[] {
  const d = dialectName.toLowerCase();
  if (d === 'postgres' || d === 'cockroachdb' || d === 'yugabytedb') {
    return [
      { value: '', label: '(none)' },
      { value: 'TRUE', label: 'TRUE' },
      { value: 'FALSE', label: 'FALSE' },
      { value: 'NULL', label: 'NULL' },
    ];
  }
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') {
    return [
      { value: '', label: '(none)' },
      { value: '1', label: '1 (true)' },
      { value: '0', label: '0 (false)' },
      { value: 'TRUE', label: 'TRUE' },
      { value: 'FALSE', label: 'FALSE' },
      { value: 'NULL', label: 'NULL' },
    ];
  }
  if (d === 'sqlserver' || d === 'azuresql' || d === 'sqlite') {
    return [
      { value: '', label: '(none)' },
      { value: '1', label: '1' },
      { value: '0', label: '0' },
      { value: 'NULL', label: 'NULL' },
    ];
  }
  if (d === 'oracle' || d === 'db2') {
    // Often NUMBER(1) / SMALLINT stand-ins; still offer 1/0 and NULL
    return [
      { value: '', label: '(none)' },
      { value: '1', label: '1' },
      { value: '0', label: '0' },
      { value: 'NULL', label: 'NULL' },
    ];
  }
  return [
    { value: '', label: '(none)' },
    { value: 'TRUE', label: 'TRUE' },
    { value: 'FALSE', label: 'FALSE' },
    { value: '1', label: '1' },
    { value: '0', label: '0' },
    { value: 'NULL', label: 'NULL' },
  ];
}

/** Column-level constraints this dialect can emit in CREATE / ADD. */
export function dialectColumnConstraints(dialectName: string): {
  notNull: boolean;
  unique: boolean;
  hint: string;
} {
  const d = dialectName.toLowerCase();
  if (d === 'clickhouse') {
    return {
      notNull: true,
      unique: false,
      hint: 'ClickHouse: nullability is type-level (Nullable); no column UNIQUE.',
    };
  }
  return {
    notNull: true,
    unique: true,
    hint: 'NOT NULL and UNIQUE are supported as column constraints.',
  };
}

/** Apply identity only when the column type allows it. */
export function withAutoIncrement(
  column: ColumnInfo,
  enabled: boolean
): ColumnInfo {
  if (!enabled) {
    return { ...column, identity: false, identityGeneration: undefined };
  }
  if (!isIntegerAutoIncrementType(column.type)) {
    return { ...column, identity: false, identityGeneration: undefined };
  }
  return {
    ...column,
    identity: true,
    nullable: false,
    identityGeneration: column.identityGeneration ?? 'ALWAYS',
  };
}

/** Dialect-specific identity / auto-increment UI + clause preview. */
export type IdentitySupport = {
  supported: boolean;
  /** Short label for the checkbox */
  label: string;
  /** GENERATED … options (Postgres / Oracle / DB2 / Yugabyte / Cockroach) */
  generations?: Array<'ALWAYS' | 'BY DEFAULT'>;
  hint: string;
  /** Clause fragment shown next to the control */
  clauseHint: string;
};

export function dialectIdentitySupport(dialectName: string): IdentitySupport {
  const d = dialectName.toLowerCase();
  if (d === 'mysql' || d === 'mariadb' || d === 'tidb') {
    return {
      supported: true,
      label: 'Auto increment',
      clauseHint: 'AUTO_INCREMENT',
      hint: 'Only for int / integer / bigint / long types; usually also the primary key.',
    };
  }
  if (d === 'sqlserver' || d === 'azuresql') {
    return {
      supported: true,
      label: 'Auto increment',
      clauseHint: 'IDENTITY(1,1)',
      hint: 'Only for int / bigint / long. SQL Server IDENTITY(1,1).',
    };
  }
  if (d === 'redshift') {
    return {
      supported: true,
      label: 'Auto increment',
      clauseHint: 'IDENTITY(0,1)',
      hint: 'Redshift identity column.',
    };
  }
  if (
    d === 'postgres' ||
    d === 'cockroachdb' ||
    d === 'yugabytedb' ||
    d === 'oracle' ||
    d === 'db2'
  ) {
    return {
      supported: true,
      label: 'Auto increment',
      clauseHint: 'GENERATED … AS IDENTITY',
      generations: ['ALWAYS', 'BY DEFAULT'],
      hint: 'Only for int / bigint / long. GENERATED ALWAYS or BY DEFAULT AS IDENTITY.',
    };
  }
  if (d === 'sqlite') {
    return {
      supported: true,
      label: 'Auto increment',
      clauseHint: 'AUTOINCREMENT',
      hint: 'Only for INTEGER. SQLite PRIMARY KEY AUTOINCREMENT.',
    };
  }
  return {
    supported: true,
    label: 'Auto increment',
    clauseHint: resolveDialect(dialectName).identityClause({ type: 'integer', nullable: false, identity: true }) || 'identity',
    hint: 'Toggles the dialect identity clause in generated SQL.',
  };
}

/** Canonical templates rendered through each dialect's `renderType` for the dropdown. */
const TYPE_TEMPLATES: CanonicalType[] = [
  { base: 'boolean', raw: 'boolean' },
  { base: 'smallint', raw: 'smallint' },
  { base: 'integer', raw: 'integer' },
  { base: 'bigint', raw: 'bigint' },
  { base: 'decimal', raw: 'decimal', precision: 10, scale: 2 },
  { base: 'decimal', raw: 'decimal', precision: 18, scale: 0 },
  { base: 'real', raw: 'real' },
  { base: 'double', raw: 'double' },
  { base: 'char', raw: 'char', length: 1 },
  { base: 'varchar', raw: 'varchar', length: 50 },
  { base: 'varchar', raw: 'varchar', length: 255 },
  { base: 'varchar', raw: 'varchar', length: 1000 },
  { base: 'text', raw: 'text' },
  { base: 'binary', raw: 'binary', length: 16 },
  { base: 'varbinary', raw: 'varbinary', length: 255 },
  { base: 'blob', raw: 'blob' },
  { base: 'date', raw: 'date' },
  { base: 'time', raw: 'time' },
  { base: 'timestamp', raw: 'timestamp' },
  { base: 'timestamptz', raw: 'timestamptz' },
  { base: 'uuid', raw: 'uuid' },
  { base: 'json', raw: 'json' },
  { base: 'xml', raw: 'xml' },
];

const TYPE_GROUP: Partial<Record<CanonicalBase, string>> = {
  boolean: 'Numeric / boolean',
  smallint: 'Numeric / boolean',
  integer: 'Numeric / boolean',
  bigint: 'Numeric / boolean',
  decimal: 'Numeric / boolean',
  real: 'Numeric / boolean',
  double: 'Numeric / boolean',
  char: 'Text',
  varchar: 'Text',
  text: 'Text',
  binary: 'Binary',
  varbinary: 'Binary',
  blob: 'Binary',
  date: 'Date / time',
  time: 'Date / time',
  timestamp: 'Date / time',
  timestamptz: 'Date / time',
  uuid: 'Other',
  json: 'Other',
  xml: 'Other',
};

export type DialectDataTypeOption = {
  value: string;
  label: string;
  group: string;
  kind: ColumnTypeKind;
  /** True when this type can take auto-increment. */
  integerLike: boolean;
};

/**
 * Dialect-native data types for blueprint dropdowns, derived from each dialect's
 * `renderType` map (so Postgres gets `integer`/`varchar`, MySQL `int`/`varchar(255)`, etc.).
 */
export function listDialectDataTypes(dialectName: string): DialectDataTypeOption[] {
  const dialect = resolveDialect(dialectName);
  const seen = new Set<string>();
  const out: DialectDataTypeOption[] = [];

  for (const tmpl of TYPE_TEMPLATES) {
    const rendered = dialect.renderType(tmpl);
    const value = (rendered.sql || '').trim();
    if (!value) continue;
    // Skip "left as-is" unknowns that didn't map.
    if (rendered.warning && /no .+ equivalent/i.test(rendered.warning) && value === tmpl.raw) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      value,
      label: value,
      group: TYPE_GROUP[tmpl.base] ?? 'Other',
      kind: classifyColumnType(value),
      integerLike: isIntegerAutoIncrementType(value),
    });
  }

  // Prefer integer-like types first within each group for create UX.
  const groupOrder = ['Numeric / boolean', 'Text', 'Binary', 'Date / time', 'Other'];
  out.sort((a, b) => {
    const gi = groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group);
    if (gi !== 0) return gi;
    return a.label.localeCompare(b.label);
  });
  return out;
}

/** Default column type for a new column in this dialect (varchar(255) or closest). */
export function defaultDialectColumnType(dialectName: string): string {
  const types = listDialectDataTypes(dialectName);
  const varchar =
    types.find((t) => /^varchar\(255\)$/i.test(t.value)) ||
    types.find((t) => /^varchar/i.test(t.value)) ||
    types.find((t) => t.group === 'Text');
  return varchar?.value ?? 'varchar(255)';
}

/** Build `name type [identity] [COLLATE …] [DEFAULT …] [NOT NULL] [UNIQUE]` for ADD / CREATE. */
export function buildColumnDef(
  column: ColumnInfo & { unique?: boolean },
  dialectName: string
): string {
  const dialect = resolveDialect(dialectName);
  const name = quoteIdent(column.name, dialectName);
  const d = dialectName.toLowerCase();
  const identityOk = !!column.identity && isIntegerAutoIncrementType(column.type);
  const spec = { ...toSpec(column), identity: identityOk };
  let typeSql: string;
  if (dialect.nullableTypeWrapper) {
    typeSql = dialect.nullableTypeWrapper(column.type, column.nullable);
  } else if (d === 'sqlite' && identityOk) {
    typeSql = column.type;
  } else {
    typeSql = column.type + dialect.identityClause(spec);
  }
  let def = `${name} ${typeSql}`;
  if (column.collation) {
    def += dialect.columnCollateClause?.(column.collation) ?? ` COLLATE ${column.collation}`;
  }
  if (!dialect.nullableTypeWrapper) {
    if (column.defaultValue) {
      const defVal = column.defaultValue.trim().toUpperCase() === 'NULL' ? 'NULL' : column.defaultValue;
      def += ` DEFAULT ${defVal}`;
    }
    if (!column.nullable) def += ` NOT NULL`;
  }
  if (column.unique && dialectColumnConstraints(dialectName).unique) {
    def += ` UNIQUE`;
  }
  if (d === 'sqlite' && identityOk) {
    def += ' AUTOINCREMENT';
  }
  return def;
}

function columnCoreChanged(a: ColumnInfo, b: ColumnInfo): boolean {
  return (
    a.type !== b.type ||
    a.nullable !== b.nullable ||
    !!a.identity !== !!b.identity ||
    (a.identityGeneration ?? '') !== (b.identityGeneration ?? '') ||
    (a.collation ?? '') !== (b.collation ?? '')
  );
}

function defaultChanged(a: ColumnInfo, b: ColumnInfo): boolean {
  return (a.defaultValue ?? '') !== (b.defaultValue ?? '');
}

export function pkColumnsFromTable(table: TableSchema): string[] {
  if (table.primaryKey?.columns?.length) return [...table.primaryKey.columns];
  return (table.columns ?? []).filter((c) => c.primaryKey).map((c) => c.name);
}

export function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * DROP + ADD PRIMARY KEY when the column set (or order) changes.
 * Supports single and composite keys.
 */
export function generatePkAlterSql(
  tableName: string,
  dialectName: string,
  previous: string[],
  next: string[],
  pkName?: string
): string[] {
  if (sameStringList(previous, next)) return [];
  const dialect = resolveDialect(dialectName);
  const qTable = quoteIdent(tableName, dialectName);
  const stmts: string[] = [];
  if (previous.length > 0) {
    const qPk =
      pkName && pkName.toUpperCase() !== 'PRIMARY'
        ? quoteIdent(pkName, dialectName)
        : pkName;
    stmts.push(...dialect.dropPrimaryKeyStatements(qTable, qPk));
  }
  if (next.length > 0) {
    const cols = next.map((c) => quoteIdent(c, dialectName)).join(', ');
    const constraint =
      pkName && pkName.toUpperCase() !== 'PRIMARY'
        ? `CONSTRAINT ${quoteIdent(pkName, dialectName)} `
        : '';
    stmts.push(`ALTER TABLE ${qTable} ADD ${constraint}PRIMARY KEY (${cols});`);
  }
  return stmts;
}

/**
 * Generate same-dialect ALTER statements for pending blueprint column ops.
 * Order: drops, modifies, adds.
 */
export function generateBlueprintAlterSql(
  tableName: string,
  dialectName: string,
  ops: BlueprintColumnOp[]
): string[] {
  if (ops.length === 0) return [];
  const dialect = resolveDialect(dialectName);
  const qTable = quoteIdent(tableName, dialectName);
  const stmts: string[] = [];

  for (const op of ops) {
    if (op.kind !== 'drop') continue;
    stmts.push(dialect.dropColumnStatement(qTable, quoteIdent(op.name, dialectName)));
  }

  for (const op of ops) {
    if (op.kind !== 'modify') continue;
    const qName = quoteIdent(op.name, dialectName);
    const core = columnCoreChanged(op.previous, op.next);
    const def = defaultChanged(op.previous, op.next);
    if (core) {
      stmts.push(
        ...dialect.modifyColumnStatements(qTable, qName, toSpec(op.next), op.previous.nullable)
      );
      if (op.next.defaultValue) {
        stmts.push(...dialect.setDefaultStatements(qTable, qName, op.next.defaultValue));
      } else if (op.previous.defaultValue) {
        stmts.push(...dialect.setDefaultStatements(qTable, qName, undefined));
      }
    } else if (def) {
      stmts.push(...dialect.setDefaultStatements(qTable, qName, op.next.defaultValue));
    }
  }

  for (const op of ops) {
    if (op.kind !== 'add') continue;
    stmts.push(dialect.addColumnStatement(qTable, buildColumnDef(op.column, dialectName)));
  }

  return stmts;
}

/** Diff original columns vs draft to produce pending ops (excludes unchanged). */
export function diffBlueprintColumns(
  original: ColumnInfo[],
  draft: ColumnInfo[],
  droppedNames: Set<string>
): BlueprintColumnOp[] {
  const ops: BlueprintColumnOp[] = [];
  const origByName = new Map(original.map((c) => [c.name, c]));
  const draftNames = new Set(draft.map((c) => c.name));

  for (const name of droppedNames) {
    if (origByName.has(name)) ops.push({ kind: 'drop', name });
  }

  for (const col of draft) {
    const prev = origByName.get(col.name);
    if (!prev) {
      if (!droppedNames.has(col.name)) ops.push({ kind: 'add', column: col });
      continue;
    }
    if (droppedNames.has(col.name)) continue;
    if (columnCoreChanged(prev, col) || defaultChanged(prev, col)) {
      ops.push({ kind: 'modify', name: col.name, previous: prev, next: col });
    }
  }

  for (const prev of original) {
    if (!draftNames.has(prev.name) && !droppedNames.has(prev.name)) {
      ops.push({ kind: 'drop', name: prev.name });
    }
  }

  return ops;
}

function createTableBody(
  columns: ColumnInfo[],
  pkColumns: string[],
  dialectName: string,
  pkName?: string
): string {
  const lines = columns.map((c) => `  ${buildColumnDef(c, dialectName)}`);
  if (pkColumns.length > 0) {
    const cols = pkColumns.map((c) => quoteIdent(c, dialectName)).join(', ');
    const constraint =
      pkName && pkName.toUpperCase() !== 'PRIMARY'
        ? `CONSTRAINT ${quoteIdent(pkName, dialectName)} `
        : '';
    lines.push(`  ${constraint}PRIMARY KEY (${cols})`);
  }
  return `(\n${lines.join(',\n')}\n)`;
}

/**
 * CREATE TABLE with existence guard (IF NOT EXISTS or dialect equivalent).
 */
export function generateCreateTableSql(
  tableName: string,
  columns: ColumnInfo[],
  pkColumns: string[],
  dialectName: string,
  pkName?: string
): string[] {
  const name = tableName.trim();
  if (!name || columns.length === 0) return [];
  const qTable = quoteIdent(name, dialectName);
  const body = createTableBody(columns, pkColumns, dialectName, pkName);
  const d = dialectName.toLowerCase();

  if (d === 'sqlserver' || d === 'azuresql') {
    const escaped = name.replace(/'/g, "''");
    return [
      `IF OBJECT_ID(N'${escaped}', N'U') IS NULL\nCREATE TABLE ${qTable} ${body};`,
    ];
  }
  if (d === 'oracle') {
    // Oracle 23c+ supports IF NOT EXISTS; older versions ignore and may error on re-run.
    return [`CREATE TABLE IF NOT EXISTS ${qTable} ${body};`];
  }
  if (d === 'db2') {
    // DB2 has no CREATE TABLE IF NOT EXISTS — emit plain CREATE (Apply fails if exists).
    return [
      `-- review: DB2 has no CREATE TABLE IF NOT EXISTS — fails if ${name} already exists`,
      `CREATE TABLE ${qTable} ${body};`,
    ];
  }
  return [`CREATE TABLE IF NOT EXISTS ${qTable} ${body};`];
}

/**
 * DROP TABLE with existence guard via dialect hook when available.
 */
export function generateDropTableSql(tableName: string, dialectName: string): string[] {
  const name = tableName.trim();
  if (!name) return [];
  const dialect = resolveDialect(dialectName);
  const qTable = quoteIdent(name, dialectName);
  if (dialect.dropTableStatement) {
    return [dialect.dropTableStatement(qTable)];
  }
  return [`DROP TABLE IF EXISTS ${qTable};`];
}

/** Combine column ALTERs + PK change for an existing table. */
export function generateTableBlueprintSql(args: {
  tableName: string;
  dialect: string;
  columnOps: BlueprintColumnOp[];
  previousPk: string[];
  nextPk: string[];
  pkName?: string;
}): string[] {
  const colStmts = generateBlueprintAlterSql(args.tableName, args.dialect, args.columnOps);
  const pkStmts = generatePkAlterSql(
    args.tableName,
    args.dialect,
    args.previousPk,
    args.nextPk,
    args.pkName
  );
  // PK drop before column drops that remove PK cols; PK add after column adds.
  // Practical order: column drops that aren't PK-only → drop PK → column mods/adds → add PK
  // Simpler stable order used here: column ops first, then PK (matches common ALTER scripts).
  // When dropping a PK column, user should drop PK first — we emit PK alter after columns
  // only when nextPk is non-empty or previous changed; if nextPk empty and previous had PK,
  // put drop PK before column drops.
  if (args.previousPk.length > 0 && args.nextPk.length === 0) {
    return [...pkStmts, ...colStmts];
  }
  if (
    args.previousPk.length > 0 &&
    !sameStringList(args.previousPk, args.nextPk) &&
    args.columnOps.some((o) => o.kind === 'drop' && args.previousPk.includes(o.name))
  ) {
    const dropPk = generatePkAlterSql(
      args.tableName,
      args.dialect,
      args.previousPk,
      [],
      args.pkName
    );
    const addPk =
      args.nextPk.length > 0
        ? generatePkAlterSql(args.tableName, args.dialect, [], args.nextPk, args.pkName)
        : [];
    return [...dropPk, ...colStmts, ...addPk];
  }
  return [...colStmts, ...pkStmts];
}
