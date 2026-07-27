import type { ConnectionOptions } from '../../interfaces/schema-provider.interface';

/**
 * Build a DB2 CLI connection string (semicolon-delimited key=value pairs).
 * ibm_db does not accept db2:// URLs — those must be converted first.
 *
 * Authentication=SERVER is required by IBM to avoid SQL1042C on many setups
 * (especially Windows when GSKit / system CLI libraries pollute PATH).
 */
export function buildDb2ConnectionString(options: ConnectionOptions, schema?: string): string {
  const parsed = parseDb2ConnectionInput(options.connectionString, options);

  const parts: string[] = [
    `DATABASE=${odbcEscape(parsed.database)}`,
    `HOSTNAME=${odbcEscape(parsed.host)}`,
    `PORT=${parsed.port}`,
    'PROTOCOL=TCPIP',
    `UID=${odbcEscape(parsed.username)}`,
    `PWD=${odbcEscape(parsed.password)}`,
    'Authentication=SERVER',
  ];

  if (options.ssl?.enabled) {
    parts.push('Security=SSL');
  }

  const schemaName = schema?.trim() || options.schema?.trim();
  if (schemaName) {
    parts.push(`CurrentSchema=${odbcEscape(schemaName.toUpperCase())}`);
  }

  return parts.join(';') + ';';
}

/** ODBC brace-escape so values containing `;` or `}` do not truncate the string. */
export function odbcEscape(value: string): string {
  if (!/[;{}]/.test(value) && value === value.trim()) return value;
  return `{${value.replace(/}/g, '}}')}}`;
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

/**
 * Parse `KEY=value;KEY2={value;with;semicolons};` with ODBC brace rules.
 * A plain `split(';')` would truncate passwords that contain `;`.
 */
export function parseDb2SemicolonMap(connStr: string): Map<string, string> {
  const map = new Map<string, string>();
  let i = 0;
  const s = connStr;

  while (i < s.length) {
    while (i < s.length && (s[i] === ';' || /\s/.test(s[i]!))) i++;
    if (i >= s.length) break;

    const eq = s.indexOf('=', i);
    if (eq === -1) break;
    const key = s.slice(i, eq).trim().toUpperCase();
    let j = eq + 1;
    while (j < s.length && s[j] === ' ') j++;

    let value: string;
    if (s[j] === '{') {
      j++;
      let out = '';
      while (j < s.length) {
        if (s[j] === '}' && s[j + 1] === '}') {
          out += '}';
          j += 2;
          continue;
        }
        if (s[j] === '}') {
          j++;
          break;
        }
        out += s[j]!;
        j++;
      }
      value = out;
      while (j < s.length && s[j] !== ';') j++;
    } else {
      const semi = s.indexOf(';', j);
      value = (semi === -1 ? s.slice(j) : s.slice(j, semi)).trim();
      j = semi === -1 ? s.length : semi;
    }

    if (key) map.set(key, value);
    i = j + 1;
  }

  return map;
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
  const map = parseDb2SemicolonMap(connStr);

  return {
    database: map.get('DATABASE') ?? fallback.database ?? '',
    host: map.get('HOSTNAME') ?? fallback.host ?? 'localhost',
    port: Number(map.get('PORT') ?? fallback.port ?? 50000),
    username: map.get('UID') ?? fallback.username ?? '',
    password: map.get('PWD') ?? fallback.password ?? '',
  };
}
