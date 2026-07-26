import { describe, expect, it } from 'vitest';
import { buildSchemaTries, trieCollect, trieInsert, createTrie } from './completionTrie';

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
});
