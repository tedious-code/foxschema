/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory session passwords for credentials saved without "Save password".
 * Shared by Schema Sync and the SQL Editor so entering a password in one
 * surface is reused in the other until the tab is closed (never persisted).
 */

const passwords = new Map<string, string>();

export function getSessionPassword(connectionId: string): string | undefined {
  if (!connectionId) return undefined;
  const p = passwords.get(connectionId);
  return p ? p : undefined;
}

export function setSessionPassword(connectionId: string, password: string | undefined): void {
  if (!connectionId) return;
  if (!password) {
    passwords.delete(connectionId);
    return;
  }
  passwords.set(connectionId, password);
}

export function clearSessionPassword(connectionId: string): void {
  if (!connectionId) return;
  passwords.delete(connectionId);
}

/** Snapshot for mirroring into Zustand (React subscribers). */
export function sessionPasswordMap(): Record<string, string> {
  return Object.fromEntries(passwords);
}

/** Test helper — wipe the map between cases. */
export function resetSessionPasswordsForTests(): void {
  passwords.clear();
}
