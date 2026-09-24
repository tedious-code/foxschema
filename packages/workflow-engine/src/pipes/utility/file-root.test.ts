import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorkflowFile, workflowFilesRoot } from './file-root.js';
import { FileSinkPipe } from './file-sink.js';
import { CsvSourcePipe } from './csv.js';
import type { PipeContext } from '../../registry/index.js';

let base: string;
let root: string;

beforeEach(async () => {
  base = realpathSync(await mkdtemp(join(tmpdir(), 'foxflow-root-')));
  root = join(base, 'files');
  await mkdir(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('resolveWorkflowFile', () => {
  it('resolves a relative path inside the root', async () => {
    expect(await resolveWorkflowFile('out/a.csv', root)).toBe(join(root, 'out', 'a.csv'));
  });

  it('accepts an absolute path that is already inside the root', async () => {
    expect(await resolveWorkflowFile(join(root, 'a.csv'), root)).toBe(join(root, 'a.csv'));
  });

  it('refuses an absolute path outside the root', async () => {
    await expect(resolveWorkflowFile('/etc/passwd', root)).rejects.toThrow(/outside the workflow files directory/);
  });

  it('refuses a relative path that climbs out', async () => {
    await expect(resolveWorkflowFile('../secret.txt', root)).rejects.toThrow(/outside/);
    await expect(resolveWorkflowFile('a/../../secret.txt', root)).rejects.toThrow(/outside/);
  });

  it('accepts a file whose name merely starts with two dots', async () => {
    expect(await resolveWorkflowFile('..notes.csv', root)).toBe(join(root, '..notes.csv'));
  });

  it('refuses a sibling directory that merely shares the prefix', async () => {
    await expect(resolveWorkflowFile(`${root}-evil/a.csv`, root)).rejects.toThrow(/outside/);
  });

  it('refuses a symlink inside the root that points out of it', async () => {
    await writeFile(join(base, 'secret.txt'), 'nope');
    await symlink(base, join(root, 'escape'));
    await expect(resolveWorkflowFile('escape/secret.txt', root)).rejects.toThrow(/outside/);
  });
});

describe('workflowFilesRoot', () => {
  it('prefers FOXFLOW_FILES_DIR', () => {
    expect(workflowFilesRoot({ FOXFLOW_FILES_DIR: root })).toBe(root);
  });

  it('defaults to workflow-files beside the engine database', () => {
    expect(workflowFilesRoot({ FOXFLOW_DB_PATH: join(base, 'engine.sqlite') })).toBe(
      join(base, 'workflow-files'),
    );
  });
});

describe('file pipes honour the root', () => {
  const context = (config: Record<string, unknown>, type: string) =>
    ({ workflowRunId: 'run-1', pipe: { id: 'p', type, config } }) as unknown as PipeContext;

  it('the CSV sink refuses to write outside it', async () => {
    const sink = new FileSinkPipe();
    await expect(
      sink.write(
        { id: 'b', partitionId: '0', records: [{ a: 1 }] },
        context({ path: '/foxflow-nowhere/escaped.csv', columns: ['a'] }, sink.type),
      ),
    ).rejects.toThrow(/outside/);
  });

  it('the CSV source refuses to read outside it', async () => {
    const source = new CsvSourcePipe();
    const read = async () => {
      for await (const _batch of source.read(context({ path: '/etc/hostname' }, source.type))) {
        // drain
      }
    };
    await expect(read()).rejects.toThrow(/outside/);
  });
});
