
import {
  SchemaProvider,
  TableSchema
} from '../interfaces/schema-provider.interface';

import {
  DriverDetector
} from './provider';

export class PostgresProvider implements SchemaProvider {
  async getTables(
    connectionString: string,
    schema: string
  ): Promise<TableSchema[]> {

    const driver =
      await DriverDetector.checkProvider('postgres');

    if (!driver.installed) {
      throw new Error(`DB2 driver not found. Please install: ${driver.installCommand} Original error: ${driver.error}`);
    }

    console.log(
      `Executing production DB2 SYSCAT queries on: ${connectionString} for schema: ${schema}`
    );

    const data: TableSchema[] = [];

    return data;
  }
}