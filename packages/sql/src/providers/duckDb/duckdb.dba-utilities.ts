/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * DuckDB is embedded: only table size estimates are answerable.
 */
import {
  noProbe,
  type DbaUtilityDialect,
  type DbaUtilityKind,
  type DbaUtilitySupport,
} from '../../modules/utilities/dba-utilities.types.js';

const SIZES_SQL = `
SELECT
  schema_name,
  table_name AS object_name,
  'table' AS object_type,
  table_name,
  estimated_size AS total_bytes,
  estimated_size AS data_bytes,
  NULL AS index_bytes,
  estimated_size AS row_count
FROM duckdb_tables()
ORDER BY estimated_size DESC NULLS LAST
LIMIT 1000
`.trim();

function support(kind: DbaUtilityKind): DbaUtilitySupport {
  if (kind === 'sizes') {
    return {
      mode: 'estimated',
      query: true,
      hint: 'DuckDB: pragma_database_size / table estimates when available.',
    };
  }
  return {
    mode: 'unsupported',
    query: false,
    hint: 'DuckDB is embedded — no server pool/sessions/system DMVs.',
  };
}

export const duckDbDbaUtilities: DbaUtilityDialect = {
  id: 'duckdb',
  support,
  build(kind, opts) {
    if (kind === 'sizes') return { mode: opts.mode, params: [], sql: SIZES_SQL };
    return noProbe(kind);
  },
};
