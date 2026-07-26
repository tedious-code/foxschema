import { describe, expect, it } from 'vitest';
import type { ColumnInfo } from '../../lib/types';
import {
  applyTypeSize,
  buildColumnDef,
  classifyColumnType,
  defaultDialectColumnType,
  dialectBooleanDefaultOptions,
  dialectIdentitySupport,
  diffBlueprintColumns,
  generateBlueprintAlterSql,
  generateCreateTableSql,
  generateDropTableSql,
  generatePkAlterSql,
  generateTableBlueprintSql,
  isIntegerAutoIncrementType,
  listDialectDataTypes,
  parseTypeSize,
  quoteIdent,
} from './tableBlueprintSql';

const col = (partial: Partial<ColumnInfo> & Pick<ColumnInfo, 'name' | 'type'>): ColumnInfo => ({
  nullable: true,
  primaryKey: false,
  ...partial,
});

describe('quoteIdent', () => {
  it('leaves plain names unquoted', () => {
    expect(quoteIdent('orders', 'postgres')).toBe('orders');
  });

  it('quotes special names per dialect', () => {
    expect(quoteIdent('my col', 'postgres')).toBe('"my col"');
    expect(quoteIdent('my col', 'mysql')).toBe('`my col`');
    expect(quoteIdent('my col', 'sqlserver')).toBe('[my col]');
  });
});

describe('listDialectDataTypes', () => {
  it('renders postgres-native names', () => {
    const types = listDialectDataTypes('postgres');
    const values = types.map((t) => t.value);
    expect(values).toContain('integer');
    expect(values).toContain('bigint');
    expect(values).toContain('varchar(255)');
    expect(values).toContain('boolean');
    expect(values).toContain('timestamptz');
  });

  it('renders mysql-native names', () => {
    const types = listDialectDataTypes('mysql');
    const values = types.map((t) => t.value);
    expect(values).toContain('int');
    expect(values).toContain('bigint');
    expect(values).toContain('tinyint(1)');
    expect(values).toContain('varchar(255)');
  });

  it('marks integer-like options for auto-inc', () => {
    const intOpt = listDialectDataTypes('postgres').find((t) => t.value === 'integer');
    expect(intOpt?.integerLike).toBe(true);
    const varchar = listDialectDataTypes('postgres').find((t) => t.value === 'varchar(255)');
    expect(varchar?.integerLike).toBe(false);
  });

  it('defaultDialectColumnType prefers varchar(255)', () => {
    expect(defaultDialectColumnType('postgres')).toBe('varchar(255)');
    expect(defaultDialectColumnType('mysql')).toBe('varchar(255)');
  });
});

describe('classifyColumnType / sizes / boolean defaults', () => {
  it('classifies kinds', () => {
    expect(classifyColumnType('integer')).toBe('integer');
    expect(classifyColumnType('varchar(50)')).toBe('text');
    expect(classifyColumnType('numeric(10,2)')).toBe('decimal');
    expect(classifyColumnType('boolean')).toBe('boolean');
    expect(classifyColumnType('tinyint(1)')).toBe('boolean');
    expect(classifyColumnType('timestamptz')).toBe('datetime');
  });

  it('parses and applies varchar length', () => {
    expect(parseTypeSize('varchar(255)')).toEqual({ kind: 'length', length: 255 });
    expect(applyTypeSize('varchar(255)', { length: 100 })).toBe('varchar(100)');
  });

  it('parses and applies decimal precision/scale', () => {
    expect(parseTypeSize('decimal(10,2)')).toEqual({
      kind: 'decimal',
      precision: 10,
      scale: 2,
    });
    expect(applyTypeSize('numeric(10,2)', { precision: 18, scale: 4 })).toBe('numeric(18,4)');
  });

  it('offers dialect boolean defaults', () => {
    expect(dialectBooleanDefaultOptions('postgres').map((o) => o.value)).toEqual([
      '',
      'TRUE',
      'FALSE',
      'NULL',
    ]);
    expect(dialectBooleanDefaultOptions('mysql').some((o) => o.value === '1')).toBe(true);
    expect(dialectBooleanDefaultOptions('sqlserver').map((o) => o.value)).toEqual([
      '',
      '1',
      '0',
      'NULL',
    ]);
  });

  it('hides auto-inc for boolean and decimal', () => {
    expect(isIntegerAutoIncrementType('boolean')).toBe(false);
    expect(isIntegerAutoIncrementType('tinyint(1)')).toBe(false);
    expect(isIntegerAutoIncrementType('decimal(10,2)')).toBe(false);
    expect(isIntegerAutoIncrementType('bigint')).toBe(true);
  });

  it('emits UNIQUE when set', () => {
    expect(
      buildColumnDef(
        { name: 'email', type: 'varchar(255)', nullable: false, primaryKey: false, unique: true },
        'postgres'
      )
    ).toContain('UNIQUE');
  });
});

describe('dialectIdentitySupport', () => {
  it('exposes AUTO_INCREMENT for mysql', () => {
    expect(dialectIdentitySupport('mysql').label).toBe('Auto increment');
    expect(dialectIdentitySupport('mysql').clauseHint).toBe('AUTO_INCREMENT');
    expect(dialectIdentitySupport('mysql').supported).toBe(true);
  });

  it('exposes GENERATED options for postgres', () => {
    expect(dialectIdentitySupport('postgres').generations).toEqual(['ALWAYS', 'BY DEFAULT']);
  });

  it('marks sqlite supported with AUTOINCREMENT', () => {
    expect(dialectIdentitySupport('sqlite').supported).toBe(true);
    expect(dialectIdentitySupport('sqlite').clauseHint).toBe('AUTOINCREMENT');
  });
});

describe('buildColumnDef', () => {
  it('builds postgres-style add column def', () => {
    expect(
      buildColumnDef(
        col({ name: 'status', type: 'varchar(32)', nullable: false, defaultValue: `'open'` }),
        'postgres'
      )
    ).toBe(`status varchar(32) DEFAULT 'open' NOT NULL`);
  });

  it('appends identity clause for postgres', () => {
    expect(
      buildColumnDef(
        col({
          name: 'id',
          type: 'integer',
          nullable: false,
          identity: true,
          identityGeneration: 'BY DEFAULT',
        }),
        'postgres'
      )
    ).toContain('GENERATED BY DEFAULT AS IDENTITY');
  });

  it('appends AUTO_INCREMENT for mysql', () => {
    expect(
      buildColumnDef(col({ name: 'id', type: 'int', nullable: false, identity: true }), 'mysql')
    ).toContain('AUTO_INCREMENT');
  });

  it('omits identity clause when type is not int/long', () => {
    expect(
      buildColumnDef(
        col({ name: 'name', type: 'varchar(50)', nullable: false, identity: true }),
        'mysql'
      )
    ).not.toContain('AUTO_INCREMENT');
  });
});

describe('diffBlueprintColumns + generateBlueprintAlterSql', () => {
  const original = [
    col({ name: 'id', type: 'integer', nullable: false, primaryKey: true }),
    col({ name: 'name', type: 'varchar(100)', nullable: false }),
  ];

  it('generates ADD for postgres', () => {
    const draft = [...original, col({ name: 'sku', type: 'varchar(50)', nullable: true })];
    const ops = diffBlueprintColumns(original, draft, new Set());
    const sql = generateBlueprintAlterSql('products', 'postgres', ops);
    expect(sql).toEqual(['ALTER TABLE products ADD COLUMN sku varchar(50);']);
  });

  it('generates DROP for postgres', () => {
    const ops = diffBlueprintColumns(original, original, new Set(['name']));
    const sql = generateBlueprintAlterSql('products', 'postgres', ops);
    expect(sql).toEqual(['ALTER TABLE products DROP COLUMN name;']);
  });

  it('generates MODIFY for mysql', () => {
    const draft = [original[0]!, col({ name: 'name', type: 'varchar(200)', nullable: false })];
    const ops = diffBlueprintColumns(original, draft, new Set());
    const sql = generateBlueprintAlterSql('products', 'mysql', ops);
    expect(sql.some((s) => s.includes('MODIFY COLUMN name varchar(200)'))).toBe(true);
  });

  it('generates DROP then ADD order', () => {
    const draft = [original[0]!, col({ name: 'code', type: 'text', nullable: true })];
    const ops = diffBlueprintColumns(original, draft, new Set(['name']));
    const sql = generateBlueprintAlterSql('products', 'postgres', ops);
    expect(sql[0]).toContain('DROP COLUMN name');
    expect(sql[1]).toContain('ADD COLUMN code text');
  });

  it('emits set default when only default changes (postgres)', () => {
    const draft = [
      original[0]!,
      col({ name: 'name', type: 'varchar(100)', nullable: false, defaultValue: `'x'` }),
    ];
    const ops = diffBlueprintColumns(original, draft, new Set());
    const sql = generateBlueprintAlterSql('products', 'postgres', ops);
    expect(sql).toEqual([`ALTER TABLE products ALTER COLUMN name SET DEFAULT 'x';`]);
  });
});

describe('primary key alter', () => {
  it('adds composite primary key', () => {
    const sql = generatePkAlterSql('order_lines', 'postgres', [], ['order_id', 'line_no']);
    expect(sql).toEqual([
      'ALTER TABLE order_lines ADD PRIMARY KEY (order_id, line_no);',
    ]);
  });

  it('drops then recreates when key changes', () => {
    const sql = generatePkAlterSql('t', 'mysql', ['id'], ['a', 'b'], 'PRIMARY');
    expect(sql[0]).toMatch(/DROP PRIMARY KEY/i);
    expect(sql[1]).toBe('ALTER TABLE t ADD PRIMARY KEY (a, b);');
  });
});

describe('create / drop table', () => {
  it('creates with IF NOT EXISTS and composite PK (postgres)', () => {
    const sql = generateCreateTableSql(
      'order_lines',
      [
        col({ name: 'order_id', type: 'integer', nullable: false }),
        col({ name: 'line_no', type: 'integer', nullable: false }),
        col({ name: 'qty', type: 'integer', nullable: true }),
      ],
      ['order_id', 'line_no'],
      'postgres'
    );
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^CREATE TABLE IF NOT EXISTS order_lines/);
    expect(sql[0]).toContain('PRIMARY KEY (order_id, line_no)');
    expect(sql[0]).not.toMatch(/INTEGER NOT NULL PRIMARY KEY/);
  });

  it('uses OBJECT_ID guard for sqlserver create', () => {
    const sql = generateCreateTableSql(
      't',
      [col({ name: 'id', type: 'int', nullable: false, identity: true })],
      ['id'],
      'sqlserver'
    );
    expect(sql[0]).toMatch(/IF OBJECT_ID\(N't', N'U'\) IS NULL/);
    expect(sql[0]).toContain('IDENTITY(1,1)');
  });

  it('drops with IF EXISTS for postgres', () => {
    expect(generateDropTableSql('products', 'postgres')).toEqual([
      'DROP TABLE IF EXISTS products;',
    ]);
  });

  it('uses dialect drop hook for oracle', () => {
    const sql = generateDropTableSql('products', 'oracle');
    expect(sql[0]).toMatch(/DROP TABLE/i);
  });
});

describe('generateTableBlueprintSql', () => {
  it('emits column alter then pk add', () => {
    const sql = generateTableBlueprintSql({
      tableName: 't',
      dialect: 'postgres',
      columnOps: [{ kind: 'add', column: col({ name: 'b', type: 'int', nullable: false }) }],
      previousPk: ['a'],
      nextPk: ['a', 'b'],
    });
    expect(sql.some((s) => s.includes('ADD COLUMN b'))).toBe(true);
    expect(sql.some((s) => s.includes('PRIMARY KEY (a, b)'))).toBe(true);
  });
});
