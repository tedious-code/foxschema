/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow UI mock data aligned with FoxFlow:
 * Workflow → Pipeline → Pipe, workflow-level triggers, pipe type ids,
 * api/scheduler/worker topology, variables + credentials.
 * Visual only — not executed.
 */

export type WorkflowPane = 'designer' | 'runs' | 'engine' | 'variables';

/** FoxFlow-style pipe type ids (palette + canvas). */
export type PipeTypeId =
  | 'source.trigger.cron'
  | 'source.trigger.manual'
  | 'source.trigger.webhook'
  | 'source.trigger.http'
  | 'source.trigger.parent'
  | 'source.db.postgres'
  | 'source.api.http'
  | 'source.file.csv'
  | 'transform.script'
  | 'transform.condition'
  | 'transform.split'
  | 'transform.merge'
  | 'transform.http'
  | 'transform.map'
  | 'logic.loop'
  | 'workflow.sub'
  | 'human.gate'
  | 'sink.email'
  | 'sink.postgres'
  | 'sink.http';

export interface MockPipe {
  id: string;
  type: PipeTypeId;
  label: string;
  detail: string;
  /** Canvas position (percent of designer board). */
  x: number;
  y: number;
  lane?: 'a' | 'b' | 'c' | 'join';
}

export interface MockEdge {
  from: string;
  to: string;
  label?: string;
}

export type TriggerKind = 'manual' | 'cron' | 'webhook' | 'http' | 'parent';

export interface MockRun {
  id: string;
  workflow: string;
  trigger: TriggerKind;
  status: 'succeeded' | 'running' | 'failed' | 'cancelled';
  startedAt: string;
  durationMs: number | null;
}

export interface MockVariable {
  /** FoxFlow: global | workflow; run = frozen admission snapshot. */
  scope: 'global' | 'workflow' | 'run';
  name: string;
  value: string;
  secret?: boolean;
}

export interface MockCredential {
  id: string;
  kind: 'database' | 'http' | 'webhook' | 'llm';
  name: string;
}

export const MOCK_WORKFLOW_NAME = 'gather-orders-and-notify';
export const MOCK_WORKFLOW_VERSION = 'v3';
export const MOCK_PIPELINE_NAME = 'main';
export const MOCK_ENVIRONMENT = 'local';

export const MOCK_PIPES: MockPipe[] = [
  {
    id: 't1',
    type: 'source.trigger.cron',
    label: 'cron',
    detail: '0 */6 * * * · America/Chicago',
    x: 6,
    y: 42,
  },
  {
    id: 's_orders',
    type: 'source.db.postgres',
    label: 'db · orders',
    detail: 'SELECT … FROM orders',
    x: 22,
    y: 18,
    lane: 'a',
  },
  {
    id: 's_erp',
    type: 'source.api.http',
    label: 'http · ERP',
    detail: 'GET /v1/shipments',
    x: 22,
    y: 42,
    lane: 'b',
  },
  {
    id: 's_files',
    type: 'source.file.csv',
    label: 'file · inbox',
    detail: 'drop folder CSVs',
    x: 22,
    y: 66,
    lane: 'c',
  },
  {
    id: 'g1',
    type: 'transform.merge',
    label: 'merge',
    detail: 'fan-in · map sources',
    x: 40,
    y: 42,
    lane: 'join',
  },
  {
    id: 'sp1',
    type: 'transform.condition',
    label: 'condition',
    detail: 'ports true / false',
    x: 56,
    y: 42,
  },
  {
    id: 's_score',
    type: 'transform.script',
    label: 'script · score',
    detail: 'sandbox JS risk model',
    x: 72,
    y: 22,
    lane: 'a',
  },
  {
    id: 's_vat',
    type: 'source.db.postgres',
    label: 'db · VAT',
    detail: 'EU tax lines',
    x: 72,
    y: 42,
    lane: 'b',
  },
  {
    id: 's_std',
    type: 'transform.map',
    label: 'map · standard',
    detail: 'normalize rows',
    x: 72,
    y: 62,
    lane: 'c',
  },
  {
    id: 'g2',
    type: 'transform.merge',
    label: 'merge',
    detail: 'join started branches',
    x: 86,
    y: 42,
    lane: 'join',
  },
  {
    id: 'n1',
    type: 'sink.email',
    label: 'email',
    detail: 'ops@… summary',
    x: 94,
    y: 28,
  },
  {
    id: 'c1',
    type: 'workflow.sub',
    label: 'sub · ship-order@v3',
    detail: 'with orderId',
    x: 94,
    y: 56,
  },
];

export const MOCK_EDGES: MockEdge[] = [
  { from: 't1', to: 's_orders' },
  { from: 't1', to: 's_erp' },
  { from: 't1', to: 's_files' },
  { from: 's_orders', to: 'g1' },
  { from: 's_erp', to: 'g1' },
  { from: 's_files', to: 'g1' },
  { from: 'g1', to: 'sp1' },
  { from: 'sp1', to: 's_score', label: 'true · amount > 1k' },
  { from: 'sp1', to: 's_vat', label: 'true · region = EU' },
  { from: 'sp1', to: 's_std', label: 'false' },
  { from: 's_score', to: 'g2' },
  { from: 's_vat', to: 'g2' },
  { from: 's_std', to: 'g2' },
  { from: 'g2', to: 'n1' },
  { from: 'g2', to: 'c1' },
];

export const MOCK_PALETTE: { type: PipeTypeId; label: string; hint: string }[] = [
  {
    type: 'source.trigger.cron',
    label: 'Trigger',
    hint: 'manual · cron · webhook · http · parent',
  },
  { type: 'source.db.postgres', label: 'DB source', hint: 'source.db.*' },
  { type: 'source.api.http', label: 'HTTP source', hint: 'source.api.http' },
  { type: 'source.file.csv', label: 'File source', hint: 'csv · json · text' },
  { type: 'transform.script', label: 'Script', hint: 'transform.script (JS)' },
  { type: 'transform.http', label: 'HTTP transform', hint: 'transform.http' },
  { type: 'transform.condition', label: 'Condition', hint: 'true / false ports' },
  { type: 'transform.split', label: 'Split', hint: 'partition by field' },
  { type: 'transform.merge', label: 'Merge', hint: 'fan-in join' },
  { type: 'logic.loop', label: 'Loop', hint: 'logic.loop' },
  { type: 'workflow.sub', label: 'Sub-workflow', hint: 'workflow.sub' },
  { type: 'sink.email', label: 'Email', hint: 'sink.email' },
  { type: 'sink.postgres', label: 'DB sink', hint: 'sink.postgres' },
  { type: 'human.gate', label: 'Human gate', hint: 'pause for input' },
];

export const MOCK_RUNS: MockRun[] = [
  {
    id: 'run_8f2a',
    workflow: MOCK_WORKFLOW_NAME,
    trigger: 'cron',
    status: 'succeeded',
    startedAt: '2026-09-12 15:00:02',
    durationMs: 12_480,
  },
  {
    id: 'run_8f19',
    workflow: MOCK_WORKFLOW_NAME,
    trigger: 'manual',
    status: 'running',
    startedAt: '2026-09-12 16:42:11',
    durationMs: null,
  },
  {
    id: 'run_8e91',
    workflow: MOCK_WORKFLOW_NAME,
    trigger: 'webhook',
    status: 'failed',
    startedAt: '2026-09-12 14:11:44',
    durationMs: 3_902,
  },
  {
    id: 'run_8e40',
    workflow: 'archive-inbox-csv',
    trigger: 'http',
    status: 'succeeded',
    startedAt: '2026-09-12 12:03:01',
    durationMs: 890,
  },
  {
    id: 'run_8dcc',
    workflow: MOCK_WORKFLOW_NAME,
    trigger: 'cron',
    status: 'cancelled',
    startedAt: '2026-09-11 21:00:00',
    durationMs: 210,
  },
];

export const MOCK_VARIABLES: MockVariable[] = [
  { scope: 'global', name: 'ops_email', value: 'ops@example.com' },
  { scope: 'global', name: 'default_tz', value: 'America/Chicago' },
  { scope: 'workflow', name: 'orderId', value: '{{vars.orderId}}' },
  { scope: 'workflow', name: 'region', value: 'EU' },
  { scope: 'run', name: 'sources.failed', value: '[]' },
];

export const MOCK_CREDENTIALS: MockCredential[] = [
  { id: 'cred_pg', kind: 'database', name: 'orders-pg' },
  { id: 'cred_smtp', kind: 'http', name: 'smtp-prod' },
  { id: 'cred_hook', kind: 'webhook', name: 'ingress-hmac' },
];

export type EngineState = 'enabled' | 'draining' | 'disabled';
export type OverlapPolicy = 'skip' | 'queue' | 'parallel';
export type LogSinkKind = 'events' | 'json' | 'text';

export interface MockEngineProcess {
  id: 'api' | 'scheduler' | 'worker';
  label: string;
  status: 'up' | 'down';
  detail: string;
}

export interface MockEngineConfig {
  state: EngineState;
  endpoint: string;
  maxParallel: number;
  overlap: OverlapPolicy;
  processes: MockEngineProcess[];
  sinks: { kind: LogSinkKind; enabled: boolean; target: string }[];
}

export function pipeFamily(type: PipeTypeId): string {
  if (type.startsWith('source.trigger')) return 'trigger';
  if (type.startsWith('source.')) return 'source';
  if (type.startsWith('transform.')) return 'transform';
  if (type.startsWith('sink.')) return 'sink';
  if (
    type.startsWith('logic.') ||
    type.startsWith('workflow.') ||
    type.startsWith('human.')
  ) {
    return 'control';
  }
  return 'pipe';
}

export function inspectorConfig(pipe: MockPipe): string {
  switch (pipe.type) {
    case 'transform.condition':
      return `type: transform.condition\nports: true | false\nrules:\n  - amount > 1000 → score\n  - region == EU → vat\n  - else → standard`;
    case 'transform.merge':
      return `type: transform.merge\njoin: all`;
    case 'transform.split':
      return `type: transform.split\nfield: region`;
    case 'sink.email':
      return `type: sink.email\nto: {{vars.ops_email}}\ncredentialId: cred_smtp`;
    case 'workflow.sub':
      return `type: workflow.sub\nuses: ship-order@v3\nwith:\n  orderId: {{vars.orderId}}`;
    case 'source.trigger.cron':
      return `workflow.triggers[]:\n  kind: cron\n  expression: 0 */6 * * *\n  timezone: America/Chicago\nonOverlap: skip`;
    case 'transform.script':
      return `type: transform.script\nlanguage: js\nsandbox: worker-thread\n# python runtime not in FoxFlow yet`;
    default:
      return `type: ${pipe.type}\n${pipe.detail}`;
  }
}
