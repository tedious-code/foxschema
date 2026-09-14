/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/sub-workflow-output-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine, PipeRegistry, parseWorkflowInput } from '../index.js';
import { SubWorkflowPipe } from '../pipes/control/index.js';
import { ScriptTransformPipe } from '../pipes/utility/index.js';
import { HttpResponsePipe } from '../pipes/http/index.js';
import {
  ManualTriggerSourcePipe,
  ParentTriggerSourcePipe,
  TriggerPayloadSourcePipe,
} from '../pipes/trigger/index.js';
import type { PipeContext, RecordBatch, SinkPipe } from '../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../sdk/index.js';

/**
 * A sub-workflow's answer reaching its caller.
 *
 * Until now `workflow.sub` reported only that a child had finished, so a
 * workflow could delegate but not receive. That made a reusable workflow a
 * side effect rather than a step, and a caller wanting the result had to read
 * a fixture instead — which is exactly what the SEO content factory did: run
 * the research, then compose the article from a canned brief.
 */

class RecordingSink implements SinkPipe {
  readonly type = 'sink.recording';
  readonly role = 'sink' as const;
  readonly written: Record<string, unknown>[] = [];

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Recording sink',
      category: 'Sink/Test',
      version: '0.1.0',
      role: 'sink',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [],
      configSchema: { type: 'object', properties: {} },
    });
  }

  async write(batch: RecordBatch, _context: PipeContext): Promise<void> {
    this.written.push(...batch.records);
  }
}

/** The child: computes something and answers with it. */
const CHILD = {
  id: 'child-research',
  name: 'Child',
  version: 1,
  triggers: [{ id: 'parent', kind: 'parent', enabled: true, allowFrom: [] }],
  pipelines: [
    {
      id: 'main',
      name: 'Main',
      pipes: [
        { id: 'in', type: 'source.triggerPayload', role: 'source', config: {} },
        {
          id: 'work',
          type: 'transform.script',
          role: 'transform',
          config: { script: "return [{ keyword: 'schema drift', clicks: 42 }];" },
        },
        { id: 'answer', type: 'sink.response', role: 'sink', config: {} },
      ],
      edges: [
        { from: 'in', to: 'work' },
        { from: 'work', to: 'answer' },
      ],
    },
  ],
};

function parent(output: 'summary' | 'records'): Record<string, unknown> {
  return {
    id: `parent-${output}`,
    name: 'Parent',
    version: 1,
    triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    pipelines: [
      {
        id: 'main',
        name: 'Main',
        pipes: [
          { id: 'start', type: 'source.triggerPayload', role: 'source', config: {} },
          {
            id: 'delegate',
            type: 'workflow.sub',
            role: 'transform',
            config: { workflowId: CHILD.id, output },
          },
          { id: 'seen', type: 'sink.recording', role: 'sink', config: {} },
        ],
        edges: [
          { from: 'start', to: 'delegate' },
          { from: 'delegate', to: 'seen' },
        ],
      },
    ],
  };
}

async function run(
  output: 'summary' | 'records',
): Promise<Record<string, unknown>[]> {
  const sink = new RecordingSink();
  const engine = new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'sub-output-e2e',
    registry: new PipeRegistry([
      new ManualTriggerSourcePipe(),
      new ParentTriggerSourcePipe(),
      new TriggerPayloadSourcePipe(),
      new ScriptTransformPipe(),
      new SubWorkflowPipe(),
      new HttpResponsePipe(),
      sink,
    ]),
  });

  try {
    const child = parseWorkflowInput(CHILD as never);
    const top = parseWorkflowInput(parent(output) as never);
    await engine.stores.workflows.put(child as never);
    await engine.stores.workflows.put(top as never);
    await engine.start();
    await engine.scheduler.enqueue(top as never, {
      id: randomBytes(8).toString('hex'),
      workflowId: top.id,
      triggerId: 'manual',
      kind: 'manual',
      acceptedAt: new Date().toISOString(),
    } as never);
    await engine.idle();
    return sink.written;
  } finally {
    engine.close();
  }
}

describe('a sub-workflow returning its answer', () => {
  it('hands the child records to the next pipe', async () => {
    const seen = await run('records');

    // The point of the change: the parent can now *use* what the child worked
    // out, instead of reading a fixture that happens to look similar.
    expect(seen).toEqual([{ keyword: 'schema drift', clicks: 42 }]);
  });

  it('still reports only a summary by default', async () => {
    const seen = await run('summary');

    // Existing graphs compose this way already. Changing what they emit would
    // silently rewrite every one of them, so the new behaviour is opt-in.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ workflowId: CHILD.id, status: 'succeeded' });
    expect(seen[0]).not.toHaveProperty('keyword');
  });
});
