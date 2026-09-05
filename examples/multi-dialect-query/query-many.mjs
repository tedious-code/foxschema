#!/usr/bin/env node
/**
 * @foxschema/db as a library: one shape of code, several engines.
 *
 * The point of the package for an outside project is that the *code* does not
 * change per engine — only the dialect string and the connection options do.
 * Placeholders stay native (`$1` on Postgres, `?` on MySQL) because this is a
 * thin pass-through, not a query builder pretending the engines are the same.
 *
 * Run it against this repo's dev containers:
 *   docker compose up -d postgres mysql mariadb
 *   node examples/multi-dialect-query/query-many.mjs
 *
 * Point it somewhere else with env vars — see TARGETS below.
 */
import { openDatabase, queryOnce } from '@foxschema/db';

/** Each entry is the *only* thing that differs between the engines. */
const TARGETS = [
  {
    dialect: 'postgres',
    options: {
      host: process.env.PG_HOST ?? '127.0.0.1',
      port: Number(process.env.PG_PORT ?? 5432),
      database: process.env.PG_DATABASE ?? 'foxdb',
      username: process.env.PG_USER ?? 'foxuser',
      password: process.env.PG_PASSWORD ?? 'foxpass',
      schema: process.env.PG_SCHEMA ?? 'demo_a',
    },
    // Native placeholder style, deliberately not abstracted away. The catalog
    // is the one table every engine has data in without a seed step.
    countSql:
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = $1",
    listSql:
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 ORDER BY 1 LIMIT 3",
  },
  {
    dialect: 'mysql',
    options: {
      host: process.env.MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.MYSQL_PORT ?? 3306),
      database: process.env.MYSQL_DATABASE ?? 'demo_a',
      username: process.env.MYSQL_USER ?? 'root',
      password: process.env.MYSQL_PASSWORD ?? 'foxrootpass',
    },
    schema: process.env.MYSQL_DATABASE ?? 'demo_a',
    countSql:
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
    listSql:
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY 1 LIMIT 3',
  },
  {
    dialect: 'mariadb',
    options: {
      host: process.env.MARIADB_HOST ?? '127.0.0.1',
      port: Number(process.env.MARIADB_PORT ?? 3307),
      database: process.env.MARIADB_DATABASE ?? 'demo_a',
      username: process.env.MARIADB_USER ?? 'root',
      password: process.env.MARIADB_PASSWORD ?? 'foxrootpass',
    },
    schema: process.env.MARIADB_DATABASE ?? 'demo_a',
    countSql:
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
    listSql:
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? ORDER BY 1 LIMIT 3',
  },
];

let failures = 0;

for (const { dialect, options, countSql, listSql, schema } of TARGETS) {
  // A handle that knows its own dialect, so closing cannot be paired with the
  // wrong one — the leak `ConnectionFactory.close(dialect, conn)` invites.
  let db;
  try {
    db = await openDatabase(dialect, options);
    // The schema name is the one parameter; everything else is identical code.
    const target = schema ?? options.schema ?? options.database;
    const [{ n }] = await db.query(countSql, [target]);
    const names = (await db.query(listSql, [target])).map((r) => r.name);
    console.log(`${dialect.padEnd(9)} ${String(n).padStart(3)} tables in ${target}  e.g. ${names.join(', ')}`);
  } catch (error) {
    failures++;
    // A missing optional peer reports the exact npm install to run.
    console.error(`${dialect.padEnd(9)} FAILED: ${error instanceof Error ? error.message : error}`);
  } finally {
    await db?.close();
  }
}

// The single-statement shape: opens, queries, and closes even if the query throws.
try {
  const [row] = await queryOnce('postgres', TARGETS[0].options, 'SELECT current_database() AS db');
  console.log(`\nqueryOnce  connected to      : ${row?.db}`);
} catch (error) {
  failures++;
  console.error(`queryOnce  FAILED: ${error instanceof Error ? error.message : error}`);
}

process.exit(failures === 0 ? 0 : 1);
