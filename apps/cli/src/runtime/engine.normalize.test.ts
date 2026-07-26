import { describe, expect, it, vi } from 'vitest';
import * as engine from './engine';

describe('loadScopedTables normalize', () => {
  it('fills omitted referencedColumns via normalizeTableSchemas', async () => {
    const getTables = vi.fn().mockResolvedValue([
      {
        name: 'parent',
        objectType: 'TABLE',
        columns: [
          { name: 'a', type: 'INT', nullable: false, primaryKey: true },
          { name: 'b', type: 'INT', nullable: false, primaryKey: true },
        ],
        primaryKey: { name: 'pk', columns: ['a', 'b'] },
        indices: [],
        foreignKeys: [],
      },
      {
        name: 'child',
        objectType: 'TABLE',
        columns: [
          { name: 'a', type: 'INT', nullable: true },
          { name: 'b', type: 'INT', nullable: true },
        ],
        indices: [],
        foreignKeys: [
          {
            name: 'fk_child',
            columns: ['a', 'b'],
            referencedTable: 'parent',
            // omit referencedColumns — upgrade path
          },
        ],
      },
    ]);
    vi.spyOn(engine.connectionModule, 'getProvider').mockReturnValue({ getTables } as never);

    const tables = await engine.loadScopedTables('postgres', {} as never, 'public');
    const child = tables.find((t) => t.name === 'child');
    const fk = child?.foreignKeys[0];
    expect(fk?.referencedColumns).toEqual(['a', 'b']);
  });
});
