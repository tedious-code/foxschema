import { ConnectionFactory } from '../cores/connection-factory';
import { ConnectionOptions } from '../interfaces/schema-provider.interface';
import { MigrationStep } from './sql-generator.module';

export type MigrationEvent =
  | { type: 'snapshot'; ddl: string }
  | { type: 'start'; total: number }
  | { type: 'object'; objectName: string; objectType: string; action: string; status: 'RUNNING' | 'SUCCESS' | 'FAILED'; error?: string }
  | { type: 'done'; success: boolean; rolledBack: boolean; error?: string };

/**
 * Executes a migration plan on the target inside one transaction.
 * DB2 and PostgreSQL both support transactional DDL, so any failure
 * rolls the target back to its pre-migration state.
 */
export class MigrationModule {
  async execute(
    dialect: string,
    option: ConnectionOptions,
    schema: string,
    steps: MigrationStep[],
    onEvent: (e: MigrationEvent) => void
  ): Promise<void> {
    const provider = dialect.toLowerCase();
    // Dedicated (non-pooled) connection — it runs a transaction and must not be
    // returned to the shared pool in a mid-transaction state
    const conn = await ConnectionFactory.create(provider, option, { pooled: false });

    try {
      await this.begin(provider, conn);

      // Pin the target schema so unqualified DDL never lands in the
      // connection user's default schema
      if (schema?.trim()) {
        await this.setCurrentSchema(provider, conn, schema.trim());
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
              await ConnectionFactory.executeOnConnection(provider, conn, sql, []);
            }
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'SUCCESS' });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            onEvent({ type: 'object', objectName: step.objectName, objectType: step.objectType, action: step.action, status: 'FAILED', error: message });
            throw err;
          }
        }

        await this.commit(provider, conn);
        onEvent({ type: 'done', success: true, rolledBack: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let rolledBack = false;
        try {
          await this.rollback(provider, conn);
          rolledBack = true;
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
        onEvent({ type: 'done', success: false, rolledBack, error: message });
      }
    } finally {
      await ConnectionFactory.close(provider, conn);
    }
  }

  private async setCurrentSchema(provider: string, conn: any, schema: string): Promise<void> {
    if (provider === 'db2') {
      await ConnectionFactory.executeOnConnection(provider, conn, `SET CURRENT SCHEMA = ${schema.toUpperCase()}`, []);
      // Unqualified function/procedure resolution follows CURRENT PATH, not CURRENT SCHEMA
      await ConnectionFactory.executeOnConnection(provider, conn, `SET CURRENT PATH = SYSTEM PATH, ${schema.toUpperCase()}`, []);
    } else if (provider === 'postgres') {
      await ConnectionFactory.executeOnConnection(provider, conn, `SET search_path TO ${schema}`, []);
    } else if (provider === 'mysql') {
      await ConnectionFactory.executeOnConnection(provider, conn, `USE ${schema}`, []);
    }
  }

  private begin(provider: string, conn: any): Promise<void> {
    if (provider === 'db2') {
      return new Promise((resolve, reject) => {
        conn.beginTransaction((err: Error | null) => (err ? reject(err) : resolve()));
      });
    }
    return ConnectionFactory.executeOnConnection(provider, conn, 'BEGIN', []).then(() => undefined);
  }

  private commit(provider: string, conn: any): Promise<void> {
    if (provider === 'db2') {
      return new Promise((resolve, reject) => {
        conn.commitTransaction((err: Error | null) => (err ? reject(err) : resolve()));
      });
    }
    return ConnectionFactory.executeOnConnection(provider, conn, 'COMMIT', []).then(() => undefined);
  }

  private rollback(provider: string, conn: any): Promise<void> {
    if (provider === 'db2') {
      return new Promise((resolve, reject) => {
        conn.rollbackTransaction((err: Error | null) => (err ? reject(err) : resolve()));
      });
    }
    return ConnectionFactory.executeOnConnection(provider, conn, 'ROLLBACK', []).then(() => undefined);
  }
}
