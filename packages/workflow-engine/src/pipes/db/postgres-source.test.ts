/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/postgres-source.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { PipeContext, RecordBatch } from '../../registry/index.js';
import { PostgresSourcePipe } from './postgres-source.js';
import type { PostgresClient } from './postgres.js';

/** In-memory table that answers the source's keyset queries. */
class FakePostgres implements PostgresClient {
  readonly queries: Array<{ text: string; values: unknown[] }> = [];
  connected = false;
  ended = false;

  constructor(private readonly rows: Record<string, unknown>[]) {}

  async connect(): Promise<unknown> {
    this.connected = true;
    return undefined;
  }

  async end(): Promise<void> {
    this.ended = true;
  }

  async query(
    text: string,
    values: unknown[] = [],
  ): Promise<{ rowCount: number | null; rows: Record<string, unknown>[] }> {
    this.queries.push({ text, values });
    const limit = Number(/LIMIT (\d+)/.exec(text)?.[1] ?? 1000);
    const after = text.includes('> $1') ? (values[0] as number) : undefined;
    const filtered = this.rows
      .filter((row) => (after === undefined ? true : (row.id as number) > after))
      .sort((a, b) => (a.id as number) - (b.id as number))
      .slice(0, limit);
    return { rowCount: filtered.length, rows: filtered };
  }
}

function context(config: Record<string, unknown>): PipeContext {
  return {
    workflowRunId: 'run',
    pipelineId: 'pipeline',
    pipe: {
      id: 'pg',
      type: 'source.db.postgres',
      role: 'source',
      config,
      concurrency: 1,
    },
  };
}

async function collect(
  source: PostgresSourcePipe,
  ctx: PipeContext,
): Promise<RecordBatch[]> {
  const batches: RecordBatch[] = [];
  for await (const batch of source.read(ctx)) batches.push(batch);
  return batches;
}

const table = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
  { id: 3, name: 'Linus' },
  { id: 4, name: 'Alice' },
  { id: 5, name: 'Robert' },
];

describe('PostgresSourcePipe', () => {
  it('pages the whole table by keyset and closes the client', async () => {
    const client = new FakePostgres(table);
    const source = new PostgresSourcePipe(async () => client);
    const batches = await collect(
      source,
      context({ table: 'people', keyColumn: 'id', batchSize: 2 }),
    );
    expect(batches.map((batch) => batch.records.map((r) => r.id))).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
    expect(batches.map((batch) => batch.cursor)).toEqual([
      { lastKey: 2 },
      { lastKey: 4 },
      { lastKey: 5 },
    ]);
    // Stable replay ids carry the key range.
    expect(batches[0]!.id).toBe('pg:0:1-2');
    expect(client.ended).toBe(true);
    // Page 2 onward paginates strictly after the last key.
    expect(client.queries[1]!.values).toEqual([2]);
  });

  it('resumes from the checkpointed lastKey without re-reading rows', async () => {
    const client = new FakePostgres(table);
    const source = new PostgresSourcePipe(async () => client);
    const ctx = context({ table: 'people', keyColumn: 'id', batchSize: 10 });
    ctx.checkpoint = {
      workflowRunId: 'run',
      pipelineId: 'pipeline',
      pipeId: 'pg',
      partitionId: '0',
      cursor: { lastKey: 3 },
      updatedAt: new Date().toISOString(),
    };
    const batches = await collect(source, ctx);
    expect(batches.flatMap((batch) => batch.records.map((r) => r.id))).toEqual([4, 5]);
    expect(client.queries[0]!.values).toEqual([3]);
  });

  it('always selects the key column and applies the extra where condition', async () => {
    const client = new FakePostgres(table);
    const source = new PostgresSourcePipe(async () => client);
    await collect(
      source,
      context({
        table: 'people',
        keyColumn: 'id',
        columns: ['name'],
        where: "name <> 'Robert'",
      }),
    );
    const sql = client.queries[0]!.text;
    expect(sql).toContain('"name", "id"');
    expect(sql).toContain("(name <> 'Robert')");
    expect(sql).toContain('ORDER BY "id" ASC');
  });

  it('fails clearly when the key column comes back NULL', async () => {
    const client = new FakePostgres([{ id: null, name: 'ghost' }]);
    const source = new PostgresSourcePipe(async () => client);
    await expect(
      collect(source, context({ table: 'people', keyColumn: 'id' })),
    ).rejects.toThrow(/keyset pagination needs a non-null unique column/);
    expect(client.ended).toBe(true);
  });

  it('rejects unsafe identifiers at config validation', () => {
    const source = new PostgresSourcePipe(async () => new FakePostgres([]));
    expect(() =>
      source.validateConfig({ table: 'people; DROP TABLE x', keyColumn: 'id' }),
    ).toThrow();
    expect(() =>
      source.validateConfig({ table: 'people', keyColumn: 'id' }),
    ).not.toThrow();
  });
});
