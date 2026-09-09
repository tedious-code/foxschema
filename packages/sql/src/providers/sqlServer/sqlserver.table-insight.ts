/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * SQL Server: partition row counts. No COUNT(DISTINCT) on live tables.
 */
import type {
  TableInsightDialect,
  TableInsightQuery,
  TableInsightSupport,
  TableInsightTarget,
} from '../../modules/utilities/table-insight.types.js';

const SUPPORT: TableInsightSupport = {
  mode: 'catalog',
  query: true,
  hint: 'SQL Server: sys.dm_db_partition_stats row counts (catalog).',
};

const SQL = `
SELECT
  c.name AS column_name,
  NULL AS n_distinct,
  NULL AS null_frac,
  SUM(p.row_count) OVER () AS estimated_rows,
  -- SQL Server pages are always 8 KB, so page count converts to bytes exactly.
  (SUM(p.used_page_count) OVER () * 8192) AS size_bytes
FROM sys.tables t
INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
INNER JOIN sys.dm_db_partition_stats p
  ON p.object_id = t.object_id AND p.index_id IN (0, 1)
LEFT JOIN sys.columns c ON c.object_id = t.object_id
WHERE s.name = @p0 AND t.name = @p1
`.trim();

export function makeSqlServerTableInsight(id: string, hint = SUPPORT.hint): TableInsightDialect {
  return {
    id,
    support: { ...SUPPORT, hint },
    probe(target: TableInsightTarget): TableInsightQuery {
      return {
        mode: 'catalog',
        sql: SQL,
        params: [target.schema || 'dbo', target.table],
      };
    },
  };
}

export const sqlServerTableInsight = makeSqlServerTableInsight('sqlserver');
