/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/registry/src/plugins.test.ts).
 */
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PipeRegistry,
  loadPipePlugin,
  type SourcePipe,
} from './index.js';

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

const sampleSourceModule = (type: string) => `
export class SampleSource {
  type = '${type}';
  role = 'source';
  metadata() {
    return {
      type: this.type,
      name: 'Sample',
      category: 'Sources',
      version: '1.0.0',
      role: 'source',
      inputs: [],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: { type: 'object', properties: {} },
      // A spoofed provider must be overwritten by the loader stamp.
      provider: { namespace: 'foxagent', origin: 'builtin' },
    };
  }
  async *read() {
    yield { id: '1', partitionId: '0', records: [{ ok: true }] };
  }
}
`;

async function writePlugin(
  manifest: Record<string, unknown>,
  moduleType: string,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'foxagent-plugin-'));
  cleanup.push(root);
  await mkdir(join(root, 'dist'));
  await writeFile(join(root, 'foxflow.pipe.json'), JSON.stringify(manifest));
  await writeFile(join(root, 'dist/index.js'), sampleSourceModule(moduleType));
  return root;
}

describe('loadPipePlugin', () => {
  it('registers namespaced pipes and stamps plugin provenance', async () => {
    const root = await writePlugin(
      {
        name: '@test/sample',
        version: '1.0.0',
        pipes: [
          { type: 'test/source.plugin', entry: './dist/index.js', export: 'SampleSource' },
        ],
      },
      'test/source.plugin',
    );

    const registry = new PipeRegistry();
    const manifest = await loadPipePlugin(root, registry);
    expect(manifest.name).toBe('@test/sample');
    const pipe = registry.get({
      id: 's',
      type: 'test/source.plugin',
      role: 'source',
      config: {},
      concurrency: 1,
    }) as SourcePipe;
    expect(pipe.type).toBe('test/source.plugin');

    // Namespace derived from the npm scope; self-declared provider overwritten.
    expect(registry.metadata('test/source.plugin').provider).toEqual({
      namespace: 'test',
      origin: 'plugin',
      package: '@test/sample',
      packageVersion: '1.0.0',
    });
  });

  it('rejects bare (built-in-looking) type ids from plugins', async () => {
    const root = await writePlugin(
      {
        name: '@test/sample',
        version: '1.0.0',
        pipes: [
          { type: 'source.test.plugin', entry: './dist/index.js', export: 'SampleSource' },
        ],
      },
      'source.test.plugin',
    );
    await expect(loadPipePlugin(root, new PipeRegistry())).rejects.toThrow(
      /must be namespaced "test\//,
    );
  });

  it('requires a namespace for unscoped packages and honors an explicit one', async () => {
    const unscoped = await writePlugin(
      {
        name: 'sample-plugin',
        version: '1.0.0',
        pipes: [
          { type: 'sample/source.plugin', entry: './dist/index.js', export: 'SampleSource' },
        ],
      },
      'sample/source.plugin',
    );
    await expect(loadPipePlugin(unscoped, new PipeRegistry())).rejects.toThrow(
      /needs a namespace/,
    );

    const explicit = await writePlugin(
      {
        name: 'sample-plugin',
        version: '2.0.0',
        namespace: 'sample',
        pipes: [
          { type: 'sample/source.plugin', entry: './dist/index.js', export: 'SampleSource' },
        ],
      },
      'sample/source.plugin',
    );
    const registry = new PipeRegistry();
    await loadPipePlugin(explicit, registry);
    expect(registry.metadata('sample/source.plugin').provider).toMatchObject({
      namespace: 'sample',
      origin: 'plugin',
      packageVersion: '2.0.0',
    });
  });
});

describe('PipeRegistry provenance', () => {
  it('stamps built-ins as foxagent and keeps the bare id space for them', () => {
    const registry = new PipeRegistry();
    registry.register({
      type: 'source.example',
      role: 'source',
      metadata: () => ({
        type: 'source.example',
        name: 'Example',
        category: 'Sources',
        version: '0.1.0',
        role: 'source',
        inputs: [],
        outputs: [],
        configSchema: { type: 'object' },
      }),
      async *read() {},
    });
    expect(registry.metadata('source.example').provider).toEqual({
      namespace: 'foxagent',
      origin: 'builtin',
    });

    expect(() =>
      registry.register({
        type: 'acme/source.example',
        role: 'source',
        async *read() {},
      }),
    ).toThrow(/built-in pipe type must not be namespaced/);
  });
});
