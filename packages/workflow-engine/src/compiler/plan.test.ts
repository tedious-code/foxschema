/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/compiler/src/plan.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { parsePipeline } from '../common/index.js';
import {
  parseWorkflow,
  parseWorkflowInput,
} from '../common/index.js';
import { planExecution, planWorkflow } from './plan.js';

function pipeline(id: string, pipes: string[], edges: [string, string][]) {
  return {
    id,
    name: id,
    pipes: pipes.map((pid) => ({ id: pid, role: 'transform', type: 'noop' })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe('planExecution (pipe level)', () => {
  it('orders a linear chain into single-pipe waves', () => {
    const plan = planExecution(
      parsePipeline(pipeline('p1', ['a', 'b', 'c'], [['a', 'b'], ['b', 'c']])),
    );
    expect(plan.waves).toEqual([['a'], ['b'], ['c']]);
    expect(plan.order).toEqual(['a', 'b', 'c']);
  });

  it('groups independent branches into one parallel wave', () => {
    const plan = planExecution(
      parsePipeline(pipeline('p1', ['src', 'x', 'y'], [['src', 'x'], ['src', 'y']])),
    );
    expect(plan.waves[0]).toEqual(['src']);
    expect(plan.waves[1]).toEqual(['x', 'y']);
  });

  it('detects pipe cycles', () => {
    expect(() =>
      planExecution(
        parsePipeline(pipeline('p1', ['a', 'b'], [['a', 'b'], ['b', 'a']])),
      ),
    ).toThrow(/cycle/);
  });
});

describe('planWorkflow (pipeline level)', () => {
  it('orders pipelines by completion edges, siblings in one wave', () => {
    const wf = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [
        pipeline('load', ['s1'], []),
        pipeline('publish', ['s1'], []),
        pipeline('audit', ['s1'], []),
      ],
      dependencies: [
        { from: 'load', to: 'publish' },
        { from: 'load', to: 'audit' },
      ],
    });
    const plan = planWorkflow(wf);
    expect(plan.waves).toEqual([['load'], ['audit', 'publish']]);
  });

  it('detects dependency cycles between pipelines', () => {
    const wf = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [pipeline('a', ['s1'], []), pipeline('b', ['s1'], [])],
      dependencies: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    });
    expect(() => planWorkflow(wf)).toThrow(/workflow graph contains a cycle/);
  });
});

describe('parseWorkflow', () => {
  it('rejects dependencies to unknown pipelines', () => {
    expect(() =>
      parseWorkflow({
        id: 'w',
        name: 'bad',
        pipelines: [pipeline('a', ['s1'], [])],
        dependencies: [{ from: 'a', to: 'ghost' }],
      }),
    ).toThrow(/unknown target pipeline/);
  });

  it('rejects edges to unknown pipes inside a pipeline', () => {
    expect(() =>
      parseWorkflow({
        id: 'w',
        name: 'bad',
        pipelines: [pipeline('a', ['s1'], [['s1', 'ghost']])],
      }),
    ).toThrow(/unknown target pipe/);
  });

  it('defaults triggers to manual', () => {
    const parsed = parseWorkflow({
      id: 'w',
      name: 'ok',
      pipelines: [pipeline('a', ['s1'], [])],
    });
    expect(parsed.triggers).toEqual([
      { id: 'manual', kind: 'manual', enabled: true },
    ]);
  });

  it('normalizes legacy schedules and assigns stable trigger ids', () => {
    const parsed = parseWorkflow({
      id: 'w',
      name: 'ok',
      pipelines: [pipeline('a', ['s1'], [])],
      triggers: [
        { kind: 'schedule', cron: '0 * * * *' },
        { kind: 'webhook', credentialId: 'hook-secret' },
      ],
    });
    expect(parsed.triggers).toEqual([
      {
        id: 'cron',
        kind: 'cron',
        enabled: true,
        cron: '0 * * * *',
        timezone: 'UTC',
        catchUp: 'none',
        executionType: 'workflow',
      },
      // The input used the pre-`auth` flat shape; liftWebhookAuth moves the
      // signature settings into the union member that owns them.
      {
        id: 'webhook',
        kind: 'webhook',
        enabled: true,
        auth: {
          type: 'signature',
          credentialId: 'hook-secret',
          signatureHeader: 'x-foxflow-signature',
          timestampHeader: 'x-foxflow-timestamp',
          maxAgeSeconds: 300,
        },
        methods: ['POST'],
        idempotencyHeader: 'x-idempotency-key',
        onMissingIdempotencyKey: 'reject',
        maxBodyBytes: 1_048_576,
      },
    ]);
  });

  it('leaves an already-lifted webhook alone when re-parsed', () => {
    const once = parseWorkflow({
      id: 'w',
      name: 'ok',
      pipelines: [pipeline('a', ['s1'], [])],
      triggers: [{ id: 'hook', kind: 'webhook', credentialId: 'hook-secret' }],
    });
    // Idempotence matters: every read from storage runs the lift again.
    expect(parseWorkflow(once)).toEqual(once);
  });

  it('rejects duplicate trigger ids', () => {
    expect(() =>
      parseWorkflow({
        id: 'w',
        name: 'bad',
        pipelines: [pipeline('a', ['s1'], [])],
        triggers: [
          { id: 'inbound', kind: 'manual' },
          { id: 'inbound', kind: 'webhook', credentialId: 'hook-secret' },
        ],
      }),
    ).toThrow(/duplicate trigger id: inbound/);
  });

  it('rejects invalid cron expressions and timezones', () => {
    expect(() =>
      parseWorkflow({
        id: 'w',
        name: 'bad cron',
        pipelines: [pipeline('a', ['s1'], [])],
        triggers: [
          {
            kind: 'cron',
            cron: 'not a cron',
            timezone: 'Somewhere/Invalid',
          },
        ],
      }),
    ).toThrow(/invalid/);
  });

  it('parses a parent trigger', () => {
    const parsed = parseWorkflow({
      id: 'w',
      name: 'ok',
      pipelines: [pipeline('a', ['s1'], [])],
      triggers: [{ kind: 'parent', allowFrom: ['caller-a'] }],
    });
    expect(parsed.triggers).toEqual([
      {
        id: 'parent',
        kind: 'parent',
        enabled: true,
        allowFrom: ['caller-a'],
      },
    ]);
  });

  it('refuses the trigger kinds that never had an implementation', () => {
    // `event` and `custom` parsed, saved and sat in the palette while their
    // ingress returned 501 and nothing published to a topic. A workflow could
    // be authored, enabled, and never fire. Refusing them at the parse is the
    // point of removing them — a kind that cannot run should not validate.
    for (const kind of ['event', 'custom']) {
      expect(() =>
        parseWorkflow({
          id: 'w',
          name: 'removed kind',
          pipelines: [pipeline('a', ['s1'], [])],
          triggers: [{ kind }],
        }),
      ).toThrow();
    }
  });
});

describe('dependency settings + dependsOn sugar', () => {
  it('lifts dependsOn strings into dependencies and orders by them', () => {
    const wf = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [
        pipeline('load', ['s1'], []),
        { ...pipeline('publish', ['s1'], []), dependsOn: ['load'] },
      ],
    });
    expect(wf.dependencies).toEqual([
      { from: 'load', to: 'publish', on: 'success' },
    ]);
    expect(planWorkflow(wf).waves).toEqual([['load'], ['publish']]);
    expect(
      (wf.pipelines[1] as Record<string, unknown>).dependsOn,
    ).toBeUndefined();
  });

  it('carries per-edge settings (on, gate) through dependsOn objects', () => {
    const wf = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [
        pipeline('load', ['s1'], []),
        {
          ...pipeline('cleanup', ['s1'], []),
          dependsOn: [{ pipeline: 'load', on: 'failure' }],
        },
        {
          ...pipeline('publish', ['s1'], []),
          dependsOn: [{ pipeline: 'load', gate: 'run.stats.rows > 0' }],
        },
      ],
    });
    expect(wf.dependencies).toContainEqual({
      from: 'load',
      to: 'cleanup',
      on: 'failure',
    });
    expect(wf.dependencies).toContainEqual({
      from: 'load',
      to: 'publish',
      on: 'success',
      gate: 'run.stats.rows > 0',
    });
  });

  it('defaults on to success in the workflow-level dependencies list', () => {
    const wf = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [pipeline('a', ['s1'], []), pipeline('b', ['s1'], [])],
      dependencies: [{ from: 'a', to: 'b' }],
    });
    expect(wf.dependencies[0]).toEqual({ from: 'a', to: 'b', on: 'success' });
  });

  it('rejects the same (from, to) pair declared twice', () => {
    expect(() =>
      parseWorkflow({
        id: 'w1',
        name: 'w1',
        pipelines: [
          pipeline('a', ['s1'], []),
          { ...pipeline('b', ['s1'], []), dependsOn: ['a'] },
        ],
        dependencies: [{ from: 'a', to: 'b' }],
      }),
    ).toThrow(/duplicate dependency: a -> b/);
  });

  it('rejects dependsOn naming an unknown pipeline', () => {
    expect(() =>
      parseWorkflow({
        id: 'w1',
        name: 'w1',
        pipelines: [{ ...pipeline('b', ['s1'], []), dependsOn: ['ghost'] }],
      }),
    ).toThrow(/unknown source pipeline: ghost/);
  });

  it('re-parsing a parsed workflow is idempotent', () => {
    const once = parseWorkflow({
      id: 'w1',
      name: 'w1',
      pipelines: [
        pipeline('load', ['s1'], []),
        { ...pipeline('publish', ['s1'], []), dependsOn: ['load'] },
      ],
    });
    const twice = parseWorkflow(JSON.parse(JSON.stringify(once)));
    expect(twice.dependencies).toEqual(once.dependencies);
  });
});

describe('parseWorkflowInput (implicit single-pipeline wrapping)', () => {
  it('wraps a bare pipeline document into a workflow', () => {
    const wf = parseWorkflowInput(
      pipeline('orders', ['src', 'sink'], [['src', 'sink']]),
    );
    expect(wf.id).toBe('orders');
    expect(wf.pipelines).toHaveLength(1);
    expect(wf.pipelines[0]!.pipes).toHaveLength(2);
    expect(wf.triggers).toEqual([
      { id: 'manual', kind: 'manual', enabled: true },
    ]);
  });

  it('passes a full workflow document through', () => {
    const wf = parseWorkflowInput({
      id: 'w',
      name: 'w',
      pipelines: [pipeline('a', ['s1'], [])],
    });
    expect(wf.pipelines).toHaveLength(1);
  });
});
