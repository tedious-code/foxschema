import { ConnectionFactory } from "../drivers/connection-factory";
import { ConnectionOptions } from "../drivers/connection-options";

export class Db2Provider {

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

      const rows =
        await connection.query(
          sql,
          [schema.toUpperCase()],
          options.timeout?.queryMs ?? 15000
        );

      return rows;

    } finally {

      await ConnectionFactory.close(
        this.provider,
        connection
      );
    }
  }
}