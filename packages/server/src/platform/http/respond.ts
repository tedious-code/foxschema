/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * One way to answer with an error.
 *
 * Before this, 143 call sites built their own: `res.status(400).json({ error })`
 * in some places, `{ ok: false, error }` in others, and never a machine-readable
 * code — so a client could see a 400 but not tell a malformed body from a
 * rejected value, and could not tell a lock conflict from any other 409.
 *
 * Passing the *code* rather than the status is the point. The status is derived
 * (`ERROR_STATUS`), so the two cannot disagree, and the thing a handler has to
 * decide is the thing it actually knows: what kind of failure this is. Picking
 * a number invites 400 for everything.
 */
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode, type FieldError } from '@foxschema/shared';
import { toApiError } from '../contracts/actor';
import { redactCredentials } from './redact';

/**
 * The only part of a response these helpers need.
 *
 * Structural on purpose: Express's `Response` satisfies it as-is, and a Fastify
 * reply is wrapped by `replyResponder` below. Without this, moving a route to
 * Fastify would mean editing all 123 error sites a second time — the helpers
 * exist so that call sites stop caring which server is running.
 */
export interface JsonResponder {
  status(code: number): JsonResponder;
  json(body: unknown): unknown;
}

/** Minimal shape of a Fastify reply, without importing fastify here. */
interface FastifyLikeReply {
  status(code: number): FastifyLikeReply;
  send(body: unknown): unknown;
}

/** Adapt a Fastify reply to the responder shape. */
export function replyResponder(reply: FastifyLikeReply): JsonResponder {
  return {
    status(code: number) {
      reply.status(code);
      return this;
    },
    json(body: unknown) {
      return reply.send(body);
    },
  };
}

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
  res: JsonResponder,
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
  res.status(ERROR_STATUS[code]).json(body);
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
  res: JsonResponder,
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
