import { describe, expect, it } from 'vitest';
import { removeDataPeekSubtree, type DataPeekEntry } from '../../store/useSqlEditorStore';

function entry(
  id: string,
  extra: Partial<DataPeekEntry> = {}
): DataPeekEntry {
  return {
    id,
    title: id,
    tableName: id,
    baseSql: 'SELECT 1',
    baseParams: [],
    whereClause: '',
    orderByClause: '',
    limit: 50,
    pageIndex: 0,
    sql: 'SELECT 1',
    params: [],
    status: 'ready',
    ...extra,
  };
}

describe('removeDataPeekSubtree', () => {
  it('keeps sibling drills when removing one FK panel', () => {
    const root = entry('root');
    const tech = entry('tech', { parentId: 'root', drillKey: 'root|TECH|TECHNICIANID' });
    const order = entry('order', { parentId: 'root', drillKey: 'root|ORDER|ORDERID' });
    const techUser = entry('user', { parentId: 'tech', drillKey: 'tech|USER|USERID' });
    const next = removeDataPeekSubtree([root, tech, order, techUser], 'tech');
    expect(next.map((e) => e.id)).toEqual(['root', 'order']);
  });
});
