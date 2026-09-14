/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/sandbox.ts).
 */
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';

/**
 * Runs untrusted transform code on its own thread, with a deadline enforced by
 * killing the thread.
 *
 * `pipe.timeoutMs` bounds work that yields to the event loop, which covers a
 * stuck request or query. It cannot touch a synchronous busy loop: JavaScript
 * runs one thing at a time, so `while (true) {}` inside a pipe freezes the
 * event loop and *every other run on the instance* stops — timers included, so
 * the timeout that was supposed to save you never fires either. Nothing on that
 * thread can help. The only fix is for the code to be somewhere the host can
 * terminate.
 *
 * This is the execution path for code the engine did not write: plugin pipes
 * and user-authored expressions. Built-in pipes stay in-process — the boundary
 * costs a thread and a structured-clone per call, which is not worth paying to
 * protect the engine from itself.
 *
 * Contained, and pinned by `sandbox-containment.test.ts` against code that
 * escapes the scope via `Function('return require')()` — a guarantee that only
 * holds for a direct reference is worth nothing:
 *
 *  - **The filesystem.** Denied outright: the child starts under
 *    `--permission` with no `--allow-fs-*`, so a read fails with
 *    ERR_ACCESS_DENIED at the runtime level.
 *  - **Spawning a process.** Denied by the same mechanism.
 *  - **The host environment.** Started with `env: {}`, so `process.env` holds
 *    nothing of ours even with the real `process` in hand — the encryption key
 *    is not readable.
 *  - **Infinite loops** and **runaway allocation**: killed on the deadline, or
 *    the child hits its own heap cap and dies alone.
 *  - Network globals (`fetch`, `WebSocket`, …) are deleted and shadowed —
 *    the one capability the permission model does not cover.
 *
 * A *thread* could never achieve the first of those: Node grants a worker its
 * parent's filesystem access, so a worker can never be more restricted than
 * the engine that spawned it. Only a fresh process starts with nothing.
 *
 * The boundary costs ~12ms per call against a thread (28ms vs 16ms for 1,000
 * records). `isolation: 'thread'` remains available for code you would have
 * been willing to run in-process anyway, and its weaker guarantee is pinned by
 * a test rather than left to a comment.
 */

export class SandboxTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`sandboxed code exceeded its ${timeoutMs}ms budget and was terminated`);
    this.name = 'SandboxTimeoutError';
  }
}

export class SandboxError extends Error {
  constructor(message: string) {
    super(`sandboxed code failed: ${message}`);
    this.name = 'SandboxError';
  }
}

export interface SandboxOptions {
  /** Hard budget. The thread or process is killed when it elapses. */
  timeoutMs: number;
  /**
   * `process` is the default and the only setting that actually denies the
   * filesystem: Node's permission model grants fs to a worker from its parent,
   * so a thread can never be more restricted than the engine that spawned it.
   * A fresh process starts with nothing granted.
   *
   * `thread` is the faster path (no process spawn per call) and keeps every
   * other guarantee — spawning, the host environment, timeouts, memory. Choose
   * it only for code you would have been willing to run in-process anyway.
   */
  isolation?: 'process' | 'thread';
  /** Heap cap in MB, so runaway allocation dies in the worker, not the host. */
  maxOldGenerationSizeMb?: number;
}

/**
 * The worker body. Kept as a string rather than a separate file so the runtime
 * package has no build-order dependency on an emitted worker artifact — this
 * has to work identically under `tsx`, under vitest, and from compiled output.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');

// Captured before the scrub below, because afterwards there is deliberately no
// way to ask for any of it again.
const post = parentPort.postMessage.bind(parentPort);

/**
 * Take the host away before compiling anything.
 *
 * A worker shares the process's filesystem, network and module loader, so "it
 * runs on another thread" is not by itself a boundary: transform code could
 * read the SQLite file holding encrypted credentials, POST it somewhere, or
 * shell out. Deleting the globals and shadowing the same names as parameters
 * means a direct reference resolves to undefined instead of climbing the scope
 * chain to the real one.
 */
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'WebAssembly', 'navigator']) {
  try { delete globalThis[name]; } catch (error) { /* non-configurable: the shadow below still covers it */ }
}

try {
  // Compiled here, inside the worker, so even a malicious *parse* stays off the
  // host thread. The extra parameters shadow the host's own bindings.
  const fn = new Function(
    'records',
    'require', 'process', 'module', 'exports', 'globalThis', 'fetch', 'Worker', 'WebAssembly',
    '"use strict";' + workerData.body,
  );
  const result = fn(workerData.records);
  post({ ok: true, result });
} catch (error) {
  post({ ok: false, message: String(error && error.message || error) });
}
`;

/**
 * The child-process body. Reads `{body, records}` as JSON on stdin and writes
 * one JSON result to stdout, because with the filesystem denied there is no
 * temp file to hand data through.
 */
const PROCESS_SOURCE = `
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let out;
  try {
    const payload = JSON.parse(input);
    // Network is the one capability the permission model does not cover, so it
    // is taken away by name. fs and child_process are already denied by
    // --permission and cannot be recovered by any scope trick.
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator']) {
      try { delete globalThis[name]; } catch (error) { /* shadowed below */ }
    }
    const fn = new Function(
      'records',
      'require', 'process', 'module', 'exports', 'globalThis', 'fetch',
      '"use strict";' + payload.body,
    );
    out = { ok: true, result: fn(payload.records) };
  } catch (error) {
    out = { ok: false, message: String((error && error.message) || error) };
  }
  process.stdout.write(JSON.stringify(out));
});
`;

/**
 * Run untrusted code in its own process, with nothing granted.
 *
 * This is what makes the boundary a boundary rather than a blast radius: the
 * child is started under `--permission` with no `--allow-fs-*`, so reading a
 * file fails with ERR_ACCESS_DENIED at the runtime level — including for code
 * that recovers `require` through `Function('return require')()`.
 */
async function runInProcess(
  body: string,
  records: Record<string, unknown>[],
  options: SandboxOptions,
): Promise<unknown> {
  const child = spawn(
    process.execPath,
    [
      '--permission',
      `--max-old-space-size=${options.maxOldGenerationSizeMb ?? 128}`,
      '-e',
      PROCESS_SOURCE,
    ],
    { env: {}, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });

  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
  timer.unref?.();

  try {
    child.stdin.end(JSON.stringify({ body, records }));
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    if (code !== 0 || stdout.length === 0) {
      // Killed by us, or by the heap cap — either way the caller gets an error
      // rather than a hang or a silently empty batch.
      if (child.killed) throw new SandboxTimeoutError(options.timeoutMs);
      throw new SandboxError(stderr.trim() || `sandbox exited with code ${code}`);
    }

    const message = JSON.parse(stdout) as {
      ok: boolean;
      result?: unknown;
      message?: string;
    };
    if (!message.ok) throw new SandboxError(message.message ?? 'unknown error');
    return message.result;
  } finally {
    clearTimeout(timer);
    if (!child.killed) child.kill('SIGKILL');
  }
}

/**
 * Run `body` — a function body receiving `records` and returning a value — in
 * isolation, killing it if it overruns.
 */
export async function runSandboxed(
  body: string,
  records: Record<string, unknown>[],
  options: SandboxOptions,
): Promise<unknown> {
  if ((options.isolation ?? 'process') === 'process') {
    return runInProcess(body, records, options);
  }
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { body, records },
    resourceLimits: {
      maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 128,
    },
    // A sandboxed pipe has no business reading the host's environment.
    env: {},
    // Node's permission model, enforced by the runtime rather than by taking
    // names away: `child_process` is denied outright, which no amount of scope
    // shadowing could guarantee and which is the primitive worth denying most.
    execArgv: ['--permission'],
    stdout: true,
    stderr: true,
  });

  let timer: NodeJS.Timeout | undefined;
  try {
    return await new Promise<unknown>((resolve, reject) => {
      timer = setTimeout(() => {
        // terminate() is the whole point: it stops a thread that is not
        // yielding, which no in-process mechanism can do.
        void worker.terminate();
        reject(new SandboxTimeoutError(options.timeoutMs));
      }, options.timeoutMs);
      timer.unref?.();

      worker.once('message', (message: { ok: boolean; result?: unknown; message?: string }) => {
        if (message.ok) resolve(message.result);
        else reject(new SandboxError(message.message ?? 'unknown error'));
      });
      worker.once('error', (error: Error) => reject(new SandboxError(error.message)));
      worker.once('exit', (code) => {
        // Exit without a message means it was killed — by us, or by the heap
        // cap. Either way the caller gets an error rather than a hang.
        if (code !== 0) {
          reject(new SandboxError(`worker exited with code ${code}`));
        }
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    await worker.terminate();
  }
}
