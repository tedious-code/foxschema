/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/registry/src/index.ts).
 */
export {
  PipeRegistry,
  FOXFLOW_PROVIDER,
  type RecordBatch,
  type HumanInputGateway,
  type PipeContext,
  type RunOutputCollector,
  type AnyPipe,
  type SourcePipe,
  type TransformPipe,
  type SinkPipe,
} from './pipes.js';
export { loadPipePlugin, type PipePluginManifest } from './plugins.js';
export {
  assertApproved,
  parseAllowlist,
  pluginDigest,
  PluginNotApprovedError,
  PluginDigestMismatchError,
  type PluginApproval,
} from './plugin-approval.js';
