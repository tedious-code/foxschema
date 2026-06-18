import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword, encryptSecret, decryptSecret, newToken } from './crypto';

beforeAll(() => {
  // 32-byte key (64 hex chars) for the AES tests
  process.env.APP_ENCRYPTION_KEY = '0'.repeat(64);
});

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('s3cret-pass', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret-pass');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    expect(hashPassword('same')).not.toEqual(hashPassword('same'));
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});

describe('secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const secret = 'postgresql://user:p@ss@host:5432/db';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('produces different ciphertext each time (random IV)', () => {
    expect(encryptSecret('same')).not.toEqual(encryptSecret('same'));
  });

  it('fails to decrypt tampered ciphertext (auth tag)', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, data] = enc.split(':');
    const tampered = `${iv}:${tag}:${Buffer.from('garbage').toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe('session tokens', () => {
  it('generates unique tokens', () => {
    expect(newToken()).not.toEqual(newToken());
  });
});
