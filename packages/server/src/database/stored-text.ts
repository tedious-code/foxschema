/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Bounds on free-form text kept in run history, shared by schema-migration and
 * data-migration history.
 */

/** Bound script / snapshot blobs so one run cannot bloat the metadata DB. */
export const HISTORY_MAX_TEXT_LEN = 1_000_000;

/**
 * Truncate free-form script text that a person reads, marking the cut.
 *
 * Never use this on anything a machine parses back (a JSON snapshot): a
 * truncated JSON document is not a shorter one, it is an invalid one.
 */
export function truncateForDisplay(
  text: string | undefined,
  max = HISTORY_MAX_TEXT_LEN
): string | undefined {
  if (text == null) return text;
  return text.length > max ? `${text.slice(0, max)}\n-- … (truncated)` : text;
}
