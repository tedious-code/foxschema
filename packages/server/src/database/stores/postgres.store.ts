import { createRequire } from 'node:module';
import type { Dialect, MetadataStore, RunResult, SqlParam } from './types';
import { toPostgresPlaceholders as toPg } from './sql-dialect';

const require = createRequire(import.meta.url);
const q = (id: string) => `"${id}"`;

interface PgPool {
  query(text: string, values?: SqlParam[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
}

/** Postgres metadata store (uses the `pg` Pool). Standard `"ident"` quoting works as-is. */
export class PostgresStore implements MetadataStore {
  readonly dialect: Dialect = 'postgres';
  private pool: PgPool | null = null;

  constructor(private connectionString: string) {}

  async init(): Promise<void> {
    const pg = require('pg');
    this.pool = new pg.Pool({ connectionString: this.connectionString }) as PgPool;
    await this.pool.query('SELECT 1');
  }

  private get db(): PgPool {
    if (!this.pool) throw new Error('Postgres store not initialized');
    return this.pool;
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const r = await this.db.query(toPg(sql), params);
    return r.rows as T[];
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const r = await this.db.query(toPg(sql), params);
    return r.rows[0] as T | undefined;
  }

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const r = await this.db.query(toPg(sql), params);
    return { changes: r.rowCount ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.db.query(sql);
  }

  async upsert(
    table: string,
    conflictColumns: string[],
    row: Record<string, SqlParam>,
    updateColumns: string[]
  ): Promise<void> {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const updates = updateColumns.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
    const sql =
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT(${conflictColumns.map(q).join(', ')}) DO UPDATE SET ${updates}`;
    await this.run(
      sql,
      cols.map((c) => row[c])
    );
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
    this.pool = null;
  }
}
