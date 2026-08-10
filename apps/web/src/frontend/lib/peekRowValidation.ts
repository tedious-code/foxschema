/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Field descriptions and value checks for the Data Peek row form.
 *
 * The point is to fail in the form rather than at the database: a mistyped
 * number or an over-long string otherwise comes back as a driver error after
 * the write confirm dialog, with no indication of which column caused it.
 *
 * Only checks that can be made from catalog metadata are done here. CHECK
 * expressions, uniqueness, and foreign keys still belong to the engine, so a
 * clean form is not a promise that the write will succeed.
 */
import type { ColumnInfo, TableSchema } from './types';

export type FieldKind =
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'uuid'
  | 'json'
  | 'binary'
  | 'text'
  | 'other';

export interface TypeFacts {
  kind: FieldKind;
  /** Character limit for text types, when the type carries one. */
  maxLength?: number;
  precision?: number;
  scale?: number;
  min?: bigint;
  max?: bigint;
}

export type PeekFieldMode = 'add' | 'edit' | 'clone';

export interface PeekField extends TypeFacts {
  name: string;
  /** Raw catalog type, shown in the form. */
  type: string;
  nullable: boolean;
  isKey: boolean;
  isIdentity: boolean;
  hasDefault: boolean;
  /** Disabled in the form — auto-generated, or a key being used to target the row. */
  readOnly: boolean;
  /** Placeholder text: what to type, or why the field is locked. */
  hint: string;
}

/** Signed ranges that agree across Postgres / SQL Server / MySQL. */
const INT_RANGES: Record<string, { min: bigint; max: bigint }> = {
  smallint: { min: -32768n, max: 32767n },
  int2: { min: -32768n, max: 32767n },
  int: { min: -2147483648n, max: 2147483647n },
  integer: { min: -2147483648n, max: 2147483647n },
  int4: { min: -2147483648n, max: 2147483647n },
  bigint: { min: -9223372036854775808n, max: 9223372036854775807n },
  int8: { min: -9223372036854775808n, max: 9223372036854775807n },
};

const INTEGER_NAMES = new Set([
  ...Object.keys(INT_RANGES),
  // tinyint is deliberately range-free: 0..255 on SQL Server, -128..127 signed
  // on MySQL. Guessing wrong would reject valid input.
  'tinyint',
  'mediumint',
  'serial',
  'bigserial',
  'smallserial',
  'serial4',
  'serial8',
  'rowid',
]);

const DECIMAL_NAMES = new Set([
  'decimal',
  'numeric',
  'dec',
  'number',
  'money',
  'smallmoney',
  'float',
  'real',
  'double',
  'double precision',
  'float4',
  'float8',
  'binary_float',
  'binary_double',
  'decfloat',
]);

const TEXT_NAMES = new Set([
  'char',
  'character',
  'nchar',
  'varchar',
  'varchar2',
  'nvarchar',
  'nvarchar2',
  'character varying',
  'text',
  'ntext',
  'clob',
  'nclob',
  'longtext',
  'mediumtext',
  'tinytext',
  'string',
  'citext',
  'graphic',
  'vargraphic',
]);

const BINARY_NAMES = new Set([
  'bytea',
  'binary',
  'varbinary',
  'blob',
  'longblob',
  'mediumblob',
  'tinyblob',
  'image',
  'raw',
  'long raw',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;
// The three suppressions below are the linter's star-height heuristic firing on
// nested *optional* groups. Every quantifier here is bounded ({1,2}, {2}, {1,9})
// or sits in a group that is never itself repeated, so there is no ambiguity to
// backtrack over. Measured against adversarial input (a valid prefix then a
// failing character): runtime is linear from n=1,000 to n=8,000 characters.
// eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored, every quantifier bounded
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2}(\.\d{1,9})?)?$/;
const TIMESTAMP_RE =
  // eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored, every quantifier bounded
  /^\d{4}-\d{1,2}-\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?(\s*(Z|[+-]\d{1,2}(:?\d{2})?))?$/i;
const INTEGER_RE = /^[+-]?\d+$/;
// eslint-disable-next-line security/detect-unsafe-regex -- false positive: the alternation group is never repeated
const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const BOOL_WORDS = new Set(['true', 'false', 't', 'f', 'yes', 'no', 'y', 'n', '1', '0']);

/**
 * Split a catalog type into a kind plus any limits it carries.
 * Handles `varchar(200)`, `numeric(10,2)`, `timestamp(6) with time zone`,
 * `varchar(max)`, and unparameterised names.
 */
export function describeSqlType(rawType: string): TypeFacts {
  const type = (rawType ?? '').trim().toLowerCase();
  if (!type) return { kind: 'other' };

  const argMatch = /\(([^)]*)\)/.exec(type);
  const args = argMatch?.[1]?.split(',').map((a) => a.trim()) ?? [];
  const base = type.replace(/\([^)]*\)/, ' ').replace(/\s+/g, ' ').trim();
  const firstArg = args[0];
  const num = (v: string | undefined): number | undefined => {
    if (!v || !/^\d+$/.test(v)) return undefined;
    return Number(v);
  };

  if (base.startsWith('bool') || base === 'bit') return { kind: 'boolean' };
  if (base === 'uuid' || base === 'uniqueidentifier') return { kind: 'uuid' };
  if (base === 'json' || base === 'jsonb') return { kind: 'json' };

  if (base.startsWith('timestamp') || base.startsWith('datetime') || base === 'smalldatetime') {
    return { kind: 'timestamp' };
  }
  if (base === 'date') return { kind: 'date' };
  if (base.startsWith('time')) return { kind: 'time' };

  if (INTEGER_NAMES.has(base)) return { kind: 'integer', ...(INT_RANGES[base] ?? {}) };

  if (DECIMAL_NAMES.has(base)) {
    // number/numeric with scale 0 is an integer column in practice (Oracle).
    const precision = num(firstArg);
    const scale = num(args[1]);
    if (precision !== undefined && scale === 0) return { kind: 'integer', precision, scale };
    return { kind: 'decimal', precision, scale };
  }

  if (TEXT_NAMES.has(base)) {
    // `varchar(max)` / `nvarchar(max)` carry no usable limit.
    return { kind: 'text', maxLength: num(firstArg) };
  }

  if (BINARY_NAMES.has(base)) return { kind: 'binary' };

  return { kind: 'other' };
}

function typeHint(facts: TypeFacts, rawType: string): string {
  switch (facts.kind) {
    case 'integer':
      return 'whole number';
    case 'decimal':
      return facts.precision !== undefined && facts.scale !== undefined
        ? `number (${facts.precision - facts.scale} digits, ${facts.scale} decimals)`
        : 'number';
    case 'boolean':
      return 'true or false';
    case 'date':
      return 'YYYY-MM-DD';
    case 'time':
      return 'HH:MM[:SS]';
    case 'timestamp':
      return 'YYYY-MM-DD HH:MM[:SS]';
    case 'uuid':
      return 'UUID';
    case 'json':
      return 'JSON';
    case 'text':
      return facts.maxLength ? `text, max ${facts.maxLength}` : 'text';
    default:
      return rawType || 'value';
  }
}

/** Describe every column in the form, in grid column order. */
export function buildPeekFields(args: {
  mode: PeekFieldMode;
  /** Grid columns, which drive the form's field order. */
  columns: string[];
  table: Pick<TableSchema, 'columns'>;
  keyNames: string[];
  identityColumns: Set<string>;
}): PeekField[] {
  const { mode, columns, table, keyNames, identityColumns } = args;
  const keyLower = new Set(keyNames.map((k) => k.toLowerCase()));
  const identityLower = new Set([...identityColumns].map((c) => c.toLowerCase()));

  return columns.map((name) => {
    const meta: ColumnInfo | undefined = table.columns.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    const rawType = meta?.type ?? '';
    const facts = describeSqlType(rawType);
    const isKey = keyLower.has(name.toLowerCase());
    const isIdentity = identityLower.has(name.toLowerCase()) || Boolean(meta?.identity);
    const hasDefault = meta?.defaultValue != null && meta.defaultValue !== '';

    // Auto-generated columns are never typed by hand: on insert the engine
    // supplies the value, and on update changing it would retarget the row.
    // Keys stay locked while editing for the same reason.
    const readOnly = isIdentity || (mode === 'edit' && isKey);
    const hint = isIdentity
      ? 'auto-generated'
      : readOnly
        ? 'key — used to find the row'
        : hasDefault
          ? `${typeHint(facts, rawType)} · blank = default`
          : facts.kind === 'other' && !rawType
            ? 'value'
            : `${typeHint(facts, rawType)}${meta?.nullable === false ? '' : ' · blank = NULL'}`;

    return {
      name,
      type: rawType,
      nullable: meta?.nullable ?? true,
      isKey,
      isIdentity,
      hasDefault,
      readOnly,
      hint,
      ...facts,
    };
  });
}

function digitsAroundPoint(value: string): { whole: number; fraction: number } {
  const unsigned = value.replace(/^[+-]/, '');
  const [wholePart = '', fractionPart = ''] = unsigned.split('.');
  // Leading zeros do not count against precision (0.50 fits numeric(2,2)).
  const whole = wholePart.replace(/^0+/, '').length;
  const fraction = fractionPart.replace(/0+$/, '').length;
  return { whole, fraction };
}

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (m < 1 || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * Check one value. Returns a message, or null when the value is acceptable.
 * Blank means SQL NULL, matching how the form's draft is turned into DML.
 */
export function validatePeekField(field: PeekField, raw: string): string | null {
  if (field.readOnly) return null;
  const value = raw ?? '';

  if (value === '') {
    if (field.nullable || field.hasDefault || field.isIdentity) return null;
    return 'Required — column is NOT NULL';
  }

  switch (field.kind) {
    case 'integer': {
      if (!INTEGER_RE.test(value.trim())) return 'Whole number required';
      const n = BigInt(value.trim());
      if (field.min !== undefined && n < field.min) return `Below minimum (${field.min})`;
      if (field.max !== undefined && n > field.max) return `Above maximum (${field.max})`;
      if (field.precision !== undefined) {
        const { whole } = digitsAroundPoint(value.trim());
        if (whole > field.precision) return `More than ${field.precision} digits`;
      }
      return null;
    }
    case 'decimal': {
      const trimmed = value.trim();
      if (!DECIMAL_RE.test(trimmed)) return 'Number required';
      if (field.precision !== undefined && field.scale !== undefined && !/[eE]/.test(trimmed)) {
        const { whole, fraction } = digitsAroundPoint(trimmed);
        if (fraction > field.scale) {
          return `At most ${field.scale} decimal place${field.scale === 1 ? '' : 's'}`;
        }
        if (whole > field.precision - field.scale) {
          return `At most ${field.precision - field.scale} digits before the decimal point`;
        }
      }
      return null;
    }
    case 'boolean':
      return BOOL_WORDS.has(value.trim().toLowerCase()) ? null : 'Use true or false';
    case 'date':
      if (!DATE_RE.test(value.trim())) return 'Use YYYY-MM-DD';
      return isRealDate(value.trim()) ? null : 'Not a real date';
    case 'time':
      return TIME_RE.test(value.trim()) ? null : 'Use HH:MM[:SS]';
    case 'timestamp':
      return TIMESTAMP_RE.test(value.trim()) ? null : 'Use YYYY-MM-DD HH:MM[:SS]';
    case 'uuid':
      return UUID_RE.test(value.trim()) ? null : 'Not a UUID';
    case 'json':
      try {
        JSON.parse(value);
        return null;
      } catch {
        return 'Invalid JSON';
      }
    case 'text':
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `Too long — max ${field.maxLength} characters`;
      }
      return null;
    default:
      // Binary and unrecognised types: the engine is the better judge.
      return null;
  }
}

/** Field name → message for every field that fails. */
export function validatePeekRow(
  fields: PeekField[],
  draft: Record<string, string>
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const message = validatePeekField(field, draft[field.name] ?? '');
    if (message) errors[field.name] = message;
  }
  return errors;
}
