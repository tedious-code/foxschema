/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * How long to wait for a database, and who gets to decide.
 *
 * The numbers were previously written into each adapter — 10s to connect on
 * Postgres, 15s on Oracle and SQL Server, 30s for a ClickHouse query — with no
 * way to change any of them. That is fine until it isn't: a database behind a
 * VPN or on the far side of a region takes longer than a local container, and
 * the only symptom is a timeout that looks like an outage.
 *
 * Three levels, most specific first:
 *
 *   1. the connection's own `timeout`, set per saved connection
 *   2. `FOX_CONNECT_TIMEOUT_MS` / `FOX_QUERY_TIMEOUT_MS`, for a deployment
 *   3. the adapter's own default, which is what it always used
 *
 * Adapters keep their own defaults rather than sharing one, because they are
 * not arbitrary: Oracle's listener and SQL Server's login handshake genuinely
 * take longer than a Postgres connect, and flattening them would either make
 * Postgres wait too long or make Oracle fail on a slow day.
 */
import type { ConnectionOptions } from '@foxschema/sql';

/** Below this, a timeout is more likely a typo than an intent. */
const MIN_MS = 250;
/** An hour. Past this the setting is indistinguishable from "no timeout". */
const MAX_MS = 3_600_000;

function fromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return clamp(n);
}

function clamp(ms: number): number | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.floor(ms)));
}

/**
 * Milliseconds to wait for a connection to be established.
 *
 * `adapterDefault` is what this driver used before the setting existed, so a
 * deployment that configures nothing behaves exactly as it did.
 */
export function connectTimeoutMs(
  options: ConnectionOptions | undefined,
  adapterDefault: number
): number {
  return (
    clamp(options?.timeout?.connectMs as number) ??
    fromEnv('FOX_CONNECT_TIMEOUT_MS') ??
    adapterDefault
  );
}

/** Milliseconds to wait for a statement to return. */
export function queryTimeoutMs(
  options: ConnectionOptions | undefined,
  adapterDefault: number
): number {
  return (
    clamp(options?.timeout?.queryMs as number) ??
    fromEnv('FOX_QUERY_TIMEOUT_MS') ??
    adapterDefault
  );
}

/** Seconds, for the drivers whose option is in seconds rather than millis. */
export function connectTimeoutSeconds(
  options: ConnectionOptions | undefined,
  adapterDefaultMs: number
): number {
  // Round up: rounding 1500ms down to 1s would silently shorten the wait.
  return Math.max(1, Math.ceil(connectTimeoutMs(options, adapterDefaultMs) / 1000));
}
