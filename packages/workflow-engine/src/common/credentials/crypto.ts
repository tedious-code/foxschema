/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/credentials/crypto.ts).
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// AES-256-GCM secret-at-rest encryption. Mirrors the scheme proven in
// FoxSchema (cores/crypto.ts): a 32-byte data-encryption key, a random 12-byte
// IV per message, and a 16-byte auth tag. Ciphertext is tagged `v1:` so the
// format can evolve without ambiguity.
const SCHEME = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class CryptoError extends Error {}

/**
 * Decode a configured key. Accepts base64 or hex; must decode to exactly 32
 * bytes. Kept explicit so a misconfigured key fails loudly at boot, not on the
 * first decrypt.
 */
export function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const candidates: Buffer[] = [];
  try {
    candidates.push(Buffer.from(trimmed, 'base64'));
  } catch {
    // ignore — try hex next
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, 'hex'));
  }
  const key = candidates.find((b) => b.length === KEY_BYTES);
  if (!key) {
    throw new CryptoError(
      `encryption key must decode to ${KEY_BYTES} bytes (base64 or hex)`,
    );
  }
  return key;
}

/** Encrypt UTF-8 plaintext. Returns `v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function encrypt(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, b64(iv), b64(tag), b64(ct)].join(':');
}

/** Decrypt a `v1:` payload. Throws CryptoError on a wrong key or tampering. */
export function decrypt(payload: string, key: Buffer): string {
  assertKey(key);
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new CryptoError('unrecognized ciphertext format');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new CryptoError('decryption failed (wrong key or corrupted data)');
  }
}

/** Constant-time compare for secret-equality checks (e.g. shared webhook tokens). */
export function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(`key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}

function b64(buf: Buffer): string {
  return buf.toString('base64');
}
