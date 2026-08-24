/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The logging shape the database package accepts.
 *
 * Structural on purpose: no `pino` import, no Fastify import. Pino satisfies
 * this by construction, and so does a test double, so the driver runtime stays
 * usable from the CLI, a worker, or a unit test that has no HTTP server and no
 * logging stack at all.
 *
 * Injection rather than a module-level singleton, so a caller can hand in a
 * child logger already carrying the request id and connection context.
 */

export interface AppLogger {
  trace(obj: unknown, msg?: string): void;
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  /** Present on Pino; optional so a minimal double need not implement it. */
  child?(bindings: Record<string, unknown>): AppLogger;
  /**
   * Lets a caller skip building an expensive payload the level would discard.
   * Optional for the same reason as `child`.
   */
  isLevelEnabled?(level: string): boolean;
}

/**
 * Discards everything.
 *
 * The default wherever a logger is optional, so the database package never
 * writes to stdout unless a caller asked for it — a library that logs on its
 * own initiative is a library that floods someone else's tests.
 */
export const noopLogger: AppLogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return noopLogger;
  },
  isLevelEnabled() {
    return false;
  },
};

/** Standard field names, so logs from different modules stay searchable. */
export interface DbLogFields {
  component: 'database';
  operation: string;
  engine?: string;
  connectionId?: string;
  durationMs?: number;
  rowCount?: number;
}

/**
 * A host:port/database identity that is safe to log.
 *
 * Never the connection string — that carries the password, and a logged
 * credential outlives every other mistake in the request.
 */
export function safeTarget(options: {
  host?: string;
  port?: number;
  database?: string;
}): string {
  const host = options.host ?? 'local';
  const port = options.port ? `:${options.port}` : '';
  const database = options.database ? `/${options.database}` : '';
  return `${host}${port}${database}`;
}
