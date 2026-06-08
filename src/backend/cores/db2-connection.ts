import type { ConnectionOptions } from '../interfaces/schema-provider.interface';

/**
 * Build a DB2 CLI connection string (semicolon-delimited key=value pairs).
 * ibm_db2 does not accept db2:// URLs — those must be converted first.
 *
 * Authentication=SERVER is required by IBM to avoid SQL1042C on many setups.
 */
export function buildDb2ConnectionString(options: ConnectionOptions, schema?: string): string {
  const parsed = parseDb2ConnectionInput(options.connectionString, options);

  const parts: string[] = [
    `DATABASE=${parsed.database}`,
    `HOSTNAME=${parsed.host}`,
    `PORT=${parsed.port}`,
    'PROTOCOL=TCPIP',
    `UID=${parsed.username}`,
    `PWD=${parsed.password}`,
    'Authentication=SERVER',
  ];

  if (options.ssl?.enabled) {
    parts.push('Security=SSL');
  }

  const schemaName = schema?.trim() || options.schema?.trim();
  if (schemaName) {
    parts.push(`CurrentSchema=${schemaName.toUpperCase()}`);
  }

  return parts.join(';') + ';';
}

function parseDb2ConnectionInput(
  connectionString: string | undefined,
  options: ConnectionOptions
): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
} {
  if (connectionString?.trim()) {
    const trimmed = connectionString.trim();

    if (/^db2:\/\//i.test(trimmed)) {
      return parseDb2Url(trimmed);
    }

    if (/DATABASE\s*=/i.test(trimmed)) {
      return parseDb2Semicolon(trimmed, options);
    }
  }

  return {
    host: options.host ?? 'localhost',
    port: options.port ?? 50000,
    database: options.database ?? '',
    username: options.username ?? '',
    password: options.password ?? '',
  };
}

function parseDb2Url(url: string): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
} {
  const normalized = url.replace(/^db2:\/\//i, 'http://');
  const parsed = new URL(normalized);

  return {
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname || 'localhost',
    port: parsed.port ? Number(parsed.port) : 50000,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

function parseDb2Semicolon(
  connStr: string,
  fallback: ConnectionOptions
): {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
} {
  const map = new Map<string, string>();
  for (const segment of connStr.split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).trim().toUpperCase();
    const value = segment.slice(eq + 1).trim();
    if (key) map.set(key, value);
  }

  return {
    database: map.get('DATABASE') ?? fallback.database ?? '',
    host: map.get('HOSTNAME') ?? fallback.host ?? 'localhost',
    port: Number(map.get('PORT') ?? fallback.port ?? 50000),
    username: map.get('UID') ?? fallback.username ?? '',
    password: map.get('PWD') ?? fallback.password ?? '',
  };
}
