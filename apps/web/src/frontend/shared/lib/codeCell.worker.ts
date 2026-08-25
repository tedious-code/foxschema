/// <reference lib="webworker" />
import {
  executeCodeCell,
  type CodeCellLast,
  type CodeCellResult,
  type CodeCellVars,
} from './codeCellExec';

export type CodeCellWorkerRequest = {
  id: number;
  body: string;
  last: CodeCellLast;
  vars: CodeCellVars;
  maxRows: number;
};

export type CodeCellWorkerResponse = { id: number } & CodeCellResult;

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<CodeCellWorkerRequest>) => {
  const { id, body, last, vars, maxRows } = ev.data;
  void executeCodeCell({ body, last, vars, maxRows })
    .catch((error: unknown) => ({
      // A rejection here (import prep, structured-clone of the result) would
      // otherwise post nothing at all and leave the caller to time out with a
      // misleading "timed out" message instead of the real error.
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }))
    .then((result) => {
      ctx.postMessage({ id, ...result } satisfies CodeCellWorkerResponse);
    });
};
