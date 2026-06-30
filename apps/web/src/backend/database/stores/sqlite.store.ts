import { DatabaseSync } from 'node:sqlite';
import type { Dialect, MetadataStore, RunResult, SqlParam } from './types';

const q = (id: string) => `"${id}"`;

/** Bundled default engine — synchronous `node:sqlite` behind the async contract. */
export class SqliteStore implements MetadataStore {
  readonly dialect: Dialect = 'sqlite';
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  async init(): Promise<void> {
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  async run(sql: string, params: SqlParam[] = []): Promise<RunResult> {
    const r = this.db.prepare(sql).run(...params);
    return { changes: Number(r.changes) };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async upsert(
    table: string,
    conflictColumns: string[],
    row: Record<string, SqlParam>,
    updateColumns: string[]
  ): Promise<void> {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const updates = updateColumns.map((c) => `${q(c)} = excluded.${q(c)}`).join(', ');
    const sql =
      `INSERT INTO ${q(table)} (${cols.map(q).join(', ')}) VALUES (${placeholders}) ` +
      `ON CONFLICT(${conflictColumns.map(q).join(', ')}) DO UPDATE SET ${updates}`;
    await this.run(
      sql,
      cols.map((c) => row[c])
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
