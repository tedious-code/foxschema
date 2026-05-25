export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}

export type DbObjectType = 'TABLE' | 'VIEW' | 'FUNCTION' | 'PROCEDURE';

export interface TableSchema {
  name: string;
  objectType: DbObjectType;
  definition?: string; // For Views, Functions, Stored Procedures SQL body
  columns: ColumnInfo[];
  indices: IndexInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export interface SchemaProvider {
  getTables(connectionString: string, schema: string): Promise<TableSchema[]>;
}
