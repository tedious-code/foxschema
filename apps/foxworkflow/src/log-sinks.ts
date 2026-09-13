/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Append-only log sinks under os.tmpdir()/foxworkflow-logs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorkflowLogSink } from '@foxschema/workflow-contract';

export function logsDir(): string {
  return path.join(os.tmpdir(), 'foxworkflow-logs');
}

export function ensureLogsDir(): string {
  const dir = logsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a line for each enabled json/text sink. Events sink is a no-op stub. */
export function writeSinkLines(
  sinks: WorkflowLogSink[],
  message: string,
  meta: Record<string, unknown> = {},
): void {
  const dir = ensureLogsDir();
  const ts = new Date().toISOString();
  for (const sink of sinks) {
    if (!sink.enabled) continue;
    if (sink.kind === 'events') continue;
    const file =
      sink.target && sink.target.length > 0
        ? path.isAbsolute(sink.target)
          ? sink.target
          : path.join(dir, sink.target)
        : path.join(dir, sink.kind === 'json' ? 'engine.jsonl' : 'engine.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line =
      sink.kind === 'json'
        ? `${JSON.stringify({ ts, message, ...meta })}\n`
        : `${ts} ${message}${Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : ''}\n`;
    fs.appendFileSync(file, line, 'utf8');
  }
}
