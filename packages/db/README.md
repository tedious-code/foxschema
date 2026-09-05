# @foxschema/db

One query API over ten database engines, for Node.

```ts
import { openDatabase } from '@foxschema/db';

const db = await openDatabase('postgres', {
  host: 'localhost', database: 'app', username: 'me', password: '…',
});
try {
  const rows = await db.query('SELECT * FROM orders WHERE id = $1', [1]);
} finally {
  await db.close();
}
```

Change `'postgres'` to `'mysql'` and the code is the same. This is the driver
runtime behind [Fox Schema](https://foxschema.com); `@foxschema/sql` is the pure
dialect layer it builds on and re-exports.

## Install

```bash
npm install @foxschema/db
```

Drivers are **optional peer dependencies** — install only the engines you talk
to. Nothing is pulled in by default:

| Dialect | Driver |
| --- | --- |
| `postgres`, `redshift`, `cockroachdb`, `yugabytedb` | `pg` |
| `mysql`, `mariadb`, `tidb` | `mysql2` |
| `sqlserver`, `azuresql` | `mssql` |
| `oracle` | `oracledb` |
| `db2` | `ibm_db` |
| `sqlite` | `better-sqlite3` |
| `duckdb` | `@duckdb/node-api` |
| `clickhouse` | `@clickhouse/client` |
| `mongodb` | `mongodb` |
| `redis` | `redis` |

A dialect whose driver is missing fails with the exact `npm install` to run.

## What it does and does not do

**Placeholders stay native** — `$1` on Postgres, `?` on MySQL. This is a thin
pass-through, not a query builder pretending the engines are the same. What is
uniform is the *shape* of the code around the query: connect, query, close.

**Connections are pooled and circuit-broken.** A target that is down rejects
immediately rather than making every caller wait out the connect timeout.

**It is not an ORM** and has no migration DSL. `@foxschema/sql` handles schema
comparison and DDL generation; this package executes.

## API

- `openDatabase(dialect, options)` → a handle with `query()` and `close()`. The
  handle knows its own dialect, so closing cannot be paired with the wrong one.
  `close()` is idempotent.
- `queryOnce(dialect, options, sql, params)` — one statement, closed even if it
  throws.
- `ConnectionFactory` — the lower-level seam, when you want to own the
  connection object and pass it to an adapter yourself.
- Everything from `@foxschema/sql` is re-exported.

## Example

A runnable one lives in the repo at
[`examples/multi-dialect-query`](https://github.com/tedious-code/foxschema/tree/main/examples/multi-dialect-query):
the same code counting tables on Postgres, MySQL and MariaDB.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`.
