import { randomBytes } from 'node:crypto';
import { Entry } from '@napi-rs/keyring';

// The per-install Data Encryption Key (DEK) lives in the OS keychain (macOS
// Keychain / Windows Credential Manager / Linux Secret Service), keyed by email
// — never written to disk. Mirrors the desktop shell's model.
const SERVICE = 'com.foxschema.cli';

/** 32-byte key as 64 hex chars — the shape APP_ENCRYPTION_KEY expects. */
export function randomKeyHex(): string {
  return randomBytes(32).toString('hex');
}

export function getDek(email: string): string | null {
  try {
    return new Entry(SERVICE, email).getPassword();
  } catch {
    // Not found, or no keychain access on this host.
    return null;
  }
}

export function setDek(email: string, dek: string): void {
  new Entry(SERVICE, email).setPassword(dek);
}

export function deleteDek(email: string): void {
  try {
    new Entry(SERVICE, email).deletePassword();
  } catch {
    /* nothing to delete */
  }
}
