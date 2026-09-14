/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workflow engine — moved from FoxAgent (packages/common/src/credentials/crypto.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoError, decodeKey, decrypt, encrypt, secretEquals } from './crypto.js';

describe('credential crypto', () => {
  const key = randomBytes(32);

  it('round-trips plaintext', () => {
    const secret = JSON.stringify({ host: 'db.internal', password: 'hunter2' });
    const enc = encrypt(secret, key);
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('hunter2');
    expect(decrypt(enc, key)).toBe(secret);
  });

  it('fails to decrypt with the wrong key', () => {
    const enc = encrypt('top secret', key);
    expect(() => decrypt(enc, randomBytes(32))).toThrow(CryptoError);
  });

  it('rejects a tampered ciphertext', () => {
    const enc = encrypt('top secret', key);
    const tampered = enc.slice(0, -2) + (enc.endsWith('AA') ? 'BB' : 'AA');
    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  it('decodes base64 and hex 32-byte keys, rejects wrong length', () => {
    expect(decodeKey(key.toString('base64'))).toHaveLength(32);
    expect(decodeKey(key.toString('hex'))).toHaveLength(32);
    expect(() => decodeKey('too-short')).toThrow(CryptoError);
  });

  it('compares secrets in constant time', () => {
    expect(secretEquals('abc', 'abc')).toBe(true);
    expect(secretEquals('abc', 'abd')).toBe(false);
    expect(secretEquals('abc', 'abcd')).toBe(false);
  });
});
