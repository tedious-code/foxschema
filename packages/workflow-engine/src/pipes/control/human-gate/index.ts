/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/human-gate/index.ts).
 */
import { z } from 'zod';
import {
  humanInputFieldSchema,
  promptChannelSchema,
  type HumanInputField,
} from '../../../common/index.js';
import type { PipeContext, RecordBatch, TransformPipe } from '../../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../../sdk/index.js';

/**
 * Stop and ask a person.
 *
 * The case this exists for: a workflow logs into a site, the site sends a code
 * to a phone, and no amount of engineering will produce that code. Same for a
 * CAPTCHA, an auth confirmation, or a setting nobody filled in. The workflow
 * is not wrong — it is blocked on a fact only a human has.
 *
 * Everything about the pause is run state, so the graph a reader looks at is
 * unchanged: one node, in line, that happens to take a while. No loop edge, no
 * second control-flow concept to learn.
 *
 * **This pipe runs twice.** Once to ask, and once more after someone answers,
 * because a resume re-executes from the checkpoint rather than resurrecting a
 * suspended function. Anything before the gate therefore happens twice too,
 * which is why the gate belongs early in a pipeline — right after the step
 * that discovered the need — rather than after expensive work.
 */

const configSchema = z.object({
  /**
   * Identifies the question within the run. Stable by design: it is how the
   * answer is found on the way back, so it must not vary between attempts.
   */
  key: z.string().min(1).default('input'),
  /** What the person is being asked, in their words. */
  prompt: z.string().min(1),
  fields: z.array(humanInputFieldSchema).min(1),
  channel: promptChannelSchema.default('webpage'),
  expiresInSeconds: z.number().int().positive().max(86_400).default(900),
  /**
   * Where the answer lands on each record. Nested rather than spread so a
   * field called `id` or `status` cannot quietly overwrite the row.
   */
  outputField: z.string().min(1).default('human'),
});

export type HumanGateConfig = z.infer<typeof configSchema>;

export class HumanGatePipe implements TransformPipe {
  readonly type = 'human.gate';
  readonly role = 'transform' as const;

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Ask a person',
      category: 'Logic/Human',
      family: 'human',
      tags: ['otp', 'captcha', 'auth', 'approval'],
      version: '0.1.0',
      role: 'transform',
      // Pausing a run is emphatically an effect on the world outside this
      // batch, and a dry run must never park itself waiting for an answer
      // nobody will give.
      sideEffects: true,
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [{ name: 'out', type: 'records' }],
      configSchema: {
        type: 'object',
        required: ['prompt', 'fields'],
        properties: {
          key: { type: 'string', minLength: 1, default: 'input' },
          prompt: { type: 'string', minLength: 1 },
          fields: { type: 'array', items: { type: 'object' } },
          channel: { type: 'string' },
          expiresInSeconds: { type: 'integer', minimum: 1, maximum: 86_400, default: 900 },
          outputField: { type: 'string', minLength: 1, default: 'human' },
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
  ): Promise<RecordBatch> {
    const config = configSchema.parse(context.pipe.config);
    const gateway = context.humanInput;
    if (!gateway) {
      // Failing beats pausing here. Without a gateway nothing can record the
      // question or deliver an answer, so a pause would be a run parked for
      // ever — the silent kind of broken.
      throw new Error(
        `${this.type} needs a human-input gateway; none is available in this context`,
      );
    }

    const answer = await gateway.get(config.key);
    if (!answer) {
      gateway.require({
        key: config.key,
        prompt: config.prompt,
        fields: config.fields,
        channel: config.channel,
        expiresInSeconds: config.expiresInSeconds,
      });
    }

    return {
      ...batch,
      records: batch.records.map((record) => ({
        ...record,
        [config.outputField]: answer,
      })),
    };
  }
}

/** The fields a caller must fill in, for building a form. */
export function formFields(config: unknown): HumanInputField[] {
  return configSchema.parse(config).fields;
}
