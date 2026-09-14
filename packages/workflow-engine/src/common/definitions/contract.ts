/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/contract.ts).
 */
import { z } from 'zod';

// A data contract: the typed shape carried on every edge of a pipeline. Field
// types are expressed as canonical SQL type strings (e.g. "decimal(12,2)"),
// which @foxschema/core parses/renders per dialect — the same vocabulary a sink
// uses to auto-create its target table.
export const fieldSchema = z.object({
  name: z.string().min(1),
  /** Canonical SQL type string, parsed by core's type-mapping layer. */
  type: z.string().min(1),
  nullable: z.boolean().default(true),
  /** Optional value-coercion hints applied before validation (e.g. date format). */
  coerce: z.record(z.string(), z.unknown()).optional(),
  /** Action when a value can't be coerced/validated for this field. */
  onError: z.enum(['reject', 'null', 'default']).default('reject'),
});
export type FieldDef = z.infer<typeof fieldSchema>;

export const contractSchema = z.object({
  fields: z.array(fieldSchema).min(1),
  /** What to do with input fields not named in the contract. */
  unknownFields: z.enum(['drop', 'passthrough', 'fail']).default('drop'),
});
export type ContractDef = z.infer<typeof contractSchema>;
