/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * What several pipes take from their context in the same shape: the secret of
 * a credential the pipe references, and the scope `{{path}}` templates see.
 */
import type { HttpAuth } from '../common/index.js';
import type { PipeContext } from '../registry/index.js';

/** An HTTP request's credential: its own explicit one wins, else the pipe's. */
export function requestCredentialId(auth: HttpAuth, context: PipeContext): string | undefined {
  return auth.type === 'credential' ? auth.credentialId : context.pipe.credentialId;
}

/** The secret of `credentialId` — by default the pipe's own credential — or undefined. */
export async function revealPipeSecret(
  context: PipeContext,
  credentialId: string | undefined = context.pipe.credentialId,
): Promise<Record<string, unknown> | undefined> {
  if (!credentialId) return undefined;
  // Through the infrastructure boundary when the runtime provides one.
  return (
    (await (context.infrastructure?.secrets.get(credentialId) ??
      context.credentials?.revealSecret(credentialId))) ?? undefined
  );
}

/** The pipe's own credential secret, or an error naming what the pipe needs. */
export async function requirePipeSecret(
  context: PipeContext,
  needs: string,
): Promise<Record<string, unknown>> {
  if (!context.pipe.credentialId) throw new Error(`${context.pipe.type} needs ${needs}`);
  const secret = await revealPipeSecret(context);
  if (!secret) throw new Error(`credential ${context.pipe.credentialId} not found`);
  return secret;
}

/** Variables, flat and under `vars`, and the trigger payload. Never secrets. */
export function templateScope(context: PipeContext): Record<string, unknown> {
  const vars = context.variables ?? {};
  return { ...vars, vars, trigger: context.invocation?.payload ?? {} };
}
