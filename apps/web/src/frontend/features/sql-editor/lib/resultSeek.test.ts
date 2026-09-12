/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { seekFromLastRow, tableForOrderBy } from './resultSeek';
import type { TableSchema } from '@/shared/lib/types';

const TABLE: TableSchema = {
  name: 'ORDERS',
  objectType: 'TABLE',
  columns: [
    { name: 'ID', type: 'int', nullable: false, primaryKey: true },
    { name: 'NAME', type: 'varchar', nullable: true, primaryKey: false },
  ],
  indices: [],
  foreignKeys: [],
  primaryKey: { columns: ['ID'] },
};

describe('seekFromLastRow', () => {
  it('builds a Last Id seek when ORDER BY is the PK', () => {
    expect(
      seekFromLastRow({
        sql: 'SELECT ID, NAME FROM ORDERS ORDER BY ID',
        table: TABLE,
        resultColumns: ['ID', 'NAME'],
        lastRow: [40, 'Ada'],
      })
    ).toEqual({ columns: ['ID'], values: [40], descending: [false] });
  });

  it('returns null when ORDER BY is not unique', () => {
    expect(
      seekFromLastRow({
        sql: 'SELECT ID, NAME FROM ORDERS ORDER BY NAME',
        table: TABLE,
        resultColumns: ['ID', 'NAME'],
        lastRow: [40, 'Ada'],
      })
    ).toBeNull();
  });

  it('does not borrow PK uniqueness for a computed column aliased to the PK name', () => {
    const sql = 'SELECT ID % 2 AS ID, NAME FROM ORDERS ORDER BY ID';
    expect(
      seekFromLastRow({
        sql,
        table: tableForOrderBy(sql, [TABLE]),
        resultColumns: ['ID', 'NAME'],
        lastRow: [1, 'Ada'],
      })
    ).toBeNull();
  });

  it('does not seek on a partial unique index', () => {
    const table: TableSchema = {
      ...TABLE,
      primaryKey: undefined,
      columns: [
        { name: 'EMAIL', type: 'varchar', nullable: false, primaryKey: false },
        { name: 'DELETED_AT', type: 'timestamp', nullable: true, primaryKey: false },
      ],
      indices: [
        {
          name: 'U_ACTIVE_EMAIL',
          unique: true,
          columns: ['EMAIL'],
          filter: 'DELETED_AT IS NULL',
        },
      ],
    };
    expect(
      seekFromLastRow({
        sql: 'SELECT EMAIL, DELETED_AT FROM ORDERS ORDER BY EMAIL',
        table,
        resultColumns: ['EMAIL', 'DELETED_AT'],
        lastRow: ['a@example.com', null],
      })
    ).toBeNull();
  });

  it('does not use one side of a join to claim the result order is unique', () => {
    expect(
      tableForOrderBy(
        'SELECT o.ID, i.ID AS ITEM_ID FROM ORDERS o JOIN ITEMS i ON i.ORDER_ID = o.ID ORDER BY o.ID',
        [
          TABLE,
          {
            ...TABLE,
            name: 'ITEMS',
            columns: [
              { name: 'ID', type: 'int', nullable: false, primaryKey: true },
              { name: 'ORDER_ID', type: 'int', nullable: false, primaryKey: false },
            ],
          },
        ]
      )
    ).toBeUndefined();
  });

  it('matches a FROM table exactly instead of borrowing a substring table PK', () => {
    const orderItems: TableSchema = {
      ...TABLE,
      name: 'ORDER_ITEMS',
      columns: [
        { name: 'ORDER_ID', type: 'int', nullable: false, primaryKey: false },
        { name: 'LINE', type: 'int', nullable: false, primaryKey: false },
      ],
      primaryKey: undefined,
    };
    expect(
      tableForOrderBy(
        'SELECT ORDER_ID, LINE FROM ORDER_ITEMS ORDER BY ORDER_ID',
        [TABLE, orderItems]
      )
    ).toBe(orderItems);
    expect(
      seekFromLastRow({
        sql: 'SELECT ORDER_ID, LINE FROM ORDER_ITEMS ORDER BY ORDER_ID',
        table: tableForOrderBy(
          'SELECT ORDER_ID, LINE FROM ORDER_ITEMS ORDER BY ORDER_ID',
          [TABLE, orderItems]
        ),
        resultColumns: ['ORDER_ID', 'LINE'],
        lastRow: [1, 3],
      })
    ).toBeNull();
  });
});
