/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/contracts.ts).
 */
import type { ContractDef, FieldDef } from '../common/index.js';
import type { RecordBatch } from '../registry/index.js';

export class ContractViolationError extends Error {
  constructor(
    message: string,
    readonly rejected: Record<string, unknown>[] = [],
  ) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

/**
 * Apply an edge contract to a batch: coerce fields, drop/passthrough unknowns,
 * and reject/null/default invalid values per field policy.
 */
export function applyContract(
  batch: RecordBatch,
  contract: ContractDef,
): { batch: RecordBatch; rejected: Record<string, unknown>[] } {
  const rejected: Record<string, unknown>[] = [];
  const records: Record<string, unknown>[] = [];

  for (const record of batch.records) {
    try {
      records.push(applyRecord(record, contract));
    } catch (error) {
      if (error instanceof ContractViolationError) {
        rejected.push(...error.rejected);
        continue;
      }
      throw error;
    }
  }

  return {
    batch: { ...batch, records },
    rejected,
  };
}

function applyRecord(
  record: Record<string, unknown>,
  contract: ContractDef,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const known = new Set(contract.fields.map((field) => field.name));

  for (const field of contract.fields) {
    const raw = record[field.name];
    if (raw === undefined || raw === null) {
      if (!field.nullable) {
        throw rejectRecord(record, `missing required field ${field.name}`);
      }
      output[field.name] = null;
      continue;
    }
    try {
      output[field.name] = coerceValue(raw, field);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (field.onError === 'null') {
        if (!field.nullable) {
          throw rejectRecord(record, message);
        }
        output[field.name] = null;
      } else if (field.onError === 'default') {
        output[field.name] = field.coerce?.default ?? null;
      } else {
        throw rejectRecord(record, message);
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (known.has(key)) continue;
    if (contract.unknownFields === 'fail') {
      throw rejectRecord(record, `unknown field ${key}`);
    }
    if (contract.unknownFields === 'passthrough') {
      output[key] = value;
    }
  }

  return output;
}

function coerceValue(value: unknown, field: FieldDef): unknown {
  const type = field.type.toLowerCase();
  if (type.startsWith('int') || type === 'integer' || type === 'bigint') {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number)) {
      throw new Error(`cannot coerce ${field.name} to integer`);
    }
    return number;
  }
  if (
    type.startsWith('numeric') ||
    type.startsWith('decimal') ||
    type === 'float' ||
    type === 'double' ||
    type === 'real'
  ) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`cannot coerce ${field.name} to number`);
    }
    return number;
  }
  if (type === 'boolean' || type === 'bool') {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new Error(`cannot coerce ${field.name} to boolean`);
  }
  if (type.startsWith('varchar') || type === 'text' || type === 'string') {
    return String(value);
  }
  return value;
}

function rejectRecord(
  record: Record<string, unknown>,
  message: string,
): ContractViolationError {
  return new ContractViolationError(message, [record]);
}
