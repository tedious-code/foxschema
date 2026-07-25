/**
 * worker_threads entry for Node code cells.
 * Receives workerData and posts a CodeCellResult.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { executeCodeCellNode, type CodeCellLast, type CodeCellVars } from './code-cell-node-exec';

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
};

async function main() {
  const data = workerData as Payload;
  const result = await executeCodeCellNode(data);
  parentPort?.postMessage(result);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  parentPort?.postMessage({ ok: false, error: message });
});
