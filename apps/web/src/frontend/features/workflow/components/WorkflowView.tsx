/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow workspace mockup — designer, runs, engine control, variables.
 * Visual only; no FoxWorkflow API yet.
 */
import React, { useMemo, useState } from 'react';
import {
  Activity,
  Braces,
  GitBranch,
  Play,
  Power,
  Settings2,
  Workflow,
} from 'lucide-react';
import {
  MOCK_EDGES,
  MOCK_PALETTE,
  MOCK_RUNS,
  MOCK_STEPS,
  MOCK_VARIABLES,
  MOCK_WORKFLOW_NAME,
  MOCK_WORKFLOW_VERSION,
  type EngineState,
  type MockEngineConfig,
  type MockStep,
  type StepKind,
  type WorkflowPane,
} from '../lib/mockWorkflow';

const PANES: {
  id: WorkflowPane;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'designer', label: 'Designer', icon: Workflow },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'engine', label: 'Engine', icon: Power },
  { id: 'variables', label: 'Variables', icon: Braces },
];

const KIND_TONE: Record<StepKind, string> = {
  trigger: 'border-violet-500/40 bg-violet-950/40 text-violet-200',
  sql: 'border-cyan-500/40 bg-cyan-950/40 text-cyan-100',
  js: 'border-amber-500/40 bg-amber-950/40 text-amber-100',
  python: 'border-yellow-500/40 bg-yellow-950/35 text-yellow-100',
  http: 'border-sky-500/40 bg-sky-950/40 text-sky-100',
  notify: 'border-rose-500/40 bg-rose-950/40 text-rose-100',
  split: 'border-fuchsia-500/40 bg-fuchsia-950/40 text-fuchsia-100',
  gather: 'border-emerald-500/40 bg-emerald-950/40 text-emerald-100',
  call: 'border-indigo-500/40 bg-indigo-950/40 text-indigo-100',
  vars: 'border-slate-500/40 bg-slate-900 text-slate-200',
};

const STATUS_TONE: Record<string, string> = {
  succeeded: 'text-emerald-300 bg-emerald-950/50 border-emerald-500/30',
  running: 'text-cyan-300 bg-cyan-950/50 border-cyan-500/30',
  failed: 'text-rose-300 bg-rose-950/50 border-rose-500/30',
  cancelled: 'text-slate-400 bg-slate-900 border-slate-600/40',
};

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function stepById(id: string): MockStep | undefined {
  return MOCK_STEPS.find((s) => s.id === id);
}

function DesignerPane({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const selected = stepById(selectedId) ?? MOCK_STEPS[0];
  const outgoing = MOCK_EDGES.filter((e) => e.from === selected.id);
  const incoming = MOCK_EDGES.filter((e) => e.to === selected.id);

  return (
    <div className="flex min-h-0 flex-1" data-testid="workflow-designer">
      <aside className="flex w-48 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
        <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Steps
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {MOCK_PALETTE.map((item) => (
            <li key={item.kind}>
              <button
                type="button"
                data-testid={`workflow-palette-${item.kind}`}
                className={`flex w-full flex-col items-start rounded-md border px-2 py-1.5 text-left transition hover:bg-slate-900 ${KIND_TONE[item.kind]}`}
                title="Mockup — drag/drop not wired"
              >
                <span className="text-[11px] font-semibold">{item.label}</span>
                <span className="text-[10px] opacity-70">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.12)_1px,transparent_0)] [background-size:16px_16px]">
        <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-md border border-slate-700 bg-slate-950/90 px-2.5 py-1.5 text-[11px]">
          <GitBranch className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-semibold text-slate-200">{MOCK_WORKFLOW_NAME}</span>
          <span className="rounded border border-slate-600 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
            {MOCK_WORKFLOW_VERSION}
          </span>
          <span className="rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
            Mockup
          </span>
          <button
            type="button"
            data-testid="workflow-run-now"
            className="ml-1 inline-flex items-center gap-1 rounded border border-cyan-500/40 bg-cyan-950/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-100 hover:bg-cyan-900/50"
          >
            <Play className="h-3 w-3" />
            Run now
          </button>
        </div>

        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {MOCK_EDGES.map((edge) => {
            const a = stepById(edge.from);
            const b = stepById(edge.to);
            if (!a || !b) return null;
            const x1 = a.x + 4;
            const y1 = a.y + 4;
            const x2 = b.x;
            const y2 = b.y + 4;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line
                  x1={`${x1}%`}
                  y1={`${y1}%`}
                  x2={`${x2}%`}
                  y2={`${y2}%`}
                  stroke="rgb(71 85 105)"
                  strokeWidth="1.5"
                  markerEnd="url(#wf-arrow)"
                />
                {edge.label ? (
                  <text
                    x={`${mx}%`}
                    y={`${my}%`}
                    fill="rgb(148 163 184)"
                    fontSize="9"
                    textAnchor="middle"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <defs>
            <marker
              id="wf-arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L6,3 L0,6 Z" fill="rgb(100 116 139)" />
            </marker>
          </defs>
        </svg>

        {MOCK_STEPS.map((step) => {
          const on = step.id === selected.id;
          return (
            <button
              key={step.id}
              type="button"
              data-testid={`workflow-node-${step.id}`}
              onClick={() => onSelect(step.id)}
              style={{ left: `${step.x}%`, top: `${step.y}%` }}
              className={`absolute z-[1] w-[9.5rem] -translate-y-1/2 rounded-md border px-2 py-1.5 text-left shadow-sm transition ${
                KIND_TONE[step.kind]
              } ${on ? 'ring-2 ring-cyan-400/70' : 'hover:brightness-110'}`}
            >
              <div className="truncate text-[11px] font-semibold">{step.label}</div>
              <div className="truncate text-[10px] opacity-75">{step.detail}</div>
            </button>
          );
        })}
      </div>

      <aside
        className="flex w-64 shrink-0 flex-col border-l border-slate-800 bg-slate-950/90"
        data-testid="workflow-inspector"
      >
        <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Inspector
        </div>
        <div className="space-y-3 overflow-y-auto p-3 text-xs">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Kind
            </div>
            <div className="mt-0.5 font-semibold text-slate-100">{selected.kind}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Label
            </div>
            <div className="mt-0.5 text-slate-200">{selected.label}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Config
            </div>
            <pre className="mt-1 overflow-x-auto rounded border border-slate-800 bg-slate-900/80 p-2 font-mono text-[10px] text-slate-300">
              {selected.kind === 'split'
                ? `mode: exclusive\ncases:\n  - when: amount > 1000 → score\n  - when: region == EU → vat\n  - else → standard`
                : selected.kind === 'gather'
                  ? `waitFor: started\njoin: all\nfrom: activated branches`
                  : selected.kind === 'notify'
                    ? `channel: email\nto: \${{ global.ops_email }}\nbody: summary template`
                    : selected.kind === 'call'
                      ? `uses: ship-order@v3\nwith:\n  orderId: \${{ vars.orderId }}\nsecrets: inherit`
                      : selected.detail}
            </pre>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              In ({incoming.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-slate-400">
              {incoming.length === 0 ? (
                <li>—</li>
              ) : (
                incoming.map((e) => (
                  <li key={`${e.from}-${e.to}`}>{stepById(e.from)?.label ?? e.from}</li>
                ))
              )}
            </ul>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Out ({outgoing.length})
            </div>
            <ul className="mt-1 space-y-0.5 text-slate-400">
              {outgoing.length === 0 ? (
                <li>—</li>
              ) : (
                outgoing.map((e) => (
                  <li key={`${e.from}-${e.to}`}>
                    {stepById(e.to)?.label ?? e.to}
                    {e.label ? (
                      <span className="text-slate-500"> · {e.label}</span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}

function RunsPane(): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workflow-runs">
      <div className="border-b border-slate-800 px-4 py-2 text-[11px] text-slate-400">
        Recent runs across workflows (mock data)
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-950 text-[10px] uppercase tracking-wide text-slate-500">
            <tr className="border-b border-slate-800">
              <th className="px-4 py-2 font-bold">Run</th>
              <th className="px-4 py-2 font-bold">Workflow</th>
              <th className="px-4 py-2 font-bold">Trigger</th>
              <th className="px-4 py-2 font-bold">Status</th>
              <th className="px-4 py-2 font-bold">Started</th>
              <th className="px-4 py-2 font-bold">Duration</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_RUNS.map((run) => (
              <tr
                key={run.id}
                data-testid={`workflow-run-row-${run.id}`}
                className="border-b border-slate-800/80 hover:bg-slate-900/50"
              >
                <td className="px-4 py-2 font-mono text-slate-300">{run.id}</td>
                <td className="px-4 py-2 text-slate-200">{run.workflow}</td>
                <td className="px-4 py-2 text-slate-400">{run.trigger}</td>
                <td className="px-4 py-2">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_TONE[run.status]}`}
                  >
                    {run.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-slate-400">{run.startedAt}</td>
                <td className="px-4 py-2 text-slate-400">
                  {formatDuration(run.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EnginePane({
  config,
  onChange,
}: {
  config: MockEngineConfig;
  onChange: (next: MockEngineConfig) => void;
}): React.ReactElement {
  const setState = (state: EngineState) => onChange({ ...config, state });

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      data-testid="workflow-engine"
    >
      <section className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Settings2 className="h-4 w-4 text-slate-400" />
          FoxWorkflow control
          <span className="rounded border border-amber-500/30 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-200">
            Mockup
          </span>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Engine state">
          {(
            [
              ['enabled', 'Enabled'],
              ['draining', 'Draining'],
              ['disabled', 'Disabled'],
            ] as const
          ).map(([id, label]) => {
            const on = config.state === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`workflow-engine-${id}`}
                onClick={() => setState(id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  on
                    ? 'border-cyan-500/50 bg-cyan-950/50 text-cyan-100'
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="mt-4 flex max-w-xl flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Engine endpoint
          </span>
          <input
            data-testid="workflow-engine-endpoint"
            value={config.endpoint}
            onChange={(e) => onChange({ ...config, endpoint: e.target.value })}
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none accent-focus"
          />
        </label>
        <label className="mt-3 flex max-w-xs flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            Max parallel steps
          </span>
          <input
            type="number"
            min={1}
            max={64}
            data-testid="workflow-engine-max-parallel"
            value={config.maxParallel}
            onChange={(e) =>
              onChange({
                ...config,
                maxParallel: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className="rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none accent-focus"
          />
        </label>
      </section>

      <section className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Log sinks</div>
        <ul className="space-y-2">
          {config.sinks.map((sink, idx) => (
            <li
              key={sink.kind}
              className="flex flex-wrap items-center gap-3 rounded border border-slate-800 bg-slate-900/50 px-3 py-2"
            >
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                <input
                  type="checkbox"
                  data-testid={`workflow-sink-${sink.kind}`}
                  checked={sink.enabled}
                  onChange={(e) => {
                    const sinks = config.sinks.map((s, i) =>
                      i === idx ? { ...s, enabled: e.target.checked } : s
                    );
                    onChange({ ...config, sinks });
                  }}
                />
                {sink.kind === 'db'
                  ? 'Database'
                  : sink.kind === 'json'
                    ? 'JSON files'
                    : 'Text files'}
              </label>
              <input
                value={sink.target}
                onChange={(e) => {
                  const sinks = config.sinks.map((s, i) =>
                    i === idx ? { ...s, target: e.target.value } : s
                  );
                  onChange({ ...config, sinks });
                }}
                className="min-w-[16rem] flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-[11px] text-slate-300 outline-none accent-focus"
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function VariablesPane(): React.ReactElement {
  const scopes = useMemo(
    () => ['global', 'workflow', 'run'] as const,
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workflow-variables">
      <div className="border-b border-slate-800 px-4 py-2 text-[11px] text-slate-400">
        Global · workflow · run scopes (mock). Secrets never render plaintext in real
        runs.
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid gap-4 lg:grid-cols-3">
          {scopes.map((scope) => (
            <section
              key={scope}
              className="rounded-md border border-slate-800 bg-slate-950/60"
              data-testid={`workflow-vars-${scope}`}
            >
              <div className="border-b border-slate-800 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {scope}
              </div>
              <ul className="divide-y divide-slate-800/80">
                {MOCK_VARIABLES.filter((v) => v.scope === scope).map((v) => (
                  <li key={v.name} className="px-3 py-2 text-xs">
                    <div className="font-mono font-semibold text-slate-200">{v.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {v.secret ? '••••••••' : v.value}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export const WorkflowView: React.FC = () => {
  const [pane, setPane] = useState<WorkflowPane>('designer');
  const [selectedId, setSelectedId] = useState(MOCK_STEPS[0]?.id ?? 't1');
  const [engine, setEngine] = useState<MockEngineConfig>({
    state: 'enabled',
    endpoint: 'https://foxworkflow.local:8787',
    maxParallel: 8,
    sinks: [
      { kind: 'db', enabled: true, target: 'foxworkflow.runs (postgres)' },
      { kind: 'json', enabled: true, target: '/var/log/foxworkflow/runs/*.json' },
      { kind: 'text', enabled: false, target: '/var/log/foxworkflow/app.log' },
    ],
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="workflow-view">
      <nav
        className="mx-3 mb-0 mt-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/50 p-0.5"
        aria-label="Workflow"
        data-testid="workflow-menu"
      >
        <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Workflow
        </span>
        {PANES.map((p) => {
          const active = pane === p.id;
          return (
            <button
              key={p.id}
              type="button"
              data-testid={`workflow-tab-${p.id}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => setPane(p.id)}
              className={`flex cursor-pointer items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition ${
                active
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <p.icon className="h-3.5 w-3.5 shrink-0" />
              {p.label}
            </button>
          );
        })}
        <span className="ml-auto px-2 text-[10px] text-slate-500">
          Control plane UI · execution stays on FoxWorkflow
        </span>
      </nav>

      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-slate-800">
        {pane === 'designer' ? (
          <DesignerPane selectedId={selectedId} onSelect={setSelectedId} />
        ) : null}
        {pane === 'runs' ? <RunsPane /> : null}
        {pane === 'engine' ? <EnginePane config={engine} onChange={setEngine} /> : null}
        {pane === 'variables' ? <VariablesPane /> : null}
      </div>
    </div>
  );
};
