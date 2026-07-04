import { getApiBase } from './apiBase';

export type MigrationRunStatus = 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'ROLLED_BACK';

export interface MigrationObjectResult {
  name: string;
  type: string;
  action: string;
  status: string;
  error?: string;
}

export interface MigrationRunSummary {
  id: string;
  status: MigrationRunStatus;
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
  objectCount: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface MigrationRunDetail extends MigrationRunSummary {
  script?: string;
  snapshotDdl?: string;
  results: MigrationObjectResult[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data;
}

export async function apiListMigrations(): Promise<MigrationRunSummary[]> {
  const { runs } = await request<{ runs: MigrationRunSummary[] }>('/migrations');
  return runs;
}

export async function apiGetMigration(id: string): Promise<MigrationRunDetail> {
  const { run } = await request<{ run: MigrationRunDetail }>(`/migrations/${id}`);
  return run;
}

export async function apiDeleteMigration(id: string): Promise<void> {
  await request(`/migrations/${id}`, { method: 'DELETE' });
}

/** Delete a set of runs. Returns how many were removed. */
export async function apiDeleteMigrations(ids: string[]): Promise<number> {
  const { removed } = await request<{ removed: number }>('/migrations/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  return removed;
}

/** Clear the entire migration history. Returns how many were removed. */
export async function apiClearMigrations(): Promise<number> {
  const { removed } = await request<{ removed: number }>('/migrations', { method: 'DELETE' });
  return removed;
}
