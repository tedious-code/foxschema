/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/index.ts).
 */
export * from './credentials/index.js';
export {
  PIPE_FAMILIES,
  PIPE_FAMILY_LABELS,
  pipeFamilySchema,
  AUTH_METHODS,
  PROMPT_CHANNELS,
  authMethodSchema,
  promptChannelSchema,
  type PipeFamily,
  type AuthMethod,
  type PromptChannel,
} from './pipes/families.js';
export {
  AUTH_METHOD_FIELDS,
  AUTH_METHOD_SHAPE,
} from './auth/methods.js';
export {
  fieldSchema,
  contractSchema,
  type FieldDef,
  type ContractDef,
} from './definitions/contract.js';
export {
  pipeSchema,
  edgeSchema,
  retrySchema,
  pipeRoleSchema,
  type PipeDef,
  type EdgeDef,
  type RetryDef,
  type PipeRole,
} from './definitions/pipe.js';
export {
  pipelineSchema,
  parsePipeline,
  assertPipelineGraph,
  type PipelineDef,
} from './definitions/pipeline.js';
export {
  workflowSchema,
  triggerSchema,
  TRIGGER_KINDS,
  JWT_ALGORITHMS,
  webhookAuthSchema,
  type TriggerKind,
  type WebhookAuth,
  overlapPolicySchema,
  dependencySchema,
  parseWorkflow,
  parseWorkflowInput,
  normalizeWorkflowDocument,
  parseDurationMs,
  workflowFromPipeline,
  type WorkflowDef,
  type TriggerDef,
  type DependencyDef,
  type MiddlewareRef,
} from './definitions/workflow.js';
export {
  httpRequestSchema,
  httpAuthSchema,
  httpBodySchema,
  httpSessionSchema,
  httpTokenRefreshSchema,
  httpRequestJsonSchema,
  coerceHttpRequest,
  parseHttpRequest,
  httpKvQueryKey,
  HTTP_KV_OPS,
  composeBodyFields,
  HttpBodyValidationError,
  HTTP_BODY_FIELD_TYPES,
  type HttpBodyField,
  type HttpBodyFieldType,
  type HttpKvOp,
  type HttpRequestDef,
  type HttpAuth,
  type HttpBody,
  type HttpKv,
  type HttpSession,
  type HttpTokenRefresh,
} from './definitions/http-request.js';
export {
  WorkflowInputError,
  isValidJsonSchema,
  validateAgainstSchema,
  validateWorkflowInput,
} from './definitions/io-schema.js';
export type {
  RunStatus,
  PipelineRunStatus,
  PipeRunStatus,
  WorkflowRunRecord,
  WorkflowCallResult,
  WorkflowService,
  TriggerInvocation,
  TriggerScheduleState,
  PipelineRunRecord,
  PipeRunRecord,
  RunEvent,
  Checkpoint,
} from './types.js';
export type {
  WorkflowStore,
  RunStore,
  EventStore,
  CheckpointStore,
  TriggerScheduleStore,
  WorkflowSummaryRecord,
  EnvironmentRecord,
  EnvironmentStore,
  VariableRecord,
  VariableScope,
  VariableStore,
  NewRunEvent,
  HumanInputStore,
} from './storage.js';

export {
  HUMAN_INPUT_FIELD_TYPES,
  HumanInputRequired,
  humanInputFieldSchema,
  humanInputRequestSchema,
  isHumanInputRequired,
  redactAnswer,
  type HumanInputField,
  type HumanInputRecord,
  type HumanInputRequest,
  type HumanInputStatus,
} from './human-input.js';

export {
  PREDICATE_OPERATORS,
  applyPredicate,
  getPath,
  predicateOperatorSchema,
  type PredicateOperator,
} from './definitions/predicate.js';
export {
  conditionSchema,
  conditionsSchema,
  type TriggerCondition,
} from './definitions/conditions.js';
