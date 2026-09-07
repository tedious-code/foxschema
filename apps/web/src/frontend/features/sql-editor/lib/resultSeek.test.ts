/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { seekFromLastRow } from './resultSeek';
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
});
