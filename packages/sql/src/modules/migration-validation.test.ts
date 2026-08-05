import { describe, it, expect } from 'vitest';
import { findMissingFkTargets, findNarrowingTypeChanges, extractReviewNotices, validateMigrationPlan } from './migration-validation';
import { postgresSqlDialect } from '../providers/postgres/postgres.sql-dialect';
import type { TableDiff } from '../interfaces';
import type { MigrationStep } from './sql-generator.module';

// Minimal TableDiff factory — only the fields the checks read.
function diff(partial: Partial<TableDiff> & Pick<TableDiff, 'tableName' | 'objectType' | 'status'>): TableDiff {
  return {
    columnDiffs: [],
    indexDiffs: [],
    foreignKeyDiffs: [],
    ...partial,
  } as TableDiff;
}

describe('findMissingFkTargets', () => {
  it('flags an added FK whose referenced table is being dropped', () => {
    const tables = [
      diff({ tableName: 'CUSTOMERS', objectType: 'TABLE', status: 'REMOVED' }),
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        foreignKeyDiffs: [
          { name: 'FK_ORDERS_CUSTOMER', status: 'ADDED', source: { columns: ['customer_id'], referencedTable: 'CUSTOMERS', referencedColumns: ['id'] } },
        ],
      }),
    ];
    const issues = findMissingFkTargets(tables, { CUSTOMERS: true, ORDERS: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'MISSING_FK_TARGET', severity: 'error', tableName: 'ORDERS' });
  });

  it('does not flag when the referenced table survives (unchanged)', () => {
    const tables = [
      diff({ tableName: 'CUSTOMERS', objectType: 'TABLE', status: 'UNCHANGED' }),
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        foreignKeyDiffs: [
          { name: 'FK_ORDERS_CUSTOMER', status: 'ADDED', source: { columns: ['customer_id'], referencedTable: 'CUSTOMERS', referencedColumns: ['id'] } },
        ],
      }),
    ];
    expect(findMissingFkTargets(tables, { CUSTOMERS: true, ORDERS: true })).toHaveLength(0);
  });

  it('does not flag an FK on a table that is not selected', () => {
    const tables = [
      diff({ tableName: 'CUSTOMERS', objectType: 'TABLE', status: 'REMOVED' }),
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        foreignKeyDiffs: [
          { name: 'FK_ORDERS_CUSTOMER', status: 'ADDED', source: { columns: ['customer_id'], referencedTable: 'CUSTOMERS', referencedColumns: ['id'] } },
        ],
      }),
    ];
    expect(findMissingFkTargets(tables, { CUSTOMERS: true, ORDERS: false })).toHaveLength(0);
  });
});

describe('findNarrowingTypeChanges', () => {
  it('flags a varchar length decrease', () => {
    const tables = [
      diff({
        tableName: 'CUSTOMERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        // source = desired end state (new), target = current target column (old, being replaced).
        columnDiffs: [{ name: 'NAME', status: 'MODIFIED', source: { type: 'varchar(20)', nullable: true }, target: { type: 'varchar(100)', nullable: true } }],
      }),
    ];
    const issues = findNarrowingTypeChanges(tables, { CUSTOMERS: true }, postgresSqlDialect);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'NARROWING_TYPE_CHANGE', severity: 'warning', tableName: 'CUSTOMERS' });
  });

  it('flags bigint narrowing to integer', () => {
    const tables = [
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        columnDiffs: [{ name: 'TOTAL_CENTS', status: 'MODIFIED', source: { type: 'integer', nullable: true }, target: { type: 'bigint', nullable: true } }],
      }),
    ];
    expect(findNarrowingTypeChanges(tables, { ORDERS: true }, postgresSqlDialect)).toHaveLength(1);
  });

  it('does not flag a widening change', () => {
    const tables = [
      diff({
        tableName: 'CUSTOMERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        columnDiffs: [{ name: 'NAME', status: 'MODIFIED', source: { type: 'varchar(100)', nullable: true }, target: { type: 'varchar(20)', nullable: true } }],
      }),
    ];
    expect(findNarrowingTypeChanges(tables, { CUSTOMERS: true }, postgresSqlDialect)).toHaveLength(0);
  });
});

describe('extractReviewNotices', () => {
  it('extracts a "-- review:" line', () => {
    const steps: MigrationStep[] = [
      { objectName: 'ORDERS', objectType: 'TABLE', action: 'ALTER', statements: ["-- review: STATUS: mapped 'ENUM' → varchar with no direct equivalent"] },
    ];
    const issues = extractReviewNotices(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'REVIEW_REQUIRED', severity: 'warning', tableName: 'ORDERS' });
  });

  it('extracts a "MANUAL REVIEW REQUIRED" marker line without pulling in the surrounding body dump', () => {
    const steps: MigrationStep[] = [
      {
        objectName: 'V_ORDER_SUMMARY',
        objectType: 'VIEW',
        action: 'CREATE',
        statements: [
          '-- ============================================================',
          '-- MANUAL REVIEW REQUIRED: VIEW V_ORDER_SUMMARY',
          '-- Body is MYSQL SQL and was NOT auto-translated to POSTGRES.',
          '--   SELECT * FROM orders',
          '-- ============================================================',
        ],
      },
    ];
    const issues = extractReviewNotices(steps);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('VIEW V_ORDER_SUMMARY');
  });

  it('returns nothing for a plain statement', () => {
    const steps: MigrationStep[] = [{ objectName: 'ORDERS', objectType: 'TABLE', action: 'ALTER', statements: ['ALTER TABLE orders ADD COLUMN foo int;'] }];
    expect(extractReviewNotices(steps)).toHaveLength(0);
  });
});

describe('validateMigrationPlan', () => {
  it('orders errors before warnings', () => {
    const tables = [
      diff({ tableName: 'CUSTOMERS', objectType: 'TABLE', status: 'REMOVED' }),
      diff({
        tableName: 'ORDERS',
        objectType: 'TABLE',
        status: 'MODIFIED',
        foreignKeyDiffs: [
          { name: 'FK_ORDERS_CUSTOMER', status: 'ADDED', source: { columns: ['customer_id'], referencedTable: 'CUSTOMERS', referencedColumns: ['id'] } },
        ],
        columnDiffs: [{ name: 'NAME', status: 'MODIFIED', source: { type: 'varchar(20)', nullable: true }, target: { type: 'varchar(100)', nullable: true } }],
      }),
    ];
    const steps: MigrationStep[] = [{ objectName: 'ORDERS', objectType: 'TABLE', action: 'ALTER', statements: ['-- review: something'] }];
    const issues = validateMigrationPlan(tables, { CUSTOMERS: true, ORDERS: true }, postgresSqlDialect, steps);
    expect(issues.map((i) => i.severity)).toEqual(['error', 'warning', 'warning']);
  });
});
