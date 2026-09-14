/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/io-schema.ts).
 */
import Ajv, { type ValidateFunction } from 'ajv';

// One shared validator; strict:false accepts user-authored schemas without
// meta-schema strictness complaints. Compiled validators are cached by schema
// object identity — each immutable run snapshot parses to a fresh object, so
// a WeakMap keeps the cache from pinning old snapshots.
const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap<object, ValidateFunction>();

/** True when `schema` is an object that ajv accepts as a JSON Schema. */
export function isValidJsonSchema(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    return false;
  }
  return ajv.validateSchema(schema) as boolean;
}

/** Thrown when a run's input payload fails the workflow's `inputSchema`. */
export class WorkflowInputError extends Error {
  override name = 'WorkflowInputError';
}

/**
 * Validate `data` against a JSON Schema using the shared cached compiler.
 * Returns `null` when valid, else a human-readable error summary.
 */
export function validateAgainstSchema(
  schema: Record<string, unknown>,
  data: unknown,
): string | null {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  return validate(data)
    ? null
    : ajv.errorsText(validate.errors, { separator: '; ' });
}

/**
 * Enforce `workflow.inputSchema` against an activation payload. Applies to
 * external input — manual `inputData`, webhook/HTTP bodies, and sub-workflow
 * call payloads; cron's engine-generated payload is exempt at the call site.
 * A workflow without an `inputSchema` accepts anything.
 */
export function validateWorkflowInput(
  workflow: { id: string; inputSchema?: Record<string, unknown> },
  payload: unknown,
): void {
  const schema = workflow.inputSchema;
  if (!schema) return;
  const errors = validateAgainstSchema(schema, payload);
  if (errors !== null) {
    throw new WorkflowInputError(
      `workflow ${workflow.id} input invalid: ${errors}`,
    );
  }
}
