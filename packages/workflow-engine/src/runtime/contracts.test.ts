/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/contracts.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { applyContract } from './contracts.js';

describe('applyContract', () => {
  it('coerces fields and drops unknowns by default', () => {
    const result = applyContract(
      {
        id: 'b1',
        partitionId: '0',
        records: [{ id: '1', name: 'Ada', extra: true }],
      },
      {
        fields: [
          { name: 'id', type: 'integer', nullable: false, onError: 'reject' },
          { name: 'name', type: 'text', nullable: false, onError: 'reject' },
        ],
        unknownFields: 'drop',
      },
    );
    expect(result.batch.records).toEqual([{ id: 1, name: 'Ada' }]);
    expect(result.rejected).toEqual([]);
  });

  it('collects rejected rows when coercion fails', () => {
    const result = applyContract(
      {
        id: 'b1',
        partitionId: '0',
        records: [{ id: 'x' }, { id: '2' }],
      },
      {
        fields: [
          { name: 'id', type: 'integer', nullable: false, onError: 'reject' },
        ],
        unknownFields: 'drop',
      },
    );
    expect(result.batch.records).toEqual([{ id: 2 }]);
    expect(result.rejected).toEqual([{ id: 'x' }]);
  });
});
