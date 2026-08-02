/**
 * Message protocol between a Node code-cell worker and the API process.
 *
 * The worker is deliberately isolated — no DB handle, no `process.env` — so a
 * cell that wants to run SQL asks the parent to do it. The parent owns the
 * connection, the write policy, and the row cap; the worker only sees rows.
 */

/** Worker → parent: run this statement on a connection (optional Server Beam alias). */
export interface CellQueryRequest {
  type: 'cell-query';
  id: number;
  text: string;
  params: unknown[];
  /** Server Beam endpoint alias (`sql.on('source')`). Omit = default connection. */
  alias?: string;
  /** True when the call used `sql.on(...)` (counts toward the per-Execute cap). */
  viaOn?: boolean;
}

/** Parent → worker: the outcome of one `cell-query`. */
export type CellQueryResponse =
  | { type: 'cell-query-result'; id: number; ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { type: 'cell-query-result'; id: number; ok: false; error: string };

/** Worker → parent: the cell finished (existing single-result message). */
export interface CellDoneMessage {
  type: 'cell-done';
  result: unknown;
}

export type WorkerToParent = CellQueryRequest | CellDoneMessage;

export function isCellQueryRequest(msg: unknown): msg is CellQueryRequest {
  if (
    typeof msg !== 'object' ||
    msg === null ||
    (msg as { type?: unknown }).type !== 'cell-query' ||
    typeof (msg as { id?: unknown }).id !== 'number' ||
    typeof (msg as { text?: unknown }).text !== 'string'
  ) {
    return false;
  }
  const alias = (msg as { alias?: unknown }).alias;
  if (alias !== undefined && typeof alias !== 'string') return false;
  const viaOn = (msg as { viaOn?: unknown }).viaOn;
  if (viaOn !== undefined && typeof viaOn !== 'boolean') return false;
  return true;
}

export function isCellDoneMessage(msg: unknown): msg is CellDoneMessage {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'cell-done'
  );
}

/** Rows a bridged query may hand back to a cell before it is truncated. */
export const MAX_CELL_QUERY_ROWS = 10_000;
