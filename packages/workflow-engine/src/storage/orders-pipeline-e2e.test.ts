/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/orders-pipeline-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine, parseWorkflow, type WorkflowDef } from '../index.js';

/**
 * The `demo-orders-pipeline` shape end-to-end: three source formats ingested
 * in parallel (CSV / NDJSON / fixed-width), each dead-lettering bad rows out
 * its `rejects` port, then dependent pipelines that branch, partition, and
 * reconcile. This is the integration test for "a realistic import", exercising
 * wave scheduling, named ports, column rules and reject routing together.
 */

const cleanup: string[] = [];
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'foxflow-orders-'));
  cleanup.push(directory);
  await writeFile(
    join(directory, 'customers.csv'),
    [
      'customer_id,email,tier,country',
      '1001,ada@example.com,gold,CA',
      '1002,grace@example.com,silver,US',
      '1003,not-an-email,gold,CA',
      '1004,linus@example.com,bronze,DE',
      '1005,alice@example.com,gold,US',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(directory, 'orders.ndjson'),
    [
      '{"order_id":5001,"customer_id":1001,"amount":250.00,"status":"paid"}',
      '{"order_id":5002,"customer_id":1002,"amount":75.50,"status":"paid"}',
      '{"order_id":5003,"customer_id":1001,"amount":19.99,"status":"refunded"}',
      'not valid json at all',
      '{"order_id":5004,"customer_id":1005,"amount":540.00,"status":"paid"}',
      '{"order_id":5005,"customer_id":1004,"amount":12.00,"status":"pending"}',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(directory, 'shipments.txt'),
    [
      'ORDERID   CARRIERTRACKING            SHIPDATE',
      '5001      UPS    1Z999AA10123456784  20260715',
      '5002      FEDEX  7712 3456 7890      20260716',
      '5004      UPS    1Z999AA10123456999  20260718',
      'XXXX      BADCO  ------------------  99999999',
      '',
    ].join('\n'),
  );
});

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true })));
});

function engineFor(): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'orders-e2e',
  });
}

const CUSTOMER_SCHEMA = {
  type: 'object',
  required: ['customer_id', 'email'],
  properties: {
    customer_id: { type: 'string', pattern: '^\\d{4}$' },
    email: { type: 'string', pattern: '^\\S+@\\S+$' },
    tier: { type: 'string', pattern: '^(gold|silver|bronze)$' },
  },
};

const SHIPMENT_COLUMNS = [
  {
    name: 'order_id',
    start: 1,
    length: 10,
    type: 'integer',
    required: true,
    checks: [{ kind: 'format', pattern: '^\\d{4}$' }],
  },
  {
    name: 'carrier',
    start: 11,
    length: 7,
    required: true,
    checks: [{ kind: 'format', pattern: '^(UPS|FEDEX|DHL)$' }],
  },
  {
    name: 'tracking',
    start: 18,
    length: 20,
    checks: [
      {
        kind: 'null',
        pattern: '^(?!-+$).+$',
        message: 'tracking must not be a placeholder',
      },
    ],
  },
  { name: 'shipdate', start: 38, length: 8, type: 'date' },
];

/** The demo workflow, with file paths bound to this test's temp directory. */
function ordersWorkflow(overrides: { ordersPath?: string } = {}): WorkflowDef {
  const ordersPath = overrides.ordersPath ?? join(directory, 'orders.ndjson');
  return parseWorkflow({
    id: 'orders-pipeline',
    name: 'orders-pipeline',
    triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    dependencies: [
      { from: 'ingest-customers', to: 'route-orders' },
      { from: 'ingest-orders', to: 'route-orders' },
      { from: 'ingest-shipments', to: 'match-shipments' },
      { from: 'route-orders', to: 'reconcile' },
      { from: 'match-shipments', to: 'reconcile' },
      { from: 'ingest-orders', to: 'quarantine', on: 'failure' },
    ],
    pipelines: [
      {
        id: 'ingest-customers',
        name: 'ingest-customers',
        pipes: [
          {
            id: 'customers',
            role: 'source',
            type: 'source.file.csv',
            config: {
              path: join(directory, 'customers.csv'),
              onInvalid: 'reject',
              schema: CUSTOMER_SCHEMA,
            },
          },
          { id: 'valid-customers', role: 'transform', type: 'transform.merge', config: {} },
          { id: 'bad-customers', role: 'transform', type: 'transform.merge', config: {} },
        ],
        edges: [
          { from: 'customers', to: 'valid-customers' },
          { from: 'customers', to: 'bad-customers', fromPort: 'rejects' },
        ],
      },
      {
        id: 'ingest-orders',
        name: 'ingest-orders',
        pipes: [
          {
            id: 'orders',
            role: 'source',
            type: 'source.file.json',
            config: { path: ordersPath, format: 'ndjson', onInvalid: 'reject' },
          },
          { id: 'valid-orders', role: 'transform', type: 'transform.merge', config: {} },
          { id: 'bad-orders', role: 'transform', type: 'transform.merge', config: {} },
        ],
        edges: [
          { from: 'orders', to: 'valid-orders' },
          { from: 'orders', to: 'bad-orders', fromPort: 'rejects' },
        ],
      },
      {
        id: 'ingest-shipments',
        name: 'ingest-shipments',
        pipes: [
          {
            id: 'shipments',
            role: 'source',
            type: 'source.file.text',
            config: {
              path: join(directory, 'shipments.txt'),
              format: 'fixed',
              header: 'auto',
              onInvalid: 'reject',
              columns: SHIPMENT_COLUMNS,
            },
          },
          { id: 'valid-shipments', role: 'transform', type: 'transform.merge', config: {} },
          { id: 'bad-shipments', role: 'transform', type: 'transform.merge', config: {} },
        ],
        edges: [
          { from: 'shipments', to: 'valid-shipments' },
          { from: 'shipments', to: 'bad-shipments', fromPort: 'rejects' },
        ],
      },
      {
        id: 'route-orders',
        name: 'route-orders',
        pipes: [
          {
            id: 'reread-orders',
            role: 'source',
            type: 'source.file.json',
            config: { path: ordersPath, format: 'ndjson', onInvalid: 'skip' },
          },
          {
            id: 'is-paid',
            role: 'transform',
            type: 'transform.condition',
            config: { field: 'status', operator: 'equals', value: 'paid' },
          },
          {
            id: 'billable',
            role: 'transform',
            type: 'transform.map',
            config: {
              mappings: { order_id: 'order_id', amount: 'amount' },
              includeOriginal: false,
            },
          },
          {
            id: 'on-hold',
            role: 'transform',
            type: 'transform.map',
            config: {
              mappings: { order_id: 'order_id', status: 'status' },
              includeOriginal: false,
            },
          },
        ],
        edges: [
          { from: 'reread-orders', to: 'is-paid' },
          { from: 'is-paid', to: 'billable', fromPort: 'true' },
          { from: 'is-paid', to: 'on-hold', fromPort: 'false' },
        ],
      },
      {
        id: 'match-shipments',
        name: 'match-shipments',
        pipes: [
          {
            id: 'shipped',
            role: 'source',
            type: 'source.file.text',
            config: {
              path: join(directory, 'shipments.txt'),
              format: 'fixed',
              header: 'auto',
              onInvalid: 'skip',
              columns: [
                { name: 'order_id', start: 1, length: 10, type: 'integer' },
                { name: 'carrier', start: 11, length: 7 },
                { name: 'shipdate', start: 38, length: 8, type: 'date' },
              ],
            },
          },
          {
            id: 'by-carrier',
            role: 'transform',
            type: 'transform.split',
            config: { field: 'carrier' },
          },
          // Downstream of the split: receives one batch per carrier partition,
          // which is how partitioning is observable in run stats.
          { id: 'per-carrier', role: 'transform', type: 'transform.merge', config: {} },
        ],
        edges: [
          { from: 'shipped', to: 'by-carrier' },
          { from: 'by-carrier', to: 'per-carrier' },
        ],
      },
      {
        id: 'reconcile',
        name: 'reconcile',
        pipes: [
          { id: 'summary', role: 'source', type: 'source.triggerPayload', config: {} },
        ],
        edges: [],
      },
      {
        id: 'quarantine',
        name: 'quarantine',
        pipes: [
          { id: 'alert', role: 'source', type: 'source.triggerPayload', config: {} },
        ],
        edges: [],
      },
    ],
  });
}

async function run(engine: Engine, workflow: WorkflowDef) {
  await engine.stores.workflows.put(workflow);
  const { run: record } = await engine.scheduler.enqueue(workflow);
  await engine.idle();
  const stored = await engine.stores.runs.get(record!.id);
  const pipelines = await engine.stores.runs.listPipelines(record!.id);
  const pipes = await engine.stores.runs.listPipes(record!.id);
  return {
    runId: record!.id,
    status: stored?.status ?? 'missing',
    pipelines: Object.fromEntries(
      pipelines.map((row) => [row.pipelineId, row.status]),
    ),
    records: Object.fromEntries(
      pipes.map((row) => [row.pipeId, row.processedRecords]),
    ),
  };
}

describe('orders multi-pipeline import', () => {
  it('ingests three formats, dead-letters bad rows, and reconciles', async () => {
    const engine = engineFor();
    const result = await run(engine, ordersWorkflow());

    expect(result.status).toBe('succeeded');
    // Every pipeline ran; none skipped, and the failure-only branch stayed off.
    expect(result.pipelines).toEqual({
      'ingest-customers': 'succeeded',
      'ingest-orders': 'succeeded',
      'ingest-shipments': 'succeeded',
      'route-orders': 'succeeded',
      'match-shipments': 'succeeded',
      reconcile: 'succeeded',
      quarantine: 'skipped',
    });

    expect(result.records).toMatchObject({
      // 5 customers, one with a malformed email dead-letters.
      'valid-customers': 4,
      'bad-customers': 1,
      // 6 NDJSON lines: 5 parse, 1 is malformed and dead-letters.
      'valid-orders': 5,
      'bad-orders': 1,
      // 4 shipment rows after the header; the XXXX/BADCO row fails 3 checks.
      'valid-shipments': 3,
      'bad-shipments': 1,
      // 3 paid orders vs 2 not paid (refunded + pending).
      billable: 3,
      'on-hold': 2,
    });
    engine.close();
  });

  it('partitions shipments by carrier into separate batches', async () => {
    const engine = engineFor();
    const result = await run(engine, ordersWorkflow());

    const batches = await engine.stores.runs.listPipes(result.runId);
    const split = batches.find((row) => row.pipeId === 'by-carrier');
    // A transform's `processedBatches` counts what it CONSUMED — the three
    // shipments arrive as one batch — so the split is visible downstream…
    expect(split?.processedRecords).toBe(3);
    expect(split?.processedBatches).toBe(1);

    // …where one batch per distinct carrier (UPS ×2, FEDEX ×1) lands.
    const downstream = batches.find((row) => row.pipeId === 'per-carrier');
    expect(downstream?.processedBatches).toBe(2);
    expect(downstream?.processedRecords).toBe(3);
    engine.close();
  });

  it('releases the quarantine branch and skips the rest when ingest fails', async () => {
    const engine = engineFor();
    // Point the orders source at a file that does not exist.
    const broken = ordersWorkflow({
      ordersPath: join(directory, 'missing-orders.ndjson'),
    });
    const result = await run(engine, broken);

    expect(result.status).toBe('failed');
    expect(result.pipelines).toMatchObject({
      'ingest-orders': 'failed',
      // Compensation path runs precisely because the ingest failed.
      quarantine: 'succeeded',
      // Everything downstream of the failure is skipped, not failed…
      'route-orders': 'skipped',
      reconcile: 'skipped',
      // …while the independent branches still complete.
      'ingest-customers': 'succeeded',
      'ingest-shipments': 'succeeded',
      'match-shipments': 'succeeded',
    });
    engine.close();
  });

  it('captures per-port debug samples across the whole workflow', async () => {
    const engine = engineFor();
    const workflow = ordersWorkflow();
    await engine.stores.workflows.put(workflow);
    const { run: record } = await engine.scheduler.enqueue(workflow, undefined, {
      debug: true,
    });
    await engine.idle();

    const samples = (await engine.stores.events.list(record!.id)).filter(
      (event) => event.type === 'batch.sample',
    );
    const seen = new Set(
      samples.map(
        (event) => `${event.pipeId}:${event.data?.direction}:${event.data?.port}`,
      ),
    );
    // Both source ports are sampled, including the dead-letter branch.
    expect(seen).toContain('customers:out:out');
    expect(seen).toContain('customers:out:rejects');
    expect(seen).toContain('bad-customers:in:rejects');
    // And the condition pipe's named ports downstream.
    expect(seen).toContain('is-paid:out:true');
    expect(seen).toContain('is-paid:out:false');

    const rejected = samples.find(
      (event) => event.pipeId === 'customers' && event.data?.port === 'rejects',
    );
    const row = (rejected?.data?.records as Record<string, unknown>[])[0]!;
    expect(row.email).toBe('not-an-email');
    expect(String(row._error)).toMatch(/pattern/);
    engine.close();
  });
});
