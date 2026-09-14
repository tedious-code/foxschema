/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/compiler/src/index.ts).
 */
export {
  assertRunnableRoots,
  planExecution,
  planWorkflow,
  type ExecutionPlan,
} from './plan.js';
export {
  SUB_WORKFLOW_PIPE_TYPE,
  CircularWorkflowError,
  referencedWorkflowIds,
  assertNoWorkflowCycles,
} from './workflow-graph.js';
