/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow workspace: the designer and the engine panes behind one tab strip.
 */
import React from 'react';
import { Activity, Braces, KeyRound, ListTree, Power, Workflow } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import '../workflow.css';
import { useWorkflowUiStore, type WorkflowPane } from '../store/workflowUiStore';
import { WorkflowDesigner } from './WorkflowDesigner';

const PANES: { id: WorkflowPane; label: string; icon: React.ElementType }[] = [
  { id: 'designer', label: 'Designer', icon: Workflow },
  { id: 'workflows', label: 'Workflows', icon: ListTree },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'variables', label: 'Variables', icon: Braces },
  { id: 'credentials', label: 'Credentials', icon: KeyRound },
  { id: 'engine', label: 'Engine', icon: Power },
];

export const WorkflowView: React.FC = () => {
  const pane = useWorkflowUiStore((s) => s.view);
  const setPane = useWorkflowUiStore((s) => s.setView);

  return (
    <div className="fox-workflow flex min-h-0 flex-1 flex-col" data-testid="workflow-view">
      <nav
        className="mx-3 mb-0 mt-2 flex shrink-0 flex-wrap items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/50 p-0.5"
        aria-label="Workflow"
        data-testid="workflow-menu"
      >
        <span className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Workflow</span>
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
                active ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <p.icon className="h-3.5 w-3.5 shrink-0" />
              {p.label}
            </button>
          );
        })}
      </nav>

      <div className="mt-2 flex min-h-0 flex-1 flex-col border-t border-slate-800">
        <WorkflowDesigner />
      </div>
    </div>
  );
};
