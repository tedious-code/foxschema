/**
 * Fox Schema (foxschema)
 * Copyright 2024-2026 Huy Phan <huyplb@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Which saved connections workflows may use, and on whose behalf.
 *
 * A saved connection belongs to one user and is decrypted only for that user.
 * Workflows run on a schedule with nobody signed in, so the owner grants a
 * connection explicitly. The engine can then resolve that connection — as its
 * owner, per run — and no other. Revoking the grant stops the next run.
 */
import type {
  ResolvedWorkflowConnection,
  WorkflowConnectionSummary,
} from '@foxschema/workflow-contract';
import { getStore } from '../../database/store';
import { ConnectionStore } from '../connections/connection-store.service';

export class WorkflowConnectionGrants {
  constructor(
    private readonly connections: Pick<ConnectionStore, 'list' | 'resolve'> = new ConnectionStore(),
  ) {}

  /** The caller's saved connections, each marked with whether workflows may use it. */
  async list(userId: string): Promise<WorkflowConnectionSummary[]> {
    const store = await getStore();
    const [saved, rows] = await Promise.all([
      this.connections.list(userId),
      store.all<{ connection_id: string }>(
        'SELECT connection_id FROM workflow_connection_grants WHERE user_id = ?',
        [userId],
      ),
    ]);
    const granted = new Set(rows.map((row) => row.connection_id));
    return saved.map((connection) => ({
      id: connection.id,
      name: connection.name,
      dialect: connection.dialect,
      ...(connection.schema ? { schema: connection.schema } : {}),
      ...(connection.host ? { host: connection.host } : {}),
      ...(connection.database ? { database: connection.database } : {}),
      hasPassword: connection.hasPassword,
      granted: granted.has(connection.id),
    }));
  }

  /**
   * Grant the connection and resolve with its name — undefined when it is not
   * the caller's, so there is nothing of theirs to grant.
   */
  async grant(userId: string, connectionId: string): Promise<string | undefined> {
    const connection = await this.connections.resolve(userId, connectionId);
    if (!connection) return undefined;
    const store = await getStore();
    await store.upsert(
      'workflow_connection_grants',
      ['connection_id'],
      { connection_id: connectionId, user_id: userId, created_at: new Date().toISOString() },
      ['user_id', 'created_at'],
    );
    return connection.name;
  }

  async revoke(userId: string, connectionId: string): Promise<boolean> {
    const store = await getStore();
    const result = await store.run(
      'DELETE FROM workflow_connection_grants WHERE connection_id = ? AND user_id = ?',
      [connectionId, userId],
    );
    return result.changes > 0;
  }

  /**
   * The decrypted connection, when it is granted and its owner still has it.
   * Only the engine's token-guarded route calls this.
   */
  async resolveForEngine(connectionId: string): Promise<ResolvedWorkflowConnection | undefined> {
    const store = await getStore();
    const grant = await store.get<{ user_id: string }>(
      'SELECT user_id FROM workflow_connection_grants WHERE connection_id = ?',
      [connectionId],
    );
    if (!grant) return undefined;
    const resolved = await this.connections.resolve(grant.user_id, connectionId);
    if (!resolved) return undefined;
    return {
      dialect: resolved.dialect,
      ...(resolved.schema ? { schema: resolved.schema } : {}),
      option: { ...resolved.option } as Record<string, unknown>,
    };
  }
}
