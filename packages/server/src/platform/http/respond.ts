/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The single way to send an error response.
 *
 * Every error the API returns has the same shape: `{ ok, error, code }`, where
 * `code` is a value from the shared `ErrorCode` vocabulary. Clients branch on
 * `code`; `error` is the human-readable message.
 *
 * Callers pass the code, not the HTTP status. The status is derived from the
 * code via `ERROR_STATUS`, so the two can never disagree, and the caller only
 * has to decide what kind of failure occurred.
 */
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode, type FieldError } from '@foxschema/shared';
import { toApiError } from '../contracts/actor';
import type { FastifyReply } from 'fastify';
import { redactCredentials } from './redact';

/** Extra fields a specific failure carries beyond the standard envelope. */
export interface ErrorDetails {
  /** Which inputs were rejected, so a form can mark them. */
  fields?: readonly FieldError[];
  /** When to retry — on `rate_limited`, and `unavailable` with a known wait. */
  retryAfterSec?: number;
  /**
   * Anything else this endpoint has always returned alongside the error.
   *
   * Exists so adopting the contract never *removes* a field a client reads —
   * `heldBy` on a lock conflict, for instance. New endpoints should not need it.
   */
  extra?: Record<string, unknown>;
}

/** Answer with the shared error contract. The status comes from the code. */
export function sendError(
  res: FastifyReply,
  code: ErrorCode,
  message: string,
  details: ErrorDetails = {}
): void {
  const body: ApiErrorBody & Record<string, unknown> = {
    ok: false,
    // Every error body leaves through here, so this is the one place that has
    // to strip credentials — some drivers quote the connection string back,
    // password included, and that used to reach the client verbatim.
    error: redactCredentials(message),
    code,
    ...(details.fields?.length ? { fields: details.fields } : {}),
    ...(details.retryAfterSec !== undefined ? { retryAfterSec: details.retryAfterSec } : {}),
    ...(details.extra ?? {}),
  };
  void res.status(ERROR_STATUS[code]).send(body);
}

/**
 * Answer from a caught value.
 *
 * Maps `ServiceError` to its own code and an open circuit to `unavailable`;
 * anything else keeps its message under `failed`, matching what the handlers
 * did before — a driver error still reaches the client rather than being
 * flattened into something generic.
 */
export function sendThrown(
  res: FastifyReply,
  error: unknown,
  fallback: string,
  details: ErrorDetails = {}
): void {
  const body = toApiError(error, fallback);
  sendError(res, body.code, body.error, {
    ...details,
    ...(body.retryAfterSec !== undefined ? { retryAfterSec: body.retryAfterSec } : {}),
  });
}
