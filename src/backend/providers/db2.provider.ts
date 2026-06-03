import { ConnectionFactory } from "../cores/connection-factory";
import { ConnectionOptions, SchemaProvider, TableSchema } from "../interfaces/schema-provider.interface";

export class Db2Provider implements SchemaProvider {
  async testConnection(options: ConnectionOptions): Promise<boolean> {
    let connection: any;

    try {

      connection =
        await ConnectionFactory.create(
          this.provider,
          options
        );

      const sql = `SELECT 1`;

      await new Promise<void>((resolve, reject) => {
        connection.query(sql, [], (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });

      return true;

    } catch (error) {

      console.error('Error testing DB2 connection:', error);
      return false;
    } finally {

      await ConnectionFactory.close(
        this.provider,
        connection
      );
    }
  }

  readonly provider = 'db2';

  async getTables(
    options: ConnectionOptions,
    schema: string
  ) {

    let connection: any;

    try {

      connection =
        await ConnectionFactory.create(
          this.provider,
          options
        );

      const sql = `
        SELECT TABNAME
        FROM SYSCAT.TABLES
        WHERE TABSCHEMA = ?
      `;

      const rows = await new Promise<unknown[]>((resolve, reject) => {
        connection.query(sql, [schema.toUpperCase()], (err: Error | null, data: unknown[]) => {
          if (err) reject(err);
          else resolve(data ?? []);
        });
      });

      return rows as TableSchema[];

    } finally {

      await ConnectionFactory.close(
        this.provider,
        connection
      );
    }
  }
}