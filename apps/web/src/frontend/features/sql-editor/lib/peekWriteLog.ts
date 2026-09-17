/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * In-memory log of Data Peek / result-grid row writes (insert / update / delete).
 * Also mirrored into the SQL Editor Runs list when a store hook is available.
 */
export type PeekWriteLogEntry = {
  id: string;
  at: number;
  kind: 'insert' | 'update' | 'delete';
  tableName: string;
  connectionId: string;
  sql: string;
  ok: boolean;
  error?: string;
};

const MAX = 100;
let entries: PeekWriteLogEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getPeekWriteLog(): readonly PeekWriteLogEntry[] {
  return entries;
}

export function clearPeekWriteLog(): void {
  entries = [];
  notify();
}

export function subscribePeekWriteLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function appendPeekWriteLog(
  entry: Omit<PeekWriteLogEntry, 'id' | 'at'> & { id?: string; at?: number }
): PeekWriteLogEntry {
  const full: PeekWriteLogEntry = {
    id: entry.id ?? `peek-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: entry.at ?? Date.now(),
    kind: entry.kind,
    tableName: entry.tableName,
    connectionId: entry.connectionId,
    sql: entry.sql,
    ok: entry.ok,
    error: entry.error,
  };
  entries = [full, ...entries].slice(0, MAX);
  notify();
  return full;
}
