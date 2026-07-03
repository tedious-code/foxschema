import { randomUUID } from 'node:crypto';
import { getStore } from '../database/store';
import { encryptSecret, decryptSecret } from '../cores/crypto';
import { ConnectionOptions, buildConnectionString } from '@foxschema/core';

export interface SavedConnectionInput {
  name?: string;
  dialect: string;
  schema?: string;
  option: ConnectionOptions;
  /**
   * Whether to persist the password. Default (undefined) keeps the password that was
   * supplied. When explicitly `false`, the password is never stored (and cleared on an
   * update), so the user re-enters it each session.
   */
  savePassword?: boolean;
}

/** Safe-to-send connection metadata — never includes the password. */
export interface SavedConnectionSummary {
  id: string;
  name: string;
  dialect: string;
  schema?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  /** Whether a password is stored (so the edit form can reflect the checkbox). */
  hasPassword: boolean;
  createdAt: string;
}

interface ConnectionRow {
  id: string;
  name: string | null;
  dialect: string;
  schema: string | null;
  encrypted_config: string;
  created_at: string;
}

/**
 * Per-user saved connections. The full option (with password) is AES-256-GCM
 * encrypted at rest and only ever decrypted server-side (`resolve`) — the
 * client receives metadata only, never the secret.
 */
export class ConnectionStore {
  private toSummary(row: ConnectionRow): SavedConnectionSummary {
    let host: string | undefined;
    let port: number | undefined;
    let database: string | undefined;
    let username: string | undefined;
    let hasPassword = false;
    try {
      const opt = JSON.parse(decryptSecret(row.encrypted_config)) as ConnectionOptions;
      host = opt.host;
      port = opt.port;
      database = opt.database;
      username = opt.username;
      hasPassword = !!opt.password;
    } catch {
      /* unreadable (key rotated?) — show metadata without connection fields */
    }
    return {
      id: row.id,
      name: row.name ?? '',
      dialect: row.dialect,
      schema: row.schema ?? undefined,
      host,
      port,
      database,
      username,
      hasPassword,
      createdAt: row.created_at,
    };
  }

  async list(userId: string): Promise<SavedConnectionSummary[]> {
    const store = await getStore();
    const rows = await store.all<ConnectionRow>(
      'SELECT id, name, dialect, "schema", encrypted_config, created_at FROM connections WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows.map((r) => this.toSummary(r));
  }

  async create(userId: string, input: SavedConnectionInput): Promise<SavedConnectionSummary> {
    const store = await getStore();
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    // Never persist the password when the user opted out, regardless of what was sent.
    const option: ConnectionOptions =
      input.savePassword === false ? { ...input.option, password: undefined } : input.option;
    await store.run(
      'INSERT INTO connections (id, user_id, name, dialect, "schema", encrypted_config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, userId, input.name ?? null, input.dialect, input.schema ?? null, encryptSecret(JSON.stringify(option)), createdAt]
    );
    return {
      id,
      name: input.name ?? '',
      dialect: input.dialect,
      schema: input.schema,
      host: option.host,
      port: option.port,
      database: option.database,
      username: option.username,
      hasPassword: !!option.password,
      createdAt,
    };
  }

  /** Decrypted config for server-side use (connect/compare). Never sent to the client. */
  async resolve(
    userId: string,
    id: string
  ): Promise<{ dialect: string; schema?: string; option: ConnectionOptions } | null> {
    const store = await getStore();
    const row = await store.get<{ dialect: string; schema: string | null; encrypted_config: string }>(
      'SELECT dialect, "schema", encrypted_config FROM connections WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    if (!row) return null;
    return {
      dialect: row.dialect,
      schema: row.schema ?? undefined,
      option: JSON.parse(decryptSecret(row.encrypted_config)) as ConnectionOptions,
    };
  }

  /**
   * Update a saved connection. If the incoming option omits the password (the edit form
   * never receives it), the existing password is preserved — UNLESS the user unticked
   * "save password" (`savePassword === false`), in which case it's explicitly cleared.
   * The connection string is rebuilt so it stays valid either way.
   */
  async update(userId: string, id: string, input: SavedConnectionInput): Promise<SavedConnectionSummary | null> {
    const store = await getStore();
    const existing = await this.resolve(userId, id);
    if (!existing) return null;

    const merged: ConnectionOptions = { ...input.option };
    if (input.savePassword === false) {
      merged.password = undefined; // user opted out — drop any stored secret
    } else if (!merged.password) {
      merged.password = existing.option.password; // omitted on edit — keep existing
    }
    merged.connectionString = buildConnectionString(input.dialect, merged);

    await store.run(
      'UPDATE connections SET name = ?, dialect = ?, "schema" = ?, encrypted_config = ? WHERE id = ? AND user_id = ?',
      [input.name ?? null, input.dialect, input.schema ?? null, encryptSecret(JSON.stringify(merged)), id, userId]
    );

    const row = await store.get<ConnectionRow>(
      'SELECT id, name, dialect, "schema", encrypted_config, created_at FROM connections WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return row ? this.toSummary(row) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const store = await getStore();
    const result = await store.run('DELETE FROM connections WHERE id = ? AND user_id = ?', [id, userId]);
    return result.changes > 0;
  }
}
