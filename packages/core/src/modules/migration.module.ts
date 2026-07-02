import { ConnectionFactory } from '../cores/connection-factory';
import { getAdapter } from '../providers/adapter-registry';
import { ConnectionOptions } from '../interfaces';
import type { MigrationEvent } from '../interfaces';
import type { MigrationStep } from './sql-generator.module';

export type { MigrationEvent };

/**
 * Executes a migration plan on the target inside one transaction. Dialect-
 * specific transaction handling lives in the provider's DriverAdapter, so this
 * orchestration stays generic. (DB2 and PostgreSQL support transactional DDL,
 * so any failure rolls the target back to its pre-migration state.)
 */
export class MigrationModule {
  async execute(
    dialect: string,
    option: ConnectionOptions,
    schema: string,
    steps: MigrationStep[],
    onEvent: (e: MigrationEvent) => void
  ): Promise<void> {
    const adapter = getAdapter(dialect);
    // Dedicated (non-pooled) connection — it runs a transaction and must not be
    // returned to the shared pool in a mid-transaction state
    const conn = await ConnectionFactory.create(dialect, option, { pooled: false });

    try {
      await adapter.beginTransaction(conn);

      // Pin the target schema so unqualified DDL never lands in the
      // connection user's default schema
      if (schema?.trim()) {
        await adapter.setCurrentSchema(conn, schema.trim());
      }

      onEvent({ type: 'start', total: steps.length });

      try {
        for (const step of steps) {
          if (step.skipped) {
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SKIPPED', error: step.skipped });
            continue;
          }
          onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'RUNNING' });
          const isOracle = dialect.toLowerCase() === 'oracle';
          try {
            for (const raw of step.statements) {
              // Normalize terminators for single-statement driver execution:
              //  - drop a trailing SQL*Plus "/" (Oracle script terminator the driver rejects)
              //  - drop ONE trailing ";" — EXCEPT, on Oracle, for PL/SQL blocks / routine
              //    bodies ending in "END;" / "END name;", where the driver *requires* the
              //    semicolon (a bare "END" is ORA-06550). CREATE TABLE etc. end in ")".
              let sql = raw.trim().replace(/\n?\/\s*$/, '').trim();
              // Ends with END; or END <name>; — anchored at ;$ with only bounded
              // token/negated-class quantifiers, so it can't backtrack catastrophically.
              // eslint-disable-next-line security/detect-unsafe-regex -- false positive: anchored at ;$; [^"]* is a bounded negated class and the optional name requires a leading \s+
              const isPlSqlBlock = isOracle && /\bEND\b(?:\s+(?:"[^"]*"|\w+))?\s*;$/i.test(sql);
              if (!isPlSqlBlock) {
                sql = sql.replace(/;\s*$/, '');
              }
              sql = sql.trim();
              if (!sql || sql.startsWith('--')) continue;
              await adapter.query(conn, sql, []);
            }
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
    } finally {
      await ConnectionFactory.close(dialect, conn);
    }
  }
}
