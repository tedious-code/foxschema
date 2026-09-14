/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/credentials/index.ts).
 */
export {
  decodeKey,
  encrypt,
  decrypt,
  secretEquals,
  CryptoError,
} from './crypto.js';
export {
  credentialIdSchema,
  credentialKindSchema,
  credentialSourceSchema,
  createCredentialSchema,
  InMemoryCredentialStore,
} from './store.js';
export type {
  CredentialKind,
  CredentialSource,
  CredentialMeta,
  CreateCredentialInput,
  CredentialStore,
} from './store.js';
export {
  buildStoredSecret,
  expandSecretString,
  parseStoredSecret,
  resolveStoredSecret,
} from './providers.js';
export type { StoredSecretPayload } from './providers.js';

import { decodeKey } from './crypto.js';

/**
 * Load the credential encryption key from the environment. Fails loudly when
 * unset — a data-import tool must never fall back to storing secrets in the
 * clear.
 */
export function keyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.FOXFLOW_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'FOXFLOW_ENCRYPTION_KEY is required (32 bytes, base64 or hex). See .env.example.',
    );
  }
  return decodeKey(raw);
}
