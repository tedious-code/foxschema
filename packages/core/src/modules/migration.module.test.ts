import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the connection layer so execute() runs without a real database.
const queries: string[] = [];
const fakeAdapter = {
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  setCurrentSchema: vi.fn(async () => {}),
  query: vi.fn(async (_c: unknown, sql: string) => { queries.push(sql); }),
};

vi.mock('../providers/adapter-registry', () => ({ getAdapter: () => fakeAdapter }));
vi.mock('../cores/connection-factory', () => ({
  ConnectionFactory: { create: async () => ({}), close: async () => {} },
}));

import { MigrationModule } from './migration.module';
import type { MigrationStep } from './sql-generator.module';

describe('MigrationModule.execute', () => {
  beforeEach(() => { queries.length = 0; vi.clearAllMocks(); });

  it('runs a statement whose body starts with comment lines (routine/trigger definitions)', async () => {
    const step: MigrationStep = {
      objectName: 'FN_TIER_PRIORITY', objectType: 'FUNCTION', action: 'CREATE',
      statements: ['-- added function\n-- second comment\nCREATE FUNCTION FN_TIER_PRIORITY() RETURNS INT AS BEGIN RETURN 1; END;'],
    };
    await new MigrationModule().execute('sqlserver', {}, 'demo_b', [step], () => {});
    // The comment-prefixed statement must actually be executed, not skipped.
    expect(queries.some((q) => /CREATE FUNCTION FN_TIER_PRIORITY/.test(q))).toBe(true);
  });

  it('skips a statement that is entirely comments (a generator review note)', async () => {
    const step: MigrationStep = {
      objectName: 'X', objectType: 'TABLE', action: 'ALTER',
      statements: ['-- review: cannot express this change', 'ALTER TABLE demo_b.x ADD y int;'],
    };
    await new MigrationModule().execute('sqlserver', {}, 'demo_b', [step], () => {});
    expect(queries.some((q) => /^--/.test(q))).toBe(false);
    expect(queries.some((q) => /ALTER TABLE demo_b\.x ADD y int/.test(q))).toBe(true);
  });
});
