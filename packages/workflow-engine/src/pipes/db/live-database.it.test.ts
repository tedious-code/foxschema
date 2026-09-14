/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/live-database.it.test.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresSinkPipe } from './postgres.js';
import { PostgresSourcePipe } from './postgres-source.js';
import { MysqlSinkPipe } from './mysql.js';
import { MysqlSourcePipe } from './mysql-source.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

/**
 * Integration tests against **real** databases.
 *
 * These exist because the two most serious defects this project has shipped —
 * a DDL injection path and silent microsecond truncation on every migrated
 * timestamp — were both invisible to the hermetic suite and to typecheck. They
 * were found by hand, after release, by running an actual migration. A fake
 * driver cannot catch either: one needs a real parser to be fooled by, the
 * other needs a real column type to lose precision in.
 *
 * They are skipped unless the connection URLs are set, so `npm test` stays
 * hermetic and offline. CI supplies them from service containers.
 */

const POSTGRES = process.env.FOXFLOW_IT_POSTGRES_URL;
const MYSQL = process.env.FOXFLOW_IT_MYSQL_URL;

/**
 * Skipping is right locally and wrong in CI. A mistyped variable name would
 * otherwise skip every spec and report a green job that tested nothing — the
 * failure mode where a suite is worse than no suite, because it is believed.
 * CI sets `FOXFLOW_IT_REQUIRE=1`, which turns "cannot connect" into a failure.
 */
if (process.env.FOXFLOW_IT_REQUIRE === '1' && !(POSTGRES && MYSQL)) {
  throw new Error(
    'FOXFLOW_IT_REQUIRE=1 but FOXFLOW_IT_POSTGRES_URL / FOXFLOW_IT_MYSQL_URL are not both set — ' +
      'these specs would have skipped and reported success.',
  );
}

const live = POSTGRES && MYSQL ? describe : describe.skip;

/**
 * The pipes own their connection lifecycle, so a shared client is handed over
 * with `connect`/`end` neutralised — otherwise the second pipe to run reports
 * "Client has already been connected".
 */
function shared(client: { query: (sql: string, values?: unknown[]) => unknown }) {
  return async () =>
    ({
      connect: async () => undefined,
      end: async () => undefined,
      query: (sql: string, values?: unknown[]) => client.query(sql, values),
    }) as never;
}

/** A context whose credential resolution is bypassed by an injected client. */
function contextFor(config: Record<string, unknown>, role: 'source' | 'sink'): PipeContext {
  return {
    pipe: { id: role === 'source' ? 'read' : 'write', type: 't', role, concurrency: 1, config },
    workflowRunId: 'it-run',
    pipelineId: 'it-pipeline',
  } as unknown as PipeContext;
}

live('live databases', () => {
  let pgClient: Awaited<ReturnType<typeof openPostgres>>;
  let myClient: Awaited<ReturnType<typeof openMysql>>;

  async function openPostgres() {
    const pg = await import('pg');
    // Same parsers the source installs, so the test exercises the shipping path.
    for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (v: string) => v);
    const client = new pg.Client({ connectionString: POSTGRES });
    await client.connect();
    return client;
  }

  async function openMysql() {
    const mysql = await import('mysql2/promise');
    return mysql.createConnection({
      uri: MYSQL,
      dateStrings: true,
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
  }

  beforeAll(async () => {
    pgClient = await openPostgres();
    myClient = await openMysql();
    await pgClient.query('DROP SCHEMA IF EXISTS it_target CASCADE');
    await myClient.query('DROP TABLE IF EXISTS it_source');
    await myClient.query('DROP TABLE IF EXISTS it_roundtrip');
    // The commit table is what makes a redelivery a no-op, so a re-run of this
    // file must clear it or the round-trip legitimately writes nothing.
    await myClient.query('DROP TABLE IF EXISTS _foxflow_committed_batches');
    await myClient.query(`CREATE TABLE it_source (
      id BIGINT PRIMARY KEY,
      label VARCHAR(64),
      amount DECIMAL(12,2),
      seen_at DATETIME(6)
    )`);
    await myClient.query(
      `INSERT INTO it_source (id,label,amount,seen_at) VALUES
       (1,'first',1042.55,'2025-03-04 09:15:22.123456'),
       (2,'second',0.01,'2023-06-07 05:00:00.000001')`,
    );
  }, 60_000);

  afterAll(async () => {
    await pgClient?.end();
    await myClient?.end();
  });

  it('refuses a column type carrying SQL, against a real server', async () => {
    // The shipped bug: with the dialect loadable, unrecognised types went into
    // CREATE TABLE verbatim. A fake driver would happily "succeed" here.
    const sink = new PostgresSinkPipe(shared(pgClient));

    await expect(
      sink.write(
        { id: 'b', partitionId: '0', records: [{ id: 1 }] },
        contextFor(
          {
            schema: 'it_target',
            table: 'evil',
            columns: { id: 'bigint; DROP SCHEMA it_target CASCADE' },
          },
          'sink',
        ),
      ),
    ).rejects.toThrow(/unsupported PostgreSQL column type/);

    // And nothing was created on the way to refusing.
    const { rows } = await pgClient.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='it_target' AND table_name='evil'",
    );
    expect(rows).toHaveLength(0);
  }, 60_000);

  it('migrates MySQL to PostgreSQL without losing precision', async () => {
    const source = new MysqlSourcePipe(shared(myClient));
    const sink = new PostgresSinkPipe(shared(pgClient));

    const batches: RecordBatch[] = [];
    for await (const batch of source.read(
      contextFor({ table: 'it_source', keyColumn: 'id', batchSize: 10 }, 'source'),
    )) {
      batches.push(batch);
    }
    expect(batches).toHaveLength(1);

    for (const batch of batches) {
      await sink.write(
        batch,
        contextFor(
          {
            schema: 'it_target',
            table: 'copied',
            columns: {
              id: 'bigint',
              label: 'varchar(64)',
              amount: 'numeric(12,2)',
              seen_at: 'timestamp(6)',
            },
          },
          'sink',
        ),
      );
    }

    const { rows } = await pgClient.query(
      'SELECT id, label, amount::text AS amount, seen_at::text AS seen_at FROM it_target.copied ORDER BY id',
    );

    // The exact values that were silently truncated before: microseconds, and
    // a decimal that a float cannot hold.
    expect(rows).toEqual([
      {
        id: '1',
        label: 'first',
        amount: '1042.55',
        seen_at: '2025-03-04 09:15:22.123456',
      },
      {
        id: '2',
        label: 'second',
        amount: '0.01',
        seen_at: '2023-06-07 05:00:00.000001',
      },
    ]);
  }, 60_000);

  it('writes a redelivered batch exactly once', async () => {
    const sink = new PostgresSinkPipe(shared(pgClient));
    const batch: RecordBatch = {
      id: 'replayed-batch',
      partitionId: '0',
      records: [{ id: 99, label: 'once' }],
    };
    const ctx = contextFor(
      {
        schema: 'it_target',
        table: 'dedupe',
        columns: { id: 'bigint', label: 'varchar(64)' },
      },
      'sink',
    );

    await sink.write(batch, ctx);
    await sink.write(batch, ctx);

    const { rows } = await pgClient.query(
      'SELECT count(*)::int AS n FROM it_target.dedupe WHERE id = 99',
    );
    expect(rows[0]!.n).toBe(1);
  }, 60_000);

  it('round-trips back into MySQL with the decimal intact', async () => {
    const source = new PostgresSourcePipe(shared(pgClient));
    const sink = new MysqlSinkPipe(shared(myClient));

    for await (const batch of source.read(
      contextFor(
        { schema: 'it_target', table: 'copied', keyColumn: 'id', batchSize: 10 },
        'source',
      ),
    )) {
      await sink.write(
        batch,
        contextFor(
          {
            table: 'it_roundtrip',
            columns: {
              id: 'bigint',
              label: 'varchar(64)',
              amount: 'decimal(12,2)',
              seen_at: 'datetime(6)',
            },
          },
          'sink',
        ),
      );
    }

    const [rows] = (await myClient.query(
      'SELECT amount, seen_at FROM it_roundtrip ORDER BY id',
    )) as [Record<string, unknown>[], unknown];

    expect(rows[0]!.amount).toBe('1042.55');
    expect(String(rows[0]!.seen_at)).toContain('.123456');
  }, 60_000);
});
