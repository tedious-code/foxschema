import { SchemaProvider, TableSchema } from '../interfaces/schema-provider.interface';

export class PostgresProvider implements SchemaProvider {
  async getTables(connectionString: string, schema: string): Promise<TableSchema[]> {
    console.log(`Executing Postgres query on: ${connectionString} for schema: ${schema}`);
    
    return [
      {
        name: 'USERS',
        objectType: 'TABLE',
        columns: [
          { name: 'USER_ID', type: 'integer', nullable: false, primaryKey: true },
          { name: 'USERNAME', type: 'character varying(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'character varying(100)', nullable: false, primaryKey: false },
          { name: 'CREATED_AT', type: 'timestamp without time zone', nullable: true, defaultValue: 'now()', primaryKey: false }
        ],
        indices: [
          { name: 'IDX_USERS_EMAIL', columns: ['EMAIL'], unique: true }
        ],
        foreignKeys: []
      },
      {
        name: 'ORDERS',
        objectType: 'TABLE',
        columns: [
          { name: 'ORDER_ID', type: 'bigint', nullable: false, primaryKey: true },
          { name: 'USER_ID', type: 'integer', nullable: false, primaryKey: false },
          { name: 'ORDER_DATE', type: 'date', nullable: false, primaryKey: false },
          { name: 'TOTAL_AMOUNT', type: 'numeric(10,2)', nullable: false, primaryKey: false }
        ],
        indices: [],
        foreignKeys: [
          {
            name: 'FK_ORDERS_USERS',
            columns: ['USER_ID'],
            referencedTable: 'USERS',
            referencedColumns: ['USER_ID']
          }
        ]
      },
      {
        name: 'AUDIT_LOGS',
        objectType: 'TABLE',
        columns: [
          { name: 'LOG_ID', type: 'serial', nullable: false, primaryKey: true },
          { name: 'ACTION', type: 'text', nullable: false, primaryKey: false },
          { name: 'PERFORMED_BY', type: 'integer', nullable: false, primaryKey: false },
          { name: 'TIMESTAMP', type: 'timestamp without time zone', nullable: false, defaultValue: 'clock_timestamp()', primaryKey: false }
        ],
        indices: [],
        foreignKeys: []
      },
      {
        name: 'V_ACTIVE_USERS',
        objectType: 'VIEW',
        definition: 'CREATE VIEW V_ACTIVE_USERS AS SELECT USER_ID, USERNAME, EMAIL FROM USERS WHERE STATUS = \'A\';',
        columns: [
          { name: 'USER_ID', type: 'integer', nullable: false, primaryKey: false },
          { name: 'USERNAME', type: 'character varying(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'character varying(100)', nullable: false, primaryKey: false } // Trigger difference against source (105)
        ],
        indices: [],
        foreignKeys: []
      },
      {
        name: 'CALCULATE_DISCOUNT',
        objectType: 'FUNCTION',
        definition: 'CREATE OR REPLACE FUNCTION CALCULATE_DISCOUNT(amount numeric) RETURNS numeric AS $$\nBEGIN\n  RETURN amount * 0.90;\nEND;\n$$ LANGUAGE plpgsql;',
        columns: [],
        indices: [],
        foreignKeys: []
      }
      // SP_ARCHIVE_OLD_ORDERS is missing in target (needs addition)
    ];
  }
}
