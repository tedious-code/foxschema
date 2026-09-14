/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/mysql.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { MysqlSourcePipe } from './mysql-source.js';
import { MysqlSinkPipe } from './mysql.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

/**
 * MySQL is the other half of a cross-engine migration, so these hold the
 * properties that make one trustworthy: pages advance by key rather than
 * OFFSET, a redelivered batch writes nothing twice, and a column type reaching
 * DDL is allowlisted the same way PostgreSQL's is.
 */

type Query = { sql: string; values?: unknown[] };

function fakeClient(responses: Record<string, Record<string, unknown>[]> = {}) {
  const queries: Query[] = [];
  const client = {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      for (const [pattern, rows] of Object.entries(responses)) {
        if (sql.includes(pattern)) {
          return [rows, undefined] as [Record<string, unknown>[], unknown];
        }
      }
      // INSERT IGNORE reports what it claimed; default to "claimed".
      return [{ affectedRows: 1 } as never, undefined] as [
        Record<string, unknown>[],
        unknown,
      ];
    },
  };
  return { client, queries };
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    pipe: { id: 'p', type: 't', role: 'source', concurrency: 1, config },
    workflowRunId: 'r1',
    pipelineId: 'pl1',
  } as unknown as PipeContext;
}

describe('MySQL source', () => {
  it('pages by key and never issues an OFFSET', async () => {
    const pages = [
      [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
      [{ id: 3, name: 'c' }],
    ];
    let page = 0;
    const queries: Query[] = [];
    const pipe = new MysqlSourcePipe(async () => ({
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return [pages[page++] ?? [], undefined] as [
          Record<string, unknown>[],
          unknown,
        ];
      },
    }));

    const batches: RecordBatch[] = [];
    for await (const batch of pipe.read(
      context({ database: 'shop', table: 'customers', keyColumn: 'id', batchSize: 2 }),
    )) {
      batches.push(batch);
    }

    expect(batches.map((b) => b.id)).toEqual(['p:0:1-2', 'p:0:3-3']);
    // The cursor is the last key, so a resume continues rather than re-scans.
    expect(batches.map((b) => b.cursor)).toEqual([{ lastKey: 2 }, { lastKey: 3 }]);
    expect(queries.every((q) => !/OFFSET/i.test(q.sql))).toBe(true);
    // Page two carries the previous page's last key as a bound parameter.
    expect(queries[1]!.values).toEqual([2]);
    expect(queries[1]!.sql).toContain('`id` > ?');
  });

  it('backtick-quotes identifiers', async () => {
    const queries: Query[] = [];
    const pipe = new MysqlSourcePipe(async () => ({
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql: string) => {
        queries.push({ sql });
        return [[], undefined] as [Record<string, unknown>[], unknown];
      },
    }));

    for await (const _ of pipe.read(
      context({ database: 'shop', table: 'customers', keyColumn: 'id' }),
    )) {
      /* first page is empty */
    }

    expect(queries[0]!.sql).toContain('`shop`.`customers`');
  });

  it('refuses a NULL key rather than looping on the same page', async () => {
    const pipe = new MysqlSourcePipe(async () => ({
      connect: async () => undefined,
      end: async () => undefined,
      query: async () =>
        [[{ id: null, name: 'x' }], undefined] as [
          Record<string, unknown>[],
          unknown,
        ],
    }));

    await expect(async () => {
      for await (const _ of pipe.read(
        context({ table: 'customers', keyColumn: 'id' }),
      )) {
        /* consume */
      }
    }).rejects.toThrow(/keyset pagination needs a non-null unique column/);
  });
});

describe('MySQL sink', () => {
  const batch: RecordBatch = {
    id: 'b1',
    partitionId: '0',
    records: [{ id: 1, name: 'a' }],
  };

  function sinkContext(config: Record<string, unknown>): PipeContext {
    return {
      pipe: { id: 'w', type: 'sink.mysql', role: 'sink', concurrency: 1, config },
      workflowRunId: 'r1',
      pipelineId: 'pl1',
    } as unknown as PipeContext;
  }

  it('claims the batch id before inserting, so a replay writes nothing', async () => {
    const { client, queries } = fakeClient({
      'information_schema.schemata': [{ schema_name: 'shop' }],
      'SHOW COLUMNS': [{ Field: 'id' }, { Field: 'name' }],
    });
    const sink = new MysqlSinkPipe(async () => client);

    await sink.write(
      batch,
      sinkContext({
        database: 'shop',
        table: 'customers',
        columns: { id: 'bigint', name: 'varchar(120)' },
      }),
    );

    const sql = queries.map((q) => q.sql);
    const claim = sql.findIndex((s) => s.includes('INSERT IGNORE INTO'));
    const insert = sql.findIndex((s) => s.includes('INSERT INTO `shop`.`customers`'));
    expect(claim).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(claim);
    expect(sql).toContain('COMMIT');
  });

  it('skips the insert when the batch was already committed', async () => {
    const { client, queries } = fakeClient({
      'information_schema.schemata': [{ schema_name: 'shop' }],
      'SHOW COLUMNS': [{ Field: 'id' }],
      // affectedRows 0 = the id was already there.
      'INSERT IGNORE INTO': [{ affectedRows: 0 } as unknown as Record<string, unknown>],
    });
    const sink = new MysqlSinkPipe(async () => client);

    await sink.write(
      batch,
      sinkContext({ database: 'shop', table: 'customers', columns: { id: 'bigint' } }),
    );

    expect(
      queries.some((q) => q.sql.includes('INSERT INTO `shop`.`customers`')),
    ).toBe(false);
    expect(queries.map((q) => q.sql)).toContain('COMMIT');
  });

  it('will not create the database, and says so', async () => {
    const { client } = fakeClient({ 'information_schema.schemata': [] });
    const sink = new MysqlSinkPipe(async () => client);

    await expect(
      sink.write(
        batch,
        sinkContext({ database: 'absent', table: 't', columns: { id: 'bigint' } }),
      ),
    ).rejects.toThrow(/does not exist.*does not create databases/s);
  });

  it.each(['text; drop table users', 'int --', 'nosuchtype', 'varchar()'])(
    'refuses %s as a column type',
    async (type) => {
      const { client } = fakeClient({
        'information_schema.schemata': [{ schema_name: 'shop' }],
      });
      const sink = new MysqlSinkPipe(async () => client);

      await expect(
        sink.write(
          batch,
          sinkContext({ database: 'shop', table: 't', columns: { c: type } }),
        ),
      ).rejects.toThrow(/unsupported MySQL column type/);
    },
  );
});
