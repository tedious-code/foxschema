import { randomUUID } from 'node:crypto';
import { getDb } from '../database/sqlite';

export type MigrationRunStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'ROLLED_BACK';

export interface MigrationObjectResult {
  name: string;
  type: string;
  action: string;
  status: string;
  error?: string;
}

/** Lightweight row for the history list (no large text columns). */
export interface MigrationRunSummary {
  id: string;
  status: MigrationRunStatus;
  dialect: string;
  host?: string;
  database?: string;
  schema?: string;
  objectCount: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** Full record including the script, snapshot, and per-object results. */
export interface MigrationRunDetail extends MigrationRunSummary {
  script?: string;
  snapshotDdl?: string;
  results: MigrationObjectResult[];
}

interface Row {
  id: string;
  status: MigrationRunStatus;
  dialect: string;
  target_host: string | null;
  database_name: string | null;
  schema: string | null;
  object_count: number;
  script: string | null;
  snapshot_ddl: string | null;
  results_json: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

// Bounds so the metadata DB can't grow unbounded.
const MAX_RUNS_PER_USER = 200;
const MAX_TEXT_LEN = 1_000_000; // ~1MB cap on the stored script / snapshot

/** Cap very large text (a huge schema snapshot) so one row can't bloat the DB. */
function cap(text: string | undefined, max = MAX_TEXT_LEN): string | undefined {
  if (text == null) return text;
  return text.length > max ? `${text.slice(0, max)}\n-- … (truncated)` : text;
}

/**
 * Per-user log of executed migrations. A row is created (RUNNING) when a
 * migration starts and finalized when it ends, so even an interrupted run
 * leaves a trace. No credentials are stored — only host/database/schema names.
 * The table is bounded: at most MAX_RUNS_PER_USER recent runs are kept per user.
 */
export class MigrationHistoryStore {
  /** Record the start of a migration; returns the run id. */
  start(
    userId: string,
    input: { dialect: string; host?: string; database?: string; schema?: string; objectCount: number; script: string }
  ): string {
    const id = randomUUID();
    getDb()
      .prepare(
        `INSERT INTO migration_runs
           (id, user_id, status, dialect, target_host, database_name, schema, object_count, script, started_at)
         VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.dialect,
        input.host ?? null,
        input.database ?? null,
        input.schema ?? null,
        input.objectCount,
        cap(input.script) ?? null,
        new Date().toISOString()
      );
    this.prune(userId);
    return id;
  }

  /** Keep only the most recent MAX_RUNS_PER_USER runs for a user. */
  private prune(userId: string): void {
    getDb()
      .prepare(
        `DELETE FROM migration_runs
          WHERE user_id = ?
            AND id NOT IN (
              SELECT id FROM migration_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?
            )`
      )
      .run(userId, userId, MAX_RUNS_PER_USER);
  }

  /** Finalize a run with its outcome. */
  finish(
    id: string,
    outcome: { status: MigrationRunStatus; results: MigrationObjectResult[]; snapshotDdl?: string; error?: string }
  ): void {
    getDb()
      .prepare(
        `UPDATE migration_runs
            SET status = ?, results_json = ?, snapshot_ddl = ?, error = ?, finished_at = ?
          WHERE id = ?`
      )
      .run(
        outcome.status,
        JSON.stringify(outcome.results ?? []),
        cap(outcome.snapshotDdl) ?? null,
        outcome.error ?? null,
        new Date().toISOString(),
        id
      );
  }

  private summary(r: Row): MigrationRunSummary {
    return {
      id: r.id,
      status: r.status,
      dialect: r.dialect,
      host: r.target_host ?? undefined,
      database: r.database_name ?? undefined,
      schema: r.schema ?? undefined,
      objectCount: r.object_count,
      error: r.error ?? undefined,
      startedAt: r.started_at,
      finishedAt: r.finished_at ?? undefined,
    };
  }

  list(userId: string, limit = 100): MigrationRunSummary[] {
    const rows = getDb()
      .prepare(
        `SELECT id, status, dialect, target_host, database_name, schema, object_count, error, started_at, finished_at
           FROM migration_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`
      )
      .all(userId, limit) as unknown as Row[];
    return rows.map((r) => this.summary(r));
  }

  get(userId: string, id: string): MigrationRunDetail | null {
    const r = getDb()
      .prepare('SELECT * FROM migration_runs WHERE id = ? AND user_id = ?')
      .get(id, userId) as Row | undefined;
    if (!r) return null;
    let results: MigrationObjectResult[] = [];
    try {
      results = r.results_json ? (JSON.parse(r.results_json) as MigrationObjectResult[]) : [];
    } catch {
      /* corrupt JSON — show empty */
    }
    return {
      ...this.summary(r),
      script: r.script ?? undefined,
      snapshotDdl: r.snapshot_ddl ?? undefined,
      results,
    };
  }

  remove(userId: string, id: string): boolean {
    const result = getDb().prepare('DELETE FROM migration_runs WHERE id = ? AND user_id = ?').run(id, userId);
    return Number(result.changes) > 0;
  }
}
