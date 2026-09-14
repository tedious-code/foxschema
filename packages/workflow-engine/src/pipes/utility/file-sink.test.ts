/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/file-sink.test.ts).
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSinkPipe, escapeField } from './file-sink.js';
import type { PipeContext, RecordBatch } from '../../registry/index.js';

/**
 * Writing a spreadsheet is one of those jobs where a bug does not throw — it
 * produces a file that opens with the columns quietly shifted, and someone
 * finds it a month later in a report. So the escaping cases get their own
 * tests, and the file-level behaviour is checked by reading the bytes back.
 */

function contextFor(config: unknown, runId = 'run-1'): PipeContext {
  return {
    workflowRunId: runId,
    pipelineId: 'main',
    pipe: { id: 'out', type: 'sink.file.delimited', role: 'sink', config },
  } as never;
}

function batch(records: Record<string, unknown>[]): RecordBatch {
  return { records } as never;
}

async function tempPath(name = 'out.csv'): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'foxflow-sink-')), name);
}

describe('escaping a field', () => {
  it('quotes a value containing the delimiter', () => {
    // Unquoted, "Acme, Inc" becomes two columns and every later column shifts.
    expect(escapeField('Acme, Inc', ',', '\n')).toBe('"Acme, Inc"');
  });

  it('doubles embedded quotes rather than escaping them with a backslash', () => {
    // RFC 4180, which is what spreadsheets actually implement.
    expect(escapeField('He said "no"', ',', '\n')).toBe('"He said ""no"""');
  });

  it('quotes a value containing a newline', () => {
    // A call note with a line break would otherwise end the row early.
    expect(escapeField('line one\nline two', ',', '\n')).toBe(
      '"line one\nline two"',
    );
  });

  it('writes an empty cell for null and undefined, not the words', () => {
    expect(escapeField(null, ',', '\n')).toBe('');
    expect(escapeField(undefined, ',', '\n')).toBe('');
  });

  it('leaves an ordinary value alone', () => {
    expect(escapeField('Acme Inc', ',', '\n')).toBe('Acme Inc');
  });
});

describe('writing the file', () => {
  const config = (path: string, extra: Record<string, unknown> = {}) => ({
    path,
    columns: ['name', 'outcome'],
    ...extra,
  });

  it('writes a header and the rows, in declared column order', async () => {
    const path = await tempPath();
    const sink = new FileSinkPipe();

    await sink.write(
      // Deliberately reversed key order: the file must follow `columns`, not
      // whatever order the record's keys happen to be in.
      batch([{ outcome: 'callback', name: 'Dana' }]),
      contextFor(config(path)),
    );

    expect(await readFile(path, 'utf8')).toBe('name,outcome\nDana,callback\n');
  });

  it('appends across batches without repeating the header', async () => {
    const path = await tempPath();
    const sink = new FileSinkPipe();
    const ctx = contextFor(config(path));

    await sink.write(batch([{ name: 'Dana', outcome: 'sold' }]), ctx);
    await sink.write(batch([{ name: 'Ali', outcome: 'no answer' }]), ctx);

    // A sink is invoked once per batch; the header belongs to the file.
    expect(await readFile(path, 'utf8')).toBe(
      'name,outcome\nDana,sold\nAli,no answer\n',
    );
  });

  it('adds to yesterday rather than replacing it', async () => {
    const path = await tempPath();
    await writeFile(path, 'name,outcome\nOld,sold\n', 'utf8');

    await new FileSinkPipe().write(
      batch([{ name: 'Dana', outcome: 'callback' }]),
      contextFor(config(path)),
    );

    // The default is append precisely so the first scheduled run does not
    // silently destroy the previous day's file.
    expect(await readFile(path, 'utf8')).toBe(
      'name,outcome\nOld,sold\nDana,callback\n',
    );
  });

  it('truncates once per run when overwriting, not once per batch', async () => {
    const path = await tempPath();
    const sink = new FileSinkPipe();
    const ctx = contextFor(config(path, { mode: 'overwrite' }));

    await sink.write(batch([{ name: 'Dana', outcome: 'sold' }]), ctx);
    await sink.write(batch([{ name: 'Ali', outcome: 'callback' }]), ctx);

    // Truncating per batch would leave only the final chunk on disk.
    expect(await readFile(path, 'utf8')).toBe(
      'name,outcome\nDana,sold\nAli,callback\n',
    );
  });

  it('creates the directory rather than failing on a missing folder', async () => {
    const path = join(await tempPath('nested'), 'deep', 'out.csv');

    await new FileSinkPipe().write(
      batch([{ name: 'Dana', outcome: 'sold' }]),
      contextFor(config(path)),
    );

    expect(await readFile(path, 'utf8')).toContain('Dana,sold');
  });

  it('writes nothing at all for an empty batch', async () => {
    const path = await tempPath();

    // A header-only file for a day with no calls looks like data loss when
    // someone opens it; no rows means no file.
    await new FileSinkPipe().write(batch([]), contextFor(config(path)));

    await expect(readFile(path, 'utf8')).rejects.toThrow();
  });
});
