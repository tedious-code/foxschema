/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The compare match key, in one place.
 *
 * Compare pairs source and target objects by this key, and the migration
 * planner, FK-target validation and drop-dependency scan all look objects up by
 * it — so they must derive it identically. It used to be the same regex pasted
 * into five files.
 *
 * The key is for MATCHING, never for DDL: it is uppercased and unquoted, so it
 * is not a valid identifier on a case-sensitive engine. Use the object's own
 * `name` for SQL.
 *
 * Known limits, kept as-is because the key is persisted in places: only ONE
 * leading qualifier is removed (`db.sch.t` → `SCH.T`), a dot inside a quoted
 * schema is not understood (`"my.schema".t` → `SCHEMA.T`), and bracket or
 * backtick quoting is not stripped (`[dbo].[t]` → `[T]`).
 */

/** Drops a leading `schema.` qualifier and every double quote, keeping case. */
export function bareObjectName(name: string): string {
  return name.replace(/^"?[^".]+"?\./, '').replace(/"/g, '');
}

/** The case-insensitive match key: `HUY.MyTable`, `"YOU".MyTable` and `MyTable` all give `MYTABLE`. */
export function compareKey(name: string): string {
  return bareObjectName(name).toUpperCase();
}
