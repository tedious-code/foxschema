/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/file-sink.ts).
 */
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { PipeContext, RecordBatch, SinkPipe } from '../../registry/index.js';
import { definePipeMetadata, type PipeMetadata } from '../../sdk/index.js';

/**
 * Write records to a delimited file.
 *
 * FoxAgent could read CSV and never write it, which is a strange gap the moment
 * the user is a team that lives in spreadsheets: they can feed a workflow from
 * an export, but the result has nowhere to land except a database, an HTTP
 * endpoint, or an email. This is the other half.
 *
 * `append` is the default because the shape of the job is usually daily: one
 * file per week or per campaign that grows a few rows at a time and gets opened
 * in Excel at the end. Overwriting by default would silently destroy yesterday
 * on the first scheduled run.
 */

const configSchema = z.object({
  path: z.string().min(1),
  /**
   * Column order, explicit. Deriving it from the first record would make the
   * file's shape depend on which row happened to arrive first, and a
   * spreadsheet whose columns move between runs is worse than no file.
   */
  columns: z.array(z.string().min(1)).min(1),
  delimiter: z.string().min(1).max(4).default(','),
  /** Written once, when the file is created — never in the middle. */
  header: z.boolean().default(true),
  mode: z.enum(['append', 'overwrite']).default('append'),
  /** Line ending. CRLF is what Excel on Windows expects. */
  newline: z.enum(['\n', '\r\n']).default('\n'),
});

export type FileSinkConfig = z.infer<typeof configSchema>;

/**
 * Quote a field the way RFC 4180 says, which is also what spreadsheets expect.
 *
 * A value containing the delimiter, a quote, or a newline must be quoted, and
 * quotes inside are doubled. Getting this wrong does not throw — it produces a
 * file that opens with the columns silently shifted, which is the kind of bug
 * someone finds a month later in a report.
 */
export function escapeField(
  value: unknown,
  delimiter: string,
  newline: string,
): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  const mustQuote =
    text.includes(delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r') ||
    text.includes(newline);
  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toRow(
  record: Record<string, unknown>,
  config: FileSinkConfig,
): string {
  return config.columns
    .map((column) => escapeField(record[column], config.delimiter, config.newline))
    .join(config.delimiter);
}

export class FileSinkPipe implements SinkPipe {
  readonly type = 'sink.file.delimited';
  readonly role = 'sink' as const;

  /**
   * Which paths this run has already opened. A sink is called once per batch,
   * and the header belongs to the file, not the batch — without this a
   * multi-batch run writes a header line between every chunk.
   */
  private readonly started = new Set<string>();

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Write CSV file',
      category: 'Sink/File',
      family: 'file',
      tags: ['csv', 'export', 'spreadsheet'],
      version: '0.1.0',
      role: 'sink',
      // Writes to the filesystem: a dry run must not touch it.
      sideEffects: true,
      inputs: [{ name: 'in', type: 'records' }],
      outputs: [],
      configSchema: {
        type: 'object',
        required: ['path', 'columns'],
        properties: {
          path: { type: 'string', minLength: 1 },
          columns: { type: 'array', items: { type: 'string' }, minItems: 1 },
          delimiter: { type: 'string', default: ',' },
          header: { type: 'boolean', default: true },
          mode: { type: 'string', enum: ['append', 'overwrite'], default: 'append' },
          newline: { type: 'string', enum: ['\n', '\r\n'], default: '\n' },
        },
      },
    });
  }

  validateConfig(config: unknown): void {
    configSchema.parse(config);
  }

  async write(batch: RecordBatch, context: PipeContext): Promise<void> {
    const config = configSchema.parse(context.pipe.config);
    if (batch.records.length === 0) return;

    const key = `${context.workflowRunId}:${config.path}`;
    const first = !this.started.has(key);
    if (first) this.started.add(key);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target path is this sink's own configuration
    await mkdir(dirname(config.path), { recursive: true });

    const body =
      batch.records.map((record) => toRow(record, config)).join(config.newline) +
      config.newline;

    // Overwrite truncates once per run, not once per batch — otherwise batch
    // two erases batch one and the file only ever holds the last chunk.
    if (first && config.mode === 'overwrite') {
      const header = config.header
        ? config.columns
            .map((column) => escapeField(column, config.delimiter, config.newline))
            .join(config.delimiter) + config.newline
        : '';
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target path is this sink's own configuration
      await writeFile(config.path, header + body, 'utf8');
      return;
    }

    if (first && config.header && (await isEmpty(config.path))) {
      // Appending to a file that does not exist yet still needs its header;
      // appending to one that already has rows must not get a second.
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target path is this sink's own configuration
      await appendFile(
        config.path,
        config.columns
          .map((column) => escapeField(column, config.delimiter, config.newline))
          .join(config.delimiter) + config.newline,
        'utf8',
      );
    }
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target path is this sink's own configuration
    await appendFile(config.path, body, 'utf8');
  }
}

async function isEmpty(path: string): Promise<boolean> {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the target path is this sink's own configuration
    return (await stat(path)).size === 0;
  } catch {
    return true; // does not exist yet
  }
}
