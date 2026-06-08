import { DbSchema, TableSchema } from './schema.interface';

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
  schema?: string;
  pool?: { min?: number; max?: number; idleTimeoutMs?: number; };
  ssl?: { enabled: boolean; rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string; };
  timeout?: { connectMs?: number; queryMs?: number; };
  [key: string]: any; 
}

export interface SavedConnection {
  id: string;
  name: string;
  dialect: 'postgres' | 'mysql' | 'db2';
  option?: ConnectionOptions;
}

export interface SchemaProvider {
  readonly provider: string;
  testConnection(options: ConnectionOptions): Promise<boolean>;
  loadSchema(options: ConnectionOptions, schema: string): Promise<DbSchema>;
  getTables?(options: ConnectionOptions, schema: string): Promise<TableSchema[]>;
}