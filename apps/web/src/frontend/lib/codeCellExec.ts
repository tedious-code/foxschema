/**
 * Pure helpers for SQL Editor code cells (`-- @js` / `-- @ts`).
 * The Worker and unit tests both call `executeCodeCellSync`.
 *
 * Cells may use local `let`/`const`/`var`, functions, loops, and allowlisted
 * `import`s (`lodash` / `lodash-es` / `date-fns`). Each cell is isolated
 * (no shared helpers across cells). Must **return** a grid value.
 */

import { codeCellHasReturn } from './sql-splitter';
import { prepareCodeCellImports } from './codeCellPackages';

export { codeCellHasReturn } from './sql-splitter';

export type CodeCellLast = {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
} | null;

/** Structured-cloneable variable bag passed into cells (secrets omitted). */
export type CodeCellVars = Record<
  string,
  | { kind: 'scalar'; value: unknown }
  | { kind: 'list'; values: unknown[] }
  | { kind: 'table'; columns: string[]; rows: unknown[][] }
>;

export type CodeCellOk = {
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
};

export type CodeCellErr = { ok: false; error: string };

export type CodeCellResult = CodeCellOk | CodeCellErr;

type VarLike = {
  name: string;
  kind: 'scalar' | 'list' | 'table';
  secret?: boolean;
  value?: unknown;
  values?: unknown[];
  columns?: string[];
  rows?: unknown[][];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Drop secret variables; shape the rest for the cell scope. */
export function sanitizeVarsForCodeCell(variables: VarLike[]): CodeCellVars {
  const out: CodeCellVars = {};
  for (const v of variables) {
    if (v.secret) continue;
    if (v.kind === 'scalar') {
      out[v.name] = { kind: 'scalar', value: v.value };
    } else if (v.kind === 'list') {
      out[v.name] = { kind: 'list', values: [...(v.values ?? [])] };
    } else {
      out[v.name] = {
        kind: 'table',
        columns: [...(v.columns ?? [])],
        rows: (v.rows ?? []).map((r) => [...r]),
      };
    }
  }
  return out;
}

function normalizeObjectRows(
  value: Record<string, unknown>[],
  maxRows: number
): CodeCellOk {
  const colSet = new Set<string>();
  for (const row of value.slice(0, 50)) {
    for (const k of Object.keys(row)) colSet.add(k);
  }
  const columns = [...colSet];
  const truncated = value.length > maxRows;
  const kept = truncated ? value.slice(0, maxRows) : value;
  const rows = kept.map((r) => columns.map((c) => r[c]));
  return { ok: true, columns, rows, rowCount: rows.length, truncated };
}

function normalizeColumnsRows(
  columnsRaw: unknown[],
  rowsRaw: unknown[],
  maxRows: number
): CodeCellOk {
  const columns = columnsRaw.map((c) => String(c));
  const truncated = rowsRaw.length > maxRows;
  const kept = truncated ? rowsRaw.slice(0, maxRows) : rowsRaw;
  const rows: unknown[][] = kept.map((r) => {
    if (Array.isArray(r)) return columns.map((_, i) => r[i]);
    if (isPlainObject(r)) return columns.map((c) => r[c]);
    return columns.map(() => undefined);
  });
  return { ok: true, columns, rows, rowCount: rows.length, truncated };
}

/**
 * Normalize a cell return value into columns/rows.
 * Accepts `{ columns, rows }` or an array of plain objects.
 */
export function normalizeCodeCellReturn(
  value: unknown,
  maxRows: number
): CodeCellOk | CodeCellErr {
  if (value === null || value === undefined) {
    return {
      ok: false,
      error:
        'Code cell must return a value — use return { columns, rows } or return [...objects]',
    };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { ok: true, columns: [], rows: [], rowCount: 0, truncated: false };
    }
    if (value.every(isPlainObject)) {
      return normalizeObjectRows(value, maxRows);
    }
    return {
      ok: false,
      error: 'Array return must be an array of plain objects (or return { columns, rows })',
    };
  }

  if (isPlainObject(value)) {
    const { columns, rows } = value as { columns?: unknown; rows?: unknown };
    if (!Array.isArray(columns) || !Array.isArray(rows)) {
      return {
        ok: false,
        error: 'Return { columns: string[], rows: unknown[][] } or an array of objects',
      };
    }
    return normalizeColumnsRows(columns, rows, maxRows);
  }

  return { ok: false, error: `Unsupported return type: ${typeof value}` };
}

const SANDBOX_PREAMBLE = `
"use strict";
var fetch = undefined;
var XMLHttpRequest = undefined;
var WebSocket = undefined;
var indexedDB = undefined;
var localStorage = undefined;
var sessionStorage = undefined;
var importScripts = undefined;
var self = undefined;
var window = undefined;
var document = undefined;
var globalThis = undefined;
`;

/**
 * Run JS cell body with `last`, `vars`, and allowlisted import bindings in scope.
 * Callers must transpile TypeScript to JS before invoking.
 */
export function executeCodeCellSync(args: {
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
}): CodeCellResult {
  const rawBody = args.body.trim();
  if (!rawBody) {
    return { ok: false, error: 'Code cell is empty' };
  }

  const prepared = prepareCodeCellImports(rawBody);
  if (!prepared.ok) {
    return { ok: false, error: prepared.error };
  }

  const body = prepared.body.trim();
  if (!body) {
    return { ok: false, error: 'Code cell is empty after imports' };
  }
  if (!codeCellHasReturn(body)) {
    return {
      ok: false,
      error:
        'Code cell must include a return statement — e.g. return { columns, rows } or return rows.map(...)',
    };
  }

  const bindingNames = Object.keys(prepared.bindings);
  for (const name of bindingNames) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      return { ok: false, error: `Invalid import binding name: ${name}` };
    }
  }
  const bindingValues = bindingNames.map((n) => prepared.bindings[n]);

  try {
    // Sandboxed Function: last/vars + allowlisted import bindings only.
    const fn = new Function('last', 'vars', ...bindingNames, `${SANDBOX_PREAMBLE}${body}`);
    const raw = fn(args.last, args.vars, ...bindingValues);
    if (raw != null && typeof (raw as Promise<unknown>).then === 'function') {
      return {
        ok: false,
        error: 'Async code cells are not supported yet (do not return a Promise)',
      };
    }
    return normalizeCodeCellReturn(raw, args.maxRows);
  } catch (error: unknown) {
    return { ok: false, error: errorMessage(error) };
  }
}
