export type Dialect = 'postgres' | 'mysql' | 'mariadb' | 'db2' | 'sqlserver' | 'oracle' | 'sqlite' | 'redshift' | 'clickhouse' | 'azuresql' | 'cockroachdb' | 'yugabytedb' | 'tidb' | 'duckdb';

export interface ConnectionOptions {
  connectionString?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: number;
  database?: string;
  schema?: string;
  schemaRequired?: boolean;
  pool?: { min?: number; max?: number; idleTimeoutMs?: number };
  ssl?: { enabled: boolean; rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string };
  timeout?: { connectMs?: number; queryMs?: number };
  [key: string]: unknown;
}

export interface ProviderSettings {
  dialect: string;
  label: string;
  defaultPort: number;
  defaultSchema?: string;
  schemaRequired: boolean;
  buildConnectionString(option: ConnectionOptions): string;
}

// ── individual provider settings ─────────────────────────────────────────────

const postgresSettings: ProviderSettings = {
  dialect: 'postgres',
  label: 'PostgreSQL',
  defaultPort: 5432,
  defaultSchema: 'public',
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    const user = encodeURIComponent(o.username || '');
    const pass = encodeURIComponent(o.password || '');
    const params: string[] = [];
    if (o.ssl?.enabled) params.push('sslmode=require');
    if (o.schema) params.push(`options=${encodeURIComponent(`-csearch_path=${o.schema}`)}`);
    let url = `postgresql://${user}:${pass}@${host}:${port}/${o.database || ''}`;
    if (params.length) url += `?${params.join('&')}`;
    return url;
  },
};

const mysqlSettings: ProviderSettings = {
  dialect: 'mysql',
  label: 'MySQL',
  defaultPort: 3306,
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    const user = encodeURIComponent(o.username || '');
    const pass = encodeURIComponent(o.password || '');
    let url = `mysql://${user}:${pass}@${host}:${port}/${o.database || ''}`;
    if (o.ssl?.enabled) url += '?ssl=true';
    return url;
  },
};

const mariadbSettings: ProviderSettings = {
  dialect: 'mariadb',
  label: 'MariaDB',
  defaultPort: 3306,
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    const user = encodeURIComponent(o.username || '');
    const pass = encodeURIComponent(o.password || '');
    let url = `mysql://${user}:${pass}@${host}:${port}/${o.database || ''}`;
    if (o.ssl?.enabled) url += '?ssl=true';
    return url;
  },
};

const db2Settings: ProviderSettings = {
  dialect: 'db2',
  label: 'IBM DB2',
  defaultPort: 50000,
  defaultSchema: '',
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    let cs = `DATABASE=${o.database || ''};HOSTNAME=${host};PORT=${port};PROTOCOL=TCPIP;UID=${o.username || ''};PWD=${o.password || ''};`;
    if (o.schema) cs += `CurrentSchema=${o.schema};`;
    return cs;
  },
};

const sqlServerSettings: ProviderSettings = {
  dialect: 'sqlserver',
  label: 'SQL Server',
  defaultPort: 1433,
  defaultSchema: 'dbo',
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    const encrypt = o.ssl?.enabled ? 'Encrypt=True;' : 'Encrypt=False;';
    const trust = o.ssl?.rejectUnauthorized === false ? 'TrustServerCertificate=True;' : '';
    return `Server=${host},${port};Database=${o.database || ''};User Id=${o.username || ''};Password=${o.password || ''};${encrypt}${trust}`;
  },
};

const oracleSettings: ProviderSettings = {
  dialect: 'oracle',
  label: 'Oracle',
  defaultPort: 1521,
  defaultSchema: '',
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    const host = o.host || 'localhost';
    const port = o.port || this.defaultPort;
    const service = o.database || 'ORCL';
    return `${host}:${port}/${service}`;
  },
};

const sqliteSettings: ProviderSettings = {
  dialect: 'sqlite',
  label: 'SQLite',
  defaultPort: 0,
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    return o.database || ':memory:';
  },
};

// Wire-compatible variants: same connection string as their base engine, only
// the label + default port differ. (Mirrors the core provider subclasses.)
const cockroachdbSettings: ProviderSettings = {
  ...postgresSettings,
  dialect: 'cockroachdb',
  label: 'CockroachDB',
  defaultPort: 26257,
};

const yugabytedbSettings: ProviderSettings = {
  ...postgresSettings,
  dialect: 'yugabytedb',
  label: 'YugabyteDB',
  defaultPort: 5433,
};

const tidbSettings: ProviderSettings = {
  ...mysqlSettings,
  dialect: 'tidb',
  label: 'TiDB',
  defaultPort: 4000,
};

const duckdbSettings: ProviderSettings = {
  dialect: 'duckdb',
  label: 'DuckDB',
  defaultPort: 0,
  defaultSchema: 'main',
  schemaRequired: false,
  buildConnectionString(o) {
    if (o.connectionString?.trim()) return o.connectionString.trim();
    return o.database || ':memory:';
  },
};

// ── registry ─────────────────────────────────────────────────────────────────

export const PROVIDER_SETTINGS: Record<string, ProviderSettings> = {
  postgres: postgresSettings,
  cockroachdb: cockroachdbSettings,
  yugabytedb: yugabytedbSettings,
  mysql: mysqlSettings,
  mariadb: mariadbSettings,
  tidb: tidbSettings,
  db2: db2Settings,
  sqlserver: sqlServerSettings,
  oracle: oracleSettings,
  sqlite: sqliteSettings,
  duckdb: duckdbSettings,
};

export const DEFAULT_PORTS: Record<string, number> = Object.fromEntries(
  Object.values(PROVIDER_SETTINGS).map((s) => [s.dialect, s.defaultPort])
);

export function getProviderSettings(dialect: string): ProviderSettings {
  const s = PROVIDER_SETTINGS[dialect.toLowerCase()];
  if (!s) throw new Error(`Unsupported dialect: ${dialect}`);
  return s;
}

export function buildConnectionString(dialect: string, option: ConnectionOptions): string {
  return getProviderSettings(dialect).buildConnectionString(option);
}

export function withConnectionString(dialect: string, option: ConnectionOptions): ConnectionOptions {
  if (option.connectionString?.trim()) return option;
  return { ...option, connectionString: buildConnectionString(dialect, option) };
}
