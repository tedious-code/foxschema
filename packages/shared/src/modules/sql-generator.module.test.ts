import { describe, it, expect } from 'vitest';
import { SqlGeneratorModule } from './sql-generator.module';
import { TableDiff } from '../interfaces/diff.types.interface';
import { TableSchema } from '../interfaces/schema.interface';

const gen = new SqlGeneratorModule();

const tableSchema = (over: Partial<TableSchema> & { name: string }): TableSchema => ({
  objectType: 'TABLE',
  columns: [],
  indices: [],
  foreignKeys: [],
  ...over,
});

describe('SqlGeneratorModule.generateObjectDdl', () => {
  it('renders a composite primary key as a table-level constraint', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({
        name: 'ORDERS',
        primaryKey: { name: 'PK_ORDERS', columns: ['ORDER_ID', 'LINE_NO'] },
        columns: [
          { name: 'ORDER_ID', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'LINE_NO', type: 'INTEGER', nullable: false, primaryKey: true },
        ],
      })
    );
    expect(ddl).toContain('CONSTRAINT PK_ORDERS PRIMARY KEY (ORDER_ID, LINE_NO)');
    // must NOT inline PRIMARY KEY per column (invalid for composite keys)
    expect(ddl).not.toMatch(/INTEGER NOT NULL PRIMARY KEY/);
  });

  it('renders an identity column', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({
        name: 'T',
        columns: [{ name: 'ID', type: 'INTEGER', nullable: false, primaryKey: true, identity: true, identityGeneration: 'ALWAYS' }],
      })
    );
    expect(ddl).toContain('GENERATED ALWAYS AS IDENTITY');
  });

  it('renders a sequence with its attributes', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({ name: 'SEQ', objectType: 'SEQUENCE', sequence: { dataType: 'BIGINT', start: '1', increment: '1', cache: 20 } })
    );
    expect(ddl).toContain('CREATE SEQUENCE SEQ AS BIGINT START WITH 1 INCREMENT BY 1');
    expect(ddl).toContain('CACHE 20');
  });

  it('renders a structured type with its attributes', () => {
    const ddl = gen.generateObjectDdl(
      tableSchema({ name: 'ADDR', objectType: 'TYPE', userType: { attributes: [{ name: 'STREET', type: 'VARCHAR(100)' }] } })
    );
    expect(ddl).toContain('CREATE TYPE ADDR AS (');
    expect(ddl).toContain('STREET VARCHAR(100)');
  });
});

describe('SqlGeneratorModule.generateMigrationPlan', () => {
  const addedTable = (name: string): TableDiff => ({
    tableName: name,
    objectType: 'TABLE',
    status: 'ADDED',
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    sourceTable: tableSchema({ name, columns: [{ name: 'ID', type: 'INTEGER', nullable: false, primaryKey: false }] }),
  });

  it('orders steps drop → create → alter', () => {
    const diffs: TableDiff[] = [
      { ...addedTable('NEW') },
      { tableName: 'OLD', objectType: 'TABLE', status: 'REMOVED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [], targetTable: tableSchema({ name: 'OLD' }) },
    ];
    const plan = gen.generateMigrationPlan(diffs, 'db2');
    expect(plan.map((s) => s.action)).toEqual(['DROP', 'CREATE']);
  });

  it('re-qualifies object names to the target schema regardless of source prefix', () => {
    const plan = gen.generateMigrationPlan([addedTable('CARTER.GPX')], 'db2', { sourceSchema: 'HUY', targetSchema: 'VLAD' });
    const sql = plan.flatMap((s) => s.statements).join('\n');
    expect(sql).toContain('CREATE TABLE VLAD.GPX');
    expect(sql).not.toContain('CARTER.');
  });

  it('emits nothing when there are no changes', () => {
    const plan = gen.generateMigrationPlan([
      { tableName: 'A', objectType: 'TABLE', status: 'UNCHANGED', columnDiffs: [], indexDiffs: [], foreignKeyDiffs: [] },
    ], 'db2');
    expect(plan).toHaveLength(0);
  });

  it('drops then recreates a modified trigger', () => {
    const diff: TableDiff = {
      tableName: 'ORDERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      triggerDiffs: [{ name: 'TRG', status: 'MODIFIED', source: { definition: 'CREATE TRIGGER TRG ...' } }],
    };
    const stmts = gen.generateMigrationPlan([diff], 'db2').flatMap((s) => s.statements);
    expect(stmts).toContain('DROP TRIGGER TRG;');
    expect(stmts.some((s) => s.includes('CREATE TRIGGER TRG'))).toBe(true);
  });
});
