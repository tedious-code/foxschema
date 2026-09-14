/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow designer — ported from FoxAgent (lib/triggers.test.ts).
 */
import { describe, expect, it } from 'vitest';
import type { CredentialMeta } from '../api/engineClient';
import {
  TRIGGER_KINDS,
  createTrigger,
  credentialsForTrigger,
  nextTriggerId,
} from './triggers';

describe('nextTriggerId', () => {
  it('uses the bare kind when it is free', () => {
    expect(nextTriggerId([], 'cron')).toBe('cron');
  });

  it('suffixes from 2 when the bare kind is taken', () => {
    expect(nextTriggerId([{ id: 'cron' }], 'cron')).toBe('cron-2');
  });

  it('skips every suffix already in use', () => {
    expect(
      nextTriggerId([{ id: 'cron' }, { id: 'cron-2' }, { id: 'cron-3' }], 'cron'),
    ).toBe('cron-4');
  });

  it('is not confused by ids belonging to other kinds', () => {
    expect(nextTriggerId([{ id: 'manual' }, { id: 'manual-2' }], 'cron')).toBe(
      'cron',
    );
  });
});

describe('createTrigger', () => {
  it('builds every kind enabled, under the id it was given', () => {
    for (const kind of TRIGGER_KINDS) {
      expect(createTrigger(kind, `${kind}-x`)).toMatchObject({
        id: `${kind}-x`,
        kind,
        enabled: true,
      });
    }
  });

  it('keeps the webhook header names the API verifies', () => {
    // These are wire protocol. A project-wide rename sweep must not touch
    // them, or every signed webhook starts failing verification.
    expect(createTrigger('webhook', 'hook')).toMatchObject({
      signatureHeader: 'x-foxflow-signature',
      timestampHeader: 'x-foxflow-timestamp',
    });
  });
});

describe('credentialsForTrigger', () => {
  const credentials: CredentialMeta[] = [
    'webhook',
    'http',
    'oauth',
    'database',
    'llm',
  ].map((kind) => ({ id: `cred-${kind}`, name: kind, kind }));

  it('offers a webhook only webhook secrets', () => {
    expect(credentialsForTrigger('webhook', credentials).map((c) => c.kind)).toEqual(
      ['webhook'],
    );
  });

  it('offers an API endpoint only HTTP credentials — not OAuth', () => {
    // The runtime authenticates a trigger only with a credential of its own
    // kind (authenticateHttpTrigger). Offering OAuth here produced triggers
    // that saved fine and then refused every request.
    expect(credentialsForTrigger('http', credentials).map((c) => c.kind)).toEqual([
      'http',
    ]);
  });
});
