import { randomBytes, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Password hashing (scrypt, built into Node — no native dep) and AES-256-GCM
 * encryption for stored DB credentials. The encryption key comes from
 * APP_ENCRYPTION_KEY; credentials are only as safe as that key's storage.
 */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let warnedInsecureKey = false;

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) {
    const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64-encoded).');
    }
    return key;
  }

  // Strict in production; in dev fall back to an INSECURE fixed key so the app
  // runs out of the box. (Matches the all-zero default in the dev:api script,
  // so credentials saved either way stay mutually decryptable.)
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_ENCRYPTION_KEY is not set — required to encrypt stored database credentials in production.');
  }
  if (!warnedInsecureKey) {
    console.warn('[crypto] APP_ENCRYPTION_KEY not set — using an INSECURE development key. Set a real 32-byte key before production.');
    warnedInsecureKey = true;
  }
  return Buffer.alloc(32, 0);
}

/** Encrypts a secret to "iv:authTag:ciphertext" (all base64). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // GCM standard nonce size
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload.');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Opaque session token. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}
