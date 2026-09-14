/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sandboxed code logs through a console that collects lines for the run,
 * in both isolation modes.
 */
import { describe, expect, it } from 'vitest';
import { runSandboxedWithLogs, SandboxError } from './sandbox.js';

describe.each(['process', 'thread'] as const)('sandbox console (%s isolation)', (isolation) => {
  it('collects what the code logs, with levels', async () => {
    const outcome = await runSandboxedWithLogs(
      'console.log("rows", records.length); console.warn({ slow: true }); console.error("bad row"); return records;',
      [{ id: 1 }],
      { timeoutMs: 10_000, isolation },
    );
    expect(outcome.result).toEqual([{ id: 1 }]);
    expect(outcome.logs).toEqual([
      { level: 'info', message: 'rows 1' },
      { level: 'warn', message: '{"slow":true}' },
      { level: 'error', message: 'bad row' },
    ]);
  });

  it('keeps the lines logged before the code threw', async () => {
    const error = await runSandboxedWithLogs(
      'console.log("about to fail"); throw new Error("nope");',
      [],
      { timeoutMs: 10_000, isolation },
    ).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SandboxError);
    expect((error as SandboxError).logs).toEqual([{ level: 'info', message: 'about to fail' }]);
  });

  it('caps how many lines, and how long each, a script can log', async () => {
    const outcome = await runSandboxedWithLogs(
      'for (let i = 0; i < 1000; i++) console.log("x".repeat(5000)); return [];',
      [],
      { timeoutMs: 10_000, isolation },
    );
    expect(outcome.logs).toHaveLength(100);
    expect(outcome.logs[0]!.message).toHaveLength(2_000);
  });
});
