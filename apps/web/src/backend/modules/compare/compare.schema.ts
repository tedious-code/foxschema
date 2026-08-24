/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Input validation for the compare endpoint.
 *
 * Separate from the handler so both transports validate identically — a second
 * transport that skips validation is the same class of bug as one that skips a
 * permission check.
 *
 * Before this existed, `POST /compare {}` reached the service and surfaced as
 * `500 Cannot read properties of undefined (reading 'connectionId')`: a caller's
 * malformed request reported as a server fault.
 */
import { ServiceError } from '../../platform/contracts/actor';
import type { DbObjectType } from '@foxschema/db';
import type { CompareInput } from './compare.service';

/** A connection reference is either a saved id or an inline config. */
function isConnectionRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  return typeof ref.connectionId === 'string' || typeof ref.config === 'object';
}

export function parseCompareInput(body: unknown): CompareInput {
  if (!body || typeof body !== 'object') {
    throw new ServiceError('invalid_input', 'A JSON body with source and target is required.');
  }
  const raw = body as Record<string, unknown>;

  if (!isConnectionRef(raw.source)) {
    throw new ServiceError('invalid_input', 'source must name a saved connection or carry a config.');
  }
  if (!isConnectionRef(raw.target)) {
    throw new ServiceError('invalid_input', 'target must name a saved connection or carry a config.');
  }
  // An absent scope means "everything", which is what the UI sends on a plain
  // compare — rejecting it would break the common path.
  if (raw.scope !== undefined && !Array.isArray(raw.scope)) {
    throw new ServiceError('invalid_input', 'scope must be an array of object types when given.');
  }

  return {
    source: raw.source as CompareInput['source'],
    target: raw.target as CompareInput['target'],
    scope: (raw.scope ?? []) as DbObjectType[],
  };
}
