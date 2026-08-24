/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generated DDL, executed by the real database servers.
 *
 * `generated-ddl-runs.test.ts` proves the same statements parse in SQLite,
 * which needs no credentials and so runs everywhere. It cannot tell you whether
 * the *per-dialect* quoting is right: backticks for MySQL, brackets for T-SQL,
 * double quotes elsewhere. Only the servers can, and getting that wrong is how
 * a migration fails halfway through against a customer's database.
 *
 * Gated behind FOX_IT_DB=1 so the default `vitest run` and CI stay DB-free:
 *
 *   docker compose up -d
 *   FOX_IT_DB=1 npx vitest run apps/web/src/backend/modules/migration/generated-ddl-live.test.ts
 *
 * Engines that are not up are skipped individually rather than failing the run,
 * so a partial stack still tells you something. Oracle and DB2 are in the
 * compose file but slow to boot; add them here once they are healthy.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ConnectionFactory, getAdapter, getRegisteredProvider } from '@foxschema/db';
import { CompareModule, SqlGeneratorModule } from '@foxschema/sql';
import type { ConnectionOptions, TableSchema } from '@foxschema/sql';

const RUN = process.env.FOX_IT_DB === '1';
const gen = new SqlGeneratorModule();

/** Unique per run, so a rerun never collides with rows an earlier one left. */
const TAG = Date.now().toString(36).slice(-5);

/**
 * `probe` is the liveness query, and it is not universal: DB2 rejects a bare
 * `SELECT 1` (SQL0104N — it wants a FROM clause), Oracle wants `FROM DUAL`.
 * Getting this wrong is worse than it sounds. The first version probed every
 * engine with `SELECT 1`, so DB2 was marked unreachable and every DB2 case
 * returned early — reported as **passing**, in 0ms, while touching nothing.
 * A skip that looks like a pass is the most expensive kind of green there is.
 */
const TARGETS: Array<{
  dialect: string;
  provider: string;
  options: ConnectionOptions;
  probe?: string;
}> = [
  {
    dialect: 'postgres',
    provider: 'postgres',
    options: { host: 'localhost', port: 5432, database: 'foxdb', username: 'foxuser', password: 'foxpass', schema: 'public' },
  },
  {
    dialect: 'mysql',
    provider: 'mysql',
    options: { host: 'localhost', port: 3306, database: 'foxdb', username: 'foxuser', password: 'foxpass' },
  },
  {
    dialect: 'mariadb',
    provider: 'mariadb',
    options: { host: 'localhost', port: 3307, database: 'foxdb', username: 'foxuser', password: 'foxpass' },
  },
  {
    dialect: 'sqlserver',
    provider: 'sqlserver',
    options: { host: 'localhost', port: 1433, database: 'master', username: 'sa', password: 'FoxPass123!', ssl: { enabled: false } },
  },
  {
    dialect: 'cockroachdb',
    provider: 'cockroachdb',
    options: { host: 'localhost', port: 26257, database: 'defaultdb', username: 'root', schema: 'public' },
  },
  {
    dialect: 'yugabytedb',
    provider: 'yugabytedb',
    options: { host: 'localhost', port: 5433, database: 'yugabyte', username: 'yugabyte', schema: 'public' },
  },
  {
    // Oracle has no bare `SELECT 1` either — it wants a FROM, and DUAL is it.
    // Schema and user are the same thing here, so the "schema" is the account.
    dialect: 'oracle',
    provider: 'oracle',
    options: { host: 'localhost', port: 1521, database: 'FOXDB', username: 'foxuser', password: 'foxpass', schema: 'FOXUSER' },
    probe: 'SELECT 1 FROM DUAL',
  },
  {
    // Slowest of the set to boot (the compose healthcheck allows two minutes
    // before it even starts probing) and the only one needing a native client
    // driver, so it is the most likely to be skipped on a given machine.
    dialect: 'db2',
    provider: 'db2',
    options: { host: 'localhost', port: 50000, database: 'foxdb', username: 'db2inst1', password: 'foxpass', schema: 'DB2INST1' },
    probe: 'SELECT 1 FROM SYSIBM.SYSDUMMY1',
  },
];

const table = (over: Partial<TableSchema> & { name: string }): TableSchema => ({
  objectType: 'TABLE',
  columns: [],
  indices: [],
  foreignKeys: [],
  ...over,
});

/** Names that are legal in a catalog and illegal in SQL unless quoted. */
const CASES: Array<{ label: string; tables: TableSchema[] }> = [
  {
    label: 'an ordinary table (control — proves the harness runs anything at all)',
    tables: [
      table({
        name: `plain_${TAG}`,
        columns: [
          { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'email', type: 'VARCHAR(255)', nullable: true, primaryKey: false },
        ],
      }),
    ],
  },
  {
    label: 'spaces in the table and column names',
    tables: [
      table({
        name: `Order Details ${TAG}`,
        columns: [
          { name: 'order id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'unit price', type: 'DECIMAL(10,2)', nullable: true, primaryKey: false },
        ],
        primaryKey: { name: `pk order ${TAG}`, columns: ['order id'] },
      }),
    ],
  },
  {
    label: 'reserved words as identifiers',
    tables: [
      table({
        name: `order_${TAG}`,
        columns: [
          { name: 'select', type: 'VARCHAR(10)', nullable: true, primaryKey: false },
          { name: 'order', type: 'INTEGER', nullable: true, primaryKey: false },
          { name: 'key', type: 'INTEGER', nullable: true, primaryKey: false },
          { name: 'user', type: 'VARCHAR(20)', nullable: true, primaryKey: false },
        ],
      }),
    ],
  },
  {
    label: 'punctuation and non-ASCII letters',
    tables: [
      table({
        name: `naive-tbl-${TAG}`,
        columns: [
          { name: 'id', type: 'INTEGER', nullable: false, primaryKey: false },
          { name: 'café', type: 'VARCHAR(50)', nullable: true, primaryKey: false },
        ],
      }),
    ],
  },
  {
    label: 'an index and a foreign key over awkward names',
    tables: [
      table({
        name: `parent tbl ${TAG}`,
        columns: [{ name: 'parent id', type: 'INTEGER', nullable: false, primaryKey: true }],
        primaryKey: { columns: ['parent id'] },
      }),
      table({
        name: `child tbl ${TAG}`,
        columns: [
          { name: 'child id', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'parent id', type: 'INTEGER', nullable: true, primaryKey: false },
        ],
        primaryKey: { columns: ['child id'] },
        indices: [{ name: `idx child ${TAG}`, columns: ['parent id'], unique: false }],
        foreignKeys: [
          {
            name: `fk child ${TAG}`,
            columns: ['parent id'],
            referencedTable: `parent tbl ${TAG}`,
            referencedColumns: ['parent id'],
          },
        ],
      }),
    ],
  },
];

/** DDL for creating `tables` from nothing, as the migration flow emits it. */
async function ddlFor(tables: TableSchema[], dialect: string): Promise<string[]> {
  const result = await new CompareModule().compare(tables, [], { source: dialect, target: dialect });
  return gen.generateMigrationPlan(result.tables, dialect).flatMap((step) => step.statements);
}

/**
 * Runs `statements` the way `MigrationModule` does: **one** unpooled connection,
 * **one** transaction, for the whole plan.
 *
 * Both halves matter, and getting either wrong makes a correct plan look
 * broken. Postgres's dependent-view hooks stash the view definitions in a
 * `CREATE TEMP TABLE … ON COMMIT DROP` and read them back in a later statement:
 * a connection per statement loses the table with the session, and a
 * transaction per statement drops it at the first commit. Both produced
 * `relation "_fs_vdep_…" does not exist`, which reads exactly like a product
 * bug and was purely this harness being unfaithful.
 */
async function runPlan(
  target: { dialect: string; provider: string; options: ConnectionOptions },
  statements: string[],
  onCreate?: (name: string) => void
): Promise<void> {
  const connection = await ConnectionFactory.create(target.provider, target.options, { pooled: false });
  const adapter = getAdapter(target.provider);
  try {
    await adapter.beginTransaction(connection);
    try {
      for (const statement of statements) {
        const sql = statement.replace(/;\s*$/, '');
        if (!sql.trim() || sql.trim().startsWith('--')) continue;
        try {
          await adapter.query(connection, sql, []);
        } catch (err) {
          throw new Error(
            `${target.dialect} rejected:\n${sql}\n\n${(err as Error).message.split('\n')[0]}`
          );
        }
        const made = sql.match(/CREATE TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i);
        if (made && onCreate) onCreate(made[1]!);
      }
      await adapter.commitTransaction(connection);
    } catch (err) {
      await adapter.rollbackTransaction(connection).catch(() => undefined);
      throw err;
    }
  } finally {
    await ConnectionFactory.close(target.provider, connection).catch(() => undefined);
  }
}

/** DDL that migrates `from` into `to` — the ALTER path, per dialect hooks. */
async function alterDdl(
  from: TableSchema[],
  to: TableSchema[],
  dialect: string
): Promise<string[]> {
  const result = await new CompareModule().compare(to, from, { source: dialect, target: dialect });
  return gen.generateMigrationPlan(result.tables, dialect).flatMap((step) => step.statements);
}

const reachable = new Map<string, boolean>();
const toDrop: Array<{ provider: string; options: ConnectionOptions; name: string }> = [];

afterAll(async () => {
  // Children before parents, so an FK never blocks the drop.
  for (const { provider, options, name } of toDrop.reverse()) {
    await ConnectionFactory.executeQuery(provider, options, `DROP TABLE ${name}`).catch(() => undefined);
  }
});

/**
 * Native DDL for one function and one procedure, plus where to recreate them.
 *
 * Routine bodies are the least portable thing in SQL, so each engine gets its
 * own. Engines absent here have no routine coverage rather than a pretend one.
 */
const ROUTINES: Record<
  string,
  {
    from: string;
    to: string;
    makeSchema?: (s: string) => string[];
    ddl: (s: string) => string[];
    /** Credentials with rights the demo user lacks (creating a database). */
    admin?: Partial<ConnectionOptions>;
  }
> = {
  postgres: {
    from: `fx_a_${TAG}`,
    to: `fx_b_${TAG}`,
    makeSchema: (s) => [`CREATE SCHEMA IF NOT EXISTS ${s}`],
    ddl: (s) => [
      `CREATE FUNCTION ${s}.double_it(x integer) RETURNS integer AS $$ SELECT x * 2 $$ LANGUAGE sql`,
      `CREATE PROCEDURE ${s}.touch_it() LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END; $$`,
    ],
  },
  mysql: {
    // A MySQL schema *is* a database, so the round trip needs a second one.
    from: 'foxdb',
    to: `foxb_${TAG}`,
    // The demo user cannot create a database ("Access denied for user
    // 'foxuser'"), and this round trip needs a second one to recreate into.
    admin: { username: 'root', password: 'foxrootpass' },
    makeSchema: (s) => [`CREATE DATABASE IF NOT EXISTS ${s}`],
    ddl: () => [
      `CREATE FUNCTION double_it_${TAG}(x INT) RETURNS INT DETERMINISTIC RETURN x * 2`,
      `CREATE PROCEDURE touch_it_${TAG}() BEGIN SELECT 1; END`,
    ],
  },
  sqlserver: {
    from: 'dbo',
    to: `foxb_${TAG}`,
    makeSchema: (s) => (s === 'dbo' ? [] : [`IF SCHEMA_ID('${s}') IS NULL EXEC('CREATE SCHEMA ${s}')`]),
    ddl: () => [
      `CREATE FUNCTION dbo.double_it_${TAG}(@x INT) RETURNS INT AS BEGIN RETURN @x * 2 END`,
      `CREATE PROCEDURE dbo.touch_it_${TAG} AS BEGIN SELECT 1 END`,
    ],
  },
  oracle: {
    // An Oracle schema *is* a user, so the round trip needs a second account —
    // which only a DBA can create, hence the admin credentials.
    from: 'FOXUSER',
    to: `FXRT${TAG.toUpperCase()}`,
    admin: { username: 'system', password: 'FoxPass123' },
    makeSchema: (s) =>
      s === 'FOXUSER'
        ? []
        : [
            `CREATE USER ${s} IDENTIFIED BY foxpass QUOTA UNLIMITED ON USERS`,
            `GRANT CREATE SESSION, CREATE PROCEDURE TO ${s}`,
          ],
    ddl: (s) => [
      `CREATE FUNCTION ${s}.DOUBLE_IT(X IN NUMBER) RETURN NUMBER AS BEGIN RETURN X * 2; END;`,
      `CREATE PROCEDURE ${s}.TOUCH_IT AS BEGIN NULL; END;`,
    ],
  },
  db2: {
    from: `FXA${TAG}`,
    to: `FXB${TAG}`,
    makeSchema: (s) => [`CREATE SCHEMA ${s}`],
    ddl: (s) => [
      `CREATE FUNCTION ${s}.DOUBLE_IT(X INTEGER) RETURNS INTEGER LANGUAGE SQL RETURN X * 2`,
      `CREATE PROCEDURE ${s}.TOUCH_IT() LANGUAGE SQL BEGIN DECLARE V INT; SET V = 1; END`,
    ],
  },
};

describe.runIf(RUN)('generated DDL runs on the real engines', () => {
  for (const target of TARGETS) {
    describe(target.dialect, () => {
      it('is reachable', async () => {
        try {
          await ConnectionFactory.executeQuery(
            target.provider,
            target.options,
            target.probe ?? 'SELECT 1'
          );
          reachable.set(target.dialect, true);
        } catch (err) {
          reachable.set(target.dialect, false);
          // Not a failure: a partial stack should still test what is up.
          console.warn(`[skip] ${target.dialect}: ${(err as Error).message.split('\n')[0]}`);
        }
      });

      const routines = ROUTINES[target.dialect];
      it.runIf(routines)('captures a procedure and a function well enough to recreate them', async (ctx) => {
        if (reachable.get(target.dialect) === false) ctx.skip();
        const spec = routines!;
        const opts = (schema: string) => ({
          ...target.options,
          ...spec.admin,
          ...(target.dialect === 'mysql' ? { database: schema } : {}),
          schema,
        });

        const admin = await ConnectionFactory.create(target.provider, opts(spec.from), { pooled: false });
        const adapter = getAdapter(target.provider);
        const exec = (conn: unknown, sql: string) => adapter.query(conn as never, sql, []);
        try {
          for (const schema of [spec.from, spec.to])
            for (const stmt of spec.makeSchema?.(schema) ?? []) await exec(admin, stmt).catch(() => undefined);
          for (const stmt of spec.ddl(spec.from)) await exec(admin, stmt);

          // Read them back the way the app does.
          const provider = getRegisteredProvider(target.provider)!;
          const objects = (await provider.getTables!(opts(spec.from), spec.from)) as TableSchema[];
          const mine = objects.filter(
            (o) =>
              (o.objectType === 'FUNCTION' || o.objectType === 'PROCEDURE') &&
              new RegExp(`(double_it|touch_it)(_${TAG})?$`, 'i').test(o.name)
          );
          expect(mine.map((r) => r.objectType).sort()).toEqual(['FUNCTION', 'PROCEDURE']);

          // A routine with no body cannot be migrated anywhere, and an empty
          // string would still pass a "the object exists" assertion.
          for (const r of mine) {
            expect((r.definition ?? '').trim().length, `${r.name} was captured without a body`).toBeGreaterThan(0);
          }

          // The round trip: regenerate into the other schema and run it. This
          // is what catches a definition that is missing its terminator or has
          // the source schema baked into it.
          const compare = await new CompareModule().compare(mine, [], {
            source: target.dialect,
            target: target.dialect,
          });
          const stmts = gen
            .generateMigrationPlan(compare.tables, target.dialect, { sourceSchema: spec.from, targetSchema: spec.to })
            .flatMap((s) => s.statements)
            .filter((s) => !s.trim().startsWith('--'));
          expect(stmts.length, 'no DDL generated for the routines').toBeGreaterThan(0);

          const other = await ConnectionFactory.create(target.provider, opts(spec.to), { pooled: false });
          try {
            for (const raw of stmts) {
              const sql = raw.replace(/;\s*$/, '');
              try {
                await exec(other, sql);
              } catch (err) {
                throw new Error(
                  `${target.dialect} rejected the regenerated routine:\n${sql}\n\n${(err as Error).message.split('\n')[0]}`
                );
              }
            }
          } finally {
            await ConnectionFactory.close(target.provider, other).catch(() => undefined);
          }
        } finally {
          // Routines are dropped by name; the schemas themselves are left for
          // the engine's own cleanup since each run uses a fresh TAG.
          for (const stmt of spec.ddl(spec.from)) {
            const kind = /FUNCTION/i.test(stmt) ? 'FUNCTION' : 'PROCEDURE';
            const name = stmt.match(/CREATE (?:FUNCTION|PROCEDURE)\s+(\S+?)\s*[(\s]/i)?.[1];
            if (name) await exec(admin, `DROP ${kind} ${name}`).catch(() => undefined);
          }
          await ConnectionFactory.close(target.provider, admin).catch(() => undefined);
        }
      });

      it('alters a table whose names need quoting', async (ctx) => {
        // ctx.skip() rather than `return`: a skipped engine must not report a
        // green tick it never earned.
        if (reachable.get(target.dialect) === false) ctx.skip();
        // ADD / DROP / MODIFY COLUMN go through per-dialect hooks rather than
        // the CREATE path, so they need their own proof on a real server —
        // this is where the dialects diverge most.
        const before = table({
          name: `alter tbl ${TAG}`,
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
            { name: 'old col', type: 'VARCHAR(10)', nullable: true, primaryKey: false },
          ],
          primaryKey: { columns: ['id'] },
        });
        const after = table({
          name: `alter tbl ${TAG}`,
          columns: [
            { name: 'id', type: 'INTEGER', nullable: false, primaryKey: true },
            { name: 'new col', type: 'VARCHAR(50)', nullable: true, primaryKey: false },
          ],
          primaryKey: { columns: ['id'] },
        });

        const created: string[] = [];
        await runPlan(target, await ddlFor([before], target.dialect), (name) => {
          created.push(name);
          toDrop.push({ provider: target.provider, options: target.options, name });
        });

        const alters = (await alterDdl([before], [after], target.dialect)).filter(
          (s) => !s.trim().startsWith('--')
        );
        expect(alters.length, 'compare reported a change but generated no ALTER').toBeGreaterThan(0);
        // One session for the whole plan, exactly as MigrationModule runs it.
        await runPlan(target, alters);

        // "The statements ran" is not the same as "the table still works".
        //
        // It has to be a *write*. DB2 leaves a table in reorg-pending after
        // DROP COLUMN, where SELECT still succeeds and every INSERT/UPDATE/
        // DELETE fails with SQL0668N reason code 7 — so a read-back probe went
        // green against a table the user could no longer write to. That is the
        // failure this case exists to catch, and reading was blind to it.
        const quoted = created[created.length - 1];
        expect(quoted, 'no CREATE TABLE captured to write back').toBeTruthy();
        try {
          await ConnectionFactory.executeQuery(
            target.provider,
            target.options,
            `INSERT INTO ${quoted} (id) VALUES (4242)`
          );
          await ConnectionFactory.executeQuery(
            target.provider,
            target.options,
            `DELETE FROM ${quoted} WHERE id = 4242`
          );
        } catch (err) {
          throw new Error(
            `${target.dialect}: the table cannot be written to after the migration — ` +
              `${(err as Error).message.split('\n')[0]}`
          );
        }
      });

      for (const testCase of CASES) {
        it(`creates ${testCase.label}`, async (ctx) => {
          if (reachable.get(target.dialect) === false) ctx.skip();
          const statements = (await ddlFor(testCase.tables, target.dialect)).filter(
            (s) => !s.trim().startsWith('--')
          );
          expect(statements.length, 'generated no DDL to execute').toBeGreaterThan(0);

          await runPlan(target, statements, (name) =>
            toDrop.push({ provider: target.provider, options: target.options, name })
          );
        });
      }
    });
  }
});
