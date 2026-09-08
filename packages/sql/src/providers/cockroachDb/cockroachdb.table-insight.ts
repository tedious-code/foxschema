import { makePostgresTableInsight } from '../postgres/postgres.table-insight.js';

export const cockroachDbTableInsight = makePostgresTableInsight(
  'cockroachdb',
  'CockroachDB: pg_stats / table statistics (estimated).'
);
