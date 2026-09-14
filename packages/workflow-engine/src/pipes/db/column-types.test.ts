/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/db/src/column-types.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { PostgresSinkPipe } from './postgres.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

/**
 * The sink interpolates column types into DDL, so they are allowlisted rather
 * than escaped. These tests hold both halves of that bargain: the list admits
 * the types a real migration hits, and it still refuses anything that could
 * carry SQL.
 *
 * They drive the sink, so they cover whichever path this packaging takes.
 * That matters: the allowlist used to guard only the fallback, and under
 * vitest — where core *is* loadable — the dialect ran instead and returned
 * unknown types verbatim. `text; drop table users` reached CREATE TABLE.
 */
function contextFor(columns: Record<string, string>): PipeContext {
  return {
    pipe: {
      id: 'write',
      type: 'sink.postgres',
      role: 'sink',
      concurrency: 1,
      config: { schema: 'public', table: 't', columns },
    },
    workflowRunId: 'r1',
    pipelineId: 'p1',
  } as unknown as PipeContext;
}

const batch: RecordBatch = {
  id: 'b1',
  partitionId: '0',
  records: [{ value: 1 }],
};

/** Fails before any connection when the type is rejected. */
async function ddlFor(type: string): Promise<string[]> {
  const statements: string[] = [];
  const sink = new PostgresSinkPipe(async () => ({
    connect: async () => {},
    end: async () => {},
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    },
  }) as never);

  await sink.write(batch, contextFor({ value: type }));
  return statements;
}

describe('PostgreSQL column type allowlist', () => {
  // Unparameterised `numeric` is the ordinary way to spell a money column, and
  // it was rejected while `numeric(12,2)` was accepted — which failed a
  // migration on the most common spelling.
  it.each([
    'numeric',
    'decimal',
    'numeric(12,2)',
    'decimal(8,3)',
    'bigint',
    'int4',
    'int8',
    'float8',
    'double precision',
    'boolean',
    'bool',
    'text',
    'varchar(64)',
    'character varying(255)',
    'char(2)',
    'timestamptz',
    'timestamp(3)',
    'interval',
    'uuid',
    'jsonb',
    'bytea',
  ])('accepts %s', async (type) => {
    // The rendering is not asserted literally: when the dialect is available it
    // canonicalises aliases (`decimal` → `numeric`, `int4` → `integer`,
    // `character varying(255)` → `varchar(255)`), which is the point of running
    // it. What matters is that the type is admitted and reaches the DDL.
    const statements = await ddlFor(type);
    const create = statements.find((sql) =>
      sql.includes('CREATE TABLE IF NOT EXISTS "public"."t"'),
    );
    expect(create, `no CREATE TABLE emitted for ${type}`).toBeTruthy();
    expect(create).toContain('"value"');
  });

  it.each([
    'text; drop table users',
    'integer)',
    "varchar(64) default 'x'",
    'numeric(0)',
    'varchar()',
    'nosuchtype',
    'int4 --',
  ])('refuses %s', async (type) => {
    await expect(ddlFor(type)).rejects.toThrow(
      /unsupported PostgreSQL column type/,
    );
  });
});
