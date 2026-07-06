import { readConfig, writeConfig, DEFAULT_DB_PATH, type CliConfig } from './config';
import { getDek, setDek, randomKeyHex } from './keyring';

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface SetupResult {
  cfg: CliConfig;
  created: boolean; // true when a new key was generated, false when an existing one was reused
}

/**
 * Core "bind email -> encryption key -> config" logic, extracted so both the
 * line `fox setup` command and the TUI's inline setup screen share one path
 * instead of duplicating keyring/config handling.
 */
export function performSetup(email: string): SetupResult {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) throw new Error('Invalid email.');

  const existing = readConfig();
  let dek = getDek(trimmed);
  let keyScheme = existing.keyScheme || 'v2';
  let created = false;
  if (!dek) {
    dek = randomKeyHex();
    setDek(trimmed, dek); // may throw (keychain unavailable) — caller decides how to surface it
    keyScheme = 'v2';
    created = true;
  }

  const cfg: CliConfig = {
    setupComplete: true,
    email: trimmed,
    dbEngine: 'sqlite',
    dbPath: existing.dbPath || DEFAULT_DB_PATH,
    dbUrl: '',
    keyScheme,
  };
  writeConfig(cfg);
  return { cfg, created };
}
