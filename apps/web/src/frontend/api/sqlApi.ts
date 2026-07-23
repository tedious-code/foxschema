import { getApiBase } from './apiBase';
import type { ConnectionRef } from './schemaApi';

/** One statement's outcome from POST /sql/execute (mirrors backend sql-execute.ts). */
export type SqlStatementResult =
  | { ok: true; columns: string[]; rows: unknown[][]; rowCount: number; truncated: boolean; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * Run statements against ONE credential. The SQL Editor fans out across
 * selected credentials by calling this once per connection (Promise.allSettled
 * in the store), so a dead database can't stall the others' results.
 */
export async function executeSql(
  ref: ConnectionRef,
  statements: string[],
  maxRows?: number
): Promise<{ results: SqlStatementResult[] }> {
  const res = await fetch(`${getApiBase()}/sql/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ ...ref, statements, maxRows }),
  });
  const text = await res.text();
  let data: { results?: SqlStatementResult[]; error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid response from server (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.results) throw new Error(data.error || `Query failed (${res.status})`);
  return { results: data.results };
}
