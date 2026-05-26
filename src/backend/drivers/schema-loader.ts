export class SchemaLoader {

  static async load(
    provider: any,
    connection: any,
    schema: string
  ) {

    const [
      tables,
      columns,
      indexes,
      foreignKeys
    ] = await Promise.all([

      provider.loadTables(
        connection,
        schema
      ),

      provider.loadColumns(
        connection,
        schema
      ),

      provider.loadIndexes(
        connection,
        schema
      ),

      provider.loadForeignKeys(
        connection,
        schema
      )
    ]);

    return {
      tables,
      columns,
      indexes,
      foreignKeys
    };
  }
}