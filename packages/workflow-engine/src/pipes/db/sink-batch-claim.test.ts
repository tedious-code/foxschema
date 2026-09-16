/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import type { MysqlClient } from './mysql-source.js';
import { MysqlSinkPipe } from './mysql.js';
import { PostgresSinkPipe, type PostgresClient } from './postgres.js';

const batch: RecordBatch = {
  id: 'sql-source:0:0',
  partitionId: '0',
  records: [{ id: 1 }],
};

function context(workflowRunId: string, type: string, config: Record<string, unknown>): PipeContext {
  return {
    workflowRunId,
    pipelineId: 'pipeline',
    pipe: { id: 'sink', type, role: 'sink', concurrency: 1, config },
  } as PipeContext;
}

describe('sink batch claims across workflow runs', () => {
  it('deduplicates a PostgreSQL replay within one run but not a later run', async () => {
    const committed = new Set<string>();
    const claimResults: number[] = [];
    let dataInserts = 0;
    const client: PostgresClient = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql, values) => {
        if (sql.includes('INSERT INTO "public"."_foxflow_committed_batches"')) {
          const key = `${String(values?.[0])}/${String(values?.[1])}`;
          const rowCount = committed.has(key) ? 0 : 1;
          committed.add(key);
          claimResults.push(rowCount);
          return { rowCount, rows: rowCount ? [{ batch_id: values?.[0] }] : [] };
        }
        if (sql.includes('INSERT INTO "public"."target"')) dataInserts++;
        return { rowCount: 0, rows: [] };
      },
    };
    const sink = new PostgresSinkPipe(async () => client);
    const config = { schema: 'public', table: 'target', columns: { id: 'integer' } };

    await sink.write(batch, context('workflow-run-1', 'sink.postgres', config));
    await sink.write(batch, context('workflow-run-1', 'sink.postgres', config));
    await sink.write(batch, context('workflow-run-2', 'sink.postgres', config));

    expect(claimResults).toEqual([1, 0, 1]);
    expect(dataInserts).toBe(2);
  });

  it('deduplicates a MySQL replay within one run but not a later run', async () => {
    const committed = new Set<string>();
    const claimResults: number[] = [];
    let dataInserts = 0;
    // mysql2 returns ResultSetHeader for INSERT IGNORE; the sink reads
    // affectedRows off the first tuple slot (see MysqlSinkPipe.write).
    const client: MysqlClient = {
      connect: async () => undefined,
      end: async () => undefined,
      query: async (sql, values) => {
        if (sql.includes('information_schema.schemata')) {
          return [[{ schema_name: 'app' }], undefined];
        }
        if (sql.includes('SHOW COLUMNS')) {
          return [[{ Field: 'id' }], undefined];
        }
        if (sql.includes('INSERT IGNORE INTO')) {
          const key = `${String(values?.[0])}/${String(values?.[1])}`;
          const affectedRows = committed.has(key) ? 0 : 1;
          committed.add(key);
          claimResults.push(affectedRows);
          return [{ affectedRows } as never, undefined];
        }
        if (sql.includes('INSERT INTO `app`.`target`')) dataInserts++;
        return [[], undefined];
      },
    };
    const sink = new MysqlSinkPipe(async () => client);
    const config = { database: 'app', table: 'target', columns: { id: 'bigint' } };

    await sink.write(batch, context('workflow-run-1', 'sink.mysql', config));
    await sink.write(batch, context('workflow-run-1', 'sink.mysql', config));
    await sink.write(batch, context('workflow-run-2', 'sink.mysql', config));

    expect(claimResults).toEqual([1, 0, 1]);
    expect(dataInserts).toBe(2);
  });
});
