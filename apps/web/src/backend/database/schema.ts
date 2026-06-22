import type { Dialect, MetadataStore } from './providers/types';

/**
 * Dialect-aware schema. The DDL is rendered per engine (column types differ:
 * MySQL needs bounded VARCHAR for keys/timestamps, TEXT can't be a PK/UNIQUE).
 * Reserved identifiers (`schema`, `key`, `value`) are double-quoted; each
 * provider maps the quotes to its dialect.
 *
 * **Append-only:** never edit a shipped migration; add a new one.
 */

function types(d: Dialect) {
  return {
    id: d === 'mysql' ? 'VARCHAR(64)' : 'TEXT', //   PK / FK / indexed key text
    str: d === 'mysql' ? 'VARCHAR(255)' : 'TEXT', // names, emails, short values
    big: d === 'mysql' ? 'LONGTEXT' : 'TEXT', //      large non-indexed text
    ts: d === 'mysql' ? 'VARCHAR(40)' : 'TEXT', //    ISO-8601 timestamp string
    int: 'INTEGER',
  };
}

interface Migration {
  id: number;
  name: string;
  statements: (d: Dialect) => string[];
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'init_users_connections',
    statements: (d) => {
      const t = types(d);
      return [
        `CREATE TABLE IF NOT EXISTS users (
           id ${t.id} PRIMARY KEY,
           email ${t.str} UNIQUE NOT NULL,
           password_hash ${t.str} NOT NULL,
           email_verified ${t.int} NOT NULL DEFAULT 0,
           onboarding_completed ${t.int} NOT NULL DEFAULT 0,
           created_at ${t.ts} NOT NULL
         )`,
        `CREATE TABLE IF NOT EXISTS user_preferences (
           user_id ${t.id} PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
           role ${t.str},
           primary_database ${t.str},
           primary_goal ${t.str},
           theme ${t.str},
           updated_at ${t.ts} NOT NULL
         )`,
        `CREATE TABLE IF NOT EXISTS connections (
           id ${t.id} PRIMARY KEY,
           user_id ${t.id} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name ${t.str},
           dialect ${t.str} NOT NULL,
           "schema" ${t.str},
           encrypted_config ${t.big} NOT NULL,
           created_at ${t.ts} NOT NULL
         )`,
        `CREATE INDEX idx_connections_user ON connections(user_id)`,
        `CREATE TABLE IF NOT EXISTS sessions (
           token ${t.id} PRIMARY KEY,
           user_id ${t.id} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           created_at ${t.ts} NOT NULL,
           expires_at ${t.ts} NOT NULL
         )`,
        `CREATE INDEX idx_sessions_user ON sessions(user_id)`,
      ];
    },
  },
  {
    id: 2,
    name: 'migration_runs',
    statements: (d) => {
      const t = types(d);
      return [
        `CREATE TABLE IF NOT EXISTS migration_runs (
           id ${t.id} PRIMARY KEY,
           user_id ${t.id} NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           status ${t.str} NOT NULL,
           dialect ${t.str} NOT NULL,
           target_host ${t.str},
           database_name ${t.str},
           "schema" ${t.str},
           object_count ${t.int} NOT NULL DEFAULT 0,
           script ${t.big},
           snapshot_ddl ${t.big},
           results_json ${t.big},
           error ${t.big},
           started_at ${t.ts} NOT NULL,
           finished_at ${t.ts}
         )`,
        `CREATE INDEX idx_migration_runs_user ON migration_runs(user_id, started_at DESC)`,
      ];
    },
  },
  {
    id: 3,
    name: 'app_settings',
    statements: (d) => {
      const t = types(d);
      return [
        `CREATE TABLE IF NOT EXISTS app_settings (
           "key" ${t.id} PRIMARY KEY,
           "value" ${t.big},
           updated_at ${t.ts} NOT NULL
         )`,
      ];
    },
  },
];

/**
 * Apply pending migrations. Idempotent: tables use IF NOT EXISTS and applied ids
 * are tracked in schema_migrations; a re-created index error on retry is ignored
 * (no portable CREATE INDEX IF NOT EXISTS across all three engines).
 */
export async function runMigrations(store: MetadataStore): Promise<void> {
  const t = types(store.dialect);
  await store.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id ${t.int} PRIMARY KEY,
       name ${t.str} NOT NULL,
       applied_at ${t.ts} NOT NULL
     )`
  );

  const appliedRows = await store.all<{ id: number }>('SELECT id FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => Number(r.id)));

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    for (const stmt of m.statements(store.dialect)) {
      try {
        await store.exec(stmt);
      } catch (err) {
        if (/^\s*CREATE INDEX/i.test(stmt)) continue; // tolerate re-create on retry
        throw err;
      }
    }
    await store.run('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)', [
      m.id,
      m.name,
      new Date().toISOString(),
    ]);
  }
}
