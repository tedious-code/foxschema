import { makePostgresTableInsight } from '../postgres/postgres.table-insight.js';

export const redshiftTableInsight = makePostgresTableInsight(
  'redshift',
  'Redshift: pg_stats-style catalog estimates.'
);
