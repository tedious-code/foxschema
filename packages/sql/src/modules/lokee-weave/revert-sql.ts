/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lokee Weave — turn two hydrated snapshots into reverse DDL.
 *
 * Classification (`planReversal`) decides whether a revert is safe to offer.
 * This module is the next step: Compare treats the *target version* as the
 * desired schema and the *current head* as the live database, then the SQL
 * generator emits the DROP / ALTER / CREATE statements that close the gap.
 */
import type { TableSchema } from '../../interfaces/schema.interface.js';
import { CompareModule } from '../compare.module.js';
import {
  SqlGeneratorModule,
  type MigrationStep,
  type SchemaMapping,
} from '../sql-generator.module.js';

export interface RevertMigration {
  steps: MigrationStep[];
  statements: string[];
}

/**
 * Build the migration that moves `currentTables` (live / head) back to
 * `targetTables` (the version the user picked).
 */
export async function buildRevertMigration(
  currentTables: TableSchema[],
  targetTables: TableSchema[],
  dialect: string,
  mapping?: SchemaMapping
): Promise<RevertMigration> {
  const compare = new CompareModule();
  const schema = mapping?.targetSchema ?? mapping?.sourceSchema;
  const result = await compare.compare(
    targetTables,
    currentTables,
    { source: dialect, target: dialect },
    schema ? { source: schema, target: schema } : undefined
  );
  const gen = new SqlGeneratorModule();
  const diffs = result.tables.filter((t) => t.status !== 'UNCHANGED');
  const steps = gen.generateMigrationPlan(diffs, dialect, mapping, result.tables);
  const statements = steps.flatMap((step) => (step.skipped ? [] : step.statements));
  return { steps, statements };
}
