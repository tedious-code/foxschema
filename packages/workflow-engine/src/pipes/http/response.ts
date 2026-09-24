/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/response.ts).
 */
import * as z from 'zod';
import type { PipeContext, RecordBatch, SinkPipe } from '../../registry/index.js';
import {
  batchSizeField,
  definePipeMetadata,
  type PipeMetadata,
} from '../../sdk/index.js';

const configSchema = z.object({
  /**
   * Records to keep. A workflow answering an HTTP call returns a payload, not a
   * stream, so there has to be a ceiling — without one a runaway pipeline would
   * try to buffer a whole migration into one response body.
   */
  ...batchSizeField({ max: 10_000, default: 1_000 }),
  /**
   * `records` returns the array. `first` returns a single object, which is what
   * a "look this up for me" endpoint wants — `[{...}]` forces every caller to
   * unwrap it.
   */
  shape: z.enum(['records', 'first']).default('records'),
});

/**
 * The workflow's answer to whoever called it — what makes a workflow an API
 * rather than a job.
 *
 * Trigger ingress has always returned `202 Accepted` with a run id, which is
 * right for an import but useless for "create this customer and tell me the
 * id". A pipeline ending in this pipe can be called synchronously.
 *
 * It writes through `context.output`, a run-scoped collector the engine
 * injects: the pipe declares what the answer is, the engine decides how that
 * is persisted and handed back. When nothing is waiting on the run the
 * collector is absent and this pipe is a no-op, so the same workflow works
 * called either way.
 */
export class HttpResponsePipe implements SinkPipe {
  readonly type = 'sink.response';
  readonly role = 'sink';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Workflow response',
      category: 'Output/API',
      family: 'http',
      version: '0.1.0',
      role: 'sink',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [],
      configSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    configSchema.parse(config);
  }

  async write(batch: RecordBatch, context: PipeContext): Promise<void> {
    // No collector means nobody is waiting — a cron or fire-and-forget run.
    if (!context.output) return;
    const config = configSchema.parse(context.pipe.config);
    context.output.collect(batch.records.slice(0, config.batchSize));
  }
}

/** How a collected payload is shaped for the caller. */
export function shapeRunOutput(
  records: Record<string, unknown>[],
  shape: 'records' | 'first' = 'records',
): unknown {
  if (shape === 'first') return records[0] ?? null;
  return records;
}
