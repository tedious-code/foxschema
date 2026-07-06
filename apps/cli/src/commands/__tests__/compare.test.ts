import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCompare } from '../compare';
import * as connectionRef from '../../runtime/connectionRef';
import * as engine from '../../runtime/engine';

describe('CLI: compare command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should require both source and target connections', async () => {
    await expect(runCompare({ source: undefined, target: 'test' })).rejects.toThrow(
      'Both --source and --target are required'
    );
  });

  it('should display summary view (default)', async () => {
    const mockCompareResult = {
      summary: { added: 2, removed: 1, modified: 3, unchanged: 10 },
      tables: [
        { tableName: 'users', status: 'MODIFIED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
        { tableName: 'posts', status: 'ADDED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
        { tableName: 'comments', status: 'REMOVED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
      ],
    };

    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({
        dialect: 'postgres',
        schema: 'demo_c',
        option: {},
      } as any)
      .mockResolvedValueOnce({
        dialect: 'postgres',
        schema: 'demo_d',
        option: {},
      } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(mockCompareResult as any);

    const consoleSpy = vi.spyOn(console, 'log');

    await runCompare({
      source: 'demo_c',
      target: 'demo_d',
    });

    expect(consoleSpy).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('+2')
    );
  });

  it('should print a "Schema X → Y" header and drill into a MODIFIED table\'s column changes', async () => {
    const mockCompareResult = {
      summary: { added: 1, removed: 0, modified: 1, unchanged: 0 },
      tables: [
        {
          tableName: 'USERS',
          status: 'MODIFIED',
          objectType: 'TABLE',
          columnDiffs: [
            {
              name: 'AGE',
              status: 'MODIFIED',
              source: { type: 'int', nullable: true },
              target: { type: 'bigint', nullable: true },
            },
          ],
          indexDiffs: [],
          foreignKeyDiffs: [],
        },
        {
          tableName: 'V_ACTIVE',
          status: 'MODIFIED',
          objectType: 'VIEW',
          columnDiffs: [],
          indexDiffs: [],
          foreignKeyDiffs: [],
        },
      ],
    };

    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'demo_c', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'demo_d', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(mockCompareResult as any);

    const consoleSpy = vi.spyOn(console, 'log');

    await runCompare({ source: 'demo_c', target: 'demo_d' });

    const output = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Schema demo_c → demo_d');
    expect(output).toContain('int → bigint');
    // A modified view has no column-level model — falls back to a definition note.
    expect(output).toContain('(definition changed)');
  });

  it('should output JSON with --json flag', async () => {
    const mockResult = {
      summary: { added: 1, removed: 0, modified: 0, unchanged: 5 },
      tables: [],
    };

    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'a', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'b', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(mockResult as any);

    const consoleSpy = vi.spyOn(console, 'log');

    await runCompare({
      source: 'a',
      target: 'b',
      json: true,
    });

    // JSON.stringify(result, null, 2) pretty-prints with a space after the colon.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('"added": 1')
    );
  });

  it('should output DDL with --ddl flag', async () => {
    const mockResult = {
      summary: { added: 1, removed: 0, modified: 0, unchanged: 5 },
      tables: [
        { tableName: 'users', status: 'ADDED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
      ],
    };

    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'a', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'mysql', schema: 'b', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce(mockResult as any);

    vi.spyOn(engine.sqlGenerator, 'generateMigrationSql').mockReturnValue('CREATE TABLE users (id INT PRIMARY KEY);');

    const consoleSpy = vi.spyOn(console, 'log');

    await runCompare({
      source: 'a',
      target: 'b',
      ddl: true,
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE')
    );
  });

  it('should exit with code 1 on drift (default behavior)', async () => {
    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'a', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'b', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce({
      summary: { added: 1, removed: 0, modified: 0, unchanged: 5 },
      tables: [
        { tableName: 'users', status: 'ADDED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
      ],
    } as any);

    vi.spyOn(console, 'log');

    await runCompare({ source: 'a', target: 'b' });

    expect(process.exitCode).toBe(1);
  });

  it('should not exit with code 1 when --no-fail is set', async () => {
    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'a', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'b', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce({
      summary: { added: 1, removed: 0, modified: 0, unchanged: 5 },
      tables: [
        { tableName: 'users', status: 'ADDED', objectType: 'table', columnDiffs: [], indexDiffs: [], fkDiffs: [] },
      ],
    } as any);

    vi.spyOn(console, 'log');
    process.exitCode = undefined;

    await runCompare({ source: 'a', target: 'b', fail: false });

    expect(process.exitCode).toBeUndefined();
  });

  it('should handle cross-dialect comparison (postgres → mysql)', async () => {
    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'demo_c', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'mysql', schema: 'demo_c', option: {} } as any);

    vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const compareSpy = vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce({
      summary: { added: 0, removed: 0, modified: 0, unchanged: 5 },
      tables: [],
    } as any);

    vi.spyOn(console, 'log');

    await runCompare({
      source: 'pg_source',
      target: 'mysql_target',
      sourceSchema: 'demo_c',
      targetSchema: 'demo_c',
    });

    // Verify that cross-dialect options are passed to compare
    expect(compareSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        source: 'postgres',
        target: 'mysql',
      })
    );
  });

  it('should parse scope filter correctly', async () => {
    vi.spyOn(connectionRef, 'resolveRef')
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'a', option: {} } as any)
      .mockResolvedValueOnce({ dialect: 'postgres', schema: 'b', option: {} } as any);

    const loadSpy = vi.spyOn(engine, 'loadScopedTables')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    vi.spyOn(engine.compareModule, 'compare').mockResolvedValueOnce({
      summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      tables: [],
    } as any);

    vi.spyOn(console, 'log');

    await runCompare({
      source: 'a',
      target: 'b',
      scope: 'tables,views',
    });

    // parseScope('tables,views') → DbObjectType[] ['TABLE','VIEW'], passed as the
    // 4th arg to loadScopedTables.
    expect(loadSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ['TABLE', 'VIEW']
    );
  });
});
