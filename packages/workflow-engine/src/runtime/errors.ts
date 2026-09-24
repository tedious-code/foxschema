/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The error vocabulary the runner and the executor share: a message for any
 * thrown value, and cancellation carried as an `AbortError`.
 */

export { errorMessage } from '@foxschema/sql';

/** Cancellation, however it was raised — never retried, never a failure. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('execution cancelled');
  error.name = 'AbortError';
  throw error;
}
