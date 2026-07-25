/**
 * Run a SQL Editor JS/TS code cell. Prefers a Web Worker; falls back to sync
 * execution when Worker is unavailable (unit tests / Node).
 */

import type { SqlStatementResult } from '../api/sqlApi';
import type { SetDirective, SqlVariable } from './sql-variables';
import { parseSetDirectives } from './sql-variables';
import { parseCodeCell } from './sql-splitter';
import {
  executeCodeCellSync,
  sanitizeVarsForCodeCell,
  type CodeCellLast,
  type CodeCellResult,
  type CodeCellVars,
} from './codeCellExec';

const DEFAULT_TIMEOUT_MS = 5_000;

let nextId = 1;
let workerCtorPromise: Promise<(new () => Worker) | null> | null = null;

export type RunCodeCellArgs = {
  /** Full statement text including `-- @js` / `-- @end` (and optional `@set` lines). */
  statement: string;
  last: CodeCellLast;
  variables: SqlVariable[];
  maxRows: number;
  timeoutMs?: number;
};

/**
 * Detect a fenced JS/TS cell, allowing leading `-- @set` above `-- @js`/`-- @ts`.
 */
export function detectCodeCell(
  statement: string
): { kind: 'js' | 'ts'; body: string; closed: boolean } | null {
  const afterSets = parseSetDirectives(statement).sql;
  return parseCodeCell(afterSets) ?? parseCodeCell(statement);
}

/** Prepare body + kind from a fenced statement (strips @set + fence markers). */
export function prepareCodeCellSource(statement: string):
  | { kind: 'js' | 'ts'; body: string; directives: SetDirective[] }
  | { error: string } {
  // Leading `-- @set` may sit above `-- @js` (reattachSetComments).
  const leading = parseSetDirectives(statement);
  const cell = parseCodeCell(leading.sql);
  if (!cell) return { error: 'Not a code cell' };
  const inner = parseSetDirectives(cell.body);
  return {
    kind: cell.kind,
    body: inner.sql,
    directives: [...leading.directives, ...inner.directives],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function transpileTs(body: string): Promise<string> {
  const ts = await import('typescript');
  const out = ts.transpileModule(body, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      strict: false,
    },
    reportDiagnostics: true,
  });
  const errs = (out.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errs.length > 0) {
    const msg = errs
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('; ');
    throw new Error(msg || 'TypeScript transpile failed');
  }
  return out.outputText;
}

function toStatementResult(result: CodeCellResult, started: number): SqlStatementResult {
  const durationMs = Date.now() - started;
  if (!result.ok) {
    return { ok: false, error: result.error, durationMs };
  }
  return {
    ok: true,
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    truncated: result.truncated,
    hasNext: false,
    durationMs,
  };
}

async function loadWorkerCtor(): Promise<(new () => Worker) | null> {
  if (typeof Worker === 'undefined') return null;
  if (!workerCtorPromise) {
    workerCtorPromise = import('./codeCell.worker.ts?worker')
      .then((mod) => (mod as { default?: new () => Worker }).default ?? null)
      .catch(() => null);
  }
  return workerCtorPromise;
}

function runInWorker(args: {
  WorkerCtor: new () => Worker;
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
  timeoutMs: number;
  started: number;
}): Promise<SqlStatementResult> {
  const { WorkerCtor, body, last, vars, maxRows, timeoutMs, started } = args;

  return new Promise((resolve) => {
    let settled = false;
    const id = nextId++;
    let worker: Worker;
    try {
      worker = new WorkerCtor();
    } catch {
      resolve(toStatementResult(executeCodeCellSync({ body, last, vars, maxRows }), started));
      return;
    }

    const finish = (result: SqlStatementResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `Code cell timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - started,
      });
    }, timeoutMs);

    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { id: number } & CodeCellResult;
      if (data.id !== id) return;
      finish(toStatementResult(data, started));
    };
    worker.onerror = (err) => {
      finish({
        ok: false,
        error: err.message || 'Code cell worker error',
        durationMs: Date.now() - started,
      });
    };

    worker.postMessage({ id, body, last, vars, maxRows });
  });
}

/**
 * Execute a fenced JS/TS cell. Returns the same shape as SQL statement results.
 * Also returns parsed `@set` directives so the store can apply them.
 */
export async function runCodeCell(
  args: RunCodeCellArgs
): Promise<{ result: SqlStatementResult; directives: SetDirective[] }> {
  const started = Date.now();
  const prepared = prepareCodeCellSource(args.statement);
  if ('error' in prepared) {
    return {
      result: { ok: false, error: prepared.error, durationMs: Date.now() - started },
      directives: [],
    };
  }

  let body = prepared.body;
  try {
    if (prepared.kind === 'ts') {
      body = await transpileTs(body);
    }
  } catch (error: unknown) {
    return {
      result: {
        ok: false,
        error: `TypeScript: ${errorMessage(error)}`,
        durationMs: Date.now() - started,
      },
      directives: prepared.directives,
    };
  }

  const vars = sanitizeVarsForCodeCell(args.variables);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execArgs = { body, last: args.last, vars, maxRows: args.maxRows };

  const WorkerCtor = await loadWorkerCtor();
  if (!WorkerCtor) {
    return {
      result: toStatementResult(executeCodeCellSync(execArgs), started),
      directives: prepared.directives,
    };
  }

  const result = await runInWorker({ WorkerCtor, ...execArgs, timeoutMs, started });
  return { result, directives: prepared.directives };
}
