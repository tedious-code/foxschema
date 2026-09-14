/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/webhook-auth.test.ts).
 */
import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CredentialStore } from '../common/index.js';
import type { WebhookAuth } from '../common/index.js';
import {
  TriggerAuthenticationError,
  authenticateWebhook,
} from './webhook-auth.js';

function store(secret: Record<string, unknown>): CredentialStore {
  return {
    revealSecret: async () => secret,
    get: async () => ({ id: 'c1', name: 'c', kind: 'webhook' }),
  } as unknown as CredentialStore;
}

const emptyBody = Buffer.from('');

async function attempt(
  auth: WebhookAuth,
  headers: Record<string, string>,
  secret: Record<string, unknown>,
  rawBody = emptyBody,
  idempotencyKey?: string,
): Promise<'ok' | 'rejected'> {
  try {
    await authenticateWebhook(
      auth,
      { headers, rawBody, idempotencyKey },
      store(secret),
    );
    return 'ok';
  } catch (error) {
    expect(error).toBeInstanceOf(TriggerAuthenticationError);
    return 'rejected';
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function hsToken(
  claims: Record<string, unknown>,
  secret: string,
  alg = 'HS256',
): string {
  const header = base64url(JSON.stringify({ alg, typ: 'JWT' }));
  const payload = base64url(JSON.stringify(claims));
  const signature = createHmac(`sha${alg.slice(2)}`, secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

describe('webhook auth: none', () => {
  it('accepts anything, having been told to', async () => {
    const auth: WebhookAuth = {
      type: 'none',
      acknowledgeUnauthenticated: true,
    };
    expect(await attempt(auth, {}, {})).toBe('ok');
  });
});

describe('webhook auth: basic', () => {
  const auth: WebhookAuth = { type: 'basic', credentialId: 'c1' };
  const secret = { username: 'alice', password: 'correct horse' };
  const encode = (u: string, p: string): Record<string, string> => ({
    authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`,
  });

  it('accepts the right pair', async () => {
    expect(await attempt(auth, encode('alice', 'correct horse'), secret)).toBe(
      'ok',
    );
  });

  it('rejects a wrong password, a wrong user, and a missing header', async () => {
    expect(await attempt(auth, encode('alice', 'wrong'), secret)).toBe(
      'rejected',
    );
    expect(await attempt(auth, encode('bob', 'correct horse'), secret)).toBe(
      'rejected',
    );
    expect(await attempt(auth, {}, secret)).toBe('rejected');
  });

  it('keeps colons in the password', async () => {
    const withColons = { username: 'alice', password: 'a:b:c' };
    expect(await attempt(auth, encode('alice', 'a:b:c'), withColons)).toBe('ok');
  });

  it('rejects a non-Basic scheme carrying the right value', async () => {
    const encoded = Buffer.from('alice:correct horse').toString('base64');
    expect(
      await attempt(auth, { authorization: `Bearer ${encoded}` }, secret),
    ).toBe('rejected');
  });
});

describe('webhook auth: header', () => {
  const auth: WebhookAuth = {
    type: 'header',
    credentialId: 'c1',
    header: 'x-api-key',
  };

  it('accepts the token with or without a Bearer prefix', async () => {
    const secret = { token: 'sk-live-1' };
    expect(await attempt(auth, { 'x-api-key': 'sk-live-1' }, secret)).toBe('ok');
    expect(
      await attempt(auth, { 'x-api-key': 'Bearer sk-live-1' }, secret),
    ).toBe('ok');
  });

  it('rejects a wrong token and reads the configured header only', async () => {
    const secret = { token: 'sk-live-1' };
    expect(await attempt(auth, { 'x-api-key': 'sk-live-2' }, secret)).toBe(
      'rejected',
    );
    expect(await attempt(auth, { authorization: 'sk-live-1' }, secret)).toBe(
      'rejected',
    );
  });
});

describe('webhook auth: jwt', () => {
  const base: Extract<WebhookAuth, { type: 'jwt' }> = {
    type: 'jwt',
    credentialId: 'c1',
    header: 'authorization',
    algorithms: ['HS256'],
    clockToleranceSeconds: 60,
  };
  const secret = { secret: 'jwt-signing-secret' };
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('accepts a correctly signed token', async () => {
    const token = hsToken({ exp: future }, 'jwt-signing-secret');
    expect(
      await attempt(base, { authorization: `Bearer ${token}` }, secret),
    ).toBe('ok');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = hsToken({ exp: future }, 'not-the-secret');
    expect(
      await attempt(base, { authorization: `Bearer ${token}` }, secret),
    ).toBe('rejected');
  });

  it('rejects an expired token but honours the clock tolerance', async () => {
    const now = Math.floor(Date.now() / 1000);
    const longExpired = hsToken({ exp: now - 600 }, 'jwt-signing-secret');
    expect(
      await attempt(base, { authorization: `Bearer ${longExpired}` }, secret),
    ).toBe('rejected');

    const justExpired = hsToken({ exp: now - 10 }, 'jwt-signing-secret');
    expect(
      await attempt(base, { authorization: `Bearer ${justExpired}` }, secret),
    ).toBe('ok');
  });

  it('rejects a token that is not valid yet', async () => {
    const token = hsToken({ nbf: future }, 'jwt-signing-secret');
    expect(
      await attempt(base, { authorization: `Bearer ${token}` }, secret),
    ).toBe('rejected');
  });

  it('checks issuer and audience when configured', async () => {
    const auth = { ...base, issuer: 'https://idp.test', audience: 'foxflow' };
    const good = hsToken(
      { exp: future, iss: 'https://idp.test', aud: 'foxflow' },
      'jwt-signing-secret',
    );
    expect(await attempt(auth, { authorization: good }, secret)).toBe('ok');

    const wrongIssuer = hsToken(
      { exp: future, iss: 'https://evil.test', aud: 'foxflow' },
      'jwt-signing-secret',
    );
    expect(await attempt(auth, { authorization: wrongIssuer }, secret)).toBe(
      'rejected',
    );

    const wrongAudience = hsToken(
      { exp: future, iss: 'https://idp.test', aud: 'someone-else' },
      'jwt-signing-secret',
    );
    expect(await attempt(auth, { authorization: wrongAudience }, secret)).toBe(
      'rejected',
    );
  });

  it('accepts an audience array containing the expected value', async () => {
    const auth = { ...base, audience: 'foxflow' };
    const token = hsToken(
      { exp: future, aud: ['other', 'foxflow'] },
      'jwt-signing-secret',
    );
    expect(await attempt(auth, { authorization: token }, secret)).toBe('ok');
  });

  it('rejects "none" and any algorithm not on the pinned list', async () => {
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ exp: future }));
    expect(
      await attempt(base, { authorization: `${header}.${payload}.` }, secret),
    ).toBe('rejected');

    // Correctly signed, but with an algorithm this trigger does not accept.
    const hs512 = hsToken({ exp: future }, 'jwt-signing-secret', 'HS512');
    expect(await attempt(base, { authorization: hs512 }, secret)).toBe(
      'rejected',
    );
  });

  it('resists RS256 → HS256 algorithm confusion', async () => {
    // The classic forgery: the endpoint expects RS256, so the attacker signs
    // an HS256 token using the *public* key as the HMAC secret and hopes the
    // token's own `alg` picks the verification path. It must not.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const publicPem = publicKey.export({
      type: 'spki',
      format: 'pem',
    }) as string;
    const rsaAuth = { ...base, algorithms: ['RS256' as const] };
    const rsaSecret = { publicKey: publicPem };

    const forged = hsToken({ exp: future }, publicPem, 'HS256');
    expect(await attempt(rsaAuth, { authorization: forged }, rsaSecret)).toBe(
      'rejected',
    );

    // The genuine RS256 token still works.
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ exp: future }));
    const signature = createSign('RSA-SHA256')
      .update(`${header}.${payload}`)
      .sign(privateKey)
      .toString('base64url');
    expect(
      await attempt(
        rsaAuth,
        { authorization: `${header}.${payload}.${signature}` },
        rsaSecret,
      ),
    ).toBe('ok');
  });

  it('rejects malformed tokens without throwing anything else', async () => {
    for (const value of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '$$$.$$$.$$$']) {
      expect(await attempt(base, { authorization: value }, secret)).toBe(
        'rejected',
      );
    }
  });
});

describe('webhook auth: signature', () => {
  const auth: Extract<WebhookAuth, { type: 'signature' }> = {
    type: 'signature',
    credentialId: 'c1',
    signatureHeader: 'x-foxflow-signature',
    timestampHeader: 'x-foxflow-timestamp',
    maxAgeSeconds: 300,
  };
  const secret = { sharedSecret: 'hook-secret' };
  const body = Buffer.from(JSON.stringify({ orderId: 42 }));

  function sign(timestamp: string, key: string): string {
    return createHmac('sha256', 'hook-secret')
      .update(`${timestamp}.${key}.`)
      .update(body)
      .digest('hex');
  }

  it('accepts a fresh, correctly signed request', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'x-foxflow-signature': sign(timestamp, 'order-42'),
      'x-foxflow-timestamp': timestamp,
    };
    expect(await attempt(auth, headers, secret, body, 'order-42')).toBe('ok');
  });

  it('rejects a replay outside the freshness window', async () => {
    const stale = String(Math.floor(Date.now() / 1000) - 600);
    const headers = {
      'x-foxflow-signature': sign(stale, 'order-42'),
      'x-foxflow-timestamp': stale,
    };
    expect(await attempt(auth, headers, secret, body, 'order-42')).toBe(
      'rejected',
    );
  });

  it('rejects when the idempotency key does not match the one signed', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'x-foxflow-signature': sign(timestamp, 'order-42'),
      'x-foxflow-timestamp': timestamp,
    };
    // The key is bound into the digest, so swapping it must invalidate.
    expect(await attempt(auth, headers, secret, body, 'order-43')).toBe(
      'rejected',
    );
  });

  it('accepts the sha256= prefix form', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
      'x-foxflow-signature': `sha256=${sign(timestamp, 'order-42')}`,
      'x-foxflow-timestamp': timestamp,
    };
    expect(await attempt(auth, headers, secret, body, 'order-42')).toBe('ok');
  });
});
