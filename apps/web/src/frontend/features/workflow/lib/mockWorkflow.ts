/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Static sample graph for the Workflow UI mockup — not executed.
 */

export type WorkflowPane = 'designer' | 'runs' | 'engine' | 'variables';

export type StepKind =
  | 'trigger'
  | 'sql'
  | 'js'
  | 'python'
  | 'http'
  | 'notify'
  | 'split'
  | 'gather'
  | 'call'
  | 'vars';

export interface MockStep {
  id: string;
  kind: StepKind;
  label: string;
  detail: string;
  /** Canvas position (percent of designer board). */
  x: number;
  y: number;
  /** Parallel lane hint for the mock graph. */
  lane?: 'a' | 'b' | 'c' | 'join';
}

export interface MockEdge {
  from: string;
  to: string;
  label?: string;
}

export interface MockRun {
  id: string;
  workflow: string;
  trigger: 'manual' | 'cron' | 'webhook' | 'folder';
  status: 'succeeded' | 'running' | 'failed' | 'cancelled';
  startedAt: string;
  durationMs: number | null;
}

export interface MockVariable {
  scope: 'global' | 'workflow' | 'run';
  name: string;
  value: string;
  secret?: boolean;
}

export const MOCK_WORKFLOW_NAME = 'gather-orders-and-notify';
export const MOCK_WORKFLOW_VERSION = 'v3';

/** Multi-source gather → conditional split → notify/load. */
export const MOCK_STEPS: MockStep[] = [
  {
    id: 't1',
    kind: 'trigger',
    label: 'cron',
    detail: '0 */6 * * * · America/Chicago',
    x: 6,
    y: 42,
  },
  {
    id: 's_orders',
    kind: 'sql',
    label: 'sql · orders',
    detail: 'SELECT … FROM orders',
    x: 22,
    y: 18,
    lane: 'a',
  },
  {
    id: 's_erp',
    kind: 'http',
    label: 'http · ERP',
    detail: 'GET /v1/shipments',
    x: 22,
    y: 42,
    lane: 'b',
  },
  {
    id: 's_files',
    kind: 'js',
    label: 'js · inbox',
    detail: 'list drop folder CSVs',
    x: 22,
    y: 66,
    lane: 'c',
  },
  {
    id: 'g1',
    kind: 'gather',
    label: 'gather',
    detail: 'join: all · map sources',
    x: 40,
    y: 42,
    lane: 'join',
  },
  {
    id: 'sp1',
    kind: 'split',
    label: 'split',
    detail: 'exclusive · amount / region',
    x: 56,
    y: 42,
  },
  {
    id: 's_approve',
    kind: 'python',
    label: 'python · score',
    detail: 'risk model',
    x: 72,
    y: 18,
    lane: 'a',
  },
  {
    id: 's_vat',
    kind: 'sql',
    label: 'sql · VAT',
    detail: 'EU tax lines',
    x: 72,
    y: 42,
    lane: 'b',
  },
  {
    id: 's_std',
    kind: 'js',
    label: 'js · standard',
    detail: 'normalize rows',
    x: 72,
    y: 66,
    lane: 'c',
  },
  {
    id: 'g2',
    kind: 'gather',
    label: 'gather',
    detail: 'waitFor: started',
    x: 86,
    y: 42,
    lane: 'join',
  },
  {
    id: 'n1',
    kind: 'notify',
    label: 'notify · email',
    detail: 'ops@… summary',
    x: 94,
    y: 28,
  },
  {
    id: 'c1',
    kind: 'call',
    label: 'call · ship-order@v3',
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
  { from: 'sp1', to: 's_approve', label: 'amount > 1k' },
  { from: 'sp1', to: 's_vat', label: 'region = EU' },
  { from: 'sp1', to: 's_std', label: 'else' },
  { from: 's_approve', to: 'g2' },
  { from: 's_vat', to: 'g2' },
  { from: 's_std', to: 'g2' },
  { from: 'g2', to: 'n1' },
  { from: 'g2', to: 'c1' },
];

export const MOCK_PALETTE: { kind: StepKind; label: string; hint: string }[] = [
  { kind: 'trigger', label: 'Trigger', hint: 'manual · cron · webhook · folder' },
  { kind: 'sql', label: 'SQL', hint: 'dialect execute' },
  { kind: 'js', label: 'JS / TS', hint: 'sandbox + sql bridge' },
  { kind: 'python', label: 'Python', hint: 'sandbox (later)' },
  { kind: 'http', label: 'HTTP', hint: 'REST / GraphQL' },
  { kind: 'notify', label: 'Notify', hint: 'email · SMS · Firebase' },
  { kind: 'split', label: 'Split', hint: 'exclusive / inclusive' },
  { kind: 'gather', label: 'Gather', hint: 'join active branches' },
  { kind: 'call', label: 'Sub-workflow', hint: 'inputs / outputs' },
  { kind: 'vars', label: 'Set var', hint: 'workflow / run scope' },
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
    trigger: 'folder',
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
  { scope: 'workflow', name: 'orderId', value: '${{ trigger.payload.orderId }}' },
  { scope: 'workflow', name: 'region', value: 'EU' },
  { scope: 'workflow', name: 'smtp', value: 'secret:smtp-prod', secret: true },
  { scope: 'run', name: 'sources.failed', value: '[]' },
];

export type EngineState = 'enabled' | 'draining' | 'disabled';
export type LogSinkKind = 'db' | 'json' | 'text';

export interface MockEngineConfig {
  state: EngineState;
  endpoint: string;
  maxParallel: number;
  sinks: { kind: LogSinkKind; enabled: boolean; target: string }[];
}
