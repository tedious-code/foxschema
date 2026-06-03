export interface DriverInfo {
  provider: string;
  packageName: string;
  installed: boolean;
  version?: string;
  installCommand?: string;
  error?: string;
}

export interface ConnectionOptions {
  connectionString?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?:string;
  
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
  };

  ssl?: {
    enabled: boolean;
    rejectUnauthorized?: boolean;
    ca?: string;
    cert?: string;
    key?: string;
  };

  timeout?: {
    connectMs?: number;
    queryMs?: number;
  };
}

export interface SavedConnection {
  id: string;
  name: string;
  dialect: 'postgres' | 'mysql' | 'db2';
  option?: ConnectionOptions;
}

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
  getTables(options: ConnectionOptions, schema: string): Promise<TableSchema[]>;
  testConnection(options: ConnectionOptions): Promise<boolean>;
}
