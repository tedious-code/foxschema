import { createRequire } from 'node:module';
import type { Dialect, MetadataStore, RunResult, SqlParam } from './types';
import { toMysqlIdentifiers as toMysql } from './sql-dialect';

const require = createRequire(import.meta.url);

interface MysqlPool {
  query(sql: string, values?: SqlParam[]): Promise<[unknown, unknown]>;
  end(): Promise<void>;
}

/** MySQL metadata store (uses `mysql2/promise`). `?` is native; identifiers get backticked. */
export class MysqlStore implements MetadataStore {
  readonly dialect: Dialect = 'mysql';
  private pool: MysqlPool | null = null;

  constructor(private connectionString: string) {}

  async init(): Promise<void> {
    const mysql = require('mysql2/promise');
    this.pool = mysql.createPool(this.connectionString) as MysqlPool;
    await this.pool.query('SELECT 1');
  }

  private get db(): MysqlPool {
    if (!this.pool) throw new Error('MySQL store not initialized');
    return this.pool;
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const [rows] = await this.db.query(toMysql(sql), params);
    return rows as T[];
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const [rows] = await this.db.query(toMysql(sql), params);
    return (rows as T[])[0];
  }

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const [res] = await this.db.query(toMysql(sql), params);
    return { changes: (res as { affectedRows?: number }).affectedRows ?? 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.db.query(toMysql(sql));
  }

  async upsert(
    table: string,
    _conflictColumns: string[],
    row: Record<string, SqlParam>,
    updateColumns: string[]
  ): Promise<void> {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    // MySQL upserts on the table's existing PK/unique key, so the conflict
    // columns aren't named explicitly.
    const updates = updateColumns.map((c) => `"${c}" = VALUES("${c}")`).join(', ');
    const sql =
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders}) ` +
      `ON DUPLICATE KEY UPDATE ${updates}`;
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
