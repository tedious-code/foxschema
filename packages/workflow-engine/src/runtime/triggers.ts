/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/triggers.ts).
 */
import { nonEmptyString, secretEquals, type CredentialStore } from '../common/index.js';
import type { TriggerDef } from '../common/index.js';
import {
  TriggerAuthenticationError,
  authenticateWebhook,
  headerValue,
} from './webhook-auth.js';

export { TriggerAuthenticationError } from './webhook-auth.js';

/**
 * Authenticate an inbound HTTP-ingress trigger.
 *
 * `webhook` delegates to its own `auth` union (signature/basic/header/jwt, or
 * none). `http` keeps its single static-token scheme — it is the "publish this
 * workflow as an API endpoint" kind, where the caller is you, so there is no
 * provider whose scheme has to be accommodated.
 */
export async function authenticateHttpTrigger(
  trigger: Extract<TriggerDef, { kind: 'webhook' | 'http' }>,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
  credentials: CredentialStore,
  idempotencyKey?: string,
): Promise<void> {
  if (trigger.kind === 'webhook') {
    if (trigger.auth.type !== 'none') {
      // Kind must match, not merely exist. Without this a webhook could point
      // at a database credential and its `password` field would satisfy Basic
      // auth — borrowing a secret that was never meant to gate an endpoint.
      const credential = await credentials.get(trigger.auth.credentialId);
      if (!credential || credential.kind !== 'webhook') {
        throw new TriggerAuthenticationError();
      }
    }
    return authenticateWebhook(
      trigger.auth,
      { headers, rawBody, idempotencyKey },
      credentials,
    );
  }

  const credential = await credentials.get(trigger.credentialId);
  if (!credential || credential.kind !== trigger.kind) {
    throw new TriggerAuthenticationError();
  }
  const secret = await credentials.revealSecret(trigger.credentialId);
  if (!secret) throw new TriggerAuthenticationError();

  const expected =
    bearer(secret.bearerToken) ??
    nonEmptyString(secret.apiKey) ??
    nonEmptyString(secret.token);
  const supplied = headerValue(headers, trigger.authHeader);
  if (!expected || !supplied || !secretEquals(supplied, expected)) {
    throw new TriggerAuthenticationError();
  }
}

function bearer(value: unknown): string | undefined {
  const token = nonEmptyString(value);
  return token ? `Bearer ${token}` : undefined;
}
