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
      foreignKeys,
      functions,
      procedures,
      triggers,
      sequences
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
      ),
      provider.loadFunctions(
        connection,
        schema
      ),
      provider.loadProcedures(
        connection,
        schema
      ),
      provider.loadTriggers(
        connection,
        schema
      ),
      provider.loadSequences(
        connection,
        schema
      ),
    ]);

    return {
      tables,
      columns,
      indexes,
      foreignKeys,
      functions,
      procedures,
      triggers,
      sequences
    };
  }
}