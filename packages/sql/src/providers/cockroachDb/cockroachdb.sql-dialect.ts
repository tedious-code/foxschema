import type { SqlDialect } from '../../modules/dialect/sql-dialect.interface.js';
import { postgresSqlDialect } from '../postgres/postgres.sql-dialect.js';

/**
 * CockroachDB is Postgres wire-compatible for most DDL, but its PL/pgSQL support
 * is incomplete: `CREATE TEMP TABLE … ON COMMIT DROP` and `FOR r IN SELECT … LOOP`
 * inside `DO` blocks both fail. The Postgres dependent-view drop/recreate guard
 * relies on those, so Cockroach skips it (return null) — callers still migrate
 * views as separate ADDED/MODIFIED objects when they are in scope.
 */
export const cockroachDbSqlDialect: SqlDialect = {
  ...postgresSqlDialect,

  dropDependentViewsBlock(): null {
    return null;
  },

  recreateDependentViewsBlock(): null {
    return null;
  },

  // pg_catalog reports the pseudo-collation "default" for unset collatable
  // columns; Cockroach rejects `COLLATE "default"` ("invalid locale default").
  columnCollateClause(collation: string): string {
    if (!collation || collation.toLowerCase() === 'default') return '';
    return postgresSqlDialect.columnCollateClause!(collation);
  },
};
