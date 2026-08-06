import { describe, expect, it } from 'vitest';
import {
  buildPeekFields,
  describeSqlType,
  validatePeekField,
  validatePeekRow,
  type PeekField,
} from './peekRowValidation';
import type { ColumnInfo, TableSchema } from './types';

function col(partial: Partial<ColumnInfo> & { name: string }): ColumnInfo {
  return {
    type: 'varchar(50)',
    nullable: true,
    primaryKey: false,
    ...partial,
  } as ColumnInfo;
}

function table(columns: ColumnInfo[]): Pick<TableSchema, 'columns'> {
  return { columns };
}

/** Build one field for value-level assertions. */
function fieldFor(type: string, extra: Partial<ColumnInfo> = {}): PeekField {
  return buildPeekFields({
    mode: 'add',
    columns: ['c'],
    table: table([col({ name: 'c', type, ...extra })]),
    keyNames: [],
    identityColumns: new Set(),
  })[0]!;
}

describe('describeSqlType', () => {
  it('reads length and precision out of parameterised types', () => {
    expect(describeSqlType('varchar(200)')).toMatchObject({ kind: 'text', maxLength: 200 });
    expect(describeSqlType('numeric(10,2)')).toMatchObject({
      kind: 'decimal',
      precision: 10,
      scale: 2,
    });
    expect(describeSqlType('NVARCHAR(4000)')).toMatchObject({ kind: 'text', maxLength: 4000 });
  });

  it('treats scale 0 numerics as integers (Oracle NUMBER(10,0))', () => {
    expect(describeSqlType('NUMBER(10,0)')).toMatchObject({ kind: 'integer', precision: 10 });
  });

  it('carries integer ranges only where dialects agree', () => {
    expect(describeSqlType('smallint')).toMatchObject({ kind: 'integer', max: 32767n });
    expect(describeSqlType('int')).toMatchObject({ kind: 'integer', max: 2147483647n });
    // tinyint differs between engines, so no range is claimed.
    expect(describeSqlType('tinyint')).toEqual({ kind: 'integer' });
  });

  it('classifies the temporal family', () => {
    expect(describeSqlType('date').kind).toBe('date');
    expect(describeSqlType('time(6) without time zone').kind).toBe('time');
    expect(describeSqlType('timestamp with time zone').kind).toBe('timestamp');
    expect(describeSqlType('datetime2(7)').kind).toBe('timestamp');
  });

  it('classifies the rest', () => {
    expect(describeSqlType('uniqueidentifier').kind).toBe('uuid');
    expect(describeSqlType('jsonb').kind).toBe('json');
    expect(describeSqlType('boolean').kind).toBe('boolean');
    expect(describeSqlType('bit').kind).toBe('boolean');
    expect(describeSqlType('bytea').kind).toBe('binary');
    expect(describeSqlType('varchar(max)')).toEqual({ kind: 'text', maxLength: undefined });
    expect(describeSqlType('').kind).toBe('other');
  });
});

describe('buildPeekFields', () => {
  const cols = [
    col({ name: 'id', type: 'int', nullable: false, primaryKey: true, identity: true }),
    col({ name: 'email', type: 'varchar(100)', nullable: false }),
    col({ name: 'note', type: 'varchar(20)' }),
    col({ name: 'created', type: 'timestamp', nullable: false, defaultValue: 'now()' }),
  ];

  it('locks auto-increment columns on insert', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['id', 'email'],
      table: table(cols),
      keyNames: ['id'],
      identityColumns: new Set(['id']),
    });
    expect(fields[0]).toMatchObject({ name: 'id', isIdentity: true, readOnly: true });
    expect(fields[0]!.hint).toMatch(/auto-generated/i);
    expect(fields[1]).toMatchObject({ name: 'email', readOnly: false });
  });

  it('locks auto-increment columns on edit and clone too', () => {
    for (const mode of ['edit', 'clone'] as const) {
      const fields = buildPeekFields({
        mode,
        columns: ['id'],
        table: table(cols),
        keyNames: ['id'],
        identityColumns: new Set(['id']),
      });
      expect(fields[0]!.readOnly, mode).toBe(true);
    }
  });

  it('locks key columns while editing but not while cloning', () => {
    const plainKey = [col({ name: 'code', type: 'varchar(10)', nullable: false, primaryKey: true })];
    const asEdit = buildPeekFields({
      mode: 'edit',
      columns: ['code'],
      table: table(plainKey),
      keyNames: ['code'],
      identityColumns: new Set(),
    });
    const asClone = buildPeekFields({
      mode: 'clone',
      columns: ['code'],
      table: table(plainKey),
      keyNames: ['code'],
      identityColumns: new Set(),
    });
    expect(asEdit[0]!.readOnly).toBe(true);
    expect(asClone[0]!.readOnly).toBe(false);
  });

  it('matches identity and key names case-insensitively', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['ID'],
      table: table([col({ name: 'id', type: 'int', identity: true })]),
      keyNames: ['Id'],
      identityColumns: new Set(['id']),
    });
    expect(fields[0]).toMatchObject({ isIdentity: true, isKey: true, readOnly: true });
  });

  it('says blank means default when the column has one', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['created'],
      table: table(cols),
      keyNames: [],
      identityColumns: new Set(),
    });
    expect(fields[0]!.hint).toMatch(/blank = default/i);
  });

  it('keeps grid column order and tolerates unknown columns', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['note', 'email', 'computed'],
      table: table(cols),
      keyNames: [],
      identityColumns: new Set(),
    });
    expect(fields.map((f) => f.name)).toEqual(['note', 'email', 'computed']);
    expect(fields[2]).toMatchObject({ type: '', kind: 'other', nullable: true });
  });
});

describe('validatePeekField', () => {
  it('requires a value only for NOT NULL columns without a default', () => {
    expect(validatePeekField(fieldFor('varchar(10)', { nullable: false }), '')).toMatch(
      /NOT NULL/
    );
    expect(validatePeekField(fieldFor('varchar(10)', { nullable: true }), '')).toBeNull();
    expect(
      validatePeekField(fieldFor('int', { nullable: false, defaultValue: '0' }), '')
    ).toBeNull();
  });

  it('never blocks a locked field', () => {
    const identity = fieldFor('int', { nullable: false, identity: true });
    expect(validatePeekField(identity, '')).toBeNull();
    expect(validatePeekField(identity, 'not a number')).toBeNull();
  });

  it('checks integers and their range', () => {
    const int = fieldFor('int');
    expect(validatePeekField(int, '42')).toBeNull();
    expect(validatePeekField(int, '-7')).toBeNull();
    expect(validatePeekField(int, '4.5')).toMatch(/whole number/i);
    expect(validatePeekField(int, 'abc')).toMatch(/whole number/i);
    expect(validatePeekField(int, '2147483648')).toMatch(/above maximum/i);
    expect(validatePeekField(fieldFor('smallint'), '-40000')).toMatch(/below minimum/i);
    // bigint is past Number precision, so the check must not go through float.
    expect(validatePeekField(fieldFor('bigint'), '9223372036854775807')).toBeNull();
    expect(validatePeekField(fieldFor('bigint'), '9223372036854775808')).toMatch(
      /above maximum/i
    );
  });

  it('checks decimal precision and scale', () => {
    const money = fieldFor('numeric(6,2)');
    expect(validatePeekField(money, '1234.56')).toBeNull();
    expect(validatePeekField(money, '0.50')).toBeNull();
    expect(validatePeekField(money, '1234.567')).toMatch(/2 decimal places/i);
    expect(validatePeekField(money, '12345.6')).toMatch(/4 digits before/i);
    expect(validatePeekField(money, 'x')).toMatch(/number required/i);
    // Unparameterised floats accept exponent notation.
    expect(validatePeekField(fieldFor('double precision'), '1.5e-9')).toBeNull();
  });

  it('checks booleans', () => {
    const flag = fieldFor('boolean');
    for (const ok of ['true', 'FALSE', '1', '0', 'yes', 'n']) {
      expect(validatePeekField(flag, ok), ok).toBeNull();
    }
    expect(validatePeekField(flag, 'maybe')).toMatch(/true or false/i);
  });

  it('checks dates, times, and timestamps', () => {
    expect(validatePeekField(fieldFor('date'), '2026-08-06')).toBeNull();
    expect(validatePeekField(fieldFor('date'), '06/08/2026')).toMatch(/YYYY-MM-DD/);
    expect(validatePeekField(fieldFor('date'), '2026-02-30')).toMatch(/real date/i);
    expect(validatePeekField(fieldFor('time'), '13:45')).toBeNull();
    expect(validatePeekField(fieldFor('time'), '13:45:59.123')).toBeNull();
    expect(validatePeekField(fieldFor('time'), '25 past noon')).toMatch(/HH:MM/);
    const ts = fieldFor('timestamp');
    expect(validatePeekField(ts, '2026-08-06 13:45')).toBeNull();
    expect(validatePeekField(ts, '2026-08-06T13:45:59Z')).toBeNull();
    expect(validatePeekField(ts, '2026-08-06 13:45:59+02:00')).toBeNull();
    expect(validatePeekField(ts, 'yesterday')).toMatch(/YYYY-MM-DD/);
  });

  it('checks uuid, json, and text length', () => {
    expect(
      validatePeekField(fieldFor('uuid'), '86492457-c389-4092-a1ff-c41a7170e4a4')
    ).toBeNull();
    expect(validatePeekField(fieldFor('uuid'), '1234')).toMatch(/not a uuid/i);
    expect(validatePeekField(fieldFor('jsonb'), '{"a":1}')).toBeNull();
    expect(validatePeekField(fieldFor('jsonb'), '{a:1}')).toMatch(/invalid json/i);
    expect(validatePeekField(fieldFor('varchar(3)'), 'abcd')).toMatch(/max 3 characters/i);
    expect(validatePeekField(fieldFor('varchar(3)'), 'abc')).toBeNull();
    // `varchar(max)` has no limit to enforce.
    expect(validatePeekField(fieldFor('varchar(max)'), 'x'.repeat(5000))).toBeNull();
  });

  it('leaves binary and unknown types to the engine', () => {
    expect(validatePeekField(fieldFor('bytea'), '\\xdeadbeef')).toBeNull();
    expect(validatePeekField(fieldFor('geography'), 'POINT(1 2)')).toBeNull();
  });
});

describe('validatePeekRow', () => {
  it('reports one message per failing field', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['id', 'email', 'age', 'note'],
      table: table([
        col({ name: 'id', type: 'int', nullable: false, primaryKey: true, identity: true }),
        col({ name: 'email', type: 'varchar(5)', nullable: false }),
        col({ name: 'age', type: 'int' }),
        col({ name: 'note', type: 'varchar(50)' }),
      ]),
      keyNames: ['id'],
      identityColumns: new Set(['id']),
    });

    expect(
      validatePeekRow(fields, { id: '', email: 'a@b.com', age: 'old', note: '' })
    ).toEqual({
      email: 'Too long — max 5 characters',
      age: 'Whole number required',
    });

    expect(validatePeekRow(fields, { id: '', email: 'a@b', age: '30', note: '' })).toEqual({});
  });

  it('treats a missing draft entry as blank', () => {
    const fields = buildPeekFields({
      mode: 'add',
      columns: ['email'],
      table: table([col({ name: 'email', type: 'varchar(50)', nullable: false })]),
      keyNames: [],
      identityColumns: new Set(),
    });
    expect(validatePeekRow(fields, {})).toEqual({ email: 'Required — column is NOT NULL' });
  });
});
