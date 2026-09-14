/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/credential-scope.ts).
 */
import type { CredentialStore, PipeDef } from '../common/index.js';

/**
 * Credential access scoped to one pipe.
 *
 * Pipes used to receive the whole `CredentialStore`, whose `revealSecret`
 * accepts any id — so any pipe could call `list()` and then decrypt every
 * credential in the installation, including ones belonging to other people's
 * workflows. A single hostile or careless pipe (a plugin, a `browser.eval`
 * script, a mis-copied id) was enough.
 *
 * The rule here is that **a pipe may only reveal credentials its own
 * definition names**: the credential bound to the pipe, plus any `credentialId`
 * appearing in its config (HTTP auth, browser fills, cookie jars). Everything
 * else is refused, and the refusal names the pipe so the cause is obvious.
 *
 * This is the capability seam, not a sandbox. It stops a pipe from *asking* for
 * a secret it has no business with; it does not stop native code in the same
 * process from going around it. Process/thread isolation is the next layer.
 */
export function credentialIdsFor(pipe: PipeDef): Set<string> {
  const ids = new Set<string>();
  if (pipe.credentialId) ids.add(pipe.credentialId);
  collectCredentialIds(pipe.config, ids);
  return ids;
}

/**
 * Walk a config for `credentialId` values. Pipes nest them at different depths
 * (`request.auth.credentialId` on HTTP, top level on the browser pipes), so the
 * shape is discovered rather than enumerated — a new pipe that follows the
 * naming convention is scoped correctly without touching this file.
 */
function collectCredentialIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCredentialIds(item, into);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'credentialId' && typeof nested === 'string' && nested) {
      into.add(nested);
    } else {
      collectCredentialIds(nested, into);
    }
  }
}

export class CredentialAccessError extends Error {
  constructor(pipeId: string, credentialId: string) {
    super(
      `pipe ${pipeId} may not read credential ${credentialId}: ` +
        'a pipe can only use credentials its own definition references',
    );
    this.name = 'CredentialAccessError';
  }
}

/**
 * A `CredentialStore` view a pipe may hold. Reads are filtered to `allowed`;
 * minting and deleting credentials are refused outright, because that is the
 * API's job and never a pipe's.
 */
export function scopeCredentialsToPipe(
  store: CredentialStore,
  pipe: PipeDef,
  allowed: Set<string> = credentialIdsFor(pipe),
): CredentialStore {
  const assertAllowed = (id: string): void => {
    if (!allowed.has(id)) throw new CredentialAccessError(pipe.id, id);
  };

  const scoped: CredentialStore = {
    async create() {
      throw new CredentialAccessError(pipe.id, '<create>');
    },
    async remove() {
      throw new CredentialAccessError(pipe.id, '<remove>');
    },
    // Enumeration is how a pipe would go looking for ids it was not given, so
    // the list is narrowed rather than refused — a pipe legitimately reads the
    // metadata of its own credential.
    async list() {
      const all = await store.list();
      return all.filter((meta) => allowed.has(meta.id));
    },
    async get(id: string) {
      if (!allowed.has(id)) return undefined;
      return store.get(id);
    },
    async revealSecret(id: string) {
      assertAllowed(id);
      return store.revealSecret(id);
    },
  };

  // Optional on the interface, and only some pipes need it (cookie sessions,
  // refreshed access tokens). Forwarded under the same rule when present.
  if (store.updateSecret) {
    scoped.updateSecret = async (id, patch) => {
      assertAllowed(id);
      return store.updateSecret!(id, patch);
    };
  }

  return scoped;
}
