import { describe, expect, it, vi } from 'vitest';
import { makeCellQueryRunner } from './code-cell-query';
import type { Permission } from '../../shared/permissions';

vi.mock('@foxschema/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@foxschema/core')>();
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
});
