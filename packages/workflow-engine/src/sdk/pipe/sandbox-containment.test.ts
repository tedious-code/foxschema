/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/sdk/src/pipe/sandbox-containment.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { runSandboxed } from './sandbox.js';

/**
 * What the sandbox actually guarantees against hostile transform code.
 *
 * These are adversarial on purpose. A workflow — including one an agent wrote —
 * is data submitted through the API, so `transform.script` is remote code
 * execution by design and the only question is what it can reach.
 *
 * The tests are written against the *escape*, not the naive call: hostile code
 * recovers the real `process` through `Function('return process')()` in one
 * line, so any guarantee that only holds for a direct reference is worthless.
 * Everything asserted below survives that escape.
 */

const ESCAPE = "(function(){}).constructor('return process')()";

async function attempt(body: string): Promise<string> {
  const result = (await runSandboxed(body, [], { timeoutMs: 5000 })) as {
    v: string;
  }[];
  return String(result[0]?.v);
}

describe('sandbox containment', () => {
  it('denies spawning a process, even after the scope escape', async () => {
    // The primitive that turns "runs your JS" into "owns your host". Denied by
    // Node's permission model, so recovering `require` does not help.
    const verdict = await attempt(`
      try {
        const req = (function(){}).constructor('return require')();
        const cp = req('child_process');
        return [{ v: 'SPAWNED ' + cp.execSync('echo pwned').toString().trim() }];
      } catch (error) {
        return [{ v: 'blocked:' + (error.code || error.message) }];
      }
    `);

    expect(verdict).toContain('blocked:');
    expect(verdict).toContain('ERR_ACCESS_DENIED');
  });

  it('keeps the host environment out of reach, including the encryption key', async () => {
    process.env.FOXFLOW_ENCRYPTION_KEY = 'must-never-be-readable';

    const verdict = await attempt(`
      const p = ${ESCAPE};
      const leaked = Object.keys(p.env).filter((k) => k.startsWith('FOXFLOW'));
      return [{ v: 'foxflow=' + leaked.length + ' key=' + String(p.env.FOXFLOW_ENCRYPTION_KEY) }];
    `);

    // Started with an empty env, so there is nothing to read even holding the
    // real `process`. Asserted by what leaked rather than by an exact count:
    // the OS adds its own entries (macOS injects a locale variable), and a
    // count would fail on one platform for a reason that is not about secrets.
    expect(verdict).toBe('foxflow=0 key=undefined');
  });

  it('takes the network globals away from a direct reference', async () => {
    const verdict = await attempt(
      "return [{ v: [typeof fetch, typeof WebSocket, typeof XMLHttpRequest].join(',') }]",
    );

    expect(verdict).toBe('undefined,undefined,undefined');
  });

  it('terminates a synchronous infinite loop', async () => {
    // The failure no in-process mechanism can handle: a busy loop blocks the
    // event loop, so the timer meant to save you never fires.
    await expect(
      runSandboxed('while (true) {}', [], { timeoutMs: 300 }),
    ).rejects.toThrow(/exceeded its 300ms budget/);
  });

  it('contains runaway allocation in the worker, not the host', async () => {
    await expect(
      runSandboxed(
        'const held = []; while (true) { held.push(new Array(1e6).fill(0)); } ',
        [],
        { timeoutMs: 10_000, maxOldGenerationSizeMb: 32 },
      ),
    ).rejects.toThrow();
  });

  it('still runs ordinary transform code', async () => {
    const result = await runSandboxed(
      'return records.map((r) => ({ n: r.n * 2 }))',
      [{ n: 21 }],
      { timeoutMs: 2000 },
    );

    expect(result).toEqual([{ n: 42 }]);
  });

  it('denies the filesystem, even after the scope escape', async () => {
    // This test used to assert the opposite. A worker inherits the parent's
    // filesystem grant, so it could never be more restricted than the engine
    // that spawned it; a *process* starts with nothing granted, which is why
    // that is now the default isolation.
    const verdict = await attempt(`
      try {
        const req = (function(){}).constructor('return require')();
        return [{ v: 'readable:' + req('fs').readFileSync('package.json', 'utf8').length }];
      } catch (error) {
        return [{ v: 'blocked:' + (error.code || error.message) }];
      }
    `);

    expect(verdict).toContain('blocked:');
    expect(verdict).toContain('ERR_ACCESS_DENIED');
  });

  it('names the weaker guarantee of thread isolation honestly', async () => {
    // `thread` trades the filesystem boundary for speed — no process spawn per
    // call. It is opt-in, and this pins what opting in actually costs so the
    // difference cannot quietly become untrue in either direction.
    const result = (await runSandboxed(
      `try {
        const req = (function(){}).constructor('return require')();
        return [{ v: 'readable:' + req('fs').readFileSync('package.json', 'utf8').length }];
      } catch (error) {
        return [{ v: 'blocked:' + (error.code || error.message) }];
      }`,
      [],
      { timeoutMs: 5000, isolation: 'thread' },
    )) as { v: string }[];

    expect(result[0]?.v).toContain('readable:');
  });
});
