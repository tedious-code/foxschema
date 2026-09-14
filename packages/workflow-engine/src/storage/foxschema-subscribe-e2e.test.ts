/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/storage/src/foxschema-subscribe-e2e.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Engine,
  HttpSourcePipe,
  PipeRegistry,
  parseWorkflow,
  type TriggerInvocation,
  type WorkflowDef,
} from '../index.js';

/**
 * The `demo-foxschema-subscribe` workflow: a signup arrives on a trigger and
 * is forwarded as a POST to foxschema.com's subscribe endpoint, with the body
 * built from the trigger payload by `{{trigger.*}}` interpolation.
 *
 * Every request here is served by an injected stub — the tests never touch
 * the live site, because a passing test suite must not create real
 * subscribers (and must not fail when the site is down).
 */

const SUBSCRIBE_URL = 'https://foxschema.com/wp-json/foxschema/v1/subscribe';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Records every outbound request and replies with `respond`. */
function stubSite(
  captured: Captured[],
  respond: (call: number) => Response = () =>
    new Response(JSON.stringify({ ok: true, id: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        /* keep the raw string */
      }
    }
    captured.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body,
    });
    return respond(captured.length);
  }) as typeof fetch;
}

/**
 * Engine whose HTTP source is backed by the stub instead of the network.
 * The registry holds only what this workflow uses, which is also what keeps
 * the real `source.api.http` from being reachable by accident.
 */
function engineWith(fetchImpl: typeof fetch): Engine {
  return new Engine({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
    instanceId: 'foxschema-subscribe',
    registry: new PipeRegistry([new HttpSourcePipe(fetchImpl)]),
  });
}

/** Signup forwarder: trigger payload → POST to the subscribe endpoint. */
function subscribeWorkflow(
  overrides: {
    timeoutMs?: number;
    retryAttempts?: number;
    /**
     * `transient` (the default) does NOT retry an HTTP status failure — the
     * source throws a plain Error for a non-2xx, so a 5xx only retries when
     * the pipe opts into `all`. See the pair of tests below.
     */
    retryOn?: 'transient' | 'all';
  } = {},
): WorkflowDef {
  return parseWorkflow({
    id: 'foxschema-subscribe',
    name: 'foxschema-subscribe',
    description: 'Forward a signup to foxschema.com',
    triggers: [{ id: 'manual', kind: 'manual', enabled: true }],
    pipelines: [
      {
        id: 'main',
        name: 'main',
        pipes: [
          {
            id: 'post-signup',
            role: 'source',
            type: 'source.api.http',
            ...(overrides.retryAttempts
              ? {
                  retry: {
                    attempts: overrides.retryAttempts,
                    backoff: 'fixed',
                    maxDelayMs: 1,
                    jitter: false,
                    on: overrides.retryOn ?? 'transient',
                  },
                }
              : {}),
            config: {
              url: SUBSCRIBE_URL,
              method: 'POST',
              timeoutMs: overrides.timeoutMs ?? 10_000,
              headers: [
                { key: 'content-type', value: 'application/json', enabled: true },
                { key: 'user-agent', value: 'FoxAgent/1.0', enabled: true },
              ],
              body: {
                mode: 'json',
                json: {
                  email: '{{trigger.email}}',
                  name: '{{trigger.name}}',
                  source: '{{vars.signup_source}}',
                },
                // Enforced in-process before the request is sent, so a bad
                // payload never reaches the live site.
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: {
                    email: { type: 'string', pattern: '^\\S+@\\S+$' },
                    name: { type: 'string' },
                  },
                },
              },
              variables: { signup_source: 'foxflow-demo' },
            },
          },
        ],
        edges: [],
      },
    ],
  });
}

function signup(payload: unknown): TriggerInvocation {
  return {
    id: 'inv-signup',
    workflowId: 'foxschema-subscribe',
    triggerId: 'manual',
    kind: 'manual',
    acceptedAt: new Date().toISOString(),
    payload,
    metadata: {},
  };
}

async function runSubscribe(
  engine: Engine,
  workflow: WorkflowDef,
  payload: unknown,
) {
  await engine.stores.workflows.put(workflow);
  const { run } = await engine.scheduler.enqueue(workflow, signup(payload));
  await engine.idle();
  const stored = await engine.stores.runs.get(run!.id);
  const pipes = await engine.stores.runs.listPipes(run!.id);
  return {
    status: stored?.status ?? 'missing',
    error: stored?.error,
    records: pipes[0]?.processedRecords ?? 0,
  };
}

describe('foxschema.com subscribe workflow', () => {
  it('POSTs the trigger payload to the subscribe endpoint as JSON', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(stubSite(captured));

    const result = await runSubscribe(engine, subscribeWorkflow(), {
      email: 'ada@example.com',
      name: 'Ada Lovelace',
    });

    expect(result.status).toBe('succeeded');
    expect(captured).toHaveLength(1);
    const call = captured[0]!;
    expect(call.url).toBe(SUBSCRIBE_URL);
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toContain('application/json');
    expect(call.headers['user-agent']).toBe('FoxAgent/1.0');
    // Trigger fields and a workflow variable both interpolate into the body.
    expect(call.body).toEqual({
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      source: 'foxflow-demo',
    });
    engine.close();
  });

  it('refuses to send when the payload fails the body schema', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(stubSite(captured));

    const result = await runSubscribe(engine, subscribeWorkflow(), {
      email: 'definitely-not-an-email',
      name: 'Bad Input',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/pattern|schema/i);
    // The important half: nothing left the process.
    expect(captured).toEqual([]);
    engine.close();
  });

  it('retries a 5xx and succeeds when the site recovers (retry.on = all)', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(
      stubSite(captured, (call) =>
        call === 1
          ? new Response('gateway timeout', { status: 504 })
          : new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
      ),
    );

    const result = await runSubscribe(
      engine,
      subscribeWorkflow({ retryAttempts: 3, retryOn: 'all' }),
      { email: 'grace@example.com', name: 'Grace' },
    );

    expect(result.status).toBe('succeeded');
    expect(captured).toHaveLength(2);
    engine.close();
  });

  it('does NOT retry a 5xx under the default transient-only policy', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(
      stubSite(captured, () => new Response('gateway timeout', { status: 504 })),
    );

    // The HTTP source throws a plain Error for a non-2xx status, which is not
    // classified as transient — so a retry policy left at its default never
    // fires. Forwarding to a flaky endpoint must opt into `on: 'all'`.
    const result = await runSubscribe(
      engine,
      subscribeWorkflow({ retryAttempts: 3 }),
      { email: 'grace@example.com', name: 'Grace' },
    );

    expect(result.status).toBe('failed');
    expect(captured).toHaveLength(1);
    engine.close();
  });

  it('fails the run when the site keeps rejecting the request', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(
      stubSite(captured, () => new Response('forbidden', { status: 403 })),
    );

    const result = await runSubscribe(engine, subscribeWorkflow(), {
      email: 'linus@example.com',
      name: 'Linus',
    });

    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/403/);
    engine.close();
  });

  it('leaves missing optional fields empty rather than sending "undefined"', async () => {
    const captured: Captured[] = [];
    const engine = engineWith(stubSite(captured));

    // No `name` in the payload — the template must not stringify undefined.
    const result = await runSubscribe(engine, subscribeWorkflow(), {
      email: 'alice@example.com',
    });

    expect(result.status).toBe('succeeded');
    expect(captured[0]!.body).toEqual({
      email: 'alice@example.com',
      name: '',
      source: 'foxflow-demo',
    });
    engine.close();
  });
});
