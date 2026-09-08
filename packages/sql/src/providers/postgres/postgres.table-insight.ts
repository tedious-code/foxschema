/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * PostgreSQL: pg_stats + pg_class.reltuples. No live COUNT(DISTINCT).
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
  hint: 'PostgreSQL: pg_stats.n_distinct and pg_class.reltuples (ANALYZE).',
};

const SQL = `
SELECT
  s.attname AS column_name,
  s.n_distinct AS n_distinct,
  s.null_frac AS null_frac,
  c.reltuples::bigint AS estimated_rows
FROM pg_stats s
JOIN pg_namespace n ON n.nspname = s.schemaname
JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = s.tablename
WHERE s.schemaname = $1
  AND s.tablename = $2
ORDER BY s.attname
`.trim();

export function makePostgresTableInsight(id: string, hint = SUPPORT.hint): TableInsightDialect {
  return {
    id,
    support: { ...SUPPORT, hint },
    probe(target: TableInsightTarget): TableInsightQuery {
      return {
        mode: 'catalog',
        sql: SQL,
        params: [target.schema || 'public', target.table],
      };
    },
  };
}

export const postgresTableInsight = makePostgresTableInsight('postgres');
