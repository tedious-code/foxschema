/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { getApiBase, parseJsonResponse } from './apiBase';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  return parseJsonResponse<T>(res, { allowEmpty: true });
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
}): Promise<string> {
  const { id } = await request<{ id: string }>('/data-migrations/start', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return id;
}

export async function apiFinishDataMigrate(
  id: string,
  outcome: {
    status: DataMigrateRunStatus;
    results: DataMigrateOpResult[];
    error?: string;
  }
): Promise<void> {
  await request(`/data-migrations/${id}/finish`, {
    method: 'POST',
    body: JSON.stringify(outcome),
  });
}

export async function apiListDataMigrations(): Promise<DataMigrateRunSummary[]> {
  const { runs } = await request<{ runs: DataMigrateRunSummary[] }>('/data-migrations');
  return runs;
}

export async function apiGetDataMigration(id: string): Promise<DataMigrateRunDetail> {
  const { run } = await request<{ run: DataMigrateRunDetail }>(`/data-migrations/${id}`);
  return run;
}

export async function apiDeleteDataMigration(id: string): Promise<void> {
  await request(`/data-migrations/${id}`, { method: 'DELETE' });
}
