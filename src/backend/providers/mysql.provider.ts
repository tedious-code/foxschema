import { SchemaProvider, TableSchema } from '../interfaces/schema-provider.interface';

export class MysqlProvider implements SchemaProvider {
  async getTables(connectionString: string, schema: string): Promise<TableSchema[]> {
    console.log(`Executing MySQL information_schema query on: ${connectionString} for database: ${schema}`);
    
    return [
      {
        name: 'USERS',
        objectType: 'TABLE',
        columns: [
          { name: 'USER_ID', type: 'int', nullable: false, primaryKey: true },
          { name: 'USERNAME', type: 'varchar(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'varchar(100)', nullable: false, primaryKey: false },
          { name: 'STATUS', type: 'char(1)', nullable: false, defaultValue: "'A'", primaryKey: false },
          { name: 'CREATED_AT', type: 'timestamp', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', primaryKey: false }
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
          { name: 'USER_ID', type: 'int', nullable: false, primaryKey: false },
          { name: 'ORDER_DATE', type: 'date', nullable: false, primaryKey: false },
          { name: 'TOTAL_AMOUNT', type: 'decimal(10,2)', nullable: false, primaryKey: false },
          { name: 'STATUS_CODE', type: 'varchar(10)', nullable: true, primaryKey: false }
        ],
        indices: [
          { name: 'IDX_ORDERS_USER', columns: ['USER_ID'], unique: false }
        ],
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
        name: 'V_ACTIVE_USERS',
        objectType: 'VIEW',
        definition: 'CREATE VIEW V_ACTIVE_USERS AS SELECT USER_ID, USERNAME, EMAIL FROM USERS WHERE STATUS = \'A\';',
        columns: [
          { name: 'USER_ID', type: 'int', nullable: false, primaryKey: false },
          { name: 'USERNAME', type: 'varchar(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'varchar(100)', nullable: false, primaryKey: false }
        ],
        indices: [],
        foreignKeys: []
      }
    ];
  }
}
