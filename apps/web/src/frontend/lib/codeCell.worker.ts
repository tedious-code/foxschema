/// <reference lib="webworker" />
import {
  executeCodeCellSync,
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
  const msg = ev.data;
  const result = executeCodeCellSync({
    body: msg.body,
    last: msg.last,
    vars: msg.vars,
    maxRows: msg.maxRows,
  });
  ctx.postMessage({ id: msg.id, ...result } satisfies CodeCellWorkerResponse);
};
