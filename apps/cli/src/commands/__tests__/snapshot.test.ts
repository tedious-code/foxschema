import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSnapshot } from '../snapshot';
import * as connectionRef from '../../runtime/connectionRef';
import * as engine from '../../runtime/engine';
import { writeFileSync } from 'node:fs';

vi.mock('node:fs', () => ({ writeFileSync: vi.fn() }));

const TABLE = { name: 'users', objectType: 'TABLE' };

function stubRef(dialect = 'postgres', schema = 'public') {
  vi.spyOn(connectionRef, 'resolveRef').mockResolvedValue({ dialect, schema, option: {} } as any);
  vi.spyOn(engine, 'loadScopedTables').mockResolvedValue([TABLE] as any);
  vi.spyOn(engine.sqlGenerator, 'generateObjectDdl').mockReturnValue('CREATE TABLE users (id INT);');
}

describe('CLI: snapshot command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('propagates the resolveRef error when neither a connection nor a dialect is given', async () => {
    vi.spyOn(connectionRef, 'resolveRef').mockRejectedValue(
      new Error('Provide --connection <name>, or --dialect with connection details (or --url).')
    );

    await expect(runSnapshot({})).rejects.toThrow('Provide --connection');
  });

  it('writes a branded DDL dump to stdout by default', async () => {
    stubRef('postgres', 'public');
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runSnapshot({ connection: 'demo_a', schema: 'public' });

    const written = out.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('-- Fox snapshot · postgres');
    expect(written).toContain('CREATE TABLE users (id INT);');
  });

  it('writes to a file with --out instead of stdout', async () => {
    stubRef();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runSnapshot({ connection: 'demo_a', out: '/tmp/snap.sql' } as any);

    expect(writeFileSync).toHaveBeenCalledWith('/tmp/snap.sql', expect.stringContaining('CREATE TABLE users'));
    expect(stdout).not.toHaveBeenCalled();
  });

  it('passes the parsed scope to loadScopedTables', async () => {
    vi.spyOn(connectionRef, 'resolveRef').mockResolvedValue({ dialect: 'postgres', schema: 'public', option: {} } as any);
    const loadSpy = vi.spyOn(engine, 'loadScopedTables').mockResolvedValue([] as any);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runSnapshot({ connection: 'demo_a', scope: 'tables,views' } as any);

    expect(loadSpy).toHaveBeenCalledWith('postgres', {}, 'public', ['TABLE', 'VIEW']);
  });
});
