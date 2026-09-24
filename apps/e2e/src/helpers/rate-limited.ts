/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pressing a button whose request the server rate-limits, and waiting for the
 * server's answer rather than for the UI to look settled.
 *
 * Lokee capture, revert and force-migrate share one limiter: 20 requests a
 * minute per user (`lokeeCaptureLimiter` in history.routes.ts). The browser
 * suites all run as the same user, and `run-all.mjs` runs History, Revert and
 * the revert edge cases back to back — about 17 limited requests — so a sweep,
 * or one suite run twice within a minute, reached the limit. The UI then
 * showed a "Snapshot failed" toast, the helper that clicked the button went on
 * as if it had worked, and the test died 20–30s later waiting for a database
 * or a version that was never recorded.
 *
 * The limit is left alone: it protects a real server. Instead:
 *   - every limited click waits for its own HTTP response;
 *   - a 429 is waited out for the `Retry-After` the server sent, then retried.
 *     The limiter refuses before the route runs, so nothing happened and the
 *     retry is safe;
 *   - anything else that is not 2xx fails at once, naming the status and body;
 *   - a wait longer than `maxWaitMs` fails at once instead of eating the test's
 *     own timeout.
 *
 * Database Access catalog reads (`/schema/db-access`, 20 a minute) go through
 * here too; a run over several engines reads the catalog faster than that.
 */
import type { Page, Response } from 'playwright';

export interface RateLimitedClick {
  /** Presses the button. Called again for each retry. */
  click: () => Promise<void>;
  /** The request this press sends, e.g. POST /api/lokee/capture. */
  path: RegExp;
  method?: string;
  /** Names the action in errors and logs: "Snapshot", "Revert". */
  label: string;
  /** Longest total time to spend waiting out refusals. */
  maxWaitMs?: number;
  /** How long one press may take to send its request and get an answer. */
  responseTimeoutMs?: number;
  /**
   * Return a non-2xx answer other than 429 instead of throwing, for a caller
   * that judges the failure the UI then shows (a container that is down).
   */
  returnErrors?: boolean;
}

/** The limiter's window is a minute; one full wait plus a margin. */
const DEFAULT_MAX_WAIT_MS = 65_000;

export async function clickRateLimited(page: Page, options: RateLimitedClick): Promise<Response> {
  const {
    click,
    path,
    method = 'POST',
    label,
    maxWaitMs = DEFAULT_MAX_WAIT_MS,
    responseTimeoutMs = 30_000,
    returnErrors = false,
  } = options;
  let waited = 0;
  for (;;) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === method && path.test(new URL(r.url()).pathname),
        { timeout: responseTimeoutMs }
      ),
      click(),
    ]);
    if (response.ok()) return response;
    if (returnErrors && response.status() !== 429) return response;

    const body = await response.text().catch(() => '');
    if (response.status() !== 429) {
      throw new Error(`${label} failed: HTTP ${response.status()} ${body}`);
    }
    // Retry-After is whole seconds (rate-limit.ts). Absent or unreadable means
    // "a window", which is the worst case anyway.
    const retryAfterMs = (Number(response.headers()['retry-after']) || 60) * 1000 + 250;
    if (waited + retryAfterMs > maxWaitMs) {
      throw new Error(
        `${label} refused: rate limited (HTTP 429, retry after ${Math.ceil(retryAfterMs / 1000)}s, ` +
          `already waited ${Math.round(waited / 1000)}s). Something is making more requests ` +
          `against this limit than the suites do. ${body}`
      );
    }
    console.warn(
      `[e2e] ${label}: rate limited, waiting ${Math.ceil(retryAfterMs / 1000)}s before retrying`
    );
    await page.waitForTimeout(retryAfterMs);
    waited += retryAfterMs;
  }
}
