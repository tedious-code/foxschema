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
  /** Bulk-load into this saved credential (any dialect). */
  targetConnectionId?: string;
  /** Add a table to an existing Files: SQLite workspace. */
  workspaceConnectionId?: string;
  /** Display name for a new Files workspace. */
  workspaceName?: string;
  /** Drop/recreate table on target when set. */
  replaceTable?: boolean;
};

export type FileQueryImportResponse = {
  ok: boolean;
  error?: string;
  mode?: 'workspace' | 'credential';
  connection?: SavedConnectionSummary;
  connectionId?: string;
  tableName?: string;
  rowCount?: number;
  columns?: string[];
  sampleSql?: string;
  dialect?: string;
  chunks?: number;
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

/** Paste/small JSON import. Large content should use importFileViaChunks. */
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

const CHUNK_CHARS = 512_000;

/**
 * Stream large content via disk-backed session chunks, then commit.
 * Used when content exceeds the JSON paste path.
 */
export async function importFileViaChunks(
  body: Omit<FileQueryImportRequest, 'content'> & { content: string }
): Promise<FileQueryImportResponse> {
  const { content, replacePrevious, ...meta } = body;
  const start = await fetch(`${getApiBase()}/files/sessions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  const startData = (await start.json().catch(() => ({}))) as {
    ok?: boolean;
    sessionId?: string;
    error?: string;
  };
  if (!start.ok || !startData.sessionId) {
    return { ok: false, error: startData.error || `Session failed (HTTP ${start.status})` };
  }
  const sessionId = startData.sessionId;
  try {
    for (let i = 0; i < content.length; i += CHUNK_CHARS) {
      const slice = content.slice(i, i + CHUNK_CHARS);
      const chunkRes = await fetch(
        `${getApiBase()}/files/sessions/${encodeURIComponent(sessionId)}/chunk`,
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: slice, encoding: 'utf8' }),
        }
      );
      const chunkData = (await chunkRes.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!chunkRes.ok || chunkData.ok === false) {
        throw new Error(chunkData.error || `Chunk failed (HTTP ${chunkRes.status})`);
      }
    }
    const commit = await fetch(
      `${getApiBase()}/files/sessions/${encodeURIComponent(sessionId)}/commit`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replacePrevious: replacePrevious === true }),
      }
    );
    const data = (await commit.json().catch(() => ({}))) as FileQueryImportResponse;
    if (!commit.ok) {
      return { ok: false, error: data.error || `Commit failed (HTTP ${commit.status})` };
    }
    return data;
  } catch (e) {
    await fetch(`${getApiBase()}/files/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => undefined);
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Chunked import failed',
    };
  }
}

/** Prefer chunked upload for large pastes/files. */
export async function importFileSmart(
  body: FileQueryImportRequest
): Promise<FileQueryImportResponse> {
  if ((body.content?.length ?? 0) > 600_000) {
    return importFileViaChunks(body);
  }
  return importFileForQuery(body);
}

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
