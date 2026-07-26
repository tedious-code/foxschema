import { describe, expect, it } from 'vitest';
import { dbSchemaToTableSchemas, normalizeTableSchemas } from './schema-to-tables';
import type { DbSchema, DbTable } from '../interfaces';

function emptySchema(tables: Record<string, DbTable>): DbSchema {
  return {
    tables,
    columns: {},
    functions: {},
    procedures: {},
    triggers: {},
    sequences: {},
    userTypes: {},
    primaryKeys: {},
    foreignKeys: {},
    views: {},
    uniqueConstraints: {},
    indexes: {},
    indexColumns: {},
  };
}

describe('dbSchemaToTableSchemas foreign keys', () => {
  it('preserves composite FK referenced column order (not parent PK order)', () => {
    const parent: DbTable = {
      name: 'test1',
      columns: {
        id1: { name: 'id1', type: 'int', nullable: false },
        id2: { name: 'id2', type: 'int', nullable: false },
      },
      primaryKey: ['id1', 'id2'],
      foreignKeys: [],
      uniqueConstraints: [],
      indexes: [],
    };
    const child: DbTable = {
      name: 'test2',
      columns: {
        test1_id2: { name: 'test1_id2', type: 'int', nullable: false },
        test1_id1: { name: 'test1_id1', type: 'int', nullable: false },
      },
      primaryKey: [],
      foreignKeys: [
        {
          name: 'fk_test2_test1',
          columns: ['test1_id2', 'test1_id1'],
          referencedSchema: 'mcve',
          referencedTable: 'test1',
          referencedColumns: ['id2', 'id1'],
        },
      ],
      uniqueConstraints: [],
      indexes: [],
    };

    const tables = dbSchemaToTableSchemas(
      emptySchema({ test1: parent, test2: child })
    );
    const test2 = tables.find((t) => t.name === 'test2');
    expect(test2?.foreignKeys).toEqual([
      {
        name: 'fk_test2_test1',
        columns: ['test1_id2', 'test1_id1'],
        referencedTable: 'test1',
        referencedColumns: ['id2', 'id1'],
      },
    ]);
  });

  it('falls back to parent PK when referencedColumns missing', () => {
    const parent: DbTable = {
      name: 'parent',
      columns: {
        a: { name: 'a', type: 'int', nullable: false },
        b: { name: 'b', type: 'int', nullable: false },
      },
      primaryKey: ['a', 'b'],
      foreignKeys: [],
      uniqueConstraints: [],
      indexes: [],
    };
    const child: DbTable = {
      name: 'child',
      columns: {
        a: { name: 'a', type: 'int', nullable: false },
        b: { name: 'b', type: 'int', nullable: false },
      },
      primaryKey: [],
      foreignKeys: [
        {
          name: 'fk_child',
          columns: ['a', 'b'],
          referencedSchema: '',
          referencedTable: 'parent',
          // omit referencedColumns — upgrade-compat path
        },
      ],
      uniqueConstraints: [],
      indexes: [],
    };

    const tables = dbSchemaToTableSchemas(emptySchema({ parent, child }));
    const fk = tables.find((t) => t.name === 'child')?.foreignKeys[0];
    expect(fk?.referencedColumns).toEqual(['a', 'b']);
  });
});

describe('normalizeTableSchemas', () => {
  it('fills omitted referencedColumns from parent PK for old client payloads', () => {
    const tables = normalizeTableSchemas([
      {
        name: 'parent',
        objectType: 'TABLE',
        columns: [
          { name: 'id1', type: 'int', nullable: false, primaryKey: true },
          { name: 'id2', type: 'int', nullable: false, primaryKey: true },
        ],
        indices: [],
        foreignKeys: [],
        primaryKey: { columns: ['id1', 'id2'] },
      },
      {
        name: 'child',
        objectType: 'TABLE',
        columns: [
          { name: 'id1', type: 'int', nullable: false, primaryKey: false },
          { name: 'id2', type: 'int', nullable: false, primaryKey: false },
        ],
        indices: [],
        foreignKeys: [
          {
            name: 'fk_old',
            columns: ['id1', 'id2'],
            referencedTable: 'parent',
            referencedColumns: undefined as unknown as string[],
          },
        ],
      },
    ]);
    expect(tables[1]!.foreignKeys[0]!.referencedColumns).toEqual(['id1', 'id2']);
  });
});
