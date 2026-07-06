import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import type { TableDiff } from '@foxschema/core';
import { TableDiffDetailScreen } from '../screens/TableDiffDetailScreen';

describe('TableDiffDetailScreen', () => {
  it('renders column, index, and FK diffs with their descriptions', () => {
    const diff: TableDiff = {
      tableName: 'INVENTORY',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [
        { name: 'QTY', status: 'ADDED', source: { type: 'integer', nullable: false } },
        { name: 'ID', status: 'UNCHANGED', source: { type: 'integer', nullable: false }, target: { type: 'integer', nullable: false } },
      ],
      indexDiffs: [{ name: 'UQ_WH_SKU', status: 'ADDED', source: { columns: ['warehouse_id', 'sku'], unique: true } }],
      foreignKeyDiffs: [
        { name: 'FK_INVENTORY_WH', status: 'ADDED', source: { columns: ['warehouse_id'], referencedTable: 'WAREHOUSES', referencedColumns: ['id'] } },
      ],
      triggerDiffs: [],
    };

    const { lastFrame } = render(<TableDiffDetailScreen diff={diff} />);
    const frame = lastFrame();

    expect(frame).toContain('[TABLE] INVENTORY');
    expect(frame).toContain('Columns (1)'); // only the ADDED column, not the UNCHANGED one
    expect(frame).toContain('QTY');
    expect(frame).not.toContain('Columns (2)');
    expect(frame).toContain('Indexes (1)');
    expect(frame).toContain('UQ_WH_SKU');
    expect(frame).toContain('Foreign Keys (1)');
    expect(frame).toContain('WAREHOUSES(id)');
  });

  it('shows a fallback message for an object-level diff with no column/index/FK/trigger detail', () => {
    const diff: TableDiff = {
      tableName: 'MV_DAILY_SALES',
      objectType: 'MQT',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
    };

    const { lastFrame } = render(<TableDiffDetailScreen diff={diff} />);
    expect(lastFrame()).toContain('object-level added');
  });
});
