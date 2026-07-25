/**
 * POST /api/sql/code-cell — run a `-- @node` / `-- @nodets` cell on the
 * FoxSchema Node backend (`kind` is `"js"` | `"ts"` on the wire).
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import type { BrowserCodeCellKind } from '@foxschema/core';
import { isCodeCellLast, isCodeCellVars } from '@foxschema/core';
import type { CodeCellLast, CodeCellResult, CodeCellVars } from './code-cell-node-exec';
import { clampMaxRows } from './sql-execute';

export const MAX_CODE_CELL_LENGTH = 100_000;
export const DEFAULT_CODE_CELL_TIMEOUT_MS = 10_000;
export const MAX_CODE_CELL_TIMEOUT_MS = 30_000;

/** Wire language for Node cells (fence `node`/`nodets` already mapped client-side). */
export type CodeCellKindLang = BrowserCodeCellKind;

export type CodeCellRequestBody = {
  body?: unknown;
  kind?: unknown;
  last?: unknown;
  vars?: unknown;
  maxRows?: unknown;
  timeoutMs?: unknown;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function clampCodeCellTimeout(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : Number.NaN;
  if (!Number.isFinite(n)) return DEFAULT_CODE_CELL_TIMEOUT_MS;
  return Math.min(Math.max(n, 100), MAX_CODE_CELL_TIMEOUT_MS);
}

export type ValidatedCodeCell = {
  body: string;
  kind: CodeCellKindLang;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
  timeoutMs: number;
};

export function validateCodeCellRequest(
  raw: CodeCellRequestBody
): { ok: true; value: ValidatedCodeCell } | { ok: false; error: string } {
  if (typeof raw.body !== 'string' || !raw.body.trim()) {
    return { ok: false, error: 'body is required' };
  }
  if (raw.body.length > MAX_CODE_CELL_LENGTH) {
    return { ok: false, error: `body must be under ${MAX_CODE_CELL_LENGTH} characters` };
  }
  const kind: CodeCellKindLang | null =
    raw.kind === 'js' || raw.kind === 'ts' ? raw.kind : null;
  if (!kind) return { ok: false, error: 'kind must be "js" or "ts"' };
  const lastCandidate = raw.last ?? null;
  if (!isCodeCellLast(lastCandidate)) {
    return { ok: false, error: 'last must be null or { columns, rows, rowCount }' };
  }
  const varsCandidate = raw.vars ?? {};
  if (!isCodeCellVars(varsCandidate)) {
    return { ok: false, error: 'vars must be an object of variable shapes' };
  }

  return {
    ok: true,
    value: {
      body: raw.body,
      kind,
      last: lastCandidate,
      vars: varsCandidate,
      maxRows: clampMaxRows(raw.maxRows),
      timeoutMs: clampCodeCellTimeout(raw.timeoutMs),
    },
  };
}

async function transpileTs(body: string): Promise<string> {
  const ts = await import('typescript');
  const out = ts.transpileModule(body, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
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

/**
 * Cells run ONLY in a worker thread. There is deliberately no in-process
 * fallback: the timeout is enforced by `worker.terminate()`, and a busy loop
 * (`while (true) {}`) on the main thread cannot be interrupted — it would wedge
 * the whole API server. The worker also runs with a scrubbed `process.env`
 * (see code-cell-thread.ts), which an in-process run would not. If the thread
 * cannot start, the cell fails closed.
 */
function runInWorkerThread(args: {
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
  timeoutMs: number;
}): Promise<CodeCellResult> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: CodeCellResult) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const failed = (detail: string) =>
      settle({
        ok: false,
        error: `Code cell sandbox unavailable: ${detail}`,
      });

    try {
      // Always register tsx so .ts worker entry loads under vitest and plain node.
      // Deduplicate if the parent already passed the same flag (tsx server).
      const execArgv = [...process.execArgv];
      if (!execArgv.some((a) => a.includes('tsx'))) {
        execArgv.push('--import', 'tsx/esm');
      }
      worker = new Worker(fileURLToPath(new URL('./code-cell-thread.ts', import.meta.url)), {
        workerData: {
          body: args.body,
          last: args.last,
          vars: args.vars,
          maxRows: args.maxRows,
        },
        execArgv,
      });
    } catch (error: unknown) {
      failed(errorMessage(error));
      return;
    }

    timer = setTimeout(() => {
      settle({
        ok: false,
        error: `Code cell timed out after ${args.timeoutMs}ms`,
      });
    }, args.timeoutMs);

    worker.on('message', (msg: CodeCellResult) => settle(msg));
    worker.on('error', (error) => {
      if (!settled) failed(errorMessage(error));
    });
    worker.on('exit', (code) => {
      // terminate() after success/timeout often exits non-zero — ignore once settled.
      if (!settled && code !== 0) failed(`worker exited with code ${code}`);
    });
  });
}

/**
 * Transpile (if needed) and execute a code cell on Node (worker_threads + timeout).
 */
export async function runCodeCellOnServer(
  validated: ValidatedCodeCell
): Promise<CodeCellResult & { durationMs: number }> {
  const started = Date.now();
  let body = validated.body;
  try {
    if (validated.kind === 'ts') {
      body = await transpileTs(body);
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: `TypeScript: ${errorMessage(error)}`,
      durationMs: Date.now() - started,
    };
  }

  const result = await runInWorkerThread({
    body,
    last: validated.last,
    vars: validated.vars,
    maxRows: validated.maxRows,
    timeoutMs: validated.timeoutMs,
  });
  return { ...result, durationMs: Date.now() - started };
}
