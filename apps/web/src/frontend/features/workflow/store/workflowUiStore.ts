/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which Workflow pane is open, and the workflow being designed.
 */
import { create } from 'zustand';

export type WorkflowPane = 'designer' | 'workflows' | 'runs' | 'variables' | 'credentials' | 'engine';

interface WorkflowUiState {
  view: WorkflowPane;
  busy: boolean;
  workflowId: string;
  setView: (view: WorkflowPane) => void;
  setBusy: (busy: boolean) => void;
  setWorkflowId: (id: string) => void;
}

export const useWorkflowUiStore = create<WorkflowUiState>((set) => ({
  view: 'designer',
  busy: false,
  workflowId: 'my-workflow',
  setView: (view) => set({ view }),
  setBusy: (busy) => set({ busy }),
  setWorkflowId: (workflowId) => set({ workflowId }),
}));
