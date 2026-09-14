/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/text.ts).
 */
import { createReadStream } from 'node:fs';
import * as z from 'zod';
import type {
  PipeContext,
  RecordBatch,
  SourcePipe,
} from '../../registry/index.js';
import {
  REJECTS_PORT,
  batchSizeField,
  definePipeMetadata,
  recordContractFields,
  rejectPolicyField,
  type PipeMetadata,
} from '../../sdk/index.js';
import { validateAgainstSchema } from '../../common/index.js';
import {
  applyColumnRules,
  columnRuleFieldsSchema,
  columnRules,
  compileColumnRules,
  configuredNames,
  describeFailures,
  isHeaderRecord,
  parseLine,
  rejectBatch,
} from './delimited.js';

/**
 * The field shape, exported without the cross-field `.refine()` so callers
 * that need a variant (the designer's preview endpoint parses a config whose
 * `path` is optional, because the sample may be pasted inline) can build one
 * instead of restating every field.
 */
export const textConfigFields = z
  .object({
    path: z.string().min(1),
    // Physical lines to skip from the top (report preambles).
    offset: z.number().int().min(0).default(0),
    // `delimited` splits on delimiters; `fixed` slices positional columns.
    format: z.enum(['delimited', 'fixed']).default('delimited'),
    // Any of these splits a value; multi-character delimiters allowed.
    delimiters: z.array(z.string().min(1)).default([]),
    // Optional: splits one line into several records before field splitting.
    recordDelimiter: z.string().min(1).optional(),
    // Positional field names; positions beyond the list become field_N.
    fields: z.array(z.string().min(1)).default([]),
    // Fixed-width layout (1-based start), required when format is `fixed`.
    // Each column may declare a type plus multi-regex checks (null / length /
    // format) — validated and converted before the whole-record schema runs.
    columns: z
      .array(
        z.object({
          name: z.string().min(1),
          start: z.number().int().min(1),
          length: z.number().int().min(1),
          ...columnRuleFieldsSchema,
        }),
      )
      .default([]),
    // Same per-field rules for `delimited` format, matched to fields by name.
    rules: z
      .array(
        z.object({
          name: z.string().min(1),
          ...columnRuleFieldsSchema,
        }),
      )
      .default([]),
    // First content line: keep, always skip, or drop only when it names the
    // configured columns (feeds that sometimes ship a header, sometimes not).
    header: z.enum(['none', 'skip', 'auto']).default('none'),
    trim: z.boolean().default(true),
    skipEmpty: z.boolean().default(true),
    ...batchSizeField(),
    ...recordContractFields,
    ...rejectPolicyField,
  });

/**
 * `delimited` needs delimiters, `fixed` needs columns — a cross-field rule, so
 * it is applied on top of the fields rather than inside them. Exported so the
 * preview endpoint enforces the same rule it would hit at run time.
 */
export const textFormatRefine = {
  check: (config: { format: string; columns: unknown[]; delimiters: unknown[] }) =>
    config.format === 'fixed'
      ? config.columns.length > 0
      : config.delimiters.length > 0,
  message: 'delimited format needs delimiters; fixed format needs columns',
};

const configSchema = textConfigFields.refine(textFormatRefine.check, {
  message: textFormatRefine.message,
});

/**
 * Line-oriented text source. Two formats: `delimited` splits each line on an
 * optional record delimiter (flat map — one line can yield many records) then
 * on any configured field delimiter; `fixed` slices positional columns
 * (mainframe-style flat files). Optional header handling for feeds that
 * sometimes ship a header line. No CSV quoting rules.
 */
export class TextSourcePipe implements SourcePipe {
  readonly type = 'source.file.text';
  readonly role = 'source';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'Text file',
      category: 'Source/File',
      version: '0.4.0',
      role: 'source',
      inputs: [],
      outputs: [
        { name: 'out', type: 'records' },
        { name: REJECTS_PORT, type: 'records' },
      ],
      configSchema,
    });
  }

  validateConfig(config: Record<string, unknown>): void {
    const parsed = configSchema.parse(config);
    // Fail fast on malformed regexes (config error) before a run starts.
    compileColumnRules(columnRules(parsed));
  }

  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    const config = configSchema.parse(context.pipe.config);
    const resumeAfter = Number(context.checkpoint?.cursor.line ?? 0);
    let lineNumber = 0;
    let records: Record<string, unknown>[] = [];
    let firstLine = 0;
    let rejects: Record<string, unknown>[] = [];
    let firstReject = 0;
    let lastReject = 0;
    const rules = columnRules(config);
    const compiled = compileColumnRules(rules);
    // A resumed run's cursor is always past the header — it was handled (or
    // absent) in the run that wrote the checkpoint.
    let headerDone = config.header === 'none' || resumeAfter > 0;

    for await (const line of readLines(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the source file path is this pipe's own configuration
      createReadStream(config.path, { encoding: 'utf8' }),
    )) {
      lineNumber++;
      if (lineNumber <= config.offset) continue;
      if (lineNumber <= resumeAfter) continue;
      if (config.skipEmpty && line.trim() === '') continue;

      const parsed = parseLine(line, config);
      if (!headerDone) {
        headerDone = true;
        if (config.header === 'skip') continue;
        if (parsed[0] && isHeaderRecord(parsed[0], configuredNames(config))) {
          continue;
        }
      }

      for (const raw of parsed) {
        // Column rules run first: they convert text into typed values, so the
        // whole-record schema sees numbers/booleans rather than strings.
        const applied = applyColumnRules(raw, rules, compiled);
        const record = applied.record;
        const columnError =
          applied.failures.length > 0
            ? describeFailures(applied.failures)
            : null;
        if (columnError !== null) {
          if (config.onInvalid === 'fail') {
            throw new Error(`line ${lineNumber} failed validation: ${columnError}`);
          }
          if (config.onInvalid === 'reject') {
            if (rejects.length === 0) firstReject = lineNumber;
            lastReject = lineNumber;
            rejects.push({ ...raw, _error: columnError, _line: lineNumber });
          }
          continue;
        }
        if (config.schema) {
          const message = validateAgainstSchema(config.schema, record);
          if (message !== null) {
            if (config.onInvalid === 'fail') {
              throw new Error(`line ${lineNumber} failed schema: ${message}`);
            }
            if (config.onInvalid === 'reject') {
              if (rejects.length === 0) firstReject = lineNumber;
              lastReject = lineNumber;
              rejects.push({ ...record, _error: message, _line: lineNumber });
            }
            continue; // skip/reject — the row leaves the data stream either way
          }
        }
        if (records.length === 0) firstLine = lineNumber;
        records.push(record);
      }
      // Cut batches only at line boundaries so the line cursor stays exact —
      // a flat-mapped line is never split across two batches.
      if (rejects.length >= config.batchSize) {
        yield rejectBatch(context.pipe.id, firstReject, lastReject, rejects);
        rejects = [];
      }
      if (records.length >= config.batchSize) {
        yield makeBatch(context.pipe.id, firstLine, lineNumber, records);
        records = [];
      }
    }
    // Rejects flush before the final data batch — checkpoints only ever come
    // from data cursors, so everything emitted is covered by the last one.
    if (rejects.length > 0) {
      yield rejectBatch(context.pipe.id, firstReject, lastReject, rejects);
    }
    if (records.length > 0) {
      yield makeBatch(context.pipe.id, firstLine, lineNumber, records);
    }
  }
}

function makeBatch(
  pipeId: string,
  firstLine: number,
  lastLine: number,
  records: Record<string, unknown>[],
): RecordBatch {
  return {
    id: `${pipeId}:0:${firstLine}-${lastLine}`,
    partitionId: '0',
    records,
    cursor: { line: lastLine },
  };
}

export async function* readLines(
  chunks: AsyncIterable<string | Buffer>,
): AsyncIterable<string> {
  let buffer = '';
  for await (const chunk of chunks) {
    buffer += String(chunk);
    let index: number;
    while ((index = buffer.indexOf('\n')) !== -1) {
      yield buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
    }
  }
  if (buffer.length > 0) yield buffer.replace(/\r$/, '');
}
