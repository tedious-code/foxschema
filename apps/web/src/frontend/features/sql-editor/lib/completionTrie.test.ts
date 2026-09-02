import { describe, expect, it } from 'vitest';
import {
  buildSchemaTries,
  schemaRevision,
  trieCollect,
  trieInsert,
  createTrie,
} from './completionTrie';

describe('completionTrie', () => {
  it('collects prefix matches', () => {
    const root = createTrie();
    trieInsert(root, 'orders');
    trieInsert(root, 'order_items');
    trieInsert(root, 'customers');
    expect(trieCollect(root, 'ord').sort()).toEqual(['order_items', 'orders']);
    expect(trieCollect(root, 'cus')).toEqual(['customers']);
  });

  it('builds per-schema revisioned tries', () => {
    const bundle = buildSchemaTries([
      {
        connectionId: 'c1',
        tables: [
          {
            name: 'orders',
            objectType: 'TABLE',
            columns: [{ name: 'id' }, { name: 'customer_id' }],
          },
        ],
      },
    ]);
    expect(trieCollect(bundle.tables, 'ord')).toContain('orders');
    const cols = bundle.columnsByTable.get('orders');
    expect(cols && trieCollect(cols, 'c')).toEqual(['customer_id']);
  });

  it('schemaRevision changes on rename even when counts stay the same', () => {
    const a = schemaRevision([
      {
        connectionId: 'c1',
        tables: [{ name: 'orders', objectType: 'TABLE', columns: [{ name: 'id' }] }],
      },
    ]);
    const b = schemaRevision([
      {
        connectionId: 'c1',
        tables: [{ name: 'orderz', objectType: 'TABLE', columns: [{ name: 'id' }] }],
      },
    ]);
    const c = schemaRevision([
      {
        connectionId: 'c1',
        tables: [{ name: 'orders', objectType: 'TABLE', columns: [{ name: 'pk' }] }],
      },
    ]);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
