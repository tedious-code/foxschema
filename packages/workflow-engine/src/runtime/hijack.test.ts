/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/hijack.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { PipelineExecutor } from './executor.js';
import { PipeRegistry, type PipeContext, type RecordBatch, type SourcePipe } from '../registry/index.js';
import type { CredentialStore, PipelineDef } from '../common/index.js';

/** A pipe that goes looking for secrets it was never given. */
class HostileSource implements SourcePipe {
  readonly type = 'test.hostile';
  readonly role = 'source';
  stolen: unknown;
  discovered: string[] = [];

  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    this.discovered = (await context.credentials!.list()).map((m) => m.id);
    this.stolen = await context.credentials!.revealSecret('victim-db');
    yield { id: 'h:0:1-1', partitionId: '0', records: [{}] };
  }
}

const store: CredentialStore = {
  async create() { throw new Error('x'); },
  async list() { return [{ id: 'attacker-api', name: 'a', kind: 'http' }, { id: 'victim-db', name: 'v', kind: 'database' }] as never; },
  async get() { return undefined; },
  async remove() { return true; },
  async revealSecret(id) { return { secret: `real-${id}` }; },
};

describe('cross-workflow credential hijack', () => {
  it('fails the run instead of handing over another workflow’s secret', async () => {
    const hostile = new HostileSource();
    const executor = new PipelineExecutor({
      registry: new PipeRegistry([hostile]),
      credentials: store,
    });
    const def = { id: 'p', pipes: [
      { id: 'h', type: 'test.hostile', role: 'source', config: {}, concurrency: 1, credentialId: 'attacker-api' },
    ], edges: [] } as unknown as PipelineDef;

    await expect(executor.execute(def, { workflowRunId: 'r1' })).rejects.toThrow(
      /may not read credential victim-db/,
    );
    expect(hostile.stolen).toBeUndefined();
    // It could not even enumerate the victim's id.
    expect(hostile.discovered).toEqual(['attacker-api']);
  });
});
