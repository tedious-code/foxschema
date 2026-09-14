/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/runtime/src/webhook-auth.ts).
 */
import { createHmac, createVerify, timingSafeEqual } from 'node:crypto';
import { nonEmptyString, secretEquals, type CredentialStore } from '../common/index.js';
import type { WebhookAuth } from '../common/index.js';

export class TriggerAuthenticationError extends Error {
  constructor(message = 'trigger authentication failed') {
    super(message);
    this.name = 'TriggerAuthenticationError';
  }
}

export interface WebhookAuthRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
  /** Present only for `signature`, which binds the key into the digest. */
  idempotencyKey?: string;
}

/**
 * Verify a webhook request against the trigger's chosen method.
 *
 * Every failure throws the same error with the same message. Distinguishing
 * "no such credential" from "wrong password" tells an attacker which half to
 * keep working on; the route turns all of it into one 401.
 */
export async function authenticateWebhook(
  auth: WebhookAuth,
  request: WebhookAuthRequest,
  credentials: CredentialStore,
): Promise<void> {
  if (auth.type === 'none') return;

  const secret = await credentials.revealSecret(auth.credentialId);
  if (!secret) throw new TriggerAuthenticationError();

  switch (auth.type) {
    case 'signature':
      return verifySignature(auth, request, secret);
    case 'basic':
      return verifyBasic(auth, request, secret);
    case 'header':
      return verifyHeader(auth, request, secret);
    case 'jwt':
      return verifyJwt(auth, request, secret);
  }
}

type Secret = Record<string, unknown>;

function verifySignature(
  auth: Extract<WebhookAuth, { type: 'signature' }>,
  request: WebhookAuthRequest,
  secret: Secret,
): void {
  const sharedSecret =
    nonEmptyString(secret.sharedSecret) ?? nonEmptyString(secret.secret);
  const supplied = header(request.headers, auth.signatureHeader);
  const timestamp = header(request.headers, auth.timestampHeader);
  const idempotencyKey = request.idempotencyKey;
  if (
    !sharedSecret ||
    !supplied ||
    !idempotencyKey ||
    !isFreshTimestamp(timestamp, auth.maxAgeSeconds)
  ) {
    throw new TriggerAuthenticationError();
  }
  const expected = createHmac('sha256', sharedSecret)
    .update(`${timestamp}.${idempotencyKey}.`)
    .update(request.rawBody)
    .digest('hex');
  const normalized = supplied.startsWith('sha256=')
    ? supplied.slice('sha256='.length)
    : supplied;
  if (!secretEquals(normalized, expected)) {
    throw new TriggerAuthenticationError();
  }
}

function verifyBasic(
  auth: Extract<WebhookAuth, { type: 'basic' }>,
  request: WebhookAuthRequest,
  secret: Secret,
): void {
  const username = nonEmptyString(secret.username);
  const password = nonEmptyString(secret.password);
  const supplied = header(request.headers, 'authorization');
  if (!username || !password || !supplied) {
    throw new TriggerAuthenticationError();
  }
  const [scheme, encoded] = supplied.split(' ', 2);
  if (scheme?.toLowerCase() !== 'basic' || !encoded) {
    throw new TriggerAuthenticationError();
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    throw new TriggerAuthenticationError();
  }
  // Split on the first colon only: a password may legitimately contain them.
  const separator = decoded.indexOf(':');
  if (separator < 0) throw new TriggerAuthenticationError();
  const suppliedUser = decoded.slice(0, separator);
  const suppliedPassword = decoded.slice(separator + 1);
  // Both compared, and both in constant time — comparing the user with `===`
  // would leak it a character at a time even though the password is safe.
  const userOk = secretEquals(suppliedUser, username);
  const passwordOk = secretEquals(suppliedPassword, password);
  if (!userOk || !passwordOk) throw new TriggerAuthenticationError();
}

function verifyHeader(
  auth: Extract<WebhookAuth, { type: 'header' }>,
  request: WebhookAuthRequest,
  secret: Secret,
): void {
  const expected =
    nonEmptyString(secret.token) ??
    nonEmptyString(secret.apiKey) ??
    nonEmptyString(secret.secret);
  const supplied = header(request.headers, auth.header);
  if (!expected || !supplied) throw new TriggerAuthenticationError();
  // Accept the value with or without a Bearer prefix: which one a provider
  // sends is not something the workflow author controls.
  const normalized = supplied.startsWith('Bearer ')
    ? supplied.slice('Bearer '.length)
    : supplied;
  const bare = expected.startsWith('Bearer ')
    ? expected.slice('Bearer '.length)
    : expected;
  if (!secretEquals(normalized, bare)) {
    throw new TriggerAuthenticationError();
  }
}

interface JwtHeader {
  alg?: unknown;
  typ?: unknown;
}

interface JwtClaims {
  exp?: unknown;
  nbf?: unknown;
  iss?: unknown;
  aud?: unknown;
}

function verifyJwt(
  auth: Extract<WebhookAuth, { type: 'jwt' }>,
  request: WebhookAuthRequest,
  secret: Secret,
): void {
  const supplied = header(request.headers, auth.header);
  if (!supplied) throw new TriggerAuthenticationError();
  const token = supplied.startsWith('Bearer ')
    ? supplied.slice('Bearer '.length).trim()
    : supplied.trim();

  const parts = token.split('.');
  if (parts.length !== 3) throw new TriggerAuthenticationError();
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];

  const jwtHeader = decodeJson<JwtHeader>(encodedHeader);
  const claims = decodeJson<JwtClaims>(encodedPayload);
  if (!jwtHeader || !claims) throw new TriggerAuthenticationError();

  // The token's `alg` selects nothing. It only has to *be* one we accept —
  // the verification path comes from our own config. This is what stops the
  // RS256→HS256 confusion attack, where a caller signs with the public key.
  const alg = jwtHeader.alg;
  if (
    typeof alg !== 'string' ||
    !(auth.algorithms as readonly string[]).includes(alg)
  ) {
    throw new TriggerAuthenticationError();
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = base64UrlToBuffer(encodedSignature);
  if (!signature) throw new TriggerAuthenticationError();

  const verified = alg.startsWith('HS')
    ? verifyHmac(alg, signingInput, signature, secret)
    : verifyRsa(alg, signingInput, signature, secret);
  if (!verified) throw new TriggerAuthenticationError();

  const now = Math.floor(Date.now() / 1000);
  const tolerance = auth.clockToleranceSeconds;
  if (typeof claims.exp === 'number' && now > claims.exp + tolerance) {
    throw new TriggerAuthenticationError();
  }
  if (typeof claims.nbf === 'number' && now + tolerance < claims.nbf) {
    throw new TriggerAuthenticationError();
  }
  if (auth.issuer !== undefined && claims.iss !== auth.issuer) {
    throw new TriggerAuthenticationError();
  }
  if (auth.audience !== undefined && !audienceMatches(claims.aud, auth.audience)) {
    throw new TriggerAuthenticationError();
  }
}

function verifyHmac(
  alg: string,
  signingInput: string,
  signature: Buffer,
  secret: Secret,
): boolean {
  const key = nonEmptyString(secret.secret) ?? nonEmptyString(secret.sharedSecret);
  if (!key) return false;
  const expected = createHmac(`sha${alg.slice(2)}`, key)
    .update(signingInput)
    .digest();
  return (
    expected.length === signature.length &&
    timingSafeEqual(expected, signature)
  );
}

function verifyRsa(
  alg: string,
  signingInput: string,
  signature: Buffer,
  secret: Secret,
): boolean {
  const publicKey = nonEmptyString(secret.publicKey);
  if (!publicKey) return false;
  try {
    return createVerify(`RSA-SHA${alg.slice(2)}`)
      .update(signingInput)
      .verify(publicKey, signature);
  } catch {
    // A malformed key is an authentication failure, not a 500.
    return false;
  }
}

function audienceMatches(claim: unknown, expected: string): boolean {
  if (typeof claim === 'string') return claim === expected;
  return Array.isArray(claim) && claim.includes(expected);
}

function decodeJson<T>(segment: string): T | undefined {
  const buffer = base64UrlToBuffer(segment);
  if (!buffer) return undefined;
  try {
    const parsed: unknown = JSON.parse(buffer.toString('utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

function base64UrlToBuffer(segment: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return undefined;
  return Buffer.from(segment, 'base64url');
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isFreshTimestamp(
  timestamp: string | undefined,
  maxAgeSeconds: number,
): boolean {
  if (!timestamp) return false;
  const timestampSeconds = Number(timestamp);
  return (
    Number.isInteger(timestampSeconds) &&
    Math.abs(Date.now() / 1000 - timestampSeconds) <= maxAgeSeconds
  );
}
