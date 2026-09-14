/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/triggers.ts).
 */
import type { CredentialMeta } from '../api/engineClient';
import type { HttpRequestValue } from '../components/HttpRequestEditor';

/**
 * The workflow trigger model the designer edits: the discriminated union, the
 * defaults a new trigger starts from, and the rules every trigger editor
 * shares.
 *
 * It used to live in `components/TriggerSettings.tsx`, beside a component
 * nothing rendered. The two editors that are rendered — the Triggers dialog and
 * the inspector's inline settings — each re-implemented parts of it, and had
 * already drifted: they filtered credentials differently.
 */

type CommonTrigger = { id: string; enabled: boolean };

/** What happens when a trigger fires while a run is still going. */
export type OverlapPolicy = 'skip' | 'queue' | 'parallel';

export interface CronRetryConfig {
  maxRetryAttempts: number;
  maxRetryDuration: string;
  minBackoffDuration: string;
  maxBackoffDuration: string;
  maxDoublings: number;
}

export function createCronRetryConfig(): CronRetryConfig {
  return {
    maxRetryAttempts: 0,
    maxRetryDuration: '0s',
    minBackoffDuration: '5s',
    maxBackoffDuration: '1h',
    maxDoublings: 5,
  };
}

/** How a webhook caller proves it may start the run. Mirrors the engine's `webhookAuthSchema`. */
export type WebhookAuthValue =
  | { type: 'none'; acknowledgeUnauthenticated: true }
  | {
      type: 'signature';
      credentialId: string;
      signatureHeader: string;
      timestampHeader: string;
      maxAgeSeconds: number;
    }
  | { type: 'basic'; credentialId: string }
  | { type: 'header'; credentialId: string; header: string }
  | {
      type: 'jwt';
      credentialId: string;
      header: string;
      algorithms: ('HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512')[];
      issuer?: string;
      audience?: string;
      clockToleranceSeconds: number;
    };

export type WorkflowTrigger =
  | (CommonTrigger & { kind: 'manual'; inputData?: unknown })
  | (CommonTrigger & {
      kind: 'cron';
      cron: string;
      timezone: string;
      catchUp: 'none' | 'one' | 'all';
      executionType: 'workflow' | 'http';
      /** Same shape as `source.api.http` — required when executionType is http. */
      http?: HttpRequestValue;
      retryConfig?: CronRetryConfig;
    })
  | (CommonTrigger & {
      kind: 'webhook';
      auth: WebhookAuthValue;
      methods: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
      /** Vanity path served at /api/hooks/<path>. */
      path?: string;
      idempotencyHeader: string;
      onMissingIdempotencyKey: 'reject' | 'fingerprint';
      maxBodyBytes: number;
    })
  | (CommonTrigger & {
      kind: 'http';
      credentialId: string;
      authHeader: string;
      idempotencyHeader: string;
      maxBodyBytes: number;
      requiredFields: string[];
    })
  | (CommonTrigger & {
      kind: 'poll';
      intervalSeconds: number;
      /** Same shape as `source.api.http`. */
      http: HttpRequestValue;
      resultsPath: string;
      dedupKey: string;
      maxItems: number;
      onFirstPoll: 'prime' | 'fire';
    })
  | (CommonTrigger & {
      kind: 'parent';
      /** Empty = any parent workflow may call via workflow.sub. */
      allowFrom: string[];
    })
  | (CommonTrigger & {
      kind: 'event';
      topic: string;
      filter?: string;
    })
  | (CommonTrigger & {
      kind: 'custom';
      pluginId: string;
      config: Record<string, unknown>;
    });

export const TRIGGER_KINDS = [
  'manual',
  'cron',
  'webhook',
  'http',
  'poll',
  'parent',
  'event',
  'custom',
] as const;

export function createTrigger(
  kind: WorkflowTrigger['kind'],
  id: string,
): WorkflowTrigger {
  const common = { id, enabled: true };
  switch (kind) {
    case 'manual':
      return { ...common, kind };
    case 'cron':
      return {
        ...common,
        kind,
        cron: '0 * * * *',
        timezone: 'UTC',
        catchUp: 'none',
        executionType: 'workflow',
      };
    case 'webhook':
      return {
        ...common,
        kind,
        // Signature is the strongest option and the historical default, so a
        // new webhook starts there rather than at the one that needs no setup.
        // The header names are wire protocol the engine verifies — not branding
        // for a rename to reach.
        auth: {
          type: 'signature',
          credentialId: '',
          signatureHeader: 'x-foxflow-signature',
          timestampHeader: 'x-foxflow-timestamp',
          maxAgeSeconds: 300,
        },
        methods: ['POST'],
        idempotencyHeader: 'x-idempotency-key',
        onMissingIdempotencyKey: 'reject',
        maxBodyBytes: 1_048_576,
      };
    case 'http':
      return {
        ...common,
        kind,
        credentialId: '',
        authHeader: 'authorization',
        idempotencyHeader: 'x-idempotency-key',
        maxBodyBytes: 1_048_576,
        requiredFields: [],
      };
    case 'poll':
      return {
        ...common,
        kind,
        intervalSeconds: 300,
        http: { url: '' } as HttpRequestValue,
        resultsPath: '',
        dedupKey: 'id',
        maxItems: 100,
        onFirstPoll: 'prime',
      };
    case 'parent':
      return { ...common, kind, allowFrom: [] };
    case 'event':
      return { ...common, kind, topic: 'workflow.events' };
    case 'custom':
      return { ...common, kind, pluginId: '', config: {} };
  }
}

/**
 * The credential a trigger authenticates with, wherever it lives: `http` keeps
 * it flat, `webhook` keeps it inside `auth`, and `auth: none` has none.
 */
export function triggerCredentialId(trigger: WorkflowTrigger): string {
  if (trigger.kind === 'http') return trigger.credentialId;
  if (trigger.kind !== 'webhook') return '';
  return trigger.auth.type === 'none' ? '' : trigger.auth.credentialId;
}

/** `trigger` with its credential set; unchanged for kinds (or `auth: none`) that take none. */
export function withTriggerCredentialId(trigger: WorkflowTrigger, credentialId: string): WorkflowTrigger {
  if (trigger.kind === 'http') return { ...trigger, credentialId };
  if (trigger.kind !== 'webhook' || trigger.auth.type === 'none') return trigger;
  return { ...trigger, auth: { ...trigger.auth, credentialId } };
}

/** First free id of the form `kind`, `kind-2`, `kind-3`, … */
export function nextTriggerId(
  triggers: readonly { id: string }[],
  kind: WorkflowTrigger['kind'],
): string {
  const taken = new Set(triggers.map((trigger) => trigger.id));
  if (!taken.has(kind)) return kind;
  let suffix = 2;
  while (taken.has(`${kind}-${suffix}`)) suffix += 1;
  return `${kind}-${suffix}`;
}

/**
 * Credentials a trigger of this kind can authenticate with — exactly those of
 * the same kind, because that is the rule the runtime enforces:
 * `authenticateHttpTrigger` (packages/runtime/src/triggers.ts) rejects any
 * credential whose kind differs from the trigger's.
 *
 * Both editors had this wrong, in different ways. The Triggers dialog listed
 * every credential; the inspector offered OAuth credentials to API-endpoint
 * triggers. Either let an author save a trigger that then failed
 * authentication on every request.
 */
export function credentialsForTrigger(
  kind: 'webhook' | 'http',
  credentials: CredentialMeta[],
): CredentialMeta[] {
  return credentials.filter((credential) => credential.kind === kind);
}
