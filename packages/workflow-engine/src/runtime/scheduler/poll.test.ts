/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/scheduler/poll.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  parseWorkflow,
  type TriggerInvocation,
  type TriggerScheduleState,
  type TriggerScheduleStore,
  type WorkflowDef,
  type WorkflowStore,
} from '../../common/index.js';
import { CronCoordinator } from './cron.js';
import { POLL_SEEN_KEYS_LIMIT, PollCoordinator } from './poll.js';

function workflow(overrides: Record<string, unknown> = {}): WorkflowDef {
  return parseWorkflow({
    id: 'wf-poll',
    name: 'poll',
    triggers: [
      {
        id: 'tickets',
        kind: 'poll',
        intervalSeconds: 60,
        http: { url: 'https://api.test/tickets' },
        resultsPath: 'data.items',
        dedupKey: 'id',
        ...overrides,
      },
    ],
    pipelines: [
      {
        id: 'p1',
        name: 'p1',
        pipes: [
          {
            id: 'src',
            type: 'trigger.manual',
            role: 'source',
            config: {},
          },
        ],
        edges: [],
      },
    ],
  });
}

function stores(): {
  workflows: WorkflowStore;
  schedules: TriggerScheduleStore;
  rows: Map<string, TriggerScheduleState>;
} {
  const rows = new Map<string, TriggerScheduleState>();
  const key = (w: string, t: string): string => `${w}\0${t}`;
  return {
    rows,
    workflows: {
      list: async () => [workflowRef.current],
    } as unknown as WorkflowStore,
    schedules: {
      put: async (state) => {
        rows.set(key(state.workflowId, state.triggerId), state);
      },
      get: async (w, t) => rows.get(key(w, t)),
      list: async () => [...rows.values()],
      remove: async (w, t) => {
        rows.delete(key(w, t));
      },
    },
  };
}

const workflowRef: { current: WorkflowDef } = { current: workflow() };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

interface Harness {
  coordinator: PollCoordinator;
  enqueued: TriggerInvocation[];
  errors: unknown[];
  rows: Map<string, TriggerScheduleState>;
  advance: (seconds: number) => void;
}

function harness(
  responses: unknown[],
  overrides: Record<string, unknown> = {},
): Harness {
  workflowRef.current = workflow(overrides);
  const { workflows, schedules, rows } = stores();
  const enqueued: TriggerInvocation[] = [];
  const errors: unknown[] = [];
  let clock = new Date('2026-01-01T00:00:00.000Z').getTime();
  let call = 0;

  const coordinator = new PollCoordinator({
    workflows,
    schedules,
    scheduler: {
      enqueue: async (_wf, invocation) => {
        enqueued.push(invocation);
      },
    },
    now: () => new Date(clock),
    onError: (error) => errors.push(error),
    fetch: (async () => {
      const body = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (body instanceof Error) throw body;
      return jsonResponse(body);
    }) as unknown as typeof fetch,
  });

  return {
    coordinator,
    enqueued,
    errors,
    rows,
    advance: (seconds) => {
      clock += seconds * 1000;
    },
  };
}

const page = (ids: string[]): unknown => ({
  data: { items: ids.map((id) => ({ id, subject: `ticket ${id}` })) },
});

describe('PollCoordinator', () => {
  it('primes on the first poll without creating a run', async () => {
    const h = harness([page(['a', 'b'])]);

    await h.coordinator.tick(); // installs the schedule row
    h.advance(60);
    await h.coordinator.tick(); // first actual poll

    expect(h.enqueued).toHaveLength(0);
    // The backlog is recorded, so it is not "new" next time.
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a', 'b']);
    expect(h.errors).toEqual([]);
  });

  it('fires on the first poll when onFirstPoll is fire', async () => {
    const h = harness([page(['a', 'b'])], { onFirstPoll: 'fire' });

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toEqual({
      items: [
        { id: 'a', subject: 'ticket a' },
        { id: 'b', subject: 'ticket b' },
      ],
    });
  });

  it('creates a run only for items it has not seen', async () => {
    const h = harness([page(['a', 'b']), page(['b', 'c'])]);

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick(); // primes on a, b
    h.advance(60);
    await h.coordinator.tick(); // b is old, c is new

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toEqual({
      items: [{ id: 'c', subject: 'ticket c' }],
    });
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a', 'b', 'c']);
  });

  it('creates no run when every item is already known', async () => {
    const h = harness([page(['a']), page(['a']), page(['a'])]);

    await h.coordinator.tick();
    for (let i = 0; i < 3; i++) {
      h.advance(60);
      await h.coordinator.tick();
    }

    // The whole point of a poll trigger: quiet when nothing changed.
    expect(h.enqueued).toHaveLength(0);
  });

  it('respects the interval', async () => {
    const h = harness([page(['a']), page(['b'])]);

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick(); // primes
    h.advance(30); // too soon
    await h.coordinator.tick();

    expect(h.enqueued).toHaveLength(0);
    h.advance(30); // now due
    await h.coordinator.tick();
    expect(h.enqueued).toHaveLength(1);
  });

  it('carries at most maxItems and leaves the rest new', async () => {
    const h = harness(
      [page([]), page(['a', 'b', 'c'])],
      { maxItems: 2, onFirstPoll: 'fire' },
    );

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick(); // empty page, primes with nothing
    h.advance(60);
    await h.coordinator.tick(); // a, b delivered; c held back

    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toEqual({
      items: [
        { id: 'a', subject: 'ticket a' },
        { id: 'b', subject: 'ticket b' },
      ],
    });
    // c must not be recorded as seen, or it would never be delivered.
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a', 'b']);
  });

  it('does not mark undelivered items seen on a priming fire', async () => {
    // Regression: a first poll with onFirstPoll 'fire' both delivers *and*
    // primes. Recording the whole response (the priming behaviour) while
    // delivering only maxItems marked items 3+ as already seen, so they were
    // dropped without ever reaching a run. Caught against a live endpoint,
    // not by the earlier maxItems test — that one primed off an empty page
    // and so never exercised "priming and firing at the same time".
    const h = harness([page(['a', 'b', 'c', 'd'])], {
      maxItems: 2,
      onFirstPoll: 'fire',
    });

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a', 'b']);

    h.advance(60);
    await h.coordinator.tick();
    expect(h.enqueued).toHaveLength(2);
    expect(h.enqueued[1]?.payload).toEqual({
      items: [
        { id: 'c', subject: 'ticket c' },
        { id: 'd', subject: 'ticket d' },
      ],
    });
  });

  it('errors rather than going quiet when resultsPath stops matching', async () => {
    const h = harness([{ data: { items: [{ id: 'a' }] } }, { data: {} }]);

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    expect(h.errors).toHaveLength(1);
    expect(String(h.errors[0])).toMatch(/resultsPath 'data.items' is missing/);
  });

  it('keeps the cursor when a poll fails', async () => {
    const h = harness([
      page(['a']),
      new Error('connect ECONNREFUSED'),
      page(['a', 'b']),
    ]);

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick(); // primes on a
    h.advance(60);
    await h.coordinator.tick(); // fetch throws
    expect(h.errors).toHaveLength(1);
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a']);

    h.advance(60);
    await h.coordinator.tick();
    // a is still known after the failure, so only b is new.
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0]?.payload).toEqual({
      items: [{ id: 'b', subject: 'ticket b' }],
    });
  });

  it('resets the cursor when the request or dedup key changes', async () => {
    const h = harness([page(['a'])]);

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toEqual(['a']);

    // Same trigger id, different endpoint: keys collected from the old one say
    // nothing about items from the new one.
    workflowRef.current = workflow({ http: { url: 'https://api.test/other' } });
    h.advance(60);
    await h.coordinator.tick();
    expect(h.rows.get('wf-poll\0tickets')?.seenKeys).toBeUndefined();
  });

  it('bounds the remembered keys, dropping the oldest', async () => {
    const first = Array.from({ length: POLL_SEEN_KEYS_LIMIT }, (_, i) =>
      String(i),
    );
    const second = Array.from({ length: 50 }, (_, i) =>
      String(POLL_SEEN_KEYS_LIMIT + i),
    );
    // maxItems is capped at 1000 by the schema, so exceeding the bound takes
    // two deliveries rather than one oversized page.
    const h = harness([page([]), page(first), page(second)], {
      maxItems: 1000,
      onFirstPoll: 'fire',
    });

    await h.coordinator.tick();
    for (let i = 0; i < 3; i++) {
      h.advance(60);
      await h.coordinator.tick();
    }

    const seen = h.rows.get('wf-poll\0tickets')?.seenKeys ?? [];
    expect(seen).toHaveLength(POLL_SEEN_KEYS_LIMIT);
    expect(seen.at(-1)).toBe(String(POLL_SEEN_KEYS_LIMIT + 49));
    // The 50 oldest fell off the front to make room.
    expect(seen[0]).toBe('50');
  });

  it('caps one delivery at maxItems and leaves the overflow unseen', async () => {
    const many = Array.from({ length: POLL_SEEN_KEYS_LIMIT + 50 }, (_, i) =>
      String(i),
    );
    const h = harness([page([]), page(many)], {
      maxItems: 1000,
      onFirstPoll: 'fire',
    });

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    const seen = h.rows.get('wf-poll\0tickets')?.seenKeys ?? [];
    // Only what actually went out is remembered — the 50 items beyond
    // maxItems must still look new, or they would never be delivered at all.
    expect(seen).toHaveLength(1000);
    expect(seen.at(-1)).toBe('999');
  });

  it('gives the same items the same idempotency key', async () => {
    const h = harness([page([]), page(['x'])], { onFirstPoll: 'fire' });
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    const first = h.enqueued[0];
    expect(first?.idempotencyKey).toMatch(/^poll:tickets:[0-9a-f]{64}$/);
    expect(first?.metadata.itemCount).toBe('1');
  });

  it('keeps items distinct when the dedup field is missing', async () => {
    const h = harness(
      [{ data: { items: [] } }, { data: { items: [{ n: 1 }, { n: 2 }] } }],
      { onFirstPoll: 'fire' },
    );

    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();

    // Both must arrive: collapsing them onto one key would silently drop one.
    expect(h.enqueued[0]?.payload).toEqual({ items: [{ n: 1 }, { n: 2 }] });
  });

  it('skips a disabled trigger', async () => {
    const h = harness([page(['a'])], { enabled: false });
    await h.coordinator.tick();
    h.advance(60);
    await h.coordinator.tick();
    expect(h.enqueued).toHaveLength(0);
    expect(h.rows.size).toBe(0);
  });
});

describe('coexistence with CronCoordinator', () => {
  // Both coordinators keep state in trigger_schedules. Cron owns the reaping,
  // and reaping by "not one of my cron triggers" deleted a live poll's cursor
  // on every tick — which silently re-delivered every item, forever.
  function bothKinds(pollEnabled: boolean): WorkflowDef {
    return parseWorkflow({
      id: 'wf-both',
      name: 'both',
      triggers: [
        { id: 'nightly', kind: 'cron', cron: '0 0 * * *' },
        {
          id: 'tickets',
          kind: 'poll',
          enabled: pollEnabled,
          intervalSeconds: 60,
          http: { url: 'https://api.test/tickets' },
          resultsPath: 'data.items',
          dedupKey: 'id',
        },
      ],
      pipelines: [
        {
          id: 'p1',
          name: 'p1',
          pipes: [
            { id: 'src', type: 'trigger.manual', role: 'source', config: {} },
          ],
          edges: [],
        },
      ],
    });
  }

  function sharedStore(definition: WorkflowDef): {
    workflows: WorkflowStore;
    schedules: TriggerScheduleStore;
    rows: Map<string, TriggerScheduleState>;
  } {
    const rows = new Map<string, TriggerScheduleState>();
    const key = (w: string, t: string): string => `${w}\0${t}`;
    return {
      rows,
      workflows: { list: async () => [definition] } as unknown as WorkflowStore,
      schedules: {
        put: async (state) => {
          rows.set(key(state.workflowId, state.triggerId), state);
        },
        get: async (w, t) => rows.get(key(w, t)),
        list: async () => [...rows.values()],
        remove: async (w, t) => {
          rows.delete(key(w, t));
        },
      },
    };
  }

  it("leaves an enabled poll's cursor alone when cron reaps", async () => {
    const definition = bothKinds(true);
    const { workflows, schedules, rows } = sharedStore(definition);
    const now = new Date('2026-01-01T00:00:00.000Z');

    rows.set('wf-both\0tickets', {
      workflowId: 'wf-both',
      triggerId: 'tickets',
      nextFireAt: '2026-01-01T00:01:00.000Z',
      seenKeys: ['a', 'b'],
    });

    const cron = new CronCoordinator({
      workflows,
      schedules,
      scheduler: { enqueue: async () => undefined },
      now: () => now,
    });
    await cron.tick();

    expect(rows.get('wf-both\0tickets')?.seenKeys).toEqual(['a', 'b']);
  });

  it("still reaps a disabled poll's row", async () => {
    const definition = bothKinds(false);
    const { workflows, schedules, rows } = sharedStore(definition);
    const now = new Date('2026-01-01T00:00:00.000Z');

    rows.set('wf-both\0tickets', {
      workflowId: 'wf-both',
      triggerId: 'tickets',
      nextFireAt: '2026-01-01T00:01:00.000Z',
      seenKeys: ['a'],
    });

    const cron = new CronCoordinator({
      workflows,
      schedules,
      scheduler: { enqueue: async () => undefined },
      now: () => now,
    });
    await cron.tick();

    // Disabling clears the cursor, so re-enabling primes against the world as
    // it is then rather than replaying whatever accumulated meanwhile.
    expect(rows.get('wf-both\0tickets')).toBeUndefined();
  });
});
