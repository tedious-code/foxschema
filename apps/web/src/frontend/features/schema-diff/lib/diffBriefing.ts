/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Counts already in a compare DTO — no extra query.
 */
export interface DiffBriefing {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
}

export function diffBriefing(tables: readonly { status: string }[] | undefined): DiffBriefing {
  const out: DiffBriefing = { added: 0, modified: 0, removed: 0, unchanged: 0 };
  if (!tables) return out;
  for (const table of tables) {
    if (table.status === 'ADDED') out.added += 1;
    else if (table.status === 'REMOVED') out.removed += 1;
    else if (table.status === 'MODIFIED') out.modified += 1;
    else out.unchanged += 1;
  }
  return out;
}
