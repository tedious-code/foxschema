import { ConnectionFactory } from "../../cores/connection-factory";
import { ConnectionOptions, SchemaProvider } from "../../interfaces/schema-provider.interface";
import { DbSchema } from "../../interfaces/schema.interface";

export class PostgresProvider implements SchemaProvider {
  loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema> {
      throw new Error("Method not implemented.");
  }
  async testConnection(options: ConnectionOptions): Promise<boolean> {
    let connection: any;

    try {

      connection =
        await ConnectionFactory.create(
          this.provider,
          options
        );

      const sql = `SELECT 1`;

      await connection.query(
        sql,
        [],
        options.timeout?.queryMs ?? 15000
      );

      return true;

    } catch (error) {

      console.error('Error testing postgres connection:', error);
      return false;
    } finally {

      await ConnectionFactory.close(
        this.provider,
        connection
      );
    }
  }

  readonly provider = 'postgres';

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

      const rows =
        await connection.query(
          sql,
          [schema.toUpperCase()],
          options.timeout?.queryMs ?? 15000
        );

      return [];

    } finally {

      await ConnectionFactory.close(
        this.provider,
        connection
      );
    }
  }
}