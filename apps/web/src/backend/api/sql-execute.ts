import { ConnectionFactory, getAdapter, type ConnectionOptions } from '@foxschema/core';

/**
 * Helpers behind POST /api/sql/execute (SQL Editor). One request = one
 * credential + N statements; the frontend fans out across credentials with
 * parallel requests. Statements run sequentially on one connection (so
 * SET CURRENT SCHEMA / search_path sticks); each result is isolated so one
 * broken statement doesn't hide the others.
 */

export interface StatementResultOk {
  ok: true;
  columns: string[];
  /** Rows as arrays in `columns` order, cells JSON-safe (BigInt→string, Date→ISO). */
  rows: unknown[][];
  rowCount: number;
  /** True when the driver returned more rows than maxRows and the tail was dropped. */
  truncated: boolean;
  durationMs: number;
}
export interface StatementResultErr {
  ok: false;
  error: string;
  durationMs: number;
}
export type StatementResult = StatementResultOk | StatementResultErr;

export const MAX_STATEMENTS = 25;
export const MAX_STATEMENT_LENGTH = 100_000;
const MAX_ROWS_CAP = 5000;
const DEFAULT_MAX_ROWS = 200;

export function clampMaxRows(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_MAX_ROWS;
  return Math.min(Math.max(n, 1), MAX_ROWS_CAP);
}

/** One JSON-safe cell. Drivers hand back BigInt/Date/Buffer/objects that JSON.stringify either rejects or mangles. */
function serializeCell(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) {
    const hex = Buffer.from(v).toString('hex');
    return `0x${hex.length > 64 ? hex.slice(0, 64) + '…' : hex}`;
  }
  if (typeof v === 'object' && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return v;
}

/**
 * Shape raw driver rows into {columns, rows} for the grid. Column names are the
 * union of keys over the first 50 kept rows (empty result ⇒ no column names —
 * accepted v1 limitation, the UI shows "0 rows"). Non-array driver results
 * (e.g. a mysql2 OkPacket from a write) are treated as an empty result set.
 */
export function shapeRows(raw: unknown, maxRows: number): Omit<StatementResultOk, 'ok' | 'durationMs'> {
  const all: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
  const truncated = all.length > maxRows;
  const kept = truncated ? all.slice(0, maxRows) : all;

  const colSet = new Set<string>();
  for (const row of kept.slice(0, 50)) {
    if (row && typeof row === 'object') for (const k of Object.keys(row)) colSet.add(k);
  }
  const columns = [...colSet];
  const rows = kept.map((r) => columns.map((c) => serializeCell(r?.[c])));
  return { columns, rows, rowCount: kept.length, truncated };
}

/**
 * Run statements in order against one credential, isolating failures per statement.
 * Applies `schema` the same way migration does (connection option + adapter
 * setCurrentSchema) so unqualified names resolve — e.g. DB2 CURRENT SCHEMA
 * instead of the auth-id default (CARTER.ORDERS).
 */
export async function runStatements(
  dialect: string,
  option: ConnectionOptions,
  statements: string[],
  maxRows: number,
  schema?: string
): Promise<StatementResult[]> {
  const schemaName = (schema ?? option.schema)?.trim() || '';
  const optionWithSchema: ConnectionOptions = schemaName
    ? { ...option, schema: schemaName }
    : option;

  const connection = await ConnectionFactory.create(dialect, optionWithSchema);
  try {
    if (schemaName) {
      await getAdapter(dialect).setCurrentSchema(connection, schemaName);
    }

    const results: StatementResult[] = [];
    for (const sql of statements) {
      const started = Date.now();
      try {
        const raw = await ConnectionFactory.executeOnConnection<Record<string, unknown>>(
          dialect,
          connection,
          sql
        );
        results.push({ ok: true, ...shapeRows(raw, maxRows), durationMs: Date.now() - started });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ ok: false, error: message, durationMs: Date.now() - started });
      }
    }
    return results;
  } finally {
    await ConnectionFactory.close(dialect, connection);
  }
}
