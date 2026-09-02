/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Db2 index fragmentation: empty-leaf ratio from SYSCAT.INDEXES (an estimate)
 * plus LASTUSED, which Db2 keeps in the catalog itself.
 */
import {
  CUSTOM_HINT,
  quoteIndexTarget,
  type IndexFragmentationDialect,
} from '../../modules/utilities/index-fragmentation.types.js';

const PROBE_SQL = `
SELECT
  INDNAME AS index_name,
  CASE
    WHEN NLEAF IS NULL OR NLEAF = 0 THEN NULL
    ELSE DECIMAL(100.0 * FLOAT(COALESCE(NUM_EMPTY_LEAFS, 0)) / FLOAT(NLEAF), 5, 2)
  END AS fragmentation_percent,
  NLEAF AS page_count,
  CASE
    WHEN LASTUSED IS NULL OR LASTUSED <= DATE('1971-01-01') THEN NULL
    ELSE LASTUSED
  END AS last_used,
  CAST(NULL AS BIGINT) AS scan_count
FROM SYSCAT.INDEXES
WHERE TABSCHEMA = ?
  AND TABNAME = ?
ORDER BY INDNAME
`.trim();

export const db2IndexFragmentation: IndexFragmentationDialect = {
  id: 'db2',
  support: {
    mode: 'estimated',
    query: true,
    defrag: true,
    hint: 'DB2: empty-leaf ratio from SYSCAT.INDEXES (estimate) plus LASTUSED. Use REORGCHK custom SQL for fuller guidance.',
    customSqlHint: CUSTOM_HINT,
  },
  maintenanceVerb: 'Reorg',
  probe(target) {
    if (!target.schema) return { error: 'DB2 fragmentation probe needs a schema name.' };
    return {
      mode: 'estimated',
      params: [target.schema.toUpperCase(), target.table.toUpperCase()],
      sql: PROBE_SQL,
    };
  },
  usageQueries() {
    // LASTUSED is already on the main probe.
    return [];
  },
  defragSql(target) {
    // Two things make Db2 unlike every other dialect here, both verified
    // against a live server:
    //
    // 1. It cannot reorganise a single index. `REORG INDEX <name>` returns
    //    SQL0270N "Function not supported (Reason code 89)". Only the
    //    table-level `REORG INDEXES ALL FOR TABLE` form exists, so selecting
    //    one index necessarily reorganises every index on its table.
    // 2. REORG is a command, not SQL. Sent over a driver connection it is
    //    rejected by the statement parser (SQL0104N, "expected tokens may
    //    include: JOIN"). It has to be handed to SYSPROC.ADMIN_CMD.
    //
    // The table name is embedded in a string literal, so any single quote in
    // an identifier has to be doubled or it would end the literal early.
    const literal = quoteIndexTarget(target).table.replace(/'/g, "''");
    return [
      `CALL SYSPROC.ADMIN_CMD('REORG INDEXES ALL FOR TABLE ${literal}');`,
      `-- Db2 has no single-index REORG: this reorganises every index on ${target.table}.`,
    ];
  },
  dropSql(target, indexName) {
    return [`DROP INDEX ${quoteIndexTarget(target).indexQualified(indexName)};`];
  },
  customTemplate(target) {
    const sch = target.schema || 'schema';
    const tbl = target.table || 'table';
    return `SELECT INDNAME AS index_name,
       DECIMAL(100.0 * FLOAT(COALESCE(NUM_EMPTY_LEAFS,0)) / NULLIF(FLOAT(NLEAF),0), 5, 2)
         AS fragmentation_percent,
       CASE WHEN LASTUSED IS NULL OR LASTUSED <= DATE('1971-01-01') THEN NULL ELSE LASTUSED END AS last_used
FROM SYSCAT.INDEXES
WHERE TABSCHEMA = '${sch.toUpperCase()}' AND TABNAME = '${tbl.toUpperCase()}';`;
  },
};
