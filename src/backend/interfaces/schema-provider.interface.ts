import { DbSchema, TableSchema } from './schema.interface';

export type { TableSchema, DbObjectType, ColumnInfo, IndexInfo, ForeignKeyInfo, PrimaryKeyInfo, TriggerInfo, SequenceInfo, UserTypeInfo, TypeAttributeInfo } from './schema.interface';

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
  /** Lists selectable namespaces in the connected database: schemas for DB2/Postgres, databases for MySQL. */
  listSchemas?(options: ConnectionOptions): Promise<string[]>;
}

/**
 * Browser-safe, per-provider connection settings. Lives next to each
 * provider so a new dialect only adds files in its own folder — no DB
 * driver imports allowed here (the frontend bundles these).
 */
export interface ProviderConnectionSettings {
  dialect: string;
  label: string;
  defaultPort: number;
  defaultSchema?: string;
  buildConnectionString(option: ConnectionOptions): string;
}

/**
 * Backend-only driver adapter: owns everything native-driver-specific for a
 * dialect (pooling, query execution, transactions). Adding a database platform
 * means implementing this in the provider folder — core/modules stay generic.
 */
export interface DriverAdapter {
  readonly dialect: string;
  /** npm package that supplies this driver (for install/availability checks). */
  readonly packageName: string;

  /** Acquire a connection — pooled for reads, dedicated when pooled=false (transactions). */
  acquire(connectionString: string, options: ConnectionOptions, pooled: boolean): Promise<any>;
  /** Return a pooled connection to its pool, or close a dedicated one. */
  release(connection: any): Promise<void>;
  /** Run a statement and return rows. */
  query<T = Record<string, unknown>>(connection: any, sql: string, params: readonly unknown[]): Promise<T[]>;

  /** Transaction lifecycle (used by migrations). */
  beginTransaction(connection: any): Promise<void>;
  commitTransaction(connection: any): Promise<void>;
  rollbackTransaction(connection: any): Promise<void>;
  /** Pin the working schema so unqualified DDL lands in the right place. */
  setCurrentSchema(connection: any, schema: string): Promise<void>;

  /** Close every pooled resource (graceful shutdown). */
  closeAll(): Promise<void>;
}