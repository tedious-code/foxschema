import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the connection layer so execute() runs without a real database.
const queries: string[] = [];
// Set by a test to make the next query matching this substring throw once.
let failOn: string | null = null;
const fakeAdapter = {
  beginTransaction: vi.fn(async () => {}),
  commitTransaction: vi.fn(async () => {}),
  rollbackTransaction: vi.fn(async () => {}),
  setCurrentSchema: vi.fn(async () => {}),
  query: vi.fn(async (_c: unknown, sql: string) => {
    queries.push(sql);
    if (failOn && sql.includes(failOn)) {
      failOn = null; // only fail once, so a retried/next statement can succeed
      throw new Error(`simulated failure: ${sql}`);
    }
  }),
};

vi.mock('../providers/adapter-registry', () => ({ getAdapter: () => fakeAdapter }));
vi.mock('../cores/connection-factory', () => ({
  ConnectionFactory: { create: async () => ({}), close: async () => {} },
}));

import { MigrationModule } from './migration.module';
import type { MigrationStep } from './sql-generator.module';

describe('MigrationModule.execute', () => {
  beforeEach(() => { queries.length = 0; failOn = null; vi.clearAllMocks(); });

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

  it('without continueOnError, a failing step aborts and rolls back — later steps never run', async () => {
    failOn = 'CREATE TABLE bad';
    const steps: MigrationStep[] = [
      { objectName: 'BAD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE bad (id int);'] },
      { objectName: 'GOOD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE good (id int);'] },
    ];
    const events: any[] = [];
    await new MigrationModule().execute('sqlserver', {}, 'demo_b', steps, (e) => events.push(e));
    expect(queries.some((q) => /CREATE TABLE good/.test(q))).toBe(false);
    expect(fakeAdapter.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.commitTransaction).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === 'done')).toMatchObject({ success: false, rolledBack: true });
  });

  it('continueOnError gives each step its own transaction, so a failure only rolls back that step', async () => {
    failOn = 'CREATE TABLE bad';
    const steps: MigrationStep[] = [
      { objectName: 'BAD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE bad (id int);'] },
      { objectName: 'GOOD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE good (id int);'] },
    ];
    const events: any[] = [];
    await new MigrationModule().execute('sqlserver', {}, 'demo_b', steps, (e) => events.push(e), { continueOnError: true });
    // The second step still runs and succeeds despite the first one failing.
    expect(queries.some((q) => /CREATE TABLE good/.test(q))).toBe(true);
    // One begin/commit pair for GOOD, one begin/rollback pair for BAD.
    expect(fakeAdapter.beginTransaction).toHaveBeenCalledTimes(2);
    expect(fakeAdapter.commitTransaction).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'done')).toMatchObject({ success: true, rolledBack: false });
    const objectEvents = events.filter((e) => e.type === 'object');
    expect(objectEvents.some((e) => e.objectName === 'BAD' && e.status === 'FAILED')).toBe(true);
    expect(objectEvents.some((e) => e.objectName === 'GOOD' && e.status === 'SUCCESS')).toBe(true);
  });

  it('continueOnError works the same way regardless of dialect (no dialect-specific SQL needed)', async () => {
    failOn = 'CREATE TABLE bad';
    const steps: MigrationStep[] = [
      { objectName: 'BAD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE bad (id int);'] },
      { objectName: 'GOOD', objectType: 'TABLE', action: 'CREATE', statements: ['CREATE TABLE good (id int);'] },
    ];
    const events: any[] = [];
    await new MigrationModule().execute('mysql', {}, 'demo_b', steps, (e) => events.push(e), { continueOnError: true });
    expect(queries.some((q) => /SAVEPOINT|SAVE TRANSACTION/.test(q))).toBe(false);
    expect(queries.some((q) => /CREATE TABLE good/.test(q))).toBe(true);
    expect(fakeAdapter.commitTransaction).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === 'done')).toMatchObject({ success: true, rolledBack: false });
  });
});
