/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Columns commonly maintained by INSERT/UPDATE triggers (timestamps, actors).
 * Compare/migrate should ignore them by default — values differ across servers
 * even when the business row is the same.
 */

/** Exact lower-case names we always treat as trigger/audit managed. */
const EXACT = new Set([
  'createdat',
  'created_at',
  'createdon',
  'created_on',
  'createdby',
  'created_by',
  'updatedat',
  'updated_at',
  'updatedon',
  'updated_on',
  'updatedby',
  'updated_by',
  'modifiedat',
  'modified_at',
  'modifiedon',
  'modified_on',
  'modifiedby',
  'modified_by',
  'lastmodified',
  'last_modified',
  'lastmodifiedat',
  'last_modified_at',
  'lastmodifiedby',
  'last_modified_by',
  'rowversion',
  'row_version',
  'xmin', // Postgres system
]);

/**
 * Audit-style names with an explicit time/actor suffix.
 * Bare `created` / `updated` / `modified` are NOT matched — those are often
 * business columns; skipping them under "Skip trigger cols" would silently
 * drop real data from migrate INSERT/UPDATE.
 */
const PATTERN =
  /^(created|updated|modified|lastmodified)(at|on|by|date|time|timestamp)$|^(created|updated|modified)_?(at|on|by|date|time|timestamp)$|_(created|updated|modified)_?(at|on|by)$/;

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** True when the column name looks like a trigger/audit field. */
export function isLikelyTriggerManagedColumn(name: string): boolean {
  const n = normalize(name);
  if (!n) return false;
  if (EXACT.has(n)) return true;
  return PATTERN.test(n);
}

/** Column names from `columns` that match the trigger/audit heuristic. */
export function detectTriggerManagedColumns(columns: string[]): string[] {
  return columns.filter((c) => isLikelyTriggerManagedColumn(c));
}
