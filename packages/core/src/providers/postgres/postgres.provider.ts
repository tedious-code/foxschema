import { ConnectionFactory } from "../../cores/connection-factory";
import { ConnectionOptions, SchemaProvider } from '@foxschema/shared';
import { DbSchema } from '@foxschema/shared';

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

  async listSchemas(options: ConnectionOptions): Promise<string[]> {
    const rows = await ConnectionFactory.executeQuery<{ schema_name: string }>(
      this.provider,
      options,
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name NOT IN ('pg_catalog', 'information_schema') AND schema_name NOT LIKE 'pg_%'
       ORDER BY schema_name`
    );
    return rows.map((r) => r.schema_name);
  }

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