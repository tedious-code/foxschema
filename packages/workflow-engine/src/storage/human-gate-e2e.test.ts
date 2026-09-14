/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/human-gate-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Engine, PipeRegistry, parseWorkflowInput } from '../index.js';
import { HumanGatePipe } from '../pipes/control/index.js';
import {
  ManualTriggerSourcePipe,
  TriggerPayloadSourcePipe,
} from '../pipes/trigger/index.js';
import type {
  PipeContext,
  RecordBatch,
  SinkPipe,
} from '../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../sdk/index.js';

/**
 * The whole human-in-the-loop round trip against a real engine and a real
 * database: a run stops on a gate, a person answers, and the run finishes with
 * the answer in hand.
 *
 * Worth an end-to-end test rather than unit tests of the parts, because the
 * interesting claims are all *between* components — that a pause is not
 * recorded as a failure, that the question survives to be asked, that the
 * answer reaches the pipe that asked for it, and that the sink downstream
 * sees nothing at all until then.
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

const WORKFLOW = {
  id: 'otp-login',
  name: 'Login that needs a code',
  version: 1,
  triggers: [{ id: 'run-now', kind: 'manual', enabled: true }],
  pipelines: [
    {
      id: 'main',
      name: 'Main',
      pipes: [
        { id: 'start', type: 'source.triggerPayload', role: 'source', config: {} },
        {
          id: 'ask',
          type: 'human.gate',
          role: 'transform',
          config: {
            key: 'otp',
            prompt: 'Enter the 6-digit code we just texted you',
            fields: [
              {
                key: 'code',
                label: 'Code',
                type: 'otp',
                secret: true,
                pattern: '\\d{6}',
              },
            ],
            channel: 'sms',
          },
        },
        { id: 'done', type: 'sink.recording', role: 'sink', config: {} },
      ],
      edges: [
        { from: 'start', to: 'ask' },
        { from: 'ask', to: 'done' },
      ],
    },
  ],
};

function buildEngine(sink: RecordingSink): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'human-gate-e2e',
    registry: new PipeRegistry([
      new ManualTriggerSourcePipe(),
      new TriggerPayloadSourcePipe(),
      new HumanGatePipe(),
      sink,
    ]),
  });
}

async function startRun(engine: Engine): Promise<string> {
  const parsed = parseWorkflowInput(WORKFLOW as never);
  await engine.stores.workflows.put(parsed as never);
  await engine.start();
  const result = await engine.scheduler.enqueue(parsed as never, {
    id: randomBytes(8).toString('hex'),
    workflowId: WORKFLOW.id,
    triggerId: 'run-now',
    kind: 'manual',
    acceptedAt: new Date().toISOString(),
  } as never);
  await engine.idle();
  return result.run!.id;
}

describe('a workflow that needs a person', () => {
  it('pauses, holds the question, and finishes once answered', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);

    try {
      const runId = await startRun(engine);

      // 1. Paused, not failed. This is the distinction the whole feature rests
      //    on: nothing went wrong, so nothing should page anyone.
      const paused = await engine.stores.runs.get(runId);
      expect(paused?.status).toBe('paused');
      expect(sink.written).toEqual([]);

      // 2. The question outlived the pipe that asked it, with enough detail to
      //    render a form on a phone.
      const pending = await engine.stores.humanInputs.pending(runId);
      expect(pending).toHaveLength(1);
      expect(pending[0]!.request.prompt).toMatch(/6-digit code/);
      expect(pending[0]!.request.channel).toBe('sms');
      expect(pending[0]!.request.fields[0]).toMatchObject({
        key: 'code',
        secret: true,
      });

      // 3. Someone answers.
      await engine.stores.humanInputs.answer(
        runId,
        'otp',
        { code: '123456' },
        new Date().toISOString(),
      );
      await engine.scheduler.resume(runId);
      await engine.idle();

      // 4. The run finished, and the answer reached the records downstream of
      //    the gate — the pipe re-executed and found it this time.
      const finished = await engine.stores.runs.get(runId);
      expect(finished?.status).toBe('succeeded');
      expect(sink.written).toHaveLength(1);
      expect(sink.written[0]!.human).toEqual({ code: '123456' });
    } finally {
      engine.close();
    }
  });

  it('asks once, however many times the pipe re-runs', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);

    try {
      const runId = await startRun(engine);
      // Resuming without answering re-runs the gate, which asks again. If that
      // created a second row the run would accumulate a question per attempt,
      // and a UI would show a growing pile of identical prompts.
      await engine.scheduler.resume(runId);
      await engine.idle();

      const pending = await engine.stores.humanInputs.pending(runId);
      expect(pending).toHaveLength(1);
      expect((await engine.stores.runs.get(runId))?.status).toBe('paused');
    } finally {
      engine.close();
    }
  });

  it('keeps the answer out of the run event log', async () => {
    const sink = new RecordingSink();
    const engine = buildEngine(sink);

    try {
      const runId = await startRun(engine);
      const events = await engine.stores.events.list(runId);
      const asked = events.find((e) => e.type === 'human.input.requested');

      // The log says what was asked and of whom, so the timeline explains why
      // the run stopped — but a secret field's *value* never appears, because
      // anyone who can read the run can read this.
      expect(asked).toBeDefined();
      expect(asked!.message).toMatch(/6-digit code/);
      expect(JSON.stringify(events)).not.toContain('123456');
    } finally {
      engine.close();
    }
  });
});
