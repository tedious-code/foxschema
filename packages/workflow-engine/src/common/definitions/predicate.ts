/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/definitions/predicate.ts).
 */
import { z } from 'zod';

/**
 * One vocabulary for "does this value look right".
 *
 * The verify pipe needed it for records, trigger conditions need it for
 * payloads and query results. Two implementations would drift — `matches`
 * anchored in one place and not the other is the sort of difference nobody
 * notices until a six-digit code matches inside a longer string.
 */

export const PREDICATE_OPERATORS = [
  'exists',
  'notEmpty',
  'equals',
  'notEquals',
  'gt',
  'gte',
  'lt',
  'lte',
  'matches',
  'oneOf',
  'minLength',
  'maxLength',
] as const;

export const predicateOperatorSchema = z.enum(PREDICATE_OPERATORS);
export type PredicateOperator = z.infer<typeof predicateOperatorSchema>;

/** Read a dot path, tolerating anything missing on the way down. */
export function getPath(source: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object'
          ? (acc as Record<string, unknown>)[key]
          : undefined,
      source,
    );
}

function size(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value)) return value.length;
  return NaN;
}

/**
 * Apply one operator.
 *
 * Never throws. A rule against a missing field fails *that rule* and gets
 * reported; throwing would abort a whole batch, or a whole schedule, over one
 * absent value — the opposite of what a check is for.
 */
export function applyPredicate(
  operator: PredicateOperator,
  value: unknown,
  expected?: unknown,
): boolean {
  switch (operator) {
    case 'exists':
      return value !== undefined && value !== null;
    case 'notEmpty':
      return (
        value !== undefined &&
        value !== null &&
        value !== '' &&
        !(Array.isArray(value) && value.length === 0)
      );
    case 'equals':
      return value === expected;
    case 'notEquals':
      return value !== expected;
    case 'gt':
      return Number(value) > Number(expected);
    case 'gte':
      return Number(value) >= Number(expected);
    case 'lt':
      return Number(value) < Number(expected);
    case 'lte':
      return Number(value) <= Number(expected);
    case 'matches':
      // Anchored. Unanchored `\d{6}` matches inside `abc123456xyz`, which for
      // a one-time code or an id check is precisely the wrong answer.
      return new RegExp(`^(?:${String(expected)})$`).test(String(value ?? ''));
    case 'oneOf':
      return Array.isArray(expected) && expected.includes(value as never);
    case 'minLength':
      return size(value) >= Number(expected);
    case 'maxLength':
      return size(value) <= Number(expected);
  }
}
