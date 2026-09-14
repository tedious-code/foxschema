/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * How many rows one multi-row INSERT may carry: bounded by the bind parameters
 * a statement can hold and by how many rows a VALUES list may hold.
 */
import { isTsqlDialect } from './sql-template.js';

interface InsertLimit {
  parameters: number;
  /** Rows per VALUES list, when the engine caps it. */
  rows?: number;
}

/** Most engines share the 16-bit wire limit on bind parameters. */
const DEFAULT_LIMIT: InsertLimit = { parameters: 65_535 };

const LIMITS: Record<string, InsertLimit> = {
  // No multi-row VALUES before 23ai.
  oracle: { parameters: 65_535, rows: 1 },
  sqlite: { parameters: 32_766 },
  db2: { parameters: 32_767 },
  redshift: { parameters: 32_767 },
};

// 2,100 parameters per request and 1,000 rows per VALUES list, with headroom.
const TSQL_LIMIT: InsertLimit = { parameters: 2_000, rows: 1_000 };

/** Rows that fit in one INSERT of `columnsPerRow` bound columns for `dialect`; at least 1. */
export function maxInsertRows(dialect: string, columnsPerRow: number): number {
  const limit = isTsqlDialect(dialect) ? TSQL_LIMIT : (LIMITS[dialect.toLowerCase()] ?? DEFAULT_LIMIT);
  const byParameters = Math.max(1, Math.floor(limit.parameters / Math.max(1, columnsPerRow)));
  return Math.min(byParameters, limit.rows ?? byParameters);
}
