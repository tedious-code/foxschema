/**
 * Message protocol between a Node code-cell worker and the API process.
 *
 * The worker is deliberately isolated — no DB handle, no `process.env` — so a
 * cell that wants to run SQL asks the parent to do it. The parent owns the
 * connection, the write policy, and the row cap; the worker only sees rows.
 */

/** Worker → parent: run this statement on the cell's connection. */
export interface CellQueryRequest {
  type: 'cell-query';
  id: number;
  text: string;
  params: unknown[];
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
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'cell-query' &&
    typeof (msg as { id?: unknown }).id === 'number' &&
    typeof (msg as { text?: unknown }).text === 'string'
  );
}

export function isCellDoneMessage(msg: unknown): msg is CellDoneMessage {
  return (
    typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'cell-done'
  );
}

/** Rows a bridged query may hand back to a cell before it is truncated. */
export const MAX_CELL_QUERY_ROWS = 10_000;
