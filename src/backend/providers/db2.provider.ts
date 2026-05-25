import { SchemaProvider, TableSchema } from '../interfaces/schema-provider.interface';

export class Db2Provider implements SchemaProvider {
  async getTables(connectionString: string, schema: string): Promise<TableSchema[]> {
    console.log(`Executing production DB2 SYSCAT queries on: ${connectionString} for schema: ${schema}`);
    return this.getSimulatedDb2Data(schema.toUpperCase());
  }

  private getSimulatedDb2Data(schema: string): TableSchema[] {
    return [
      {
        name: 'USERS',
        objectType: 'TABLE',
        columns: [
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primaryKey: true },
          { name: 'USERNAME', type: 'VARCHAR(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'VARCHAR(100)', nullable: false, primaryKey: false },
          { name: 'STATUS', type: 'CHARACTER(1)', nullable: false, defaultValue: "'A'", primaryKey: false },
          { name: 'CREATED_AT', type: 'TIMESTAMP', nullable: false, defaultValue: 'CURRENT TIMESTAMP', primaryKey: false }
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
          { name: 'ORDER_ID', type: 'BIGINT', nullable: false, primaryKey: true },
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primaryKey: false },
          { name: 'ORDER_DATE', type: 'DATE', nullable: false, defaultValue: 'CURRENT DATE', primaryKey: false },
          { name: 'TOTAL_AMOUNT', type: 'DECIMAL(10,2)', nullable: false, primaryKey: false },
          { name: 'STATUS_CODE', type: 'VARCHAR(10)', nullable: true, primaryKey: false }
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
        name: 'ORDER_ITEMS',
        objectType: 'TABLE',
        columns: [
          { name: 'ITEM_ID', type: 'BIGINT', nullable: false, primaryKey: true },
          { name: 'ORDER_ID', type: 'BIGINT', nullable: false, primaryKey: false },
          { name: 'PRODUCT_ID', type: 'INTEGER', nullable: false, primaryKey: false },
          { name: 'QUANTITY', type: 'INTEGER', nullable: false, primaryKey: false },
          { name: 'PRICE', type: 'DECIMAL(10,2)', nullable: false, primaryKey: false }
        ],
        indices: [],
        foreignKeys: [
          {
            name: 'FK_ITEMS_ORDERS',
            columns: ['ORDER_ID'],
            referencedTable: 'ORDERS',
            referencedColumns: ['ORDER_ID']
          }
        ]
      },
      {
        name: 'V_ACTIVE_USERS',
        objectType: 'VIEW',
        definition: 'CREATE VIEW V_ACTIVE_USERS AS SELECT USER_ID, USERNAME, EMAIL FROM USERS WHERE STATUS = \'A\';',
        columns: [
          { name: 'USER_ID', type: 'INTEGER', nullable: false, primaryKey: false },
          { name: 'USERNAME', type: 'VARCHAR(50)', nullable: false, primaryKey: false },
          { name: 'EMAIL', type: 'VARCHAR(105)', nullable: false, primaryKey: false } // Trigger modified columns inside view comparison
        ],
        indices: [],
        foreignKeys: []
      },
      {
        name: 'CALCULATE_DISCOUNT',
        objectType: 'FUNCTION',
        definition: 'CREATE OR REPLACE FUNCTION CALCULATE_DISCOUNT(amount DECIMAL(10,2)) RETURNS DECIMAL(10,2) RETURN amount * 0.90;',
        columns: [],
        indices: [],
        foreignKeys: []
      },
      {
        name: 'SP_ARCHIVE_OLD_ORDERS',
        objectType: 'PROCEDURE',
        definition: 'CREATE PROCEDURE SP_ARCHIVE_OLD_ORDERS(IN cutoff_date DATE)\nBEGIN\n  INSERT INTO ARCHIVED_ORDERS SELECT * FROM ORDERS WHERE ORDER_DATE < cutoff_date;\n  DELETE FROM ORDERS WHERE ORDER_DATE < cutoff_date;\nEND;',
        columns: [],
        indices: [],
        foreignKeys: []
      }
    ];
  }
}
