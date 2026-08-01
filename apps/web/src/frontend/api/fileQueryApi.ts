import { getApiBase } from './apiBase';
import type { SavedConnectionSummary } from './authApi';

export type FileQueryFormat = 'csv' | 'json' | 'text';

export type TextOffsetColumn = {
  name: string;
  start: number;
  length: number;
};

export type FileQueryImportRequest = {
  format: FileQueryFormat;
  fileName: string;
  content: string;
  tableName?: string;
  csv?: { delimiter?: string; hasHeader?: boolean };
  json?: { mode?: 'array' | 'ndjson' };
  text?: { skipLines?: number; columns: TextOffsetColumn[] };
  /** When true, drop earlier Files: credentials + temp DBs. Default false. */
  replacePrevious?: boolean;
};

export type FileQueryImportResponse = {
  ok: boolean;
  error?: string;
  connection?: SavedConnectionSummary;
  tableName?: string;
  rowCount?: number;
  columns?: string[];
  sampleSql?: string;
  replacedPrevious?: boolean;
  removedConnectionIds?: string[];
  removedFiles?: number;
};

export type FileImportListItem = {
  id: string;
  name: string;
  database?: string;
  createdAt: string;
  tables: string[];
};

export async function importFileForQuery(
  body: FileQueryImportRequest
): Promise<FileQueryImportResponse> {
  const res = await fetch(`${getApiBase()}/files/import`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as FileQueryImportResponse;
  if (!res.ok) {
    return { ok: false, error: data.error || `Import failed (HTTP ${res.status})` };
  }
  return data;
}

/** List reusable Query-files credentials + table names. */
export async function listFileImports(): Promise<{
  ok: boolean;
  error?: string;
  imports?: FileImportListItem[];
}> {
  const res = await fetch(`${getApiBase()}/files/imports`, {
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    imports?: FileImportListItem[];
    error?: string;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `List failed (HTTP ${res.status})` };
  }
  return { ok: true, imports: Array.isArray(data.imports) ? data.imports : [] };
}

/** Remove one Query-files credential + temp DB. */
export async function deleteFileImport(connectionId: string): Promise<{
  ok: boolean;
  error?: string;
  removedConnectionIds?: string[];
  removedFiles?: number;
}> {
  const res = await fetch(`${getApiBase()}/files/imports/${encodeURIComponent(connectionId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    removedConnectionIds?: string[];
    removedFiles?: number;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `Delete failed (HTTP ${res.status})` };
  }
  return {
    ok: true,
    removedConnectionIds: data.removedConnectionIds ?? [connectionId],
    removedFiles: data.removedFiles ?? 0,
  };
}

/** Remove all Query-files credentials and temp DBs for this user. */
export async function clearFileImports(): Promise<{
  ok: boolean;
  error?: string;
  removedConnectionIds?: string[];
  removedFiles?: number;
}> {
  const res = await fetch(`${getApiBase()}/files/imports`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    removedConnectionIds?: string[];
    removedFiles?: number;
  };
  if (!res.ok) {
    return { ok: false, error: data.error || `Clear failed (HTTP ${res.status})` };
  }
  return {
    ok: true,
    removedConnectionIds: data.removedConnectionIds ?? [],
    removedFiles: data.removedFiles ?? 0,
  };
}
