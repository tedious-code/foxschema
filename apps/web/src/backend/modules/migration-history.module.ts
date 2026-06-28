import { randomUUID } from 'node:crypto';
import { getStore } from '../database/store';

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
  async start(
    userId: string,
    input: { dialect: string; host?: string; database?: string; schema?: string; objectCount: number; script: string }
  ): Promise<string> {
    const id = randomUUID();
    const store = await getStore();
    await store.run(
      `INSERT INTO migration_runs
         (id, user_id, status, dialect, target_host, database_name, "schema", object_count, script, started_at)
       VALUES (?, ?, 'RUNNING', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        input.dialect,
        input.host ?? null,
        input.database ?? null,
        input.schema ?? null,
        input.objectCount,
        cap(input.script) ?? null,
        new Date().toISOString(),
      ]
    );
    await this.prune(userId);
    return id;
  }

  /** Keep only the most recent MAX_RUNS_PER_USER runs for a user. */
  private async prune(userId: string): Promise<void> {
    const store = await getStore();
    await store.run(
      `DELETE FROM migration_runs
        WHERE user_id = ?
          AND id NOT IN (
            SELECT id FROM (
              SELECT id FROM migration_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?
            ) AS keep
          )`,
      [userId, userId, MAX_RUNS_PER_USER]
    );
  }

  /** Finalize a run with its outcome. */
  async finish(
    id: string,
    outcome: { status: MigrationRunStatus; results: MigrationObjectResult[]; snapshotDdl?: string; error?: string }
  ): Promise<void> {
    const store = await getStore();
    await store.run(
      `UPDATE migration_runs
          SET status = ?, results_json = ?, snapshot_ddl = ?, error = ?, finished_at = ?
        WHERE id = ?`,
      [
        outcome.status,
        JSON.stringify(outcome.results ?? []),
        cap(outcome.snapshotDdl) ?? null,
        outcome.error ?? null,
        new Date().toISOString(),
        id,
      ]
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

  async list(userId: string, limit = 100): Promise<MigrationRunSummary[]> {
    const store = await getStore();
    const rows = await store.all<Row>(
      `SELECT id, status, dialect, target_host, database_name, "schema", object_count, error, started_at, finished_at
         FROM migration_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows.map((r) => this.summary(r));
  }

  async get(userId: string, id: string): Promise<MigrationRunDetail | null> {
    const store = await getStore();
    const r = await store.get<Row>('SELECT * FROM migration_runs WHERE id = ? AND user_id = ?', [id, userId]);
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

  async remove(userId: string, id: string): Promise<boolean> {
    const store = await getStore();
    const result = await store.run('DELETE FROM migration_runs WHERE id = ? AND user_id = ?', [id, userId]);
    return result.changes > 0;
  }
}
