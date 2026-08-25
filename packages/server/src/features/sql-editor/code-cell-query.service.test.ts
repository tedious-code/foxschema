import { describe, expect, it, vi } from 'vitest';
import { ConnectionFactory } from '@foxschema/db';
import { MAX_CELL_QUERY_ROWS } from './code-cell-bridge.service';
import { makeBeamCellQueryRunner, makeCellQueryRunner } from './code-cell-query.service';
import type { Permission } from '@foxschema/shared';
import type { CellQueryRunner } from './code-cell-execute.service';

vi.mock('@foxschema/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@foxschema/db')>();
  return {
    ...actual,
    ConnectionFactory: { executeQuery: vi.fn(async () => [{ ok: 1 }]) },
  };
});

const resolved = { dialect: 'postgres', option: {} as never };
/** An editor: data + schema power, but explicitly not GRANT. */
const editor = new Set<Permission>(['editor.dml', 'editor.ddl']);
const runnerFor = (perms: Set<Permission>, allowWrites = true) =>
  makeCellQueryRunner(resolved, { allowWrites, can: (p) => perms.has(p) });

describe('code cell bridge permission policy', () => {
  it('allows reads regardless of permissions', async () => {
    await expect(runnerFor(new Set(), false)('SELECT 1', [])).resolves.toEqual([{ ok: 1 }]);
  });

  it('lets an editor run data and schema changes', async () => {
    await expect(runnerFor(editor)('INSERT INTO t VALUES (1)', [])).resolves.toBeTruthy();
    await expect(runnerFor(editor)('CREATE TABLE t (a int)', [])).resolves.toBeTruthy();
  });

  it('blocks GRANT from an editor even when writes are allowed', async () => {
    // The escalation Bugbot found: allowWrites used to be a blanket pass, so a
    // cell could hand its own account privileges it was never granted.
    await expect(runnerFor(editor)('GRANT ALL ON t TO bob', [])).rejects.toThrow(
      /editor\.grant/
    );
  });

  it('allows GRANT once the caller actually has editor.grant', async () => {
    const owner = new Set<Permission>([...editor, 'editor.grant']);
    await expect(runnerFor(owner)('GRANT ALL ON t TO bob', [])).resolves.toBeTruthy();
  });

  it('blocks a dml-only caller from schema changes', async () => {
    const dmlOnly = new Set<Permission>(['editor.dml']);
    await expect(runnerFor(dmlOnly)('DROP TABLE t', [])).rejects.toThrow(/editor\.ddl/);
  });

  it('Safe mode still blocks writes before permissions are consulted', async () => {
    const owner = new Set<Permission>([...editor, 'editor.grant']);
    await expect(runnerFor(owner, false)('DELETE FROM t', [])).rejects.toThrow(/Safe mode/);
  });

  it('fails closed on an unrecognized verb', async () => {
    await expect(runnerFor(new Set<Permission>(['editor.dml']))('FLASHBACK TABLE t', [])).rejects.toThrow(
      /editor\.ddl/
    );
  });

  it('does not let a leading SELECT authorize a batched write or GRANT', async () => {
    await expect(runnerFor(editor, false)('SELECT 1; DELETE FROM t', [])).rejects.toThrow(/Safe mode/);
    await expect(runnerFor(editor)('SELECT 1; GRANT ALL ON t TO bob', [])).rejects.toThrow(/editor\.grant/);
  });

  it('blocks a leading-semicolon write that used to classify as a read', async () => {
    await expect(runnerFor(new Set(), false)('; DELETE FROM t', [])).rejects.toThrow(/Safe mode/);
  });

  it('blocks parenthesized PRAGMA assignments', async () => {
    await expect(runnerFor(new Set(), false)('PRAGMA user_version(123)', [])).rejects.toThrow(/Safe mode/);
  });

  it('fails closed when a bridged SELECT exceeds MAX_CELL_QUERY_ROWS', async () => {
    const many = Array.from({ length: MAX_CELL_QUERY_ROWS + 1 }, (_, i) => ({ id: i }));
    vi.mocked(ConnectionFactory.executeQuery).mockResolvedValueOnce(many as never);
    await expect(runnerFor(new Set(), false)('SELECT id FROM t', [])).rejects.toThrow(
      /refuses more than/
    );
  });
});

describe('makeBeamCellQueryRunner', () => {
  const stub = (label: string): CellQueryRunner =>
    async (text, params, alias) => [{ label, text, params, alias }];

  it('routes by alias and falls back to the default', async () => {
    const byAlias = new Map<string, CellQueryRunner>([
      ['source', stub('src')],
      ['target', stub('tgt')],
    ]);
    const run = makeBeamCellQueryRunner(byAlias, 'source');
    await expect(run('SELECT 1', [], 'target')).resolves.toEqual([
      { label: 'tgt', text: 'SELECT 1', params: [], alias: 'target' },
    ]);
    await expect(run('SELECT 2', [9])).resolves.toEqual([
      { label: 'src', text: 'SELECT 2', params: [9], alias: 'source' },
    ]);
  });

  it('fails closed on missing or unknown aliases', async () => {
    const byAlias = new Map<string, CellQueryRunner>([['source', stub('src')]]);
    const noDefault = makeBeamCellQueryRunner(byAlias);
    await expect(noDefault('SELECT 1', [])).rejects.toThrow(/missing alias/i);
    const withDefault = makeBeamCellQueryRunner(byAlias, 'source');
    await expect(withDefault('SELECT 1', [], 'warehouse')).rejects.toThrow(
      /Unknown Server Beam alias "warehouse"/
    );
  });
});
