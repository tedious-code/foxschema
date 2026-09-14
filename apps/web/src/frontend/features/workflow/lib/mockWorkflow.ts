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

/** FoxFlow `triggerSchema` kinds (live on the workflow, not only as canvas pipes). */
export type TriggerKind = 'manual' | 'cron' | 'webhook' | 'http' | 'parent';

export interface MockTrigger {
  id: string;
  kind: TriggerKind;
  enabled: boolean;
  /** Cron expression / path / note for the mock inspector. */
  detail: string;
}

export interface MockRun {
  id: string;
  workflow: string;
  trigger: TriggerKind;
  status: 'succeeded' | 'running' | 'failed' | 'cancelled';
  startedAt: string;
  durationMs: number | null;
}

/** Authoritative FoxFlow built-in pipe type ids (from packages/pipes). */
export const FOXFLOW_PIPE_TYPES = [
  'source.triggerPayload',
  'source.trigger.manual',
  'source.trigger.cron',
  'source.trigger.webhook',
  'source.trigger.http',
  'source.trigger.parent',
  'source.api.http',
  'source.api.http.multi',
  'source.db.postgres',
  'source.db.mysql',
  'source.file.csv',
  'source.file.json',
  'source.file.text',
  'transform.map',
  'transform.condition',
  'transform.split',
  'transform.merge',
  'transform.script',
  'transform.verify',
  'transform.http',
  'transform.ai.generate',
  'logic.loop',
  'workflow.sub',
  'human.gate',
  'sink.postgres',
  'sink.mysql',
  'sink.http',
  'sink.email',
  'sink.file.delimited',
  'sink.response',
] as const;

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

/** FoxFlow `workflow.triggers[]` — admission bindings on the workflow document. */
export const MOCK_TRIGGERS: MockTrigger[] = [
  {
    id: 'trg_manual',
    kind: 'manual',
    enabled: true,
    detail: 'POST /workflows/:id/run',
  },
  {
    id: 'trg_cron',
    kind: 'cron',
    enabled: true,
    detail: '0 */6 * * * · America/Chicago · catchUp: none',
  },
  {
    id: 'trg_webhook',
    kind: 'webhook',
    enabled: true,
    detail: 'HMAC · credential: ingress-hmac',
  },
  {
    id: 'trg_http',
    kind: 'http',
    enabled: false,
    detail: 'authenticated ingress (disabled)',
  },
  {
    id: 'trg_parent',
    kind: 'parent',
    enabled: true,
    detail: 'callable via workflow.sub',
  },
];

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

/** Product palette groups (Designer sidebar). Orthogonal to FoxFlow type ids. */
export type PaletteGroupId =
  | 'triggers'
  | 'process'
  | 'transform'
  | 'notification'
  | 'control';

export interface MockPaletteItem {
  type: PipeTypeId;
  label: string;
  hint: string;
}

export interface MockPaletteGroup {
  id: PaletteGroupId;
  label: string;
  items: MockPaletteItem[];
}

/**
 * Palette grouped for authoring: triggers → process (I/O) → transform →
 * notification → control. FoxFlow `category` strings (Source/Database, …)
 * stay on the engine; this is the mock UX lens.
 */
export const MOCK_PALETTE_GROUPS: MockPaletteGroup[] = [
  {
    id: 'triggers',
    label: 'Triggers',
    items: [
      {
        type: 'source.trigger.manual',
        label: 'Manual',
        hint: 'source.trigger.manual',
      },
      {
        type: 'source.trigger.cron',
        label: 'Cron',
        hint: 'source.trigger.cron',
      },
      {
        type: 'source.trigger.webhook',
        label: 'Webhook',
        hint: 'source.trigger.webhook',
      },
      {
        type: 'source.trigger.http',
        label: 'HTTP',
        hint: 'source.trigger.http',
      },
      {
        type: 'source.trigger.parent',
        label: 'Parent',
        hint: 'source.trigger.parent',
      },
    ],
  },
  {
    id: 'process',
    label: 'Process',
    items: [
      {
        type: 'source.db.postgres',
        label: 'DB source',
        hint: 'source.db.*',
      },
      {
        type: 'source.api.http',
        label: 'HTTP source',
        hint: 'source.api.http',
      },
      {
        type: 'source.file.csv',
        label: 'File source',
        hint: 'csv · json · text',
      },
      {
        type: 'sink.postgres',
        label: 'DB sink',
        hint: 'sink.postgres',
      },
      {
        type: 'sink.http',
        label: 'HTTP sink',
        hint: 'sink.http',
      },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    items: [
      {
        type: 'transform.script',
        label: 'Script',
        hint: 'transform.script (JS)',
      },
      {
        type: 'transform.map',
        label: 'Map',
        hint: 'transform.map',
      },
      {
        type: 'transform.http',
        label: 'HTTP',
        hint: 'transform.http',
      },
      {
        type: 'transform.condition',
        label: 'Condition',
        hint: 'true / false ports',
      },
      {
        type: 'transform.split',
        label: 'Split',
        hint: 'partition by field',
      },
      {
        type: 'transform.merge',
        label: 'Merge',
        hint: 'fan-in join',
      },
      {
        type: 'logic.loop',
        label: 'Loop',
        hint: 'logic.loop',
      },
    ],
  },
  {
    id: 'notification',
    label: 'Notification',
    items: [
      {
        type: 'sink.email',
        label: 'Email',
        hint: 'sink.email',
      },
    ],
  },
  {
    id: 'control',
    label: 'Control',
    items: [
      {
        type: 'workflow.sub',
        label: 'Sub-workflow',
        hint: 'workflow.sub',
      },
      {
        type: 'human.gate',
        label: 'Human gate',
        hint: 'pause for input',
      },
    ],
  },
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
/** FoxFlow `overlapPolicySchema` / `workflow.onOverlap`. */
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
  /** Maps to FoxFlow `workflow.onOverlap`. */
  onOverlap: OverlapPolicy;
  processes: MockEngineProcess[];
  sinks: { kind: LogSinkKind; enabled: boolean; target: string }[];
}

/**
 * Canvas / palette tone family. Maps FoxFlow type prefixes onto the product
 * groups (triggers · process · transform · notification · control).
 */
export function pipeFamily(type: PipeTypeId): PaletteGroupId | 'pipe' {
  if (type.startsWith('source.trigger')) return 'triggers';
  if (type === 'sink.email') return 'notification';
  if (type.startsWith('source.') || type.startsWith('sink.')) return 'process';
  if (type.startsWith('transform.') || type.startsWith('logic.')) {
    return 'transform';
  }
  if (type.startsWith('workflow.') || type.startsWith('human.')) {
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
