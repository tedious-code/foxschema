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
 *   FOX_IT_DB=1 npx vitest run apps/web/src/backend/modules/generated-ddl-live.test.ts
 *
 * Engines that are not up are skipped individually rather than failing the run,
 * so a partial stack still tells you something. Oracle and DB2 are in the
 * compose file but slow to boot; add them here once they are healthy.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ConnectionFactory } from '@foxschema/db';
import { CompareModule, SqlGeneratorModule } from '@foxschema/sql';
import type { ConnectionOptions, TableSchema } from '@foxschema/sql';

const RUN = process.env.FOX_IT_DB === '1';
const gen = new SqlGeneratorModule();

/** Unique per run, so a rerun never collides with rows an earlier one left. */
const TAG = Date.now().toString(36).slice(-5);

const TARGETS: Array<{ dialect: string; provider: string; options: ConnectionOptions }> = [
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

const reachable = new Map<string, boolean>();
const toDrop: Array<{ provider: string; options: ConnectionOptions; name: string }> = [];

afterAll(async () => {
  // Children before parents, so an FK never blocks the drop.
  for (const { provider, options, name } of toDrop.reverse()) {
    await ConnectionFactory.executeQuery(provider, options, `DROP TABLE ${name}`).catch(() => undefined);
  }
});

describe.runIf(RUN)('generated DDL runs on the real engines', () => {
  for (const target of TARGETS) {
    describe(target.dialect, () => {
      it('is reachable', async () => {
        try {
          await ConnectionFactory.executeQuery(target.provider, target.options, 'SELECT 1');
          reachable.set(target.dialect, true);
        } catch (err) {
          reachable.set(target.dialect, false);
          // Not a failure: a partial stack should still test what is up.
          console.warn(`[skip] ${target.dialect}: ${(err as Error).message.split('\n')[0]}`);
        }
      });

      for (const testCase of CASES) {
        it(`creates ${testCase.label}`, async () => {
          if (reachable.get(target.dialect) === false) return;
          const statements = (await ddlFor(testCase.tables, target.dialect)).filter(
            (s) => !s.trim().startsWith('--')
          );
          expect(statements.length, 'generated no DDL to execute').toBeGreaterThan(0);

          for (const statement of statements) {
            const sql = statement.replace(/;\s*$/, '');
            try {
              await ConnectionFactory.executeQuery(target.provider, target.options, sql);
            } catch (err) {
              throw new Error(
                `${target.dialect} rejected:\n${sql}\n\n${(err as Error).message.split('\n')[0]}`
              );
            }
            const made = sql.match(/CREATE TABLE\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/i);
            if (made) toDrop.push({ provider: target.provider, options: target.options, name: made[1]! });
          }
        });
      }
    });
  }
});
