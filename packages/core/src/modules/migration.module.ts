import { ConnectionFactory } from '../cores/connection-factory';
import { getAdapter } from '../providers/adapter-registry';
import { ConnectionOptions, DriverAdapter } from '../interfaces';
import type { MigrationEvent } from '../interfaces';
import type { MigrationStep } from './sql-generator.module';

export type { MigrationEvent };

/**
 * Executes a migration plan on the target. Dialect-specific transaction handling
 * lives in the provider's DriverAdapter, so this orchestration stays generic.
 *
 * Default mode runs the whole plan in one transaction — a failure rolls
 * everything back (real rollback on Postgres/DB2/SQL Server/Azure SQL, which
 * support transactional DDL; on MySQL/MariaDB/Oracle each DDL statement
 * auto-commits as it runs, so prior steps stay applied regardless).
 *
 * continueOnError mode gives each step its own transaction instead of one big
 * one: a failed step only costs that step (rolled back on its own), and the
 * migration keeps going. This was tried first with per-step SAVEPOINTs inside a
 * single transaction — that works at the raw SQL level (verified live on
 * Postgres, DB2, and SQL Server via sqlcmd) but the `mssql` npm package's
 * Transaction wrapper unconditionally invalidates itself on the first query
 * error, regardless of the underlying SQL Server session's XACT_ABORT setting —
 * a driver-library limitation, not a protocol one — so it can't be recovered via
 * a savepoint through that driver. Per-step transactions sidestep this entirely
 * and work identically on every dialect with no per-dialect SQL.
 */
export class MigrationModule {
  async execute(
    dialect: string,
    option: ConnectionOptions,
    schema: string,
    steps: MigrationStep[],
    onEvent: (e: MigrationEvent) => void,
    opts?: { continueOnError?: boolean }
  ): Promise<void> {
    const adapter = getAdapter(dialect);
    // Dedicated (non-pooled) connection — it runs a transaction and must not be
    // returned to the shared pool in a mid-transaction state
    const conn = await ConnectionFactory.create(dialect, option, { pooled: false });

    try {
      if (opts?.continueOnError) {
        await this.executeContinueOnError(adapter, conn, dialect, schema, steps, onEvent);
      } else {
        await this.executeAtomic(adapter, conn, dialect, schema, steps, onEvent);
      }
    } finally {
      await ConnectionFactory.close(dialect, conn);
    }
  }

  /** Runs one statement, applying dialect-specific terminator/comment normalization. */
  private async runStatement(adapter: DriverAdapter, conn: any, dialect: string, raw: string): Promise<void> {
    // Normalize terminators for single-statement driver execution:
    //  - drop a trailing SQL*Plus "/" (Oracle script terminator the driver rejects)
    //  - drop ONE trailing ";" — EXCEPT, on Oracle, for PL/SQL blocks / routine
    //    bodies ending in "END;" / "END name;", where the driver *requires* the
    //    semicolon (a bare "END" is ORA-06550). CREATE TABLE etc. end in ")".
    const isOracle = dialect.toLowerCase() === 'oracle';
    let sql = raw.trim().replace(/\n?\/\s*$/, '').trim();
    // Ends with END; or END <name>; — anchored at ;$ with only bounded
    // token/negated-class quantifiers, so it can't backtrack catastrophically.
    // eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored at ;$; [^"]* is a bounded negated class and the optional name requires a leading \s+
    const isPlSqlBlock = isOracle && /\bEND\b(?:\s+(?:"[^"]*"|\w+))?\s*;$/i.test(sql);
    if (!isPlSqlBlock) {
      sql = sql.replace(/;\s*$/, '');
    }
    sql = sql.trim();
    // Skip only statements that are ENTIRELY comments/blank (e.g. a generator
    // "-- review:" note). A real statement whose definition merely *starts* with
    // a comment line — common for routines/triggers whose stored body begins with
    // "-- ...\nCREATE FUNCTION/TRIGGER ..." — must still run, or it's silently
    // dropped from the migration.
    const hasExecutableSql = sql.split('\n').some((ln) => {
      const t = ln.trim();
      return t.length > 0 && !t.startsWith('--');
    });
    if (!hasExecutableSql) return;
    await adapter.query(conn, sql, []);
  }

  /** Default mode: the whole plan in one transaction, all-or-nothing. */
  private async executeAtomic(
    adapter: DriverAdapter,
    conn: any,
    dialect: string,
    schema: string,
    steps: MigrationStep[],
    onEvent: (e: MigrationEvent) => void
  ): Promise<void> {
    try {
      await adapter.beginTransaction(conn);
      if (schema?.trim()) await adapter.setCurrentSchema(conn, schema.trim());

      onEvent({ type: 'start', total: steps.length });

      try {
        for (const step of steps) {
          if (step.skipped) {
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SKIPPED', error: step.skipped });
            continue;
          }
          onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'RUNNING' });
          try {
            for (const raw of step.statements) await this.runStatement(adapter, conn, dialect, raw);
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SUCCESS' });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'FAILED', error: message });
            throw err;
          }
        }

        await adapter.commitTransaction(conn);
        onEvent({ type: 'done', success: true, rolledBack: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let rolledBack = false;
        try {
          await adapter.rollbackTransaction(conn);
          rolledBack = true;
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
        onEvent({ type: 'done', success: false, rolledBack, error: message });
      }
    } catch (err) {
      // beginTransaction/setCurrentSchema itself failed, before any step ran.
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'done', success: false, rolledBack: false, error: message });
    }
  }

  /**
   * continueOnError mode: each step runs in its own transaction. A failed step
   * rolls back only itself (a fresh transaction per step, so there's nothing
   * shared to poison) and the run continues; the overall migration always
   * reports success — the per-object FAILED events are how the caller learns
   * what didn't apply.
   */
  private async executeContinueOnError(
    adapter: DriverAdapter,
    conn: any,
    dialect: string,
    schema: string,
    steps: MigrationStep[],
    onEvent: (e: MigrationEvent) => void
  ): Promise<void> {
    try {
      if (schema?.trim()) await adapter.setCurrentSchema(conn, schema.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      onEvent({ type: 'done', success: false, rolledBack: false, error: message });
      return;
    }

    onEvent({ type: 'start', total: steps.length });

    for (const step of steps) {
      if (step.skipped) {
        onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SKIPPED', error: step.skipped });
        continue;
      }
      onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'RUNNING' });
      try {
        await adapter.beginTransaction(conn);
        for (const raw of step.statements) await this.runStatement(adapter, conn, dialect, raw);
        await adapter.commitTransaction(conn);
        onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SUCCESS' });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'FAILED', error: message });
        try {
          await adapter.rollbackTransaction(conn);
        } catch (rollbackErr) {
          console.error(`Rollback of failed step ${step.objectName} failed:`, rollbackErr);
        }
      }
    }

    onEvent({ type: 'done', success: true, rolledBack: false });
  }
}
