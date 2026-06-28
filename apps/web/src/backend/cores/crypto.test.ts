import { describe, it, expect, beforeAll, afterEach } from 'vitest';
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
    const [scheme, iv, tag] = enc.split(':');
    const tampered = `${scheme}:${iv}:${tag}:${Buffer.from('garbage').toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('still decrypts a legacy untagged (3-part) v1 payload', () => {
    // Old format had no scheme prefix; encrypt then strip the "v1:" tag.
    const enc = encryptSecret('legacy-secret');
    const untagged = enc.replace(/^v1:/, '');
    expect(untagged.split(':').length).toBe(3);
    expect(decryptSecret(untagged)).toBe('legacy-secret');
  });
});

describe('email-bound key scheme (v2)', () => {
  const ORIG = { ...process.env };
  afterEach(() => {
    process.env.APP_KEY_SCHEME = ORIG.APP_KEY_SCHEME;
    process.env.APP_USER_EMAIL = ORIG.APP_USER_EMAIL;
  });

  it('round-trips when the bound email matches', () => {
    process.env.APP_USER_EMAIL = 'huy@example.com';
    process.env.APP_KEY_SCHEME = 'v2';
    const enc = encryptSecret('p@ss');
    expect(enc.startsWith('v2:')).toBe(true);
    expect(decryptSecret(enc)).toBe('p@ss');
  });

  it('cannot decrypt with a different email (anti-copy binding)', () => {
    process.env.APP_USER_EMAIL = 'huy@example.com';
    process.env.APP_KEY_SCHEME = 'v2';
    const enc = encryptSecret('p@ss');
    process.env.APP_USER_EMAIL = 'attacker@example.com';
    expect(() => decryptSecret(enc)).toThrow();
  });
});

describe('session tokens', () => {
  it('generates unique tokens', () => {
    expect(newToken()).not.toEqual(newToken());
  });
});
