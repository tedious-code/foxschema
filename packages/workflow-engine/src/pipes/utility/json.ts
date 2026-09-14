/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/utility/src/json.ts).
 */
import { createReadStream } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
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
import { rejectBatch } from './delimited.js';
import { readLines } from './text.js';

const configSchema = z.object({
  path: z.string().min(1),
  // `array` parses one JSON array; `ndjson` streams one JSON value per line;
  // `auto` peeks at the first byte (`[` → array, else ndjson).
  format: z.enum(['auto', 'array', 'ndjson']).default('auto'),
  ...batchSizeField(),
  ...recordContractFields,
  ...rejectPolicyField,
});

type Config = z.infer<typeof configSchema>;

/**
 * JSON file source: a JSON array (loaded whole — bounded by file size) or
 * NDJSON (streamed line by line). Scalars and arrays become `{value: …}` so
 * the stream stays a stream of records. A malformed NDJSON line is treated
 * exactly like a schema-invalid record: fail, skip, or dead-letter by
 * `onInvalid` — a bad line and a bad row are the same problem to a pipeline.
 */
export class JsonSourcePipe implements SourcePipe {
  readonly type = 'source.file.json';
  readonly role = 'source';

  metadata(): PipeMetadata {
    return definePipeMetadata({
      type: this.type,
      name: 'JSON file',
      category: 'Source/File',
      version: '0.1.0',
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
    configSchema.parse(config);
  }

  async *read(context: PipeContext): AsyncIterable<RecordBatch> {
    const config = configSchema.parse(context.pipe.config);
    const format =
      config.format === 'auto' ? await detectFormat(config.path) : config.format;
    yield* format === 'array'
      ? this.readArray(context, config)
      : this.readNdjson(context, config);
  }

  private async *readArray(
    context: PipeContext,
    config: Config,
  ): AsyncIterable<RecordBatch> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the source file path is this pipe's own configuration
    const parsed: unknown = JSON.parse(await readFile(config.path, 'utf8'));
    if (!Array.isArray(parsed)) {
      throw new Error(`${config.path}: expected a top-level JSON array`);
    }
    const resumeAfter = Number(context.checkpoint?.cursor.index ?? 0);
    const emitter = new BatchEmitter(context.pipe.id, config, 'index', '_index');
    for (let i = 0; i < parsed.length; i++) {
      const position = i + 1; // 1-based, matching row/line cursors
      if (position <= resumeAfter) continue;
      emitter.add(toRecord(parsed[i]), position, null);
    }
    yield* emitter.flush();
  }

  private async *readNdjson(
    context: PipeContext,
    config: Config,
  ): AsyncIterable<RecordBatch> {
    const resumeAfter = Number(context.checkpoint?.cursor.line ?? 0);
    const emitter = new BatchEmitter(context.pipe.id, config, 'line', '_line');
    let lineNumber = 0;
    for await (const line of readLines(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the source file path is this pipe's own configuration
      createReadStream(config.path, { encoding: 'utf8' }),
    )) {
      lineNumber++;
      if (lineNumber <= resumeAfter) continue;
      if (line.trim() === '') continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        emitter.add({ _raw: line }, lineNumber, (error as Error).message);
        yield* emitter.drain();
        continue;
      }
      emitter.add(toRecord(value), lineNumber, null);
      yield* emitter.drain();
    }
    yield* emitter.flush();
  }
}

/** Objects pass through; scalars/arrays/null wrap as `{value}`. */
function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value: value ?? null };
}

async function detectFormat(path: string): Promise<'array' | 'ndjson'> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the source file path is this pipe's own configuration
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const head = buffer.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, '');
    return head.trimStart().startsWith('[') ? 'array' : 'ndjson';
  } finally {
    await handle.close();
  }
}

/**
 * Shared batching/validation for both JSON layouts: validates each record,
 * applies onInvalid, and cuts data batches (with a cursor) and reject batches
 * (cursor-less, `rejects` port) at `batchSize`.
 */
class BatchEmitter {
  private records: Record<string, unknown>[] = [];
  private first = 0;
  private last = 0;
  private rejects: Record<string, unknown>[] = [];
  private firstReject = 0;
  private lastReject = 0;
  private pending: RecordBatch[] = [];

  constructor(
    private readonly pipeId: string,
    private readonly config: Config,
    private readonly cursorKey: 'index' | 'line',
    private readonly positionKey: '_index' | '_line',
  ) {}

  /** `parseError` marks records that never parsed (NDJSON bad lines). */
  add(
    record: Record<string, unknown>,
    position: number,
    parseError: string | null,
  ): void {
    const message =
      parseError ??
      (this.config.schema
        ? validateAgainstSchema(this.config.schema, record)
        : null);
    if (message !== null) {
      if (this.config.onInvalid === 'fail') {
        throw new Error(
          `${this.cursorKey} ${position} failed ${parseError ? 'to parse' : 'schema'}: ${message}`,
        );
      }
      if (this.config.onInvalid === 'reject') {
        if (this.rejects.length === 0) this.firstReject = position;
        this.lastReject = position;
        this.rejects.push({
          ...record,
          _error: message,
          [this.positionKey]: position,
        });
        if (this.rejects.length === this.config.batchSize) {
          this.pending.push(
            rejectBatch(this.pipeId, this.firstReject, this.lastReject, this.rejects),
          );
          this.rejects = [];
        }
      }
      return;
    }
    if (this.records.length === 0) this.first = position;
    this.last = position;
    this.records.push(record);
    if (this.records.length === this.config.batchSize) {
      this.pending.push(this.dataBatch());
      this.records = [];
    }
  }

  /** Batches that became full since the last call. */
  *drain(): Iterable<RecordBatch> {
    yield* this.pending.splice(0);
  }

  /** Everything left: rejects first, then the final (cursor-bearing) batch. */
  *flush(): Iterable<RecordBatch> {
    yield* this.drain();
    if (this.rejects.length > 0) {
      yield rejectBatch(this.pipeId, this.firstReject, this.lastReject, this.rejects);
      this.rejects = [];
    }
    if (this.records.length > 0) {
      yield this.dataBatch();
      this.records = [];
    }
  }

  private dataBatch(): RecordBatch {
    return {
      id: `${this.pipeId}:0:${this.first}-${this.last}`,
      partitionId: '0',
      records: this.records,
      cursor: { [this.cursorKey]: this.last },
    };
  }
}
