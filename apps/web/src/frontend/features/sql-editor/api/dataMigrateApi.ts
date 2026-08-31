/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { api } from '@/shared/api/client';

export type DataMigrateRunStatus =
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED';

export interface DataMigrateOpResult {
  op: 'insert' | 'update' | 'delete';
  key: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  error?: string;
}

export interface DataMigrateRunSummary {
  id: string;
  status: DataMigrateRunStatus;
  dialect: string;
  sourceHost?: string;
  targetHost?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  rowCount: number;
  opsEnabled: { insert: boolean; update: boolean; delete: boolean };
  includeIdentity: boolean;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface DataMigrateRunDetail extends DataMigrateRunSummary {
  script?: string;
  snapshotJson?: string;
  keyColumns: string[];
  results: DataMigrateOpResult[];
}

export async function apiStartDataMigrate(input: {
  dialect: string;
  sourceHost?: string;
  targetHost?: string;
  database?: string;
  schema?: string;
  tableName?: string;
  rowCount: number;
  opsEnabled: { insert: boolean; update: boolean; delete: boolean };
  includeIdentity: boolean;
  keyColumns: string[];
  script: string;
  snapshotJson?: string;
}): Promise<{ id: string; snapshotStored: boolean }> {
  return api.post<{ id: string; snapshotStored: boolean }>('/data-migrations/start', input);
}

export async function apiFinishDataMigrate(
  id: string,
  outcome: {
    status: DataMigrateRunStatus;
    results: DataMigrateOpResult[];
    error?: string;
  }
): Promise<void> {
  await api.post(`/data-migrations/${id}/finish`, outcome, { allowEmpty: true });
}

export async function apiListDataMigrations(): Promise<DataMigrateRunSummary[]> {
  const { runs } = await api.get<{ runs: DataMigrateRunSummary[] }>('/data-migrations');
  return runs;
}

export async function apiGetDataMigration(id: string): Promise<DataMigrateRunDetail> {
  const { run } = await api.get<{ run: DataMigrateRunDetail }>(`/data-migrations/${id}`);
  return run;
}

export interface DataMigrateExecOp {
  op: 'insert' | 'update' | 'delete';
  key: string;
  sql: string;
  params?: unknown[];
}

export interface DataMigrateExecOutcome {
  results: DataMigrateOpResult[];
  rolledBack: boolean;
  failCount: number;
}

/** Apply row ops on the destination with optional transaction / continue-on-error. */
export async function apiExecuteDataMigrate(
  ref: {
    connectionId: string;
    password?: string;
    schema?: string;
  },
  ops: DataMigrateExecOp[],
  opts: {
    useTransaction: boolean;
    continueOnError: boolean;
    /**
     * Table to allow explicit identity values on, for engines that gate it on
     * the session (SQL Server, Azure SQL).
     *
     * Only the name travels: the server builds the SET IDENTITY_INSERT
     * statements from its own capability table.
     */
    identityInsertTable?: string;
  }
): Promise<DataMigrateExecOutcome> {
  return api.post<DataMigrateExecOutcome>('/data-migrate/execute', {
    ...ref,
    ops,
    useTransaction: opts.useTransaction,
    continueOnError: opts.continueOnError,
    identityInsertTable: opts.identityInsertTable,
  });
}
