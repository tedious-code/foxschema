/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * The browser-safe part of the engine: workflow definitions, their schemas and
 * the wire types of what the engine stores. The designer types itself from
 * here instead of keeping copies that drift.
 *
 * Only modules whose runtime imports are zod, ajv and cron-parser may be
 * re-exported as values. Everything else — stores, credentials crypto, pipes —
 * is exported as types only, which the bundler erases.
 * `definitions-purity.test.ts` enforces this.
 */
export * from './common/definitions/workflow.js';
export * from './common/definitions/http-request.js';
export * from './common/definitions/io-schema.js';
export * from './common/definitions/pipe.js';
export * from './common/definitions/pipeline.js';
export * from './common/definitions/conditions.js';
export * from './common/definitions/predicate.js';
export * from './common/definitions/contract.js';
export * from './common/pipes/families.js';
export { credentialSourceSchema, type CredentialSource } from './common/credentials/providers.js';

export type { CredentialKind, CredentialMeta } from './common/credentials/store.js';
export type { PipeMetadata, PipeProvider, PortDef } from './sdk/pipe/metadata.js';
export type {
  PipelineRunRecord,
  PipeRunRecord,
  RunEvent,
  RunStatus,
  WorkflowRunRecord,
} from './common/types.js';
export type { EnvironmentRecord, VariableRecord, VariableScope } from './common/storage.js';
export type {
  ColumnCheck,
  ColumnCheckKind,
  ColumnRule,
  ColumnType,
  FixedWidthColumn,
} from './pipes/utility/delimited.js';
