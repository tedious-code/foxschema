import { ConnectionFactory } from '../cores/connection-factory';
import { getAdapter } from '../providers/adapter-registry';
import { ConnectionOptions } from '../interfaces/schema-provider.interface';
import { MigrationStep } from './sql-generator.module';

export type MigrationEvent =
  | { type: 'snapshot'; ddl: string }
  | { type: 'start'; total: number }
  | { type: 'object'; objectName: string; objectType: string; action: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; error?: string }
  | { type: 'done'; success: boolean; rolledBack: boolean; error?: string };

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
          onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'RUNNING' });
          try {
            for (const raw of step.statements) {
              // Trailing semicolons are script syntax, not part of the statement for the driver
              const sql = raw.trim().replace(/;\s*$/, '');
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
