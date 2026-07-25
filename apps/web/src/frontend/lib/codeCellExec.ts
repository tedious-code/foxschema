/**
 * Browser-side executor for SQL Editor code cells (`-- @js` / `-- @ts`).
 * The Web Worker and unit tests call `executeCodeCell`. Node fences
 * (`-- @node` / `-- @nodets`) use the server executor instead.
 *
 * The parsing/normalizing/sandbox machinery is shared with the Node executor
 * via `@foxschema/core`; this module supplies only the browser's globals
 * preamble and bundled packages.
 *
 * Cells may use local `let`/`const`/`var`, functions, loops, `async`/`await`,
 * `fetch`, and allowlisted `import`s (`lodash` / `lodash-es` / `date-fns`).
 * Each cell is isolated (no shared helpers across cells). Must **return** a grid.
 */

import {
  runCodeCellBody,
  type CodeCellLast,
  type CodeCellVars,
  type CodeCellOk,
  type CodeCellErr,
  type CodeCellResult,
} from './sql-splitter';
import { CODE_CELL_PACKAGE_MODULES } from './codeCellPackages';

export { codeCellHasReturn, normalizeCodeCellReturn } from './sql-splitter';
export type {
  CodeCellLast,
  CodeCellVars,
  CodeCellOk,
  CodeCellErr,
  CodeCellResult,
} from './sql-splitter';

type VarLike = {
  name: string;
  kind: 'scalar' | 'list' | 'table';
  secret?: boolean;
  value?: unknown;
  values?: unknown[];
  columns?: string[];
  rows?: unknown[][];
};

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

/** Shadow browser APIs except `fetch` (allowed for async HTTP). */
const SANDBOX_PREAMBLE = `
"use strict";
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
 * Run a JS cell body with `last`, `vars`, and allowlisted import bindings in
 * scope. Supports `async`/`await` and `fetch`. Callers must transpile
 * TypeScript first.
 */
export function executeCodeCell(args: {
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
}): Promise<CodeCellResult> {
  return runCodeCellBody({
    ...args,
    preamble: SANDBOX_PREAMBLE,
    modules: CODE_CELL_PACKAGE_MODULES,
  });
}
