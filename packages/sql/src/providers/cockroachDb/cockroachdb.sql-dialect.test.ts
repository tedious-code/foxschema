import { describe, expect, it } from 'vitest';
import { cockroachDbSqlDialect } from './cockroachdb.sql-dialect.js';
import { postgresSqlDialect } from '../postgres/postgres.sql-dialect.js';

describe('cockroachDbSqlDialect', () => {
  it('disables the Postgres dependent-view DO-block guard (unsupported PL/pgSQL on CRDB)', () => {
    expect(cockroachDbSqlDialect.dropDependentViewsBlock!('demo_b.customers')).toBeNull();
    expect(cockroachDbSqlDialect.recreateDependentViewsBlock!('demo_b.customers')).toBeNull();
    // Postgres still emits the guard — regression anchor for the CRDB override.
    expect(postgresSqlDialect.dropDependentViewsBlock!('demo_b.customers')).toMatch(/ON COMMIT DROP/);
  });

  it('omits COLLATE for the pseudo-collation "default" (invalid locale on CRDB)', () => {
    expect(cockroachDbSqlDialect.columnCollateClause!('default')).toBe('');
    expect(cockroachDbSqlDialect.columnCollateClause!('Default')).toBe('');
    expect(cockroachDbSqlDialect.columnCollateClause!('en_US')).toMatch(/COLLATE/);
  });
});
