/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/pipes/control/src/index.ts).
 */
export { mergeBatches, MergePipe, type MergeOptions } from './merge/index.js';
export { splitBatch, SplitPipe, type SplitSelector } from './split/index.js';
export { goto, type GotoDirective } from './goto/index.js';
export {
  runLoop,
  LoopPipe,
  type LoopContext,
  type LoopResult,
} from './loop/index.js';
export { SubWorkflowPipe } from './sub-workflow/index.js';
export {
  HumanGatePipe,
  formFields,
  type HumanGateConfig,
} from './human-gate/index.js';
