/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/credential-scope.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { CredentialStore, PipeDef } from '../common/index.js';
import {
  CredentialAccessError,
  credentialIdsFor,
  scopeCredentialsToPipe,
} from './credential-scope.js';

/** Two workflows' credentials sharing one installation, as in production. */
function store(): CredentialStore {
  const secrets: Record<string, Record<string, unknown>> = {
    'mine-db': { password: 'mine' },
    'mine-api': { bearerToken: 'mine-token' },
    'someone-elses-db': { password: 'not-yours' },
  };
  return {
    async create() {
      throw new Error('unused');
    },
    async list() {
      return Object.keys(secrets).map((id) => ({
        id,
        name: id,
        kind: 'database',
      })) as never;
    },
    async get(id) {
      return secrets[id] ? ({ id, name: id, kind: 'database' } as never) : undefined;
    },
    async remove() {
      return true;
    },
    async revealSecret(id) {
      return secrets[id];
    },
    async updateSecret(id, patch) {
      secrets[id] = { ...secrets[id], ...patch };
      return { id, name: id, kind: 'database' } as never;
    },
  };
}

function pipe(overrides: Partial<PipeDef> = {}): PipeDef {
  return {
    id: 'sink',
    type: 'sink.postgres',
    role: 'sink',
    config: {},
    concurrency: 1,
    ...overrides,
  } as PipeDef;
}

describe('credentialIdsFor', () => {
  it('takes the credential bound to the pipe', () => {
    expect(credentialIdsFor(pipe({ credentialId: 'mine-db' }))).toEqual(
      new Set(['mine-db']),
    );
  });

  it('finds ids nested anywhere in the config', () => {
    // HTTP puts it at request.auth.credentialId; browser pipes at the top.
    const ids = credentialIdsFor(
      pipe({
        credentialId: 'mine-db',
        config: {
          request: { auth: { type: 'credential', credentialId: 'mine-api' } },
          steps: [{ credentialId: 'nested-in-array' }],
        },
      }),
    );

    expect(ids).toEqual(new Set(['mine-db', 'mine-api', 'nested-in-array']));
  });

  it('ignores empty and non-string values', () => {
    const ids = credentialIdsFor(
      pipe({ config: { credentialId: '', other: { credentialId: 42 } } }),
    );

    expect(ids.size).toBe(0);
  });
});

describe('scopeCredentialsToPipe', () => {
  it('reveals a credential the pipe references', async () => {
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-db' }),
    );

    expect(await scoped.revealSecret('mine-db')).toEqual({ password: 'mine' });
  });

  it("refuses another workflow's credential, naming the pipe", async () => {
    // The exposure this exists to close: before scoping, any pipe holding the
    // shared store could decrypt this.
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-db' }),
    );

    await expect(scoped.revealSecret('someone-elses-db')).rejects.toThrow(
      CredentialAccessError,
    );
    await expect(scoped.revealSecret('someone-elses-db')).rejects.toThrow(
      /pipe sink may not read credential someone-elses-db/,
    );
  });

  it('narrows list() so a pipe cannot discover ids it was not given', async () => {
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-db' }),
    );

    expect((await scoped.list()).map((meta) => meta.id)).toEqual(['mine-db']);
  });

  it('hides an out-of-scope credential from get() rather than confirming it', async () => {
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-db' }),
    );

    expect(await scoped.get('someone-elses-db')).toBeUndefined();
    expect(await scoped.get('mine-db')).toBeDefined();
  });

  it('refuses to mint or delete credentials at all', async () => {
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-db' }),
    );

    await expect(scoped.create({} as never)).rejects.toThrow(
      CredentialAccessError,
    );
    await expect(scoped.remove('mine-db')).rejects.toThrow(
      CredentialAccessError,
    );
  });

  it('applies the same rule to updateSecret', async () => {
    // Cookie sessions and refreshed tokens write back; that must not become a
    // way to tamper with a credential the pipe cannot read.
    const scoped = scopeCredentialsToPipe(
      store(),
      pipe({ credentialId: 'mine-api' }),
    );

    await expect(
      scoped.updateSecret!('mine-api', { bearerToken: 'rotated' }),
    ).resolves.toBeDefined();
    await expect(
      scoped.updateSecret!('someone-elses-db', { password: 'pwned' }),
    ).rejects.toThrow(CredentialAccessError);
  });

  it('leaves updateSecret absent when the underlying store has none', () => {
    const base = store();
    delete base.updateSecret;

    expect(scopeCredentialsToPipe(base, pipe()).updateSecret).toBeUndefined();
  });
});
