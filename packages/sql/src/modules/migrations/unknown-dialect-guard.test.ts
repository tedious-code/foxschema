/**
 * Fox Schema (@foxschema/sql)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * A migration is never generated for an engine Fox Schema has no dialect for.
 *
 * `resolveDialect` answers Db2 for a name it does not know, and both generator
 * entry points called it. A Redis target produced a script headed
 * `-- Dialect: REDIS` whose body was Db2 DDL — labelled correctly while being
 * wrong, which is the worst shape this failure can take: it survives a glance.
 *
 * The UI disables the button and the compare service refuses. This is the
 * layer under both, on the two functions that actually emit statements, so a
 * stale selection or a caller nobody has written yet still cannot get DDL for
 * the wrong engine.
 */
import { describe, expect, it } from 'vitest';
import { SqlGeneratorModule } from './sql-generator.module.js';
import type { TableDiff } from '../../interfaces/diff.types.interface.js';

const gen = new SqlGeneratorModule();

/** One added table — enough that a working dialect emits a CREATE. */
const diffs = [
  {
    tableName: 'ORDERS',
    status: 'ADDED',
    objectType: 'TABLE',
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    triggerDiffs: [],
    sourceTable: {
      name: 'orders',
      columns: [{ name: 'id', type: 'int', nullable: false }],
      // The generator walks all of these; an incomplete fixture throws before
      // it reaches the thing under test.
      indices: [],
      foreignKeys: [],
      triggers: [],
      primaryKey: undefined,
    },
  } as unknown as TableDiff,
];

const UNKNOWN = ['redis', 'mongodb', 'dynamodb', 'cassandra', ''];

describe('the executed plan is empty for an unknown engine', () => {
  it('emits no steps at all', () => {
    for (const dialect of UNKNOWN) {
      expect(gen.generateMigrationPlan(diffs, dialect), dialect).toEqual([]);
    }
  });

  it('still plans for an engine that has a dialect', () => {
    // Without this the test above would pass on a generator that never works.
    expect(gen.generateMigrationPlan(diffs, 'postgres').length).toBeGreaterThan(0);
  });
});

describe('the preview says why instead of showing another engine’s DDL', () => {
  it('names the engine it cannot generate for', () => {
    const sql = gen.generateMigrationSql(diffs, 'redis');
    expect(sql).toMatch(/no SQL dialect for "redis"/i);
    expect(sql).toMatch(/nothing here is safe to run/i);
  });

  it('contains no statement of any kind', () => {
    for (const dialect of UNKNOWN) {
      const sql = gen.generateMigrationSql(diffs, dialect);
      const code = sql
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('--'));
      expect(code, dialect).toEqual([]);
      // The specific thing that used to come out.
      expect(sql, dialect).not.toMatch(/CREATE TABLE/i);
    }
  });

  it('does not label the script with an engine it did not generate for', () => {
    // It used to read `-- Dialect: REDIS` above Db2 DDL.
    const sql = gen.generateMigrationSql(diffs, 'redis');
    expect(sql).not.toMatch(/-- Dialect: REDIS/);
  });

  it('still generates for an engine that has a dialect', () => {
    expect(gen.generateMigrationSql(diffs, 'postgres')).toMatch(/CREATE TABLE/i);
  });
});
