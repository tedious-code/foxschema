import { describe, expect, it } from 'vitest';
import { findDropDependencies, tokenizeSqlIdents } from './dependency-scan.js';
import type { TableDiff } from '../interfaces/index.js';

describe('tokenizeSqlIdents', () => {
  it('extracts identifiers once for membership checks', () => {
    const tokens = tokenizeSqlIdents('select id, name from customers where status = pending');
    expect(tokens.has('customers')).toBe(true);
    expect(tokens.has('status')).toBe(true);
    expect(tokens.has('select')).toBe(true);
    expect(tokens.has('missing')).toBe(false);
  });
});

describe('findDropDependencies (tokenized)', () => {
  it('flags a view that references a dropped table', () => {
    const tables: TableDiff[] = [
      {
        tableName: 'CUSTOMERS',
        objectType: 'TABLE',
        status: 'REMOVED',
        columnDiffs: [],
        indexDiffs: [],
        foreignKeyDiffs: [],
        targetTable: {
          name: 'customers',
          objectType: 'TABLE',
          columns: [],
          indices: [],
          foreignKeys: [],
        },
      },
      {
        tableName: 'V_CUST',
        objectType: 'VIEW',
        status: 'UNCHANGED',
        columnDiffs: [],
        indexDiffs: [],
        foreignKeyDiffs: [],
        definition: 'CREATE VIEW v_cust AS SELECT id FROM customers',
        targetTable: {
          name: 'v_cust',
          objectType: 'VIEW',
          columns: [],
          indices: [],
          foreignKeys: [],
          definition: 'CREATE VIEW v_cust AS SELECT id FROM customers',
        },
      },
    ];
    const deps = findDropDependencies(tables, { CUSTOMERS: true });
    expect(deps.some((d) => d.dependentName.toLowerCase() === 'v_cust' && d.dropped.toLowerCase() === 'customers')).toBe(
      true
    );
  });
});
