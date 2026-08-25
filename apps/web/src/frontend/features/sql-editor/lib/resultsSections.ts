/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * How many statement sections the side-by-side results layout should draw.
 */

/**
 * Only the fields the count depends on — structural on purpose, so this stays
 * a pure module and does not reach back into the editor store for its types.
 */
export interface SectionRun {
  status: string;
  results?: readonly unknown[] | null;
}

/**
 * Section count for the side-by-side layout.
 *
 * The count is normally driven by work that has already happened: statements
 * reported so far, and the longest per-credential result list. Statements are
 * revealed incrementally as each one finishes, so at the instant a run is
 * dispatched both are empty — and a count of zero renders an empty container
 * with no indication anything is happening. A run still in flight therefore
 * claims one section, which the layout fills with its "running" placeholders.
 *
 * By-credential does not need this: it maps over the credentials themselves,
 * so each one shows a spinner regardless of how far the statements have got.
 */
export function sideBySideSectionCount(
  statementCount: number,
  runs: readonly SectionRun[]
): number {
  const fromResults = runs.reduce((max, run) => Math.max(max, run.results?.length ?? 0), 0);
  const pending = runs.some((run) => run.status === 'running') ? 1 : 0;
  return Math.max(statementCount, fromResults, pending, 0);
}
