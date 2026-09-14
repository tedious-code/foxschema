/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/control-pipes-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine, parseWorkflow } from '../index.js';

/**
 * Split → Loop → Merge through the real Engine: proves the wrapped control
 * pipes route batches end-to-end and that per-pipe stats count transform
 * batches (the markPipe 'success' counting fix).
 */
describe('control pipes end-to-end', () => {
  it('runs split → loop → merge and records per-pipe batch stats', async () => {
    const engine = new Engine({
      databasePath: ':memory:',
      encryptionKey: randomBytes(32),
      instanceId: 'control-e2e',
    });
    const workflow = parseWorkflow({
      id: 'control-wf',
      name: 'control-wf',
      triggers: [
        {
          id: 'manual',
          kind: 'manual',
          enabled: true,
          inputData: [
            { region: 'us', n: 1 },
            { region: 'eu', n: 2 },
            { region: 'us', n: 3 },
            { n: 4 },
          ],
        },
      ],
      pipelines: [
        {
          id: 'main',
          name: 'main',
          pipes: [
            { id: 'src', role: 'source', type: 'source.triggerPayload', config: {} },
            {
              id: 'split',
              role: 'transform',
              type: 'transform.split',
              config: { field: 'region' },
            },
            { id: 'each', role: 'transform', type: 'logic.loop', config: { size: 1 } },
            { id: 'join', role: 'transform', type: 'transform.merge', config: {} },
          ],
          edges: [
            { from: 'src', to: 'split' },
            { from: 'split', to: 'each' },
            { from: 'each', to: 'join' },
          ],
        },
      ],
    });
    await engine.stores.workflows.put(workflow);

    const { run } = await engine.scheduler.enqueue(workflow);
    await engine.idle();

    expect((await engine.stores.runs.get(run!.id))?.status).toBe('succeeded');
    const stats = Object.fromEntries(
      (await engine.stores.runs.listPipes(run!.id)).map((pipe) => [
        pipe.pipeId,
        { batches: pipe.processedBatches, records: pipe.processedRecords },
      ]),
    );
    expect(stats).toEqual({
      src: { batches: 1, records: 4 },
      // One inbound batch, split into partitions us(2) / eu(1) / null(1).
      split: { batches: 1, records: 4 },
      // Three partition batches in, re-chunked record-by-record.
      each: { batches: 3, records: 4 },
      // Four single-record chunks pass the fan-in junction.
      join: { batches: 4, records: 4 },
    });
    engine.close();
  });
});
