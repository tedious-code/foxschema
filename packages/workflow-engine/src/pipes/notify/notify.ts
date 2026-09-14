/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * What the notification sinks share: send once per batch or once per record,
 * with a bounded number in flight and a choice between failing the run and
 * moving on when one message cannot be sent.
 */
import * as z from 'zod';
import { nonEmptyString } from '../../common/index.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import {
  concurrencyField,
  errorPolicyField,
  interpolate,
  mapRecordsConcurrently,
  type ErrorPolicy,
} from '../../sdk/index.js';
import { templateScope } from '../pipe-context.js';
import type { sendMail } from './smtp.js';

/** What the notification pipes reach the outside world with; replaced in tests. */
export interface NotifyTransports {
  fetch?: typeof fetch;
  sendMail?: typeof sendMail;
}

/** One or more recipient templates. */
export const recipientsField = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const deliveryFields = {
  /** `batch` sends one notification per batch, a summary; `record` sends one per record. */
  mode: z.enum(['batch', 'record']).default('batch'),
  ...concurrencyField({ max: 8 }),
  ...errorPolicyField,
};

/**
 * The template scope for each notification: the batch as `records` and
 * `count`, or each record both as `record` and flattened, as the HTTP sink
 * does, so `{{email}}` and `{{record.email}}` both work.
 */
export function notificationScopes(
  batch: RecordBatch,
  context: PipeContext,
  mode: 'batch' | 'record',
): Record<string, unknown>[] {
  const base = templateScope(context);
  return mode === 'batch'
    ? [{ ...base, records: batch.records, count: batch.records.length }]
    : batch.records.map((record) => ({ ...base, ...record, record }));
}

/** Recipients from templates. One value may carry several, comma-separated, e.g. from a variable. */
export function recipientList(templates: string | string[], scope: Record<string, unknown>): string[] {
  return (Array.isArray(templates) ? templates : [templates])
    .flatMap((template) => interpolate(template, scope).split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Send once per scope, at most `concurrency` at a time, honouring `onError`. */
export async function deliverEach(
  scopes: Record<string, unknown>[],
  options: { concurrency: number; onError: ErrorPolicy },
  send: (scope: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  await mapRecordsConcurrently(scopes, options.concurrency, async (scope) => {
    try {
      await send(scope);
    } catch (error) {
      if (options.onError === 'skip') return;
      throw error;
    }
  });
}

/** A non-empty field of a secret, trimmed; a number (a port) reads as its digits. */
export function secretText(secret: Record<string, unknown>, key: string): string | undefined {
  const value = secret[key];
  return nonEmptyString(typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : undefined);
}
