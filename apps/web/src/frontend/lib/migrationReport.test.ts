/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildMigrationReport, migrationReportFilename } from './migrationReport';
import type { SchemaCompareResult } from './types';

const META = {
  originalLabel: 'Version 2',
  targetLabel: 'Version 3',
  databaseLabel: '[postgres] localhost/foxdb.demo_b',
  generatedAt: new Date('2026-08-16T12:34:56.000Z'),
};

const COMPARE: SchemaCompareResult = {
  summary: { added: 1, removed: 0, modified: 1, unchanged: 4 },
  tables: [
    {
      tableName: 'CUSTOMERS',
      objectType: 'TABLE',
      status: 'MODIFIED',
      columnDiffs: [
        { name: 'id', status: 'UNCHANGED', source: { type: 'integer', nullable: false } },
        {
          name: 'email',
          status: 'MODIFIED',
          source: { type: 'varchar(255)', nullable: false },
          target: { type: 'varchar(100)', nullable: true },
        },
        { name: 'phone', status: 'ADDED', source: { type: 'varchar(20)', nullable: true } },
        { name: 'fax', status: 'REMOVED', target: { type: 'varchar(20)', nullable: true } },
      ],
      indexDiffs: [
        {
          name: 'IDX_EMAIL',
          status: 'ADDED',
          source: { name: 'idx_email', columns: ['email'], unique: false },
        },
      ],
      foreignKeyDiffs: [],
      triggerDiffs: [],
    },
    {
      tableName: 'AUDIT_LOG',
      objectType: 'TABLE',
      status: 'ADDED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      triggerDiffs: [],
    },
    {
      tableName: 'ORDERS',
      objectType: 'TABLE',
      status: 'UNCHANGED',
      columnDiffs: [],
      indexDiffs: [],
      foreignKeyDiffs: [],
      triggerDiffs: [],
    },
  ],
};

describe('buildMigrationReport', () => {
  const md = buildMigrationReport(COMPARE, META);

  it('never contains SQL — that is the whole point of this report', () => {
    // The Migration SQL tab answers "what will run"; this answers "what
    // changed", for a reader who does not read DDL.
    // Keywords only. Banning `;` as well was too crude — English prose uses
    // punctuation, and the first version of this failed on its own sentence.
    expect(md).not.toMatch(/\b(ALTER|CREATE|DROP|SELECT|INSERT|UPDATE|DELETE)\b/i);
  });

  it('names both sides, the database and the time', () => {
    expect(md).toContain('Version 2 → Version 3');
    expect(md).toContain('[postgres] localhost/foxdb.demo_b');
    expect(md).toContain('2026-08-16 12:34 UTC');
  });

  it('summarises counts as a table', () => {
    expect(md).toContain('| Added | 1 |');
    expect(md).toContain('| Changed | 1 |');
    expect(md).toContain('| Unchanged | 4 |');
  });

  it('lists only the objects that differ', () => {
    expect(md).toContain('`CUSTOMERS`');
    expect(md).toContain('`AUDIT_LOG`');
    expect(md).not.toContain('`ORDERS`');
  });

  it('describes column changes in words, with the direction of the change', () => {
    expect(md).toContain('Added column `phone` (varchar(20))');
    expect(md).toContain('Removed column `fax`');
    // Old → new, and the nullability flip stated plainly.
    expect(md).toContain('varchar(100) → varchar(255)');
    expect(md).toContain('now required');
  });

  it('uses the index own name rather than the uppercased compare key', () => {
    expect(md).toContain('`idx_email`');
    expect(md).not.toContain('`IDX_EMAIL`');
  });

  it('says so plainly when an object changed but has nothing to list', () => {
    expect(md).toMatch(/No column, index or constraint changes were recorded/i);
  });

  it('reports an identical pair without inventing sections', () => {
    const same = buildMigrationReport(
      { summary: { added: 0, removed: 0, modified: 0, unchanged: 9 }, tables: [] },
      META
    );
    expect(same).toContain('No objects differ');
    expect(same).not.toContain('## Details');
  });
});

describe('migrationReportFilename', () => {
  it('slugs both sides into a safe name', () => {
    expect(migrationReportFilename(META)).toBe('schema-report-version-2-to-version-3.md');
    expect(
      migrationReportFilename({ ...META, targetLabel: 'Current database (Version 4)' })
    ).toBe('schema-report-version-2-to-current-database-version-4.md');
  });
});
