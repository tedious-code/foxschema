/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/sub-workflow/index.ts).
 */
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../../sdk/index.js';

/**
 * Dispatches a child workflow run per incoming batch (the batch records are
 * the child's input payload), waits for its terminal status, and emits one
 * summary record. Dispatch goes through the engine's workflow service, which
 * carries the runtime circular-dependency guard and max nesting depth.
 */
export class SubWorkflowPipe implements TransformPipe {
  readonly type = 'workflow.sub';
  readonly role = 'transform';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Sub-workflow',
      category: 'Logic',
      family: 'compose',
      tags: ['reuse', 'auth', 'integration', 'agent'],
      version: '0.2.0',
      role: 'transform',
      sideEffects: true,
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: {
        type: 'object',
        properties: {
          workflowId: {
            type: 'string',
            description:
              'Workflow to run for each incoming batch; the batch records are its input payload.',
          },
          output: {
            type: 'string',
            enum: ['summary', 'records'],
            default: 'summary',
            description:
              "What flows on: 'summary' (one row: runId/status/count) or 'records' (whatever the child returned). Defaults to summary so existing graphs keep their shape.",
          },
          workflowVersion: {
            type: 'integer',
            minimum: 1,
            description:
              'Optional pin to a specific workflow version (Agentic OS reuse). When omitted, the latest stored definition is used.',
          },
        },
        required: ['workflowId'],
        additionalProperties: false,
      },
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    if (typeof config.workflowId !== 'string' || config.workflowId.length === 0) {
      throw new Error('workflow.sub requires a workflowId');
    }
    if (
      config.output !== undefined &&
      config.output !== 'summary' &&
      config.output !== 'records'
    ) {
      throw new Error("workflow.sub output must be 'summary' or 'records'");
    }
    if (
      config.workflowVersion !== undefined &&
      (typeof config.workflowVersion !== 'number' ||
        !Number.isInteger(config.workflowVersion) ||
        config.workflowVersion < 1)
    ) {
      throw new Error('workflow.sub workflowVersion must be a positive integer');
    }
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<RecordBatch> {
    const workflowId = context.pipe.config.workflowId as string;
    const workflowVersion =
      typeof context.pipe.config.workflowVersion === 'number'
        ? context.pipe.config.workflowVersion
        : undefined;
    if (!context.workflows) {
      throw new Error(
        'workflow.sub requires the engine workflow service (context.workflows)',
      );
    }
    const result = await context.workflows.call(workflowId, batch.records, {
      signal: context.signal,
      ...(workflowVersion !== undefined ? { workflowVersion } : {}),
    });
    if (result.status !== 'succeeded') {
      throw new Error(
        `sub-workflow ${workflowId} ${result.status} (run ${result.runId})`,
      );
    }
    // `records` hands the child's answer to the next pipe, which is what makes
    // a sub-workflow reusable as a *step* rather than only as a side effect.
    // The default stays `summary`: changing what an existing graph emits would
    // silently alter every workflow already composing this way.
    const emitRecords = context.pipe.config.output === 'records';
    return {
      id: `${batch.id}:${context.pipe.id}`,
      partitionId: batch.partitionId,
      records: emitRecords
        ? result.output
        : [
            {
              workflowId,
              ...(workflowVersion !== undefined ? { workflowVersion } : {}),
              runId: result.runId,
              status: result.status,
              records: batch.records.length,
            },
          ],
    };
  }
}
