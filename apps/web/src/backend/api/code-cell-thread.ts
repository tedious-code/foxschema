/**
 * worker_threads entry for Node code cells.
 * Receives workerData, optionally proxies SQL back to the parent, and posts a
 * CodeCellResult.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { renderSqlQuery, sqlTag, isSqlQuery, type SqlQuery } from '@foxschema/core';
import { executeCodeCellNode, type CodeCellLast, type CodeCellVars } from './code-cell-node-exec';
import type { CellQueryResponse } from './code-cell-bridge';

// The AsyncFunction sandbox shadows `process` lexically, but a cell can still
// reach the real one via `(function(){}).constructor('return process')()` — the
// Function constructor compiles in global scope, so no `var` shadowing applies.
// Worker threads get their OWN copy of process.env, so emptying it here costs
// the parent nothing and denies an escaped cell the secrets it would otherwise
// read and POST out via `fetch` (APP_ENCRYPTION_KEY decrypts every saved DB
// password). Runs after imports, so nothing above has lost its config.
process.env = {};
process.argv = process.argv.slice(0, 1);

type Payload = {
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
  /** Dialect of the cell's connection — decides placeholder + quoting style. */
  dialect?: string;
  /** When false, the parent rejects write/DDL statements from `sql`. */
  allowWrites?: boolean;
};

/** In-flight bridged queries, keyed by request id. */
const pending = new Map<
  number,
  { resolve: (rows: Record<string, unknown>[]) => void; reject: (e: Error) => void }
>();
let nextQueryId = 1;

parentPort?.on('message', (msg: CellQueryResponse) => {
  if (!msg || msg.type !== 'cell-query-result') return;
  const waiter = pending.get(msg.id);
  if (!waiter) return;
  pending.delete(msg.id);
  if (msg.ok) waiter.resolve(msg.rows);
  else waiter.reject(new Error(msg.error));
});

/**
 * `sql` inside a cell. Renders the tagged template to `{ text, params }` for
 * the connection's dialect, then asks the parent to run it — the worker never
 * touches a driver itself.
 */
function makeSqlBinding(dialect: string) {
  const run = (query: SqlQuery): Promise<Record<string, unknown>[]> => {
    if (!isSqlQuery(query)) {
      return Promise.reject(
        new Error('sql`…` must be used as a tagged template: sql`SELECT 1`, not sql("SELECT 1")')
      );
    }
    if (!parentPort) return Promise.reject(new Error('No SQL bridge available in this context'));
    const { text, params } = renderSqlQuery(query, dialect);
    const id = nextQueryId++;
    return new Promise<Record<string, unknown>[]>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parentPort!.postMessage({ type: 'cell-query', id, text, params });
    });
  };

  // Callable as a tag, and carrying the fragment helpers (sql.values, sql.id, …).
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    run(sqlTag(strings, ...values));
  return Object.assign(tag, {
    raw: sqlTag.raw,
    id: sqlTag.id,
    values: sqlTag.values,
    list: sqlTag.list,
    /** Escape hatch for callers holding an already-built query. */
    run,
  });
}

async function main() {
  const data = workerData as Payload;
  const result = await executeCodeCellNode({
    body: data.body,
    last: data.last,
    vars: data.vars,
    maxRows: data.maxRows,
    sql: makeSqlBinding(data.dialect ?? 'postgres'),
  });
  parentPort?.postMessage({ type: 'cell-done', result });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage({ type: 'cell-done', result: { ok: false, error: message } });
});
