/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/verify.ts).
 */
import { z } from 'zod';
import {
  PREDICATE_OPERATORS,
  applyPredicate,
  getPath,
  predicateOperatorSchema,
  validateAgainstSchema,
} from '../../common/index.js';
import type { PipeContext, RecordBatch, TransformPipe } from '../../registry/index.js';
import { REJECTS_PORT, definePipeMetadata, type PipeMetadata } from '../../sdk/index.js';

/**
 * Check records before something downstream trusts them.
 *
 * Sources already validate what they read, but the interesting failures happen
 * *after* that: an AI step returns a title of 300 characters, an HTTP call
 * comes back 200 with an empty body, a script drops a field three pipes later.
 * Until now the only way to catch that mid-pipeline was a hand-written
 * `transform.script` per workflow, which is how each one ends up with its own
 * slightly different idea of what "valid" means.
 *
 * Two ways to say what good looks like, because they answer different
 * questions:
 *
 * - `schema` — a JSON Schema, the same dialect and the same validator the
 *   sources and workflow I/O contracts already use. One vocabulary, not two.
 * - `rules` — field assertions with messages, for the things a schema is
 *   clumsy at: "title is 50–60 characters", "score beats 0.7".
 *
 * Failures leave by the `rejects` port rather than killing the run, matching
 * the dead-letter shape the CSV and text sources established. A batch where
 * two rows of fifty are bad is not a failed batch.
 */

const ruleSchema = z.object({
  /** Dot path into the record. */
  field: z.string().min(1),
  op: predicateOperatorSchema,
  /** Compared against; unused by `exists` and `notEmpty`. */
  value: z.unknown().optional(),
  /** Shown on failure. Falls back to a generated sentence. */
  message: z.string().optional(),
});

export type VerifyRule = z.infer<typeof ruleSchema>;

const configSchema = z
  .object({
    schema: z.record(z.string(), z.unknown()).optional(),
    rules: z.array(ruleSchema).max(64).default([]),
    /**
     * Fraction of rules a record must pass, 0–1. The default of 1 means every
     * rule — a verifier that lets things through by default is not a verifier.
     * Lower it when rules are advisory (a content score) rather than binding.
     */
    minScore: z.number().min(0).max(1).default(1),
    /**
     * `reject` sends failures to the dead-letter port, `fail` stops the run,
     * `annotate` passes everything through carrying its verdict — useful when
     * you want the score recorded but not acted on yet.
     */
    onInvalid: z.enum(['reject', 'fail', 'annotate']).default('reject'),
    /** Where the verdict is written on each record. */
    outputField: z.string().min(1).default('verification'),
  })
  .refine((config) => config.schema !== undefined || config.rules.length > 0, {
    message: 'verify needs a schema, rules, or both — otherwise it checks nothing',
  });

export type VerifyConfig = z.infer<typeof configSchema>;

export interface VerifyFailure {
  field: string;
  op: string;
  message: string;
}

export interface Verdict {
  ok: boolean;
  /** Fraction of checks passed, 0–1. */
  score: number;
  failures: VerifyFailure[];
}

function describe(rule: VerifyRule): string {
  return rule.message ?? `${rule.field} failed ${rule.op}`;
}

/** The verdict for one record — exported so a caller can check without a run. */
export function verifyRecord(
  record: Record<string, unknown>,
  config: VerifyConfig,
): Verdict {
  const failures: VerifyFailure[] = [];
  let checks = 0;

  if (config.schema) {
    checks += 1;
    const problem = validateAgainstSchema(config.schema, record);
    if (problem) {
      failures.push({ field: '', op: 'schema', message: problem });
    }
  }

  for (const rule of config.rules) {
    checks += 1;
    if (!applyPredicate(rule.op, getPath(record, rule.field), rule.value)) {
      failures.push({ field: rule.field, op: rule.op, message: describe(rule) });
    }
  }

  // No checks cannot happen (the config refuses it), but dividing by zero
  // would score an empty verifier as a failure, which is the wrong default.
  const score = checks === 0 ? 1 : (checks - failures.length) / checks;
  return { ok: score >= config.minScore, score, failures };
}

export class VerifyPipe implements TransformPipe {
  readonly type = 'transform.verify';
  readonly role = 'transform' as const;

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Verify',
      category: 'Transform/Quality',
      family: 'logic',
      tags: ['validate', 'quality', 'guard'],
      version: '0.1.0',
      role: 'transform',
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [
        { name: 'out', type: 'records' },
        // Dead-letter, same shape the CSV and text sources use.
        { name: REJECTS_PORT, type: 'records' },
      ],
      configSchema: {
        type: 'object',
        properties: {
          schema: { type: 'object' },
          rules: {
            type: 'array',
            maxItems: 64,
            items: {
              type: 'object',
              required: ['field', 'op'],
              properties: {
                field: { type: 'string', minLength: 1 },
                op: { type: 'string', enum: [...PREDICATE_OPERATORS] },
                value: {},
                message: { type: 'string' },
              },
            },
          },
          minScore: { type: 'number', minimum: 0, maximum: 1, default: 1 },
          onInvalid: {
            type: 'string',
            enum: ['reject', 'fail', 'annotate'],
            default: 'reject',
          },
          outputField: { type: 'string', minLength: 1, default: 'verification' },
        },
      },
    });
  }

  validateConfig(config: unknown): void {
    configSchema.parse(config);
  }

  async transform(
    batch: RecordBatch,
    context: PipeContext,
  ): Promise<Map<string, RecordBatch>> {
    const config = configSchema.parse(context.pipe.config);
    const passed: Record<string, unknown>[] = [];
    const rejected: Record<string, unknown>[] = [];

    for (const record of batch.records) {
      const verdict = verifyRecord(record, config);
      const annotated = { ...record, [config.outputField]: verdict };

      if (verdict.ok || config.onInvalid === 'annotate') {
        passed.push(annotated);
        continue;
      }
      if (config.onInvalid === 'fail') {
        throw new Error(
          `record failed verification: ${verdict.failures
            .map((failure) => failure.message)
            .join('; ')}`,
        );
      }
      rejected.push(annotated);
    }

    // Only ports with records: an empty batch on `rejects` would light up a
    // dead-letter path that nothing actually went down.
    const ports = new Map<string, RecordBatch>();
    if (passed.length > 0) ports.set('out', { ...batch, records: passed });
    if (rejected.length > 0) {
      ports.set(REJECTS_PORT, {
        ...batch,
        id: `${batch.id}:${REJECTS_PORT}`,
        records: rejected,
      });
    }
    return ports;
  }
}
