import { randomUUID } from 'node:crypto';
import { getDb } from '../database/sqlite';
import { encryptSecret, decryptSecret } from '../cores/crypto';
import { ConnectionOptions, buildConnectionString } from '@foxschema/shared';

export interface SavedConnectionInput {
  name?: string;
  dialect: string;
  schema?: string;
  option: ConnectionOptions;
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
    try {
      const opt = JSON.parse(decryptSecret(row.encrypted_config)) as ConnectionOptions;
      host = opt.host;
      port = opt.port;
      database = opt.database;
      username = opt.username;
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
      createdAt: row.created_at,
    };
  }

  list(userId: string): SavedConnectionSummary[] {
    const rows = getDb()
      .prepare('SELECT id, name, dialect, schema, encrypted_config, created_at FROM connections WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId) as unknown as ConnectionRow[];
    return rows.map((r) => this.toSummary(r));
  }

  create(userId: string, input: SavedConnectionInput): SavedConnectionSummary {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    getDb()
      .prepare('INSERT INTO connections (id, user_id, name, dialect, schema, encrypted_config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, input.name ?? null, input.dialect, input.schema ?? null, encryptSecret(JSON.stringify(input.option)), createdAt);
    return {
      id,
      name: input.name ?? '',
      dialect: input.dialect,
      schema: input.schema,
      host: input.option.host,
      port: input.option.port,
      database: input.option.database,
      username: input.option.username,
      createdAt,
    };
  }

  /** Decrypted config for server-side use (connect/compare). Never sent to the client. */
  resolve(userId: string, id: string): { dialect: string; schema?: string; option: ConnectionOptions } | null {
    const row = getDb()
      .prepare('SELECT dialect, schema, encrypted_config FROM connections WHERE id = ? AND user_id = ?')
      .get(id, userId) as { dialect: string; schema: string | null; encrypted_config: string } | undefined;
    if (!row) return null;
    return {
      dialect: row.dialect,
      schema: row.schema ?? undefined,
      option: JSON.parse(decryptSecret(row.encrypted_config)) as ConnectionOptions,
    };
  }

  /**
   * Update a saved connection. If the incoming option omits the password (the
   * edit form never receives it), the existing password is preserved and the
   * connection string is rebuilt so it stays valid.
   */
  update(userId: string, id: string, input: SavedConnectionInput): SavedConnectionSummary | null {
    const existing = this.resolve(userId, id);
    if (!existing) return null;

    const merged: ConnectionOptions = { ...input.option };
    if (!merged.password) merged.password = existing.option.password;
    merged.connectionString = buildConnectionString(input.dialect, merged);

    getDb()
      .prepare('UPDATE connections SET name = ?, dialect = ?, schema = ?, encrypted_config = ? WHERE id = ? AND user_id = ?')
      .run(input.name ?? null, input.dialect, input.schema ?? null, encryptSecret(JSON.stringify(merged)), id, userId);

    const row = getDb()
      .prepare('SELECT id, name, dialect, schema, encrypted_config, created_at FROM connections WHERE id = ? AND user_id = ?')
      .get(id, userId) as ConnectionRow | undefined;
    return row ? this.toSummary(row) : null;
  }

  remove(userId: string, id: string): boolean {
    const result = getDb().prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(id, userId);
    return Number(result.changes) > 0;
  }
}
