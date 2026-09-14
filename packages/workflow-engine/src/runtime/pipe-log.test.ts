/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * What a pipe logs becomes part of its run's timeline, with the pipe's
 * identity, and a chatty pipe cannot flood it.
 */
import { describe, expect, it } from 'vitest';
import type { EventStore, NewRunEvent, PipeDef, PipelineDef, RunEvent } from '../common/index.js';
import { PipeRegistry, type SinkPipe, type SourcePipe } from '../registry/index.js';
import { PipelineExecutor } from './executor.js';

class MemoryEvents implements EventStore {
  readonly events: RunEvent[] = [];
  private seq = 0;

  async append(event: NewRunEvent): Promise<RunEvent> {
    const row: RunEvent = { ...event, seq: ++this.seq };
    this.events.push(row);
    return row;
  }

  async list(workflowRunId: string, afterSeq = 0): Promise<RunEvent[]> {
    return this.events.filter((event) => event.workflowRunId === workflowRunId && event.seq > afterSeq);
  }
}

function run(lines: number) {
  const events = new MemoryEvents();
  const source: SourcePipe = {
    type: 'test.source',
    role: 'source',
    async *read() {
      yield { id: 'b1', partitionId: '0', records: [{ id: 1 }] };
    },
  };
  const sink: SinkPipe = {
    type: 'test.sink',
    role: 'sink',
    async write(batch, context) {
      const logger = context.infrastructure!.logger;
      logger.info('writing', { records: batch.records.length });
      logger.warn('slow target');
      logger.error('one row rejected', { row: 1 });
      for (let i = 0; i < lines; i++) logger.info(`line ${i}`);
    },
  };
  const pipes: PipeDef[] = [
    { id: 'read', role: 'source', type: 'test.source', config: {}, concurrency: 1 },
    { id: 'write', role: 'sink', type: 'test.sink', config: {}, concurrency: 1 },
  ];
  const pipeline: PipelineDef = { id: 'load', name: 'load', pipes, edges: [{ from: 'read', to: 'write' }] };
  const executor = new PipelineExecutor({ registry: new PipeRegistry([source, sink]), events });
  return { events, done: executor.execute(pipeline, { workflowRunId: 'run-1' }) };
}

const logs = (events: MemoryEvents) => events.events.filter((event) => event.type === 'pipe.log');

describe('pipe logs', () => {
  it('records each line as a run event with the pipe that wrote it and its level', async () => {
    const { events, done } = run(0);
    await done;
    // Appends are fire-and-forget; let them land.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logs(events).map(({ pipelineId, pipeId, message, data }) => ({ pipelineId, pipeId, message, data }))).toEqual([
      { pipelineId: 'load', pipeId: 'write', message: 'writing', data: { records: 1, level: 'info' } },
      { pipelineId: 'load', pipeId: 'write', message: 'slow target', data: { level: 'warn' } },
      { pipelineId: 'load', pipeId: 'write', message: 'one row rejected', data: { row: 1, level: 'error' } },
    ]);
  });

  it('stops recording a pipe’s lines at the limit, and says so on the last one', async () => {
    const { events, done } = run(500);
    await done;
    await new Promise((resolve) => setImmediate(resolve));

    const recorded = logs(events);
    expect(recorded).toHaveLength(200);
    expect(recorded.at(-1)!.message).toMatch(/later lines from this pipe are not recorded/);
  });
});
