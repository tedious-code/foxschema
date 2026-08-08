# @foxschema/sql

Dialect knowledge for [FoxSchema](https://github.com/tedious-code/foxschema): SQL
generation, schema compare, statement splitting, and type mapping.

**Pure and runtime-neutral.** No Node built-ins, no drivers, no I/O, and zero
runtime dependencies — so it runs in a browser bundle, a worker, an edge runtime,
or Node. Executing any of it against a real database is
[`@foxschema/db`](https://github.com/tedious-code/foxschema/tree/main/packages/db)'s
job.

The boundary is enforced mechanically, not by convention: `purity.test.ts` fails
the build if anything here imports a `node:` builtin, reaches back into
`@foxschema/db`, or adds a runtime dependency.

```bash
npm install @foxschema/sql
```

## What you get

**Type mapping across dialects** — parse a vendor type into a canonical form and
render it for another:

```ts
import { resolveDialect } from '@foxschema/sql';

const mysql = resolveDialect('mysql');
const sqlserver = resolveDialect('sqlserver');

const canonical = mysql.parseType('decimal(10,2)'); // → { base: 'decimal', … }
sqlserver.renderType(canonical); // { sql: 'decimal(10,2)' }
resolveDialect('postgres').renderType(canonical); // { sql: 'numeric(10,2)' }
```

`renderType` always returns `{ sql, warning? }` — read `.sql`, and check
`.warning` for mappings the target could only approximate. Precision is
preserved where the target supports it, and dropped where it does not —
`mysql datetime(6)` renders as Postgres `timestamp` and SQL Server `datetime2`.
If a declared precision matters to you, compare the rendered type against what
you asked for rather than assuming it survived.

**Statement splitting** that understands comments, dollar-quoting, and string
literals — not a `split(';')`:

```ts
import { splitSqlStatements } from '@foxschema/sql';

splitSqlStatements(`
  SELECT ';' AS not_a_terminator;
  $$ CREATE FUNCTION f() ... $$;
`); // → 2 statements, with line spans
```

**Safe SQL construction** with per-dialect placeholders:

```ts
import { sqlTag as sql, renderSqlQuery } from '@foxschema/sql';

const q = sql`SELECT * FROM users WHERE id = ${42}`;
renderSqlQuery(q, 'postgres'); // { text: 'SELECT * FROM users WHERE id = $1', params: [42] }
renderSqlQuery(q, 'mysql');    // { text: 'SELECT * FROM users WHERE id = ?',  params: [42] }
```

**Schema compare and migration generation** — `CompareModule` diffs two schemas;
`SqlGeneratorModule` turns the diff into ordered, dialect-correct DDL.

## Dialects

Postgres · MySQL · MariaDB · SQL Server · Azure SQL · Oracle · Db2 · SQLite ·
ClickHouse · DuckDB · CockroachDB · YugabyteDB · Redshift · TiDB

Support is per-feature, not all-or-nothing — capability flags such as
`dialectSupportsFk` and `dialectSupportsIndex` tell you what a given dialect can
express before you generate for it.

## Stability

Versioned independently of the FoxSchema application: this number describes
*this package's* API, so a release means something here actually changed. The
app's version moves on its own and the two will not line up.

Pre-1.0 while the exported surface settles — minor versions may remove or
rename exports, patch versions will not. The dialect logic underneath is mature
and well covered; it is the shape of the public API that is still young.

Pin an exact version if you depend on generation output being byte-stable:
a dialect fix that makes output *more* correct is still a change in output.

## License

Apache-2.0
