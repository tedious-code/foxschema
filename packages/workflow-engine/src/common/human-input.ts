/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/human-input.ts).
 */
import { z } from 'zod';
import { promptChannelSchema } from './pipes/families.js';

/**
 * Human-in-the-loop: a pipe that cannot proceed without a person.
 *
 * An OTP, a CAPTCHA solution, an auth code, a setting nobody configured — the
 * workflow is correct, it is simply blocked on a fact only a human has.
 *
 * The shape follows a decision already made in `docs/pipe-families.md`: a
 * pause is *run state*, not an edge. The DAG stays acyclic and nothing loops;
 * the run stops, someone answers, and it starts again.
 *
 * **Re-execution, not continuation.** On resume the pipe runs again from its
 * checkpoint, and this time the answer is there. The alternative — suspending
 * mid-function and resuming the closure — would mean serialising live
 * JavaScript state, which cannot survive the process restart this feature
 * exists to tolerate. Someone answering an OTP an hour later has very likely
 * outlived the process that asked. So a pipe asking for input must be safe to
 * run twice: ask, and on the second pass, proceed.
 *
 * Fields are declared rather than free-form because the form a person fills in
 * — in the designer, on a phone, in an email — is generated from them. It is
 * the same principle the product already runs on: the UI is a projection of a
 * schema, and the engine only ever sees the schema.
 */

export const HUMAN_INPUT_FIELD_TYPES = [
  'text',
  'number',
  'password',
  'otp',
  'boolean',
  'url',
] as const;

export const humanInputFieldSchema = z.object({
  /** Key the answer lands under, e.g. `code`. */
  key: z.string().min(1),
  /** Shown next to the box. */
  label: z.string().min(1),
  type: z.enum(HUMAN_INPUT_FIELD_TYPES).default('text'),
  /**
   * Encrypted at rest and never returned by the API. An OTP is a credential
   * with a short life, not a form value — reading one back out would make the
   * pending-input endpoint a way to harvest them.
   */
  secret: z.boolean().default(false),
  optional: z.boolean().default(false),
  /** Anchored regex the answer must match, e.g. `\\d{6}` for a 6-digit code. */
  pattern: z.string().optional(),
  /** Sentence under the box: where to look for the code, what format. */
  help: z.string().optional(),
});

export type HumanInputField = z.infer<typeof humanInputFieldSchema>;

export const humanInputRequestSchema = z.object({
  /**
   * Stable per run and pipe. It is how the pipe finds its answer on the way
   * back, so it must not be generated fresh on each attempt — a random key
   * would ask again forever.
   */
  key: z.string().min(1),
  /** What the person is being asked, in their words. */
  prompt: z.string().min(1),
  fields: z.array(humanInputFieldSchema).min(1),
  /** Where to reach them. `pause` means "just stop"; someone will notice. */
  channel: promptChannelSchema.default('webpage'),
  /**
   * After this the request is dead and the run fails rather than waiting
   * forever. An OTP is worthless in an hour; a config value may be worth a
   * day. Default is 15 minutes because the common case is a one-time code.
   */
  expiresInSeconds: z
    .number()
    .int()
    .positive()
    .max(86_400)
    .default(900),
});

export type HumanInputRequest = z.infer<typeof humanInputRequestSchema>;

export type HumanInputStatus = 'pending' | 'answered' | 'expired' | 'cancelled';

/** A request as stored: what was asked, of whom, and whether it was answered. */
export interface HumanInputRecord {
  id: string;
  workflowRunId: string;
  pipelineId: string;
  pipeId: string;
  request: HumanInputRequest;
  status: HumanInputStatus;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string;
}

/**
 * Thrown by `context.humanInput.require()`. The runtime treats it as a pause
 * rather than a failure: the run is not broken, it is waiting.
 */
export class HumanInputRequired extends Error {
  readonly request: HumanInputRequest;

  constructor(request: HumanInputRequest) {
    super(`human input required: ${request.key} — ${request.prompt}`);
    this.name = 'HumanInputRequired';
    this.request = request;
  }
}

export function isHumanInputRequired(
  error: unknown,
): error is HumanInputRequired {
  // Name rather than instanceof: the error crosses module boundaries (plugins
  // bring their own copy of this class), where instanceof is quietly false —
  // turning a pause into a failed run, which is the worst possible outcome
  // here because the person was already asked.
  return error instanceof Error && error.name === 'HumanInputRequired';
}

/**
 * Strip secret answers before anything leaves the engine — API responses, run
 * events, logs. Applied at the boundary rather than the call site so a new
 * surface cannot forget.
 */
export function redactAnswer(
  fields: HumanInputField[],
  answer: Record<string, unknown>,
): Record<string, unknown> {
  const secret = new Set(
    fields.filter((field) => field.secret).map((field) => field.key),
  );
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(answer)) {
    safe[key] = secret.has(key) ? '[redacted]' : value;
  }
  return safe;
}
