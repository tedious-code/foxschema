/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/http/src/transform.ts).
 */
import { z } from 'zod';
import { coerceHttpRequest, httpRequestSchema } from '../../common/index.js';
import type {
  PipeContext,
  RecordBatch,
  TransformPipe,
} from '../../registry/index.js';
import {
  REJECTS_PORT,
  definePipeMetadata,
  mapRecordsConcurrently,
  type PipeMetadata,
} from '../../sdk/index.js';
import { executeHttpRequest, describeHttpFailure } from './request.js';
import { requestCredentialId } from '../pipe-context.js';

const configSchema = z.object({
  /**
   * The request. Unlike the source, this one is built *per record*, so
   * `{{field}}` resolves against the row — which is what lets a date computed
   * upstream, or an id looked up two pipes ago, decide what is fetched.
   */
  request: z.preprocess((input) => coerceHttpRequest(input), httpRequestSchema),
  /** Field the response body is written to. */
  outputField: z.string().min(1).default('response'),
  /** Also record the status, for pipelines that branch on it. */
  statusField: z.string().min(1).optional(),
  concurrency: z.number().int().min(1).max(16).default(4),
  onError: z.enum(['fail', 'skip']).default('fail'),
});

/**
 * Call an HTTP API in the middle of a pipeline and keep the answer.
 *
 * `source.api.http` can only start a pipeline from a request fixed at author
 * time, and `sink.http` throws its response away. Between them sat everything
 * interesting: enriching a row from an API, creating a resource and keeping
 * the id it returns, or querying a window of dates computed from the run's
 * own schedule. This is that gap.
 *
 * `onError: 'skip'` sends the failed record out `rejects` rather than dropping
 * it — a row that could not be enriched is usually worth looking at, not
 * worth losing.
 */
export class HttpTransformPipe implements TransformPipe {
  readonly type = 'transform.http';
  readonly role = 'transform';

  constructor(private readonly request?: typeof fetch) {}

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'HTTP lookup',
      category: 'Transform/API',
      family: 'http',
      tags: ['auth', 'api'],
      version: '0.1.0',
      role: 'transform',
      // Issues a request per record, and may refresh an OAuth token to do it.
      // Without this the dry run treats the pipe as pure and executes it for
      // real — which sent a live POST to oauth2.googleapis.com during
      // `npm run smoke`, the script whose whole purpose is not doing that.
      sideEffects: true,
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [
        { name: 'out', type: 'records' },
        { name: REJECTS_PORT, type: 'records' },
      ],
      configSchema: {
        type: 'object',
        required: ['request'],
        properties: {
          request: { type: 'object' },
          outputField: { type: 'string', minLength: 1, default: 'response' },
          statusField: { type: 'string', minLength: 1 },
          concurrency: {
            type: 'integer',
            minimum: 1,
            maximum: 16,
            default: 4,
          },
          onError: {
            type: 'string',
            enum: ['fail', 'skip'],
            default: 'fail',
          },
        },
      },
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    configSchema.parse(config);
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<Map<string, RecordBatch>> {
    const config = configSchema.parse(context.pipe.config);
    const credentialId = requestCredentialId(config.request.auth, context);
    // Revealed once per batch, not once per record: a decrypt per row is
    // wasted work and widens the window the secret is in memory.
    const secret = credentialId
      ? await context.credentials?.revealSecret(credentialId)
      : undefined;

    const { results, failures } = await mapRecordsConcurrently(
      batch.records,
      config.concurrency,
      async (record) => {
        const result = await executeHttpRequest({
          request: config.request,
          secret,
          credentialId,
          credentials: context.credentials,
          variables: { ...(context.variables ?? {}), ...record },
          trigger: {
            id: context.invocation?.triggerId,
            kind: context.invocation?.kind,
          },
          fetch: this.request,
          signal: context.signal,
        });
        if (!result.ok) {
          throw new Error(
            `${config.request.method} ${result.url} ${describeHttpFailure(result)}`,
          );
        }
        return {
          ...record,
          [config.outputField]: result.body,
          ...(config.statusField ? { [config.statusField]: result.status } : {}),
        };
      },
      { onFailure: config.onError === 'fail' ? 'throw' : 'collect' },
    );

    const enriched = results.filter(
      (record): record is Record<string, unknown> => record !== undefined,
    );
    const rejected = batch.records.flatMap((record, index) => {
      const failure = failures[index];
      return failure === undefined
        ? []
        : [{ ...record, _error: (failure as Error).message }];
    });

    const ports = new Map<string, RecordBatch>();
    if (enriched.length > 0) ports.set('out', { ...batch, records: enriched });
    if (rejected.length > 0) {
      ports.set(REJECTS_PORT, {
        ...batch,
        id: `${batch.id}:rejects`,
        records: rejected,
        // Cursor-less like every dead-letter batch: a checkpoint may only
        // advance through data.
        cursor: undefined,
      });
    }
    return ports;
  }
}
